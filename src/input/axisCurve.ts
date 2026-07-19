import { registerConfig } from './configRegistry';

// ============================================================================================
// Shared input-axis shaping: a rescaled near-center deadzone + a convex "expo" response curve,
// applied to BOTH the mouse virtual-joystick (mouseLook.ts) and the vJoy/gamepad axes
// (joystickMap.ts).
//
// WHY: Star Citizen's default vjoy/mouse input curve is CONVEX — a small stick deflection produces a
// disproportionately SMALL rotation rate (measured power-law exponent ~1.48; see
// capture/MEASUREMENTS.md "Input-curve shape — CONVEX / expo"). Our input was previously linear, so
// the ship over-responded to tiny inputs vs the real game. This stage reproduces that curve. It is an
// INPUT-layer concern only — the flight model (flightModel.ts) still receives a normalized -1..1 and
// is untouched.
//
// `exponent` is the single shared, live-tunable knob (F4 panel slider + window.__setInputExpo), so
// it can be dialed in empirically against real SC side-by-side. 1.0 == linear; higher == more convex
// (softer near center). Persisted via the control-preset system (registerConfig below).
// ============================================================================================

const DEFAULT_EXPONENT = 1.48; // fitted to SC's mouse-vjoy curve (MEASUREMENTS.md)
let exponent = DEFAULT_EXPONENT;

export function getExponent(): number { return exponent; }
export function setExponent(v: number): void { exponent = v; }
export function getDefaultExponent(): number { return DEFAULT_EXPONENT; }

// Rescaled deadzone: |v| within `dz` maps to 0, and the remaining (dz..1] range is stretched back
// onto (0..1] so full deflection still reaches ±1 (no dead band at the top). This is the rescaled
// form recommended in MEASUREMENTS.md over a hard cut. `v` and `dz` are on the same normalized scale.
export function applyDeadzone(v: number, dz: number): number {
  if (dz <= 0) return v;
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * (a - dz) / (1 - dz);
}

// Convex expo curve on a normalized -1..1 value: sign-preserving, endpoints fixed (0 -> 0, ±1 -> ±1).
export function applyExpo(v: number, exp: number = exponent): number {
  return Math.sign(v) * Math.pow(Math.abs(v), exp);
}

// The full shaping stage: rescaled deadzone, then the convex expo curve. `exp` defaults to the shared
// live-tunable exponent so both input paths track the same knob unless a caller overrides it.
export function shapeAxis(v: number, dz: number, exp: number = exponent): number {
  return applyExpo(applyDeadzone(v, dz), exp);
}

registerConfig({
  key: 'axisCurve',
  serialize: () => ({ exponent }),
  deserialize: (data) => {
    const d = data as { exponent?: number } | null | undefined;
    if (d && typeof d.exponent === 'number') exponent = d.exponent;
  }
});
