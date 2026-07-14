import type { World } from '../core/world';
import { length, sub } from '../math/vec';
import { getStatusMessage } from '../control/mode';
import * as Input from '../input/input';
import { computeAxes } from '../math/quaternion';
import { findActivePip } from '../combat/pipTargeting';
import * as MouseLook from '../input/mouseLook';
import * as EspAssist from '../combat/espAssist';
import { bubbleTicks } from '../scenarios/runtime';

// DOM HUD overlay — ported from the original project's starcitizen_flightsim/index.html +
// render/render.ts's updateHUD: a bottom-left flight-stats panel (#stats), a top-center mission
// stats panel for the active scenario (#scenario-hud), and a top-center PIP Trainer panel
// (#pip-trainer-hud). #stats additionally covers this project's own on-foot mode and destroyed/
// respawning state, neither of which exist in the original (it's ship-only).

const crosshairEl = document.getElementById('crosshair') as HTMLElement;
const damageFlashEl = document.getElementById('damage-flash') as HTMLElement;
const hintEl = document.getElementById('capture-hint') as HTMLElement;
const pipMarkerEl = document.getElementById('pip-marker') as HTMLElement;
const espCircleEl = document.getElementById('esp-circle') as unknown as SVGCircleElement;
const vjoyOuterEl = document.getElementById('vjoy-outer') as unknown as SVGCircleElement;
const vjoyLineEl = document.getElementById('vjoy-line') as unknown as SVGLineElement;
const vjoyDotEl = document.getElementById('vjoy-dot') as unknown as SVGCircleElement;

const scenarioHudEl = document.getElementById('scenario-hud') as HTMLElement;
const pipTrainerHudEl = document.getElementById('pip-trainer-hud') as HTMLElement;

const statsModeEl = document.getElementById('stats-mode') as HTMLElement;
const statsFlightRowsEl = document.getElementById('stats-flight-rows') as HTMLElement;
const statsFootRowsEl = document.getElementById('stats-foot-rows') as HTMLElement;
const statsDestroyedRowsEl = document.getElementById('stats-destroyed-rows') as HTMLElement;

const el = (id: string) => document.getElementById(id) as HTMLElement;

let modeFlagWired = false;

export function updateHUD(world: World): void {
  const p = world.player;
  const ship = p.ship;

  // DECOUPLED row doubles as a click target — same effect as the decoupleToggle keybind — wired
  // once, lazily, the first time the HUD updates (mirrors the original project's initModeToggle).
  if (!modeFlagWired) {
    modeFlagWired = true;
    el('mode-flag').addEventListener('click', () => { ship.decoupled = !ship.decoupled; });
  }

  updateScenarioHUD(world);
  updatePipTrainerHUD(world);
  updateStatsPanel(world);

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

// Bottom-left flight-stats panel: throttle/boost bars, speed, yaw/pitch/turn rate, decoupled/
// brake/mass/ship — ported field-for-field from the original project's #stats panel — plus this
// project's own extensions (HULL/TARGET while piloting) and its on-foot/destroyed sub-blocks,
// which the original never had (it's ship-only, no character controller).
function updateStatsPanel(world: World): void {
  const p = world.player;
  const ship = p.ship;

  const showDestroyed = ship.respawnTimer > 0;
  const showFlight = !showDestroyed && p.mode === 'pilot';
  const showFoot = !showDestroyed && p.mode === 'onfoot';
  statsDestroyedRowsEl.style.display = showDestroyed ? 'block' : 'none';
  statsFlightRowsEl.style.display = showFlight ? 'block' : 'none';
  statsFootRowsEl.style.display = showFoot ? 'block' : 'none';

  if (showDestroyed) {
    statsModeEl.textContent = 'SHIP DESTROYED';
    el('s-respawn').textContent = `${ship.respawnTimer.toFixed(1)}s`;
    return;
  }

  if (showFoot) {
    statsModeEl.textContent = 'ON FOOT — EVA';
    const speed = length(p.charVel);
    el('s-ground').textContent = p.groundBody ? p.groundBody.name : '— (zero-g)';
    (el('s-foot-speed')).textContent = `${speed.toFixed(1)} m/s`;
    const stanceEl = el('s-stance');
    stanceEl.textContent = p.onGround ? 'GROUNDED' : 'AIRBORNE';
    stanceEl.className = p.onGround ? 'value on' : 'value';
    return;
  }

  statsModeEl.textContent = `PILOTING — ${ship.type.name.toUpperCase()}`;

  const speed = length(ship.vel);
  el('s-throttle').textContent = `${Math.round(ship.throttle * 100)}%`;
  (el('bar-throttle')).style.width = `${Math.round(Math.abs(ship.throttle) * 100)}%`;

  const boostPct = Math.round((ship.boostMeter / ship.type.boostCapacity) * 100);
  const boostEl = el('s-boost');
  boostEl.textContent = `${boostPct}%`;
  boostEl.className = ship.boosting ? 'value on' : 'value';
  (el('bar-boost')).style.width = `${boostPct}%`;

  el('s-speed').textContent = `${speed.toFixed(1)} m/s`;
  const yawRateDeg = ship.angVel.yaw * (180 / Math.PI);
  const pitchRateDeg = ship.angVel.pitch * (180 / Math.PI);
  // combined nose-turn rate — roll doesn't move the boresight, so it's excluded
  const turnRateDeg = Math.hypot(yawRateDeg, pitchRateDeg);
  el('s-yawrate').textContent = `${yawRateDeg.toFixed(1)}°/s`;
  el('s-pitchrate').textContent = `${pitchRateDeg.toFixed(1)}°/s`;
  el('s-turnrate').textContent = `${turnRateDeg.toFixed(1)}°/s`;

  const decoupledEl = el('s-decoupled');
  decoupledEl.textContent = ship.decoupled ? 'ON' : 'OFF';
  decoupledEl.className = ship.decoupled ? 'value on' : 'value';
  const brakeEl = el('s-brake');
  brakeEl.textContent = ship.spaceBrakeOn ? 'ON' : 'OFF';
  brakeEl.className = ship.spaceBrakeOn ? 'value on' : 'value';

  const hullEl = el('s-hull');
  hullEl.textContent = `${ship.health.points}/${ship.health.maxPoints}`;
  hullEl.className = ship.health.points <= ship.health.maxPoints * 0.3 ? 'value on' : 'value';
  el('s-target').textContent = targetReadout(world);

  el('s-mass').textContent = ship.type.mass.toFixed(2);
  el('s-ship').textContent = ship.type.name;
}

// Top-center mission-stats panel while a training scenario is running — ported row-for-row and
// show/hide-rule-for-rule from the original project's #scenario-hud / updateHUD's scenario branch.
function updateScenarioHUD(world: World): void {
  const runtime = world.scenario;
  scenarioHudEl.style.display = runtime ? 'block' : 'none';
  if (!runtime) return;
  const config = runtime.config;
  const stats = runtime.stats;

  el('scenario-hud-name').textContent = config.name;

  const isGates = config.winCondition === 'gates';
  const isSurvive = config.winCondition === 'survive';
  // 'survive' drills normally hide the player-hits row (their enemy never fires — Aim Training,
  // Merge Drill), but the Evasive Pilot drill's optional return fire needs it, sourced from the
  // hitsTaken counter below rather than the health-delta the non-survive branch reads, since a
  // survive drill's hitsToKillPlayer is deliberately unreachable.
  const showPlayerHits = !isSurvive || config.evasiveReturnFire === true;
  el('scenario-hud-enemy-row').style.display = (isGates || isSurvive) ? 'none' : 'flex';
  el('scenario-hud-player-row').style.display = showPlayerHits ? 'flex' : 'none';
  el('scenario-hud-kills-row').style.display = isSurvive ? 'flex' : 'none';
  el('scenario-hud-accuracy-row').style.display = isSurvive ? 'flex' : 'none';
  el('scenario-hud-gate-row').style.display = isGates ? 'flex' : 'none';
  el('scenario-hud-timer-row').style.display = (isGates || isSurvive) ? 'flex' : 'none';
  const hasBubble = config.rangeBubbleRadius !== undefined;
  el('scenario-hud-bubble-row').style.display = hasBubble ? 'flex' : 'none';
  if (hasBubble) el('scenario-hud-bubble').textContent = `${bubbleTicks(runtime)}`;

  if (isGates) {
    const gateTotal = config.gatePath?.length ?? 0;
    el('scenario-hud-gate').textContent = `${Math.min(runtime.gateIndex + 1, gateTotal)}/${gateTotal}`;
    const remaining = Math.max(0, (config.surviveDurationSec ?? 0) - runtime.elapsedSec);
    el('scenario-hud-timer-label').textContent = 'TIME LEFT';
    el('scenario-hud-timer').textContent = `${remaining.toFixed(1)}s`;
  } else if (isSurvive) {
    const duration = config.surviveDurationSec;
    if (duration !== undefined) {
      const remaining = Math.max(0, duration - runtime.elapsedSec);
      el('scenario-hud-timer-label').textContent = 'TIME LEFT';
      el('scenario-hud-timer').textContent = `${remaining.toFixed(1)}s`;
    } else {
      el('scenario-hud-timer-label').textContent = 'TIME';
      el('scenario-hud-timer').textContent = `${runtime.elapsedSec.toFixed(1)}s`;
    }
    el('scenario-hud-kills').textContent = `${stats.kills}`;
    const accuracy = stats.shotsFired > 0 ? Math.round((stats.hitsLanded / stats.shotsFired) * 100) : 0;
    el('scenario-hud-accuracy').textContent = `${accuracy}%`;
    if (showPlayerHits) el('scenario-hud-player-hits').textContent = `${stats.hitsTaken}`;
  } else {
    const enemy = world.enemies[0];
    const enemyHits = enemy ? enemy.health.maxPoints - enemy.health.points : 0;
    const enemyMax = enemy ? enemy.health.maxPoints : 0;
    el('scenario-hud-enemy-hits').textContent = `${enemyHits}/${enemyMax}`;

    const ship = world.player.ship;
    const playerHits = ship.health.maxPoints - ship.health.points;
    el('scenario-hud-player-hits').textContent = `${playerHits}/${ship.health.maxPoints}`;
  }
}

// Top-center PIP Trainer panel — ported from the original project's #pip-trainer-hud /
// updatePipTrainerHUD.
function updatePipTrainerHUD(world: World): void {
  const state = world.pipTrainer;
  pipTrainerHudEl.style.display = state ? 'block' : 'none';
  if (!state) return;
  const opts = state.opts;

  el('pip-trainer-reps').textContent = `${state.reps}`;
  el('pip-trainer-hold').textContent = `${state.holdTimer.toFixed(2)}s / ${opts.holdDurationSec.toFixed(2)}s`;
  const holdPct = opts.holdDurationSec > 0
    ? Math.min(100, Math.max(0, (state.holdTimer / opts.holdDurationSec) * 100)) : 0;
  (el('pip-trainer-hold-bar')).style.width = `${holdPct}%`;
  if (opts.durationSec !== null) {
    const remaining = Math.max(0, opts.durationSec - state.elapsedSec);
    el('pip-trainer-timer-label').textContent = 'TIME LEFT';
    el('pip-trainer-timer').textContent = `${remaining.toFixed(1)}s`;
  } else {
    el('pip-trainer-timer-label').textContent = 'TIME';
    el('pip-trainer-timer').textContent = `${state.elapsedSec.toFixed(1)}s`;
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
