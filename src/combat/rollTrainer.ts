import type { Quat, Vec3 } from '../core/types';
import type { ShipBody } from '../core/world';
import { computeAxes, quatMultiply, quatNormalize } from '../math/quaternion';

// ============================================================================================
// "Roll Trainer" — a standalone practice drill for exact-roll control, same "fully additive,
// deliberately not built on EnemyShip" philosophy as combat/pipTrainer.ts: no AI, no health, no
// hit detection. A translucent ghost hull hovers ROLL_TRAINER_STANDOFF_M ahead of the player,
// nose pointed back at them (render/renderer.ts positions/orients it directly from this module's
// state, no EnemyShip involved), and physically rolls from level into the target bank angle over
// time rather than snapping there. The player rolls their own ship to match it before the
// per-attempt time limit; how far they land from the target (and how fast they stopped rolling)
// scores the attempt, then the next target is picked and the ghost resets and re-rolls.
//
// The ghost's displayed bank is a WORLD-SPACE up vector (rollQuatFromStart applied to the
// player's own orientation frozen at challenge start), not a rotation of the ghost's own local
// frame — since the ghost faces backward at the player, rotating around ITS OWN forward would
// mirror the apparent tilt left/right. A world-space target up has no such mirroring: whichever
// way the ghost faces, the player's own "up" needs to swing onto that same world direction.
//
// Roll SCORING is tracked separately, by integrating the player's own angVel.roll (radians/sec
// about the ship's local forward axis — see math/quaternion.ts's integrateOrientation) rather
// than by diffing quaternions, so incidental pitch/yaw drift during the maneuver never counts as
// roll error — this is a roll-only drill, and the ghost's visual is purely a reference, not part
// of the scoring path.
// ============================================================================================

export const ROLL_TRAINER_STANDOFF_M = 50;

// Below this |angVel.roll| (rad/s), the ship is considered "not rolling."
const ROLL_ACTIVE_THRESHOLD_RAD = 0.05;
// A stop is only scored once the player has actually rolled a meaningful amount — filters out a
// stop-the-instant-the-challenge-starts false trigger and pure stick jitter.
const MIN_ROLL_TO_COUNT_DEG = 5;
// Arcade-style discrete result tiers, closest-first: within PERFECT_TOLERANCE_DEG of the target
// scores full credit and bumps the speed multiplier; within GOOD_TOLERANCE_DEG scores half credit
// (multiplier unchanged); anything wider — or a timeout — scores nothing.
export const PERFECT_TOLERANCE_DEG = 3;
export const GOOD_TOLERANCE_DEG = 10;
const GOOD_CREDIT = 0.5;

export type RollTrainerResultTier = 'perfect' | 'good' | 'failed';

const ROLL_DEGREE_CHOICES = [45, 90, 180, 270] as const;

export interface RollTrainerOptions {
  allowLeft: boolean;
  allowRight: boolean;
  randomDegree: boolean; // when true, ignores allow45/90/180/270 and picks any angle in (0, 360]
  allow45: boolean;
  allow90: boolean;
  allow180: boolean;
  allow270: boolean;
  matchTimeSec: number;     // seconds allowed to complete (and stop) each roll challenge
  speedStart: number;       // initial score multiplier; +1 for every perfect roll, never decreases
  lapTimeSec: number | null; // total drill duration; null = indefinite
}

export const ROLL_TRAINER_DEFAULTS: RollTrainerOptions = {
  allowLeft: true, allowRight: true, randomDegree: false,
  allow45: true, allow90: true, allow180: true, allow270: true,
  matchTimeSec: 4, speedStart: 0, lapTimeSec: 120
};

// Degrees/sec the ghost visually rolls at while demonstrating each challenge — matches the
// player's own ship class so the demo reads as "a real ship rolling," not an arbitrary rate.
function ghostRollRateDegPerSec(player: ShipBody): number {
  return (player.type.maxAngVel.roll * 180) / Math.PI;
}

export interface RollTrainerState {
  opts: RollTrainerOptions;
  startQuat: Quat;         // player's orientation frozen at the start of the CURRENT challenge (render-only reference)
  targetSignedDeg: number; // signed target roll for the current challenge (+ = right, - = left)
  ghostRollDeg: number;    // signed degrees the ghost has visually rolled toward targetSignedDeg so far (render-only)
  rollAccumDeg: number;    // signed degrees the player has rolled since this challenge started
  hasStartedRolling: boolean; // true once |angVel.roll| cleared the active threshold this challenge
  challengeTimer: number;  // seconds elapsed in the current challenge
  speedMultiplier: number; // current score multiplier
  reps: number;
  perfectReps: number;
  goodReps: number;
  score: number;
  elapsedSec: number;
  // Bumped every time a rep finishes (any tier) — render/HUD code watches this to fire a one-shot
  // "PERFECT!/GOOD/FAILED" popup near the ghost without needing its own timer here.
  resultSeq: number;
  lastResultDeg: number | null;  // achieved roll of the most recently finished rep (null = timed out)
  lastResultTier: RollTrainerResultTier | null; // null before the first rep finishes
  outcome: 'active' | 'won';
}

function rollQuatFromStart(q: Quat, signedDeg: number): Quat {
  const rad = (signedDeg * Math.PI) / 180;
  const delta: Quat = { w: Math.cos(rad / 2), x: 0, y: 0, z: Math.sin(rad / 2) };
  return quatNormalize(quatMultiply(q, delta));
}

function pickChallenge(opts: RollTrainerOptions): number {
  const dirs: number[] = [];
  if (opts.allowLeft) dirs.push(-1);
  if (opts.allowRight) dirs.push(1);
  const dirSign = dirs.length > 0 ? dirs[Math.floor(Math.random() * dirs.length)] : (Math.random() < 0.5 ? -1 : 1);

  let deg: number;
  if (opts.randomDegree) {
    deg = Math.random() * 360;
  } else {
    const choices = ROLL_DEGREE_CHOICES.filter((_, i) =>
      [opts.allow45, opts.allow90, opts.allow180, opts.allow270][i]
    );
    deg = choices.length > 0 ? choices[Math.floor(Math.random() * choices.length)] : 90;
  }
  return dirSign * deg;
}

function startChallenge(state: RollTrainerState, player: ShipBody): void {
  state.targetSignedDeg = pickChallenge(state.opts);
  state.startQuat = { ...player.quat };
  state.ghostRollDeg = 0;
  state.rollAccumDeg = 0;
  state.hasStartedRolling = false;
  state.challengeTimer = 0;
}

export function startRollTrainer(player: ShipBody, opts: RollTrainerOptions): RollTrainerState {
  const state: RollTrainerState = {
    opts,
    startQuat: { w: 1, x: 0, y: 0, z: 0 },
    targetSignedDeg: 0,
    ghostRollDeg: 0,
    rollAccumDeg: 0,
    hasStartedRolling: false,
    challengeTimer: 0,
    speedMultiplier: opts.speedStart,
    reps: 0,
    perfectReps: 0,
    goodReps: 0,
    score: 0,
    elapsedSec: 0,
    resultSeq: 0,
    lastResultDeg: null,
    lastResultTier: null,
    outcome: 'active'
  };
  startChallenge(state, player);
  return state;
}

// The ghost's current world-space "target up" — see this module's header comment on why this is
// a world vector rather than a rotation of the ghost's own local frame. render/renderer.ts feeds
// this straight into setObjectBasis alongside the ghost's forward (pointed at the player).
export function getRollTrainerGhostUp(state: RollTrainerState): Vec3 {
  return computeAxes(rollQuatFromStart(state.startQuat, state.ghostRollDeg)).up;
}

function finishChallenge(state: RollTrainerState, timedOut: boolean): void {
  state.reps++;
  const errorDeg = Math.abs(state.rollAccumDeg - state.targetSignedDeg);
  const tier: RollTrainerResultTier = timedOut ? 'failed'
    : errorDeg <= PERFECT_TOLERANCE_DEG ? 'perfect'
    : errorDeg <= GOOD_TOLERANCE_DEG ? 'good'
    : 'failed';

  if (tier === 'perfect') {
    state.score += state.speedMultiplier; // credit at the current (pre-bump) multiplier
    state.perfectReps++;
    state.speedMultiplier += 1;
  } else if (tier === 'good') {
    state.score += GOOD_CREDIT * state.speedMultiplier;
    state.goodReps++;
  }

  state.lastResultDeg = timedOut ? null : state.rollAccumDeg;
  state.lastResultTier = tier;
  state.resultSeq++;
}

export function updateRollTrainer(state: RollTrainerState, player: ShipBody, dt: number): void {
  if (state.outcome !== 'active') return;
  state.elapsedSec += dt;
  state.challengeTimer += dt;

  // Physically roll the ghost from level toward the target bank rather than snapping there —
  // clamped so it settles exactly on target and holds once it arrives.
  const dir = Math.sign(state.targetSignedDeg) || 1;
  const step = dir * ghostRollRateDegPerSec(player) * dt;
  state.ghostRollDeg = Math.abs(state.ghostRollDeg + step) >= Math.abs(state.targetSignedDeg)
    ? state.targetSignedDeg
    : state.ghostRollDeg + step;

  const rollRate = player.angVel.roll; // rad/s, local forward axis
  state.rollAccumDeg += (rollRate * dt * 180) / Math.PI;
  if (Math.abs(rollRate) > ROLL_ACTIVE_THRESHOLD_RAD) state.hasStartedRolling = true;

  const stopped = state.hasStartedRolling
    && Math.abs(rollRate) <= ROLL_ACTIVE_THRESHOLD_RAD
    && Math.abs(state.rollAccumDeg) >= MIN_ROLL_TO_COUNT_DEG;
  const timedOut = !stopped && state.challengeTimer >= state.opts.matchTimeSec;

  if (stopped) {
    finishChallenge(state, false);
    startChallenge(state, player);
  } else if (timedOut) {
    finishChallenge(state, true);
    startChallenge(state, player);
  }

  if (state.opts.lapTimeSec !== null && state.elapsedSec >= state.opts.lapTimeSec) {
    state.outcome = 'won';
  }
}
