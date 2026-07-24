import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ORBITER_TUNING, DRIFTER_TUNING, spawnOrbitState, orbiterThink, spawnDriftState, driftThink
} from '../src/combat/ai/orbiterDrifterAI';
import { createHealth } from '../src/combat/health';
import { getShipType } from '../src/physics/ships';
import type { EnemyShip, ShipBody } from '../src/core/world';

const TYPE = getShipType('Gladius');
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

function makeEnemy(pos = ZERO): EnemyShip {
  return {
    type: TYPE, pos, vel: ZERO, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0, throttleSpoolTime: 0, verticalSpoolTime: 0,
    health: createHealth(10), behavior: 'orbiter', fireCooldown: 0, respawnTimer: 0,
    spawnPos: pos, spawnQuat: IDENTITY
  };
}
function makePlayer(pos = ZERO): ShipBody {
  return {
    type: TYPE, pos, vel: ZERO, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, decoupled: false, spaceBrakeOn: false, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), hitFlash: 0, fireCooldown: 0,
    respawnTimer: 0
  };
}

afterEach(() => vi.restoreAllMocks());

describe('spawnOrbitState / spawnDriftState — field ranges', () => {
  it('radius and angularSpeed magnitude fall within the tuned min/max range', () => {
    const speedMult = 0.6 + 0.5 * 1.2; // droneSpeedMult(0.5), mirrored here since it isn't exported
    for (let i = 0; i < 20; i++) {
      const orbit = spawnOrbitState({ x: 0, y: 0, z: 0 }, 0.5);
      expect(orbit.radius).toBeGreaterThanOrEqual(ORBITER_TUNING.minRadius);
      expect(orbit.radius).toBeLessThanOrEqual(ORBITER_TUNING.maxRadius);
      expect(Math.abs(orbit.angularSpeed)).toBeGreaterThanOrEqual(ORBITER_TUNING.minAngularSpeed * speedMult - 1e-9);
      expect(Math.abs(orbit.angularSpeed)).toBeLessThanOrEqual(ORBITER_TUNING.maxAngularSpeed * speedMult + 1e-9);
      expect(orbit.respawnTimer).toBe(0);
    }
  });

  it('drifter spawn speed and initial position fall within the tuned distance range', () => {
    for (let i = 0; i < 20; i++) {
      const player = makePlayer();
      const { pos } = spawnDriftState(player, 0.5);
      const dist = Math.hypot(pos.x - player.pos.x, pos.y - player.pos.y, pos.z - player.pos.z);
      expect(dist).toBeGreaterThanOrEqual(DRIFTER_TUNING.minSpawnDist - 1e-6);
      expect(dist).toBeLessThanOrEqual(DRIFTER_TUNING.maxSpawnDist + 1e-6);
    }
  });
});

describe('orbiterThink', () => {
  it('eases the orbit center toward the player once the drone strays past leashDistance', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // avoid the barrel-roll trigger roll
    const farCenter = { x: ORBITER_TUNING.leashDistance + 1000, y: 0, z: 0 };
    const enemy = makeEnemy(farCenter); // distToPlayer is measured from the drone's current pos
    enemy.orbit = {
      center: { ...farCenter }, radius: 100, angularSpeed: 0.2, phase: 0,
      planeRight: { x: 0, y: 1, z: 0 }, planeUp: { x: 0, y: 0, z: 1 }, respawnTimer: 0
    };
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    orbiterThink(enemy, player, 1 / 60);
    // center should have moved toward the player (x decreased) but not snapped all the way there
    expect(enemy.orbit.center.x).toBeLessThan(farCenter.x);
    expect(enemy.orbit.center.x).toBeGreaterThan(0);
  });

  it('leaves the orbit center alone while within leashDistance of the player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const enemy = makeEnemy();
    const center = { x: 100, y: 0, z: 0 };
    enemy.orbit = {
      center: { ...center }, radius: 50, angularSpeed: 0.2, phase: 0,
      planeRight: { x: 0, y: 1, z: 0 }, planeUp: { x: 0, y: 0, z: 1 }, respawnTimer: 0
    };
    orbiterThink(enemy, makePlayer(), 1 / 60);
    expect(enemy.orbit.center.x).toBeCloseTo(center.x, 6);
  });
});

describe('driftThink — turn-around gating', () => {
  it('triggers a turn-around once past turnDist while flying away from the player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: DRIFTER_TUNING.turnDist + 10 });
    enemy.vel = { x: 0, y: 0, z: 100 }; // moving further away (+Z), away from the player at origin
    enemy.drift = { respawnTimer: 0 };
    driftThink(enemy, player, 1 / 60, 0.5);
    expect(enemy.drift.turn).toBeDefined();
  });

  it('does not re-trigger a turn-around past turnDist while already flying back toward the player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: DRIFTER_TUNING.turnDist + 10 });
    enemy.vel = { x: 0, y: 0, z: -100 }; // heading back toward the player, not away
    enemy.drift = { respawnTimer: 0 };
    driftThink(enemy, player, 1 / 60, 0.5);
    expect(enemy.drift.turn).toBeUndefined();
  });

  it('does not trigger a turn-around before reaching turnDist even while flying away', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: DRIFTER_TUNING.turnDist - 100 });
    enemy.vel = { x: 0, y: 0, z: 100 };
    enemy.drift = { respawnTimer: 0 };
    driftThink(enemy, player, 1 / 60, 0.5);
    expect(enemy.drift.turn).toBeUndefined();
  });
});
