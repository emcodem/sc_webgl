import { describe, it, expect } from 'vitest';
import { SHIP_TYPES, getShipType } from '../src/physics/ships';
import { integrateFlight, resolveBoost, type FlightBody } from '../src/physics/flightModel';
import type { ShipType } from '../src/core/types';
import { PANTHER_S3 } from '../src/physics/weapons/panther';
import { resolveCapacitor } from '../src/combat/weapons';

// Guards the load-bearing tuning invariants carried over from the original project. If these break,
// the ported flight model no longer matches the measured real-Gladius behaviour (see
// physics/ships/gladius.ts). These mirror the original project's shipTuning tests.

const AXES = ['pitch', 'yaw', 'roll'] as const;
const LINEAR_AXES = ['main', 'retro', 'strafe', 'verticalUp', 'verticalDown'] as const;

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

    // Same idea for the boosted-linear derivations (see physics/ships/linearInvariant.ts) — a future
    // ship gets these guarded for free, and a broken derivation can't reach the flight model.
    it(`${g.name}: boostLinearThrust/boostCounterThrust == linearThrust * their multipliers per axis`, () => {
      for (const k of LINEAR_AXES) {
        expect(g.boostLinearThrust[k]).toBeCloseTo(g.linearThrust[k] * g.boostThrustMultiplier, 6);
        expect(g.boostCounterThrust[k]).toBeCloseTo(g.linearThrust[k] * g.boostCounterMultiplier, 6);
      }
    });

    it(`${g.name}: boost is governor-limited, not drag-limited, on every linear axis`, () => {
      expect(g.boostGovernorOvershoot).toBeGreaterThan(1);
      for (const k of LINEAR_AXES) {
        const asymptote = g.boostLinearThrust[k] / (g.boostLinearDrag[k] * g.mass);
        const cap = k === 'main' ? g.boostSpeedForward
          : k === 'retro' ? g.boostSpeedBack
          : g.boostManeuveringSpeedCap;
        expect(asymptote).toBeGreaterThan(cap);
      }
    });
  }
});

// Gladius-specific MEASURED relationships — NOT universal laws, so scoped to the Gladius rather than
// looped over all ships (a future ship could legitimately differ, e.g. be drag-limited or have a
// different up/down thrust ratio).
describe('Gladius measured tuning invariants', () => {
  const g = getShipType('Gladius');

  // Boost is governor-limited (like forward): aligned thrust EXCEEDS the drag-limited settle value, so
  // the natural asymptote (thrust/drag/mass) sits above the cap and the speed>speedCap governor is what
  // stops it. As of 2026-08-02 this is STRUCTURAL rather than a checked coincidence — drag is derived so
  // each axis's asymptote lands on exactly boostGovernorOvershoot * that axis's own cap — so these tests
  // now guard the derivation rather than five hand-authored numbers. buildShipType also rejects an
  // overshoot <= 1 at load time, for every ship.
  const CAP_FOR: Record<(typeof LINEAR_AXES)[number], keyof ShipType> = {
    main: 'boostSpeedForward', retro: 'boostSpeedBack',
    strafe: 'boostManeuveringSpeedCap', verticalUp: 'boostManeuveringSpeedCap', verticalDown: 'boostManeuveringSpeedCap'
  };

  it('boost is governor-limited on every axis: boostLinearThrust exceeds its own cap * boostLinearDrag * mass', () => {
    for (const k of LINEAR_AXES) {
      const cap = g[CAP_FOR[k]] as number;
      expect(g.boostLinearThrust[k]).toBeGreaterThan(cap * g.boostLinearDrag[k] * g.mass);
    }
  });

  it('each aligned asymptote is exactly boostGovernorOvershoot * that axis own cap', () => {
    for (const k of LINEAR_AXES) {
      const cap = g[CAP_FOR[k]] as number;
      const asymptote = g.boostLinearThrust[k] / (g.boostLinearDrag[k] * g.mass);
      expect(asymptote).toBeCloseTo(g.boostGovernorOvershoot * cap, 3);
    }
  });

  // Locks in the DERIVATIONS, not the numbers — same intent as the maneuveringSpeedCap ratio test below.
  it('boostLinearThrust and boostCounterThrust are their multipliers times linearThrust', () => {
    for (const k of LINEAR_AXES) {
      expect(g.boostLinearThrust[k]).toBeCloseTo(g.linearThrust[k] * g.boostThrustMultiplier, 6);
      expect(g.boostCounterThrust[k]).toBeCloseTo(g.linearThrust[k] * g.boostCounterMultiplier, 6);
    }
  });

  // The anchor: boosted main's own dense 2026-07-15 trace fit thrust 420. boostThrustMultiplier is
  // chosen so the derivation reproduces it, which is why generalising it to the other axes is
  // defensible rather than a new invention.
  it('derived boostLinearThrust.main still reproduces its independently measured 420', () => {
    expect(g.boostLinearThrust.main).toBeCloseTo(420, 0);
  });

  // Likewise main's independently fitted drag, which is where boostGovernorOvershoot itself came from.
  it('derived boostLinearDrag.main still reproduces its independently measured 0.380', () => {
    expect(g.boostLinearDrag.main).toBeCloseTo(0.380, 3);
  });

  // The four measured countering rates (m/s^2), from the 2026-08-02 flat-fit captures. 5% tolerance:
  // the unified 1.30 multiplier is a deliberate unification of four values spanning 1.256-1.345, since
  // that spread is measurement noise (see gladius.ts's capture list).
  it('derived countering accels match the four measured axes within 5%', () => {
    const MEASURED = { retro: 56.5, strafe: 123.7, verticalUp: 123.1, verticalDown: 64.4 } as const;
    for (const [k, measured] of Object.entries(MEASURED) as [keyof typeof MEASURED, number][]) {
      const derived = g.boostCounterThrust[k] / g.mass;
      expect(Math.abs(derived - measured) / measured).toBeLessThan(0.05);
    }
  });

  it('verticalDown thrust is exactly half verticalUp', () => {
    expect(g.linearThrust.verticalDown).toBeCloseTo(g.linearThrust.verticalUp / 2, 5);
  });

  // RESOLVED 2026-08-02 (see gladius.ts's verticalDown note): the half ratio DOES carry over to boost.
  // This inverts the 2026-07-28 assertion that boosted down equals boosted up, whose stated premise —
  // that no boosted-downstrafe capture is obtainable because holding it induces black/red-out — turned
  // out to be beatable by splitting the hold and by contrast-stretching the redout-tinted frames. It
  // now holds automatically because boosted thrust is derived from linearThrust.
  it('boosted verticalDown thrust is also exactly half boosted verticalUp (measured)', () => {
    expect(g.boostLinearThrust.verticalDown).toBeCloseTo(g.boostLinearThrust.verticalUp / 2, 5);
    expect(g.boostCounterThrust.verticalDown).toBeCloseTo(g.boostCounterThrust.verticalUp / 2, 5);
  });

  // Only measured/claimed relative to boostSpeedForward (see gladius.ts's "boostManeuveringSpeedCap
  // CORRECTED" note) — it's actually higher than boostSpeedBack (268), which isn't a claim the finding
  // makes.
  it('boostManeuveringSpeedCap is lower than boostSpeedForward', () => {
    expect(g.boostManeuveringSpeedCap).toBeLessThan(g.boostSpeedForward);
  });

  // maneuveringSpeedCap (EXTRAPOLATED 2026-07-31, per user go-ahead — see gladius.ts's
  // "maneuveringSpeedCap" note): the unboosted mirror of boostManeuveringSpeedCap, scaled from that
  // measured boosted ratio since no unboosted maneuvering-cap capture exists. Locks in the derivation
  // itself, not just the resulting number, so it can't silently drift from the ratio it's supposed to
  // track.
  it('maneuveringSpeedCap scales scmSpeed by the same ratio boostManeuveringSpeedCap has to boostSpeedForward', () => {
    const ratio = g.boostManeuveringSpeedCap / g.boostSpeedForward;
    expect(g.maneuveringSpeedCap).toBeCloseTo(g.scmSpeed * ratio, 1);
  });

  it('maneuveringSpeedCap is lower than scmSpeed', () => {
    expect(g.maneuveringSpeedCap).toBeLessThan(g.scmSpeed);
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
      throttleRampRate: 5.0,
      linearDrag: 0.001,
      // DERIVED per axis = boostLinearThrust / (mass * boostGovernorOvershoot * that axis's own cap).
      // main reproduces its independently measured 0.380 (that measurement is where 1.417 came from).
      boostLinearDrag: {
        main: 420.09 / (1.5 * 1.417 * 520),
        retro: 131.67 / (1.5 * 1.417 * 268),
        strafe: 303.05 / (1.5 * 1.417 * 394),
        verticalUp: 307.23 / (1.5 * 1.417 * 394),
        verticalDown: 153.615 / (1.5 * 1.417 * 394)
      },
      coastDecel: 40,
      brakeGain: 1.04,
      angularDrag: { pitch: 10.2740, yaw: 15.4639, roll: 5.3571 },
      maxAngVel: { pitch: 1.19, yaw: 0.91, roll: 3.49 },
      angularSpoolOmega: { pitch: 8.633, yaw: 8.027 },
      angularSpoolZeta: { pitch: 0.807, yaw: 0.729 },
      rollReleaseDecel: 8.7234,
      pitchYawReversalDecel: { pitch: 3.9667, yaw: 4.5500 },
      scmSpeed: 226,
      scmSpeedBack: 225,
      maneuveringSpeedCap: 171.2,
      boostSpeedForward: 520,
      boostSpeedBack: 268,
      boostCapacity: 100,
      boostRechargeRate: 2.51,
      boostRedZonePct: 25,
      boostReactivatePct: 26,
      boostDrainRate: 4.95,
      boostDrainRateRedZone: 4.95,
      boostRechargeRateRedZone: 2.51,
      boostRechargeDelaySec: 0.3,
      boostMaxAngVel: { pitch: 1.431, yaw: 0.9294, roll: 4.189 },
      boostAngularThrust: { pitch: 14.7021, yaw: 14.3721, roll: 22.4409 },
      boostAngularSpoolOmega: { pitch: 8.009, yaw: 8.186 },
      boostAngularSpoolZeta: { pitch: 0.916, yaw: 0.560 },
      boostThrustMultiplier: 2.09,
      boostCounterMultiplier: 1.30,
      boostGovernorOvershoot: 1.417,
      // Both DERIVED = linearThrust * the respective multiplier. main lands on 420.09, i.e. the 420 this
      // literal used to assert from its own dense trace — that's the anchor, not a coincidence.
      boostLinearThrust: { main: 420.09, retro: 131.67, strafe: 303.05, verticalUp: 307.23, verticalDown: 153.615 },
      boostCounterThrust: { main: 261.3, retro: 81.9, strafe: 188.5, verticalUp: 191.1, verticalDown: 95.55 },
      boostManeuveringSpeedCap: 394,
      hullRadius: 10,
      weaponType: PANTHER_S3
    };
    // Derived fields (angular: maxAngVel * angularDrag; linear: linearThrust * a multiplier, and drag
    // from thrust/cap) carry float dust, so compare those with tolerance and the rest exactly.
    for (const ax of AXES) {
      expect(g.angularThrust[ax]).toBeCloseTo(EXPECTED_GLADIUS.angularThrust[ax], 3);
      expect(g.boostAngularThrust[ax]).toBeCloseTo(EXPECTED_GLADIUS.boostAngularThrust[ax], 3);
    }
    for (const k of LINEAR_AXES) {
      expect(g.boostLinearThrust[k]).toBeCloseTo(EXPECTED_GLADIUS.boostLinearThrust[k], 3);
      expect(g.boostCounterThrust[k]).toBeCloseTo(EXPECTED_GLADIUS.boostCounterThrust[k], 3);
      expect(g.boostLinearDrag[k]).toBeCloseTo(EXPECTED_GLADIUS.boostLinearDrag[k], 6);
    }
    const strip = (t: ShipType) => ({
      ...t,
      angularThrust: undefined, boostAngularThrust: undefined,
      boostLinearThrust: undefined, boostCounterThrust: undefined, boostLinearDrag: undefined
    });
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

  // Post-boost overspeed decay (applied 2026-07-25, per user go-ahead): the ORIGINAL reported bug —
  // releasing boost while still holding throttle must decay back to scmSpeed regardless, not freeze
  // at the overspeed value (BOOST_FINDINGS.md §3a: the old governor's Math.max(naturalBleedRate,
  // accelAlongVel) let held thrust exactly cancel its own bleed).
  it('releasing boost while still holding full throttle still decays speed down to scmSpeed', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    body.boosting = true;
    for (let i = 0; i < 60 * 10; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    expect(Math.hypot(body.vel.x, body.vel.y, body.vel.z)).toBeCloseTo(g.boostSpeedForward, 0);
    body.boosting = false; // release boost, but keep holding full forward throttle
    for (let i = 0; i < 60 * 10; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    expect(Math.hypot(body.vel.x, body.vel.y, body.vel.z)).toBeCloseTo(g.scmSpeed, 0);
  });

  // Re-boosting mid-decay must still let speed climb back up — the fix must not turn the cap into a
  // one-way ratchet.
  it('re-boosting mid-decay lets speed climb back toward boostSpeedForward', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    body.boosting = true;
    for (let i = 0; i < 60 * 10; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    body.boosting = false;
    for (let i = 0; i < 30; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    const midDecaySpeed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    expect(midDecaySpeed).toBeLessThan(g.boostSpeedForward);
    body.boosting = true;
    for (let i = 0; i < 60 * 10; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    expect(Math.hypot(body.vel.x, body.vel.y, body.vel.z)).toBeCloseTo(g.boostSpeedForward, 0);
  });

  // Boosted maneuvering cap (applied 2026-07-25): pure single-axis boosted strafe never even reaches
  // 385 (boostLinearDrag settles it around ~334 first), so this drives BOTH strafe and vertical at
  // once — their combined thrust vector exceeds the drag-limited asymptote, so the new governor is
  // what stops it, not drag. Must land at boostManeuveringSpeedCap (385), nowhere near the much higher
  // boostSpeedForward (520) the pre-fix total-speed-only governor would have allowed.
  it('full boost + combined strafe/vertical governs at boostManeuveringSpeedCap, not boostSpeedForward', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    body.boosting = true;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 10; i++) {
      integrateFlight(body, { throttle: 0, pitch: 0, yaw: 0, roll: 0, strafeX: 1, strafeY: 1, brake: false, decoupled: false }, dt);
    }
    const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    expect(speed).toBeCloseTo(g.boostManeuveringSpeedCap, 0);
  });

  // Unboosted mirror of the boosted maneuvering-cap test above (added 2026-07-31): combined strafe +
  // vertical, unboosted, must govern at maneuveringSpeedCap (171.2), not at the much higher scmSpeed
  // (226) the pre-fix total-speed-only governor would have allowed.
  it('full combined strafe/vertical (unboosted) governs at maneuveringSpeedCap, not scmSpeed', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 10; i++) {
      integrateFlight(body, { throttle: 0, pitch: 0, yaw: 0, roll: 0, strafeX: 1, strafeY: 1, brake: false, decoupled: false }, dt);
    }
    const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    expect(speed).toBeCloseTo(g.maneuveringSpeedCap, 0);
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

// Pitch/yaw reversal governor (applied 2026-07-28, per user go-ahead — see gladius.ts's
// pitchYawReversalDecel doc and capture/MEASUREMENTS.md's "Reversal stop-time — felt-threshold
// method" section): a hard flip to the opposite deflection decelerates at a flat rate, distinct from
// both the spring-damper spool-up/release model above and from a same-equation-with-flipped-target
// reversal. Mirrors the roll-release governor tests' style as a regression guard on this branch's
// shape specifically, not just steady-state.
describe('pitch/yaw reversal governor (flat deceleration on a sign-flip, not the spring-damper)', () => {
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

  it('decrements pitch rate by a flat step per tick while reversing, not via the spring-damper', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 240;
    for (let i = 0; i < 240 * 3; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 1, yaw: 0, roll: 0 }, dt);
    }
    const before = body.angVel.pitch;
    expect(before).toBeGreaterThan(0);
    integrateFlight(body, { ...NO_ROTATION, pitch: -1, yaw: 0, roll: 0 }, dt);
    const drop = before - body.angVel.pitch;
    expect(drop).toBeCloseTo(g.pitchYawReversalDecel.pitch * dt, 6);
    expect(body.angAccel.pitch).toBe(0); // reset, not carried over from the spool-up state
  });

  it('a full-rate reversal crosses zero in roughly maxAngVel/pitchYawReversalDecel, then continues into the new direction', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 240;
    for (let i = 0; i < 240 * 3; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 1, yaw: 0, roll: 0 }, dt);
    }
    let steps = 0;
    let crossedAt = -1;
    for (let i = 0; i < 240 * 2; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: -1, yaw: 0, roll: 0 }, dt);
      steps++;
      if (crossedAt < 0 && body.angVel.pitch <= 0) crossedAt = steps * dt;
    }
    expect(crossedAt).toBeCloseTo(g.maxAngVel.pitch / g.pitchYawReversalDecel.pitch, 1);
    // held the reversed input well past crossing zero — should now be spooling up negative, not stuck
    expect(body.angVel.pitch).toBeLessThan(-g.maxAngVel.pitch * 0.5);
  });

  it('releasing to neutral (target=0) still uses the spring-damper, unaffected by the reversal branch', () => {
    const g = getShipType('Gladius');
    const body = freshBody(g);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 2; i++) {
      integrateFlight(body, { ...NO_ROTATION, pitch: 1, yaw: 0, roll: 0 }, dt);
    }
    const before = body.angVel.pitch;
    integrateFlight(body, { ...NO_ROTATION, pitch: 0, yaw: 0, roll: 0 }, dt);
    const drop = before - body.angVel.pitch;
    // the spring-damper's first-tick drop depends on omega/zeta, not the flat reversal decel — just
    // confirm it does NOT match the flat-decel step, i.e. the reversal branch didn't fire on release.
    expect(drop).not.toBeCloseTo(g.pitchYawReversalDecel.pitch * dt, 6);
  });
});

// Boost-meter drain/recharge rates (re-measured 2026-07-25 with a frame-timestamped capture — see
// BOOST_FINDINGS.md item 1 / MEASUREMENTS.md "Boost meter drain + recharge — frame-accurate capture").
// Supersedes both the parent project's original two-rate numbers and this repo's own earlier
// stopwatched ~13s red-zone-recharge correction: a real capture found NO red-zone rate asymmetry in
// either direction, so both rate pairs are equal in gladius.ts. These lock in the uniform rates so
// they can't silently drift back toward either superseded (asymmetric) model.
describe('boost-meter drain + recharge (re-measured 2026-07-25, no red-zone asymmetry)', () => {
  it('drains from 100% to 0% in ~20s uniformly, not a two-rate curve', () => {
    const g = getShipType('Gladius');
    let meter = g.boostCapacity;
    let cooldown = 0;
    const dt = 1 / 60;
    let secondsTo25 = -1;
    let secondsTo0 = -1;
    for (let i = 0; i < 60 * 25 && meter > 0; i++) {
      const r = resolveBoost(g, meter, true, cooldown, true, dt);
      meter = r.boostMeter;
      cooldown = r.cooldownTimer;
      if (secondsTo25 < 0 && meter <= 25) secondsTo25 = (i + 1) * dt;
      if (secondsTo0 < 0 && meter <= 0) secondsTo0 = (i + 1) * dt;
    }
    expect(secondsTo25).toBeCloseTo(15.15, 0); // 75% at ~4.95%/s
    expect(secondsTo0).toBeCloseTo(20.2, 0); // full 100% at ~4.95%/s
  });

  it('recharges from 0% to 100% in ~40s uniformly, not a two-rate curve', () => {
    const g = getShipType('Gladius');
    let meter = 0;
    let cooldown = 0;
    const dt = 1 / 60;
    let secondsTo25 = -1;
    let secondsTo100 = -1;
    for (let i = 0; i < 60 * 50 && meter < g.boostCapacity; i++) {
      const r = resolveBoost(g, meter, false, cooldown, false, dt);
      meter = r.boostMeter;
      cooldown = r.cooldownTimer;
      if (secondsTo25 < 0 && meter >= 25) secondsTo25 = (i + 1) * dt;
      if (secondsTo100 < 0 && meter >= g.boostCapacity) secondsTo100 = (i + 1) * dt;
    }
    expect(secondsTo25).toBeCloseTo(9.96, 0); // 25% at ~2.51%/s
    expect(secondsTo100).toBeCloseTo(39.84, 0); // full 100% at ~2.51%/s
  });
});

// Weapon capacitor (GitHub #2) — locks in PANTHER_S3's measured (SUSPECT, see panther.ts) constants
// against resolveCapacitor's pure step function, same "measured constants can't silently drift"
// intent as the boost-meter block above.
describe('weapon capacitor drain + recharge (per gun — see combat/weapons.ts NUM_GUNS)', () => {
  it('firing drains exactly capacitorCostPerShot and starts the post-fire recharge dwell', () => {
    const w = PANTHER_S3;
    const r = resolveCapacitor(w, w.capacitorCapacity, 0, 1 / 60, true, true);
    expect(r.capacitor).toBeCloseTo(w.capacitorCapacity - w.capacitorCostPerShot, 6);
    expect(r.cooldownTimer).toBeCloseTo(w.capacitorRechargeDelaySec, 6);
  });

  it('does not recharge until the post-fire dwell has fully elapsed', () => {
    const w = PANTHER_S3;
    let capacitor = w.capacitorCapacity - w.capacitorCostPerShot;
    let cooldown = w.capacitorRechargeDelaySec;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * w.capacitorRechargeDelaySec - 1; i++) {
      const r = resolveCapacitor(w, capacitor, cooldown, dt, false, false);
      capacitor = r.capacitor;
      cooldown = r.cooldownTimer;
    }
    expect(capacitor).toBeCloseTo(w.capacitorCapacity - w.capacitorCostPerShot, 6); // unchanged — still dwelling
    expect(cooldown).toBeGreaterThan(0);
  });

  it('recharges at capacitorRechargeRate once the dwell elapses, capped at capacity', () => {
    const w = PANTHER_S3;
    let capacitor = 0;
    let cooldown = w.capacitorRechargeDelaySec;
    const dt = 1 / 60;
    let secondsToFull = -1;
    for (let i = 0; i < 60 * 60 && capacitor < w.capacitorCapacity; i++) {
      const r = resolveCapacitor(w, capacitor, cooldown, dt, false, false);
      capacitor = r.capacitor;
      cooldown = r.cooldownTimer;
      if (secondsToFull < 0 && capacitor >= w.capacitorCapacity) secondsToFull = (i + 1) * dt;
    }
    const expectedSeconds = w.capacitorRechargeDelaySec + w.capacitorCapacity / w.capacitorRechargeRate;
    expect(secondsToFull).toBeCloseTo(expectedSeconds, 0);
    expect(capacitor).toBeCloseTo(w.capacitorCapacity, 6); // never overshoots the cap
  });
});

// ============================================================================================
// Boosted ALIGNED vs COUNTERING regimes (measured 2026-08-02 — see physics/ships/gladius.ts's
// "BOOSTED LINEAR: TWO REGIMES" note, physics/flightModel.ts's role block, and RETRO.md).
//
// This suite exists because the bug it guards was invisible to every other test in this file: they all
// accelerate from rest, which is the ALIGNED role, so none of them ever exercised braking. The reported
// symptom was that boosted reverse killed a 226 m/s cruise in ~1s against the real game's ~4s.
// ============================================================================================
describe('boosted countering (braking/reversing) is flat and weaker than the aligned rate', () => {
  const g = getShipType('Gladius');

  // At the identity spawn attitude computeAxes gives forward=+Z, right=+X, up=-Y (the ported
  // convention — see CLAUDE.md's axis-convention seam), so local axes map to world as:
  // forward -> +z, right -> +x, up -> -y (i.e. downward motion is +y).
  function bodyMoving(vel: { x?: number; y?: number; z?: number }, boosting = true): FlightBody {
    return {
      type: g,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: vel.x ?? 0, y: vel.y ?? 0, z: vel.z ?? 0 },
      quat: { x: 0, y: 0, z: 0, w: 1 },
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      angAccel: { pitch: 0, yaw: 0, roll: 0 },
      boosting,
      // Pre-spooled: a real cruise has held throttle for seconds (and boost bypasses spool anyway).
      // Leaving these at 0 would gate the first ticks and skew the short measurements below.
      throttleSpoolTime: 10,
      verticalSpoolTime: 10
    };
  }

  interface Inputs {
    throttle: number; pitch: number; yaw: number; roll: number;
    strafeX: number; strafeY: number; brake: boolean; decoupled: boolean;
  }
  const inputs = (over: Partial<Inputs> = {}): Inputs => ({
    throttle: 0, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false, ...over
  });

  // Drives one axis to a stop (or a sign flip) and reports how long it took.
  function timeToStop(body: FlightBody, input: Inputs, dt: number, axis: 'x' | 'y' | 'z'): number {
    let steps = 0;
    const sign0 = Math.sign(body.vel[axis]);
    const limit = Math.ceil(30 / dt);
    while (steps < limit) {
      integrateFlight(body, input, dt);
      steps++;
      if (body.vel[axis] === 0 || Math.sign(body.vel[axis]) !== sign0) break;
    }
    return steps * dt;
  }

  // THE HEADLINE REGRESSION. Before the two-regime split this stopped in ~1.3s (boosted retro thrust
  // 216.5 plus drag 0.38*v, compounding); measured in the real game at ~4.0s.
  it('boosted reverse stops a 226 m/s forward cruise in ~4s, not ~1s', () => {
    const body = bodyMoving({ z: g.scmSpeed });
    const stop = timeToStop(body, inputs({ throttle: -1 }), 1 / 120, 'z');
    expect(stop).toBeGreaterThan(3.7);
    expect(stop).toBeLessThan(4.5);
  });

  it('matches the measured stop times on strafe and both vertical directions', () => {
    const dt = 1 / 120;
    // lateral: +x cruise countered by left strafe. 225 / 125.7 = ~1.79s (measured ~1.85s).
    const lateral = timeToStop(bodyMoving({ x: 225 }), inputs({ strafeX: -1 }), dt, 'x');
    expect(lateral).toBeGreaterThan(1.5);
    expect(lateral).toBeLessThan(2.2);
    // up-thrust countering a downward (+y) cruise. 220 / 127.4 = ~1.73s (measured ~1.9s).
    const upward = timeToStop(bodyMoving({ y: 220 }), inputs({ strafeY: 1 }), dt, 'y');
    expect(upward).toBeGreaterThan(1.4);
    expect(upward).toBeLessThan(2.3);
    // down-thrust countering an upward (-y) cruise: weakest axis, 225 / 63.7 = ~3.53s (measured ~3.6s).
    const downward = timeToStop(bodyMoving({ y: -225 }), inputs({ strafeY: -1 }), dt, 'y');
    expect(downward).toBeGreaterThan(3.1);
    expect(downward).toBeLessThan(4.0);
  });

  // The defining property of the countering regime: FLAT. If any drag leaked back into this path the
  // per-tick delta would shrink with speed — exactly the bug that made the stop 3x too fast.
  it('decelerates at a flat rate — same per-tick delta at 200 m/s as at 50 m/s', () => {
    const dt = 1 / 120;
    const deltaAt = (v: number) => {
      const body = bodyMoving({ z: v });
      const before = body.vel.z;
      integrateFlight(body, inputs({ throttle: -1 }), dt);
      return before - body.vel.z;
    };
    expect(deltaAt(200)).toBeCloseTo(deltaAt(50), 6);
    // ...and that flat rate is the derived COUNTERING accel, not the aligned one.
    expect(deltaAt(200) / dt).toBeCloseTo(g.boostCounterThrust.retro / g.mass, 4);
  });

  it('is weaker than the aligned rate on the same axis (the whole point of the split)', () => {
    expect(g.boostCounterThrust.retro).toBeLessThan(g.boostLinearThrust.retro);
    const ratio = g.boostCounterMultiplier / g.boostThrustMultiplier;
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.70);
  });

  // Lands exactly on zero rather than overshooting, at both a fast tick and main.ts's 50ms dt clamp —
  // this is why the countering decel is applied in velocity space with a clamp instead of via `accel`.
  it('lands exactly on zero without overshooting, at dt = 1/120 and dt = 1/20', () => {
    for (const dt of [1 / 120, 1 / 20]) {
      const body = bodyMoving({ z: g.scmSpeed });
      let steps = 0;
      const limit = Math.ceil(30 / dt);
      while (body.vel.z > 0 && steps < limit) {
        integrateFlight(body, inputs({ throttle: -1 }), dt);
        steps++;
      }
      expect(body.vel.z).toBe(0);
    }
  });

  // Countering is THRUST, not auto-damping, so it must survive the gates that switch drag/coast off.
  it('still applies in decoupled mode and while the space brake is held', () => {
    const dt = 1 / 120;
    const plain = timeToStop(bodyMoving({ z: g.scmSpeed }), inputs({ throttle: -1 }), dt, 'z');
    const decoupled = timeToStop(bodyMoving({ z: g.scmSpeed }), inputs({ throttle: -1, decoupled: true }), dt, 'z');
    expect(decoupled).toBeCloseTo(plain, 1);
    // brake + countering must be strictly faster than brake alone
    const brakeOnly = timeToStop(bodyMoving({ z: g.scmSpeed }), inputs({ brake: true }), dt, 'z');
    const brakePlus = timeToStop(bodyMoving({ z: g.scmSpeed }), inputs({ throttle: -1, brake: true }), dt, 'z');
    expect(brakePlus).toBeLessThan(brakeOnly);
  });

  // Once the axis crosses zero the role flips to ALIGNED, so holding reverse keeps going backward
  // rather than sticking at the stop — and settles at the boosted REVERSE cap, not the forward one.
  it('holding reverse past the stop flips to aligned and accelerates backward to boostSpeedBack', () => {
    const body = bodyMoving({ z: g.scmSpeed });
    const dt = 1 / 120;
    for (let i = 0; i < 120 * 20; i++) integrateFlight(body, inputs({ throttle: -1 }), dt);
    expect(body.vel.z).toBeLessThan(0);
    expect(Math.hypot(body.vel.x, body.vel.y, body.vel.z)).toBeCloseTo(g.boostSpeedBack, 0);
  });

  // UNBOOSTED countering must be untouched by all of this — it was already correct (the input sign
  // picks the opposing thruster and linearDrag is negligible, so it's already flat at 1.00x). Asserted
  // against thrust + the drag term explicitly rather than against a loose tolerance around 42: at
  // cruise, linearDrag (0.001) contributes ~0.23 m/s^2 on top of retro's 42, which is precisely the
  // "essentially negligible" this ship's invariants claim. Pinning both terms means this test still
  // fails loudly if the boosted 1.30x countering rate (54.6) ever leaks into the unboosted path.
  it('leaves unboosted countering alone: the bare retro thruster rate plus negligible drag', () => {
    const dt = 1 / 120;
    const body = bodyMoving({ z: g.scmSpeed }, false);
    const before = body.vel.z;
    integrateFlight(body, inputs({ throttle: -1 }), dt);
    const rate = (before - body.vel.z) / dt;
    const thrustTerm = g.linearThrust.retro / g.mass;
    expect(rate - thrustTerm).toBeLessThan(0.3);   // drag's whole contribution at 226 m/s
    expect(rate).toBeCloseTo(thrustTerm + g.linearDrag * body.vel.z, 2);
  });

  // The ALIGNED half still behaves: an accel-from-rest climb must reach its own cap, and reaching it is
  // what proves drag stayed governor-limited rather than settling the ship early.
  it('aligned boosted climbs still reach their own caps (reverse and maneuvering)', () => {
    const dt = 1 / 60;
    const back = bodyMoving({});
    for (let i = 0; i < 60 * 15; i++) integrateFlight(back, inputs({ throttle: -1 }), dt);
    expect(Math.hypot(back.vel.x, back.vel.y, back.vel.z)).toBeCloseTo(g.boostSpeedBack, 0);

    const lateral = bodyMoving({});
    for (let i = 0; i < 60 * 15; i++) integrateFlight(lateral, inputs({ strafeX: 1 }), dt);
    expect(Math.hypot(lateral.vel.x, lateral.vel.y, lateral.vel.z)).toBeCloseTo(g.boostManeuveringSpeedCap, 0);
  });
});

// Boosted lateral/vertical thrust authority vs. current forward speed (added 2026-08-04, rough fit
// per user go-ahead — see flightModel.ts's boostedLateralAuthority note and MEASUREMENTS.md's
// TVI-tracked speed-sweep captures). Forward -> +z, up -> -y at the identity attitude (see the
// "boosted countering" describe block above for the same convention).
describe('lateral/vertical thrust authority tapers with forward speed', () => {
  const g = getShipType('Gladius');

  function bodyMoving(vel: { x?: number; y?: number; z?: number }, boosting = true): FlightBody {
    return {
      type: g,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: vel.x ?? 0, y: vel.y ?? 0, z: vel.z ?? 0 },
      quat: { x: 0, y: 0, z: 0, w: 1 },
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      angAccel: { pitch: 0, yaw: 0, roll: 0 },
      boosting,
      throttleSpoolTime: 10,
      verticalSpoolTime: 10
    };
  }
  const inputs = { throttle: 0, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 1, brake: false, decoupled: false };

  function upAccel(forwardSpeed: number, boosting = true): number {
    // A very fine dt keeps this an instantaneous-accel reading: explicit-Euler drag is applied
    // AFTER thrust integrates within the same tick, so a coarser dt would fold in a bit of that
    // same-tick drag on the velocity thrust just produced and read slightly low.
    const dt = 1 / 12000;
    const body = bodyMoving({ z: forwardSpeed }, boosting);
    const before = body.vel.y;
    integrateFlight(body, inputs, dt);
    return (before - body.vel.y) / dt; // up = -y, so a positive result is upward accel
  }

  describe('boosted: tapers across the whole 0..boostSpeedForward range', () => {
    it('is full (unsuppressed) from a dead stop', () => {
      expect(upAccel(0)).toBeCloseTo(g.boostLinearThrust.verticalUp / g.mass, 1);
    });

    it('is ~0 once forward speed reaches boostSpeedForward', () => {
      expect(upAccel(g.boostSpeedForward)).toBeCloseTo(0, 0);
    });

    it('tapers monotonically in between', () => {
      const a0 = upAccel(0);
      const aQuarter = upAccel(g.boostSpeedForward * 0.25);
      const aHalf = upAccel(g.boostSpeedForward * 0.5);
      const aFull = upAccel(g.boostSpeedForward);
      expect(a0).toBeGreaterThan(aQuarter);
      expect(aQuarter).toBeGreaterThan(aHalf);
      expect(aHalf).toBeGreaterThan(aFull);
    });
  });

  // Unboosted shape is DIFFERENT, not just a rescaled copy: full authority at/under scmSpeed (an
  // earlier, separate capture found unboosted strafe near its own 226 m/s cruise close to full
  // strength), and only tapers once COASTING ABOVE scmSpeed on residual momentum from a released
  // boost (2026-08-04 capture) — a state normal unboosted flight can't otherwise reach.
  describe('unboosted: full up to scmSpeed, tapers only above it (overspeed coast)', () => {
    it('is full at a dead stop and anywhere up to scmSpeed', () => {
      const full = g.linearThrust.verticalUp / g.mass;
      expect(upAccel(0, false)).toBeCloseTo(full, 1);
      expect(upAccel(g.scmSpeed * 0.5, false)).toBeCloseTo(full, 1);
      expect(upAccel(g.scmSpeed, false)).toBeCloseTo(full, 1);
    });

    it('is ~0 once coasting a full scmSpeed above scmSpeed', () => {
      expect(upAccel(g.scmSpeed * 2, false)).toBeCloseTo(0, 0);
    });

    it('tapers monotonically once above scmSpeed', () => {
      const aAtCap = upAccel(g.scmSpeed, false);
      const aQuarterOver = upAccel(g.scmSpeed * 1.25, false);
      const aHalfOver = upAccel(g.scmSpeed * 1.5, false);
      const aDouble = upAccel(g.scmSpeed * 2, false);
      expect(aAtCap).toBeGreaterThan(aQuarterOver);
      expect(aQuarterOver).toBeGreaterThan(aHalfOver);
      expect(aHalfOver).toBeGreaterThan(aDouble);
    });
  });

  it('does not affect the countering role', () => {
    // Existing upward velocity, strafe commanded DOWN against it -> countering, not aligned.
    // Forward speed kept a bit under boostSpeedForward so the combined-speed governor doesn't
    // also bleed velocity this tick and contaminate the reading.
    const body = bodyMoving({ z: g.boostSpeedForward * 0.9, y: -50 });
    const before = body.vel.y;
    integrateFlight(body, { ...inputs, strafeY: -1 }, 1 / 120);
    const decel = (body.vel.y - before) * 120; // downward decel magnitude, +y
    expect(decel).toBeCloseTo(g.boostCounterThrust.verticalDown / g.mass, 1);
  });
});
