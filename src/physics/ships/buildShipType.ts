import type { AngularState, ShipType } from '../../core/types';
import type { RawShipMeasurement } from './rawShipType';
import { thrustFromMaxAngVel } from './angularInvariant';
import { boostDragFromCaps, scaleLinearThrust } from './linearInvariant';

// Compiles a RawShipMeasurement (the authoring shape) into the flat ShipType flightModel.ts consumes.
// The redundant angularThrust/boostAngularThrust are DERIVED here from maxAngVel/boostMaxAngVel +
// angularDrag, so the invariant `angularThrust == maxAngVel * angularDrag` (per axis) holds by
// construction for every ship — that's the point, not something to re-assert. The three
// boosted-LINEAR fields are derived the same way from linearThrust + the boost ratios (see
// linearInvariant.ts), for the same reason plus one more: it keeps the authoring surface to
// quantities you can measure or look up, so a new ship needs mass/thrust/top-speeds and nothing
// fitted.
//
// `raw.provenance` and `raw.candidateRefinements` are intentionally NOT copied — the compiled
// ShipType stays byte-for-byte the shape flightModel.ts already reads. candidateRefinements carries
// measured-but-gated findings that must never leak into live flight (see rawShipType.ts).

export function buildShipType(raw: RawShipMeasurement): ShipType {
  const angularThrust = thrustFromMaxAngVel(raw.maxAngVel, raw.angularDrag);
  const boostAngularThrust = thrustFromMaxAngVel(raw.boostMaxAngVel, raw.angularDrag);
  const boostLinearThrust = scaleLinearThrust(raw.linearThrust, raw.boostThrustMultiplier);
  const boostCounterThrust = scaleLinearThrust(raw.linearThrust, raw.boostCounterMultiplier);
  // Depends on boostLinearThrust above — the ALIGNED thrust is what drag has to balance.
  const boostLinearDrag = boostDragFromCaps(boostLinearThrust, raw.mass, raw.boostGovernorOvershoot, raw);

  const ship: ShipType = {
    name: raw.name,
    model: raw.model,
    mass: raw.mass,
    massKg: raw.massKg,
    linearThrust: { ...raw.linearThrust },
    angularThrust,
    mainSpoolDelay: raw.mainSpoolDelay,
    retroSpoolDelay: raw.retroSpoolDelay,
    verticalSpoolDelay: raw.verticalSpoolDelay,
    throttleRampRate: raw.throttleRampRate,
    linearDrag: raw.linearDrag,
    boostLinearDrag,
    coastDecel: raw.coastDecel,
    brakeGain: raw.brakeGain,
    angularDrag: { ...raw.angularDrag },
    maxAngVel: { ...raw.maxAngVel },
    angularSpoolOmega: { ...raw.angularSpoolOmega },
    angularSpoolZeta: { ...raw.angularSpoolZeta },
    rollReleaseDecel: raw.rollReleaseDecel,
    pitchYawReversalDecel: { ...raw.pitchYawReversalDecel },
    scmSpeed: raw.scmSpeed,
    scmSpeedBack: raw.scmSpeedBack,
    maneuveringSpeedCap: raw.maneuveringSpeedCap,
    boostSpeedForward: raw.boostSpeedForward,
    boostSpeedBack: raw.boostSpeedBack,
    boostCapacity: raw.boostCapacity,
    boostRechargeRate: raw.boostRechargeRate,
    boostRedZonePct: raw.boostRedZonePct,
    boostReactivatePct: raw.boostReactivatePct,
    boostDrainRate: raw.boostDrainRate,
    boostDrainRateRedZone: raw.boostDrainRateRedZone,
    boostRechargeRateRedZone: raw.boostRechargeRateRedZone,
    boostRechargeDelaySec: raw.boostRechargeDelaySec,
    boostMaxAngVel: { ...raw.boostMaxAngVel },
    boostAngularThrust,
    boostAngularSpoolOmega: { ...raw.boostAngularSpoolOmega },
    boostAngularSpoolZeta: { ...raw.boostAngularSpoolZeta },
    boostThrustMultiplier: raw.boostThrustMultiplier,
    boostCounterMultiplier: raw.boostCounterMultiplier,
    boostGovernorOvershoot: raw.boostGovernorOvershoot,
    boostLinearThrust,
    boostCounterThrust,
    boostManeuveringSpeedCap: raw.boostManeuveringSpeedCap,
    hullRadius: raw.hullRadius,
    weaponType: raw.weaponType
  };

  validateShipType(ship, raw.name);
  return ship;
}

// STRUCTURAL validation only — catches a garbage/typo'd raw record (missing / NaN / non-finite
// numbers, or a non-positive derived turn authority) at module-load time so it fails loudly on the
// dev server / a test import rather than silently producing a broken ship.
//
// It deliberately does NOT enforce the Gladius-specific TUNING relations (verticalDown == verticalUp/2,
// boost governor-limited, exact settle speeds) — those are measured characteristics of one ship, not
// universal laws, so forcing them on every ship would wrongly reject a legitimately-different future
// ship. Those stay in tests/shipTuning.test.ts scoped to Gladius. The angular invariants
// (angularThrust == maxAngVel * angularDrag) can't be violated here — they're derived above — so
// there's nothing to check for them beyond finiteness.
const LINEAR_AXES = ['main', 'retro', 'strafe', 'verticalUp', 'verticalDown'] as const;

export function validateShipType(t: ShipType, id: string): void {
  const finite = (v: number, path: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Invalid ShipType '${id}': ${path} must be a finite number, got ${v}`);
    }
  };
  const finiteAxes = (a: AngularState, path: string) => {
    finite(a.pitch, `${path}.pitch`);
    finite(a.yaw, `${path}.yaw`);
    finite(a.roll, `${path}.roll`);
  };
  const positiveAxes = (a: AngularState, path: string) => {
    finiteAxes(a, path);
    for (const ax of ['pitch', 'yaw', 'roll'] as const) {
      if (a[ax] <= 0) throw new Error(`Invalid ShipType '${id}': ${path}.${ax} must be > 0, got ${a[ax]}`);
    }
  };
  const positivePitchYaw = (a: { pitch: number; yaw: number }, path: string) => {
    for (const ax of ['pitch', 'yaw'] as const) {
      finite(a[ax], `${path}.${ax}`);
      if (a[ax] <= 0) throw new Error(`Invalid ShipType '${id}': ${path}.${ax} must be > 0, got ${a[ax]}`);
    }
  };
  const positive = (v: number, path: string) => {
    finite(v, path);
    if (v <= 0) throw new Error(`Invalid ShipType '${id}': ${path} must be > 0, got ${v}`);
  };

  finite(t.mass, 'mass');
  if (t.mass <= 0) throw new Error(`Invalid ShipType '${id}': mass must be > 0, got ${t.mass}`);
  finite(t.massKg, 'massKg');

  for (const k of LINEAR_AXES) {
    finite(t.linearThrust[k], `linearThrust.${k}`);
  }
  finite(t.mainSpoolDelay, 'mainSpoolDelay');
  finite(t.retroSpoolDelay, 'retroSpoolDelay');
  finite(t.verticalSpoolDelay, 'verticalSpoolDelay');
  finite(t.throttleRampRate, 'throttleRampRate');
  if (t.throttleRampRate <= 0) throw new Error(`Invalid ShipType '${id}': throttleRampRate must be > 0, got ${t.throttleRampRate}`);
  finite(t.linearDrag, 'linearDrag');
  for (const k of LINEAR_AXES) {
    finite(t.boostLinearDrag[k], `boostLinearDrag.${k}`);   // derived — finiteness sanity
  }
  finite(t.coastDecel, 'coastDecel');
  finite(t.brakeGain, 'brakeGain');

  positiveAxes(t.angularDrag, 'angularDrag');
  positiveAxes(t.maxAngVel, 'maxAngVel');
  positiveAxes(t.angularThrust, 'angularThrust');       // derived — finiteness/positivity sanity
  positiveAxes(t.boostMaxAngVel, 'boostMaxAngVel');
  positiveAxes(t.boostAngularThrust, 'boostAngularThrust');
  positivePitchYaw(t.angularSpoolOmega, 'angularSpoolOmega');
  positivePitchYaw(t.angularSpoolZeta, 'angularSpoolZeta');
  positivePitchYaw(t.boostAngularSpoolOmega, 'boostAngularSpoolOmega');
  positivePitchYaw(t.boostAngularSpoolZeta, 'boostAngularSpoolZeta');
  finite(t.rollReleaseDecel, 'rollReleaseDecel');
  if (t.rollReleaseDecel <= 0) throw new Error(`Invalid ShipType '${id}': rollReleaseDecel must be > 0, got ${t.rollReleaseDecel}`);
  positivePitchYaw(t.pitchYawReversalDecel, 'pitchYawReversalDecel');

  finite(t.scmSpeed, 'scmSpeed');
  finite(t.scmSpeedBack, 'scmSpeedBack');
  finite(t.maneuveringSpeedCap, 'maneuveringSpeedCap');
  finite(t.boostSpeedForward, 'boostSpeedForward');
  finite(t.boostSpeedBack, 'boostSpeedBack');
  positive(t.boostThrustMultiplier, 'boostThrustMultiplier');
  positive(t.boostCounterMultiplier, 'boostCounterMultiplier');
  // > 1, not merely > 0: at or below 1 the aligned asymptote would sit at/under the axis's own speed
  // cap, making that axis drag-limited and the cap decorative — the exact bug that hit strafe/vertical
  // before 2026-07-28. This is the one place it can be caught for EVERY ship, not just the Gladius.
  positive(t.boostGovernorOvershoot, 'boostGovernorOvershoot');
  if (t.boostGovernorOvershoot <= 1) {
    throw new Error(`Invalid ShipType '${id}': boostGovernorOvershoot must be > 1 (else boost is drag-limited below its own cap), got ${t.boostGovernorOvershoot}`);
  }
  for (const k of LINEAR_AXES) {
    finite(t.boostLinearThrust[k], `boostLinearThrust.${k}`);      // derived
    finite(t.boostCounterThrust[k], `boostCounterThrust.${k}`);    // derived
  }
  finite(t.boostManeuveringSpeedCap, 'boostManeuveringSpeedCap');

  finite(t.boostCapacity, 'boostCapacity');
  finite(t.boostRedZonePct, 'boostRedZonePct');
  finite(t.boostReactivatePct, 'boostReactivatePct');
  finite(t.boostDrainRate, 'boostDrainRate');
  finite(t.boostDrainRateRedZone, 'boostDrainRateRedZone');
  finite(t.boostRechargeRate, 'boostRechargeRate');
  finite(t.boostRechargeRateRedZone, 'boostRechargeRateRedZone');
  finite(t.boostRechargeDelaySec, 'boostRechargeDelaySec');
  finite(t.hullRadius, 'hullRadius');

  finite(t.weaponType.muzzleSpeed, 'weaponType.muzzleSpeed');
  finite(t.weaponType.fireRate, 'weaponType.fireRate');
  finite(t.weaponType.lifetime, 'weaponType.lifetime');
  finite(t.weaponType.muzzleForward, 'weaponType.muzzleForward');
  finite(t.weaponType.damage, 'weaponType.damage');
  finite(t.weaponType.convergeDist, 'weaponType.convergeDist');
  finite(t.weaponType.minConvergeDist, 'weaponType.minConvergeDist');
  finite(t.weaponType.capacitorCapacity, 'weaponType.capacitorCapacity');
  finite(t.weaponType.capacitorCostPerShot, 'weaponType.capacitorCostPerShot');
  finite(t.weaponType.capacitorRechargeRate, 'weaponType.capacitorRechargeRate');
  finite(t.weaponType.capacitorRechargeDelaySec, 'weaponType.capacitorRechargeDelaySec');
}
