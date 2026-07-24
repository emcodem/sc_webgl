import { registerConfig } from './configRegistry';
import { shapeAxis, getMouseDeadzone } from './axisCurve';

// ============================================================================================
// MouseLook — the "full vjoy" the flight model wants: models Star Citizen's default ABSOLUTE
// mouse-flight mode. The mouse acts like a virtual joystick that stays deflected once moved,
// driving a continuous pitch/yaw rate until you move it back toward center — it does NOT reset
// every frame the way FPS-style relative look does (which is what control/foot.ts still uses for
// on-foot look; this module is only consumed by control/pilot.ts for flight aim).
//
// Reacts passively to pointer-lock state (input/input.ts's canvas click handler owns actually
// requesting the lock) via its own 'pointerlockchange' listener — both modules observing the same
// browser-owned lock state is fine, there's no exclusivity conflict.
// ============================================================================================

export interface MouseLookInput {
  pitch: number;
  yaw: number;
}

const canvas = document.getElementById('c') as HTMLCanvasElement;

let captured = false;
let offsetX = 0, offsetY = 0; // persistent virtual-stick deflection, in raw mouse counts (movementX/Y units)
const DEFAULT_INVERT_Y = true;
let invertY = DEFAULT_INVERT_Y;
// Raw mouse counts (movementX/Y units, i.e. SendInput/WM_INPUT-equivalent deltas) needed for full
// deflection. NOT the same thing as SC's own "VJoy Range" (`VJoyAnglePilots`) setting -- that one is
// confirmed cosmetic-only (MEASUREMENTS.md: changes the on-screen indicator's travel/appearance, zero
// effect on flight, tested 4 vs 25). This constant models a DIFFERENT thing: SC's actual, apparently
// non-adjustable mouse->stick gain, which isn't exposed as any named setting in SC at all -- we just
// measured it directly. Previously this was modeled as "degrees of screen visual angle for full
// deflection" (an FOV/viewport-derived guess with no such SC equivalent at all), needing 5-18x LESS
// physical mouse travel than real SC actually does for the same deflection -- that mismatch, not the
// curve shape, was the main reason small mouse nudges over-rotated the ship relative to real SC.
//
// YAW AND PITCH DO NOT SHARE ONE VALUE -- confirmed by two independent measurements. capture/
// MEASUREMENTS.md's dense yaw sweep (100-2200 counts, sun-tracked) fits yaw's full_range at ~1500
// counts, plateauing flat from there through the resolution-derived clamp (1920 counts at 3840x2160
// capture; re-confirmed 2026-07-23 at 51.27 deg/s, matching the plateau). Pitch's own sweep instead
// found its plateau/clamp at ~1080 counts -- found via live in-game bisection (clean release-to-zero
// up to 1080, overshoot into reverse rotation above it) and reconfirmed 2026-07-23 with a clean
// sun-tracked capture driven exactly at 1080: 64.86 deg/s unboosted, 71.11 deg/s boosted. A
// pitch/yaw ratio sweep at matching offsets (100-1000 counts) also showed the ratio varying from
// 6.27x down to ~1.76x rather than holding constant, ruling out "pitch is yaw's curve rescaled by a
// max rate" -- the two axes have genuinely different curves, not just different endpoints. See
// capture/MEASUREMENTS.md's "PITCH curve shape" and "Clamp-boundary check at 1920 counts" entries.
const DEFAULT_YAW_FULL_DEFLECTION_COUNTS = 1500;
const DEFAULT_PITCH_FULL_DEFLECTION_COUNTS = 1080;
let yawFullDeflectionCounts = DEFAULT_YAW_FULL_DEFLECTION_COUNTS;
let pitchFullDeflectionCounts = DEFAULT_PITCH_FULL_DEFLECTION_COUNTS;
// Mouse deadzone lives in input/axisCurve.ts (separate from the joystick's own deadzone).
const listeners: Array<(captured: boolean) => void> = [];

// PURELY COSMETIC — SC's own "VJoy Range" (`VJoyAnglePilots`) slider, confirmed to only change the
// on-screen vjoy indicator's travel/appearance, not flight (MEASUREMENTS.md: 4 vs 25 gave identical
// yaw rate; see yawFullDeflectionCounts/pitchFullDeflectionCounts above for the thing that actually
// IS the flight-relevant gain). "Degrees" is literal, not an arbitrary UI unit: it's a horizontal FOV-relative visual angle
// -- SC renders the indicator tip as if it were a fixed point that many degrees off boresight,
// projected onto the 2D screen via the same pinhole-camera math (f = (width/2)/tan(FOV_h/2), then
// f*tan(degrees)) this project's own capture/analysis/angle_convert.py already uses for landmark
// tracking. Confirmed against two real measurements (FOV116, 3840px-wide monitor): VJA=25 -> 570px,
// VJA=10 -> 222px indicator travel -- the fitted focal length (~1222px) matches the theoretical
// f=1200px for that FOV/width within ~2%, an independent cross-check, not just a 2-point curve-fit.
// See hud.ts's indicator draw for the actual formula.
const DEFAULT_VJOY_RANGE_DEGREES = 10;
let vjoyRangeDegrees = DEFAULT_VJOY_RANGE_DEGREES;
export function getVjoyRangeDegrees(): number { return vjoyRangeDegrees; }
export function setVjoyRangeDegrees(v: number): void { vjoyRangeDegrees = v; }

function getYawMaxOffsetPx(): number {
  return yawFullDeflectionCounts;
}
function getPitchMaxOffsetPx(): number {
  return pitchFullDeflectionCounts;
}

function notify(): void {
  listeners.forEach(fn => fn(captured));
}

document.addEventListener('pointerlockchange', () => {
  captured = document.pointerLockElement === canvas;
  offsetX = 0; offsetY = 0; // recenter whenever capture state changes
  notify();
});
document.addEventListener('pointerlockerror', () => {
  captured = false;
  notify();
});
document.addEventListener('mousemove', (e) => {
  if (!captured) return;
  const maxYaw = getYawMaxOffsetPx();
  const maxPitch = getPitchMaxOffsetPx();
  offsetX = Math.max(-maxYaw, Math.min(maxYaw, offsetX + (e.movementX || 0)));
  offsetY = Math.max(-maxPitch, Math.min(maxPitch, offsetY + (e.movementY || 0)));
});
window.addEventListener('blur', () => {
  try { if (document.pointerLockElement === canvas) document.exitPointerLock(); } catch { /* ignore */ }
});

export function recenter(): void {
  offsetX = 0; offsetY = 0;
}

// Inject remote mouse deltas (raw relative pixels from the capture pipeline — see
// input/remoteMouseInput.ts) into the persistent virtual stick, mirroring how SC integrates
// mouse motion into its own stick deflection. Applied regardless of pointer-lock state, since it
// comes from an external window (the real SC), not this canvas's own pointer lock. The clamp is
// the vjoy's full-deflection cap (same as the local mousemove path) — NOT the source of the old
// "stuck partway" bug; that was the capture script saturating on absolute cursor coords.
export function injectDelta(dx: number, dy: number): void {
  const maxYaw = getYawMaxOffsetPx();
  const maxPitch = getPitchMaxOffsetPx();
  offsetX = Math.max(-maxYaw, Math.min(maxYaw, offsetX + dx));
  offsetY = Math.max(-maxPitch, Math.min(maxPitch, offsetY + dy));
}

// Reads the CURRENT stick deflection — does not reset it, since the deflection should keep
// driving rotation until the mouse is physically moved back or recenter() is called.
export function consume(): MouseLookInput {
  // rescaled mouse deadzone + shared expo curve (SC-matching, see axisCurve.ts). No separate
  // "sensitivity" multiplier: in real SC that setting only scales OS pointer speed, it never
  // touches the vjoy stick curve — deflection is governed purely by range/deadzone/curve.
  // Each axis normalizes against its OWN full-deflection count (see yawFullDeflectionCounts/
  // pitchFullDeflectionCounts above) — they are measurably different in real SC, not one shared gain.
  const dz = getMouseDeadzone();
  const yaw = shapeAxis(offsetX / getYawMaxOffsetPx(), dz);
  let pitch = shapeAxis(offsetY / getPitchMaxOffsetPx(), dz);
  if (invertY) pitch = -pitch;
  return { pitch, yaw };
}

export function isCaptured(): boolean {
  return captured;
}
export function getOffset(): { x: number; y: number; maxX: number; maxY: number } {
  return { x: offsetX, y: offsetY, maxX: getYawMaxOffsetPx(), maxY: getPitchMaxOffsetPx() };
}
export function onChange(fn: (captured: boolean) => void): void {
  listeners.push(fn);
}
export function getInvertY(): boolean { return invertY; }
export function setInvertY(v: boolean): void { invertY = v; }
export function getYawFullDeflectionCounts(): number { return yawFullDeflectionCounts; }
export function setYawFullDeflectionCounts(v: number): void { yawFullDeflectionCounts = v; }
export function getPitchFullDeflectionCounts(): number { return pitchFullDeflectionCounts; }
export function setPitchFullDeflectionCounts(v: number): void { pitchFullDeflectionCounts = v; }

interface MouseLookConfig {
  invertY: boolean;
  yawFullDeflectionCounts: number;
  pitchFullDeflectionCounts: number;
  vjoyRangeDegrees: number;
}
registerConfig({
  key: 'mouseLook',
  serialize: (): MouseLookConfig => ({ invertY, yawFullDeflectionCounts, pitchFullDeflectionCounts, vjoyRangeDegrees }),
  deserialize: (data) => {
    const d = data as Partial<MouseLookConfig> & { fullDeflectionCounts?: number; range?: number; indicatorSizePercent?: number } | null | undefined;
    if (!d) return;
    if (typeof d.invertY === 'boolean') invertY = d.invertY;
    if (typeof d.yawFullDeflectionCounts === 'number') yawFullDeflectionCounts = d.yawFullDeflectionCounts;
    if (typeof d.pitchFullDeflectionCounts === 'number') pitchFullDeflectionCounts = d.pitchFullDeflectionCounts;
    // legacy preset field name: one shared count for both axes (pre-2026-07-23) — apply to both so
    // an old saved preset keeps its old (imprecise but familiar) behavior until re-tuned.
    else if (typeof d.fullDeflectionCounts === 'number') pitchFullDeflectionCounts = yawFullDeflectionCounts = d.fullDeflectionCounts;
    else if (typeof d.range === 'number') pitchFullDeflectionCounts = yawFullDeflectionCounts = d.range;
    if (typeof d.vjoyRangeDegrees === 'number') vjoyRangeDegrees = d.vjoyRangeDegrees;
    // legacy preset field name/units (0-100%, pre-degrees) — not equivalent, but keeps old presets loadable
    else if (typeof d.indicatorSizePercent === 'number') vjoyRangeDegrees = d.indicatorSizePercent;
  },
  resetToDefault: () => {
    invertY = DEFAULT_INVERT_Y;
    yawFullDeflectionCounts = DEFAULT_YAW_FULL_DEFLECTION_COUNTS;
    pitchFullDeflectionCounts = DEFAULT_PITCH_FULL_DEFLECTION_COUNTS;
    vjoyRangeDegrees = DEFAULT_VJOY_RANGE_DEGREES;
  }
});
