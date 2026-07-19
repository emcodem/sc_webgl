import { describe, it, expect } from 'vitest';
import {
  applyDeadzone, applyExpo, shapeAxis,
  getExponent, setExponent, getDefaultExponent,
  getMouseDeadzone, getDefaultMouseDeadzone
} from '../src/input/axisCurve';
import { getJoystickDeadzone, getDefaultJoystickDeadzone } from '../src/input/joystickDeadzone';

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

  it('exponent > 1 is convex — small inputs produce disproportionately smaller output', () => {
    // 0.5^1.48 ~= 0.359, i.e. well below the linear 0.5
    expect(applyExpo(0.5, 1.48)).toBeCloseTo(0.5 ** 1.48, 10);
    expect(applyExpo(0.5, 1.48)).toBeLessThan(0.5);
  });

  it('exponent < 1 is concave — small inputs produce larger output (the vJoy-device curve)', () => {
    // 0.5^0.6 ~= 0.66, matching BLUEPRINT.md's "u=0.5 -> ~65% of full rate"
    expect(applyExpo(0.5, 0.6)).toBeCloseTo(0.5 ** 0.6, 10);
    expect(applyExpo(0.5, 0.6)).toBeGreaterThan(0.5);
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

  it('ships the SC mouse-curve default exponent (convex, MEASUREMENTS.md) — mouse only, joystick is linear', () => {
    expect(getDefaultExponent()).toBeCloseTo(1.48, 10);
    expect(getExponent()).toBeCloseTo(1.48, 10); // default until changed
  });

  it('applies the explicit per-device deadzone passed to it', () => {
    const originalExp = getExponent();
    try {
      setExponent(1); // isolate the deadzone effect
      expect(shapeAxis(0.15, 0.2)).toBe(0);            // inside the passed deadzone
      expect(shapeAxis(0.6, 0.2)).toBeCloseTo(0.5, 10); // (0.6 - 0.2) / (1 - 0.2)
    } finally {
      setExponent(originalExp);
    }
  });

  it('ships separate SC-fitted default deadzones for mouse vs joystick (separate configs)', () => {
    expect(getDefaultMouseDeadzone()).toBeCloseTo(0.0445, 10);   // axisCurve config — SC VJoyCombinedDeadZone (mouse)
    expect(getMouseDeadzone()).toBeCloseTo(0.0445, 10);          // default until changed
    expect(getDefaultJoystickDeadzone()).toBeCloseTo(0.03, 10);  // joystickDeadzone config — SC joystick deadzone
    expect(getJoystickDeadzone()).toBeCloseTo(0.03, 10);         // default until changed
  });
});
