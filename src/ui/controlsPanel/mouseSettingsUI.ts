import * as MouseLook from '../../input/mouseLook';
import * as AxisCurve from '../../input/axisCurve';
import { onConfigApplied } from '../../input/configRegistry';

// The F4 panel's mouse-look tuning section — sensitivity/deadzone/invert-Y sliders plus a
// recenter button, kept in sync with whatever control preset is active. Ported from the relevant
// slice of the original project's ui/mouseCapture.ts (the capture-hint/pointer-lock wiring itself
// lives in input/input.ts + hud.ts here, which already do the equivalent job).

function setValueText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function syncMouseSettingsUI(): void {
  const sensSlider = document.getElementById('ctrl-mouse-sens') as HTMLInputElement | null;
  if (sensSlider) sensSlider.value = String(MouseLook.getSensitivity());
  setValueText('ctrl-mouse-sens-val', MouseLook.getSensitivity().toFixed(1));

  const rangeSlider = document.getElementById('ctrl-mouse-range') as HTMLInputElement | null;
  if (rangeSlider) rangeSlider.value = String(MouseLook.getRange());
  setValueText('ctrl-mouse-range-val', `${MouseLook.getRange().toFixed(1)}°`);

  // stored as a 0-1 fraction of the range; the slider shows it as a 0-20 percentage
  const deadzoneSlider = document.getElementById('ctrl-mouse-deadzone') as HTMLInputElement | null;
  if (deadzoneSlider) deadzoneSlider.value = String(MouseLook.getDeadzone() * 100);
  setValueText('ctrl-mouse-deadzone-val', `${(MouseLook.getDeadzone() * 100).toFixed(2)}%`);

  // Shared convex input curve (also applied to the joystick axes — see input/axisCurve.ts).
  const expoSlider = document.getElementById('ctrl-mouse-expo') as HTMLInputElement | null;
  if (expoSlider) expoSlider.value = String(AxisCurve.getExponent());
  setValueText('ctrl-mouse-expo-val', AxisCurve.getExponent().toFixed(2));

  const invertCheckbox = document.getElementById('ctrl-mouse-invert') as HTMLInputElement | null;
  if (invertCheckbox) invertCheckbox.checked = MouseLook.getInvertY();
}

onConfigApplied(syncMouseSettingsUI);

export function initMouseSettingsUI(): void {
  syncMouseSettingsUI();

  const sensSlider = document.getElementById('ctrl-mouse-sens') as HTMLInputElement;
  sensSlider.addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    MouseLook.setSensitivity(v);
    setValueText('ctrl-mouse-sens-val', v.toFixed(1));
  });

  const rangeSlider = document.getElementById('ctrl-mouse-range') as HTMLInputElement;
  rangeSlider.addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    MouseLook.setRange(v);
    setValueText('ctrl-mouse-range-val', `${v.toFixed(1)}°`);
  });

  const deadzoneSlider = document.getElementById('ctrl-mouse-deadzone') as HTMLInputElement;
  deadzoneSlider.addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    MouseLook.setDeadzone(v / 100);
    setValueText('ctrl-mouse-deadzone-val', `${v.toFixed(2)}%`);
  });

  const expoSlider = document.getElementById('ctrl-mouse-expo') as HTMLInputElement;
  expoSlider.addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    AxisCurve.setExponent(v);
    setValueText('ctrl-mouse-expo-val', v.toFixed(2));
  });

  const invertCheckbox = document.getElementById('ctrl-mouse-invert') as HTMLInputElement;
  invertCheckbox.addEventListener('change', (e) => MouseLook.setInvertY((e.target as HTMLInputElement).checked));

  document.getElementById('ctrl-mouse-recenter')!.addEventListener('click', () => MouseLook.recenter());
  // quick keyboard shortcut to recenter the virtual stick mid-flight without opening the panel
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && MouseLook.isCaptured()) MouseLook.recenter();
  });
}
