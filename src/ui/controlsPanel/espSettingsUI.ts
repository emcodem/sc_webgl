import * as EspAssist from '../../combat/espAssist';
import { onConfigApplied } from '../../input/configRegistry';
import { wireNumericControl, syncNumericControl, type NumericControlConfig } from './numericControl';

// Ported from the original project's ui/espSettingsUI.ts. Each slider is paired with an editable
// number box + inline out-of-range warning (see numericControl.ts).

const CONTROLS: NumericControlConfig[] = [
  {
    sliderId: 'ctrl-esp-circle-size', numId: 'ctrl-esp-circle-size-num', warnId: 'ctrl-esp-circle-size-warn',
    min: 15, max: 120, decimals: 0,
    get: EspAssist.getCircleRadius, set: EspAssist.setCircleRadius
  },
  {
    sliderId: 'ctrl-esp-dampening', numId: 'ctrl-esp-dampening-num', warnId: 'ctrl-esp-dampening-warn',
    min: 0, max: 0.95, decimals: 2,
    get: EspAssist.getDampeningStrength, set: EspAssist.setDampeningStrength
  }
];

// Keeps the sliders in sync whenever a control preset is loaded/imported/restored, without the
// preset UI needing to know ESP settings exist.
onConfigApplied(() => { for (const c of CONTROLS) syncNumericControl(c); });

export function initEspSettingsUI(): void {
  for (const c of CONTROLS) wireNumericControl(c);
}
