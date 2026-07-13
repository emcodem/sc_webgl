import { initBindingsTableUI, renderBindings } from './bindingsTableUI';
import { initPresetsUI, refreshPresetList, restoreLastPreset } from './presetsUI';
import { initActionmapsImportUI } from './actionmapsImportUI';
import { initJoystickDetectionUI, renderGamepads } from './joystickDetectionUI';
import { initMouseSettingsUI } from './mouseSettingsUI';
import { initEspSettingsUI } from './espSettingsUI';

// ============================================================================================
// F4 controls panel — full parity rebuild of the original project's ui/controlsPanel/, covering
// keyboard rebinding, actionmaps.xml import, named preset save/load/export/import, joystick/HOTAS
// detection (with vJoy/Chromium diagnostics), mouse-look tuning, and ESP aim-assist settings.
// Opening it pauses the sim (see ui/index.ts's isPaused()) and releases pointer lock.
// ============================================================================================

let open = false;

export function isControlsPanelOpen(): boolean {
  return open;
}

export function closeControlsPanel(): void {
  const panel = document.getElementById('ctrl-panel') as HTMLElement;
  open = false;
  panel.style.display = 'none';
}

export function initControlsPanel(): void {
  initBindingsTableUI();
  initPresetsUI();
  initActionmapsImportUI();
  initJoystickDetectionUI();
  initMouseSettingsUI();
  initEspSettingsUI();
  restoreLastPreset();

  const toggleBtn = document.getElementById('controls-toggle') as HTMLElement;
  const closeBtn = document.getElementById('ctrl-close-btn') as HTMLElement;
  const panel = document.getElementById('ctrl-panel') as HTMLElement;

  function show(): void {
    open = true;
    panel.style.display = 'block';
    const overlay = document.getElementById('main-menu-overlay') as HTMLElement;
    overlay.style.display = 'none'; // only one overlay panel open at a time
    if (document.pointerLockElement) document.exitPointerLock();
    renderBindings();
    refreshPresetList();
    renderGamepads();
  }
  function toggleOpen(): void {
    if (open) closeControlsPanel(); else show();
  }
  toggleBtn.addEventListener('click', toggleOpen);
  closeBtn.addEventListener('click', closeControlsPanel);
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F4') return;
    e.preventDefault();
    toggleOpen();
  });

  // Escape closes the panel — but a pending keyboard/axis/button rebind capture (see
  // bindingsTableUI) consumes Escape first via stopPropagation, so this only fires once nothing
  // is mid-capture: first Escape cancels a capture, a second Escape closes the panel.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && panel.style.display !== 'none') closeControlsPanel();
  });
}
