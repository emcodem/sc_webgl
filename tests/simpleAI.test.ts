import { describe, it, expect } from 'vitest';
import { CHASER_TUNING, chaserThink, cruiseThink } from '../src/combat/ai/simpleAI';
import { steeringToward } from '../src/combat/enemyAI';
import { computeAxes } from '../src/math/quaternion';
import { createHealth } from '../src/combat/health';
import { getShipType } from '../src/physics/ships';
import type { EnemyShip, ShipBody } from '../src/core/world';

const TYPE = getShipType('Gladius');
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function makeEnemy(pos: { x: number; y: number; z: number }, quat = IDENTITY): EnemyShip {
  return {
    type: TYPE, pos, vel: { x: 0, y: 0, z: 0 }, quat,
    angVel: { pitch: 0, yaw: 0, roll: 0 }, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), behavior: 'chaser',
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

describe('chaserThink', () => {
  it('steers toward playerForward (not the station offset) when already at the station point', () => {
    // 180-degree yaw so playerForward is +Z while enemy currently faces -Z — a nonzero steer signal
    // that lets us tell "steered toward playerForward" apart from "steered toward station offset".
    const enemyQuat = { x: 0, y: 1, z: 0, w: 0 }; // 180deg about Y
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const { forward: playerForward } = computeAxes(player.quat);
    const stationPoint = {
      x: player.pos.x - playerForward.x * CHASER_TUNING.standoffDistance,
      y: player.pos.y - playerForward.y * CHASER_TUNING.standoffDistance,
      z: player.pos.z - playerForward.z * CHASER_TUNING.standoffDistance
    };
    const enemy = makeEnemy(stationPoint, enemyQuat); // enemy already sitting exactly at the station point
    const decision = chaserThink(enemy, player);
    const expected = steeringToward(enemyQuat, playerForward, CHASER_TUNING.steerGain);
    expect(decision.inputs.pitch).toBeCloseTo(expected.pitch, 10);
    expect(decision.inputs.yaw).toBeCloseTo(expected.yaw, 10);
    expect(decision.inputs.roll).toBeCloseTo(expected.roll, 10);
  });

  it('clamps throttle to [0.15, 1] based on distance to station', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const atStation = makeEnemy({ x: 0, y: 0, z: -CHASER_TUNING.standoffDistance });
    expect(chaserThink(atStation, player).inputs.throttle).toBeCloseTo(0.15, 5);

    const farAway = makeEnemy({ x: 0, y: 0, z: -100000 });
    expect(chaserThink(farAway, player).inputs.throttle).toBe(1);
  });

  it('only wants to fire within fireRange and boresighted within the angle tolerance', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });

    // enemy directly behind the player facing it, well within fireRange (450m)
    const inRange = makeEnemy({ x: 0, y: 0, z: -100 }, IDENTITY); // faces +Z, i.e. straight at the player
    expect(chaserThink(inRange, player).wantsToFire).toBe(true);

    // same facing, but beyond fireRange
    const tooFar = makeEnemy({ x: 0, y: 0, z: -CHASER_TUNING.standoffDistance - 1000 }, IDENTITY);
    expect(chaserThink(tooFar, player).wantsToFire).toBe(false);

    // in range, but facing directly away from the player
    const facingAway = makeEnemy({ x: 0, y: 0, z: -100 }, { x: 0, y: 1, z: 0, w: 0 }); // 180deg about Y
    expect(chaserThink(facingAway, player).wantsToFire).toBe(false);
  });
});

describe('cruiseThink', () => {
  it('advances position by velocity * dt with no steering', () => {
    const enemy = makeEnemy({ x: 0, y: 0, z: 0 });
    enemy.vel = { x: 10, y: -5, z: 0 };
    cruiseThink(enemy, 2);
    expect(enemy.pos).toEqual({ x: 20, y: -10, z: 0 });
  });
});
