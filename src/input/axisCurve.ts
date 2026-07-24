import { registerConfig } from './configRegistry';

// ============================================================================================
// Input-axis shaping: a rescaled near-center deadzone + an "expo" response curve. It is an INPUT-layer
// concern only — the flight model (flightModel.ts) still receives a normalized -1..1 and is untouched.
//
// The expo curve is MOUSE-ONLY. The physical/vJoy joystick axes are LINEAR in-game — confirmed
// matching the game at exponent 1 — so joystickMap.ts calls shapeAxis with exp=1 (deadzone only).
// mouseLook.ts uses the tunable `exponent` below for its own axis.
//
// `exponent` is the live-tunable knob (F4 "Input Curve" slider + window.__setInputExpo), dialed in
// against real SC. 1.0 == linear; <1 == concave (sharper near center); >1 == convex (softer near
// center). Persisted via the control-preset system (registerConfig below).
//
// The default is ~1 (linear), NOT the ~1.48 an earlier, sparser capture (150-600 counts only, no
// saturation anchor) suggested -- that figure was an artifact of fitting a rising curve with no
// ceiling in the data, forcing a steeper exponent to explain the same rise while implicitly
// extrapolating a much higher (wrong) ceiling. Refit 2026-07-23 against the full clamp-cleaned dense
// yaw dataset (deadzone edge through the 1920-count clamp boundary, least-squares against the exact
// rescaled-deadzone power-law model below): exponent 1.011, full_range 1491 (matches the independently
// measured ~1500), RMS 0.46 deg/s across a 0-51 deg/s range -- this IS the confirmed fit, not a guess.
// Practical reading: yaw's per-count sensitivity climbing steeply near the deadzone edge (noted in
// MEASUREMENTS.md) is almost entirely the deadzone RESCALING, not curve convexity -- once that's
// accounted for, yaw's actual response is within noise of pure linear. A Kumaraswamy (saturating)
// model was also tried and did not improve on this (RMS 0.41, a=1.05 b=1.08 -- also ~linear); no
// need for a different curve family. See MEASUREMENTS.md "Input-curve shape" for the fitted numbers.
//
// PITCH is NOT covered by this fit and does not yet have its own confirmed exponent -- its own
// dataset (100-1080 counts) is noisier (mostly single reps) and the least-squares full_range wants to
// exceed pitch's independently-confirmed ~1080 saturation point, so no pitch-specific exponent has
// been committed. `shapeAxis` currently applies ONE shared exponent to both axes (mouseLook.ts
// normalizes each axis against its own full-deflection count first) -- fine while pitch's own value is
// unconfirmed, but if a repeat-rep pitch dataset ever fits a meaningfully different exponent, this will
// need to become per-axis, not shared.
// ============================================================================================

const DEFAULT_EXPONENT = 1.01; // MOUSE curve (yaw-fit; see above): confirmed via least-squares refit, ~linear
let exponent = DEFAULT_EXPONENT;

export function getExponent(): number { return exponent; }
export function setExponent(v: number): void { exponent = v; }
export function getDefaultExponent(): number { return DEFAULT_EXPONENT; }

// Mouse near-center deadzone (fraction of full deflection, 0..1). Default 4.45% matches SC's
// VJoyCombinedDeadZone (MEASUREMENTS.md). The JOYSTICK deadzone is a separate config — see
// input/joystickDeadzone.ts (a physical stick needs a much larger dead region).
const DEFAULT_MOUSE_DEADZONE = 0.0445;
let mouseDeadzone = DEFAULT_MOUSE_DEADZONE;

export function getMouseDeadzone(): number { return mouseDeadzone; }
export function setMouseDeadzone(v: number): void { mouseDeadzone = v; }
export function getDefaultMouseDeadzone(): number { return DEFAULT_MOUSE_DEADZONE; }

// Rescaled deadzone: |v| within `dz` maps to 0, and the remaining (dz..1] range is stretched back
// onto (0..1] so full deflection still reaches ±1 (no dead band at the top). This is the rescaled
// form recommended in MEASUREMENTS.md over a hard cut. `v` and `dz` are on the same normalized scale.
export function applyDeadzone(v: number, dz: number): number {
  if (dz <= 0) return v;
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * (a - dz) / (1 - dz);
}

// Expo curve on a normalized -1..1 value: sign-preserving, endpoints fixed (0 -> 0, ±1 -> ±1).
// exp<1 is concave (sharper near center), exp>1 is convex (softer near center), exp==1 is linear.
export function applyExpo(v: number, exp: number = exponent): number {
  return Math.sign(v) * Math.pow(Math.abs(v), exp);
}

// The full shaping stage: rescaled deadzone, then the expo curve. `dz` is required (per-device — pass
// getMouseDeadzone()/getJoystickDeadzone()); `exp` defaults to the shared live-tunable exponent.
export function shapeAxis(v: number, dz: number, exp: number = exponent): number {
  return applyExpo(applyDeadzone(v, dz), exp);
}

registerConfig({
  key: 'axisCurve',
  serialize: () => ({ exponent, mouseDeadzone }),
  deserialize: (data) => {
    const d = data as { exponent?: number; mouseDeadzone?: number; deadzone?: number } | null | undefined;
    if (!d) return;
    if (typeof d.exponent === 'number') exponent = d.exponent;
    if (typeof d.mouseDeadzone === 'number') mouseDeadzone = d.mouseDeadzone;
    else if (typeof d.deadzone === 'number') mouseDeadzone = d.deadzone; // legacy single-deadzone preset
  },
  resetToDefault: () => {
    exponent = DEFAULT_EXPONENT;
    mouseDeadzone = DEFAULT_MOUSE_DEADZONE;
  }
});
