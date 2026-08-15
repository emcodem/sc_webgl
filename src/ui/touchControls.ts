import type { World } from '../core/world';
import type { ActionName } from '../input/actions';
import * as TouchInput from '../input/touchInput';
import { isTouchPrimary } from './deviceDetect';

// ============================================================================================
// Touch/mobile on-screen controls. Ported from the original project's ui/touchControls.ts +
// input/touchInput.ts: two "floating" dual thumbsticks that materialize wherever each thumb first
// lands (split at screen-center — left half drives strafe/move, right half drives aim/look), plus
// a button cluster, feeding input/touchInput.ts's shared state. No-ops entirely on a non-touch
// device (see ui/deviceDetect.ts's isTouchPrimary(), same detection used everywhere else in this
// project touch is checked).
//
// Everything here only WRITES into input/touchInput.ts's TouchAxes-equivalent state; the actual
// consumption (summed additively alongside keyboard/mouse/joystick) happens in control/pilot.ts,
// control/foot.ts, control/mode.ts and combat/combatSystem.ts — same additive-source rule as the
// original project's physics/step.ts.
//
// sc_webgl-specific additions beyond the original (which is ship-only, no on-foot mode, and left
// vertical strafe unmapped on touch — see touchInput.ts's doc comment): UP/DOWN buttons for
// vertical strafe, and a JUMP button + reused move-stick for on-foot walking, toggled by sync()
// below tracking world.player.mode.
// ============================================================================================

const RADIUS = 50; // px — must match .joy-zone's diameter/2 in style.css
const DEADZONE = 0.15;

interface Stick {
  zoneEl: HTMLElement;
  stickEl: HTMLElement;
  activeId: number | null;
  baseX: number;
  baseY: number;
  onChange: (x: number, y: number) => void;
}

function makeStick(zoneId: string, onChange: (x: number, y: number) => void): Stick {
  const zoneEl = document.getElementById(zoneId) as HTMLElement;
  const stickEl = zoneEl.querySelector('.joy-stick') as HTMLElement;
  return { zoneEl, stickEl, activeId: null, baseX: 0, baseY: 0, onChange };
}

function beginStick(stick: Stick, id: number, x: number, y: number): void {
  stick.activeId = id;
  stick.baseX = x;
  stick.baseY = y;
  stick.zoneEl.style.left = `${x - RADIUS}px`;
  stick.zoneEl.style.top = `${y - RADIUS}px`;
  stick.zoneEl.classList.add('active');
  applyStick(stick, 0, 0);
}

function applyStick(stick: Stick, dx: number, dy: number): void {
  const dist = Math.min(RADIUS, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const kx = Math.cos(angle) * dist;
  const ky = Math.sin(angle) * dist;
  stick.stickEl.style.left = `${RADIUS + kx}px`;
  stick.stickEl.style.top = `${RADIUS + ky}px`;

  let nx = kx / RADIUS;
  let ny = ky / RADIUS;
  const mag = Math.hypot(nx, ny);
  if (mag < DEADZONE) {
    nx = 0; ny = 0;
  } else {
    const scaled = (mag - DEADZONE) / (1 - DEADZONE);
    nx = (nx / mag) * scaled;
    ny = (ny / mag) * scaled;
  }
  stick.onChange(nx, ny);
}

function endStick(stick: Stick): void {
  stick.activeId = null;
  stick.zoneEl.classList.remove('active');
  applyStick(stick, 0, 0);
}

// A touch landing on a real control (button, menu, panel) should never be claimed by a floating
// stick underneath it — same escape hatch as the original project's isUiTarget().
function isUiTarget(target: EventTarget | null): boolean {
  const node = target as Element | null;
  return !!node && typeof node.closest === 'function' && !!node.closest(
    'button, a, input, select, #main-menu-overlay, #ctrl-panel, #replay-panel-overlay, #toggle-bar, #replay-transport'
  );
}

function initDynamicSticks(): void {
  // Left stick's y is inverted (screen-up drag is negative dy) so dragging the thumb UP reads as
  // positive strafeLongitudinal — "up = forward/move-ahead" — matching a physical throttle-style
  // feel. The aim stick is passed straight through: dragging up already yields a negative ny
  // (screen-up = negative dy), which is exactly what control/pilot.ts's pitch convention wants for
  // "drag up = pitch up" (see keybinds.ts's digitalAxis('pitchUp','pitchDown') — pitchUp holds
  // negative) — no separate inversion needed there.
  const left = makeStick('joy-zone-left', (x, y) => TouchInput.setLeftStick(x, -y));
  const right = makeStick('joy-zone-right', (x, y) => TouchInput.setAimStick(x, y));
  const sticks = [left, right];

  window.addEventListener('touchstart', (e) => {
    let claimed = false;
    for (const t of Array.from(e.changedTouches)) {
      if (isUiTarget(t.target)) continue;
      const stick = t.clientX < window.innerWidth / 2 ? left : right;
      if (stick.activeId !== null) continue;
      beginStick(stick, t.identifier, t.clientX, t.clientY);
      claimed = true;
    }
    if (claimed) e.preventDefault();
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    let claimed = false;
    for (const t of Array.from(e.changedTouches)) {
      const stick = sticks.find(s => s.activeId === t.identifier);
      if (!stick) continue;
      applyStick(stick, t.clientX - stick.baseX, t.clientY - stick.baseY);
      claimed = true;
    }
    if (claimed) e.preventDefault();
  }, { passive: false });

  function release(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      const stick = sticks.find(s => s.activeId === t.identifier);
      if (stick) endStick(stick);
    }
  }
  window.addEventListener('touchend', release);
  window.addEventListener('touchcancel', release);

  // A rotate mid-drag would strand a stick at a stale position/screen-half boundary — drop both.
  window.addEventListener('resize', () => { sticks.forEach(endStick); });
}

function bindHold(elId: string, action: ActionName): void {
  const el = document.getElementById(elId) as HTMLElement;
  el.addEventListener('touchstart', (e) => { e.preventDefault(); TouchInput.setButton(action, true); }, { passive: false });
  el.addEventListener('touchend', (e) => { e.preventDefault(); TouchInput.setButton(action, false); }, { passive: false });
  el.addEventListener('touchcancel', (e) => { e.preventDefault(); TouchInput.setButton(action, false); }, { passive: false });
}

// ---------- Gyro (opt-in device-tilt roll + pitch assist) ----------
// iOS 13+ gates DeviceMotionEvent behind an explicit user-gesture permission prompt; other
// platforms fire it unprompted. Ported from the original project's gyro handling.
interface DeviceMotionEventWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

const GYRO_MAX_TILT = 0.6; // radians of phone tilt for full deflection
const GYRO_DEADZONE = 0.08;
let gyroEnabled = false;
let gyroBaseline: { gx: number; gy: number; gz: number } | null = null;

function shapeGyro(v: number): number {
  const mag = Math.min(1, Math.abs(v) / GYRO_MAX_TILT);
  if (mag < GYRO_DEADZONE) return 0;
  const scaled = (mag - GYRO_DEADZONE) / (1 - GYRO_DEADZONE);
  return Math.sign(v) * Math.min(1, scaled);
}

function onDeviceMotion(e: DeviceMotionEvent): void {
  const g = e.accelerationIncludingGravity;
  if (!g || g.x == null || g.y == null || g.z == null) return;
  if (!gyroBaseline) gyroBaseline = { gx: g.x, gy: g.y, gz: g.z };
  const roll = Math.atan2(g.x - gyroBaseline.gx, 9.8);
  const pitch = Math.atan2(g.z - gyroBaseline.gz, 9.8);
  TouchInput.setGyro(shapeGyro(roll), shapeGyro(pitch));
}

function setGyroActive(active: boolean): void {
  gyroEnabled = active;
  const btn = document.getElementById('touch-btn-gyro') as HTMLElement;
  btn.classList.toggle('on', active);
  if (active) {
    gyroBaseline = null; // recalibrate to the phone's current tilt on every enable
    window.addEventListener('devicemotion', onDeviceMotion);
  } else {
    window.removeEventListener('devicemotion', onDeviceMotion);
    TouchInput.setGyro(0, 0);
  }
}

function initGyroButton(): void {
  const btn = document.getElementById('touch-btn-gyro') as HTMLElement;
  const motionCtor = window.DeviceMotionEvent as unknown as DeviceMotionEventWithPermission | undefined;
  if (typeof window.DeviceMotionEvent === 'undefined') {
    btn.style.display = 'none';
    return;
  }
  btn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (gyroEnabled) { setGyroActive(false); return; }
    if (motionCtor && typeof motionCtor.requestPermission === 'function') {
      motionCtor.requestPermission().then((state) => {
        if (state === 'granted') setGyroActive(true);
      }).catch(() => {});
    } else {
      setGyroActive(true);
    }
  }, { passive: false });
}

export function initTouchControls(): void {
  if (!isTouchPrimary()) return;
  document.body.classList.add('touch');

  initDynamicSticks();
  bindHold('touch-btn-boost', 'boost');
  bindHold('touch-btn-brake', 'spaceBrake');
  bindHold('touch-btn-up', 'strafeUp');
  bindHold('touch-btn-down', 'strafeDown');
  bindHold('touch-btn-decouple', 'decoupleToggle');
  bindHold('touch-btn-interact', 'interact');
  bindHold('touch-btn-jump', 'jump');
  bindHold('touch-btn-fire', 'primaryFire');
  initGyroButton();
}

// Toggles the pilot/on-foot button rows to match the live mode — call once per frame (a no-op,
// one classList.toggle, if nothing changed) alongside hud/hud.ts's updateHUD. See style.css's
// #touch-controls.mode-onfoot rules for what this actually shows/hides.
export function syncTouchControls(world: World): void {
  const el = document.getElementById('touch-controls');
  if (!el) return;
  el.classList.toggle('mode-onfoot', world.player.mode === 'onfoot');
}
