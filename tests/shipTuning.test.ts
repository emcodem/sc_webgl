import { describe, it, expect } from 'vitest';
import { SHIP_TYPES, getShipType } from '../src/physics/ships';
import { integrateFlight, type FlightBody } from '../src/physics/flightModel';
import type { ShipType } from '../src/core/types';

// Guards the load-bearing tuning invariants carried over from the original project. If these break,
// the ported flight model no longer matches the measured real-Gladius behaviour (see
// physics/ships/gladius.ts). These mirror the original project's shipTuning tests.

const AXES = ['pitch', 'yaw', 'roll'] as const;

// Structural invariants — true by construction for EVERY ship (buildShipType derives angularThrust
// from maxAngVel * angularDrag). Looping over all ships makes each future ship a regression guard on
// the build step for free, and catches a broken derivation.
describe('structural invariants (all ships)', () => {
  for (const g of SHIP_TYPES) {
    it(`${g.name}: angularThrust == maxAngVel * angularDrag per axis`, () => {
      for (const ax of AXES) {
        expect(g.angularThrust[ax]).toBeCloseTo(g.maxAngVel[ax] * g.angularDrag[ax], 3);
      }
    });

    it(`${g.name}: boostAngularThrust == boostMaxAngVel * angularDrag per axis`, () => {
      for (const ax of AXES) {
        expect(g.boostAngularThrust[ax]).toBeCloseTo(g.boostMaxAngVel[ax] * g.angularDrag[ax], 3);
      }
    });
  }
});

// Gladius-specific MEASURED relationships — NOT universal laws, so scoped to the Gladius rather than
// looped over all ships (a future ship could legitimately differ, e.g. be drag-limited or have a
// different up/down thrust ratio).
describe('Gladius measured tuning invariants', () => {
  const g = getShipType('Gladius');

  // Boost is governor-limited (like forward), re-measured 2026-07-15: thrust EXCEEDS the
  // drag-limited settle value, so the natural asymptote (thrust/drag/mass) sits above the cap and
  // the speed>speedCap governor is what stops it — NOT the old drag-limited equality. See
  // physics/ships/gladius.ts's Boosted-forward-thrust note.
  it('boost is governor-limited: boostLinearThrust exceeds boostSpeed * boostLinearDrag * mass', () => {
    expect(g.boostLinearThrust.main).toBeGreaterThan(g.boostSpeedForward * g.boostLinearDrag * g.mass);
    expect(g.boostLinearThrust.retro).toBeGreaterThan(g.boostSpeedBack * g.boostLinearDrag * g.mass);
  });

  it('verticalDown thrust is exactly half verticalUp', () => {
    expect(g.linearThrust.verticalDown).toBeCloseTo(g.linearThrust.verticalUp / 2, 5);
  });

  // Regression guard: the raw→ShipType refactor must be numerically identical to the old flat literal
  // that lived in src/physics/shipTypes.ts. If this drifts, the compile step changed a value.
  it('compiles to the exact pre-refactor Gladius stats', () => {
    const EXPECTED_GLADIUS: ShipType = {
      name: 'Gladius',
      model: 'dvergr',
      mass: 1.5,
      massKg: 48552,
      linearThrust: { main: 201, retro: 63, strafe: 145, verticalUp: 147, verticalDown: 73.5 },
      angularThrust: { pitch: 12.2261, yaw: 14.0721, roll: 18.6963 },
      mainSpoolDelay: 0.07,
      retroSpoolDelay: 0.024,
      verticalSpoolDelay: 0.066,
      linearDrag: 0.001,
      boostLinearDrag: 0.38,
      coastDecel: 40,
      brakeGain: 1.04,
      angularDrag: { pitch: 10.2740, yaw: 15.4639, roll: 5.3571 },
      maxAngVel: { pitch: 1.19, yaw: 0.91, roll: 3.49 },
      angularSpoolOmega: { pitch: 8.633, yaw: 8.027 },
      angularSpoolZeta: { pitch: 0.807, yaw: 0.729 },
      rollReleaseDecel: 8.7234,
      scmSpeed: 226,
      scmSpeedBack: 225,
      boostSpeedForward: 520,
      boostSpeedBack: 268,
      boostCapacity: 100,
      boostRechargeRate: 2.8846,
      boostRedZonePct: 25,
      boostReactivatePct: 26,
      boostDrainRate: 7.5,
      boostDrainRateRedZone: 13.0208,
      boostRechargeRateRedZone: 62.5,
      boostRechargeDelaySec: 0.3,
      boostMaxAngVel: { pitch: 1.431, yaw: 0.9294, roll: 4.189 },
      boostAngularThrust: { pitch: 14.7021, yaw: 14.3721, roll: 22.4409 },
      boostAngularSpoolOmega: { pitch: 8.009, yaw: 8.186 },
      boostAngularSpoolZeta: { pitch: 0.916, yaw: 0.560 },
      boostLinearThrust: { main: 420, retro: 216.5 },
      hullRadius: 10
    };
    // angularThrust/boostAngularThrust are derived (maxAngVel * angularDrag); compare those with
    // tolerance and the rest exactly.
    for (const ax of AXES) {
      expect(g.angularThrust[ax]).toBeCloseTo(EXPECTED_GLADIUS.angularThrust[ax], 3);
      expect(g.boostAngularThrust[ax]).toBeCloseTo(EXPECTED_GLADIUS.boostAngularThrust[ax], 3);
    }
    const strip = (t: ShipType) => ({ ...t, angularThrust: undefined, boostAngularThrust: undefined });
    expect(strip(g)).toEqual(strip(EXPECTED_GLADIUS));
  });
});

// Roll-release governor (2026-07-20): real Gladius stops roll on release with a hard, roughly-
// constant deceleration, not the proportional/exponential drag pitch/yaw still use — see
// shipTypes.rollReleaseDecel and flightModel.ts's roll branch. Confirms the actual bug report this
// fixed: a small partial-rate roll tap should stop in proportionally (not just absolutely) less time
// than a full-rate release, since a FLAT decel's stop time scales linearly with the starting rate.
describe('roll-release governor (flat deceleration, not proportional drag)', () => {
  const NO_INPUT = { throttle: 0, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false };

  function bodyWithRoll(type: ShipType, rollAngVel: number): FlightBody {
    return {
      type,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      quat: { x: 0, y: 0, z: 0, w: 1 },
      angVel: { pitch: 0, yaw: 0, roll: rollAngVel },
      angAccel: { pitch: 0, yaw: 0, roll: 0 },
      boosting: false,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0
    };
  }

  function timeToStop(g: ShipType, initialRollAngVel: number, dt: number): number {
    const body = bodyWithRoll(g, initialRollAngVel);
    let steps = 0;
    while (body.angVel.roll !== 0 && steps < 600) {
      integrateFlight(body, NO_INPUT, dt);
      steps++;
    }
    return steps * dt;
  }

  it('decrements roll rate by a flat step per tick, not proportionally to the current rate', () => {
    const g = getShipType('Gladius');
    const dt = 1 / 240;
    const body = bodyWithRoll(g, g.maxAngVel.roll);
    const before = body.angVel.roll;
    integrateFlight(body, NO_INPUT, dt);
    const drop = before - body.angVel.roll;
    expect(drop).toBeCloseTo(g.rollReleaseDecel * dt, 6);
  });

  it('stops full-rate roll at exactly zero (no infinite exponential tail) in roughly the measured time', () => {
    const g = getShipType('Gladius');
    const dt = 1 / 60;
    const body = bodyWithRoll(g, g.maxAngVel.roll);
    let steps = 0;
    while (body.angVel.roll !== 0 && steps < 600) {
      integrateFlight(body, NO_INPUT, dt);
      steps++;
    }
    expect(body.angVel.roll).toBe(0);
    expect(steps * dt).toBeCloseTo(g.maxAngVel.roll / g.rollReleaseDecel, 1);
  });

  it('a small partial-rate tap stops proportionally faster than a full-rate release', () => {
    const g = getShipType('Gladius');
    const dt = 1 / 60;
    const fullRateStopTime = timeToStop(g, g.maxAngVel.roll, dt);
    const smallTapStopTime = timeToStop(g, g.maxAngVel.roll * 0.2, dt);
    expect(smallTapStopTime).toBeCloseTo(fullRateStopTime * 0.2, 1);
  });
});

// A behavioural check that the governor actually settles forward speed at scmSpeed — the same thing
// the browser verification saw hit 226 m/s.
describe('flight model behaviour', () => {
  function freshBody(type: ShipType): FlightBody {
    return {
      type,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      quat: { x: 0, y: 0, z: 0, w: 1 },
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      angAccel: { pitch: 0, yaw: 0, roll: 0 },
      boosting: false,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0
    };
  }

  it('full forward throttle settles at scmSpeed (governor-capped)', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 8; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    expect(speed).toBeCloseTo(g.scmSpeed, 0);
  });

  it('full boost + forward throttle governs at boostSpeedForward', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    body.boosting = true;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 10; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    expect(speed).toBeCloseTo(g.boostSpeedForward, 0);
  });
});

// 2nd-order pitch/yaw spool model (2026-07-24, applied per user go-ahead — see
// capture/MEASUREMENTS.md's "Spool-up transient is a 2nd-order underdamped step response"): mirrors
// the roll-release tests' style as a regression guard on the new tracker's shape, not just its
// steady-state endpoint.
describe('pitch/yaw 2nd-order rotational spool model', () => {
  function freshBody(type: ShipType): FlightBody {
    return {
      type,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      quat: { x: 0, y: 0, z: 0, w: 1 },
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      angAccel: { pitch: 0, yaw: 0, roll: 0 },
      boosting: false,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0
    };
  }
  const NO_ROTATION = { throttle: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false };

  // Single-axis input (roll/the other axis both 0) — combining pitch+yaw would trigger the shared
  // RCS-authority budget above (inputMag normalization) and reduce each axis's own target, which is
  // unrelated to what these tests are checking.
  it('full pitch input converges to maxAngVel.pitch at steady state', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 3; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 1, yaw: 0, roll: 0 }, dt);
    }
    expect(body.angVel.pitch).toBeCloseTo(g.maxAngVel.pitch, 2);
  });

  it('full yaw input converges to maxAngVel.yaw at steady state', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 3; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 0, yaw: 1, roll: 0 }, dt);
    }
    expect(body.angVel.yaw).toBeCloseTo(g.maxAngVel.yaw, 2);
  });

  it('full boosted pitch input converges to boostMaxAngVel.pitch at steady state', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    body.boosting = true;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 3; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 1, yaw: 0, roll: 0 }, dt);
    }
    expect(body.angVel.pitch).toBeCloseTo(g.boostMaxAngVel.pitch, 2);
  });

  it('full boosted yaw input converges to boostMaxAngVel.yaw at steady state', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    body.boosting = true;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 3; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 0, yaw: 1, roll: 0 }, dt);
    }
    expect(body.angVel.yaw).toBeCloseTo(g.boostMaxAngVel.yaw, 2);
  });

  it('releasing full-rate pitch/yaw decays angVel back to (near) zero', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 2; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 1, yaw: 1, roll: 0 }, dt);
    }
    for (let i = 0; i < 60 * 2; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 0, yaw: 0, roll: 0 }, dt);
    }
    expect(body.angVel.pitch).toBe(0);
    expect(body.angVel.yaw).toBe(0);
  });

  // The whole point of the 2nd-order model (zeta < 1 in all 4 measured conditions): the response
  // should transiently overshoot the steady-state target before settling, unlike the old 1st-order
  // exponential-lag model which only ever approached it monotonically from below.
  it('pitch spool-up transiently overshoots maxAngVel before settling (underdamped, zeta < 1)', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 240;
    let peak = 0;
    for (let i = 0; i < 240 * 2; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 1, yaw: 0, roll: 0 }, dt);
      peak = Math.max(peak, body.angVel.pitch);
    }
    expect(peak).toBeGreaterThan(g.maxAngVel.pitch);
  });
});
