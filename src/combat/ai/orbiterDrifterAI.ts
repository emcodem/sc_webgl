import type { DriftTurnState, Quat, Vec3 } from '../../core/types';
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
const BARREL_ROLL_TRIGGER_CHANCE_PER_SEC = 0.08; // ~once every dozen-ish seconds of eligible flight
const BARREL_ROLL_COOLDOWN = 4;                // seconds before another roll may trigger
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
  const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z) || 1;
  const fromDir = { x: enemy.vel.x / speed, y: enemy.vel.y / speed, z: enemy.vel.z / speed };
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

  const turn: DriftTurnState = {
    axis, angleTotal, fromDir, speed,
    elapsed: 0,
    duration: TURN_TUNING.duration,
    rollTurns: randRange(TURN_TUNING.minRollTurns, TURN_TUNING.maxRollTurns)
  };
  drift.turn = turn;
  // the incidental cosmetic roll (advanceBarrelRoll) is superseded by the turn's own continuous
  // roll below — clear it so the two don't stack once the turn finishes. rollOffsetPrev is the
  // corkscrew displacement currently baked into enemy.pos (applied incrementally tick-to-tick), so
  // unwind it first — otherwise interrupting a mid-roll turn strands the drone up to
  // BARREL_ROLL_RADIUS off its true flight path for good.
  if (drift.rollOffsetPrev) {
    enemy.pos.x -= drift.rollOffsetPrev.x;
    enemy.pos.y -= drift.rollOffsetPrev.y;
    enemy.pos.z -= drift.rollOffsetPrev.z;
  }
  drift.rollTimer = 0;
  drift.rollOffsetPrev = undefined;
}

// Advances an in-progress turn-around by dt: sweeps the heading along its recorded great-circle arc
// (eased) while continuously spinning the hull (linear in time, for a steady roll rate) — then
// integrates position along the current (curving) heading, same as normal ballistic flight.
function advanceDriftTurn(enemy: EnemyShip, drift: NonNullable<EnemyShip['drift']>, dt: number): void {
  const turn = drift.turn;
  if (!turn) return;
  turn.elapsed = Math.min(turn.duration, turn.elapsed + dt);
  const t = turn.elapsed / turn.duration;

  const heading = rotateAboutAxis(turn.fromDir, turn.axis, turn.angleTotal * smoothstep(t));
  enemy.vel = { x: heading.x * turn.speed, y: heading.y * turn.speed, z: heading.z * turn.speed };
  enemy.pos.x += enemy.vel.x * dt;
  enemy.pos.y += enemy.vel.y * dt;
  enemy.pos.z += enemy.vel.z * dt;

  const rollAngle = turn.rollTurns * Math.PI * 2 * t;
  enemy.quat = quatMultiply(lookAtQuat(heading), rollQuat(rollAngle));

  if (turn.elapsed >= turn.duration) {
    drift.turn = undefined;
    drift.rollCooldown = BARREL_ROLL_COOLDOWN; // pause the incidental roll right after this big one
  }
}

// Ballistic straight-line flight, no steering — orientation just faces the direction of travel.
// Once it's flown turnDist past the player it banks into a long reversal (see startDriftTurn)
// instead of despawning, so the same drone keeps making passes rather than popping in and out.
export function driftThink(enemy: EnemyShip, player: ShipBody, dt: number, aggressiveness: number = 0.5): void {
  const drift = enemy.drift;
  if (drift?.turn) {
    advanceDriftTurn(enemy, drift, dt);
    return;
  }

  enemy.pos = {
    x: enemy.pos.x + enemy.vel.x * dt,
    y: enemy.pos.y + enemy.vel.y * dt,
    z: enemy.pos.z + enemy.vel.z * dt
  };
  enemy.quat = lookAtQuat(enemy.vel);
  if (drift) {
    const roll = advanceBarrelRoll(drift, computeAxes(enemy.quat), dt);
    if (roll.angle > 0) {
      // pos here is integrated incrementally tick-to-tick (unlike the orbiter's from-scratch
      // recompute), so last tick's offset is already baked in — apply only the delta so the
      // corkscrew doesn't compound on top of itself
      const prev = drift.rollOffsetPrev ?? { x: 0, y: 0, z: 0 };
      enemy.pos.x += roll.offset.x - prev.x;
      enemy.pos.y += roll.offset.y - prev.y;
      enemy.pos.z += roll.offset.z - prev.z;
      drift.rollOffsetPrev = roll.offset;
      enemy.quat = quatMultiply(enemy.quat, rollQuat(roll.angle));
    } else {
      drift.rollOffsetPrev = undefined;
    }
  }

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
