import type { World } from '../core/world';
import { initButtonBar } from './buttonBar';
import { initMainMenu, isMenuOpen } from './mainMenu';
import { initControlsPanel, isControlsPanelOpen } from './controlsPanel';

export function initUI(world: World): void {
  initButtonBar(world);
  initMainMenu(world);
  initControlsPanel();
}

// True while a menu/panel overlay is up — main.ts's loop freezes sim stepping (but keeps
// rendering) so nothing can hit you while you're reading a menu or dragging a slider.
export function isPaused(): boolean {
  return isMenuOpen() || isControlsPanelOpen();
}
