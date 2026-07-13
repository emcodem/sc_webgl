import type { World } from '../core/world';
import { length, sub } from '../math/vec';
import { getStatusMessage } from '../control/mode';
import * as Input from '../input/input';
import { computeAxes } from '../math/quaternion';
import { findActivePip } from '../combat/pipTargeting';
import * as MouseLook from '../input/mouseLook';
import * as EspAssist from '../combat/espAssist';

// Minimal DOM HUD overlay. The heavy flight HUD from the original project (scenario readouts,
// etc.) can be re-added later; this is enough to fly, fight, and walk.

const modeEl = document.getElementById('hud-mode') as HTMLElement;
const readoutEl = document.getElementById('hud-readout') as HTMLElement;
const hintEl = document.getElementById('capture-hint') as HTMLElement;
const crosshairEl = document.getElementById('crosshair') as HTMLElement;
const damageFlashEl = document.getElementById('damage-flash') as HTMLElement;
const pipMarkerEl = document.getElementById('pip-marker') as HTMLElement;
const espCircleEl = document.getElementById('esp-circle') as unknown as SVGCircleElement;
const vjoyOuterEl = document.getElementById('vjoy-outer') as unknown as SVGCircleElement;
const vjoyLineEl = document.getElementById('vjoy-line') as unknown as SVGLineElement;
const vjoyDotEl = document.getElementById('vjoy-dot') as unknown as SVGCircleElement;

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
  updatePipMarker(world);
  updateFlightRings(world);

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

// Predicted-impact-point reticle: reuses the exact same findActivePip call as the ESP damping in
// control/pilot.ts, so the drawn diamond always matches what's actually steering the crosshair
// assist. Ported from the original project's render/render.ts::drawPip, moved from a 2D canvas
// draw call to a positioned DOM element since this HUD is DOM, not canvas.
function updatePipMarker(world: World): void {
  const ship = world.player.ship;
  if (world.player.mode !== 'pilot' || ship.respawnTimer > 0) {
    pipMarkerEl.style.display = 'none';
    return;
  }
  const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
  const pip = findActivePip(ship.pos, ship.vel, cam, world.enemies, window.innerWidth, window.innerHeight);
  if (!pip) {
    pipMarkerEl.style.display = 'none';
    return;
  }
  pipMarkerEl.style.display = 'block';
  pipMarkerEl.style.left = `${pip.screenX}px`;
  pipMarkerEl.style.top = `${pip.screenY}px`;
  pipMarkerEl.classList.toggle('would-hit', pip.wouldHit);
}

// Mouse-look virtual-joystick reticle + ESP dampening-zone ring. Ported from the original
// project's render/render.ts::drawMouseReticle/drawEspCircle (canvas draws) onto this DOM HUD's
// SVG overlay. Vjoy only shows while mouse-look is actually captured (matches the original); the
// ESP ring is always shown while piloting, regardless of input device or scenario state — ESP is
// a standing user setting (see the F4 controls panel), not scenario-gated.
function updateFlightRings(world: World): void {
  const piloting = world.player.mode === 'pilot' && world.player.ship.respawnTimer <= 0;
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;

  espCircleEl.style.visibility = piloting ? 'visible' : 'hidden';
  if (piloting) {
    espCircleEl.setAttribute('cx', String(cx));
    espCircleEl.setAttribute('cy', String(cy));
    espCircleEl.setAttribute('r', String(EspAssist.getCircleRadius()));
  }

  const showVjoy = piloting && MouseLook.isCaptured();
  vjoyOuterEl.style.visibility = showVjoy ? 'visible' : 'hidden';
  vjoyLineEl.style.visibility = showVjoy ? 'visible' : 'hidden';
  vjoyDotEl.style.visibility = showVjoy ? 'visible' : 'hidden';
  if (showVjoy) {
    const { x, y, max } = MouseLook.getOffset();
    const scale = 0.55; // keep the reticle's travel visually inside the crosshair area
    const rx = cx + x * scale, ry = cy + y * scale;

    vjoyOuterEl.setAttribute('cx', String(cx));
    vjoyOuterEl.setAttribute('cy', String(cy));
    vjoyOuterEl.setAttribute('r', String(max * scale));

    vjoyLineEl.setAttribute('x1', String(cx));
    vjoyLineEl.setAttribute('y1', String(cy));
    vjoyLineEl.setAttribute('x2', String(rx));
    vjoyLineEl.setAttribute('y2', String(ry));

    vjoyDotEl.setAttribute('cx', String(rx));
    vjoyDotEl.setAttribute('cy', String(ry));
    vjoyDotEl.setAttribute('r', '5');
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
