import { describe, it, expect } from 'vitest';
import { makeWorld, makeShipBody, resetWorld } from '../src/core/player';
import { SHIP_TYPES } from '../src/physics/shipTypes';

describe('makeShipBody / makeWorld', () => {
  it('starts the boost meter at the ship type\'s boostCapacity', () => {
    const ship = makeShipBody(SHIP_TYPES[0]);
    expect(ship.boostMeter).toBe(SHIP_TYPES[0].boostCapacity);

    const world = makeWorld();
    expect(world.player.ship.boostMeter).toBe(world.player.ship.type.boostCapacity);
  });
});

describe('resetWorld', () => {
  it('fully replaces bodies/player/enemies/projectiles and nulls scenario/pipTrainer', () => {
    const world = makeWorld();

    // simulate a session's worth of mutation
    world.player.ship.health.points = 0;
    world.player.mode = 'onfoot';
    world.enemies.push({ ...world.enemies[0] });
    world.projectiles.push({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 0, owner: 'player' });
    world.hitMarkerTimer = 5;
    world.scenario = {
      config: {} as never, outcome: 'won', elapsedSec: 10, gateIndex: 0,
      stats: { shotsFired: 1, hitsLanded: 1, kills: 1, hitsTaken: 1 }, explosions: [], bubbleTimeSec: 0
    };
    world.pipTrainer = {} as never;

    resetWorld(world);

    expect(world.player.mode).toBe('pilot');
    expect(world.player.ship.health.points).toBe(world.player.ship.health.maxPoints);
    expect(world.enemies).toHaveLength(1); // back to the single fresh default enemy, not 2
    expect(world.projectiles).toHaveLength(0);
    expect(world.hitMarkerTimer).toBe(0);
    expect(world.scenario).toBeNull();
    expect(world.pipTrainer).toBeNull();
  });
});
