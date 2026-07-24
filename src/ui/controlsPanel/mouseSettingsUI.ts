import * as MouseLook from '../../input/mouseLook';
import * as AxisCurve from '../../input/axisCurve';
import * as RemoteMouseInput from '../../input/remoteMouseInput';
import { onConfigApplied } from '../../input/configRegistry';
import { wireNumericControl, syncNumericControl, type NumericControlConfig } from './numericControl';

// The F4 panel's flight-input tuning section — vjoy range / deadzone / input-curve sliders, each
// paired with an editable number box (see numericControl.ts), plus a recenter button. No separate
// "sensitivity" slider: in real SC that setting only scales OS pointer speed, it never touches the
// vjoy stick curve, so there's nothing here for it to drive (see input/mouseLook.ts's consume()).
// Mouse deadzone and the expo input-curve are mouse-only; the joystick has its own deadzone and is
// linear (see input/joystickDeadzone.ts, input/joystickMap.ts).

const CONTROLS: NumericControlConfig[] = [
  {
    // Raw mouse counts (movementX/Y units) needed for full deflection -- NOT the same thing as SC's
    // own "VJoy Range" setting (confirmed cosmetic-only, see mouseLook.ts's yawFullDeflectionCounts/
    // pitchFullDeflectionCounts doc). Yaw and pitch are SEPARATE sliders -- real SC's two axes clamp
    // at different raw-count values (yaw ~1500, pitch ~1080, confirmed by independent sun-tracked
    // captures; see capture/MEASUREMENTS.md), not one shared gain.
    sliderId: 'ctrl-mouse-range-yaw', numId: 'ctrl-mouse-range-yaw-num', warnId: 'ctrl-mouse-range-yaw-warn',
    min: 300, max: 3000, decimals: 0,
    get: MouseLook.getYawFullDeflectionCounts, set: MouseLook.setYawFullDeflectionCounts
  },
  {
    sliderId: 'ctrl-mouse-range-pitch', numId: 'ctrl-mouse-range-pitch-num', warnId: 'ctrl-mouse-range-pitch-warn',
    min: 300, max: 3000, decimals: 0,
    get: MouseLook.getPitchFullDeflectionCounts, set: MouseLook.setPitchFullDeflectionCounts
  },
  {
    // mouse deadzone: stored as a 0-1 fraction, shown as a 0-20 percentage (joystick has its own — see joystickSettingsUI.ts)
    sliderId: 'ctrl-mouse-deadzone', numId: 'ctrl-mouse-deadzone-num', warnId: 'ctrl-mouse-deadzone-warn',
    min: 0, max: 20, decimals: 2,
    get: AxisCurve.getMouseDeadzone, set: AxisCurve.setMouseDeadzone,
    toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100
  },
  {
    // Mouse-only expo curve (joystick is linear). <1 concave (sharper near center); 1 linear; >1 convex (softer)
    sliderId: 'ctrl-mouse-expo', numId: 'ctrl-mouse-expo-num', warnId: 'ctrl-mouse-expo-warn',
    min: 0.4, max: 2.5, decimals: 2,
    get: AxisCurve.getExponent, set: AxisCurve.setExponent
  },
  {
    // SC's own "VJoy Range" (`VJoyAnglePilots`) slider, same ~4-25 units -- confirmed zero flight
    // effect (MEASUREMENTS.md: 4 vs 25 gave identical yaw rate), purely cosmetic on-screen indicator
    // size here. Lets the indicator be dialed to visually match real SC's for side-by-side
    // comparison. Not the same thing as the Full-Deflection Mouse Travel control above.
    sliderId: 'ctrl-vjoy-range-deg', numId: 'ctrl-vjoy-range-deg-num', warnId: 'ctrl-vjoy-range-deg-warn',
    min: 4, max: 25, decimals: 1,
    get: MouseLook.getVjoyRangeDegrees, set: MouseLook.setVjoyRangeDegrees
  }
];

function syncMouseSettingsUI(): void {
  for (const c of CONTROLS) syncNumericControl(c);
}

onConfigApplied(syncMouseSettingsUI);

// Remote mouse capture (real-SC -> vjoy comparison tool, see input/remoteMouseInput.ts and
// scripts/mouse-capture.py) is a dev/tuning aid, not a player-facing feature — mirrors the
// __remoteMouseInput(true) console hook (main.ts) as a clickable toggle, but only when this is
// actually served by the Vite dev server. import.meta.env.DEV is a compile-time constant, so the
// whole row (and this wiring) is dead code eliminated out of `npm run build` production bundles.
function initRemoteMouseToggle(): void {
  if (!import.meta.env.DEV) return;
  const row = document.getElementById('ctrl-remote-mouse-row') as HTMLElement;
  const btn = document.getElementById('ctrl-remote-mouse-toggle') as HTMLButtonElement;
  const status = document.getElementById('ctrl-remote-mouse-status') as HTMLElement;
  row.style.display = '';

  function sync(connected: boolean): void {
    btn.classList.toggle('on', connected);
    btn.textContent = connected ? 'Remote Mouse: ON' : 'Remote Mouse: OFF';
    status.textContent = connected ? 'connected' : 'disconnected — run: npm run capture';
  }
  btn.addEventListener('click', () => {
    if (RemoteMouseInput.isConnected()) RemoteMouseInput.disconnect();
    else RemoteMouseInput.connect();
  });
  RemoteMouseInput.onChange(sync);
  sync(RemoteMouseInput.isConnected());
}

export function initMouseSettingsUI(): void {
  for (const c of CONTROLS) wireNumericControl(c);
  syncMouseSettingsUI();
  initRemoteMouseToggle();

  // Press V to recenter the mouse virtual stick mid-flight (zeroes the persistent deflection so the
  // ship stops rotating). The absolute mouse-flight stick holds its deflection until moved back.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && MouseLook.isCaptured()) MouseLook.recenter();
  });
}
