import * as MouseLook from '../../input/mouseLook';
import { onConfigApplied } from '../../input/configRegistry';

// The F4 panel's mouse-look tuning section — sensitivity/deadzone/invert-Y sliders plus a
// recenter button, kept in sync with whatever control preset is active. Ported from the relevant
// slice of the original project's ui/mouseCapture.ts (the capture-hint/pointer-lock wiring itself
// lives in input/input.ts + hud.ts here, which already do the equivalent job).

function syncMouseSettingsUI(): void {
  const sensSlider = document.getElementById('ctrl-mouse-sens') as HTMLInputElement | null;
  if (sensSlider) sensSlider.value = String(MouseLook.getSensitivity());

  const deadzoneSlider = document.getElementById('ctrl-mouse-deadzone') as HTMLInputElement | null;
  if (deadzoneSlider) deadzoneSlider.value = String(MouseLook.getDeadzone());

  const invertCheckbox = document.getElementById('ctrl-mouse-invert') as HTMLInputElement | null;
  if (invertCheckbox) invertCheckbox.checked = MouseLook.getInvertY();
}

onConfigApplied(syncMouseSettingsUI);

export function initMouseSettingsUI(): void {
  syncMouseSettingsUI();

  const sensSlider = document.getElementById('ctrl-mouse-sens') as HTMLInputElement;
  sensSlider.addEventListener('input', (e) => MouseLook.setSensitivity(parseFloat((e.target as HTMLInputElement).value)));

  const deadzoneSlider = document.getElementById('ctrl-mouse-deadzone') as HTMLInputElement;
  deadzoneSlider.addEventListener('input', (e) => MouseLook.setDeadzone(parseFloat((e.target as HTMLInputElement).value)));

  const invertCheckbox = document.getElementById('ctrl-mouse-invert') as HTMLInputElement;
  invertCheckbox.addEventListener('change', (e) => MouseLook.setInvertY((e.target as HTMLInputElement).checked));

  document.getElementById('ctrl-mouse-recenter')!.addEventListener('click', () => MouseLook.recenter());
  // quick keyboard shortcut to recenter the virtual stick mid-flight without opening the panel
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV' && MouseLook.isCaptured()) MouseLook.recenter();
  });
}
