import type { FighterAIMemory, FighterTuning, Quat, Vec3 } from '../core/types';
import type { EnemyShip, ShipBody } from '../core/world';
import type { FlightInputs } from '../physics/flightModel';
import { computeAxes, lookAtQuat, quatMultiply } from '../math/quaternion';
import { clamp, normalize } from '../math/vec';
import { computeLeadPoint } from './leadIndicator';
import { WEAPON } from './weapons';

// ===========================================================================
// FighterAI — a Newtonian dogfighter, ported from the original project's combat/enemyAI.ts. It
// flies the exact same RCS thrust model as the player (physics/flightModel.ts) and runs a small
// state machine so it behaves like it's actually dogfighting rather than just tracking:
//
//   close      — too far to fight; burn straight at the player to close the gap
//   engage     — in the fight; hold a stand-off range and take deflection shots via computeLeadPoint
//   reposition — bad angle to the target; extend and loop back instead of an instant reversal
//   evade      — the player is on our six, close, and boresighted; jink off-axis and burn away
//
// Steering is a proportional controller on the quaternion error between current and desired
// orientation — its vector part is, by construction, expressed in the same body-frame
// (pitch=x, yaw=y, roll=z) convention integrateOrientation uses for angVel, so it drops straight in
// as stick input.
//
// All of the difficulty is data (FighterTuning), not code — a harder/easier opponent later is just
// another preset, not new logic. Only one preset (ACE) is wired up for now; ROOKIE etc. can be
// added the moment a second difficulty/ship type is needed.
// ===========================================================================

export const FIGHTER_TUNING_ACE: FighterTuning = {
  steerGain: 7,
  engageRange: 450,
  engageBand: 120,
  closeRange: 1300,
  fireRange: 900,
  fireLateralTolerance: 10,
  overshootAngleRad: 2.7,        // ~155 degrees — only extends on a near-total reversal
  repositionExtendBias: 0.3,     // prioritizes turning back over running
  repositionBoost: true,
  threatRange: 700,
  threatConeRad: 0.22,           // ~13 degrees — only bails when precisely boresighted
  evadeMinSeconds: 1.2,
  modeCommitSeconds: 1.0,
  weaveFreq: 2.2
};

// Hesitant, long-range opponent: bails into a wide extend at the first bad angle, needs a clean
// setup to risk firing, and spooks easily. Pair with a physically slower-turning ship type (see
// scenarios/definitions.ts's ROOKIE_GLADIUS) for the full "rookie" effect.
export const FIGHTER_TUNING_ROOKIE: FighterTuning = {
  steerGain: 3,
  engageRange: 800,
  engageBand: 220,
  closeRange: 1300,
  fireRange: 800,
  fireLateralTolerance: 6,        // needs a much cleaner shot before it'll pull the trigger
  overshootAngleRad: 0.9,         // ~52 degrees — bails into reposition easily
  repositionExtendBias: 0.85,     // commits hard to running before circling back
  repositionBoost: true,
  threatRange: 1000,
  threatConeRad: 0.4,             // ~23 degrees — spooked by anything roughly pointed its way
  evadeMinSeconds: 3.5,
  modeCommitSeconds: 2.0,
  weaveFreq: 1.2
};

export interface FighterDecision {
  inputs: FlightInputs;
  boostRequested: boolean; // resolved against the boost meter by the caller (physics/flightModel.ts)
  wantsToFire: boolean;    // true only while in 'engage' mode — see canFire for the actual aim gate
  aimDir: Vec3;            // world-space direction this tick's gun solution is aiming at
}

export function spawnFighterAI(tuning: FighterTuning = FIGHTER_TUNING_ACE): FighterAIMemory {
  return { mode: 'close', modeTimer: 0, clock: 0, jinkSeed: Math.random() * 1000, tuning };
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(dot);
}

// Whether `forward` is aimed precisely enough at `aimDir`, at `dist` meters, to actually land a
// hit — gates on the *lateral miss distance* the current angular error implies at range, rather
// than a fixed angular cone.
export function canFireWithinTolerance(
  forward: Vec3,
  aimDir: Vec3,
  dist: number,
  fireRange: number,
  fireLateralTolerance: number
): boolean {
  if (dist > fireRange) return false;
  return dist * Math.tan(angleBetween(forward, aimDir)) <= fireLateralTolerance;
}

export function canFire(forward: Vec3, aimDir: Vec3, dist: number, tuning: FighterTuning): boolean {
  return canFireWithinTolerance(forward, aimDir, dist, tuning.fireRange, tuning.fireLateralTolerance);
}

// Proportional steering: how hard to push pitch/yaw/roll to turn `current` toward facing `dir`.
// `upHint` defaults to lookAtQuat's own default (world-up) — pass a specific up vector (e.g. the
// player's own up axis) to also converge the bank angle toward that instead, see evasiveThink.
export function steeringToward(
  current: Quat, dir: Vec3, gain: number, upHint?: Vec3
): { pitch: number; yaw: number; roll: number } {
  const target = upHint ? lookAtQuat(dir, upHint) : lookAtQuat(dir);
  const qConj: Quat = { w: current.w, x: -current.x, y: -current.y, z: -current.z };
  let rel = quatMultiply(qConj, target);
  if (rel.w < 0) rel = { w: -rel.w, x: -rel.x, y: -rel.y, z: -rel.z }; // shortest-path rotation
  return {
    pitch: clamp(rel.x * gain, -1, 1),
    yaw: clamp(rel.y * gain, -1, 1),
    roll: clamp(rel.z * gain, -1, 1)
  };
}

export function think(enemy: EnemyShip, ai: FighterAIMemory, player: ShipBody, dt: number): FighterDecision {
  const tuning = ai.tuning;
  ai.clock += dt;

  const toPlayer: Vec3 = {
    x: player.pos.x - enemy.pos.x,
    y: player.pos.y - enemy.pos.y,
    z: player.pos.z - enemy.pos.z
  };
  const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
  const toPlayerDir = normalize(toPlayer);

  const { forward: enemyForward } = computeAxes(enemy.quat);
  const { forward: playerForward } = computeAxes(player.quat);

  // is the player on our six, close, and boresighted? — triggers evasive maneuvering. Requiring
  // "behind us" (not just "pointed at us") matters: a head-on merge pass also has the player
  // pointed roughly at us, but that's a mutual gun pass, not a one-sided threat worth breaking off for.
  const toEnemyDir: Vec3 = { x: -toPlayerDir.x, y: -toPlayerDir.y, z: -toPlayerDir.z };
  const playerAimAngle = angleBetween(playerForward, toEnemyDir);
  const playerIsAstern = angleBetween(enemyForward, toPlayerDir) > Math.PI * 0.6; // ~108 degrees
  const threatened = dist < tuning.threatRange && playerAimAngle < tuning.threatConeRad && playerIsAstern;

  // lead point for our own gun solution — reused as "which way to point to actually hit it"
  const lead = computeLeadPoint(enemy.pos, enemy.vel, player.pos, player.vel, WEAPON.muzzleSpeed);
  const aimDir = lead
    ? normalize({ x: lead.x - enemy.pos.x, y: lead.y - enemy.pos.y, z: lead.z - enemy.pos.z })
    : toPlayerDir;
  const aimAngle = angleBetween(enemyForward, aimDir);

  // ---- state machine ----
  // ai.modeTimer gates involuntary overrides of the current mode — without a floor here, a player
  // simply holding station on our six keeps `threatened` true every frame and this ship would flee
  // indefinitely. Committing to whatever evade hands off to for a minimum window guarantees it
  // actually gets a chance to turn and fight back.
  if (ai.modeTimer > 0) ai.modeTimer -= dt;

  if (ai.mode === 'evade') {
    if (ai.modeTimer <= 0) {
      ai.mode = dist > tuning.closeRange ? 'close' : 'reposition';
      ai.modeTimer = tuning.modeCommitSeconds;
    }
  } else if (threatened && ai.modeTimer <= 0) {
    ai.mode = 'evade';
    ai.modeTimer = tuning.evadeMinSeconds;
  } else if (ai.modeTimer <= 0) {
    const next = dist > tuning.closeRange
      ? 'close'
      : aimAngle > tuning.overshootAngleRad ? 'reposition' : 'engage';
    if (next !== ai.mode) ai.modeTimer = tuning.modeCommitSeconds;
    ai.mode = next;
  }

  let steerDir: Vec3;
  let throttle = 1;
  let boostRequested = false;
  let brake = false;
  let strafeX = 0, strafeY = 0;
  let wantsToFire = false;

  switch (ai.mode) {
    case 'close':
      steerDir = toPlayerDir;
      throttle = 1;
      boostRequested = dist > tuning.closeRange * 1.4;
      break;

    case 'reposition': {
      const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
      const extendDir = speed > 1 ? normalize(enemy.vel) : enemyForward;
      const bias = tuning.repositionExtendBias;
      steerDir = normalize({
        x: extendDir.x * bias + toPlayerDir.x * (1 - bias),
        y: extendDir.y * bias + toPlayerDir.y * (1 - bias),
        z: extendDir.z * bias + toPlayerDir.z * (1 - bias)
      });
      throttle = 1;
      boostRequested = tuning.repositionBoost;
      break;
    }

    case 'evade': {
      const jinkYaw = Math.sin(ai.clock * tuning.weaveFreq + ai.jinkSeed) > 0 ? 1 : -1;
      const away: Vec3 = { x: -toPlayerDir.x, y: -toPlayerDir.y, z: -toPlayerDir.z };
      const { right: enemyRight, up: enemyUp } = computeAxes(enemy.quat);
      steerDir = normalize({
        x: away.x + enemyRight.x * jinkYaw * 0.6,
        y: away.y + enemyUp.y * 0.3,
        z: away.z + enemyRight.z * jinkYaw * 0.6
      });
      throttle = 1;
      boostRequested = true;
      strafeX = jinkYaw * Math.sin(ai.clock * tuning.weaveFreq * 1.3 + ai.jinkSeed);
      strafeY = Math.cos(ai.clock * tuning.weaveFreq * 0.9 + ai.jinkSeed) * 0.6;
      break;
    }

    case 'engage':
    default: {
      steerDir = aimDir;
      const rangeError = dist - tuning.engageRange;
      throttle = Math.abs(rangeError) <= tuning.engageBand
        ? clamp(rangeError / tuning.engageBand, -1, 1) * 0.3
        : clamp(rangeError / tuning.closeRange, -1, 1);
      brake = rangeError < -tuning.engageBand * 1.5;
      strafeX = Math.sin(ai.clock * tuning.weaveFreq + ai.jinkSeed) * 0.35;
      strafeY = Math.cos(ai.clock * tuning.weaveFreq * 0.7 + ai.jinkSeed) * 0.2;
      wantsToFire = true; // actual aim precision is re-checked post-rotation via canFire
      break;
    }
  }

  const steer = steeringToward(enemy.quat, steerDir, tuning.steerGain);

  return {
    inputs: {
      throttle,
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      strafeX,
      strafeY,
      brake,
      decoupled: false
    },
    boostRequested,
    wantsToFire,
    aimDir
  };
}
