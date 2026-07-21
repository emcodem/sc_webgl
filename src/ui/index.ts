import type { World } from '../core/world';
import { initButtonBar } from './buttonBar';
import { initMainMenu, isMenuOpen } from './mainMenu';
import { initControlsPanel } from './controlsPanel';
import { initReplayPanel, isReplayPanelOpen } from './replayPanel';

export function initUI(world: World): void {
  initButtonBar(world);
  initMainMenu(world);
  initControlsPanel();
  initReplayPanel(world);
}

// True while the F3 main menu or F6 replay panel is up — main.ts's loop freezes sim stepping (but
// keeps rendering) so nothing can hit you while you're reading it. The F4 controls panel
// deliberately does NOT pause: it's the place you retune mouse deadzone/curve/bindings, and
// you need the ship still flying to feel the effect of a change as you make it.
export function isPaused(): boolean {
  return isMenuOpen() || isReplayPanelOpen();
}
