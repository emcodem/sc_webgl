import type { World } from '../core/world';
import { length, sub } from '../math/vec';
import { getStatusMessage } from '../control/mode';
import * as Input from '../input/input';

// Minimal DOM HUD overlay. The heavy flight HUD from the original project (full PIP, scenario
// readouts, etc.) can be re-added later; this is enough to fly, fight, and walk.

const modeEl = document.getElementById('hud-mode') as HTMLElement;
const readoutEl = document.getElementById('hud-readout') as HTMLElement;
const hintEl = document.getElementById('capture-hint') as HTMLElement;
const crosshairEl = document.getElementById('crosshair') as HTMLElement;
const damageFlashEl = document.getElementById('damage-flash') as HTMLElement;

function row(k: string, v: string, on = false): string {
  return `<div class="hud-row"><span class="k">${k}</span> <span class="v${on ? ' on' : ''}">${v}</span></div>`;
}

export function updateHUD(world: World): void {
  const p = world.player;
  const ship = p.ship;

  if (world.scenario) {
    renderScenarioHUD(world);
  } else if (world.pipTrainer) {
    renderPipTrainerHUD(world);
  } else if (ship.respawnTimer > 0) {
    modeEl.textContent = 'SHIP DESTROYED';
    readoutEl.innerHTML = row('RESPAWNING', `${ship.respawnTimer.toFixed(1)}s`);
  } else if (p.mode === 'pilot') {
    const speed = length(ship.vel);
    const boostPct = Math.round((ship.boostMeter / ship.type.boostCapacity) * 100);
    modeEl.textContent = `PILOTING — ${ship.type.name.toUpperCase()}`;
    readoutEl.innerHTML =
      row('SPEED', `${speed.toFixed(1)} m/s`) +
      row('THROTTLE', `${Math.round(ship.throttle * 100)}%`) +
      row('BOOST', `${boostPct}%`, ship.boosting) +
      row('MODE', ship.decoupled ? 'DECOUPLED' : 'COUPLED', ship.decoupled) +
      row('BRAKE', ship.spaceBrakeOn ? 'ON' : 'OFF', ship.spaceBrakeOn) +
      row('HULL', `${ship.health.points}/${ship.health.maxPoints}`, ship.health.points <= ship.health.maxPoints * 0.3) +
      row('TARGET', targetReadout(world));
  } else {
    const speed = length(p.charVel);
    modeEl.textContent = 'ON FOOT — EVA';
    readoutEl.innerHTML =
      row('GROUND', p.groundBody ? p.groundBody.name : '— (zero-g)') +
      row('SPEED', `${speed.toFixed(1)} m/s`) +
      row('STANCE', p.onGround ? 'GROUNDED' : 'AIRBORNE', p.onGround);
  }

  crosshairEl.classList.toggle('hit', world.hitMarkerTimer > 0);
  damageFlashEl.style.opacity = String(ship.hitFlash * 0.8);

  // capture hint / status line
  if (!Input.isCaptured()) {
    hintEl.classList.remove('hidden');
    hintEl.innerHTML = 'Click to capture mouse';
  } else {
    const status = getStatusMessage();
    if (status) {
      hintEl.classList.remove('hidden');
      hintEl.textContent = status;
    } else {
      hintEl.classList.add('hidden');
    }
  }
}

// Scenario-mode HUD: name, elapsed time, shots/accuracy/kills always, plus per-winCondition
// objective info (nearest-target hull% / survive countdown+bubble+hits-taken / gate progress).
// Overrides the pilot/on-foot readout entirely while a scenario is running — see updateHUD.
function renderScenarioHUD(world: World): void {
  const runtime = world.scenario!;
  const config = runtime.config;
  const stats = runtime.stats;

  modeEl.textContent = `SCENARIO — ${config.name.toUpperCase()}`;

  const accuracy = stats.shotsFired > 0 ? Math.round((stats.hitsLanded / stats.shotsFired) * 100) : 0;
  let rows =
    row('TIME', `${runtime.elapsedSec.toFixed(1)}s`) +
    row('SHOTS', `${stats.hitsLanded}/${stats.shotsFired} (${accuracy}%)`) +
    row('KILLS', `${stats.kills}`);

  if (config.winCondition === 'destroy') {
    rows += row('TARGET', targetReadout(world));
  } else if (config.winCondition === 'survive') {
    rows += config.surviveDurationSec !== undefined
      ? row('REMAINING', `${Math.max(0, config.surviveDurationSec - runtime.elapsedSec).toFixed(1)}s`)
      : row('DURATION', 'INDEFINITE');
    if (config.rangeBubbleRadius !== undefined) {
      const ticks = Math.floor(runtime.bubbleTimeSec / 0.1);
      rows += row('IN RANGE', `${ticks} (${(ticks / 10).toFixed(1)}s)`, ticks > 0);
    }
    if (config.evasiveReturnFire) rows += row('HITS TAKEN', `${stats.hitsTaken}`);
  } else {
    const gateCount = config.gatePath?.length ?? 0;
    rows += row('GATE', `${Math.min(runtime.gateIndex + 1, gateCount)}/${gateCount}`);
    if (config.surviveDurationSec !== undefined) {
      rows += row('TIME LEFT', `${Math.max(0, config.surviveDurationSec - runtime.elapsedSec).toFixed(1)}s`);
    }
  }

  readoutEl.innerHTML = rows;
}

// PIP Trainer HUD: reps, hold-timer progress, elapsed/duration — see combat/pipTrainer.ts.
function renderPipTrainerHUD(world: World): void {
  const state = world.pipTrainer!;
  const opts = state.opts;
  modeEl.textContent = 'PIP TRAINER';

  const holdPct = Math.round(Math.min(1, state.holdTimer / opts.holdDurationSec) * 100);
  const perMinute = state.elapsedSec > 0 ? (state.reps / state.elapsedSec) * 60 : 0;
  readoutEl.innerHTML =
    row('TIME', `${state.elapsedSec.toFixed(1)}s`) +
    row('REPS', `${state.reps} (${perMinute.toFixed(1)}/min)`) +
    row('HOLD', `${holdPct}%`, holdPct > 0) +
    (opts.durationSec !== null
      ? row('REMAINING', `${Math.max(0, opts.durationSec - state.elapsedSec).toFixed(1)}s`)
      : row('DURATION', 'INDEFINITE'));
}

function targetReadout(world: World): string {
  const alive = world.enemies.filter(e => e.respawnTimer <= 0);
  if (alive.length === 0) return 'destroyed — respawning';

  let nearest = alive[0];
  let nearestDist = length(sub(nearest.pos, world.player.ship.pos));
  for (const e of alive) {
    const d = length(sub(e.pos, world.player.ship.pos));
    if (d < nearestDist) { nearest = e; nearestDist = d; }
  }
  const hpPct = Math.round((nearest.health.points / nearest.health.maxPoints) * 100);
  return `${nearestDist.toFixed(0)}m  HULL ${hpPct}%`;
}
