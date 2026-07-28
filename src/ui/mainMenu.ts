import type { World } from '../core/world';
import { resetWorld } from '../core/player';
import { closeControlsPanel } from './controlsPanel';
import { initScenarioMenu, showPicker } from './scenarioMenu';
import { startScenario } from '../scenarios/runtime';
import { startPipTrainer } from '../combat/pipTrainer';

// ============================================================================================
// F3 main menu — a dimmed full-screen overlay (source/feedback links, plus the training
// scenario picker rendered below it — see ui/scenarioMenu.ts). Opening it pauses the sim (see
// main.ts's isPaused()) and releases pointer lock so the cursor is free to click it. Resuming is
// F3/Escape (toggle/hide below); restarting is the F1 button (see ui/buttonBar.ts) — this menu
// doesn't duplicate either as its own button.
// ============================================================================================

let open = false;

export function isMenuOpen(): boolean {
  return open;
}

// Set by initMainMenu, called from ui/scenarioMenu.ts::checkScenarioResult so a scenario ending
// (won/lost) opens this same overlay/pause state — not just a DOM display flip — the instant the
// outcome leaves 'active'. Module-level (rather than exported alongside isMenuOpen) since it needs
// to exist before scenarioMenu.ts's checkScenarioResult can be wired to it in initMainMenu below.
let openForResult: () => void = () => {};

export function notifyScenarioResult(): void {
  openForResult();
}

export function initMainMenu(world: World): void {
  const overlay = document.getElementById('main-menu-overlay') as HTMLElement;
  const toggleBtn = document.getElementById('menu-toggle') as HTMLElement;

  function hide(): void {
    open = false;
    overlay.style.display = 'none';
  }

  // Shared by the F3 toggle (which also resets to the picker view) and a scenario ending (which
  // leaves whatever showScenarioResult already rendered into #scenario-menu-result alone).
  function openOverlay(): void {
    open = true;
    overlay.style.display = 'flex';
    closeControlsPanel(); // only one overlay panel open at a time
    if (document.pointerLockElement) document.exitPointerLock();
  }

  initScenarioMenu(world, {
    startScenario: (w, config) => startScenario(w, config),
    startFreeFlight: (w) => resetWorld(w),
    startPipTrainer: (w, opts) => {
      resetWorld(w); // clean deterministic start, same convention as every other picker card
      w.enemies = []; // pure aim-tracking airspace — the free-flight sandbox's dogfight AI ships
                       // don't belong here, only the pip (see combat/pipTrainer.ts)
      w.pipTrainer = startPipTrainer(w.player.ship, opts);
    }
  }, hide);

  openForResult = openOverlay;

  function show(): void {
    openOverlay();
    showPicker(); // F3 always reopens the full picker, whether or not a scenario is in progress
  }
  function toggle(): void {
    if (open) hide(); else show();
  }

  toggleBtn.addEventListener('click', toggle);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') { e.preventDefault(); toggle(); }
    else if (e.code === 'Escape' && open) hide();
  });
}
