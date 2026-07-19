import { describe, it, expect } from 'vitest';
import { applyDeadzone, applyExpo, shapeAxis, getExponent, setExponent, getDefaultExponent } from '../src/input/axisCurve';

describe('axisCurve — rescaled deadzone', () => {
  it('zeroes inputs within the deadzone', () => {
    expect(applyDeadzone(0, 0.1)).toBe(0);
    expect(applyDeadzone(0.05, 0.1)).toBe(0);
    expect(applyDeadzone(-0.1, 0.1)).toBe(0);
  });

  it('rescales the remaining range back onto (0..1] (no dead band at the top)', () => {
    expect(applyDeadzone(1, 0.1)).toBeCloseTo(1, 10);
    expect(applyDeadzone(-1, 0.1)).toBeCloseTo(-1, 10);
    // just past the deadzone starts from ~0, not from the raw value
    expect(applyDeadzone(0.1 + 1e-6, 0.1)).toBeCloseTo(0, 4);
    // midpoint above dz: (0.55 - 0.1) / (1 - 0.1) = 0.5
    expect(applyDeadzone(0.55, 0.1)).toBeCloseTo(0.5, 10);
  });

  it('is a no-op when dz <= 0', () => {
    expect(applyDeadzone(0.3, 0)).toBe(0.3);
  });
});

describe('axisCurve — convex expo curve', () => {
  it('fixes the endpoints and preserves sign', () => {
    expect(applyExpo(0, 1.48)).toBe(0);
    expect(applyExpo(1, 1.48)).toBeCloseTo(1, 10);
    expect(applyExpo(-1, 1.48)).toBeCloseTo(-1, 10);
    expect(applyExpo(-0.5, 1.48)).toBeLessThan(0);
  });

  it('is convex — small inputs produce disproportionately smaller output (the SC-matching fix)', () => {
    // 0.5^1.48 ~= 0.359, i.e. well below the linear 0.5
    expect(applyExpo(0.5, 1.48)).toBeCloseTo(0.5 ** 1.48, 10);
    expect(applyExpo(0.5, 1.48)).toBeLessThan(0.5);
  });

  it('exponent 1.0 is linear (the identity, used to disable shaping)', () => {
    expect(applyExpo(0.37, 1)).toBeCloseTo(0.37, 10);
  });

  it('is monotonic increasing across the range', () => {
    let prev = -Infinity;
    for (let v = -1; v <= 1.0001; v += 0.1) {
      const out = applyExpo(v, 1.48);
      expect(out).toBeGreaterThan(prev);
      prev = out;
    }
  });
});

describe('axisCurve — shapeAxis (deadzone then expo)', () => {
  it('composes deadzone then expo, sign-preserving, endpoints fixed', () => {
    expect(shapeAxis(0, 0.1, 1.48)).toBe(0);
    expect(shapeAxis(0.05, 0.1, 1.48)).toBe(0); // inside deadzone
    expect(shapeAxis(1, 0.1, 1.48)).toBeCloseTo(1, 10);
    // dz-rescaled 0.55 -> 0.5, then 0.5^1.48
    expect(shapeAxis(0.55, 0.1, 1.48)).toBeCloseTo(0.5 ** 1.48, 10);
  });

  it('defaults exp to the shared live exponent', () => {
    const original = getExponent();
    try {
      setExponent(2);
      expect(shapeAxis(0.5, 0)).toBeCloseTo(0.25, 10); // 0.5^2
    } finally {
      setExponent(original);
    }
    expect(getExponent()).toBe(original);
  });

  it('ships the SC-fitted default exponent', () => {
    expect(getDefaultExponent()).toBeCloseTo(1.48, 10);
    expect(getExponent()).toBeCloseTo(1.48, 10); // default until changed
  });
});
