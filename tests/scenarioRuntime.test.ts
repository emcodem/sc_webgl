import { describe, it, expect, beforeAll } from 'vitest';
import { getShipType } from '../src/physics/ships';
import { buildAimTrainingScenario, buildEvasivePilotScenario } from '../src/scenarios/definitions';
import type { ScenarioConfig } from '../src/scenarios/types';

// scenarios/runtime.ts transitively imports combat/combatSystem.ts -> input/mouseButtons.ts and
// input/mouseLook.ts, both of which register real browser listeners against `window`/`document` at
// MODULE LOAD time. Neither is actually invoked by the calls below (they only read simple in-memory
// state at call time), so a minimal stub sufficient to survive import time — not a full jsdom
// dependency — is enough to exercise this module's pure game-state logic directly.
(globalThis as unknown as { window: unknown }).window = { addEventListener: () => {} };
(globalThis as unknown as { document: unknown }).document = {
  getElementById: () => ({}), addEventListener: () => {}
};

let startScenario: typeof import('../src/scenarios/runtime')['startScenario'];
let updateScenario: typeof import('../src/scenarios/runtime')['updateScenario'];
let bubbleTicks: typeof import('../src/scenarios/runtime')['bubbleTicks'];
let makeWorld: typeof import('../src/core/player')['makeWorld'];

beforeAll(async () => {
  const runtime = await import('../src/scenarios/runtime');
  startScenario = runtime.startScenario;
  updateScenario = runtime.updateScenario;
  bubbleTicks = runtime.bubbleTicks;
  makeWorld = (await import('../src/core/player')).makeWorld;
});

const TYPE = getShipType('Gladius');
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

function destroyScenario(enemyCount: number): ScenarioConfig {
  return {
    id: 'test-destroy', name: 'Test', description: '',
    enemySpawns: Array.from({ length: enemyCount }, (_, i) => ({
      type: TYPE, pos: { x: i * 100, y: 0, z: 500 }, quat: IDENTITY, behavior: 'cruiser' as const,
      initialVel: { x: 0, y: 0, z: 0 }
    })),
    hitsToKillEnemy: 1, hitsToKillPlayer: 999, includeStation: false, winCondition: 'destroy'
  };
}

function gatesScenario(): ScenarioConfig {
  return {
    id: 'test-gates', name: 'Test', description: '', enemySpawns: [],
    hitsToKillEnemy: 999, hitsToKillPlayer: 999, includeStation: false, winCondition: 'gates',
    gatePath: [{ pos: { x: 0, y: 0, z: 100 }, quat: IDENTITY, radius: 50 }],
    surviveDurationSec: 10
  };
}

describe('startScenario — placeholder spawn overrides', () => {
  it('positions a drifter spawn away from its config placeholder (0,0,0)', () => {
    const world = makeWorld();
    startScenario(world, buildAimTrainingScenario({ droneCount: 2, aggressiveness: 0.5, durationSec: null }));
    const drifter = world.enemies.find(e => e.behavior === 'drifter')!;
    expect(drifter).toBeDefined();
    const dist = Math.hypot(drifter.pos.x, drifter.pos.y, drifter.pos.z);
    expect(dist).toBeGreaterThan(300); // DRIFTER_TUNING spawn distance is 350-500m from the player
  });

  it('positions an evasive spawn at the standoff distance directly ahead of the ship, not at (0,0,0)', () => {
    const world = makeWorld();
    startScenario(world, buildEvasivePilotScenario({ returnFire: false, durationSec: null }));
    const evasive = world.enemies.find(e => e.behavior === 'evasive')!;
    expect(evasive).toBeDefined();
    // ship spawns at the world origin facing +Z, so the standoff point is straight down +Z
    expect(evasive.pos.z).toBeGreaterThan(0);
    expect(evasive.evasive).toBeDefined();
  });

  it('resolves an orbiter into a real orbit position once ticked, not left at the placeholder', () => {
    const world = makeWorld();
    startScenario(world, buildAimTrainingScenario({ droneCount: 2, aggressiveness: 0.5, durationSec: null }));
    const orbiter = world.enemies.find(e => e.behavior === 'orbiter')!;
    expect(orbiter.orbit).toBeDefined();
    updateScenario(world, 1 / 60);
    const dist = Math.hypot(orbiter.pos.x, orbiter.pos.y, orbiter.pos.z);
    expect(dist).toBeGreaterThan(100); // orbit radius is 150-400m
  });
});

describe('win condition — "destroy" requires every enemy dead', () => {
  it('stays active while any enemy survives, wins only once all are dead', () => {
    const world = makeWorld();
    startScenario(world, destroyScenario(2));
    world.enemies[0].health.points = 0;
    updateScenario(world, 1 / 60);
    expect(world.scenario!.outcome).toBe('active');

    world.enemies[1].health.points = 0;
    updateScenario(world, 1 / 60);
    expect(world.scenario!.outcome).toBe('won');
  });
});

describe('win condition — "gates" priority ordering', () => {
  it('wins immediately on the final gate clear, even in the same tick a timeout would otherwise fire', () => {
    const world = makeWorld();
    startScenario(world, gatesScenario());
    // pre-age the run past its own surviveDurationSec, so a wrong ordering would read as a timeout
    // loss instead of the gate-clear win that should take priority.
    world.scenario!.elapsedSec = 9.99;
    world.player.ship.pos = { x: 0, y: 0, z: 101 }; // just past the (only) gate's plane, dead-center
    updateScenario(world, 0.5); // pushes elapsedSec to 10.49, past surviveDurationSec (10)
    expect(world.scenario!.outcome).toBe('won');
  });

  it('fails with a timeout when the duration elapses without clearing the current gate', () => {
    const world = makeWorld();
    startScenario(world, gatesScenario());
    world.scenario!.elapsedSec = 9.99;
    world.player.ship.pos = { x: 0, y: 0, z: 0 }; // still well ahead of the gate's plane
    updateScenario(world, 0.5);
    expect(world.scenario!.outcome).toBe('lost');
    expect(world.scenario!.failReason).toBe('timeout');
  });
});

describe('bubbleTicks', () => {
  it('floor-divides bubbleTimeSec into 0.1s ticks', () => {
    expect(bubbleTicks({ bubbleTimeSec: 0.35 } as never)).toBe(3);
    expect(bubbleTicks({ bubbleTimeSec: 0 } as never)).toBe(0);
    expect(bubbleTicks({ bubbleTimeSec: 1.0 } as never)).toBe(10);
  });
});
