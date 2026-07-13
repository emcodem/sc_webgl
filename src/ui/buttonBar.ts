import type { World } from '../core/world';
import { resetWorld } from '../core/player';

// F1 (restart) and F2 (fullscreen) — the two top-right toggles that don't open a panel. F3/F4 own
// their own overlay + keybinding in mainMenu.ts/controlsPanel.ts.
export function initButtonBar(world: World): void {
  const restartBtn = document.getElementById('restart-toggle') as HTMLElement;
  const fullscreenBtn = document.getElementById('fullscreen-toggle') as HTMLElement;

  function restart(): void {
    resetWorld(world);
  }
  restartBtn.addEventListener('click', restart);

  async function toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }
  fullscreenBtn.addEventListener('click', () => { toggleFullscreen().catch(() => {}); });
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.classList.toggle('on', document.fullscreenElement != null);
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1') { e.preventDefault(); restart(); }
    else if (e.code === 'F2') { e.preventDefault(); toggleFullscreen().catch(() => {}); }
  });
}
