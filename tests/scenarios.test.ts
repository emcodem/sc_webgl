import { describe, it, expect } from 'vitest';
import { SHIP_TYPES } from '../src/physics/shipTypes';
import { deriveShipType } from '../src/physics/deriveShipType';
import { buildBarrelRollGatePath, evaluateGateCrossing } from '../src/scenarios/gatePath';

// Guards the two pure-function pieces of the scenario-system port that are cheap to unit test
// directly, per this project's existing convention of testing invariants rather than behaviour
// that needs a running renderer/world (see tests/shipTuning.test.ts).

describe('deriveShipType', () => {
  const base = SHIP_TYPES[0];
  const derived = deriveShipType(base, { angularScale: 0.5, name: 'Test Variant' });
  const AXES = ['pitch', 'yaw', 'roll'] as const;

  it('scales maxAngVel/boostMaxAngVel by angularScale', () => {
    for (const ax of AXES) {
      expect(derived.maxAngVel[ax]).toBeCloseTo(base.maxAngVel[ax] * 0.5, 5);
      expect(derived.boostMaxAngVel[ax]).toBeCloseTo(base.boostMaxAngVel[ax] * 0.5, 5);
    }
  });

  it('preserves the angularThrust == maxAngVel * angularDrag invariant after scaling', () => {
    for (const ax of AXES) {
      expect(derived.angularThrust[ax]).toBeCloseTo(derived.maxAngVel[ax] * derived.angularDrag[ax], 5);
      expect(derived.boostAngularThrust[ax]).toBeCloseTo(derived.boostMaxAngVel[ax] * derived.angularDrag[ax], 5);
    }
  });

  it('leaves every other field (mass, drag, speeds) untouched', () => {
    expect(derived.mass).toBe(base.mass);
    expect(derived.angularDrag).toEqual(base.angularDrag);
    expect(derived.scmSpeed).toBe(base.scmSpeed);
    expect(derived.linearThrust).toEqual(base.linearThrust);
  });

  it('overrides name when given, keeps base name otherwise', () => {
    expect(derived.name).toBe('Test Variant');
    expect(deriveShipType(base, { angularScale: 1 }).name).toBe(base.name);
  });
});

describe('gatePath', () => {
  const path = buildBarrelRollGatePath({ startZ: 100, gateCount: 4, spacingZ: 50, turns: 1, rollRadius: 20, gateRadius: 10 });

  it('builds gateCount gates, progressing along +Z by spacingZ each', () => {
    expect(path).toHaveLength(4);
    for (let i = 0; i < path.length; i++) {
      expect(path[i].pos.z).toBeCloseTo(100 + (i + 1) * 50, 5);
      expect(path[i].radius).toBe(10);
    }
  });

  it('flying straight through a gate\'s center clears it', () => {
    const gate = path[0];
    // just past the gate's plane, dead-center laterally
    const playerPos = { x: gate.pos.x, y: gate.pos.y, z: gate.pos.z + 1 };
    expect(evaluateGateCrossing(playerPos, gate)).toBe('cleared');
  });

  it('flying past a gate well outside its radius misses it', () => {
    const gate = path[0];
    const playerPos = { x: gate.pos.x + gate.radius * 5, y: gate.pos.y, z: gate.pos.z + 1 };
    expect(evaluateGateCrossing(playerPos, gate)).toBe('missed');
  });

  it('reports "ahead" while still in front of the gate\'s plane', () => {
    const gate = path[0];
    const playerPos = { x: gate.pos.x, y: gate.pos.y, z: gate.pos.z - 1 };
    expect(evaluateGateCrossing(playerPos, gate)).toBe('ahead');
  });

  it('counts crossing exactly at the gate\'s radius boundary as cleared (uses <=, not <)', () => {
    const gate = path[0];
    const playerPos = { x: gate.pos.x + gate.radius, y: gate.pos.y, z: gate.pos.z + 1 };
    expect(evaluateGateCrossing(playerPos, gate)).toBe('cleared');
  });
});
