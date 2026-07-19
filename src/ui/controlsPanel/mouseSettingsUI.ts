import * as MouseLook from '../../input/mouseLook';
import * as AxisCurve from '../../input/axisCurve';
import { onConfigApplied } from '../../input/configRegistry';
import { wireNumericControl, syncNumericControl, type NumericControlConfig } from './numericControl';

// The F4 panel's flight-input tuning section — sensitivity / vjoy range / deadzone / input-curve
// sliders, each paired with an editable number box (see numericControl.ts), plus a recenter button.
// Mouse deadzone and the expo input-curve are mouse-only; the joystick has its own deadzone and is
// linear (see input/joystickDeadzone.ts, input/joystickMap.ts).

const CONTROLS: NumericControlConfig[] = [
  {
    sliderId: 'ctrl-mouse-sens', numId: 'ctrl-mouse-sens-num', warnId: 'ctrl-mouse-sens-warn',
    min: 0.5, max: 4, decimals: 1,
    get: MouseLook.getSensitivity, set: MouseLook.setSensitivity
  },
  {
    sliderId: 'ctrl-mouse-range', numId: 'ctrl-mouse-range-num', warnId: 'ctrl-mouse-range-warn',
    min: 4, max: 25, decimals: 1,
    get: MouseLook.getRange, set: MouseLook.setRange
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
  }
];

function syncMouseSettingsUI(): void {
  for (const c of CONTROLS) syncNumericControl(c);
}

onConfigApplied(syncMouseSettingsUI);

export function initMouseSettingsUI(): void {
  for (const c of CONTROLS) wireNumericControl(c);
  syncMouseSettingsUI();

  // Press V to recenter the mouse virtual stick mid-flight (zeroes the persistent deflection so the
  // ship stops rotating). The absolute mouse-flight stick holds its deflection until moved back.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && MouseLook.isCaptured()) MouseLook.recenter();
  });
}
