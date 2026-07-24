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

  // PITCH/YAW rotation: 2nd-order underdamped step-response tracker (mass-spring-damper-like),
  // covering BOTH spool-up (input applied) AND release/reversal (input dropped/reversed) with one
  // continuous equation — real Gladius's rate-vs-time curve for both is a genuine overshoot-and-
  // settle wobble, not the old two-part scheme (proportional forcing while held + an exponential-
  // decay-with-snap-to-zero approximation on release) this replaced. See gladius.ts's
  // angularSpoolOmega/Zeta doc for the fitted values and capture/MEASUREMENTS.md's "Spool-up
  // transient is a 2nd-order underdamped step response" section for the full derivation.
  // State-space form (standard driven mass-spring-damper): target is the commanded steady-state rate
  // (using the already budget-shared pitchInput/yawInput above); `body.angAccel` is the new state
  // this needs (the old model only tracked angVel).
  //   angAccel += (-2*zeta*omega*angAccel - omega^2*(angVel - target)) * dt
  //   angVel   += angAccel * dt
  // Release/reversal need no separate branch: they're just this same equation with a lower/negated
  // target, which is exactly why release showed the same wobble as spool-up in the capture data.
  const spoolOmega = body.boosting ? t.boostAngularSpoolOmega : t.angularSpoolOmega;
  const spoolZeta = body.boosting ? t.boostAngularSpoolZeta : t.angularSpoolZeta;
  const pitchTarget = pitchInput * maxAngVel.pitch;
  const yawTarget = yawInput * maxAngVel.yaw;
  body.angAccel.pitch += (-2 * spoolZeta.pitch * spoolOmega.pitch * body.angAccel.pitch
    - spoolOmega.pitch * spoolOmega.pitch * (prevAngVel.pitch - pitchTarget)) * dt;
  body.angAccel.yaw += (-2 * spoolZeta.yaw * spoolOmega.yaw * body.angAccel.yaw
    - spoolOmega.yaw * spoolOmega.yaw * (prevAngVel.yaw - yawTarget)) * dt;
  body.angVel.pitch = prevAngVel.pitch + body.angAccel.pitch * dt;
  body.angVel.yaw = prevAngVel.yaw + body.angAccel.yaw * dt;

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

  // boosting raises main/retro thrust the same way it raises angular thrust above — without this,
  // boosting only lifted the speed *cap* while leaving thrust unchanged, and since linearDrag
  // makes unboosted thrust settle at exactly scmSpeed by construction, the ship could never
  // actually climb to a speed where the higher cap mattered.
  const mainThrust = body.boosting ? t.boostLinearThrust.main : t.linearThrust.main;
  const retroThrust = body.boosting ? t.boostLinearThrust.retro : t.linearThrust.retro;
  const mainThrustMag = spooledUp ? (throttle >= 0 ? throttle * mainThrust : throttle * retroThrust) : 0;
  const verticalThrust = strafeY >= 0 ? t.linearThrust.verticalUp : t.linearThrust.verticalDown;
  const verticalThrustMag = verticalSpooledUp ? strafeY * verticalThrust : 0;
  const accel: Vec3 = { x: 0, y: 0, z: 0 };
  addScaled(accel, forward, mainThrustMag / t.mass);
  addScaled(accel, right, (strafeX * t.linearThrust.strafe) / t.mass);
  addScaled(accel, up, verticalThrustMag / t.mass);

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

  // Drag / coast — skipped while braking (brake already counter-thrusts at max) and in decoupled
  // mode (no auto-damping, coast freely).
  if (!input.decoupled && !input.brake) {
    if (throttle !== 0 || strafeX !== 0 || strafeY !== 0) {
      // Proportional drag while actively thrusting. Negligible for the Gladius (the governor below
      // does the real limiting); boost uses its own much-lower boostLinearDrag.
      const drag = body.boosting ? t.boostLinearDrag : t.linearDrag;
      body.vel.x -= body.vel.x * drag * dt;
      body.vel.y -= body.vel.y * drag * dt;
      body.vel.z -= body.vel.z * drag * dt;
    } else {
      // Per-(axis,direction) flat coast decel = opposing thruster's own accel (thrust/mass), NOT an
      // isotropic scalar speed decay — real Gladius sheds forward/back/lateral/vertical drift at
      // whichever local thruster would be firing to counter it, each at its own flat rate (measured,
      // see physics/ships/gladius.ts's applied perAxisCoastDecel note): forward coasts down via retro
      // (42 m/s^2), back via main (134), lateral via strafe (~97 both ways), up via verticalDown (49),
      // down via verticalUp (98) — the flat ShipType.coastDecel scalar (~matches forward's 42) is no
      // longer read here, kept only as an informational/legacy field. Decomposed into the ship's local
      // frame (same right/up/forward basis the brake block above uses) since each rate is tied to a
      // specific local-axis thruster, not to the ship's actual direction of travel — unlike the brake,
      // this does NOT preserve heading; each local axis decelerates independently.
      const localVel = {
        x: body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z,
        y: body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z,
        z: body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z
      };
      const decelTowardZero = (v: number, decelPerSec: number): number => {
        const step = decelPerSec * dt;
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
  // deceleration, not a teleport — but that bound must be at least as strong as whatever thrust is
  // actively still feeding the overspeed (e.g. continuing to hold boost right at
  // boostSpeedForward), or thrust stronger than the natural bleed rate would just outrun it and
  // blow through the cap every tick instead of being governed by it. Falls back to the ship's
  // natural thrust-based decel once nothing is actively pushing against it, e.g. right after a
  // boost ends with no throttle held.
  const forwardSpeed = body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z;
  const speedCap = body.boosting
    ? (forwardSpeed >= 0 ? t.boostSpeedForward : t.boostSpeedBack)
    : (forwardSpeed >= 0 ? t.scmSpeed : t.scmSpeedBack);
  const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
  if (speed > speedCap) {
    const velUnit = { x: body.vel.x / speed, y: body.vel.y / speed, z: body.vel.z / speed };
    const accelAlongVel = accel.x * velUnit.x + accel.y * velUnit.y + accel.z * velUnit.z;
    const naturalBleedRate = (forwardSpeed >= 0 ? t.linearThrust.retro : t.linearThrust.main) / t.mass;
    const decelRate = Math.max(naturalBleedRate, accelAlongVel);
    const maxDelta = decelRate * dt;
    const newSpeed = Math.max(speedCap, speed - maxDelta);
    const scale = newSpeed / speed;
    body.vel.x *= scale;
    body.vel.y *= scale;
    body.vel.z *= scale;
  }

  body.pos.x += body.vel.x * dt;
  body.pos.y += body.vel.y * dt;
  body.pos.z += body.vel.z * dt;
}

// Shared boost-meter bookkeeping — a two-rate ("red zone") model matching real-game measurement
// (see shipTypes.ts), not a plain linear drain/recharge:
//   - draining is faster once at/below boostRedZonePct than above it
//   - a NEW burn can't START while at/below boostRedZonePct (must climb back to boostReactivatePct
//     first) — but an ALREADY-ACTIVE burn (wasBoosting) is exempt and keeps draining through to 0
//   - recharging doesn't begin the instant boosting stops — cooldownTimer holds it at
//     boostRechargeDelaySec after the last active tick, counting down to 0 before recharge starts
//   - recharging itself is also two-rate, fast below the red zone and slow above it
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
