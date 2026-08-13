import type { DriftTurnState, HelixState, OrbitState, Quat, Vec3 } from '../../core/types';
import type { EnemyShip, ShipBody } from '../../core/world';
import type { FlightInputs } from '../../physics/flightModel';
import { lookAtQuat, quatMultiply } from '../../math/quaternion';
import { clamp, cross, dot, normalize, rotateAboutAxis } from '../../math/vec';
import { steeringToward } from '../enemyAI';

// ===========================================================================
// OrbiterAI / DrifterAI — harmless practice targets for the Aim Training drill (see
// scenarios/definitions.ts). Neither ever fires; scenarios/runtime.ts's dispatch for these two
// behaviors has no firing logic at all. Both respawn a short while after being shot down so the
// target pool stays full for the whole drill instead of thinning out. Ported verbatim from the
// original project's combat/enemyAI.ts.
// ===========================================================================
export const ORBITER_TUNING = {
  minRadius: 150, maxRadius: 400,     // meters from the player
  minAngularSpeed: 0.15, maxAngularSpeed: 0.35, // rad/s
  respawnDelaySec: 1.5,
  // The orbit's center is fixed at spawn (see orbiterThink's doc comment) so the player can close
  // or open distance within a pass, but if the player wanders off it needs to catch up or the ring
  // is left behind arbitrarily far away — centerFollowRate eases the center toward the player's
  // live position (fraction/sec, exponential) whenever the drone strays past leashDistance, so it
  // keeps trying to stay within roughly 500m instead of drifting off forever.
  leashDistance: 500,
  centerFollowRate: 0.5
};

// Tuning for HOW an orbiter chases its ring (see orbiterThink) — kept separate from ORBITER_TUNING
// above so the radius/speed/leash knobs that set the drill's difficulty stay untouched by this.
export const ORBITER_STEER_TUNING = {
  steerGain: 6, // proportional steering gain fed to steeringToward — gentler than CHASER_TUNING's 5
                // or FIGHTER_TUNING_ACE's 7, since orientation here only ever has to track the ring's
                // own (slowly rotating) tangent direction, never a jumpy target — see below
  // Orientation and radial position are controlled by two INDEPENDENT thrusters, not one blended
  // steering target — two earlier approaches that tried to fold radial correction into orientation
  // both failed (verified empirically, not just reasoned about):
  //   1. Chasing a "carrot" point some fixed angle further around the ring (a classic pursuit-curve
  //      lead) settles into whatever radius makes ITS OWN steering error self-consistent — generally
  //      NOT the tuned radius (it stabilized at ~2.2x tuned radius; raising steerGain barely moved
  //      it, since that's a structural property of pursuit curves, not an undertuned gain).
  //   2. Commanding a single steerDir that blends the tangent with a radial bias (or, worse, points
  //      straight at the full velocity-error vector) makes the TARGET DIRECTION swing wildly whenever
  //      a large radial correction is needed at the same time as holding tangential speed — the
  //      flight model's real turn-rate lag can't track a target that gyrates that fast, so the nose
  //      chases an inaccurate compromise and the ship settles into a wrong equilibrium radius instead
  //      of the tuned one (or oscillates back and forth across it).
  // The fix: keep orientation dead simple — nose = the ring's own tangent, bank = toward center — and
  // let it converge cleanly (this alone verified stable). Radial correction happens on a SEPARATE
  // axis: the ship's own vertical strafe thruster, which (once banked) already points along the
  // radial axis regardless of which way the nose is turned, exactly like a real RCS thruster fires
  // independent of main engine orientation. Tangent and radial-out are geometrically perpendicular by
  // construction, so "nose on tangent, up toward center" is always simultaneously and exactly
  // achievable — no compromise between the two the way blending them into one direction required.
  radialGainPerSec: 0.4,     // 1/s — desired inward/outward correction speed per meter of radius
                              // error, e.g. 100m too far out asks for 40 m/s of inward closing speed
  radialVelBandMps: 60,      // m/s of radial velocity error at which strafeY reaches full ±1.0
  speedBandMps: 40,          // m/s of tangential-speed deficit at which throttle reaches full 1.0
  brakeOverspeedMps: 40      // m/s of tangential speed above target at which the space brake engages
};

export const DRIFTER_TUNING = {
  minSpawnDist: 350, maxSpawnDist: 500,  // meters from the player at spawn — kept inside the ~500m
                                          // practice range instead of streaking in from far off
  minSpeed: 90, maxSpeed: 160,           // m/s, constant for the whole pass
  minMissDistance: 40, maxMissDistance: 150, // meters — how far off-center the flight line passes the player
  turnDist: 500,                         // meters — triggers a turn-around (see TURN_TUNING) instead
                                          // of letting it fly off and get recycled out of sight
  respawnDelaySec: 1.0
};

// A drifter that's flown turnDist away doesn't despawn — it banks into a long, multi-rotation
// barrel roll that curves its heading back around toward the player, then resumes straight-line
// flight on the new heading. Keeps the same drone visibly in play instead of teleporting a fresh
// one in, while still reading as a deliberate "reversal" maneuver rather than a snap-turn.
const TURN_TUNING = {
  duration: 3.2,          // seconds for the whole reversal
  minRollTurns: 1.5, maxRollTurns: 2.2 // full rotations about its own axis during the reversal
};

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Rotation-only quaternion about the local forward axis (+Z in computeAxes' base convention) — the
// same body-frame roll axis integrateOrientation uses for angVel.roll.
function rollQuat(angleRad: number): Quat {
  return { w: Math.cos(angleRad / 2), x: 0, y: 0, z: Math.sin(angleRad / 2) };
}

// A random axis perpendicular pair, used as the fixed orbit plane — kept stable in world space
// (not tied to the player's facing) so the ring doesn't swing around when the player looks away.
function randomPerpendicularPair(): { right: Vec3; up: Vec3 } {
  const axis = normalize({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 });
  let right = cross(axis, { x: 0, y: 1, z: 0 });
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = cross(axis, { x: 1, y: 0, z: 0 });
  right = normalize(right);
  const up = normalize(cross(axis, right));
  return { right, up };
}

// aggressiveness (0..1, see ScenarioConfig.droneAggressiveness) scales flight speed from 0.6x at 0
// to 1.8x at 1 — the Aim Training drill's difficulty knob.
function droneSpeedMult(aggressiveness: number): number {
  return 0.6 + aggressiveness * 1.2;
}

export function spawnOrbitState(center: Vec3, aggressiveness: number = 0.5) {
  const { right, up } = randomPerpendicularPair();
  return {
    center: { x: center.x, y: center.y, z: center.z },
    radius: randRange(ORBITER_TUNING.minRadius, ORBITER_TUNING.maxRadius),
    angularSpeed: randRange(ORBITER_TUNING.minAngularSpeed, ORBITER_TUNING.maxAngularSpeed)
      * droneSpeedMult(aggressiveness) * (Math.random() < 0.5 ? -1 : 1),
    phase: Math.random() * Math.PI * 2,
    planeRight: right,
    planeUp: up,
    respawnTimer: 0
  };
}

// The pos/vel a drone sitting exactly at `phase` on the ring would have — a straight lift of the
// old closed-form orbit formula, now just a lookup used two ways: orbiterThink evaluates it at a
// LEAD phase (ahead of the drone's own) to get a pursuit target, and seedOrbiterPose evaluates it
// at the current phase to place a freshly (re)spawned drone exactly on the ring.
function computeOrbitPose(
  orbit: Pick<OrbitState, 'center' | 'radius' | 'angularSpeed' | 'planeRight' | 'planeUp'>,
  phase: number
): { pos: Vec3; vel: Vec3 } {
  const cosP = Math.cos(phase), sinP = Math.sin(phase);
  const { center, planeRight: r, planeUp: u, radius, angularSpeed } = orbit;
  const pos = {
    x: center.x + radius * (cosP * r.x + sinP * u.x),
    y: center.y + radius * (cosP * r.y + sinP * u.y),
    z: center.z + radius * (cosP * r.z + sinP * u.z)
  };
  const tangential = radius * angularSpeed;
  const vel = {
    x: tangential * (-sinP * r.x + cosP * u.x),
    y: tangential * (-sinP * r.y + cosP * u.y),
    z: tangential * (-sinP * r.z + cosP * u.z)
  };
  return { pos, vel };
}

// Places a freshly (re)spawned orbiter exactly on its ring, with the correct tangential velocity
// and a bank toward the orbit center — so it starts out already flying the pursuit curve instead
// of popping in from wherever spawnEnemyFromConfig's placeholder pos left it.
export function seedOrbiterPose(enemy: EnemyShip): void {
  const orbit = enemy.orbit;
  if (!orbit) return;
  const { pos, vel } = computeOrbitPose(orbit, orbit.phase);
  enemy.pos = pos;
  enemy.vel = vel;
  const toCenter = { x: orbit.center.x - pos.x, y: orbit.center.y - pos.y, z: orbit.center.z - pos.z };
  const bankHint = Math.hypot(toCenter.x, toCenter.y, toCenter.z) > 1 ? normalize(toCenter) : undefined;
  enemy.quat = lookAtQuat(vel, bankHint);
}

export interface OrbiterDecision {
  inputs: FlightInputs;
  boostRequested: boolean;
}

// Flies the drone around its ring with two independent thrusters (see ORBITER_STEER_TUNING's doc
// comment for why this replaces two earlier, structurally broken designs): the nose always tracks
// the ring's own analytic tangent direction at the drone's CURRENT angular position (read off its
// actual pos, projected onto the orbit plane), banked toward the orbit center — that's the ONLY
// source of roll now, no separate scripted flourish — while the MAIN engine (throttle) regulates
// tangential speed and the VERTICAL STRAFE thruster (strafeY) independently regulates radial
// position/velocity, since once banked its axis already points along the radial line regardless of
// which way the nose is turned. The center eases toward the player (see
// ORBITER_TUNING.centerFollowRate) once the drone strays past leashDistance, so a player who wanders
// off doesn't leave the ring behind arbitrarily far away. `orbit.phase` is only used once now, by
// seedOrbiterPose, to place a freshly (re)spawned drone.
export function orbiterThink(enemy: EnemyShip, player: ShipBody, dt: number): OrbiterDecision {
  const idleInputs: FlightInputs = { throttle: 0, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false };
  const orbit = enemy.orbit;
  if (!orbit) return { inputs: idleInputs, boostRequested: false };

  const distToPlayer = Math.hypot(
    enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z
  );
  if (distToPlayer > ORBITER_TUNING.leashDistance) {
    const t = 1 - Math.exp(-ORBITER_TUNING.centerFollowRate * dt);
    orbit.center.x += (player.pos.x - orbit.center.x) * t;
    orbit.center.y += (player.pos.y - orbit.center.y) * t;
    orbit.center.z += (player.pos.z - orbit.center.z) * t;
  }

  const toShip = { x: enemy.pos.x - orbit.center.x, y: enemy.pos.y - orbit.center.y, z: enemy.pos.z - orbit.center.z };
  const actualRadius = Math.hypot(toShip.x, toShip.y, toShip.z);
  const currentAngle = Math.atan2(dot(toShip, orbit.planeUp), dot(toShip, orbit.planeRight));

  // unit tangent to the ring at the drone's own current angular position, in the direction of travel
  // (the derivative of computeOrbitPose's position formula w.r.t. phase, sign-flipped for a
  // negative angularSpeed so it always points the way this orbit actually rotates)
  const dirSign = orbit.angularSpeed < 0 ? -1 : 1;
  const sinA = Math.sin(currentAngle), cosA = Math.cos(currentAngle);
  const tangent = normalize({
    x: dirSign * (-sinA * orbit.planeRight.x + cosA * orbit.planeUp.x),
    y: dirSign * (-sinA * orbit.planeRight.y + cosA * orbit.planeUp.y),
    z: dirSign * (-sinA * orbit.planeRight.z + cosA * orbit.planeUp.z)
  });
  const radialOut = actualRadius > 1 ? { x: toShip.x / actualRadius, y: toShip.y / actualRadius, z: toShip.z / actualRadius } : orbit.planeRight;

  const bankHint = { x: -radialOut.x, y: -radialOut.y, z: -radialOut.z }; // banks toward center
  const steer = steeringToward(enemy.quat, tangent, ORBITER_STEER_TUNING.steerGain, bankHint);

  // Throttle: regulate the TANGENTIAL velocity component only, via the main engine (nose ≈ tangent).
  const tangentialSpeed = dot(enemy.vel, tangent);
  const targetTangentialSpeed = orbit.radius * Math.abs(orbit.angularSpeed);
  const brake = tangentialSpeed - targetTangentialSpeed > ORBITER_STEER_TUNING.brakeOverspeedMps;
  const throttle = brake ? 0 : clamp((targetTangentialSpeed - tangentialSpeed) / ORBITER_STEER_TUNING.speedBandMps, 0, 1);

  // strafeY: regulate the RADIAL velocity component independently, via the vertical RCS thruster.
  // Once banked, local "up" ≈ -radialOut (toward center), so POSITIVE strafeY thrusts inward — see
  // ShipBody's verticalUp/verticalDown convention in physics/flightModel.ts.
  const currentRadialVel = dot(enemy.vel, radialOut); // positive = moving outward
  const targetRadialVel = -(actualRadius - orbit.radius) * ORBITER_STEER_TUNING.radialGainPerSec; // negative (inward) when too far out
  const radialVelError = targetRadialVel - currentRadialVel; // positive => need more outward push; negative => need inward push
  const strafeY = clamp(-radialVelError / ORBITER_STEER_TUNING.radialVelBandMps, -1, 1);

  return {
    inputs: {
      throttle, pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll,
      strafeX: 0, strafeY, brake, decoupled: false
    },
    boostRequested: false
  };
}

// Aims roughly back at the player from `fromPos`, offset sideways by a random miss distance so the
// flight line streaks past rather than colliding — more aggressive drills pass closer (tighter
// tracking window). Shared by spawnDriftState (a fresh pass) and driftThink's turn-around (the same
// drone looping back for another pass).
function pickMissAimedFlightDir(fromPos: Vec3, player: ShipBody, aggressiveness: number): Vec3 {
  const towardPlayer = normalize({ x: player.pos.x - fromPos.x, y: player.pos.y - fromPos.y, z: player.pos.z - fromPos.z });
  let side = cross(towardPlayer, { x: 0, y: 1, z: 0 });
  if (Math.hypot(side.x, side.y, side.z) < 1e-6) side = cross(towardPlayer, { x: 1, y: 0, z: 0 });
  side = normalize(side);
  const missDistanceMult = 1.3 - aggressiveness * 0.7; // 0 -> 1.3x (wider), 1 -> 0.6x (tighter)
  const missDistance = randRange(DRIFTER_TUNING.minMissDistance, DRIFTER_TUNING.maxMissDistance)
    * missDistanceMult * (Math.random() < 0.5 ? -1 : 1);
  const aimPoint: Vec3 = {
    x: player.pos.x + side.x * missDistance,
    y: player.pos.y + side.y * missDistance,
    z: player.pos.z + side.z * missDistance
  };
  return normalize({ x: aimPoint.x - fromPos.x, y: aimPoint.y - fromPos.y, z: aimPoint.z - fromPos.z });
}

// A drifter's cruise segment is never a straight line — it's ALWAYS a continuous corkscrew around
// its base heading: a real barrel roll isn't just spinning in place, it's holding a constant
// "up-strafe" while rolling, so as the roll turns that thrust through a full circle the flight path
// corkscrews sideways around the base heading. Roll rate is a fraction of a fixed max rate: a gentle 25% normally, escalating
// to a hard 75% only while genuinely under threat (see isAggressiveEscalation) — it never reaches a
// full 100% snap-roll. Forward speed and the corkscrew's own lateral/vertical STRAFE SPEED are NOT
// scaled by that fraction: "100% upstrafe/forward acceleration/boost while rolling" is always-on
// regardless of tier, since rolling itself is now continuous rather than a discrete on/off event.
const DRIFT_ROLL_TUNING = {
  fullRollPeriodSec: 4.0,     // seconds per full 360 AT 100% roll rate (never actually used at 100%,
                              // just the reference rate the two fractions below scale down from) —
                              // gives a ~5.3s full rotation at the 75% aggressive rate and a slow
                              // ~16s lazy bank at the 25% cruise rate. Kept slow deliberately: this is
                              // meant to read as a drone gently/aggressively banking, never a fast spin.
  normalFraction: 0.25,       // default continuous roll rate, as a fraction of the 100% reference
  aggressiveFraction: 0.75,   // roll rate while the escalation conditions below hold (or recently did)
                              // — the ONLY two values rollFraction ever targets; it never reaches 1.0
  rollFractionEaseRate: 0.7,  // 1/s — how fast the CURRENT roll fraction chases its target (see
                              // HelixState.rollFraction's doc comment). Switching rate instantly
                              // between 0.25 and 0.75 read as a jarring one-tick "whip roll"; this
                              // eases the transition over a couple of seconds instead
  helixStrafeSpeedMps: 85,    // m/s of lateral/vertical velocity the corkscrew contributes — a FIXED
                              // speed, deliberately NOT derived from radius*rollRate. Tying strafe
                              // speed to a fixed radius (the old approach) meant slowing the roll rate
                              // to fix its duration silently weakened the strafe to near-imperceptible
                              // levels too — a real regression this decouples: "100% upstrafe" now
                              // means this same solid sideways/up speed regardless of how fast the
                              // corkscrew is currently cycling through it (implied radius = this
                              // speed / the current angular rate, so it's naturally wider at the lazy
                              // 25% rate and tighter at the fast 75% one)
  boostSpeedMult: 1.6,        // constant forward-speed multiplier over the spawned cruise speed —
                              // "100% forward acceleration and boost", always-on
  aggressiveHoldSec: 1.0,     // seconds the aggressive roll rate lingers after the escalation
                              // conditions last held, so it doesn't flicker frame-to-frame with the
                              // player's own fire-rate cadence
  aggressiveRangeM: 1000,     // meters — escalation only considered this close to the player
  aggressiveAimCos: 0.9063    // cos(25deg) — how tightly the drone's OWN heading must point at the
                              // player to count as "flying directly to the player" (condition B below)
};

function rollRateMax(): number {
  return (Math.PI * 2) / DRIFT_ROLL_TUNING.fullRollPeriodSec;
}

function spawnHelix(baseDir: Vec3, baseSpeed: number): HelixState {
  let right = cross(baseDir, { x: 0, y: 1, z: 0 });
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = cross(baseDir, { x: 1, y: 0, z: 0 });
  right = normalize(right);
  const up = normalize(cross(baseDir, right));
  return { baseDir, baseSpeed, right, up, angle: 0, aggressiveTimer: 0, rollFraction: DRIFT_ROLL_TUNING.normalFraction };
}

// True only once ALL three of the user-specified escalation conditions hold this tick: (A) this
// drone specifically is the player's ONE active soft-locked target (see combat/pipTargeting.ts's
// findActivePip) AND the player actually fired AND that shot would land within its hull radius right
// now — computed once per frame by the caller (scenarios/runtime.ts) so at most a single drone in
// the whole swarm can ever satisfy this at a time, never several at once off the same shot; (B) this
// drone's own base heading points essentially straight at the player (a genuine attack-run pass, not
// just any inbound leg); (C) within aggressiveRangeM. Any one missing keeps the roll at its gentle
// default — see driftThink's aggressiveTimer hysteresis for how this translates into a smooth (not
// flickery) rate change.
function isAggressiveEscalation(helix: HelixState, enemy: EnemyShip, player: ShipBody, isBeingFiredAt: boolean): boolean {
  if (!isBeingFiredAt) return false; // (A)
  const toPlayer: Vec3 = { x: player.pos.x - enemy.pos.x, y: player.pos.y - enemy.pos.y, z: player.pos.z - enemy.pos.z };
  const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
  if (dist > DRIFT_ROLL_TUNING.aggressiveRangeM || dist < 1e-6) return false; // (C)
  const towardPlayer = { x: toPlayer.x / dist, y: toPlayer.y / dist, z: toPlayer.z / dist };
  return dot(helix.baseDir, towardPlayer) >= DRIFT_ROLL_TUNING.aggressiveAimCos; // (B)
}

// Returns the full cruise velocity (boosted base heading + the corkscrew's own tangential velocity,
// i.e. the derivative of its circular offset) for the CURRENT roll angle — mutating nothing;
// driftThink advances helix.angle itself so the turn-around branch can leave it alone entirely.
function computeHelixVelocity(helix: HelixState): Vec3 {
  const tangential = DRIFT_ROLL_TUNING.helixStrafeSpeedMps;
  const boostedSpeed = helix.baseSpeed * DRIFT_ROLL_TUNING.boostSpeedMult;
  const cosA = Math.cos(helix.angle), sinA = Math.sin(helix.angle);
  const { right, up, baseDir } = helix;
  return {
    x: baseDir.x * boostedSpeed + tangential * (-sinA * up.x + cosA * right.x),
    y: baseDir.y * boostedSpeed + tangential * (-sinA * up.y + cosA * right.y),
    z: baseDir.z * boostedSpeed + tangential * (-sinA * up.z + cosA * right.z)
  };
}

export function spawnDriftState(player: ShipBody, aggressiveness: number = 0.5): { pos: Vec3; vel: Vec3 } {
  const dir = normalize({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 });
  const spawnDist = randRange(DRIFTER_TUNING.minSpawnDist, DRIFTER_TUNING.maxSpawnDist);
  const pos: Vec3 = {
    x: player.pos.x + dir.x * spawnDist,
    y: player.pos.y + dir.y * spawnDist,
    z: player.pos.z + dir.z * spawnDist
  };

  const flightDir = pickMissAimedFlightDir(pos, player, aggressiveness);
  const speed = randRange(DRIFTER_TUNING.minSpeed, DRIFTER_TUNING.maxSpeed) * droneSpeedMult(aggressiveness);

  return { pos, vel: { x: flightDir.x * speed, y: flightDir.y * speed, z: flightDir.z * speed } };
}

// Ease-in/ease-out for the heading sweep, so the reversal accelerates into and decelerates out of
// the turn instead of sweeping at a constant angular rate.
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Kicks off a drifter's turn-around: picks a new aim-back-at-the-player heading from its current
// position (same targeting logic as a fresh spawn — see pickMissAimedFlightDir) and records the
// great-circle arc from its current heading to that new one, to be swept over TURN_TUNING.duration.
function startDriftTurn(enemy: EnemyShip, drift: NonNullable<EnemyShip['drift']>, player: ShipBody, aggressiveness: number): void {
  const flightSpeed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z) || 1;
  const fromDir = { x: enemy.vel.x / flightSpeed, y: enemy.vel.y / flightSpeed, z: enemy.vel.z / flightSpeed };
  const toDir = pickMissAimedFlightDir(enemy.pos, player, aggressiveness);

  const angleTotal = Math.acos(clamp(dot(fromDir, toDir), -1, 1));
  if (angleTotal < 1e-3) return; // already heading roughly the right way — nothing to animate

  let axis = cross(fromDir, toDir);
  if (Math.hypot(axis.x, axis.y, axis.z) < 1e-6) {
    // fromDir/toDir are (near-)opposite, so their cross product is degenerate — fall back to any
    // axis perpendicular to fromDir, same fallback pattern as pickMissAimedFlightDir's side vector.
    axis = cross(fromDir, { x: 0, y: 1, z: 0 });
    if (Math.hypot(axis.x, axis.y, axis.z) < 1e-6) axis = cross(fromDir, { x: 1, y: 0, z: 0 });
  }
  axis = normalize(axis);

  // baseSpeed MUST be the raw cruise speed, not read off flightSpeed (enemy.vel's current magnitude
  // already has DRIFT_ROLL_TUNING.boostSpeedMult baked in from computeHelixVelocity) — see
  // DriftTurnState.baseSpeed's doc comment for why re-deriving it from a boosted value compounds.
  const baseSpeed = drift.helix?.baseSpeed ?? flightSpeed;
  const turn: DriftTurnState = {
    axis, angleTotal, fromDir,
    speed: baseSpeed * DRIFT_ROLL_TUNING.boostSpeedMult,
    baseSpeed,
    elapsed: 0,
    duration: TURN_TUNING.duration,
    rollTurns: randRange(TURN_TUNING.minRollTurns, TURN_TUNING.maxRollTurns)
  };
  drift.turn = turn;
  // the cruise corkscrew (helix) is superseded by the turn's own continuous roll below (turn.rollTurns)
  // — clear it so a stale angle/frame doesn't carry into the next cruise segment once the turn finishes.
  drift.helix = undefined;
}

// Advances an in-progress turn-around by dt: sweeps the heading along its recorded great-circle arc
// (eased) while continuously spinning the hull (linear in time, for a steady roll rate) — then
// integrates position along the current (curving) heading, same as normal ballistic flight. Also
// applies the SAME full up-strafe corkscrew the cruise segment uses (see DRIFT_ROLL_TUNING.
// helixStrafeSpeedMps) against the CURRENT (sweeping) heading's own right/up frame — rolling never
// goes without upstrafe, not even during the reversal, no exceptions.
function advanceDriftTurn(enemy: EnemyShip, drift: NonNullable<EnemyShip['drift']>, dt: number): void {
  const turn = drift.turn;
  if (!turn) return;
  turn.elapsed = Math.min(turn.duration, turn.elapsed + dt);
  const t = turn.elapsed / turn.duration;

  const heading = rotateAboutAxis(turn.fromDir, turn.axis, turn.angleTotal * smoothstep(t));
  const rollAngle = turn.rollTurns * Math.PI * 2 * t;

  let right = cross(heading, { x: 0, y: 1, z: 0 });
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = cross(heading, { x: 1, y: 0, z: 0 });
  right = normalize(right);
  const up = normalize(cross(heading, right));
  const tangential = DRIFT_ROLL_TUNING.helixStrafeSpeedMps;
  const cosR = Math.cos(rollAngle), sinR = Math.sin(rollAngle);
  enemy.vel = {
    x: heading.x * turn.speed + tangential * (-sinR * up.x + cosR * right.x),
    y: heading.y * turn.speed + tangential * (-sinR * up.y + cosR * right.y),
    z: heading.z * turn.speed + tangential * (-sinR * up.z + cosR * right.z)
  };
  enemy.pos.x += enemy.vel.x * dt;
  enemy.pos.y += enemy.vel.y * dt;
  enemy.pos.z += enemy.vel.z * dt;

  enemy.quat = quatMultiply(lookAtQuat(heading), rollQuat(rollAngle));

  if (turn.elapsed >= turn.duration) {
    drift.turn = undefined;
    // Build the next cruise segment's helix directly from the preserved RAW baseSpeed (not from
    // enemy.vel, which is turn.speed = baseSpeed*boostSpeedMult) — see DriftTurnState.baseSpeed's
    // doc comment for why deriving it from the boosted value here would compound the boost.
    drift.helix = spawnHelix(heading, turn.baseSpeed);
  }
}

// Continuous corkscrew flight (see DRIFT_ROLL_TUNING) — never a straight line, orientation banks to
// follow the curve. Once it's flown turnDist past the player it banks into a long reversal (see
// startDriftTurn) instead of despawning, so the same drone keeps making passes rather than popping
// in and out. `isBeingFiredAt` is precomputed once per frame by the caller (scenarios/runtime.ts) —
// true only for the single drone that is BOTH the player's active soft-locked target and would
// actually be hit if the player's shot (fired this exact tick) landed — the gate for the aggressive
// roll escalation (see isAggressiveEscalation).
export function driftThink(
  enemy: EnemyShip, player: ShipBody, dt: number, aggressiveness: number = 0.5, isBeingFiredAt: boolean = false
): void {
  const drift = enemy.drift;
  if (drift?.turn) {
    advanceDriftTurn(enemy, drift, dt);
    return;
  }

  if (drift) {
    if (!drift.helix) {
      const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z) || 1;
      const baseDir = { x: enemy.vel.x / speed, y: enemy.vel.y / speed, z: enemy.vel.z / speed };
      drift.helix = spawnHelix(baseDir, speed);
    }
    const helix = drift.helix;
    const escalated = isAggressiveEscalation(helix, enemy, player, isBeingFiredAt);
    helix.aggressiveTimer = escalated
      ? DRIFT_ROLL_TUNING.aggressiveHoldSec
      : Math.max(0, helix.aggressiveTimer - dt);
    const targetFraction = helix.aggressiveTimer > 0
      ? DRIFT_ROLL_TUNING.aggressiveFraction
      : DRIFT_ROLL_TUNING.normalFraction;
    // ease toward the target rate rather than snapping — see rollFractionEaseRate's doc comment
    const ease = 1 - Math.exp(-DRIFT_ROLL_TUNING.rollFractionEaseRate * dt);
    helix.rollFraction += (targetFraction - helix.rollFraction) * ease;
    helix.angle = (helix.angle + rollRateMax() * helix.rollFraction * dt) % (Math.PI * 2);
    enemy.vel = computeHelixVelocity(helix);
  }

  enemy.pos = {
    x: enemy.pos.x + enemy.vel.x * dt,
    y: enemy.pos.y + enemy.vel.y * dt,
    z: enemy.pos.z + enemy.vel.z * dt
  };
  // nose stays on the segment's fixed base heading (NOT the instantaneous velocity, which also
  // includes the strafe/tangential component) — a real strafe keeps the nose roughly forward while
  // the hull rolls and slides sideways, rather than banking the nose to chase the drift; this is also
  // what makes the corkscrew read as genuine upstrafe instead of just "the flight path curves a bit"
  enemy.quat = drift?.helix
    ? quatMultiply(lookAtQuat(drift.helix.baseDir), rollQuat(drift.helix.angle))
    : lookAtQuat(enemy.vel);

  const toDrone = { x: enemy.pos.x - player.pos.x, y: enemy.pos.y - player.pos.y, z: enemy.pos.z - player.pos.z };
  const dist = Math.hypot(toDrone.x, toDrone.y, toDrone.z);
  // only trigger while actually flying away from the player — otherwise a drone that just finished
  // a turn-around (now heading back in, but still farther than turnDist) would immediately bank
  // into another one every tick until it closes the distance.
  const movingAway = dot(enemy.vel, toDrone) > 0;
  if (dist > DRIFTER_TUNING.turnDist && movingAway && drift) {
    startDriftTurn(enemy, drift, player, aggressiveness);
  }
}
