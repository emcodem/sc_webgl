import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCircleRadius, setCircleRadius, getDampeningStrength, setDampeningStrength,
  dampingFactorForDistance, dampingFactor
} from '../src/combat/espAssist';

const DEFAULT_RADIUS = getCircleRadius();
const DEFAULT_STRENGTH = getDampeningStrength();

beforeEach(() => {
  setCircleRadius(DEFAULT_RADIUS);
  setDampeningStrength(DEFAULT_STRENGTH);
});

describe('dampingFactorForDistance', () => {
  it('is 1 (no dampening) at/beyond the circle radius', () => {
    setCircleRadius(50);
    expect(dampingFactorForDistance(50)).toBe(1);
    expect(dampingFactorForDistance(100)).toBe(1);
  });

  it('is 1 - dampeningStrength exactly at dead center', () => {
    setCircleRadius(50);
    setDampeningStrength(0.7);
    expect(dampingFactorForDistance(0)).toBeCloseTo(0.3, 6);
  });

  it('ramps linearly between center and the circle edge', () => {
    setCircleRadius(100);
    setDampeningStrength(0.5);
    expect(dampingFactorForDistance(50)).toBeCloseTo(0.75, 6); // halfway: 1 - 0.5*0.5
  });

  it('never dampens when circleRadiusPx <= 0', () => {
    setCircleRadius(0);
    expect(dampingFactorForDistance(0)).toBe(1);
  });
});

describe('dampingFactor', () => {
  it('returns 1 (no dampening) whenever the stick is outside the circle, regardless of PIP position', () => {
    setCircleRadius(50);
    expect(dampingFactor(0, 51)).toBe(1); // PIP dead-center, but stick outside -> no dampening
  });

  it('applies PIP-distance-based dampening once the stick is inside the circle', () => {
    setCircleRadius(50);
    setDampeningStrength(0.7);
    expect(dampingFactor(0, 10)).toBeCloseTo(dampingFactorForDistance(0), 10);
  });

  it('boundary: stick exactly at the circle radius counts as outside', () => {
    setCircleRadius(50);
    expect(dampingFactor(0, 50)).toBe(1);
  });
});
