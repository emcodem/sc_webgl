import * as JoystickDeadzone from '../../input/joystickDeadzone';
import { onConfigApplied } from '../../input/configRegistry';
import { wireNumericControl, syncNumericControl, type NumericControlConfig } from './numericControl';

// The Joystick/HOTAS section's deadzone slider. Separate from the mouse deadzone (a physical stick
// needs a much larger dead region for its centering slop). Shown as a raw 0-1 value to match SC's
// joystick deadzone setting (default 0.3). The input curve (expo) is shared with the mouse — see
// input/axisCurve.ts.

const CONTROLS: NumericControlConfig[] = [
  {
    sliderId: 'ctrl-joystick-deadzone', numId: 'ctrl-joystick-deadzone-num', warnId: 'ctrl-joystick-deadzone-warn',
    min: 0, max: 1, decimals: 2,
    get: JoystickDeadzone.getJoystickDeadzone, set: JoystickDeadzone.setJoystickDeadzone
  }
];

onConfigApplied(() => { for (const c of CONTROLS) syncNumericControl(c); });

export function initJoystickSettingsUI(): void {
  for (const c of CONTROLS) wireNumericControl(c);
}
