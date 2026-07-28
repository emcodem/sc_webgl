import * as EspAssist from '../../combat/espAssist';
import { onConfigApplied } from '../../input/configRegistry';
import { wireNumericControl, syncNumericControl, type NumericControlConfig } from './numericControl';

// Ported from the original project's ui/espSettingsUI.ts. Each slider is paired with an editable
// number box + inline out-of-range warning (see numericControl.ts).

const CONTROLS: NumericControlConfig[] = [
  {
    // max raised from 120 to 250px — 120 kept the assist circle (and thus the stick-authority
    // gate in dampingFactor()) too small to ever engage while sweeping onto a target, not just
    // fine-tracking near it (GitHub #4).
    sliderId: 'ctrl-esp-circle-size', numId: 'ctrl-esp-circle-size-num', warnId: 'ctrl-esp-circle-size-warn',
    min: 15, max: 250, decimals: 0,
    get: EspAssist.getCircleRadius, set: EspAssist.setCircleRadius
  },
  {
    // max raised from 0.95 to 1.0 — capping below full strength meant even dead-center, max-slider
    // dampening always let 5% of input speed through (GitHub #4).
    sliderId: 'ctrl-esp-dampening', numId: 'ctrl-esp-dampening-num', warnId: 'ctrl-esp-dampening-warn',
    min: 0, max: 1, decimals: 2,
    get: EspAssist.getDampeningStrength, set: EspAssist.setDampeningStrength
  }
];

// Keeps the sliders in sync whenever a control preset is loaded/imported/restored, without the
// preset UI needing to know ESP settings exist.
onConfigApplied(() => { for (const c of CONTROLS) syncNumericControl(c); });

export function initEspSettingsUI(): void {
  for (const c of CONTROLS) wireNumericControl(c);
}
