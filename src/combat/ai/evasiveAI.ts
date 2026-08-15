import type { AngularState, EvasiveAIMemory, Quat, ShipType, Vec3 } from '../../core/types';
import type { EnemyShip, ShipBody } from '../../core/world';
import type { FlightInputs } from '../../physics/flightModel';
import { integrateFlight } from '../../physics/flightModel';
import { computeAxes, rotateVecByQuat } from '../../math/quaternion';
import { clamp, cross, normalize } from '../../math/vec';
import { closestApproachIfFiredNow } from '../leadIndicator';
import { WEAPON } from '../weapons';
import type { FighterDecision } from '../enemyAI';
import { steeringToward } from '../enemyAI';

// ===========================================================================
// EvasivePilotAI — the 'evasive' EnemyShip behavior, used only by the Evasive Pilot drill (see
// scenarios/definitions.ts). This project's own receding-horizon MPC dodge planner, not a verbatim
// port.
//
// 2026-08-15 redesign: earlier versions split this into two mostly-independent halves — a plain,
// always-on velocity-servo for the FORWARD axis (standoff-holding) outside the search entirely, and
// an MPC search over LATERAL/VERTICAL bank angles only. That split was structurally guaranteed to
// read as "flies in one straight line": whenever the forward deficit got large, a 'chase' facing
// hack swung the nose away from the player to put the strongest thruster (main, 201, boosted ~2x) on
// the deficit, and nothing bounded how long that commitment could run beyond an escape-hatch timer —
// a chase that was WORKING could run for seconds, main thrust dominating the comparatively weak
// strafe (145/147) throughout. Multiple band-aids (forcedBreakIntervalSec, chaseStruggleLimitSec,
// chaseMaxDurationSec, a "pass-through" full-throttle merge) each patched one symptom of this while
// introducing a new predictable rhythm, and a headless capture still showed 700+m excursions with a
// moving player even with all of them in place.
//
// The actual fix: put the FORWARD axis under the SAME MPC search as lateral/vertical, and keep the
// nose ALWAYS pointed at the player (aimDir) — a real gun-defensive pilot keeps a firing solution on
// you while jinking, using strafe/retro to hold station, not swinging their whole nose (and guns)
// away to chase with main thrust. Concretely, every replan:
//   1. Builds a candidate set that's a bank direction (6 options at 45° increments around the full
//      circle, including the weak down-leaning ones — a real pilot uses the weak thruster BECAUSE
//      it's unexpected) CROSSED with a forward bias level (close hard / hold / open hard) — 18
//      candidates total, each a full 3-axis velocity bias on top of the standoff-tracking baseline.
//   2. For EACH candidate, clones the drone's current state and forward-simulates its whole
//      trajectory (not just the endpoint) through the SAME real flight model
//      (physics/flightModel.ts's integrateFlight) the whole game runs on.
//   3. Scores each trajectory: the dominant term is predicted hit-miss distance against a
//      TURN-RATE-LIMITED TRACKER model of the player (the player's aim is simulated re-aiming toward
//      the drone's predicted position every substep, not frozen at its current bearing — a static
//      aim assumption is exactly what let "just keep pushing" look safe to a one-shot lookahead),
//      evaluated at its WORST point across the whole trajectory, not just where it ends up. Also
//      rewards ending up with a bias combination substantially DIFFERENT from the currently-committed
//      one (the "jerk" that actually defeats a lead/lag pip), and penalizes drifting far from the
//      standoff point.
//   4. Commits to the winning candidate for a short window (a receding horizon, re-planning often
//      rather than committing to a long unverified maneuver), then repeats. A detected threat forces
//      an immediate replan instead of waiting out the window.
// Orientation is held FIXED for the (short, ~1s) planning horizon, same reasoning as before: a real
// reorientation takes seconds at this ship's turn rate, and the nose is already settling toward
// aimDir in real play, so freezing it for the much shorter planning window is a reasonable
// approximation, not a meaningful source of error.
//
// Nose ALWAYS faces the player (aimDir) — no more chase/watch hysteresis. This means the forward
// axis only ever gets the ship's WEAK retro thrust (63, vs main's 201) when it needs to open range
// (fall back / let the player catch up), same physical limit a real head-on gun duel has: you can't
// out-accelerate away from someone you're also trying to keep your nose on. That's an accepted,
// realistic limitation now, not a bug — it reads as the drone straining to hold station while still
// fighting you, never as it turning tail to run in a straight line.
//
// The AI only ever issues thruster commands through the same realistic flight model as everything
// else, so the actual G-loading and reversal snap the player sees is bounded by real thrust/speed,
// not faked — exactly the high-jerk, low-predictability motion this drill trains against.
// ===========================================================================
export const EVASIVE_TUNING = {
  standoffDistance: 50,        // meters directly ahead of the player's nose it tries to hold station at
  maxRangeM: 100,               // hard leash — once actual 3D distance to the player exceeds this,
                                // evasiveThink overrides the committed candidate to fwd=+1 (max
                                // closing bias) with lateral/vertical bias suppressed, so all
                                // authority goes to reeling itself back in rather than fighting itself
                                // with an equally-strong sideways push while trying to close.
  steerGain: 7,
  positionCorrectionGain: 1.2,   // 1/s — how much of the standoffDistance shortfall (meters, forward
                                  // axis only) gets added to the player's own velocity as the desired
                                  // baseline closing speed, before any MPC-chosen forward bias is added
  velocityBand: 30,               // m/s of velocity error (desired vs. actual) that maps to full
                                   // throttle/strafe deflection on any axis
  threatMarginMultiplier: 2.5,  // MPC's hit-risk term (and the live "threatened" check driving replan
                                 // urgency) activates once a predicted miss distance would be within
                                 // this many hull radii, not only once it would already technically
                                 // connect — lets it react before a shot actually lands, not only after
  mpcHorizonSec: 1.0,             // 2026-08-15: lengthened from 0.4s now that survival (predicted
                                  // hit-miss distance against a turn-rate-limited player tracker) is
                                  // the dominant score term instead of a raw jerk reward — a longer
                                  // horizon is exactly what lets the planner see that a sustained push
                                  // gets it killed, where the old short horizon existed specifically
                                  // to stop unbounded drift from swamping a direction-change reward
                                  // that no longer needs protecting now the reward is survival-based.
  mpcStepSec: 0.05,                // physics step size used for that simulation (20 steps/horizon)
  mpcReplanSec: 0.75,             // baseline cadence for re-running the candidate evaluation — a
                                   // receding horizon, not a one-shot plan committed to indefinitely.
                                   // 2026-07-25: 3x'd from 0.25s (200% longer per user report the
                                   // wiggle read as too fast/twitchy to land as a deliberate break)
  mpcThreatReplanSec: 0.24,      // much faster re-evaluation cadence while a candidate's own outcome
                                 // is judged risky (see the hit-risk cost term) — a fast, urgent
                                 // reconsideration instead of the calmer baseline cadence. Also 3x'd
                                 // from 0.08s 2026-07-25, same reasoning as mpcReplanSec above.
  mpcStandoffWeight: 9.0,        // cost weight — keep the jink from drifting far off the standoff
                                 // POINT (forward distance AND lateral/vertical position both, meters
                                 // — see scoreCandidate's doc comment for why this is linear, not squared)
  jinkMagnitude: 55,              // m/s — how much EXTRA velocity (beyond just tracking the standoff
                                  // point's own motion) each MPC-chosen bias axis adds — see
                                  // biasVelocityServo's doc comment. 2026-08-15: tried nearly doubling
                                  // this to read as more strafe-heavy — measured WORSE: strafe was
                                  // already saturating at full authority the entire time even at 55
                                  // (velocityBand is only 30, so any bias this large already clamps
                                  // strafeX/Y to ±1), so raising it doesn't add any real thrust — it
                                  // just holds the SAME full-authority push toward a harder-to-reach
                                  // target for longer each half-cycle (mpcReplanSec), which is pure
                                  // drift distance (speed × time), not more visible strafing. A
                                  // headless capture confirmed this alone pushed the runaway from ~90m
                                  // to 700+m. lateralCenteringGain is the real "more strafe, less
                                  // drift" lever — a stiffer restoring force, not a bigger push.
  lateralCenteringGain: 0.6,     // 1/s — continuous proportional pull back toward zero lateral/
                                 // vertical offset from the player's nose-line, blended into the
                                 // baseline BEFORE the jink bias is added — the forward axis already
                                 // has this (forwardShortfall * positionCorrectionGain); lateral/
                                 // vertical didn't, relying only on MPC's periodic drift-cost
                                 // judgment, which wasn't enough on its own to prevent runaway drift
                                 // once the standoff point itself was moving fast
  mpcHitRiskWeight: 2.0,          // cost weight — strongly avoid predicted-hit outcomes
  mpcUnpredictabilityWeight: 150, // reward weight — favor candidates whose full (bank + forward-bias)
                                  // combination differs from the currently-committed one. Dominant
                                  // whenever no candidate is under real hit-risk, which is what keeps
                                  // it actively reversing direction instead of settling into one push
  playerTrackTurnRateRadPerSec: 1.0, // 2026-08-15: how fast the player-tracker model used for MPC's
                                      // hit-risk scoring can re-aim toward the drone's predicted
                                      // position, per horizon substep — modeling a turn-rate-limited
                                      // opponent instead of freezing their aim at its CURRENT bearing
                                      // (the old assumption, which is exactly what let "just keep
                                      // pushing in one direction" score as safe: a frozen aim can't
                                      // ever catch a target that's merely moving away in a straight
                                      // line, so the old scorer never penalized that). ~Gladius
                                      // pitch/yaw maxAngVel (1.19/0.91 rad/s, see gladius.ts) — roll
                                      // doesn't reorient the aim point, so it's excluded from this
                                      // estimate.
  shootbackChancePerSec: 0.15,  // 'block' -> 'shootback' trigger rate once its cooldown has cleared
  shootbackDurationSec: 1.2,    // how long it holds a firing window
  shootbackCooldownSec: 1.5,    // minimum gap between shootback windows
  fireRange: 300,
  fireLateralTolerance: 6
};

// The 6 bank directions the break maneuver can commit to: ±45°, ±90°, and ±135° off vertical
// (playerUp), in the (player's) right/up plane — (x, y) = (sin(bankAngle), cos(bankAngle)), so
// evasiveThink's bankHint (always aligned to whichever of these is committed) rolls the hull by
// exactly that angle before pushing thrust "up" through it. Deliberately excludes straight up (0°,
// no roll — the flat slide the original redesign was fixing) and straight down (180°) — always
// banked, never a flat push — but 2026-08-15 now INCLUDES the ±135° down-leaning pair (the weak
// half-strength verticalDown thruster) rather than excluding them outright: since MPC now scores
// candidates by their genuinely simulated (through the real, asymmetric thrust) outcome rather than
// by a hand-picked exclusion rule, a weaker-but-more-unexpected direction can legitimately win, same
// as a real PVP pilot using the "wrong" thruster because it's the one you don't expect.
const MPC_JINK_DIRECTIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.7071, y: 0.7071 },    // +45°
  { x: -0.7071, y: 0.7071 },   // -45°
  { x: 1, y: 0 },              // +90°
  { x: -1, y: 0 },             // -90°
  { x: 0.7071, y: -0.7071 },   // +135° (weak down-leaning)
  { x: -0.7071, y: -0.7071 }   // -135° (weak down-leaning)
];

// The forward-bias levels MPC searches, on top of the always-on standoff-tracking baseline (see
// biasVelocityServo's doc comment) — close hard, hold the baseline, or open hard. 2026-08-15: this is
// the forward axis's whole share of the MPC candidate space (see this file's top doc comment for why
// it's no longer a separate always-on servo outside the search).
const MPC_FWD_LEVELS: ReadonlyArray<number> = [-1, 0, 1];

// Opens the drill already mid-break — a random candidate committed immediately, held for one full
// baseline replan window (mpcReplanSec) before the MPC planner takes over — rather than defaulting to
// a zero/"hold" bias that would read as a flat, unrolled upstrafe the instant the player turns toward
// it (the exact complaint the original redesign fixed; see the top-of-file doc comment).
export function spawnEvasiveState(): EvasiveAIMemory {
  const dir = MPC_JINK_DIRECTIONS[Math.floor(Math.random() * MPC_JINK_DIRECTIONS.length)];
  const fwd = MPC_FWD_LEVELS[Math.floor(Math.random() * MPC_FWD_LEVELS.length)];
  return {
    jinkStrafeX: dir.x,
    jinkStrafeY: dir.y,
    jinkFwd: fwd,
    jinkReplanTimer: EVASIVE_TUNING.mpcReplanSec,
    mode: 'block',
    modeTimer: 0,
    wasThreatened: false
  };
}

// Lightweight clone of just what integrateFlight needs — a full EnemyShip carries combat/AI state
// (health, behavior, etc.) that has no bearing on flight and would be wasteful to clone every
// candidate, every replan.
interface PlanningBody {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: AngularState;
  angAccel: AngularState;
  boosting: boolean;
  throttleSpoolTime: number;
  verticalSpoolTime: number;
}

// Converts a candidate's (forward, lateral, vertical) bias — all in PLAYER-frame — into actual
// body-relative throttle/strafeX/strafeY via a velocity-servo: desired = baseline + bias*jinkMagnitude
// per axis, error = desired - actual (computed in world space), then that error is projected onto
// whichever body axes are CURRENTLY available. `baseline*Vel` is the standoff point's own current
// velocity along the player's forward/right/up axes — critically, this includes the ROTATIONAL
// contribution (see evasiveThink's targetVel doc comment), not just the player's translational
// velocity. A committed bias can persist across many replans while the nose keeps slowly re-aiming
// and the player keeps rotating, so recomputing this from scratch every call (not just once when the
// bias was chosen) is what keeps it tracking a genuinely moving reference frame instead of a fixed
// command that quietly goes stale. 2026-08-15: extended to cover the FORWARD axis too (previously
// lateral/vertical only, with forward handled by a separate always-on servo outside the MPC search —
// see this file's top doc comment) — same servo, one more axis, now also feeding `throttle`.
function biasVelocityServo(
  fwdBias: number, dirX: number, dirY: number,
  baselineFwdVel: number, baselineLateralVel: number, baselineVerticalVel: number,
  actualVel: Vec3, playerForward: Vec3, playerRight: Vec3, playerUp: Vec3,
  bodyForward: Vec3, bodyRight: Vec3, bodyUp: Vec3
): { throttle: number; strafeX: number; strafeY: number } {
  const desiredFwdVel = baselineFwdVel + fwdBias * EVASIVE_TUNING.jinkMagnitude;
  const desiredLateralVel = baselineLateralVel + dirX * EVASIVE_TUNING.jinkMagnitude;
  const desiredVerticalVel = baselineVerticalVel + dirY * EVASIVE_TUNING.jinkMagnitude;
  const actualFwdVel = actualVel.x * playerForward.x + actualVel.y * playerForward.y + actualVel.z * playerForward.z;
  const actualLateralVel = actualVel.x * playerRight.x + actualVel.y * playerRight.y + actualVel.z * playerRight.z;
  const actualVerticalVel = actualVel.x * playerUp.x + actualVel.y * playerUp.y + actualVel.z * playerUp.z;
  const fwdError = desiredFwdVel - actualFwdVel;
  const lateralError = desiredLateralVel - actualLateralVel;
  const verticalError = desiredVerticalVel - actualVerticalVel;
  const errorWorld: Vec3 = {
    x: playerForward.x * fwdError + playerRight.x * lateralError + playerUp.x * verticalError,
    y: playerForward.y * fwdError + playerRight.y * lateralError + playerUp.y * verticalError,
    z: playerForward.z * fwdError + playerRight.z * lateralError + playerUp.z * verticalError
  };
  return {
    throttle: clamp((errorWorld.x * bodyForward.x + errorWorld.y * bodyForward.y + errorWorld.z * bodyForward.z) / EVASIVE_TUNING.velocityBand, -1, 1),
    strafeX: clamp((errorWorld.x * bodyRight.x + errorWorld.y * bodyRight.y + errorWorld.z * bodyRight.z) / EVASIVE_TUNING.velocityBand, -1, 1),
    strafeY: clamp((errorWorld.x * bodyUp.x + errorWorld.y * bodyUp.y + errorWorld.z * bodyUp.z) / EVASIVE_TUNING.velocityBand, -1, 1)
  };
}

// Forward-simulates holding a fixed (forward, lateral, vertical) bias for EVASIVE_TUNING.mpcHorizonSec,
// through the real flight model — re-running the velocity-servo above every substep (not just once at
// the start), so the simulation reacts to its own evolving velocity the same way the real per-tick
// application does. Orientation is frozen (zero angVel, zero pitch/yaw/roll input, nose always aimDir
// in the real per-tick application) for the duration — see this section's doc comment for why that's
// a reasonable approximation over a horizon this short. Always boosted (the drone is always mid-break).
// Returns the WHOLE trajectory (not just the endpoint) — scoreCandidate needs to evaluate hit-risk at
// its worst point across the horizon, not only where it happens to end up.
function simulateJinkCandidate(
  enemy: EnemyShip, fwdBias: number, dirX: number, dirY: number,
  playerForward: Vec3, playerRight: Vec3, playerUp: Vec3,
  baselineFwdVel: number, baselineLateralVel: number, baselineVerticalVel: number
): Array<{ pos: Vec3; vel: Vec3 }> {
  const body: PlanningBody = {
    type: enemy.type,
    pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z },
    vel: { x: enemy.vel.x, y: enemy.vel.y, z: enemy.vel.z },
    quat: { x: enemy.quat.x, y: enemy.quat.y, z: enemy.quat.z, w: enemy.quat.w },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    boosting: true,
    throttleSpoolTime: 0,
    verticalSpoolTime: enemy.verticalSpoolTime
  };
  const { forward: bodyForward, right: bodyRight, up: bodyUp } = computeAxes(body.quat);
  const steps = Math.round(EVASIVE_TUNING.mpcHorizonSec / EVASIVE_TUNING.mpcStepSec);
  const trajectory: Array<{ pos: Vec3; vel: Vec3 }> = [];
  for (let i = 0; i < steps; i++) {
    const { throttle, strafeX, strafeY } = biasVelocityServo(
      fwdBias, dirX, dirY, baselineFwdVel, baselineLateralVel, baselineVerticalVel,
      body.vel, playerForward, playerRight, playerUp, bodyForward, bodyRight, bodyUp
    );
    const inputs: FlightInputs = { throttle, pitch: 0, yaw: 0, roll: 0, strafeX, strafeY, brake: false, decoupled: false };
    integrateFlight(body, inputs, EVASIVE_TUNING.mpcStepSec);
    trajectory.push({ pos: { x: body.pos.x, y: body.pos.y, z: body.pos.z }, vel: { x: body.vel.x, y: body.vel.y, z: body.vel.z } });
  }
  return trajectory;
}

// Spherically rotates `current` (a unit vector) toward `target` (a unit vector) by at most `maxAngle`
// radians — used to model the player as a TURN-RATE-LIMITED TRACKER during MPC scoring (see
// scoreCandidate's doc comment) rather than an opponent whose aim is frozen at its current bearing.
function rotateTowardUnit(current: Vec3, target: Vec3, maxAngle: number): Vec3 {
  if (maxAngle <= 0) return current;
  const dot = clamp(current.x * target.x + current.y * target.y + current.z * target.z, -1, 1);
  const angle = Math.acos(dot);
  if (angle < 1e-6) return current;
  const sinAngle = Math.sin(angle);
  if (sinAngle < 1e-6) return target; // current/target nearly opposite — no well-defined slerp axis
  const t = Math.min(1, maxAngle / angle);
  const a = Math.sin((1 - t) * angle) / sinAngle;
  const b = Math.sin(t * angle) / sinAngle;
  return normalize({ x: current.x * a + target.x * b, y: current.y * a + target.y * b, z: current.z * a + target.z * b });
}

// Lower is better. Combines: predicted hit-miss distance against a player TRACKER model (see below),
// staying near the standoff point (both the forward distance AND the lateral/vertical drift off the
// player's nose-line), and rewarding a candidate whose full (bank + forward-bias) combination differs
// from the currently-committed one.
//
// The hit-risk term is evaluated at its WORST point across the WHOLE trajectory, not just the
// endpoint, against a player forward vector that's simulated RE-AIMING toward the drone's predicted
// position every substep (rotateTowardUnit, capped at playerTrackTurnRateRadPerSec) rather than frozen
// at the player's CURRENT bearing. 2026-08-15: this is the single most important change from the
// original design — a frozen-aim assumption can NEVER be threatened by a target that's merely moving
// away in a straight line (the aim line and the target diverge, so predicted miss distance only ever
// grows), which is exactly what let "just keep pushing in one direction" score as perfectly safe to a
// one-shot lookahead. A turn-rate-limited TRACKER keeps closing the aim gap over the horizon, so a
// sustained linear push genuinely does start reading as dangerous once the horizon is long enough for
// the tracker to catch up — which is also why mpcHorizonSec was lengthened alongside this change.
//
// The standoff-drift term is LINEAR (not squared) in the drift distance — deliberately so. A squared
// cost lets a large existing drift dominate every other consideration, but clamping introduces a worse
// problem: once past the clamp, EVERY candidate reads as the same saturated cost, so the term stops
// discriminating "getting better" from "getting worse" at exactly the drift levels where a restoring
// pull matters most. Linear cost never explodes but also never fully saturates — it keeps pulling
// toward the standoff point at every distance, proportionally, without ever swamping the
// unpredictability reward on its own.
function scoreCandidate(
  trajectory: Array<{ pos: Vec3; vel: Vec3 }>, dirX: number, dirY: number, fwdBias: number,
  prevDirX: number, prevDirY: number, prevFwdBias: number,
  player: ShipBody, playerForwardNow: Vec3, playerRight: Vec3, playerUp: Vec3, hullRadius: number
): number {
  const margin = hullRadius * EVASIVE_TUNING.threatMarginMultiplier;
  const maxTurnPerStep = EVASIVE_TUNING.playerTrackTurnRateRadPerSec * EVASIVE_TUNING.mpcStepSec;
  let trackedForward = playerForwardNow;
  let worstHitRiskShortfall = 0;
  for (const step of trajectory) {
    const desiredAim = normalize({ x: step.pos.x - player.pos.x, y: step.pos.y - player.pos.y, z: step.pos.z - player.pos.z });
    trackedForward = rotateTowardUnit(trackedForward, desiredAim, maxTurnPerStep);
    const missDistance = closestApproachIfFiredNow(
      player.pos, player.vel, trackedForward, step.pos, step.vel, WEAPON.muzzleSpeed, WEAPON.lifetime
    );
    worstHitRiskShortfall = Math.max(worstHitRiskShortfall, Math.max(0, margin - missDistance));
  }
  const hitRiskCost = worstHitRiskShortfall * worstHitRiskShortfall;

  const final = trajectory[trajectory.length - 1];
  const toFinal: Vec3 = { x: final.pos.x - player.pos.x, y: final.pos.y - player.pos.y, z: final.pos.z - player.pos.z };
  const forwardSepFinal = toFinal.x * playerForwardNow.x + toFinal.y * playerForwardNow.y + toFinal.z * playerForwardNow.z;
  const lateralFinal = toFinal.x * playerRight.x + toFinal.y * playerRight.y + toFinal.z * playerRight.z;
  const verticalFinal = toFinal.x * playerUp.x + toFinal.y * playerUp.y + toFinal.z * playerUp.z;
  const standoffError = forwardSepFinal - EVASIVE_TUNING.standoffDistance;
  const standoffCost = Math.abs(standoffError) + Math.abs(lateralFinal) + Math.abs(verticalFinal);

  // Average similarity across bank (cosine, both unit vectors) and forward bias (product of two
  // values in {-1,0,1}) against the currently-committed candidate, each in [-1, 1] — scaled to match
  // the original bank-only reward's [0, 2] range so mpcUnpredictabilityWeight didn't need re-tuning.
  const bankSim = dirX * prevDirX + dirY * prevDirY;
  const fwdSim = fwdBias * prevFwdBias;
  const directionChangeReward = 1 - (bankSim + fwdSim) / 2;

  return EVASIVE_TUNING.mpcStandoffWeight * standoffCost
    + EVASIVE_TUNING.mpcHitRiskWeight * hitRiskCost
    - EVASIVE_TUNING.mpcUnpredictabilityWeight * directionChangeReward;
}

export function evasiveThink(
  enemy: EnemyShip,
  ai: EvasiveAIMemory,
  player: ShipBody,
  dt: number,
  returnFireEnabled: boolean
): FighterDecision {
  const { forward: playerForward, right: playerRight, up: playerUp } = computeAxes(player.quat);
  const toEnemy: Vec3 = {
    x: enemy.pos.x - player.pos.x,
    y: enemy.pos.y - player.pos.y,
    z: enemy.pos.z - player.pos.z
  };
  const aimDir = normalize({ x: -toEnemy.x, y: -toEnemy.y, z: -toEnemy.z });
  const distToPlayer = Math.hypot(toEnemy.x, toEnemy.y, toEnemy.z);
  const overRange = distToPlayer > EVASIVE_TUNING.maxRangeM; // see EVASIVE_TUNING.maxRangeM's doc comment

  // how close would the player's shot, fired right now with their current facing/velocity, actually
  // pass RIGHT NOW (not the predictive per-candidate version MPC uses below) — drives replan urgency
  // and the shootback/boost "panic" triggers, same as the player's own PIP color logic.
  const missDistanceNow = closestApproachIfFiredNow(
    player.pos, player.vel, playerForward, enemy.pos, enemy.vel, WEAPON.muzzleSpeed, WEAPON.lifetime
  );
  const threatened = missDistanceNow <= enemy.type.hullRadius * EVASIVE_TUNING.threatMarginMultiplier;
  const justThreatened = threatened && !ai.wasThreatened;
  ai.wasThreatened = threatened;
  if (justThreatened) ai.jinkReplanTimer = 0; // break immediately instead of waiting out the current window

  // The standoff point isn't carried along by the player's TRANSLATIONAL velocity alone — it also
  // sweeps through an arc purely from the player's own ROTATION (holding a pitch/yaw input while
  // barely moving forward spins the point 50m ahead around the player just as fast as a real orbit
  // at that radius would). Using only player.vel as feed-forward is blind to that entirely. The fix
  // is the standard rigid-body point-velocity formula: velocity of a point rigidly attached to the
  // player at its current offset = player.vel + (player's world-space angular velocity) x (offset).
  // This feeds the baseline for ALL THREE axes below — the rotational term is often nearly
  // perpendicular to the forward axis (since the drone sits roughly along it), meaning most of its
  // effect actually shows up as lateral/vertical motion, not forward/back, so all three need it.
  const playerWorldAngVel = rotateVecByQuat({ x: player.angVel.pitch, y: player.angVel.yaw, z: player.angVel.roll }, player.quat);
  const rotationalVel = cross(playerWorldAngVel, toEnemy);
  const targetVel: Vec3 = {
    x: player.vel.x + rotationalVel.x,
    y: player.vel.y + rotationalVel.y,
    z: player.vel.z + rotationalVel.z
  };
  // lateral/vertical get a continuous, proportional pull back toward zero offset from the player's
  // nose-line, same idea as the forward axis's forwardShortfall below — without this, the only thing
  // bounding lateral/vertical drift was MPC's periodic (and, on its own, insufficient) drift-cost
  // judgment.
  const lateralNow = toEnemy.x * playerRight.x + toEnemy.y * playerRight.y + toEnemy.z * playerRight.z;
  const verticalNow = toEnemy.x * playerUp.x + toEnemy.y * playerUp.y + toEnemy.z * playerUp.z;
  const baselineLateralVel = (targetVel.x * playerRight.x + targetVel.y * playerRight.y + targetVel.z * playerRight.z) - lateralNow * EVASIVE_TUNING.lateralCenteringGain;
  const baselineVerticalVel = (targetVel.x * playerUp.x + targetVel.y * playerUp.y + targetVel.z * playerUp.z) - verticalNow * EVASIVE_TUNING.lateralCenteringGain;

  // forward axis baseline: match the player's own forward speed (feed-forward) plus a correction
  // proportional to the standoffDistance shortfall — the MPC-chosen forward bias (ai.jinkFwd) rides
  // on top of this, same as lateral/vertical (see biasVelocityServo's doc comment).
  const forwardSep = toEnemy.x * playerForward.x + toEnemy.y * playerForward.y + toEnemy.z * playerForward.z;
  const forwardShortfall = EVASIVE_TUNING.standoffDistance - forwardSep;
  const playerForwardVel = targetVel.x * playerForward.x + targetVel.y * playerForward.y + targetVel.z * playerForward.z;
  const baselineFwdVel = playerForwardVel + forwardShortfall * EVASIVE_TUNING.positionCorrectionGain;

  // ---- shootback mini state machine (only ever leaves 'block' when the drill option is enabled) ----
  if (ai.modeTimer > 0) ai.modeTimer -= dt;
  if (!returnFireEnabled) {
    ai.mode = 'block';
  } else if (ai.mode === 'shootback') {
    if (ai.modeTimer <= 0) {
      ai.mode = 'block';
      ai.modeTimer = EVASIVE_TUNING.shootbackCooldownSec;
    }
  } else if (ai.modeTimer <= 0 && Math.random() < EVASIVE_TUNING.shootbackChancePerSec * dt) {
    ai.mode = 'shootback';
    ai.modeTimer = EVASIVE_TUNING.shootbackDurationSec;
  }

  // Nose always faces the player (aimDir) — no more chase/watch hysteresis (see this file's top doc
  // comment). Bank targets the PLAYER's own up axis, never the committed jink's bank angle — 2026-08-16:
  // this used to roll the hull to align the jink's bank angle with the strong up-thruster (routing the
  // lateral/vertical bias through one strong axis instead of splitting it across two), but
  // physics/flightModel.ts's pitch/yaw/roll draw from ONE SHARED rotational-authority budget
  // (`inputMag = hypot(rawPitch, rawYaw, rawRoll)`, scaled down together once it exceeds 1) — committing
  // hard to a ±90°/±135° bank target genuinely steals pitch/yaw authority from converging the nose onto
  // aimDir, which is exactly what made the drone read as "nose never really on me." Since strafe and
  // up-thrust are nearly equal in magnitude (145 vs 147, see this file's earlier top doc comment), an
  // unrolled two-axis split costs almost nothing in thrust efficiency — the roll was only ever buying
  // legibility, not performance, and legibility is worth far less than an actual firing solution.
  const steerDir = aimDir;
  const steer = steeringToward(enemy.quat, steerDir, EVASIVE_TUNING.steerGain, playerUp);

  // ai.jinkStrafeX/Y/jinkFwd are the committed PLAYER-frame bias (see biasVelocityServo's doc
  // comment) — recomputed into actual throttle/strafeX/strafeY every tick, not just at the moment
  // they were chosen, since a committed bias can persist across many replans while both the nose
  // keeps slowly re-aiming and the player keeps rotating in the meantime. Beyond maxRangeM, override
  // to NO bias on any axis (just the baseline) rather than forcing a specific sign: the baseline
  // (forwardShortfall/lateral/verticalNow-driven) is already correctly-signed for whichever
  // correction is actually needed — closing if it fell behind, falling back if it overshot ahead, or
  // (the common case, since forward is tightly servo-held continuously) recentering off a lateral/
  // vertical drift. Forcing an assumed sign here was the earlier bug: it can fight the real
  // correction instead of helping it. Suppressing the BIAS (not the baseline) still stops the bank
  // jink from fighting the recovery — strafe/vertical thrust (145/147) is comparable in magnitude to
  // main thrust (201), so leaving an extra sideways push active while trying to recover would have it
  // fighting itself, which is exactly what let it wander past maxRangeM and keep going instead of
  // ever visibly returning.
  const { forward: enemyForward, right: enemyRight, up: enemyUp } = computeAxes(enemy.quat);
  const { throttle, strafeX, strafeY } = overRange
    ? biasVelocityServo(0, 0, 0, baselineFwdVel, baselineLateralVel, baselineVerticalVel, enemy.vel, playerForward, playerRight, playerUp, enemyForward, enemyRight, enemyUp)
    : biasVelocityServo(ai.jinkFwd, ai.jinkStrafeX, ai.jinkStrafeY, baselineFwdVel, baselineLateralVel, baselineVerticalVel, enemy.vel, playerForward, playerRight, playerUp, enemyForward, enemyRight, enemyUp);

  // ---- MPC replan (see this file's top doc comment) ----
  ai.jinkReplanTimer -= dt;
  if (ai.jinkReplanTimer <= 0) {
    let bestCost = Infinity, bestX = MPC_JINK_DIRECTIONS[0].x, bestY = MPC_JINK_DIRECTIONS[0].y, bestFwd = MPC_FWD_LEVELS[0];
    for (const dir of MPC_JINK_DIRECTIONS) {
      for (const fwd of MPC_FWD_LEVELS) {
        const trajectory = simulateJinkCandidate(enemy, fwd, dir.x, dir.y, playerForward, playerRight, playerUp, baselineFwdVel, baselineLateralVel, baselineVerticalVel);
        const cost = scoreCandidate(trajectory, dir.x, dir.y, fwd, ai.jinkStrafeX, ai.jinkStrafeY, ai.jinkFwd, player, playerForward, playerRight, playerUp, enemy.type.hullRadius);
        if (cost < bestCost) {
          bestCost = cost;
          bestX = dir.x;
          bestY = dir.y;
          bestFwd = fwd;
        }
      }
    }
    ai.jinkStrafeX = bestX;
    ai.jinkStrafeY = bestY;
    ai.jinkFwd = bestFwd;
    ai.jinkReplanTimer = threatened ? EVASIVE_TUNING.mpcThreatReplanSec : EVASIVE_TUNING.mpcReplanSec;
  }

  // Always boosted: the drone is always mid-break (no "hold" state), and a real evasive break is
  // flown with the afterburner lit, not requested only as a last resort.
  const boostRequested = true;

  return {
    inputs: {
      throttle,
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      strafeX: clamp(strafeX, -1, 1),
      strafeY: clamp(strafeY, -1, 1),
      brake: false,
      decoupled: false
    },
    boostRequested,
    wantsToFire: ai.mode === 'shootback',
    aimDir
  };
}
