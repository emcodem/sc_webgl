import type { AngularState, HelixState, OrbitState, Quat, Vec3 } from '../../core/types';
import type { EnemyShip, ShipBody } from '../../core/world';
import type { FlightInputs } from '../../physics/flightModel';
import { computeAxes, lookAtQuat } from '../../math/quaternion';
import { clamp, cross, dot, normalize } from '../../math/vec';
import { steeringToward } from '../enemyAI';
import { wouldHitIfFiredNow } from '../leadIndicator';
import { WEAPON } from '../weapons';

// ===========================================================================
// OrbiterAI / DrifterAI — practice targets for the Aim Training drill (see scenarios/definitions.ts).
// Neither ever fires a weapon; scenarios/runtime.ts's dispatch for these two behaviors has no firing
// logic at all. Both respawn a short while after being shot down so the target pool stays full for
// the whole drill instead of thinning out (respawn also clears any hit reaction below, so a fresh
// spawn is harmless again until it's shot at). Orbit/drift flight itself was ported verbatim from
// the original project's combat/enemyAI.ts.
//
// Neither is purely passive once actually hit, though: see HitReactionState (core/types.ts) and
// triggerHitReaction/hitReactionThink at the bottom of this file for the shared counter-attack
// sequence (boosted break -> face the attacker -> dodge/close) both behaviors drop into for the rest
// of that life the instant a shot lands.
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
  turnDist: 500,                         // meters — triggers a turn-around (retargets HelixState.baseDir;
                                          // see driftThink) instead of letting it fly off and get
                                          // recycled out of sight
  respawnDelaySec: 1.0,
  steerGain: 4  // proportional gain steering the nose (pitch/yaw only — see driftThink) toward
                // HelixState.baseDir. Gentle: the nose is usually already close to on-target except
                // right after a turn-around retarget, where the real flight model's own turn-rate
                // lag (not a scripted sweep) is what now produces the reversal's visible arc
};

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
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

// A drifter's cruise pass is never a straight line — it's ALWAYS flying a real, physics-driven
// barrel roll: continuous roll input (never a full 100% snap-roll — a gentle 25% normally,
// escalating to a hard 75% only while genuinely under threat, see isAggressiveEscalation) PLUS full
// boosted forward throttle PLUS a full up-strafe held in the ship's own LOCAL frame. Once
// integrateFlight drives that (see driftThink below), the corkscrew falls out on its own: as the
// real roll spins the hull, the fixed-local-frame up-strafe thrust sweeps around in world space right
// along with it, so the flight path corkscrews sideways around the nose heading exactly like the
// evasive/fighter AIs' "bank and push through the strong thruster" break maneuver (see
// combat/ai/evasiveAI.ts's top doc comment), just banked continuously instead of at one fixed angle.
// This replaced an earlier version that hand-computed pos/vel/quat every tick from a closed-form
// corkscrew formula (with a separately scripted great-circle turn-around) — same mistake the orbiter
// fix above (see this file's other half) already corrected: no thrust limits, no turn-rate lag, no
// momentum, so the roll read as scripted rather than flown, and the turn-around's end handed off to a
// freshly-reset roll angle/rate with a visible snap. Driving both axes through the real flight model
// means: real spool-up/release on roll (no more snap), real speed caps/drag on the boosted forward
// thrust, and a turn-around that's just a nose retarget re-approached under the ship's own real
// turn-rate lag (via steeringToward) rather than a separately scripted sweep.
const DRIFT_ROLL_TUNING = {
  normalFraction: 0.25,       // default continuous roll INPUT, as a fraction of full roll deflection
  aggressiveFraction: 0.75,   // roll input while the escalation conditions below hold (or recently did)
                              // — the ONLY two values rollFraction ever targets; it never reaches 1.0
  rollFractionEaseRate: 0.7,  // 1/s — how fast the CURRENT roll fraction chases its target (see
                              // HelixState.rollFraction's doc comment). Switching rate instantly
                              // between 0.25 and 0.75 read as a jarring one-tick "whip roll"; this
                              // eases the COMMANDED fraction over a couple of seconds on top of
                              // whatever spin-up/release lag the flight model's own roll model adds
  aggressiveHoldSec: 1.0,     // seconds the aggressive roll rate lingers after the escalation
                              // conditions last held, so it doesn't flicker frame-to-frame with the
                              // player's own fire-rate cadence
  aggressiveRangeM: 1000,     // meters — escalation only considered this close to the player
  aggressiveAimCos: 0.9063    // cos(25deg) — how tightly the drone's OWN heading must point at the
                              // player to count as "flying directly to the player" (condition B below)
};

function spawnHelix(baseDir: Vec3): HelixState {
  return { baseDir, rollSign: Math.random() < 0.5 ? -1 : 1, aggressiveTimer: 0, rollFraction: DRIFT_ROLL_TUNING.normalFraction };
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

export interface DriftDecision {
  inputs: FlightInputs;
  boostRequested: boolean;
}

// Flies the drone's corkscrew cruise pass (see DRIFT_ROLL_TUNING's doc comment) through the real
// flight model. Nose steering is PITCH/YAW ONLY, toward the pass's fixed baseDir — deliberately not
// steeringToward's roll output too, since that would level the bank back toward baseDir's own default
// "up" every tick and fight the dedicated continuous roll command below. Once it's flown turnDist past
// the player it retargets baseDir to a fresh aim-back-at-the-player heading (see
// pickMissAimedFlightDir) instead of despawning — the nose steering above then re-approaches it under
// the ship's own real turn-rate lag, which IS the reversal maneuver now (no separate scripted turn
// state). `isBeingFiredAt` is precomputed once per frame by the caller (scenarios/runtime.ts) — true
// only for the single drone that is BOTH the player's active soft-locked target and would actually be
// hit if the player's shot (fired this exact tick) landed — the gate for the aggressive roll
// escalation (see isAggressiveEscalation).
export function driftThink(
  enemy: EnemyShip, player: ShipBody, dt: number, aggressiveness: number = 0.5, isBeingFiredAt: boolean = false
): DriftDecision {
  const idleInputs: FlightInputs = { throttle: 0, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false };
  const drift = enemy.drift;
  if (!drift) return { inputs: idleInputs, boostRequested: false };

  if (!drift.helix) {
    const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z) || 1;
    const baseDir = { x: enemy.vel.x / speed, y: enemy.vel.y / speed, z: enemy.vel.z / speed };
    drift.helix = spawnHelix(baseDir);
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

  const steer = steeringToward(enemy.quat, helix.baseDir, DRIFTER_TUNING.steerGain);

  const toDrone = { x: enemy.pos.x - player.pos.x, y: enemy.pos.y - player.pos.y, z: enemy.pos.z - player.pos.z };
  const dist = Math.hypot(toDrone.x, toDrone.y, toDrone.z);
  // only trigger while actually flying away from the player — otherwise a drone that just finished
  // a reversal (now heading back in, but still farther than turnDist) would immediately retarget into
  // another one every tick until it closes the distance.
  const movingAway = dot(enemy.vel, toDrone) > 0;
  if (dist > DRIFTER_TUNING.turnDist && movingAway) {
    helix.baseDir = pickMissAimedFlightDir(enemy.pos, player, aggressiveness);
  }

  return {
    inputs: {
      throttle: 1,
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: helix.rollSign * helix.rollFraction,
      strafeX: 0,
      strafeY: 1,
      brake: false,
      decoupled: false
    },
    // Always boosted: "100% forward acceleration and boost while rolling" is always-on, matching a
    // real evasive/attack pass flown with the afterburner lit rather than as a rare last resort.
    boostRequested: true
  };
}

// ===========================================================================
// Hit reaction — shared by 'orbiter' and 'drifter' (see HitReactionState's doc comment in
// core/types.ts). scenarios/runtime.ts calls triggerHitReaction from resolveHits' onEnemyHit
// callback, then calls hitReactionThink FIRST every tick for any orbiter/drifter that has one —
// hitReactionThink returns null only while no reaction is active, in which case the caller falls
// back to the normal orbiterThink/driftThink for that tick.
// ===========================================================================
export const HIT_REACTION_TUNING = {
  breakMinSec: 2, breakMaxSec: 5,     // random duration of the initial boosted vertical break
  breakRollFraction: 0.25,            // 25% roll input, held the whole break — LEFT (negative), per
                                       // control/pilot.ts's rollLeft/rollRight -> digitalAxis convention
  faceSteerGain: 15,                  // proportional gain for the 'faceAttacker' turn (see
                                       // rollPitchOnlySteer's ROLL_DAMPING/PITCH_DAMPING doc comment
                                       // for why this is moderate, not maxed out — a much higher gain
                                       // saturates the input across the ENTIRE approach and leaves no
                                       // room for the rate-damping term to ever pull it out of
                                       // saturation before reaching zero error, so the ship overshoots
                                       // straight through the target instead of settling on it)
  engageRangeM: 300,        // meters — at/beyond this once engaged, close the distance instead of
                             // dodging (see hitReactionThink)
  approachDistanceM: 100,   // meters — the standoff distance an 'engaged' approach steers toward
  dodgeSpeedCapMps: 100,    // m/s — hard speed ceiling while dodging inside engageRangeM
  dodgeReplanSec: 1.2       // seconds between re-picking the committed dodge strafe bias
};

// The only strafe biases an engaged, in-range drone ever dodges with — up, left, right, or a
// diagonal blend of up with one side. Deliberately excludes down and "hold still": these drones were
// asked to fly up/left/right specifically, and a break maneuver that includes a "do nothing" option
// isn't a break.
const DODGE_STRAFE_DIRS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: -0.7071, y: 0.7071 }, { x: 0.7071, y: 0.7071 }
];

// Called from scenarios/runtime.ts's onEnemyHit whenever a shot actually lands on an enemy —
// (re)starts the break phase for 'orbiter'/'drifter' only (every other behavior already fights back
// on its own terms and has no use for this). Getting hit again mid-reaction restarts the break rather
// than being ignored, same idea as a real pilot flinching harder at a second hit.
export function triggerHitReaction(enemy: EnemyShip): void {
  if (enemy.behavior !== 'orbiter' && enemy.behavior !== 'drifter') return;
  enemy.hitReaction = {
    mode: 'break',
    breakTimer: randRange(HIT_REACTION_TUNING.breakMinSec, HIT_REACTION_TUNING.breakMaxSec),
    dodgeStrafeX: 0,
    dodgeStrafeY: 1,
    dodgeTimer: 0
  };
}

export interface HitReactionDecision {
  inputs: FlightInputs;
  boostRequested: boolean;
}

// The fastest way to point a nose at a target isn't a single combined pitch/yaw/roll turn — it's a
// coordinated ROLL to bring the target into the ship's own vertical (forward/up) plane, plus PITCH
// to close the remaining angle within that plane, using NO YAW at all. This matters specifically on
// Gladius because yaw authority is by far its weakest rotation axis (maxAngVel.yaw 0.91 rad/s vs
// roll's 3.49 and pitch's 1.19 — see physics/ships/gladius.ts), so a naive single quaternion-error
// steer (steeringToward's usual pitch+yaw+roll blend) leans on the slow yaw axis for any lateral
// correction; a real pilot instead banks (fast) and pulls (comparatively fast) instead. Recomputed
// fresh every tick from the CURRENT orientation (not a one-shot planned maneuver, and not sequenced
// into "roll, then separately pitch" phases — both are commanded simultaneously every tick, which
// converges correctly since a pitch input rotates about whatever the CURRENT — continuously rolling —
// right axis is, exactly like a real "roll and pull" performed continuously through the roll).
//
// Works entirely in plain LOCAL-frame dot products (right/up/forward), not quaternion composition —
// an earlier version built the roll target via lookAtQuat(forward, targetDir), i.e. normalize(cross(
// forward, targetDir)); that normalizes a vector whose magnitude is sin(totalAngle), which is
// numerically fine far from the target but degenerates into essentially a random axis once nearly
// converged (small cross product, dominated by float noise once normalized) — producing large,
// erratic roll commands right as the ship approached its target and preventing it from ever actually
// settling (verified: it oscillated indefinitely in testing, never converging). The fix here avoids
// normalizing anything: a=local right offset, b=local up offset, and the roll BEARING atan2(a,b) is
// only ever scaled by radius=hypot(a,b) (see rollFade below) — a plain, bounded quantity that shrinks
// smoothly to 0 right where the bearing itself becomes ill-defined (target near dead-ahead/-astern),
// so roll authority fades out exactly where it would otherwise start flailing, instead of amplifying
// noise the way a normalized axis does.
//
// Sign conventions — verified empirically against integrateFlight directly (a one-tick sim from
// identity, not assumed from the keybind action names, which turned out to be the opposite of what
// their names suggest): positive `pitch` input rotates forward TOWARD +up (i.e. positive pitch is a
// pull/nose-up, not nose-down), and positive `roll` input rotates up toward +right (rollRight, as its
// name suggests — only pitch's naming was misleading). rollBearing = atan2(a,b) is the roll-right
// angle that brings the target's local (a,b) to (0, +radius) — algebraically verified: at that angle,
// b' = a*sin(rollBearing) + b*cos(rollBearing) = (a²+b²)/radius = +radius, i.e. always the "above the
// nose" side, never "below" — so the subsequent pitch is always a fixed-sign PULL (positive/pitch-up),
// regardless of where the target originally sat; never a push-down.
const ROLL_FADE_RADIUS = 0.12; // radius (~= sin(totalAngle), unitless) below which roll authority
                                // fades to 0 — see the doc comment above for why this specific
                                // quantity (not totalAngle directly) is what needs damping
// Below this LATERAL (right-axis) offset, pitch authority ramps back in (see pitchAuthority below).
// Pitch is gated on `a` specifically, NOT on radius/totalAngle: a target that's already purely
// vertical (a=0) needs zero roll and should pitch immediately regardless of how large the total
// angle is, whereas a target that's still mostly lateral (large |a|) needs roll to do the work first
// — issuing full pitch AND full roll at once while |a| is still large fights the roll (pitch rotates
// about a right axis that roll is simultaneously dragging elsewhere), which is what produced
// sustained overshoot oscillation in testing before this gate was added. As roll drives `a` toward 0
// every tick, this ramps pitch in smoothly on its own — no separate phase/state needed.
const PITCH_GATE_RADIUS = 0.3; // ~17 degrees of remaining lateral offset
// Rate-damping (the D in a PD controller) on both axes: roll's own max rate is huge (3.49-4.19
// rad/s), so a proportional-only command saturates at full deflection for a long stretch, builds up
// a lot of angular momentum, and then can't shed it before crossing zero error — it blows straight
// through the target bank angle instead of settling on it (verified: a P-only version oscillated
// indefinitely, overshooting past the target repeatedly, sometimes ending up pointed nearly the
// opposite way). Subtracting a fraction of the CURRENT angular rate anticipates the need to
// decelerate before reaching zero error, same idea as any real closed-loop rate controller.
const ROLL_DAMPING = 1.0;
const PITCH_DAMPING = 2.0;
function rollPitchOnlySteer(
  current: Quat, angVel: AngularState, forward: Vec3, targetDir: Vec3, gain: number
): { pitch: number; roll: number } {
  const { right, up } = computeAxes(current);
  const a = dot(targetDir, right);
  const b = dot(targetDir, up);
  const c = dot(targetDir, forward);
  const radius = Math.hypot(a, b);
  const totalAngle = Math.atan2(radius, c);

  const rollBearing = Math.atan2(a, b);
  const rollFade = clamp(radius / ROLL_FADE_RADIUS, 0, 1);
  const roll = clamp(rollBearing * gain - angVel.roll * ROLL_DAMPING, -1, 1) * rollFade;

  const pitchAuthority = 1 - clamp(Math.abs(a) / PITCH_GATE_RADIUS, 0, 1);
  const pitch = clamp(totalAngle * gain - angVel.pitch * PITCH_DAMPING, -1, 1) * pitchAuthority;

  return { pitch, roll };
}

// Drives one tick of an active hit reaction; returns null if `enemy` has none (the caller should then
// run the normal orbiterThink/driftThink for that tick instead). Three phases in HitReactionState's
// fixed order, never reverted within one life:
//   'break'        — boosted full up-strafe + a steady 25% left roll, no steering at all (the nose
//                    goes wherever momentum/roll carries it — a real startled break isn't aimed) —
//                    for breakTimer's randomized few seconds.
//   'faceAttacker' — pure rotation (no throttle/strafe) at high gain toward the player, using ONLY
//                    roll+pitch (see rollPitchOnlySteer's doc comment — no yaw at all, the ship's
//                    weakest axis), still boosted (boosting raises angular authority/rate too — see
//                    flightModel.ts — so this really is "as fast as the ship can turn"). Advances to
//                    'engaged' the instant a shot fired right now, from the drone's OWN current
//                    forward/pos/vel, would land on the player — the same wouldHitIfFiredNow "green
//                    pip" predicate the player's own PIP color and isBeingFiredAt
//                    (evasiveAI.ts/driftThink) already use, just evaluated in reverse.
//   'engaged'      — permanent for the rest of this life. Beyond engageRangeM: close the distance
//                    (nose + throttle toward the player, standing off at approachDistanceM). Inside
//                    engageRangeM: dodge — steer toward the player while strafing a periodically
//                    re-picked up/left/right(/diagonal) bias, hard-governed under dodgeSpeedCapMps by
//                    braking (not just cutting strafe) the instant speed reaches the cap.
export function hitReactionThink(enemy: EnemyShip, player: ShipBody, dt: number): HitReactionDecision | null {
  const reaction = enemy.hitReaction;
  if (!reaction) return null;

  const toPlayer = { x: player.pos.x - enemy.pos.x, y: player.pos.y - enemy.pos.y, z: player.pos.z - enemy.pos.z };
  const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
  const towardPlayer = dist > 1e-6
    ? { x: toPlayer.x / dist, y: toPlayer.y / dist, z: toPlayer.z / dist }
    : computeAxes(enemy.quat).forward;

  if (reaction.mode === 'break') {
    reaction.breakTimer -= dt;
    if (reaction.breakTimer <= 0) reaction.mode = 'faceAttacker';
    return {
      inputs: {
        throttle: 0, pitch: 0, yaw: 0, roll: -HIT_REACTION_TUNING.breakRollFraction,
        strafeX: 0, strafeY: 1, brake: false, decoupled: false
      },
      boostRequested: true
    };
  }

  if (reaction.mode === 'faceAttacker') {
    const { forward } = computeAxes(enemy.quat);
    const steer = rollPitchOnlySteer(enemy.quat, enemy.angVel, forward, towardPlayer, HIT_REACTION_TUNING.faceSteerGain);
    const locked = wouldHitIfFiredNow(
      enemy.pos, enemy.vel, forward, player.pos, player.vel, player.type.hullRadius, WEAPON.muzzleSpeed, WEAPON.lifetime
    );
    if (locked) reaction.mode = 'engaged';
    return {
      inputs: { throttle: 0, pitch: steer.pitch, yaw: 0, roll: steer.roll, strafeX: 0, strafeY: 0, brake: false, decoupled: false },
      boostRequested: true
    };
  }

  // 'engaged'
  if (dist >= HIT_REACTION_TUNING.engageRangeM) {
    const steer = steeringToward(enemy.quat, towardPlayer, ORBITER_STEER_TUNING.steerGain);
    const shortfall = dist - HIT_REACTION_TUNING.approachDistanceM;
    return {
      inputs: {
        throttle: clamp(shortfall / 150, 0.15, 1),
        pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll,
        strafeX: 0, strafeY: 0, brake: false, decoupled: false
      },
      boostRequested: false
    };
  }

  reaction.dodgeTimer -= dt;
  if (reaction.dodgeTimer <= 0) {
    const pick = DODGE_STRAFE_DIRS[Math.floor(Math.random() * DODGE_STRAFE_DIRS.length)];
    reaction.dodgeStrafeX = pick.x;
    reaction.dodgeStrafeY = pick.y;
    reaction.dodgeTimer = HIT_REACTION_TUNING.dodgeReplanSec;
  }
  const steer = steeringToward(enemy.quat, towardPlayer, ORBITER_STEER_TUNING.steerGain);
  const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
  const overCap = speed >= HIT_REACTION_TUNING.dodgeSpeedCapMps;
  return {
    inputs: {
      throttle: 0,
      pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll,
      strafeX: overCap ? 0 : reaction.dodgeStrafeX,
      strafeY: overCap ? 0 : reaction.dodgeStrafeY,
      // the speed cap is enforced by braking, not by merely withholding further strafe thrust — a
      // dodge already coasting above the cap (residual momentum from the approach/break phases)
      // needs active deceleration to actually come back under it, not just a stop to further gain.
      brake: overCap,
      decoupled: false
    },
    boostRequested: false
  };
}
