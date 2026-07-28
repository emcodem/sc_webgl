import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCircleRadius, setCircleRadius, getDampeningStrength, setDampeningStrength,
  targetScalarForDistance, stepDamping, resetDamping
} from '../src/combat/espAssist';

const DEFAULT_RADIUS = getCircleRadius();
const DEFAULT_STRENGTH = getDampeningStrength();
const MIN_SCALE = 0.25; // must track espAssist.ts's own MIN_SCALE constant

beforeEach(() => {
  setCircleRadius(DEFAULT_RADIUS);
  setDampeningStrength(DEFAULT_STRENGTH);
  resetDamping();
});

describe('targetScalarForDistance', () => {
  it('is 1 (no dampening) at/beyond the circle radius', () => {
    setCircleRadius(50);
    expect(targetScalarForDistance(50)).toBe(1);
    expect(targetScalarForDistance(100)).toBe(1);
  });

  it('never drops below MIN_SCALE, even at max dampeningStrength dead-center', () => {
    setCircleRadius(50);
    setDampeningStrength(1);
    expect(targetScalarForDistance(0)).toBeCloseTo(MIN_SCALE, 6);
  });

  it('scales the floor by dampeningStrength between 1 and MIN_SCALE', () => {
    setCircleRadius(50);
    setDampeningStrength(0.7);
    // dead center: 1 - (1-MIN_SCALE)*dampeningStrength*eased(1) = 1 - (1-MIN_SCALE)*0.7
    expect(targetScalarForDistance(0)).toBeCloseTo(1 - (1 - MIN_SCALE) * 0.7, 6);
  });

  it('ramps by an eased (sqrt) curve between center and the circle edge', () => {
    setCircleRadius(100);
    setDampeningStrength(0.5);
    const maxRemoval = (1 - MIN_SCALE) * 0.5;
    expect(targetScalarForDistance(50)).toBeCloseTo(1 - maxRemoval * Math.sqrt(0.5), 6);
  });

  it('never dampens when circleRadiusPx <= 0', () => {
    setCircleRadius(0);
    expect(targetScalarForDistance(0)).toBe(1);
  });

  it('dampens a PIP dead-center regardless of how large the stick input was', () => {
    // no stick-position gate — real ESP dampens full-deflection input too (2026-07-29)
    setCircleRadius(50);
    setDampeningStrength(0.7);
    expect(targetScalarForDistance(0)).toBeLessThan(1);
  });
});

describe('stepDamping', () => {
  it('starts at 1 (no target) and stays there with no PIP', () => {
    expect(stepDamping(null, 1 / 60)).toBeCloseTo(1, 6);
  });

  it('smooths toward the target rather than snapping instantly', () => {
    setCircleRadius(50);
    setDampeningStrength(1);
    const target = targetScalarForDistance(0);
    const afterOneFrame = stepDamping(0, 1 / 60);
    expect(afterOneFrame).toBeLessThan(1);
    expect(afterOneFrame).toBeGreaterThan(target); // hasn't fully caught up yet
  });

  it('converges to the target given enough elapsed time', () => {
    setCircleRadius(50);
    setDampeningStrength(1);
    let factor = 1;
    for (let i = 0; i < 300; i++) factor = stepDamping(0, 1 / 60);
    expect(factor).toBeCloseTo(targetScalarForDistance(0), 3);
  });

  it('decays back toward 1 once the PIP is lost, instead of snapping', () => {
    setCircleRadius(50);
    setDampeningStrength(1);
    for (let i = 0; i < 300; i++) stepDamping(0, 1 / 60);
    const justAfterLoss = stepDamping(null, 1 / 60);
    expect(justAfterLoss).toBeGreaterThan(targetScalarForDistance(0));
    expect(justAfterLoss).toBeLessThan(1);
  });

  it('resetDamping snaps the smoothed scalar back to 1', () => {
    setCircleRadius(50);
    setDampeningStrength(1);
    for (let i = 0; i < 300; i++) stepDamping(0, 1 / 60);
    resetDamping();
    expect(stepDamping(null, 0)).toBe(1);
  });
});
