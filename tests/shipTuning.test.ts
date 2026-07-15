import { describe, it, expect } from 'vitest';
import { SHIP_TYPES } from '../src/physics/shipTypes';
import { integrateFlight, type FlightBody } from '../src/physics/flightModel';
import type { ShipType } from '../src/core/types';

// Guards the load-bearing tuning invariants carried over from the original project. If these break,
// the ported flight model no longer matches the measured real-Gladius behaviour (see
// physics/shipTypes.ts). These mirror the original project's shipTuning tests.

const AXES = ['pitch', 'yaw', 'roll'] as const;

describe('Gladius tuning invariants', () => {
  const g = SHIP_TYPES[0];

  it('angularThrust == maxAngVel * angularDrag per axis', () => {
    for (const ax of AXES) {
      expect(g.angularThrust[ax]).toBeCloseTo(g.maxAngVel[ax] * g.angularDrag[ax], 3);
    }
  });

  it('boostAngularThrust == boostMaxAngVel * angularDrag per axis', () => {
    for (const ax of AXES) {
      expect(g.boostAngularThrust[ax]).toBeCloseTo(g.boostMaxAngVel[ax] * g.angularDrag[ax], 3);
    }
  });

  // Boost is governor-limited (like forward), re-measured 2026-07-15: thrust EXCEEDS the
  // drag-limited settle value, so the natural asymptote (thrust/drag/mass) sits above the cap and
  // the speed>speedCap governor is what stops it — NOT the old drag-limited equality. See
  // physics/shipTypes.ts's Boosted-forward-thrust note.
  it('boost is governor-limited: boostLinearThrust exceeds boostSpeed * boostLinearDrag * mass', () => {
    expect(g.boostLinearThrust.main).toBeGreaterThan(g.boostSpeedForward * g.boostLinearDrag * g.mass);
    expect(g.boostLinearThrust.retro).toBeGreaterThan(g.boostSpeedBack * g.boostLinearDrag * g.mass);
  });

  it('verticalDown thrust is exactly half verticalUp', () => {
    expect(g.linearThrust.verticalDown).toBeCloseTo(g.linearThrust.verticalUp / 2, 5);
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
      boosting: false,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0
    };
  }

  it('full forward throttle settles at scmSpeed (governor-capped)', () => {
    const g = SHIP_TYPES[0];
    const body = freshBody(g);
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 8; i++) {
      integrateFlight(body, { throttle: 1, pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false }, dt);
    }
    const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    expect(speed).toBeCloseTo(g.scmSpeed, 0);
  });

  it('full boost + forward throttle governs at boostSpeedForward', () => {
    const g = SHIP_TYPES[0];
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
