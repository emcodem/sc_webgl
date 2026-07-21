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
let invertY = true;
// Raw mouse counts (movementX/Y units, i.e. SendInput/WM_INPUT-equivalent deltas) needed for full
// deflection. NOT the same thing as SC's own "VJoy Range" (`VJoyAnglePilots`) setting -- that one is
// confirmed cosmetic-only (MEASUREMENTS.md: changes the on-screen indicator's travel/appearance, zero
// effect on flight, tested 4 vs 25). This constant models a DIFFERENT thing: SC's actual, apparently
// non-adjustable mouse->stick gain, which isn't exposed as any named setting in SC at all -- we just
// measured it directly (capture/MEASUREMENTS.md's dense yaw sweep fits full_range ~1500 counts,
// resolution-independent). Previously this was modeled as "degrees of screen visual angle for full
// deflection" (an FOV/viewport-derived guess with no such SC equivalent at all), needing 5-18x LESS
// physical mouse travel than real SC actually does for the same deflection -- that mismatch, not the
// curve shape, was the main reason small mouse nudges over-rotated the ship relative to real SC.
let fullDeflectionCounts = 1500;
// Mouse deadzone lives in input/axisCurve.ts (separate from the joystick's own deadzone).
const listeners: Array<(captured: boolean) => void> = [];

// PURELY COSMETIC — SC's own "VJoy Range" (`VJoyAnglePilots`) slider, confirmed to only change the
// on-screen vjoy indicator's travel/appearance, not flight (MEASUREMENTS.md: 4 vs 25 gave identical
// yaw rate; see `fullDeflectionCounts` above for the thing that actually IS the flight-relevant
// gain). "Degrees" is literal, not an arbitrary UI unit: it's a horizontal FOV-relative visual angle
// -- SC renders the indicator tip as if it were a fixed point that many degrees off boresight,
// projected onto the 2D screen via the same pinhole-camera math (f = (width/2)/tan(FOV_h/2), then
// f*tan(degrees)) this project's own capture/analysis/angle_convert.py already uses for landmark
// tracking. Confirmed against two real measurements (FOV116, 3840px-wide monitor): VJA=25 -> 570px,
// VJA=10 -> 222px indicator travel -- the fitted focal length (~1222px) matches the theoretical
// f=1200px for that FOV/width within ~2%, an independent cross-check, not just a 2-point curve-fit.
// See hud.ts's indicator draw for the actual formula.
let vjoyRangeDegrees = 10;
export function getVjoyRangeDegrees(): number { return vjoyRangeDegrees; }
export function setVjoyRangeDegrees(v: number): void { vjoyRangeDegrees = v; }

function getMaxOffsetPx(): number {
  return fullDeflectionCounts;
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
  const maxOffset = getMaxOffsetPx();
  offsetX = Math.max(-maxOffset, Math.min(maxOffset, offsetX + (e.movementX || 0)));
  offsetY = Math.max(-maxOffset, Math.min(maxOffset, offsetY + (e.movementY || 0)));
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
  const maxOffset = getMaxOffsetPx();
  offsetX = Math.max(-maxOffset, Math.min(maxOffset, offsetX + dx));
  offsetY = Math.max(-maxOffset, Math.min(maxOffset, offsetY + dy));
}

// Reads the CURRENT stick deflection — does not reset it, since the deflection should keep
// driving rotation until the mouse is physically moved back or recenter() is called.
export function consume(): MouseLookInput {
  const maxOffset = getMaxOffsetPx();
  // rescaled mouse deadzone + shared expo curve (SC-matching, see axisCurve.ts). No separate
  // "sensitivity" multiplier: in real SC that setting only scales OS pointer speed, it never
  // touches the vjoy stick curve — deflection is governed purely by range/deadzone/curve.
  const dz = getMouseDeadzone();
  const yaw = shapeAxis(offsetX / maxOffset, dz);
  let pitch = shapeAxis(offsetY / maxOffset, dz);
  if (invertY) pitch = -pitch;
  return { pitch, yaw };
}

export function isCaptured(): boolean {
  return captured;
}
export function getOffset(): { x: number; y: number; max: number } {
  return { x: offsetX, y: offsetY, max: getMaxOffsetPx() };
}
export function onChange(fn: (captured: boolean) => void): void {
  listeners.push(fn);
}
export function getInvertY(): boolean { return invertY; }
export function setInvertY(v: boolean): void { invertY = v; }
export function getFullDeflectionCounts(): number { return fullDeflectionCounts; }
export function setFullDeflectionCounts(v: number): void { fullDeflectionCounts = v; }

interface MouseLookConfig {
  invertY: boolean;
  fullDeflectionCounts: number;
  vjoyRangeDegrees: number;
}
registerConfig({
  key: 'mouseLook',
  serialize: (): MouseLookConfig => ({ invertY, fullDeflectionCounts, vjoyRangeDegrees }),
  deserialize: (data) => {
    const d = data as Partial<MouseLookConfig> & { range?: number; indicatorSizePercent?: number } | null | undefined;
    if (!d) return;
    if (typeof d.invertY === 'boolean') invertY = d.invertY;
    if (typeof d.fullDeflectionCounts === 'number') fullDeflectionCounts = d.fullDeflectionCounts;
    else if (typeof d.range === 'number') fullDeflectionCounts = d.range; // legacy preset field name
    if (typeof d.vjoyRangeDegrees === 'number') vjoyRangeDegrees = d.vjoyRangeDegrees;
    // legacy preset field name/units (0-100%, pre-degrees) — not equivalent, but keeps old presets loadable
    else if (typeof d.indicatorSizePercent === 'number') vjoyRangeDegrees = d.indicatorSizePercent;
  }
});
