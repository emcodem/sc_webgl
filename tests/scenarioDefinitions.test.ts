import { describe, it, expect } from 'vitest';
import { buildAimTrainingScenario, AIM_TRAINING_DEFAULTS, SCENARIOS } from '../src/scenarios/definitions';

describe('buildAimTrainingScenario', () => {
  it('splits an odd droneCount with the orbiter side getting the extra one (Math.ceil)', () => {
    const config = buildAimTrainingScenario({ ...AIM_TRAINING_DEFAULTS, droneCount: 15 });
    const orbiterCount = config.enemySpawns.filter(s => s.behavior === 'orbiter').length;
    const drifterCount = config.enemySpawns.filter(s => s.behavior === 'drifter').length;
    expect(orbiterCount).toBe(8);
    expect(drifterCount).toBe(7);
    expect(orbiterCount + drifterCount).toBe(15);
  });

  it('splits an even droneCount evenly', () => {
    const config = buildAimTrainingScenario({ ...AIM_TRAINING_DEFAULTS, droneCount: 10 });
    expect(config.enemySpawns.filter(s => s.behavior === 'orbiter')).toHaveLength(5);
    expect(config.enemySpawns.filter(s => s.behavior === 'drifter')).toHaveLength(5);
  });

  it('narrows a null durationSec to undefined on surviveDurationSec', () => {
    const config = buildAimTrainingScenario({ ...AIM_TRAINING_DEFAULTS, durationSec: null });
    expect(config.surviveDurationSec).toBeUndefined();
  });

  it('passes a numeric durationSec straight through', () => {
    const config = buildAimTrainingScenario({ ...AIM_TRAINING_DEFAULTS, durationSec: 60 });
    expect(config.surviveDurationSec).toBe(60);
  });
});

describe('SCENARIOS', () => {
  it('has 8 entries with unique ids', () => {
    expect(SCENARIOS).toHaveLength(8);
    const ids = new Set(SCENARIOS.map(s => s.id));
    expect(ids.size).toBe(SCENARIOS.length);
  });
});
