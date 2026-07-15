import './style.css';

import { makeWorld } from './core/player';
import { Renderer } from './render/renderer';
import { initInput, endFrame } from './input/input';
import { stepPilot } from './control/pilot';
import { stepFoot } from './control/foot';
import { handleEdgeActions } from './control/mode';
import { stepCombat } from './combat/combatSystem';
import { updateScenario, startScenario } from './scenarios/runtime';
import { SCENARIOS } from './scenarios/definitions';
import { updatePipTrainer } from './combat/pipTrainer';
import { checkScenarioResult, checkPipTrainerResult } from './ui/scenarioMenu';
import { updateHUD } from './hud/hud';
import { initUI, isPaused } from './ui';
import * as Gamepad from './input/gamepad';
import { initStarDebugPanel } from './render/starDebugPanel'; // TEMPORARY — see that file's header

// ============================================================================================
// Bootstrap + main loop. The world is renderer-agnostic sim state; each frame we run one control
// tick for whichever mode the player is in (pilot or on foot), then the render layer draws it
// camera-relative. dt is clamped to 50ms (matching the original project) so a stall can't blow up
// the integrator — the flight model converges regardless of frame rate.
// ============================================================================================

const canvas = document.getElementById('c') as HTMLCanvasElement;

const world = makeWorld();
initInput(canvas);
const renderer = new Renderer(canvas, world);
initUI(world); // restores the last-active control preset, if any — see ui/controlsPanel/presetsUI.ts
initStarDebugPanel(renderer); // TEMPORARY — remove along with render/starDebugPanel.ts when done tuning

// Expose live state for headless/browser verification (see the original project's verify skill).
(window as unknown as { __world: typeof world }).__world = world;

// Debug hook for headless verification, same convention as __world above — lets a test script
// jump straight to a named scenario (see scenarios/definitions.ts's SCENARIOS ids) without driving
// the F3 menu's DOM.
(window as unknown as { __startScenario: (id: string) => void }).__startScenario = (id: string) => {
  const config = SCENARIOS.find(s => s.id === id);
  if (config) startScenario(world, config);
};

let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    // polled unconditionally (even while paused) so the controls panel's device list and
    // wiggle-to-bind capture keep working while the sim itself is frozen
    Gamepad.poll();

    // sim fully freezes (but keeps rendering) while a menu/panel overlay is open
    if (!isPaused()) {
      // controls freeze while the ship is destroyed and waiting to respawn, or once a scenario's
      // outcome has left 'active' (won/lost) — the result screen takes over from there. The F/C
      // edge actions (enter/exit, decouple) are gated too: firing them mid-respawn would park and
      // disembark a ship that stepCombat is about to teleport back to spawn.
      const controlsLive = world.player.ship.respawnTimer <= 0
        && (!world.scenario || world.scenario.outcome === 'active');
      if (controlsLive) {
        handleEdgeActions(world);
        if (world.player.mode === 'pilot') stepPilot(world, dt);
        else stepFoot(world, dt);
      }
      if (world.scenario) updateScenario(world, dt);
      else stepCombat(world, dt);
      // PIP Trainer is fully additive — layered on top of whatever stepPilot/stepFoot/stepCombat
      // already did to the ship/world this frame, regardless of pilot/on-foot mode (see
      // combat/pipTrainer.ts's doc comment on why it never touches world.enemies/hit detection).
      if (world.pipTrainer) updatePipTrainer(world.pipTrainer, world.player.ship, dt);
      checkScenarioResult(world); // opens the F3 results view the instant an outcome leaves 'active'
      checkPipTrainerResult(world);
    }

    renderer.render(world);
    updateHUD(world);
  } catch (err) {
    console.error('Frame error (continuing):', err);
  } finally {
    endFrame();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
