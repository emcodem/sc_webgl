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
// port. Two mostly-independent halves:
//
// FORWARD AXIS (standoff-holding) — a plain velocity-servo: match the player's own forward speed
// (feed-forward) plus a correction proportional to the standoffDistance shortfall. Not re-rolled or
// randomized (the target is just "stay standoffDistance ahead"), so it converges cleanly and doesn't
// have the achievability problems the lateral/vertical axis used to.
//
// LATERAL/VERTICAL AXES (the break) — receding-horizon MODEL PREDICTIVE CONTROL over exactly one
// maneuver, always flown the way a real pilot breaks off a gun pass: bank the hull 45° or 90° (either
// direction — 4 possible bank angles, see MPC_JINK_DIRECTIONS) and push full boosted thrust through
// the STRONG up-thruster, rather than an unrolled hull splitting thrust across two weaker/independent
// axes (2026-07-25: previously the candidate set also included a "hold formation" option and a
// straight, unrolled up/down push, which is exactly what read as a flat, non-evasive slide — see
// spawnEvasiveState's doc comment). There is no hold option and no unrolled push anymore — the drone
// is always mid-break. Concretely:
//   1. Builds the 4 candidate bank angles, each implicitly boosted — real evasive pilots hit the
//      afterburner mid-break, not as a rare last resort, so boost is no longer a separate searched
//      dimension.
//   2. For EACH candidate, clones the drone's current state and forward-simulates it through the
//      SAME real flight model (physics/flightModel.ts's integrateFlight) the whole game runs on, for
//      a short horizon — this is "the AI" quite literally driving its own physics sim as a predictor,
//      not a separate approximation of it.
//   3. Scores each candidate's resulting trajectory: reward ending up hard for the player's CURRENT
//      aim to hit (via the same closestApproachIfFiredNow the player's own PIP color uses), reward
//      ending up with a velocity that's substantially DIFFERENT from its current one (the actual
//      "jerk"/PIP-defeating quantity), and penalize drifting far from the standoff distance.
//   4. Commits to the winning candidate's bank angle for a short window (re-planning more often — a
//      receding horizon — rather than committing to a long, unverified maneuver), then repeats.
//      Reacting to a detected threat forces an immediate replan instead of waiting out the window,
//      same idea as the old design's "break now" rule.
// Orientation is held FIXED for the (short, ~1s) planning horizon — a real reorientation takes
// several seconds at this ship's turn rate (see the chase/watch split below), so freezing it for the
// much shorter planning window is a reasonable approximation, not a meaningful source of error. It's
// also a reasonable approximation of the bank itself: strafe and up-thrust are nearly equal in
// magnitude (145 vs 147), so a full-power single-axis push after rolling and a fractional two-axis
// push before rolling land at nearly the same resultant velocity — what the roll actually buys is
// legibility (a deliberate break, not a flat slide), not thrust efficiency.
//
// 2026-07-25: the jink above only ever governed the LATERAL/VERTICAL axes — the FORWARD axis
// (standoff-holding, below) is its own smooth, never-randomized velocity-servo with no break of its
// own, so a player closing very slowly (a gentle sustained turn, never a big enough velocity spike to
// trip the chase-struggle escape hatch) could hold the drone in one continuous main-thrust-dominated
// flee indefinitely — the lateral jink alternating underneath doesn't change that the STRONGEST
// thruster (main, 201) just keeps pushing one way. EVASIVE_TUNING.forcedBreakIntervalSec is a hard,
// unconditional ceiling on that: every ~1s, regardless of threat/chase state, it forces a fresh jink
// replan and, some fraction of the time, punches the throttle to full forward for a beat (a real
// evasive pilot doesn't only ever retreat — sometimes the break is closing distance to blow past).
//
// Nose facing is a hysteresis switch between two modes, not a permanent lock:
//   'watch' (default) — nose on the player (aimDir), so it reads as an opponent fighting you, not a
//              target flying formation with its back turned, and so it can see you for MPC's threat
//              detection. This is mechanically fine MOST of the time: once its own velocity has
//              converged to match yours, the remaining forward-axis correction is small, so it
//              doesn't matter that main thrust now points the "wrong" way (at you) for that axis.
//   'chase'    — nose swung to point along the player's OWN forward axis instead, entered only once
//              the forward-axis velocity deficit gets large (e.g. you just boosted away). Facing the
//              player for that correction would mean using this ship's weak retro thrust (63) against
//              a large deficit instead of its main thrust (201) — which is exactly what made the drone
//              read as sluggish/"flies in one straight line" once nose-lock kept it retro-only for its
//              single largest, most common correction. Hysteresis (separate enter/exit thresholds)
//              stops it flip-flopping facing every tick right at the boundary.
// Bank is fed to `upHint` on steeringToward regardless of which of the two the nose is doing (2026-
// 07-25: this used to slave bank to the player's own roll except while correcting a downward jink —
// "always roll matches the player" — but that's exactly what made every non-down jink read as an
// unrolled, flat slide; bank now always follows the committed jink's own bank angle instead, per the
// "roll 45/90 and push up" maneuver above).
//
// The AI only ever issues thruster commands through the same realistic flight model as everything
// else, so the actual G-loading and reversal snap the player sees is bounded by real thrust/speed,
// not faked — exactly the high-jerk, low-predictability motion this drill trains against.
// ===========================================================================
export const EVASIVE_TUNING = {
  standoffDistance: 50,        // meters directly ahead of the player's nose it tries to hold station at
  steerGain: 7,
  positionCorrectionGain: 1.2,   // 1/s — how much of the standoffDistance shortfall (meters, forward
                                  // axis only) gets added to the player's own velocity as the desired
                                  // closing speed — see the forward-axis doc comment above
  velocityBand: 30,               // m/s of velocity error (desired vs. actual) that maps to full
                                   // throttle deflection on the forward axis
  chaseEnterVelDeficit: 45,      // m/s of forward-axis deficit that triggers the 'chase' facing (see
                                 // the doc comment above) — set above velocityBand so it only kicks in
                                 // once the deficit is genuinely too large for the 'watch' facing's
                                 // (weak, retro-only) authority to plausibly correct
  chaseExitVelDeficit: 15,       // releases back to 'watch' once the deficit drops below this — kept
                                 // well below chaseEnterVelDeficit (hysteresis) so it doesn't
                                 // flip-flop facing every tick right at one threshold
  chaseStruggleTolerance: 0.8,   // 'chasing' only counts as genuinely helping once it's shrunk the
                                 // deficit to at most this fraction of chaseEnterVelDeficit — if it's
                                 // still above that after chaseStruggleLimitSec, the drone's own max
                                 // turn rate can't out-rotate whatever the player is doing (a real
                                 // physical limit when both fly the same ship — see the "give up
                                 // chasing" doc comment), so continuing to chase is a losing battle
  chaseStruggleLimitSec: 1.2,    // seconds of chasing without meaningful improvement before giving up
                                 // and forcing an immediate break instead — see chaseStruggleTolerance
  chaseCooldownSec: 1.0,         // seconds 'chasing' stays disabled after a forced break, so it
                                 // doesn't immediately re-enter the same losing chase it just gave up
  forcedBreakIntervalSec: 1.0,   // 2026-07-25: hard, unconditional ceiling on sustained one-direction
                                 // travel, independent of mpcReplanSec/mpcThreatReplanSec above. Those
                                 // only govern the LATERAL/VERTICAL jink's bank angle — the FORWARD
                                 // axis (standoff-holding, see its doc comment) is a plain, smooth,
                                 // never-randomized velocity-servo with no periodic break of its own.
                                 // A player closing very slowly (a gentle sustained turn, not a big
                                 // velocity spike) can hold the drone in one continuous main-thrust-
                                 // dominated flee for as long as the closure lasts, since nothing ever
                                 // interrupts that axis specifically — the lateral jink alternating
                                 // underneath it doesn't change the fact that the DOMINANT, strongest
                                 // thruster (main, 201 vs strafe/up's 145/147) just keeps pushing one
                                 // way. This timer forces a break regardless of velDeficitMag, chase
                                 // state, or threat — see its use in evasiveThink.
  passThroughChance: 0.4,        // fraction of forced breaks (see forcedBreakIntervalSec) that also
                                 // punch the throttle to full forward for passThroughDurationSec,
                                 // overriding the standoff servo — a real evasive pilot doesn't only
                                 // ever retreat; sometimes the break is closing distance and blowing
                                 // past for a merge instead of running.
  passThroughDurationSec: 0.6,   // how long a triggered pass-through's forced full-throttle lasts
  threatMarginMultiplier: 2.5,  // MPC's hit-risk term activates once a candidate's predicted miss
                                 // distance would be within this many hull radii, not only once it
                                 // would already technically connect — lets it react before a shot
                                 // actually lands, not only after
  mpcHorizonSec: 0.4,            // how far ahead each jink candidate is forward-simulated — short on
                                  // purpose: a long horizon lets a LOT of drift accumulate regardless
                                  // of which candidate is chosen once already moving fast (reversing
                                  // can't fully arrest hundreds of m/s within the same window a
                                  // continued push would have moved it further), which let the
                                  // standoff-drift cost's sheer scale swamp the direction-change
                                  // reward and made it look "safer" (in a single 1-shot lookahead) to
                                  // just keep going. A shorter horizon keeps each decision's predicted
                                  // drift small enough that the direction-change reward can actually
                                  // compete, and the receding-horizon replanning (mpcReplanSec below)
                                  // is what provides the longer-term correction, not any one horizon.
  mpcStepSec: 0.08,                // physics step size used for that simulation (5 steps/horizon)
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
                                 // — see scoreJinkCandidate's doc comment for why this is linear, not squared)
  jinkMagnitude: 55,              // m/s — how much EXTRA lateral/vertical velocity (beyond just
                                  // tracking the standoff point's own motion) the jink bias adds —
                                  // see jinkVelocityServo's doc comment
  lateralCenteringGain: 0.6,     // 1/s — continuous proportional pull back toward zero lateral/
                                 // vertical offset from the player's nose-line, blended into the
                                 // baseline BEFORE the jink bias is added — the forward axis already
                                 // has this (forwardShortfall * positionCorrectionGain); lateral/
                                 // vertical didn't, relying only on MPC's periodic drift-cost
                                 // judgment, which wasn't enough on its own to prevent runaway drift
                                 // once the standoff point itself was moving fast
  mpcHitRiskWeight: 2.0,          // cost weight — strongly avoid predicted-hit outcomes
  mpcUnpredictabilityWeight: 150, // reward weight (0..2 scale) — favor candidates that push in a
                                  // DIFFERENT direction than the currently-committed one. This is the
                                  // dominant term whenever no candidate is under real hit-risk, which
                                  // is what keeps it actively reversing direction instead of settling
                                  // into one sustained push
  shootbackChancePerSec: 0.15,  // 'block' -> 'shootback' trigger rate once its cooldown has cleared
  shootbackDurationSec: 1.2,    // how long it holds a firing window
  shootbackCooldownSec: 1.5,    // minimum gap between shootback windows
  fireRange: 300,
  fireLateralTolerance: 6
};

// The 4 bank angles the break maneuver ever executes: ±45° and ±90° off vertical (playerUp), in the
// (player's) right/up plane — (x, y) = (sin(bankAngle), cos(bankAngle)), so evasiveThink's bankHint
// (always aligned to whichever of these is committed — see its doc comment) rolls the hull by exactly
// that angle before pushing thrust "up" through it. Deliberately excludes straight up (0°, no roll —
// the flat slide this whole redesign was fixing), straight down and the two down-leaning diagonals
// (135°/-135° — the weak half-strength verticalDown thruster), and "hold formation" (never a valid
// pick — the drone is always mid-break, never a straight line). Full deflection only: MPC already
// picks WHICH bank angle is best, so there's no need to also search partial magnitudes — a hard,
// complete break is what actually produces jerk.
const MPC_JINK_DIRECTIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.7071, y: 0.7071 },   // +45°
  { x: -0.7071, y: 0.7071 },  // -45°
  { x: 1, y: 0 },             // +90°
  { x: -1, y: 0 }             // -90°
];

// Opens the drill already mid-break — a random bank angle committed immediately, held for one full
// baseline replan window (mpcReplanSec) before the MPC planner takes over — rather than defaulting to
// a zero/"hold" bias that would read as a flat, unrolled upstrafe the instant the player turns toward
// it (the exact complaint this redesign fixes; see the top-of-file doc comment).
export function spawnEvasiveState(): EvasiveAIMemory {
  const dir = MPC_JINK_DIRECTIONS[Math.floor(Math.random() * MPC_JINK_DIRECTIONS.length)];
  return {
    jinkStrafeX: dir.x,
    jinkStrafeY: dir.y,
    jinkReplanTimer: EVASIVE_TUNING.mpcReplanSec,
    mode: 'block',
    modeTimer: 0,
    wasThreatened: false,
    chasing: false,
    chaseStruggleTimer: 0,
    chaseCooldownTimer: 0,
    forcedBreakTimer: EVASIVE_TUNING.forcedBreakIntervalSec,
    passThroughTimer: 0
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

// Converts a jink bias direction (PLAYER-frame) into actual body-relative strafeX/strafeY via a
// velocity-servo: desired = baseline + dir*jinkMagnitude, error = desired - actual (computed in
// world space), then that error is projected onto whichever axes are CURRENTLY available. `baseline`
// is the standoff point's own current velocity along the player's right/up axes — critically, this
// includes the ROTATIONAL contribution (see evasiveThink's targetVel doc comment), not just the
// player's translational velocity. A committed jink direction can persist across many replans while
// the nose keeps slowly re-aiming and the player keeps rotating, so recomputing this from scratch
// every call (not just once when the direction was chosen) is what keeps it tracking a genuinely
// moving reference frame instead of a fixed command that quietly goes stale.
function jinkVelocityServo(
  dirX: number, dirY: number, baselineLateralVel: number, baselineVerticalVel: number,
  actualVel: Vec3, playerRight: Vec3, playerUp: Vec3, bodyRight: Vec3, bodyUp: Vec3
): { strafeX: number; strafeY: number } {
  const desiredLateralVel = baselineLateralVel + dirX * EVASIVE_TUNING.jinkMagnitude;
  const desiredVerticalVel = baselineVerticalVel + dirY * EVASIVE_TUNING.jinkMagnitude;
  const actualLateralVel = actualVel.x * playerRight.x + actualVel.y * playerRight.y + actualVel.z * playerRight.z;
  const actualVerticalVel = actualVel.x * playerUp.x + actualVel.y * playerUp.y + actualVel.z * playerUp.z;
  const lateralError = desiredLateralVel - actualLateralVel;
  const verticalError = desiredVerticalVel - actualVerticalVel;
  const errorWorld: Vec3 = {
    x: playerRight.x * lateralError + playerUp.x * verticalError,
    y: playerRight.y * lateralError + playerUp.y * verticalError,
    z: playerRight.z * lateralError + playerUp.z * verticalError
  };
  return {
    strafeX: clamp((errorWorld.x * bodyRight.x + errorWorld.y * bodyRight.y + errorWorld.z * bodyRight.z) / EVASIVE_TUNING.velocityBand, -1, 1),
    strafeY: clamp((errorWorld.x * bodyUp.x + errorWorld.y * bodyUp.y + errorWorld.z * bodyUp.z) / EVASIVE_TUNING.velocityBand, -1, 1)
  };
}

// Forward-simulates holding a fixed jink bias direction (PLAYER-frame)/throttle for
// EVASIVE_TUNING.mpcHorizonSec, through the real flight model — re-running the velocity-servo above
// every substep (not just once at the start), so the simulation reacts to its own evolving velocity
// the same way the real per-tick application does. Orientation is frozen (zero angVel, zero
// pitch/yaw/roll input) for the duration — see this section's doc comment for why that's a reasonable
// approximation over a horizon this short. Always boosted (see EVASIVE_TUNING's doc comment on why
// boost is no longer a separate searched candidate dimension).
function simulateJinkCandidate(
  enemy: EnemyShip, throttle: number, dirX: number, dirY: number,
  playerRight: Vec3, playerUp: Vec3, baselineLateralVel: number, baselineVerticalVel: number
): { pos: Vec3; vel: Vec3 } {
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
  const { right: bodyRight, up: bodyUp } = computeAxes(body.quat);
  const steps = Math.round(EVASIVE_TUNING.mpcHorizonSec / EVASIVE_TUNING.mpcStepSec);
  for (let i = 0; i < steps; i++) {
    const { strafeX, strafeY } = jinkVelocityServo(dirX, dirY, baselineLateralVel, baselineVerticalVel, body.vel, playerRight, playerUp, bodyRight, bodyUp);
    const inputs: FlightInputs = { throttle, pitch: 0, yaw: 0, roll: 0, strafeX, strafeY, brake: false, decoupled: false };
    integrateFlight(body, inputs, EVASIVE_TUNING.mpcStepSec);
  }
  return { pos: body.pos, vel: body.vel };
}

// Lower is better. Combines: staying near the standoff point (both the forward distance AND the
// lateral/vertical drift off the player's nose-line — the latter is what strafeX/strafeY actually
// control, and an earlier version of this only penalized the forward axis, leaving nothing at all to
// bound how far sideways a "maximize unpredictability" candidate could run), avoiding a predicted hit
// against the player's CURRENT aim/velocity (frozen for the horizon — the player's own future intent
// isn't known, but "would my predicted position still be where you're aimed" is still a meaningful,
// real signal), and rewarding a candidate whose PUSH DIRECTION differs from the currently-committed
// one. That last term is deliberately a direction comparison, not a comparison of resulting
// velocities: an earlier version rewarded "how much did the predicted velocity change from right
// now", which a candidate that just KEEPS ACCELERATING the same way already in progress satisfies
// perfectly (velocity keeps growing every horizon as long as there's room left before some natural
// ceiling) — sustained one-directional acceleration is zero jerk, not high jerk, even though the
// velocity itself is changing a lot. Jerk is specifically the ACCELERATION vector changing direction,
// so rewarding "this candidate pushes a different way than what I'm currently committed to" is the
// direct, correct signal, and it's what actually made the MPC-driven jink alternate hard instead of
// picking one direction and coasting on it for seconds at a time (a real, observed failure mode of
// the velocity-comparison version).
function scoreJinkCandidate(
  finalPos: Vec3, finalVel: Vec3, dirX: number, dirY: number, prevDirX: number, prevDirY: number,
  player: ShipBody, playerForward: Vec3, playerRight: Vec3, playerUp: Vec3, hullRadius: number
): number {
  const toFinal: Vec3 = { x: finalPos.x - player.pos.x, y: finalPos.y - player.pos.y, z: finalPos.z - player.pos.z };
  const forwardSepFinal = toFinal.x * playerForward.x + toFinal.y * playerForward.y + toFinal.z * playerForward.z;
  const lateralFinal = toFinal.x * playerRight.x + toFinal.y * playerRight.y + toFinal.z * playerRight.z;
  const verticalFinal = toFinal.x * playerUp.x + toFinal.y * playerUp.y + toFinal.z * playerUp.z;
  // LINEAR (not squared) in the drift distance — deliberately so. A squared cost lets a large
  // existing drift dominate every other consideration, but clamping introduces a worse problem: once
  // past the clamp, EVERY candidate reads as the same saturated cost, so the term stops
  // discriminating "getting better" from "getting worse" at exactly the drift levels where a
  // restoring pull matters most. Linear cost never explodes (100m of extra drift always costs the
  // same fixed amount more, not a quadratically larger one) but also never fully saturates — it keeps
  // pulling toward the standoff point at every distance, proportionally, without ever swamping the
  // direction-change reward on its own.
  const standoffError = forwardSepFinal - EVASIVE_TUNING.standoffDistance;
  const standoffCost = Math.abs(standoffError) + Math.abs(lateralFinal) + Math.abs(verticalFinal);

  const missDistance = closestApproachIfFiredNow(
    player.pos, player.vel, playerForward, finalPos, finalVel, WEAPON.muzzleSpeed, WEAPON.lifetime
  );
  const margin = hullRadius * EVASIVE_TUNING.threatMarginMultiplier;
  const hitRiskShortfall = Math.max(0, margin - missDistance);
  const hitRiskCost = hitRiskShortfall * hitRiskShortfall;

  // 0 (same bank angle as currently committed) .. 2 (fully reversed); both dir vectors are always
  // unit length (every candidate is one of the 4 bank angles — see MPC_JINK_DIRECTIONS — never zero),
  // so this is a plain cosine-similarity comparison.
  const directionChangeReward = 1 - (dirX * prevDirX + dirY * prevDirY);

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

  // ---- forced break (see EVASIVE_TUNING.forcedBreakIntervalSec's doc comment) ----
  // Unconditional: fires regardless of threatened/chasing/velDeficitMag, since those all gate OTHER
  // mechanisms that can otherwise leave the forward axis pushing one sustained direction indefinitely
  // (e.g. a player closing very slowly never trips the large-deficit chase-struggle escape hatch).
  ai.forcedBreakTimer -= dt;
  if (ai.forcedBreakTimer <= 0) {
    ai.jinkReplanTimer = 0;
    ai.forcedBreakTimer = EVASIVE_TUNING.forcedBreakIntervalSec;
    if (Math.random() < EVASIVE_TUNING.passThroughChance) ai.passThroughTimer = EVASIVE_TUNING.passThroughDurationSec;
  }
  if (ai.passThroughTimer > 0) ai.passThroughTimer -= dt;

  // The standoff point isn't carried along by the player's TRANSLATIONAL velocity alone — it also
  // sweeps through an arc purely from the player's own ROTATION (holding a pitch/yaw input while
  // barely moving forward spins the point 50m ahead around the player just as fast as a real orbit
  // at that radius would). Using only player.vel as feed-forward is blind to that entirely. The fix
  // is the standard rigid-body point-velocity formula: velocity of a point rigidly attached to the
  // player at its current offset = player.vel + (player's world-space angular velocity) x (offset).
  // This feeds BOTH the forward axis below and the jink's baseline — the rotational term is often
  // nearly perpendicular to the forward axis (since the drone sits roughly along it), meaning most of
  // its effect actually shows up as lateral/vertical motion, not forward/back, so both need it.
  const playerWorldAngVel = rotateVecByQuat({ x: player.angVel.pitch, y: player.angVel.yaw, z: player.angVel.roll }, player.quat);
  const rotationalVel = cross(playerWorldAngVel, toEnemy);
  const targetVel: Vec3 = {
    x: player.vel.x + rotationalVel.x,
    y: player.vel.y + rotationalVel.y,
    z: player.vel.z + rotationalVel.z
  };
  // lateral/vertical also get a continuous, proportional pull back toward zero offset from the
  // player's nose-line, same idea as the forward axis's forwardShortfall below — without this, the
  // only thing bounding lateral/vertical drift was MPC's periodic (and, on its own, insufficient)
  // per-replan drift-cost judgment.
  const lateralNow = toEnemy.x * playerRight.x + toEnemy.y * playerRight.y + toEnemy.z * playerRight.z;
  const verticalNow = toEnemy.x * playerUp.x + toEnemy.y * playerUp.y + toEnemy.z * playerUp.z;
  const playerLateralVel = (targetVel.x * playerRight.x + targetVel.y * playerRight.y + targetVel.z * playerRight.z) - lateralNow * EVASIVE_TUNING.lateralCenteringGain;
  const playerVerticalVel = (targetVel.x * playerUp.x + targetVel.y * playerUp.y + targetVel.z * playerUp.z) - verticalNow * EVASIVE_TUNING.lateralCenteringGain;

  // ---- forward axis: plain velocity-servo ----
  const forwardSep = toEnemy.x * playerForward.x + toEnemy.y * playerForward.y + toEnemy.z * playerForward.z;
  const forwardShortfall = EVASIVE_TUNING.standoffDistance - forwardSep;
  const playerForwardVel = targetVel.x * playerForward.x + targetVel.y * playerForward.y + targetVel.z * playerForward.z;
  const desiredTrackingVel = (playerForwardVel + forwardShortfall * EVASIVE_TUNING.positionCorrectionGain);

  // Full 3D tracking need (forward correction + lateral/vertical baseline+centering, NOT including
  // the jink bias — that's a separate, smaller wobble layered on top via jinkVelocityServo below),
  // combined into one world-space vector. Its DIRECTION drives 'chase' facing (see below) instead of
  // always assuming the need is along playerForward specifically — when the player is mostly
  // ROTATING rather than translating, the actual dominant correction can point almost anywhere, and
  // pointing main thrust at a hardcoded axis that isn't where the need actually is wastes it.
  const desiredVelFull: Vec3 = {
    x: playerForward.x * desiredTrackingVel + playerRight.x * playerLateralVel + playerUp.x * playerVerticalVel,
    y: playerForward.y * desiredTrackingVel + playerRight.y * playerLateralVel + playerUp.y * playerVerticalVel,
    z: playerForward.z * desiredTrackingVel + playerRight.z * playerLateralVel + playerUp.z * playerVerticalVel
  };
  const velDeficitFull: Vec3 = {
    x: desiredVelFull.x - enemy.vel.x,
    y: desiredVelFull.y - enemy.vel.y,
    z: desiredVelFull.z - enemy.vel.z
  };
  const velDeficitMag = Math.hypot(velDeficitFull.x, velDeficitFull.y, velDeficitFull.z);
  const chaseDir = velDeficitMag > 1e-3
    ? { x: velDeficitFull.x / velDeficitMag, y: velDeficitFull.y / velDeficitMag, z: velDeficitFull.z / velDeficitMag }
    : playerForward;

  // ---- chase/watch facing hysteresis (see the doc comment above) ----
  if (ai.chaseCooldownTimer > 0) ai.chaseCooldownTimer -= dt;
  if (ai.chasing) {
    if (velDeficitMag < EVASIVE_TUNING.chaseExitVelDeficit) {
      ai.chasing = false;
      ai.chaseStruggleTimer = 0;
    } else if (velDeficitMag > EVASIVE_TUNING.chaseEnterVelDeficit * EVASIVE_TUNING.chaseStruggleTolerance) {
      // chasing hasn't meaningfully closed the gap — accumulate struggle time. This is exactly what
      // happens when the player holds a sustained turn/rotation at (or near) the drone's own max
      // rate: both fly the same ship, so nose-chasing a continuously-moving target direction can
      // never actually catch up — it's not a tuning problem, it's a real physical tie at best.
      ai.chaseStruggleTimer += dt;
      if (ai.chaseStruggleTimer > EVASIVE_TUNING.chaseStruggleLimitSec) {
        // Give up trying to out-turn the player and force an immediate break instead. Real evasive
        // pilots don't try to physically match an opponent's sustained turn rate at a fixed
        // range — once out-rotated, the winning move is a sudden, unpredictable direction change
        // (or bailing for the opponent's six), not grinding out a turn you can't win. Reverting to
        // 'watch' stops main thrust fighting a losing reorientation, and forcing the jink planner to
        // replan NOW (rather than waiting out its normal cadence) is the "suddenly change direction"
        // half of that response — the MPC planner, now unburdened by a hopeless chase, is free to
        // pick whatever break actually helps.
        ai.chasing = false;
        ai.chaseStruggleTimer = 0;
        ai.chaseCooldownTimer = EVASIVE_TUNING.chaseCooldownSec;
        ai.jinkReplanTimer = 0;
      }
    } else {
      ai.chaseStruggleTimer = 0; // genuinely closing the gap — no struggle, keep chasing normally
    }
  } else if (velDeficitMag > EVASIVE_TUNING.chaseEnterVelDeficit && ai.chaseCooldownTimer <= 0) {
    ai.chasing = true;
  }

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

  // Bank always aligns to the committed jink's own bank angle (never the player's) — rolling the
  // drone's OWN "up" axis to point along the jink's full world direction, so jinkVelocityServo routes
  // the break through the strong up-thruster at whatever the committed ±45°/±90° bank angle is,
  // rather than an unrolled hull splitting thrust across two axes. ai.jinkStrafeX/Y is never (0, 0)
  // (see MPC_JINK_DIRECTIONS — no "hold" candidate), so jinkWorldDirMag is always well above the
  // epsilon fallback in practice; the fallback exists purely for numerical safety.
  const jinkWorldDir: Vec3 = {
    x: playerRight.x * ai.jinkStrafeX + playerUp.x * ai.jinkStrafeY,
    y: playerRight.y * ai.jinkStrafeX + playerUp.y * ai.jinkStrafeY,
    z: playerRight.z * ai.jinkStrafeX + playerUp.z * ai.jinkStrafeY
  };
  const jinkWorldDirMag = Math.hypot(jinkWorldDir.x, jinkWorldDir.y, jinkWorldDir.z);
  const bankHint = jinkWorldDirMag > 1e-3
    ? { x: jinkWorldDir.x / jinkWorldDirMag, y: jinkWorldDir.y / jinkWorldDirMag, z: jinkWorldDir.z / jinkWorldDirMag }
    : playerUp;

  // nose faces the player by default, swings to face the ACTUAL direction of the combined tracking
  // need while genuinely catching up (see chase/watch doc comment and chaseDir above — not a
  // hardcoded axis), snaps to face the player for a shootback window regardless of chase state (a
  // shot is more useful than a marginal thrust-efficiency gain)
  const steerDir = (ai.mode === 'shootback' || !ai.chasing) ? aimDir : chaseDir;
  const steer = steeringToward(enemy.quat, steerDir, EVASIVE_TUNING.steerGain, bankHint);

  // main thrust projected onto the drone's OWN current nose — this still works correctly regardless
  // of which way the nose points (watch vs. chase), same reasoning jinkVelocityServo below needs for
  // the jink: whatever axis is CURRENTLY available gets whatever fraction of the FULL tracking need
  // it can actually deliver. Using the full 3D deficit (not just its forward-axis component) means
  // main thrust pulls its actual weight even while chase is still turning to fully align. Overridden
  // to full forward during an active pass-through window (see the forced-break block above) — nose
  // is normally facing the player ('watch' mode), so this is what actually makes it try to blow past
  // instead of the standoff servo just continuing to hold/extend range.
  const { forward: enemyForward, right: enemyRight, up: enemyUp } = computeAxes(enemy.quat);
  const throttle = ai.passThroughTimer > 0
    ? 1
    : clamp((velDeficitFull.x * enemyForward.x + velDeficitFull.y * enemyForward.y + velDeficitFull.z * enemyForward.z) / EVASIVE_TUNING.velocityBand, -1, 1);

  // ---- MPC jink replan (see this section's doc comment) ----
  ai.jinkReplanTimer -= dt;
  if (ai.jinkReplanTimer <= 0) {
    let bestCost = Infinity, bestX = MPC_JINK_DIRECTIONS[0].x, bestY = MPC_JINK_DIRECTIONS[0].y;
    for (const dir of MPC_JINK_DIRECTIONS) {
      const outcome = simulateJinkCandidate(enemy, throttle, dir.x, dir.y, playerRight, playerUp, playerLateralVel, playerVerticalVel);
      const cost = scoreJinkCandidate(outcome.pos, outcome.vel, dir.x, dir.y, ai.jinkStrafeX, ai.jinkStrafeY, player, playerForward, playerRight, playerUp, enemy.type.hullRadius);
      if (cost < bestCost) {
        bestCost = cost;
        bestX = dir.x;
        bestY = dir.y;
      }
    }
    ai.jinkStrafeX = bestX;
    ai.jinkStrafeY = bestY;
    ai.jinkReplanTimer = threatened ? EVASIVE_TUNING.mpcThreatReplanSec : EVASIVE_TUNING.mpcReplanSec;
  }

  // ai.jinkStrafeX/jinkStrafeY are the committed PLAYER-frame jink bias direction (see
  // jinkVelocityServo's doc comment) — recomputed into actual strafeX/strafeY every tick, not just at
  // the moment they were chosen, since a committed direction can persist across many replans while
  // both the nose keeps slowly re-aiming and the player keeps moving/rotating in the meantime.
  const jink = jinkVelocityServo(ai.jinkStrafeX, ai.jinkStrafeY, playerLateralVel, playerVerticalVel, enemy.vel, playerRight, playerUp, enemyRight, enemyUp);

  // Always boosted: the drone is always mid-break (no "hold" state — see MPC_JINK_DIRECTIONS), and a
  // real evasive break is flown with the afterburner lit, not requested only as a last resort.
  const boostRequested = true;

  return {
    inputs: {
      throttle,
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      strafeX: clamp(jink.strafeX, -1, 1),
      strafeY: clamp(jink.strafeY, -1, 1),
      brake: false,
      decoupled: false
    },
    boostRequested,
    wantsToFire: ai.mode === 'shootback',
    aimDir
  };
}
