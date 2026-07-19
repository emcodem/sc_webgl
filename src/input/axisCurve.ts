import { registerConfig } from './configRegistry';

// ============================================================================================
// Input-axis shaping: a rescaled near-center deadzone + an "expo" response curve. It is an INPUT-layer
// concern only — the flight model (flightModel.ts) still receives a normalized -1..1 and is untouched.
//
// The expo curve is MOUSE-ONLY. Star Citizen applies a convex curve to the MOUSE virtual joystick
// (MEASUREMENTS.md "Input-curve shape — CONVEX / expo", exponent ~1.48) but the physical/vJoy
// joystick axes are LINEAR in-game — confirmed matching the game at exponent 1. So mouseLook.ts uses
// the tunable `exponent` below, while joystickMap.ts calls shapeAxis with exp=1 (deadzone only).
//
// `exponent` is the live-tunable knob (F4 "Input Curve" slider + window.__setInputExpo), dialed in
// against real SC. 1.0 == linear; <1 == concave (sharper near center); >1 == convex (softer near
// center). Persisted via the control-preset system (registerConfig below).
// ============================================================================================

const DEFAULT_EXPONENT = 1.48; // MOUSE curve: convex, matches MEASUREMENTS.md "Input-curve shape — CONVEX / expo"
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
  }
});
