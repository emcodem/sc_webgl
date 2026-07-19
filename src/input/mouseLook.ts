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
let offsetX = 0, offsetY = 0; // persistent virtual-stick deflection, in pixels
let sensitivity = 1.5;
let invertY = true;
let range = 10; // degrees of screen visual angle the mouse must cross for full deflection
// Mouse deadzone lives in input/axisCurve.ts (separate from the joystick's own deadzone).
const listeners: Array<(captured: boolean) => void> = [];

// Vertical FOV of the real three.js camera (render/renderer.ts's `new THREE.PerspectiveCamera(70, ...)`)
// — kept in sync here (duplicated the same way combat/projection.ts and combat/weapons.ts do) so
// "range" reads as an actual on-screen visual angle rather than a raw, resolution-dependent pixel count.
const CAMERA_FOV_DEG = 70;

// Pixels of mouse travel for full deflection, derived from `range` (degrees) and the current
// viewport height — resolution/FOV-independent, unlike a fixed pixel constant would be.
function getMaxOffsetPx(): number {
  const focalLength = window.innerHeight / (2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 180 / 2));
  return focalLength * Math.tan((range * Math.PI) / 180);
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

// Inject remote mouse deltas (e.g., from a capture server) into the virtual stick.
// Applied regardless of pointer-lock state since it comes from an external source (e.g., SC).
export function injectDelta(dx: number, dy: number): void {
  const maxOffset = getMaxOffsetPx();
  offsetX = Math.max(-maxOffset, Math.min(maxOffset, offsetX + dx));
  offsetY = Math.max(-maxOffset, Math.min(maxOffset, offsetY + dy));
}

// Reads the CURRENT stick deflection — does not reset it, since the deflection should keep
// driving rotation until the mouse is physically moved back or recenter() is called.
export function consume(): MouseLookInput {
  const maxOffset = getMaxOffsetPx();
  // rescaled mouse deadzone + shared expo curve (SC-matching, see axisCurve.ts), then sensitivity.
  const dz = getMouseDeadzone();
  const xRatio = shapeAxis(offsetX / maxOffset, dz);
  const yRatio = shapeAxis(offsetY / maxOffset, dz);
  const yaw = Math.max(-1, Math.min(1, xRatio * sensitivity));
  let pitch = Math.max(-1, Math.min(1, yRatio * sensitivity));
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
export function getSensitivity(): number { return sensitivity; }
export function setSensitivity(v: number): void { sensitivity = v; }
export function getInvertY(): boolean { return invertY; }
export function setInvertY(v: boolean): void { invertY = v; }
export function getRange(): number { return range; }
export function setRange(v: number): void { range = v; }

interface MouseLookConfig {
  sensitivity: number;
  invertY: boolean;
  range: number;
}
registerConfig({
  key: 'mouseLook',
  serialize: (): MouseLookConfig => ({ sensitivity, invertY, range }),
  deserialize: (data) => {
    const d = data as Partial<MouseLookConfig> | null | undefined;
    if (!d) return;
    if (typeof d.sensitivity === 'number') sensitivity = d.sensitivity;
    if (typeof d.invertY === 'boolean') invertY = d.invertY;
    if (typeof d.range === 'number') range = d.range;
  }
});
