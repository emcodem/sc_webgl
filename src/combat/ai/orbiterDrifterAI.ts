import type { DriftTurnState, HelixState, Quat, Vec3 } from '../../core/types';
import type { EnemyShip, ShipBody } from '../../core/world';
import { computeAxes, lookAtQuat, quatMultiply } from '../../math/quaternion';
import { clamp, cross, dot, normalize, rotateAboutAxis } from '../../math/vec';

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

// Occasional barrel roll, purely cosmetic — a real barrel roll isn't just spinning in place, it's
// holding a constant "up-strafe" while rolling, so as the roll turns that thrust through a full
// circle the flight path corkscrews sideways around the original line of travel before rejoining
// it. We reproduce that kinematically: `offset` traces a circle in the plane perpendicular to the
// direction of travel *at roll-start* (fixed for the whole maneuver, not re-rotated with the
// drone's own spin — re-rotating it would just cancel back out to spinning in place), parameterized
// by the same roll angle used to spin the model, so the corkscrew and the visual roll stay in sync.
// The circle starts and ends at zero offset (cos(0)-1=0, sin(0)=0 ... same at 2π), so it blends
// into and out of the base flight path with no positional pop. Shared by orbiterThink/driftThink
// via their respective (structurally identical) roll fields.
const BARREL_ROLL_DURATION = 1.1;              // seconds for a full 360
const BARREL_ROLL_TRIGGER_CHANCE_PER_SEC = 0.3; // ~once every few seconds of eligible flight
const BARREL_ROLL_COOLDOWN = 2;                // seconds before another roll may trigger
const BARREL_ROLL_RADIUS = 15;                 // meters — lateral sweep of the corkscrew

interface BarrelRollState {
  rollTimer?: number;
  rollCooldown?: number;
  rollAxisRight?: Vec3;
  rollAxisUp?: Vec3;
}

interface BarrelRollResult {
  angle: number;  // radians about the local forward axis to apply this tick — 0 while not rolling
  offset: Vec3;   // world-space corkscrew displacement to apply this tick, on top of the base flight path
}

// Advances a drone's roll state by dt. Mutates `state` in place. `axes` should be the drone's
// current (un-rolled) forward-facing orientation, i.e. computeAxes(lookAtQuat(vel)) — its
// right/up are captured as the corkscrew's fixed reference frame the moment a new roll triggers.
function advanceBarrelRoll(state: BarrelRollState, axes: { right: Vec3; up: Vec3 }, dt: number): BarrelRollResult {
  let rollTimer = state.rollTimer ?? 0;
  let rollCooldown = state.rollCooldown ?? 0;

  if (rollTimer > 0) {
    rollTimer = Math.max(0, rollTimer - dt);
  } else {
    rollCooldown -= dt;
    if (rollCooldown <= 0 && Math.random() < BARREL_ROLL_TRIGGER_CHANCE_PER_SEC * dt) {
      rollTimer = BARREL_ROLL_DURATION;
      rollCooldown = BARREL_ROLL_COOLDOWN;
      state.rollAxisRight = axes.right;
      state.rollAxisUp = axes.up;
    }
  }
  state.rollTimer = rollTimer;
  state.rollCooldown = rollCooldown;

  if (rollTimer <= 0 || !state.rollAxisRight || !state.rollAxisUp) {
    return { angle: 0, offset: { x: 0, y: 0, z: 0 } };
  }
  const angle = (1 - rollTimer / BARREL_ROLL_DURATION) * Math.PI * 2;
  const { rollAxisRight: right, rollAxisUp: up } = state;
  const cosTerm = BARREL_ROLL_RADIUS * (Math.cos(angle) - 1);
  const sinTerm = BARREL_ROLL_RADIUS * Math.sin(angle);
  return {
    angle,
    offset: {
      x: cosTerm * up.x + sinTerm * right.x,
      y: cosTerm * up.y + sinTerm * right.y,
      z: cosTerm * up.z + sinTerm * right.z
    }
  };
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

// Advances the orbit and re-derives pos/vel/quat from it around the (mostly) fixed `orbit.center`
// (set at spawn/respawn — see spawnOrbitState) — NOT the player's live position every tick, so
// flying toward or away from the ring still changes the distance to it within a pass instead of
// the orbit re-centering underneath you and holding you at `radius` forever. The center does ease
// toward the player (see ORBITER_TUNING.centerFollowRate) once the drone strays past leashDistance,
// so a player who wanders off doesn't leave the ring behind arbitrarily far away. vel is the
// analytic derivative of the position formula (the tangential orbit term), not a finite difference,
// so computeLeadPoint gets a real velocity to lead against instead of one frame of jitter.
export function orbiterThink(enemy: EnemyShip, player: ShipBody, dt: number): void {
  const orbit = enemy.orbit;
  if (!orbit) return;

  const distToPlayer = Math.hypot(
    enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z
  );
  if (distToPlayer > ORBITER_TUNING.leashDistance) {
    const t = 1 - Math.exp(-ORBITER_TUNING.centerFollowRate * dt);
    orbit.center.x += (player.pos.x - orbit.center.x) * t;
    orbit.center.y += (player.pos.y - orbit.center.y) * t;
    orbit.center.z += (player.pos.z - orbit.center.z) * t;
  }

  orbit.phase += orbit.angularSpeed * dt;

  const cosP = Math.cos(orbit.phase), sinP = Math.sin(orbit.phase);
  const { center, planeRight: r, planeUp: u, radius, angularSpeed } = orbit;
  enemy.pos = {
    x: center.x + radius * (cosP * r.x + sinP * u.x),
    y: center.y + radius * (cosP * r.y + sinP * u.y),
    z: center.z + radius * (cosP * r.z + sinP * u.z)
  };
  const tangential = radius * angularSpeed;
  enemy.vel = {
    x: tangential * (-sinP * r.x + cosP * u.x),
    y: tangential * (-sinP * r.y + cosP * u.y),
    z: tangential * (-sinP * r.z + cosP * u.z)
  };
  enemy.quat = lookAtQuat(enemy.vel);
  // pos/vel above are fully recomputed from the orbit formula every tick (not integrated), so the
  // corkscrew offset can just be added on top here with no delta-tracking against last tick's value
  const roll = advanceBarrelRoll(orbit, computeAxes(enemy.quat), dt);
  if (roll.angle > 0) {
    enemy.quat = quatMultiply(enemy.quat, rollQuat(roll.angle));
    enemy.pos.x += roll.offset.x;
    enemy.pos.y += roll.offset.y;
    enemy.pos.z += roll.offset.z;
  }
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
// its base heading (constant roll, "holding a constant up-strafe while rolling" — see the old
// BARREL_ROLL doc comment above, same physical idea, just continuous instead of an occasional
// triggered flourish). Roll rate is a fraction of a fixed max rate: a gentle 25% normally, escalating
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
