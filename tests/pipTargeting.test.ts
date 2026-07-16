import { describe, it, expect } from 'vitest';
import { findActivePip } from '../src/combat/pipTargeting';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/physics/shipTypes';
import type { EnemyShip } from '../src/core/world';
import type { Camera } from '../src/combat/projection';

const TYPE = SHIP_TYPES[0];
const ORIGIN = { x: 0, y: 0, z: 0 };
const ZERO = { x: 0, y: 0, z: 0 };
const CAM: Camera = {
  pos: ORIGIN,
  axes: { forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } }
};

function makeEnemy(pos: { x: number; y: number; z: number }, overrides: Partial<EnemyShip> = {}): EnemyShip {
  return {
    type: TYPE, pos, vel: ZERO, quat: { x: 0, y: 0, z: 0, w: 1 },
    angVel: { pitch: 0, yaw: 0, roll: 0 }, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), behavior: 'cruiser',
    fireCooldown: 0, respawnTimer: 0, spawnPos: pos, spawnQuat: { x: 0, y: 0, z: 0, w: 1 }, ...overrides
  };
}

describe('findActivePip', () => {
  it('returns null with no enemies', () => {
    expect(findActivePip(ORIGIN, ZERO, CAM, [], 1000, 800)).toBeNull();
  });

  it('skips a dead enemy', () => {
    const dead = makeEnemy({ x: 0, y: 0, z: 100 }, { health: createHealth(0) });
    expect(findActivePip(ORIGIN, ZERO, CAM, [dead], 1000, 800)).toBeNull();
  });

  it('skips a respawning enemy', () => {
    const respawning = makeEnemy({ x: 0, y: 0, z: 100 }, { respawnTimer: 1 });
    expect(findActivePip(ORIGIN, ZERO, CAM, [respawning], 1000, 800)).toBeNull();
  });

  it('skips an enemy beyond PIP_RANGE (1500m)', () => {
    const farAway = makeEnemy({ x: 0, y: 0, z: 2000 });
    expect(findActivePip(ORIGIN, ZERO, CAM, [farAway], 1000, 800)).toBeNull();
  });

  it('picks whichever live in-range enemy projects closest to screen center', () => {
    const centered = makeEnemy({ x: 0, y: 0, z: 100 });
    const offCenter = makeEnemy({ x: 50, y: 0, z: 100 });
    const best = findActivePip(ORIGIN, ZERO, CAM, [offCenter, centered], 1000, 800);
    expect(best?.enemy).toBe(centered);
    expect(best?.screenX).toBeCloseTo(500, 5); // viewport center
  });
});
