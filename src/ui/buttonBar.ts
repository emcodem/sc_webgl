import type { World } from '../core/world';
import { resetWorld } from '../core/player';
import { startScenario } from '../scenarios/runtime';
import { startPipTrainer } from '../combat/pipTrainer';
import { isCaptured, requestKeyboardLock, releaseKeyboardLock } from '../input/input';

// F1 (restart) and F2 (fullscreen) — the two top-right toggles that don't open a panel. F3/F4 own
// their own overlay + keybinding in mainMenu.ts/controlsPanel.ts.
export function initButtonBar(world: World): void {
  const restartBtn = document.getElementById('restart-toggle') as HTMLElement;
  const fullscreenBtn = document.getElementById('fullscreen-toggle') as HTMLElement;

  // Restarts whatever's actually running: re-runs the active scenario/PIP-trainer session from
  // its own config/opts (both already held on the runtime state) instead of always dropping to
  // free flight — a scenario or drill in progress should come right back, not get exited.
  function restart(): void {
    if (world.scenario) {
      startScenario(world, world.scenario.config);
    } else if (world.pipTrainer) {
      world.pipTrainer = startPipTrainer(world.player.ship, world.pipTrainer.opts);
    } else {
      resetWorld(world);
    }
  }
  restartBtn.addEventListener('click', restart);

  async function toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }
  fullscreenBtn.addEventListener('click', () => { toggleFullscreen().catch(() => {}); });
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.classList.toggle('on', document.fullscreenElement != null);
    // Fullscreen entered via F2 without ever clicking the canvas to pointer-lock (mouse-look
    // isn't required to fly) otherwise never requests Keyboard Lock, leaving reserved combos
    // like Ctrl+W free to reach the browser despite being in fullscreen — see input.ts's
    // pointerlockchange handler, which requests it independently on mouse capture.
    if (document.fullscreenElement) requestKeyboardLock();
    else if (!isCaptured()) releaseKeyboardLock();
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F1') { e.preventDefault(); restart(); }
    else if (e.code === 'F2') { e.preventDefault(); toggleFullscreen().catch(() => {}); }
  });
}
