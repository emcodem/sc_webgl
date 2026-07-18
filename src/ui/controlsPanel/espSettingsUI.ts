import * as EspAssist from '../../combat/espAssist';
import { onConfigApplied } from '../../input/configRegistry';

// Ported from the original project's ui/espSettingsUI.ts.

function setValueText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function syncEspSettingsUI(): void {
  const sizeSlider = document.getElementById('ctrl-esp-circle-size') as HTMLInputElement | null;
  if (sizeSlider) sizeSlider.value = String(EspAssist.getCircleRadius());
  setValueText('ctrl-esp-circle-size-val', `${EspAssist.getCircleRadius()}px`);

  const dampeningSlider = document.getElementById('ctrl-esp-dampening') as HTMLInputElement | null;
  if (dampeningSlider) dampeningSlider.value = String(EspAssist.getDampeningStrength());
  setValueText('ctrl-esp-dampening-val', EspAssist.getDampeningStrength().toFixed(2));
}

// Keeps the sliders in sync whenever a control preset is loaded/imported/restored, without the
// preset UI needing to know ESP settings exist.
onConfigApplied(syncEspSettingsUI);

export function initEspSettingsUI(): void {
  syncEspSettingsUI();

  const sizeSlider = document.getElementById('ctrl-esp-circle-size') as HTMLInputElement;
  sizeSlider.addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    EspAssist.setCircleRadius(v);
    setValueText('ctrl-esp-circle-size-val', `${v}px`);
  });

  const dampeningSlider = document.getElementById('ctrl-esp-dampening') as HTMLInputElement;
  dampeningSlider.addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    EspAssist.setDampeningStrength(v);
    setValueText('ctrl-esp-dampening-val', v.toFixed(2));
  });
}
