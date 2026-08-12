import type { AngularState, Quat, ShipType, Vec3 } from '../core/types';
import { clamp, addScaled } from '../math/vec';
import { computeAxes, integrateOrientation } from '../math/quaternion';

// ============================================================================================
// Newtonian ship flight model — PORTED VERBATIM from the original 2D-canvas project
// (starcitizen_flightsim/src/physics/flightModel.ts). Every constant and every ordering choice
// here is fit to frame-counted real-Star-Citizen-Gladius measurements; the load-bearing invariants
// are documented in the original project's CLAUDE.md and in physics/ships/gladius.ts here. Do not
// "clean this up" without re-deriving against real traces — it has been gotten wrong twice before.
// ============================================================================================

// rad/s and rad/s^2 — purely a numerical-hygiene snap (NOT a perceptual one, unlike the old 1st-order
// model's threshold this replaced): once pitch/yaw's 2nd-order spool tracker (below) has released and
// settled to within float dust of zero, hard-zero both state variables so a long-idle ship doesn't
// carry meaningless residue forever. The genuine overshoot/settle wobble the 2nd-order model produces
// is real (measured) and intentionally NOT truncated early by this — it's orders of magnitude tighter
// than the perceptual threshold this model needed before.
const ANGULAR_SETTLE_EPSILON = 1e-4;

// m/s — below this, an axis counts as "from rest" (and so ALIGNED) rather than as a velocity to be
// countered. Purely numerical hygiene: without it, float dust of the opposite sign would put an axis in
// the countering branch (which contributes no thrust to `accel`) for a tick before it snaps to a true
// zero. Far below anything the real-game HUD could resolve, so it can't mask measured behaviour.
const COUNTER_VEL_EPSILON = 1e-3;

// Ship-shaped state this model reads/mutates — a subset both the player ShipBody and an AI-flown
// EnemyShip satisfy, so the exact same Newtonian flight model drives both (see combat/enemyAI.ts).
export interface FlightBody {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: AngularState;
  // Angular acceleration state for pitch/yaw's 2nd-order spool-up/release tracker (see
  // integrateFlight's rotation block) — roll doesn't use this (its own spin-up/release model needs
  // only angVel), so its component is always 0.
  angAccel: AngularState;
  boosting: boolean;
  throttleSpoolTime: number;
  verticalSpoolTime: number;
}

// One tick's worth of control intent — everything the model needs to move `body`, however it was
// produced (player input in control/pilot.ts, AI decisions in combat/enemyAI.ts).
export interface FlightInputs {
  throttle: number;                          // -1..1, main/retro thrust intent
  pitch: number; yaw: number; roll: number;  // rotation thruster intent (clamped internally)
  strafeX: number; strafeY: number;          // lateral/vertical thruster intent (clamped internally)
  brake: boolean;
  decoupled: boolean;
}

// One axis of pitch/yaw rotation: the 2nd-order underdamped spring-damper for spin-up-from-rest and
// release-to-neutral, but a separate constant-decel REVERSAL branch when `target` opposes the ship's
// CURRENT spin (a hard flip, not a release) — real Gladius decelerates through a reversal at a
// roughly constant rate rather than the spring-damper's oscillating approach. See gladius.ts's
// pitchYawReversalDecel doc and capture/MEASUREMENTS.md's "Reversal stop-time — felt-threshold
// method" section (2026-07-27/28, applied per user go-ahead 2026-07-28). `accel` resets to 0 on
// crossing back through zero so the post-reversal spool-up starts fresh from rest, same as a genuine
// standing start — not carrying over the braking phase's own transient state.
function stepPitchYawAxis(
  prevVel: number, prevAccel: number, target: number,
  omega: number, zeta: number, reversalDecel: number, dt: number
): { vel: number; accel: number } {
  if (prevVel !== 0 && target !== 0 && Math.sign(prevVel) !== Math.sign(target)) {
    const decelStep = reversalDecel * dt;
    const vel = Math.abs(prevVel) <= decelStep ? 0 : prevVel - Math.sign(prevVel) * decelStep;
    return { vel, accel: 0 };
  }
  const accel = prevAccel + (-2 * zeta * omega * prevAccel - omega * omega * (prevVel - target)) * dt;
  return { vel: prevVel + accel * dt, accel };
}

// Applies one physics tick of rotation, thrust, drag, and speed-capping to `body` — shared by both
// the player ship and any AI-flown EnemyShip so they fly on the same rules. `body.boosting` is
// expected to already be resolved by the caller (see resolveBoost below) — boost-meter bookkeeping
// happens on the caller's own schedule (e.g. combat/combatSystem.ts still ticks it while a ship is
// mid-respawn), so it isn't folded into this function.
export function integrateFlight(body: FlightBody, input: FlightInputs, dt: number): void {
  const t = body.type;

  const rawPitch = clamp(input.pitch, -1, 1);
  const rawYaw = clamp(input.yaw, -1, 1);
  const rawRoll = clamp(input.roll, -1, 1);

  // Real RCS thrusters draw from one shared rotational-authority budget across pitch/yaw/roll —
  // without this, each axis independently reaches its own max simultaneously, so combining axes
  // gives a "free" diagonal speed boost (vector sum of independent maxes) instead of splitting a
  // fixed budget.
  const inputMag = Math.hypot(rawPitch, rawYaw, rawRoll);
  const inputScale = inputMag > 1 ? 1 / inputMag : 1;
  const pitchInput = rawPitch * inputScale;
  const yawInput = rawYaw * inputScale;
  const rollInput = rawRoll * inputScale;

  // boosting raises RCS authority (angularThrust) and the rotation-rate ceiling (maxAngVel)
  // together — angularThrust is still derived as maxAngVel * angularDrag either way (see
  // shipTypes.ts), so full input converges to the boosted rate instead of the normal one.
  const angularThrust = body.boosting ? t.boostAngularThrust : t.angularThrust;
  const maxAngVel = body.boosting ? t.boostMaxAngVel : t.maxAngVel;

  const prevAngVel = { pitch: body.angVel.pitch, yaw: body.angVel.yaw, roll: body.angVel.roll };

  // PITCH/YAW rotation: 2nd-order underdamped step-response tracker (mass-spring-damper-like) for
  // spin-up (input applied) AND release-to-neutral (input dropped) — real Gladius's rate-vs-time
  // curve for both is a genuine overshoot-and-settle wobble, not the old two-part scheme (proportional
  // forcing while held + an exponential-decay-with-snap-to-zero approximation on release) this
  // replaced. See gladius.ts's angularSpoolOmega/Zeta doc for the fitted values and
  // capture/MEASUREMENTS.md's "Spool-up transient is a 2nd-order underdamped step response" section
  // for the full derivation.
  //   angAccel += (-2*zeta*omega*angAccel - omega^2*(angVel - target)) * dt
  //   angVel   += angAccel * dt
  // A REVERSAL (target opposes the ship's current spin, not just dropping to neutral) is NOT this
  // same equation with a negated target — real Gladius decelerates through a reversal at a roughly
  // constant rate instead (see gladius.ts's pitchYawReversalDecel doc and MEASUREMENTS.md's
  // "Reversal stop-time" section, applied per user go-ahead 2026-07-28); stepPitchYawAxis above
  // branches on this. This SUPERSEDES the prior assumption (release and reversal share one equation)
  // for the reversal case specifically — release-to-neutral is unaffected.
  const spoolOmega = body.boosting ? t.boostAngularSpoolOmega : t.angularSpoolOmega;
  const spoolZeta = body.boosting ? t.boostAngularSpoolZeta : t.angularSpoolZeta;
  const pitchTarget = pitchInput * maxAngVel.pitch;
  const yawTarget = yawInput * maxAngVel.yaw;
  const pitchStep = stepPitchYawAxis(prevAngVel.pitch, body.angAccel.pitch, pitchTarget,
    spoolOmega.pitch, spoolZeta.pitch, t.pitchYawReversalDecel.pitch, dt);
  const yawStep = stepPitchYawAxis(prevAngVel.yaw, body.angAccel.yaw, yawTarget,
    spoolOmega.yaw, spoolZeta.yaw, t.pitchYawReversalDecel.yaw, dt);
  body.angVel.pitch = pitchStep.vel; body.angAccel.pitch = pitchStep.accel;
  body.angVel.yaw = yawStep.vel; body.angAccel.yaw = yawStep.accel;

  // Roll release is a hard, roughly-constant-deceleration GOVERNOR stop (measured ~40deg roll-out
  // from full rate in ~0.5s), NOT the proportional/exponential drag used for spin-up (unchanged below)
  // — see shipTypes.rollReleaseDecel and capture/BLUEPRINT.md's roll-reversal findings (fitted drag
  // pins at exactly 0 during release, across 5 independent trials). Roll keeps this separate model —
  // no 2nd-order roll data exists (see gladius.ts's angularSpoolOmega doc).
  if (rollInput !== 0) {
    body.angVel.roll += (rollInput * angularThrust.roll / t.mass) * dt - (prevAngVel.roll * t.angularDrag.roll / t.mass) * dt;
  } else {
    const decelStep = t.rollReleaseDecel * dt;
    body.angVel.roll = Math.abs(prevAngVel.roll) <= decelStep
      ? 0
      : prevAngVel.roll - Math.sign(prevAngVel.roll) * decelStep;
  }

  // Numerical-only hygiene snap once fully released and settled (see ANGULAR_SETTLE_EPSILON's doc) —
  // gated on the axis's own target being zero so it never stomps genuine in-progress rotation.
  if (pitchTarget === 0 && Math.abs(body.angVel.pitch) < ANGULAR_SETTLE_EPSILON && Math.abs(body.angAccel.pitch) < ANGULAR_SETTLE_EPSILON) {
    body.angVel.pitch = 0; body.angAccel.pitch = 0;
  }
  if (yawTarget === 0 && Math.abs(body.angVel.yaw) < ANGULAR_SETTLE_EPSILON && Math.abs(body.angAccel.yaw) < ANGULAR_SETTLE_EPSILON) {
    body.angVel.yaw = 0; body.angAccel.yaw = 0;
  }

  // NOTE: pitch/yaw are deliberately NOT clamped to maxAngVel here (unlike roll) — the whole point of
  // the 2nd-order model above is that real SC's rotation transiently OVERSHOOTS the steady-state rate
  // before settling (zeta < 1 in all 4 measured conditions); a hard ceiling would clip that genuine
  // wobble AND corrupt the tracker's own state (next tick's forcing term reads body.angVel.pitch/yaw
  // straight back as prevAngVel). The spring-damper equation's target IS maxAngVel/boostMaxAngVel, so
  // steady-state still converges there on its own — this omission is intentional, not a leftover gap.
  body.angVel.roll = clamp(body.angVel.roll, -maxAngVel.roll, maxAngVel.roll);

  body.quat = integrateOrientation(body.quat, body.angVel, dt);

  const { forward, right, up } = computeAxes(body.quat);

  const strafeX = clamp(input.strafeX, -1, 1);
  const strafeY = clamp(input.strafeY, -1, 1);
  const throttle = clamp(input.throttle, -1, 1);

  // Engine spool: real Gladius measured to have a short (well under a second) startup lag after a
  // standing-start throttle press before main/retro thrust actually catches — see shipTypes.ts for
  // the frame-by-frame data this is fit to. Forward and backward spool at different rates (they're
  // different thrusters), so each direction gets its own delay. Timer resets the instant throttle
  // returns to zero, so it re-spools on every fresh press from a stop, not just the very first one.
  // Only gates main/retro (throttle) — no data suggests strafe/vertical or boost share this.
  body.throttleSpoolTime = throttle === 0 ? 0 : body.throttleSpoolTime + dt;
  const spoolDelay = throttle >= 0 ? t.mainSpoolDelay : t.retroSpoolDelay;
  const spooledUp = body.boosting || body.throttleSpoolTime >= spoolDelay;

  // Same idea, for vertical strafe — real Gladius also showed a short startup lag on that axis
  // (unlike lateral strafe, which showed none) — see shipTypes.ts.
  body.verticalSpoolTime = strafeY === 0 ? 0 : body.verticalSpoolTime + dt;
  const verticalSpooledUp = body.boosting || body.verticalSpoolTime >= t.verticalSpoolDelay;

  // ---- ALIGNED vs COUNTERING role, per local axis (measured 2026-08-02 — see physics/ships/gladius.ts's
  // "BOOSTED LINEAR: TWO REGIMES" note and RETRO.md). Every BOOSTED linear axis behaves in two genuinely
  // different ways depending on the job the thruster is doing, confirmed on four independent axes:
  //   ALIGNED    — pushing further along that axis's existing velocity, or from rest: high boosted
  //                thrust vs real proportional drag, curving to an asymptote above the speed cap.
  //   COUNTERING — thrust OPPOSING an existing velocity on that axis (braking/reversing): a FLAT
  //                constant decel with NO drag, at only ~62% of the aligned rate.
  //
  // Why this cannot be a constants-only fix — braking 226 m/s of forward cruise with boosted reverse:
  //     old boostLinearThrust.retro 216.5 + drag 0.38   ->  144.3 + 85.9 = 230 m/s^2  ->  ~1.2s
  //     retro retuned to 2.09x63 = 131.7, drag still on ->   87.8 + 85.9 = 174 m/s^2  ->  ~1.7s
  //     COUNTERING role: flat 1.30x63/1.5 = 54.6, no drag ->        54.6 m/s^2 flat   ->  ~4.1s
  // Only the third reproduces the measured ~4.0s. CLAUDE.md warns this file has been "cleaned up"
  // wrongly twice before — collapsing these two regimes back into one thrust per axis is that mistake.
  //
  // UNBOOSTED needs no branch and is deliberately untouched: the input sign already selects the
  // opposing thruster and linearDrag (0.001) is negligible, so unboosted countering is already flat at
  // exactly 1.00x that thruster's accel — which is what the unboosted captures measured.
  //
  // Velocity is decomposed into the ship's LOCAL frame because each rate belongs to a specific
  // local-axis thruster, not to the direction of travel (same right/up/forward basis the brake and
  // coast blocks below use). Read before anything this tick mutates body.vel, so the role is decided
  // against the velocity the pilot is actually reacting to.
  const preVelRight = body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z;
  const preVelUp = body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z;
  const preVelForward = body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z;
  const isCountering = (axisInput: number, axisVel: number): boolean =>
    body.boosting && axisInput !== 0
    && Math.abs(axisVel) > COUNTER_VEL_EPSILON
    && Math.sign(axisInput) !== Math.sign(axisVel);
  const counteringLongitudinal = isCountering(throttle, preVelForward);
  const counteringLateral = isCountering(strafeX, preVelRight);
  const counteringVertical = isCountering(strafeY, preVelUp);

  // Lateral/vertical thrust authority drops sharply as forward speed climbs — measured 2026-08-04
  // via TVI-marker-tracked speed-sweep captures (boost+forward to a range of speeds, forward
  // released, brief strafe taps read against the HUD speed and converted through the TVI's own
  // pinhole projection — see capture/MEASUREMENTS.md). Boosting forward and strafing at the same
  // time gives far less strafe than the same strafe commanded from a stop, well before
  // boostManeuveringSpeedCap above ever engages — a real, separate effect, not this model's
  // existing shared-rotational-input-budget pattern (user directly tested and ruled out input
  // competition: releasing forward input barely changes it, so this is keyed on velocity, not on
  // whether forward is currently held).
  // NOT boost-specific: a follow-up capture (coast unboosted, above scmSpeed, on residual momentum
  // from a released boost) found the same effect well above scmSpeed too — but shaped differently
  // from the boosted case, not just rescaled. Boosted authority is already visibly reduced well
  // BELOW boostSpeedForward (measured ~7% left at 378/520 of the way to cap), i.e. it tapers across
  // the whole 0..cap range. Unboosted authority instead reads close to FULL right up to its own cap
  // (scmSpeed, 226 — matches an earlier, separate capture at cruise) and only collapses once
  // COASTING ABOVE that cap, which in normal play only happens via exactly this boost-then-release
  // trick. So the two modes share the same quadratic-taper shape but measure a different quantity:
  // boosted tapers on raw speed toward its cap, unboosted tapers on how far current speed sits
  // ABOVE its cap (0 excess -> full authority, a full cap's-worth of excess -> none).
  // ROUGH fit only, per user go-ahead: manual single-tap captures were too noisy (2-3x spread
  // between reps at the same speed) to fit a precise curve. Revisit with cleaner (longer-hold or
  // multi-rep) captures if this ever needs to be more than a rough feel-match. Backward flight
  // (preVelForward < 0) is unmeasured and left unsuppressed. Applies only to ALIGNED lateral/
  // vertical thrust — not the countering role (unmeasured).
  const lateralSpeedAuthority = body.boosting
    ? Math.pow(1 - clamp(preVelForward, 0, t.boostSpeedForward) / t.boostSpeedForward, 2)
    : Math.pow(1 - clamp(preVelForward - t.scmSpeed, 0, t.scmSpeed) / t.scmSpeed, 2);

  // boosting raises main/retro thrust the same way it raises angular thrust above — without this,
  // boosting only lifted the speed *cap* while leaving thrust unchanged, and since linearDrag
  // makes unboosted thrust settle at exactly scmSpeed by construction, the ship could never
  // actually climb to a speed where the higher cap mattered. This is the ALIGNED role only; a
  // COUNTERING axis contributes NOTHING to `accel` and is handled in velocity space further down.
  const mainThrust = body.boosting ? t.boostLinearThrust.main : t.linearThrust.main;
  const retroThrust = body.boosting ? t.boostLinearThrust.retro : t.linearThrust.retro;
  const mainThrustMag = spooledUp && !counteringLongitudinal
    ? (throttle >= 0 ? throttle * mainThrust : throttle * retroThrust)
    : 0;
  // boosting raises strafe/vertical thrust too (applied 2026-07-25, per user go-ahead — see
  // shipTypes.ts's "Boosted lateral/vertical" note) — without this, boosted lateral/vertical jinks flew
  // at the unboosted rate despite boostManeuveringSpeedCap below allowing a higher top speed there.
  const strafeThrust = body.boosting ? t.boostLinearThrust.strafe : t.linearThrust.strafe;
  const strafeThrustMag = counteringLateral ? 0 : strafeX * strafeThrust * lateralSpeedAuthority;
  const verticalThrust = body.boosting
    ? (strafeY >= 0 ? t.boostLinearThrust.verticalUp : t.boostLinearThrust.verticalDown)
    : (strafeY >= 0 ? t.linearThrust.verticalUp : t.linearThrust.verticalDown);
  const verticalThrustMag = verticalSpooledUp && !counteringVertical
    ? strafeY * verticalThrust * lateralSpeedAuthority
    : 0;
  const accel: Vec3 = { x: 0, y: 0, z: 0 };
  addScaled(accel, forward, mainThrustMag / t.mass);
  addScaled(accel, right, strafeThrustMag / t.mass);
  addScaled(accel, up, verticalThrustMag / t.mass);

  // Flat countering decel magnitudes (m/s^2) for whichever axes are in that role. Thruster selection
  // stays keyed on INPUT sign, unchanged from the aligned case above — in the countering role that is
  // by definition the opposing thruster (reverse input against forward motion -> retro; up input
  // against downward motion -> verticalUp), which is exactly what was measured.
  //
  // Scaled by |input|, deliberately UNLIKE pitchYawReversalDecel (documented as saturating early and so
  // ignoring stick magnitude): throttle is a ramped analog float (throttleRampRate ~0.20s for a full
  // traversal — see control/pilot.ts), so an unscaled flat rate would slam full braking authority on
  // from a 2%-deflection first tick and hold it through the whole release ramp. UNMEASURED at partial
  // deflection — this matches how every other linear axis treats partial input, but it is a choice, not
  // a fit. Costs ~0.1s against the measured stop time, well inside its confidence.
  const counterDecelLongitudinal = counteringLongitudinal
    ? Math.abs(throttle) * (throttle >= 0 ? t.boostCounterThrust.main : t.boostCounterThrust.retro) / t.mass
    : 0;
  const counterDecelLateral = counteringLateral
    ? Math.abs(strafeX) * t.boostCounterThrust.strafe / t.mass
    : 0;
  const counterDecelVertical = counteringVertical
    ? Math.abs(strafeY) * (strafeY >= 0 ? t.boostCounterThrust.verticalUp : t.boostCounterThrust.verticalDown) / t.mass
    : 0;

  // Flight computer refuses thrust that would push FURTHER over the speed cap (applied 2026-07-25,
  // per user go-ahead — this is the actual fix for the original reported bug: releasing boost while
  // still holding throttle/strafe must still decay back toward scmSpeed, not freeze at the overspeed
  // value). The governor at the end of this function used to try to cancel this after the fact by
  // matching its bleed rate to whatever thrust was still pushing (Math.max(naturalBleedRate,
  // accelAlongVel)) — since that rate is chosen to exactly match the thrust, the two nets to ~zero
  // and speed freezes instead of decaying (see BOOST_FINDINGS.md's root-cause §3a). Clipping the
  // thrust itself, before it's ever integrated into velocity, is the correct fix instead: only the
  // component of thrust ALONG the current velocity direction is removed, so off-axis
  // steering/strafing thrust still works while the ship bleeds speed — the pilot isn't locked out of
  // maneuvering during the bleed. A fresh boost raises speedCap back up (see below), which is how
  // re-boosting lets speed climb again despite this clip.
  //
  // A COUNTERING axis is structurally immune to this clip, because it contributes nothing to `accel`
  // (see the role block above) — which is correct, and is one of the reasons it's applied in velocity
  // space instead: this clip exists to stop thrust pushing FURTHER over the cap, and braking never
  // does. Second-order consequence to be aware of: since a countering axis no longer contributes a
  // negative term, `accelAlongVel` can now come out positive in mixed states where it used to be
  // negative, so the clip can fire on the remaining ALIGNED axes where it previously didn't. That is
  // precisely the clip's job, and off-axis steering still survives it, but it is a real behaviour
  // change in "overspeed + reverse + strafe" states.
  const preThrustSpeed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
  if (preThrustSpeed > 1e-6) {
    const preSpeedCap = body.boosting
      ? (preVelForward >= 0 ? t.boostSpeedForward : t.boostSpeedBack)
      : (preVelForward >= 0 ? t.scmSpeed : t.scmSpeedBack);
    // >= , not > : the governor below can clamp speed to EXACTLY preSpeedCap (Math.max floor), and a
    // strict > here would then let one full tick of unclipped thrust through right at that boundary,
    // bumping speed back over the cap and re-triggering the governor next tick — an infinite sawtooth
    // between the cap and a few m/s above it, instead of settling stably at the cap.
    if (preThrustSpeed >= preSpeedCap) {
      const velUnit = { x: body.vel.x / preThrustSpeed, y: body.vel.y / preThrustSpeed, z: body.vel.z / preThrustSpeed };
      const accelAlongVel = accel.x * velUnit.x + accel.y * velUnit.y + accel.z * velUnit.z;
      if (accelAlongVel > 0) {
        accel.x -= velUnit.x * accelAlongVel;
        accel.y -= velUnit.y * accelAlongVel;
        accel.z -= velUnit.z * accelAlongVel;
      }
    }
  }

  if (input.brake) {
    // Space brake: each real thruster only pushes along one local axis, and the flight computer
    // fires all of them together to decelerate along the ship's ACTUAL velocity direction — so
    // speed shrinks but the direction of travel never changes (unlike counter-thrusting each local
    // axis independently, which drags the resultant velocity vector off its original heading as
    // axes with different thrust ratings bleed off at different rates). Combining axes to cancel a
    // diagonal velocity is usually *weaker* than any single thruster's rating: whichever axis has
    // the worst thrust-to-required-cancellation ratio (its own accel capacity divided by how much
    // of the velocity direction it alone has to cancel) sets the ceiling for the whole maneuver —
    // full brake power only when velocity is purely aligned to one axis.
    const localVel = {
      x: body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z,          // lateral
      y: body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z,                   // vertical
      z: body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z     // longitudinal
    };
    const speed = Math.hypot(localVel.x, localVel.y, localVel.z);
    if (speed > 1e-6) {
      const longitudinalThrust = localVel.z > 0 ? t.linearThrust.retro : t.linearThrust.main;
      const brakeVerticalThrust = localVel.y > 0 ? t.linearThrust.verticalDown : t.linearThrust.verticalUp;

      const unit = { x: localVel.x / speed, y: localVel.y / speed, z: localVel.z / speed };
      // A unit vector always has at least one component >= 1/sqrt(3) ≈ 0.577, so this always
      // narrows from Infinity — no axis can be simultaneously negligible on all three.
      const AXIS_EPS = 1e-4;
      let maxDecel = Infinity;
      if (Math.abs(unit.x) > AXIS_EPS) maxDecel = Math.min(maxDecel, (t.linearThrust.strafe / t.mass) / Math.abs(unit.x));
      if (Math.abs(unit.y) > AXIS_EPS) maxDecel = Math.min(maxDecel, (brakeVerticalThrust / t.mass) / Math.abs(unit.y));
      if (Math.abs(unit.z) > AXIS_EPS) maxDecel = Math.min(maxDecel, (longitudinalThrust / t.mass) / Math.abs(unit.z));

      // The brake is a flight-computer velocity controller targeting zero speed: it commands a
      // deceleration PROPORTIONAL to current speed (brakeGain * speed), saturated at maxDecel (the
      // combined-axis thruster capacity above). Measured on the real Gladius (forward brake, 226 m/s
      // to a dead stop, 25fps trace): a flat ~40 m/s^2 above ~40 m/s, then a long proportional creep
      // to a near-stop — ~2.4s just from 10 m/s to 0. Fit brakeGain ~= 1.04/s, crossover (where
      // brakeGain*speed meets maxDecel) ~= 40 m/s; reproduces the whole trace to within ~1 m/s.
      // Without the proportional term the brake decelerated flat all the way down and stopped
      // roughly 3x too fast near zero. brakeGain is direction-agnostic (one brake control law) —
      // only forward was traced, but the same easing is applied whichever thruster is doing the
      // work — see shipTypes.ts for the full trace this is fit to.
      const brakeDecel = Math.min(maxDecel, t.brakeGain * speed);
      const newSpeed = Math.max(0, speed - brakeDecel * dt);
      localVel.x = unit.x * newSpeed;
      localVel.y = unit.y * newSpeed;
      localVel.z = unit.z * newSpeed;

      body.vel.x = right.x * localVel.x + up.x * localVel.y + forward.x * localVel.z;
      body.vel.y = right.y * localVel.x + up.y * localVel.y + forward.y * localVel.z;
      body.vel.z = right.z * localVel.x + up.z * localVel.y + forward.z * localVel.z;
    }
  }

  body.vel.x += accel.x * dt;
  body.vel.y += accel.y * dt;
  body.vel.z += accel.z * dt;

  // ---- Boosted COUNTERING: flat per-axis decel, no drag (measured 2026-08-02 — see the role block
  // above). Applied in VELOCITY space rather than as part of `accel`, for three load-bearing reasons:
  //   1. it can be clamped against the axis's velocity AS OF NOW (post-brake, post-aligned-thrust), so
  //      the axis lands EXACTLY on zero and can never overshoot inside one tick at any dt — main.ts
  //      clamps dt to 50ms, where a flat 54.6 m/s^2 step would otherwise be ~2.7 m/s;
  //   2. it is therefore immune to the pre-thrust speed-cap clip above, which is correct: that clip
  //      exists to stop thrust pushing FURTHER over the cap, and countering thrust never does;
  //   3. it mirrors the coast branch's own per-(axis,direction) idiom below — the existing precedent for
  //      "each local-axis thruster decelerates its own axis at its own flat rate".
  //
  // Deliberately NOT under the drag/coast gate below. This is THRUST, not auto-damping, so unlike
  // drag/coast it must still apply (a) in decoupled mode, (b) while the space brake is held, and (c)
  // while overspeed. On (c): for the tick or two where speed is still above the cap, the governor
  // further down also bleeds along the velocity direction, so the two briefly stack. That is bounded —
  // countering only ever REDUCES speed, so it cannot sustain the overlap the way still-held ALIGNED
  // thrust could, which was BOOST_FINDINGS.md §3a/§3b's failure mode and does not apply here.
  //
  // Sits before the forwardSpeed/speedCap/speedAfterThrust hoist below on purpose, so the drag gate and
  // both governors see post-countering velocity.
  if (counterDecelLongitudinal > 0 || counterDecelLateral > 0 || counterDecelVertical > 0) {
    const localVel = {
      x: body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z,
      y: body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z,
      z: body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z
    };
    // The coast branch's decelTowardZero idiom WITHOUT its brakeGain*speed near-zero taper, on purpose:
    // coast's taper is an acknowledged deliberate deviation from its own flat measurement (see that
    // branch's note), whereas this capture is flat all the way down to a 2 m/s reading with a 0.3-0.9
    // RMS linear fit — tapering here would contradict the data it's fit to. Sign comes from CURRENT
    // velocity, not from the role decision, so if the brake or another axis already flipped this axis we
    // still only ever shed toward zero rather than adding speed back.
    const counterAxis = (v: number, decel: number): number => {
      if (decel <= 0) return v;
      const step = decel * dt;
      return Math.abs(v) <= step ? 0 : v - Math.sign(v) * step;
    };
    localVel.x = counterAxis(localVel.x, counterDecelLateral);
    localVel.y = counterAxis(localVel.y, counterDecelVertical);
    localVel.z = counterAxis(localVel.z, counterDecelLongitudinal);

    body.vel.x = right.x * localVel.x + up.x * localVel.y + forward.x * localVel.z;
    body.vel.y = right.y * localVel.x + up.y * localVel.y + forward.y * localVel.z;
    body.vel.z = right.z * localVel.x + up.z * localVel.y + forward.z * localVel.z;
  }

  // Hoisted so the coast/drag gate below and the final governor agree on the same cap — see the
  // governor's own comment further down for what speedCap means and why it depends on body.boosting.
  // Computed AFTER the countering pass above, so "afterThrust" includes any flat braking this tick.
  const forwardSpeed = body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z;
  const speedCap = body.boosting
    ? (forwardSpeed >= 0 ? t.boostSpeedForward : t.boostSpeedBack)
    : (forwardSpeed >= 0 ? t.scmSpeed : t.scmSpeedBack);
  const speedAfterThrust = Math.hypot(body.vel.x, body.vel.y, body.vel.z);

  // Drag / coast — skipped while braking (brake already counter-thrusts at max), in decoupled mode
  // (no auto-damping, coast freely), and at/above the speed cap (added 2026-07-25, per user go-ahead):
  // the governor below is now the SOLE decay authority once overspeed, so coast/drag can't stack with
  // it and double-count the bleed (see BOOST_FINDINGS.md's root-cause §3b). STRICT less-than, not
  // <=: at velocity sitting exactly ON the cap this must stay off (matching the pre-thrust clip's own
  // >= trigger above), or a resting-at-cap ship would get an extra tick of full drag/coast on top of
  // already-clipped thrust, overshoot back under the cap, let unclipped thrust re-cross it next tick,
  // and cycle forever instead of settling — reproduced as an infinite oscillation before this fix.
  //
  // Boosted COUNTERING is deliberately NOT under this gate — see its own block above for why (it's
  // thrust, not auto-damping, so decoupled/brake/overspeed must not switch it off).
  if (!input.decoupled && !input.brake && speedAfterThrust < speedCap) {
    if (throttle !== 0 || strafeX !== 0 || strafeY !== 0) {
      // Proportional drag while actively thrusting — applied PER LOCAL AXIS, not to the whole velocity
      // vector. Two measured reasons (2026-08-02, see the role block above):
      //   - a COUNTERING axis has NO drag at all (its decel is dead flat across the entire speed range),
      //     so it must be excluded rather than damped a second time on top of the flat rate the
      //     countering block already applied;
      //   - each axis's boosted drag is its OWN value, derived so that axis's asymptote clears its OWN
      //     cap (see physics/ships/linearInvariant.ts) — main's has to exceed 520 while the maneuvering
      //     axes settle near 440, so one shared scalar cannot serve both.
      // Only axes actually firing an ALIGNED thruster get drag: it's a component of that axis's own
      // aligned thrust-curve fit, so it has no measured meaning on an axis with no thrust on it. An idle
      // axis's drift is therefore undamped until input is released and the coast branch below takes over
      // — consistent with unboosted flight, where linearDrag (0.001) already damps nothing. The
      // alternative (keep damping idle axes) was rejected as incoherent: it would make an axis
      // decelerate FASTER once its own input was released (0.38*200 = 76 > the 56.5 countering rate).
      // Unboosted is numerically unaffected either way at linearDrag = 0.001.
      const dragLateral = counteringLateral || strafeX === 0 ? 0
        : (body.boosting ? t.boostLinearDrag.strafe : t.linearDrag);
      const dragVertical = counteringVertical || strafeY === 0 ? 0
        : (body.boosting ? (strafeY >= 0 ? t.boostLinearDrag.verticalUp : t.boostLinearDrag.verticalDown) : t.linearDrag);
      const dragLongitudinal = counteringLongitudinal || throttle === 0 ? 0
        : (body.boosting ? (throttle >= 0 ? t.boostLinearDrag.main : t.boostLinearDrag.retro) : t.linearDrag);
      const localVel = {
        x: body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z,
        y: body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z,
        z: body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z
      };
      localVel.x -= localVel.x * dragLateral * dt;
      localVel.y -= localVel.y * dragVertical * dt;
      localVel.z -= localVel.z * dragLongitudinal * dt;
      body.vel.x = right.x * localVel.x + up.x * localVel.y + forward.x * localVel.z;
      body.vel.y = right.y * localVel.x + up.y * localVel.y + forward.y * localVel.z;
      body.vel.z = right.z * localVel.x + up.z * localVel.y + forward.z * localVel.z;
    } else {
      // Per-(axis,direction) coast decel = opposing thruster's own accel (thrust/mass), NOT an
      // isotropic scalar speed decay — real Gladius sheds forward/back/lateral/vertical drift at
      // whichever local thruster would be firing to counter it, each at its own rate (measured,
      // see physics/ships/gladius.ts's applied perAxisCoastDecel note): forward coasts down via retro
      // (42 m/s^2), back via main (134), lateral via strafe (~97 both ways), up via verticalDown (49),
      // down via verticalUp (98) — the flat ShipType.coastDecel scalar (~matches forward's 42) is no
      // longer read here, kept only as an informational/legacy field. Decomposed into the ship's local
      // frame (same right/up/forward basis the brake block above uses) since each rate is tied to a
      // specific local-axis thruster, not to the ship's actual direction of travel — unlike the brake,
      // this does NOT preserve heading; each local axis decelerates independently.
      //
      // Near-zero taper: per user go-ahead 2026-07-25 (measured coast is flat all the way per
      // MEASUREMENTS.md — this is a deliberate, acknowledged deviation from that capture, not a
      // re-fit) each axis's flat rate above is now also capped by the brake's own brakeGain*speed
      // proportional term, same as the brake block above, so the last stretch to a dead stop eases
      // off exactly like the brake does instead of snapping to zero — full authority still applies
      // above the brakeGain/rate crossover, matching measured behavior there.
      //
      // Do NOT unify this with the boosted COUNTERING block above, however similar they look: this is
      // 1.00x the opposing thruster with a near-zero taper (no input at all, unboosted rates), that one
      // is 1.30x the same quantity, dead flat, with input held under boost. They are two separate
      // measurements that happen to share a basis.
      const localVel = {
        x: body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z,
        y: body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z,
        z: body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z
      };
      const decelTowardZero = (v: number, maxDecelPerSec: number): number => {
        const rate = Math.min(maxDecelPerSec, t.brakeGain * Math.abs(v));
        const step = rate * dt;
        return Math.abs(v) <= step ? 0 : v - Math.sign(v) * step;
      };
      const lateralDecel = t.linearThrust.strafe / t.mass;
      const verticalDecel = localVel.y > 0 ? t.linearThrust.verticalDown / t.mass : t.linearThrust.verticalUp / t.mass;
      const longitudinalDecel = localVel.z > 0 ? t.linearThrust.retro / t.mass : t.linearThrust.main / t.mass;
      localVel.x = decelTowardZero(localVel.x, lateralDecel);
      localVel.y = decelTowardZero(localVel.y, verticalDecel);
      localVel.z = decelTowardZero(localVel.z, longitudinalDecel);

      body.vel.x = right.x * localVel.x + up.x * localVel.y + forward.x * localVel.z;
      body.vel.y = right.y * localVel.x + up.y * localVel.y + forward.y * localVel.z;
      body.vel.z = right.z * localVel.x + up.z * localVel.y + forward.z * localVel.z;
    }
  }

  // Flight-computer speed limiter: caps velocity at SCM speed (or the ship's separate, lower
  // reverse-speed cap when actually flying backward relative to its own nose), raised to the
  // ship's (directional) boost speed while boosting. Enforced regardless of decoupled — in SC,
  // decoupling removes the auto-damping that kills your drift when you let go of the stick, but it
  // does NOT let you exceed SCM/boost speed. When over cap, speed bleeds down at a bounded rate
  // rather than snapping to the cap in a single frame — a boost wearing off should feel like a
  // deceleration, not a teleport. This is now the SOLE decay authority while overspeed (2026-07-25,
  // per user go-ahead): thrust along the velocity direction was already clipped to a no-op above
  // (see the pre-thrust clip block), and coast/drag is gated off above cap too, so decelRate is
  // always just the natural bleed rate — no more Math.max(naturalBleedRate, accelAlongVel) letting
  // still-held thrust cancel its own bleed (BOOST_FINDINGS.md §3a) or coast/drag double-counting it
  // (§3b). Speed now always decays back to speedCap regardless of what input is held, UNLESS boost is
  // re-activated, which raises speedCap back up so the ship is no longer "overspeed" against it.
  //
  // One documented exception to "sole decay authority" since 2026-08-02: boosted COUNTERING is
  // intentionally NOT gated off above the cap (see its block above), so for the tick or two spent over
  // cap while braking, this governor and that flat rate both bleed. Bounded and self-limiting, because
  // countering only ever reduces speed — unlike the still-held-thrust case §3a was about, it can't
  // sustain the overlap.
  const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
  if (speed > speedCap) {
    const decelRate = (forwardSpeed >= 0 ? t.linearThrust.retro : t.linearThrust.main) / t.mass;
    const maxDelta = decelRate * dt;
    const newSpeed = Math.max(speedCap, speed - maxDelta);
    const scale = newSpeed / speed;
    body.vel.x *= scale;
    body.vel.y *= scale;
    body.vel.z *= scale;
  }

  // Maneuvering cap: the governor above bounds TOTAL speed magnitude, selected by the sign of the
  // forward component — so on its own it only ever applies scmSpeed/Back or boostSpeedForward/Back,
  // letting pure sideways/vertical flight bleed into (and cap out at) the same speed as pure forward
  // flight. Real Gladius governs the lateral+vertical (non-longitudinal) component on its own, lower
  // cap instead — measured for boost (boostManeuveringSpeedCap, 394 m/s — see gladius.ts's
  // "boostManeuveringSpeedCap CORRECTED" note); EXTRAPOLATED for unboosted (maneuveringSpeedCap, since
  // no real capture of an unboosted maneuvering cap exists — see gladius.ts and core/types.ts's doc).
  // Same bounded-bleed-rate shape as the governor above (never snaps in a single frame); the natural
  // bleed rate reuses the unboosted strafe thruster's own accel either way, same idea as the
  // longitudinal governor falling back to unboosted retro/main.
  {
    const maneuveringCap = body.boosting ? t.boostManeuveringSpeedCap : t.maneuveringSpeedCap;
    const rightSpeed = body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z;
    const upSpeed = body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z;
    const lateralSpeed = Math.hypot(rightSpeed, upSpeed);
    if (lateralSpeed > maneuveringCap) {
      const rightUnit = rightSpeed / lateralSpeed;
      const upUnit = upSpeed / lateralSpeed;
      const accelRight = accel.x * right.x + accel.y * right.y + accel.z * right.z;
      const accelUp = accel.x * up.x + accel.y * up.y + accel.z * up.z;
      const accelAlongLateral = accelRight * rightUnit + accelUp * upUnit;
      const naturalBleedRate = t.linearThrust.strafe / t.mass;
      const decelRate = Math.max(naturalBleedRate, accelAlongLateral);
      const maxDelta = decelRate * dt;
      const newLateralSpeed = Math.max(maneuveringCap, lateralSpeed - maxDelta);
      const lateralScale = newLateralSpeed / lateralSpeed;
      const dRight = rightSpeed * (lateralScale - 1);
      const dUp = upSpeed * (lateralScale - 1);
      body.vel.x += right.x * dRight + up.x * dUp;
      body.vel.y += right.y * dRight + up.y * dUp;
      body.vel.z += right.z * dRight + up.z * dUp;
    }
  }

  body.pos.x += body.vel.x * dt;
  body.pos.y += body.vel.y * dt;
  body.pos.z += body.vel.z * dt;
}

// Shared boost-meter bookkeeping — a two-rate ("red zone") model per ShipType, in case a given ship
// genuinely drains/recharges at different rates above vs. below boostRedZonePct:
//   - a NEW burn can't START while at/below boostRedZonePct (must climb back to boostReactivatePct
//     first) — but an ALREADY-ACTIVE burn (wasBoosting) is exempt and keeps draining through to 0
//   - recharging doesn't begin the instant boosting stops — cooldownTimer holds it at
//     boostRechargeDelaySec after the last active tick, counting down to 0 before recharge starts
// For Gladius specifically, a 2026-07-25 frame-timestamped capture found NO real red-zone rate
// asymmetry in either drain or recharge — gladius.ts sets both rate fields equal per pair accordingly
// (see its top-of-file note / BOOST_FINDINGS.md item 1). The two-rate branching stays here as a
// per-ship capability, not because Gladius itself needs it.
export function resolveBoost(
  type: ShipType,
  boostMeter: number,
  wasBoosting: boolean,
  cooldownTimer: number,
  requested: boolean,
  dt: number
): { boostMeter: number; boosting: boolean; cooldownTimer: number } {
  const pct = (boostMeter / type.boostCapacity) * 100;
  const canActivate = wasBoosting || pct >= type.boostReactivatePct;
  const boosting = requested && boostMeter > 0 && canActivate;

  let nextMeter = boostMeter;
  let nextCooldown = cooldownTimer;
  if (boosting) {
    const drainPctPerSec = pct <= type.boostRedZonePct ? type.boostDrainRateRedZone : type.boostDrainRate;
    nextMeter -= (drainPctPerSec / 100) * type.boostCapacity * dt;
    nextCooldown = type.boostRechargeDelaySec; // stays "just fired" the whole time boost is active
  } else if (cooldownTimer > 0) {
    nextCooldown = Math.max(0, cooldownTimer - dt);
  } else {
    const rechargePctPerSec = pct < type.boostRedZonePct ? type.boostRechargeRateRedZone : type.boostRechargeRate;
    nextMeter += (rechargePctPerSec / 100) * type.boostCapacity * dt;
  }

  return { boostMeter: clamp(nextMeter, 0, type.boostCapacity), boosting, cooldownTimer: nextCooldown };
}
