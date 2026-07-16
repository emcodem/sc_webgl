import { describe, it, expect } from 'vitest';
import {
  FIGHTER_TUNING_ACE, angleBetween, canFireWithinTolerance, steeringToward, think
} from '../src/combat/enemyAI';
import { computeAxes, integrateOrientation } from '../src/math/quaternion';
import { normalize } from '../src/math/vec';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/physics/shipTypes';
import type { EnemyShip, ShipBody } from '../src/core/world';
import type { FighterAIMemory } from '../src/core/types';

const TYPE = SHIP_TYPES[0];
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function makeEnemy(pos: { x: number; y: number; z: number }, quat = IDENTITY): EnemyShip {
  return {
    type: TYPE, pos, vel: { x: 0, y: 0, z: 0 }, quat,
    angVel: { pitch: 0, yaw: 0, roll: 0 }, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), behavior: 'fighter',
    fireCooldown: 0, respawnTimer: 0, spawnPos: pos, spawnQuat: quat
  };
}
function makePlayer(pos: { x: number; y: number; z: number }, quat = IDENTITY): ShipBody {
  return {
    type: TYPE, pos, vel: { x: 0, y: 0, z: 0 }, quat, angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, decoupled: false, spaceBrakeOn: false, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), hitFlash: 0, fireCooldown: 0,
    respawnTimer: 0
  };
}
// Fixed seed rather than spawnFighterAI() (which pulls Math.random()) to keep the state machine
// fully deterministic for these tests.
function makeAI(overrides: Partial<FighterAIMemory> = {}): FighterAIMemory {
  return { mode: 'close', modeTimer: 0, clock: 0, jinkSeed: 0, tuning: FIGHTER_TUNING_ACE, ...overrides };
}

describe('canFireWithinTolerance', () => {
  const forward = { x: 0, y: 0, z: 1 };

  it('is false beyond fireRange even when perfectly boresighted', () => {
    expect(canFireWithinTolerance(forward, forward, 1000, 900, 10)).toBe(false);
  });

  it('is true within range when the lateral miss at that range is within tolerance', () => {
    // 5-degree error at 100m -> lateral miss ~8.7m, under a 10m tolerance
    const aimDir = normalize({ x: Math.sin((5 * Math.PI) / 180), y: 0, z: Math.cos((5 * Math.PI) / 180) });
    expect(canFireWithinTolerance(forward, aimDir, 100, 900, 10)).toBe(true);
  });

  it('is false when the same angular error implies a lateral miss beyond tolerance at longer range', () => {
    const aimDir = normalize({ x: Math.sin((5 * Math.PI) / 180), y: 0, z: Math.cos((5 * Math.PI) / 180) });
    expect(canFireWithinTolerance(forward, aimDir, 900, 900, 10)).toBe(false);
  });
});

describe('steeringToward', () => {
  it('converges orientation toward the target direction over repeated ticks, even from a near-180-degree start, and settles near zero steer', () => {
    // start facing -Z, steer toward +Z — exercises the shortest-path (rel.w<0) fix without
    // hand-deriving the sign: a broken fix would fail to converge or spin the long way.
    let current = { x: 0, y: 1, z: 0, w: 0 }; // 180deg about Y -> forward = (0,0,-1)
    const dir = { x: 0, y: 0, z: 1 };
    const dt = 1 / 60;
    let steer = steeringToward(current, dir, 5);
    for (let i = 0; i < 600; i++) {
      steer = steeringToward(current, dir, 5);
      current = integrateOrientation(current, { pitch: steer.pitch, yaw: steer.yaw, roll: steer.roll }, dt);
    }
    const { forward } = computeAxes(current);
    expect(angleBetween(forward, dir)).toBeLessThan(0.05);
    // once converged, the steering signal driving further rotation should have settled near zero
    expect(Math.hypot(steer.pitch, steer.yaw, steer.roll)).toBeLessThan(0.05);
  });
});

describe('think — mode-timer gating', () => {
  it('holds evade mode for at least evadeMinSeconds before an involuntary override', () => {
    // enemy at origin facing +Z, player 100m behind (at -Z) and pointed back at the enemy —
    // dist<threatRange, boresighted, and the enemy's six is toward the player: threatened.
    const enemy = makeEnemy({ x: 0, y: 0, z: 0 });
    const player = makePlayer({ x: 0, y: 0, z: -100 });
    const ai = makeAI({ mode: 'close', modeTimer: 0 });

    think(enemy, ai, player, 0.01);
    expect(ai.mode).toBe('evade');
    expect(ai.modeTimer).toBeCloseTo(FIGHTER_TUNING_ACE.evadeMinSeconds, 5);

    think(enemy, ai, player, 1.0); // still well within evadeMinSeconds (1.2s total elapsed so far)
    expect(ai.mode).toBe('evade');

    think(enemy, ai, player, 0.3); // pushes elapsed time past evadeMinSeconds
    expect(ai.mode).not.toBe('evade');
    expect(ai.mode).toBe('reposition'); // dist (100) is well under closeRange (1300)
  });

  it('does not trigger evade when the player is out of threatRange', () => {
    const enemy = makeEnemy({ x: 0, y: 0, z: 0 });
    const farPlayer = makePlayer({ x: 0, y: 0, z: -(FIGHTER_TUNING_ACE.threatRange + 50) });
    const ai = makeAI();
    think(enemy, ai, farPlayer, 0.01);
    expect(ai.mode).not.toBe('evade');
  });

  it('does not trigger evade when the player is not boresighted (outside threatConeRad)', () => {
    const enemy = makeEnemy({ x: 0, y: 0, z: 0 });
    // player behind the enemy (astern satisfied) but well off to the side, not aimed at the enemy
    const player = makePlayer({ x: 200, y: 0, z: -100 });
    const ai = makeAI();
    think(enemy, ai, player, 0.01);
    expect(ai.mode).not.toBe('evade');
  });

  it('does not trigger evade when the player is ahead of the enemy rather than astern', () => {
    // player is in front of the enemy (+Z) and facing back toward it — boresighted and in range,
    // but not astern, so this is a mutual merge pass, not a one-sided threat.
    const enemy = makeEnemy({ x: 0, y: 0, z: 0 });
    const player = makePlayer({ x: 0, y: 0, z: 100 }, { x: 0, y: 1, z: 0, w: 0 }); // faces -Z, back at the enemy
    const ai = makeAI();
    think(enemy, ai, player, 0.01);
    expect(ai.mode).not.toBe('evade');
  });
});
