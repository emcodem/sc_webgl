import type { World, EnemyShip, ShipBody } from '../core/world';
import { length, sub, clamp, dot } from '../math/vec';
import { getStatusMessage } from '../control/mode';
import * as Input from '../input/input';
import { computeAxes } from '../math/quaternion';
import { project, edgeIndicatorDirection, type Camera } from '../combat/projection';
import { findActivePip } from '../combat/pipTargeting';
import * as MouseLook from '../input/mouseLook';
import * as RemoteMouseInput from '../input/remoteMouseInput';
import * as EspAssist from '../combat/espAssist';
import { bubbleTicks } from '../scenarios/runtime';
import { SCORE_FLASH_DURATION, type PipTrainerState } from '../combat/pipTrainer';
import { ROLL_TRAINER_STANDOFF_M } from '../combat/rollTrainer';
import type { RollTrainerState } from '../combat/rollTrainer';
import { getFps } from './fpsTracker';
import * as Recorder from '../replay/recorder';
import * as ReplayPlayer from '../replay/player';
import { saveDecoupledPreference } from '../input/decoupledPreference';

// DOM HUD overlay — ported from the original project's starcitizen_flightsim/index.html +
// render/render.ts's updateHUD: a bottom-left flight-stats panel (#stats), a top-center mission
// stats panel for the active scenario (#scenario-hud), and a top-center PIP Trainer panel
// (#pip-trainer-hud). #stats additionally covers this project's own on-foot mode and destroyed/
// respawning state, neither of which exist in the original (it's ship-only).

const crosshairEl = document.getElementById('crosshair') as HTMLElement;
const damageFlashEl = document.getElementById('damage-flash') as HTMLElement;
const hintEl = document.getElementById('capture-hint') as HTMLElement;
const pipMarkerEl = document.getElementById('pip-marker') as HTMLElement;
const pipTrainerMarkerEl = document.getElementById('pip-trainer-marker') as HTMLElement;
const espCircleEl = document.getElementById('esp-circle') as unknown as SVGCircleElement;
const espLabelEl = document.getElementById('esp-label') as unknown as SVGTextElement;
const vjoyLineEl = document.getElementById('vjoy-line') as unknown as SVGLineElement;
const vjoyTriangleEl = document.getElementById('vjoy-triangle') as unknown as SVGPolygonElement;
const vjoyLineGradientEl = document.getElementById('vjoy-line-gradient') as unknown as SVGLinearGradientElement;

const scenarioHudEl = document.getElementById('scenario-hud') as HTMLElement;
const pipTrainerHudEl = document.getElementById('pip-trainer-hud') as HTMLElement;
const rollTrainerHudEl = document.getElementById('roll-trainer-hud') as HTMLElement;
const rollTrainerResultEl = document.getElementById('roll-trainer-result-popup') as HTMLElement;

const recIndicatorEl = document.getElementById('rec-indicator') as HTMLElement;
const recIndicatorTimeEl = document.getElementById('rec-indicator-time') as HTMLElement;

const statsModeEl = document.getElementById('stats-mode') as HTMLElement;
const statsFlightRowsEl = document.getElementById('stats-flight-rows') as HTMLElement;
const statsFootRowsEl = document.getElementById('stats-foot-rows') as HTMLElement;
const statsDestroyedRowsEl = document.getElementById('stats-destroyed-rows') as HTMLElement;

const el = (id: string) => document.getElementById(id) as HTMLElement;

// ---------- Dirty-checked DOM writes ----------
// updateHUD runs every frame and pushes ~100 values into the DOM, the overwhelming majority of which
// are unchanged from the previous frame (a ship name, a mass, a row's display mode, a readout that
// only moves every few frames). Writing them anyway is not free: assigning `textContent` replaces the
// text node and assigning `className`/`setAttribute` dirties style, so each redundant write
// re-invalidates layout/paint for that element and the compositor re-rasters the HUD layer.
//
// These helpers skip the write when the value is identical to the last one written through them, which
// turns almost the whole per-frame HUD update into a set of cheap comparisons. Elements are keyed in
// WeakMaps, so nothing here keeps a removed node alive.
//
// Measured context: at the 60fps vsync cap this was NOT a bottleneck (the HUD was well inside budget).
// It becomes one exactly when the frame rate is unlocked — an unthrottled loop re-rasterising this
// layer every iteration is what starves Chrome's compositor, so the render loop can report >1000fps
// while the display only receives single-digit frames per second. Keeping the writes dirty-checked is
// what makes the HUD's cost scale with what actually changed rather than with the frame rate.
const lastText = new WeakMap<Element, string>();
function setText(target: Element, value: string): void {
  if (lastText.get(target) === value) return;
  lastText.set(target, value);
  target.textContent = value;
}

const lastClass = new WeakMap<Element, string>();
function setClass(target: Element, value: string): void {
  if (lastClass.get(target) === value) return;
  lastClass.set(target, value);
  target.className = value;
}

const lastStyle = new WeakMap<Element, Map<string, string>>();
function setStyle(target: HTMLElement | SVGElement, prop: string, value: string): void {
  let props = lastStyle.get(target);
  if (!props) { props = new Map(); lastStyle.set(target, props); }
  if (props.get(prop) === value) return;
  props.set(prop, value);
  (target.style as unknown as Record<string, string>)[prop] = value;
}

const lastAttr = new WeakMap<Element, Map<string, string>>();
function setAttr(target: Element, name: string, value: string): void {
  let attrs = lastAttr.get(target);
  if (!attrs) { attrs = new Map(); lastAttr.set(target, attrs); }
  if (attrs.get(name) === value) return;
  attrs.set(name, value);
  target.setAttribute(name, value);
}

const hudCanvasEl = document.getElementById('hud-canvas') as HTMLCanvasElement;
const hudCtx = hudCanvasEl.getContext('2d');

// Vertical gauges (speed left, boost right)
const speedGaugeEl = document.getElementById('speed-gauge') as HTMLElement;
const speedFillEl = document.getElementById('speed-fill') as HTMLElement;
const speedTicksEl = document.getElementById('speed-ticks') as HTMLElement;
const speedThrottleEl = document.getElementById('speed-throttle') as HTMLElement;
const speedValEl = document.getElementById('speed-val') as HTMLElement;
const boostGaugeEl = document.getElementById('boost-gauge') as HTMLElement;
const boostFillEl = document.getElementById('boost-fill') as HTMLElement;
const boostTicksEl = document.getElementById('boost-ticks') as HTMLElement;
const boostValEl = document.getElementById('boost-val') as HTMLElement;

let modeFlagWired = false;
let gaugesInitDone = false;

export function updateHUD(world: World): void {
  const p = world.player;
  const ship = p.ship;

  // DECOUPLED row doubles as a click target — same effect as the decoupleToggle keybind — wired
  // once, lazily, the first time the HUD updates (mirrors the original project's initModeToggle).
  // The handler must resolve world.player.ship AT CLICK TIME: resetWorld() replaces world.player
  // (and its ShipBody) in place, so a ship captured at wire time goes stale after a restart and
  // the click would silently toggle an orphaned object. `world` itself is never swapped out.
  if (!modeFlagWired) {
    modeFlagWired = true;
    el('mode-flag').addEventListener('click', () => {
      const live = world.player.ship;
      live.decoupled = !live.decoupled;
      saveDecoupledPreference(live.decoupled);
    });
  }

  updateScenarioHUD(world);
  updatePipTrainerHUD(world);
  updateRollTrainerHUD(world);
  updateRollTrainerResultPopup(world);
  updateStatsPanel(world);
  updateRecordingIndicator();

  crosshairEl.classList.toggle('hit', world.hitMarkerTimer > 0);
  setStyle(damageFlashEl, 'opacity', String(ship.hitFlash * 0.8));
  updatePipMarker(world);
  updatePipTrainerMarker(world);
  updateFlightRings(world);
  updateHudCanvas(world);

  // capture hint / status line
  if (!Input.isCaptured()) {
    hintEl.classList.remove('hidden');
    hintEl.innerHTML = ReplayPlayer.isActive()
      ? 'Click to capture mouse — WASD flies the free camera (toggle it in the transport bar)'
      : 'Click to capture mouse';
  } else {
    const status = getStatusMessage();
    if (status) {
      hintEl.classList.remove('hidden');
      setText(hintEl, status);
    } else {
      hintEl.classList.add('hidden');
    }
  }

  updateGauges(world);
}

// Generate tick marks on the vertical gauges (once at first call).
function initGauges(): void {
  if (gaugesInitDone) return;
  gaugesInitDone = true;
  for (let i = 0; i <= 10; i++) {
    const pct = `${(i / 10) * 100}%`;
    const tick = document.createElement('div');
    tick.className = 'tick'; // freshly created element, nothing to dirty-check against
    tick.style.setProperty('--pct', pct);
    speedTicksEl.appendChild(tick);

    const boostTick = document.createElement('div');
    boostTick.className = 'tick'; // freshly created element, nothing to dirty-check against
    boostTick.style.setProperty('--pct', pct);
    boostTicksEl.appendChild(boostTick);
  }
}

// Update vertical gauges each frame.
function updateGauges(world: World): void {
  initGauges();
  const p = world.player;
  const ship = p.ship;

  // Hide both when destroyed or in on-foot mode (gauges are pilot-specific).
  const showPilot = world.player.ship.respawnTimer <= 0 && p.mode === 'pilot';
  setStyle(speedGaugeEl, 'display', showPilot ? '' : 'none');
  setStyle(boostGaugeEl, 'display', showPilot ? '' : 'none');

  if (!showPilot) return;

  // Speed gauge — label is total travel speed (the ship only ever moves along one vector), but
  // the bar reflects that vector's component along the nose (SC convention): full bottom-up when
  // the nose points at the forward TVI, full top-down facing the reverse TVI, and empty at 90°
  // off — i.e. dot(vel, forward), not |vel|. Sign flips which end of the track fills from.
  const speed = length(ship.vel);
  const maxSpeed = ship.type.boostSpeedForward;
  const forward = computeAxes(ship.quat).forward;
  const forwardSpeed = dot(ship.vel, forward);
  const speedFrac = Math.min(1, Math.abs(forwardSpeed) / maxSpeed) * 100;
  setStyle(speedFillEl, 'height', `${speedFrac}%`);
  speedFillEl.classList.toggle('reverse', forwardSpeed < 0);
  setText(speedValEl, `${Math.round(speed)} m/s`);

  // Throttle indicator — SC's own convention, distinct from the fill above but sharing its mode:
  // top- vs bottom-anchored is the SPEED BAR's own indicated direction (forwardSpeed's sign), not
  // recent throttle input. While the speed bar reads backward, the indicator can only show backward
  // thrust — commanding forward thrust in that state reads as zero (stuck at the mode's own 0%
  // position), and symmetrically for reading forward while thrusting backward. Bar height amplitude
  // at 100% commanded throttle differs by direction/boost state — measured against the gauge's own
  // fixed physical track (bracket-top to marker's own rest), not against each other, per user
  // go-ahead 2026-08-02 (see capture/MEASUREMENTS.md's "Throttle indicator bar-height amplitude"
  // section): unboosted forward 45%, unboosted backward 55%, boosted (either direction) 100%.
  const throttleReverse = forwardSpeed < 0;
  const throttleAccelerating = throttleReverse ? ship.throttle < 0 : ship.throttle > 0;
  const throttleMaxPct = ship.boosting ? 100 : (throttleReverse ? 55 : 45);
  const throttleFrac = throttleAccelerating ? Math.min(1, Math.abs(ship.throttle)) * throttleMaxPct : 0;
  speedThrottleEl.classList.toggle('reverse', throttleReverse);
  setStyle(speedThrottleEl, 'bottom', throttleReverse ? 'auto' : `${throttleFrac}%`);
  setStyle(speedThrottleEl, 'top', throttleReverse ? `${throttleFrac}%` : 'auto');

  // Boost gauge — fill height = boostMeter / boostCapacity, label below.
  const boostPct = Math.round((ship.boostMeter / ship.type.boostCapacity) * 100);
  setStyle(boostFillEl, 'height', `${boostPct}%`);
  setText(boostValEl, `${boostPct}%`);
  boostFillEl.classList.toggle('active', ship.boosting);
}

// Bottom-left flight-stats panel: throttle/boost bars, speed, yaw/pitch/turn rate, decoupled/
// brake/mass/ship — ported field-for-field from the original project's #stats panel — plus this
// project's own extensions (HULL/TARGET while piloting) and its on-foot/destroyed sub-blocks,
// which the original never had (it's ship-only, no character controller).
function updateStatsPanel(world: World): void {
  const p = world.player;
  const ship = p.ship;

  // Meaningful in all three sub-panels (flight/foot/destroyed), so it updates unconditionally
  // rather than living inside just one of the mutually-exclusive row groups below.
  setText(el('s-fps'), `${Math.round(getFps())}`);

  const showDestroyed = ship.respawnTimer > 0;
  const showFlight = !showDestroyed && p.mode === 'pilot';
  const showFoot = !showDestroyed && p.mode === 'onfoot';
  setStyle(statsDestroyedRowsEl, 'display', showDestroyed ? 'block' : 'none');
  setStyle(statsFlightRowsEl, 'display', showFlight ? 'block' : 'none');
  setStyle(statsFootRowsEl, 'display', showFoot ? 'block' : 'none');

  if (showDestroyed) {
    setStyle(statsModeEl, 'display', 'block');
    setText(statsModeEl, 'SHIP DESTROYED');
    setText(el('s-respawn'), `${ship.respawnTimer.toFixed(1)}s`);
    return;
  }

  if (showFoot) {
    setStyle(statsModeEl, 'display', 'block');
    setText(statsModeEl, 'ON FOOT — EVA');
    const speed = length(p.charVel);
    setText(el('s-ground'), p.groundBody ? p.groundBody.name : '— (zero-g)');
    setText((el('s-foot-speed')), `${speed.toFixed(1)} m/s`);
    const stanceEl = el('s-stance');
    setText(stanceEl, p.onGround ? 'GROUNDED' : 'AIRBORNE');
    setClass(stanceEl, p.onGround ? 'value on' : 'value');
    return;
  }

  // The "PILOTING — <SHIP>" banner is redundant (the SHIP row below already names it), so it's
  // hidden while flying — the panel leads straight into the flight readout.
  setStyle(statsModeEl, 'display', 'none');

  setText(el('s-throttle'), `${Math.round(ship.throttle * 100)}%`);
  setStyle((el('bar-throttle')), 'width', `${Math.round(Math.abs(ship.throttle) * 100)}%`);

  // All guns fire (and drain/dwell) together every tick — see combat/weapons.ts's tryFireWeapon —
  // so any one gun's capacitor/cooldown represents the whole weapon system's state.
  const capacitors = ship.weaponCapacitors;
  const weapon = ship.type.weaponType;
  const capPct = Math.round((capacitors[0] / weapon.capacitorCapacity) * 100);
  const capEl = el('s-capacitor');
  setText(capEl, `${capPct}%`);
  const gunReady = capacitors[0] >= weapon.capacitorCostPerShot;
  setClass(capEl, gunReady ? 'value' : 'value on');
  setStyle((el('bar-capacitor')), 'width', `${Math.max(0, capPct)}%`);
  // Post-fire dwell wipe (see style.css's .bar-dwell-overlay doc comment): a fixed-opacity overlay
  // anchored to the right, its width shrinking from 100% (freshly fired) to 0% (dwell elapsed) over
  // capacitorRechargeDelaySec, so the covered region visibly recedes left-to-right as the wait ends.
  const dwellRemaining = ship.weaponCapacitorCooldownTimers[0];
  const dwellFrac = weapon.capacitorRechargeDelaySec > 0
    ? Math.max(0, Math.min(1, dwellRemaining / weapon.capacitorRechargeDelaySec))
    : 0;
  setStyle((el('bar-capacitor-dwell')), 'width', `${dwellFrac * 100}%`);

  const yawRateDeg = ship.angVel.yaw * (180 / Math.PI);
  const pitchRateDeg = ship.angVel.pitch * (180 / Math.PI);
  // combined nose-turn rate — roll doesn't move the boresight, so it's excluded
  const turnRateDeg = Math.hypot(yawRateDeg, pitchRateDeg);
  setText(el('s-yawrate'), `${yawRateDeg.toFixed(1)}°/s`);
  setText(el('s-pitchrate'), `${pitchRateDeg.toFixed(1)}°/s`);
  setText(el('s-turnrate'), `${turnRateDeg.toFixed(1)}°/s`);

  const decoupledEl = el('s-decoupled');
  setText(decoupledEl, ship.decoupled ? 'ON' : 'OFF');
  setClass(decoupledEl, ship.decoupled ? 'value on' : 'value');
  const brakeEl = el('s-brake');
  setText(brakeEl, ship.spaceBrakeOn ? 'ON' : 'OFF');
  setClass(brakeEl, ship.spaceBrakeOn ? 'value on' : 'value');

  const hullEl = el('s-hull');
  // health.points accumulates float damage amounts (fractional weapon/capacitor damage), so it can
  // land a hair off an integer (e.g. 16.999999999999996) — round for display only, the underlying
  // float stays exact for damage math.
  setText(hullEl, `${Math.round(ship.health.points)}/${Math.round(ship.health.maxPoints)}`);
  setClass(hullEl, ship.health.points <= ship.health.maxPoints * 0.3 ? 'value on' : 'value');
  setText(el('s-target'), targetReadout(world));

  setText(el('s-mass'), ship.type.mass.toFixed(2));
  setText(el('s-ship'), ship.type.name);
}

// Top-center mission-stats panel while a training scenario is running — ported row-for-row and
// show/hide-rule-for-rule from the original project's #scenario-hud / updateHUD's scenario branch.
function updateScenarioHUD(world: World): void {
  const runtime = world.scenario;
  setStyle(scenarioHudEl, 'display', runtime ? 'block' : 'none');
  if (!runtime) return;
  const config = runtime.config;
  const stats = runtime.stats;

  setText(el('scenario-hud-name'), config.name);

  const isGates = config.winCondition === 'gates';
  const isSurvive = config.winCondition === 'survive';
  // 'survive' drills normally hide the player-hits row (their enemy never fires — Aim Training,
  // Merge Drill), but the Evasive Pilot drill's optional return fire needs it, sourced from the
  // hitsTaken counter below rather than the health-delta the non-survive branch reads, since a
  // survive drill's hitsToKillPlayer is deliberately unreachable.
  const showPlayerHits = !isSurvive || config.evasiveReturnFire === true;
  setStyle(el('scenario-hud-enemy-row'), 'display', (isGates || isSurvive) ? 'none' : 'flex');
  setStyle(el('scenario-hud-player-row'), 'display', showPlayerHits ? 'flex' : 'none');
  setStyle(el('scenario-hud-kills-row'), 'display', isSurvive ? 'flex' : 'none');
  setStyle(el('scenario-hud-accuracy-row'), 'display', isSurvive ? 'flex' : 'none');
  setStyle(el('scenario-hud-gate-row'), 'display', isGates ? 'flex' : 'none');
  setStyle(el('scenario-hud-timer-row'), 'display', (isGates || isSurvive) ? 'flex' : 'none');
  const hasBubble = config.rangeBubbleRadius !== undefined;
  setStyle(el('scenario-hud-bubble-row'), 'display', hasBubble ? 'flex' : 'none');
  if (hasBubble) setText(el('scenario-hud-bubble'), `${bubbleTicks(runtime)}`);

  if (isGates) {
    const gateTotal = config.gatePath?.length ?? 0;
    setText(el('scenario-hud-gate'), `${Math.min(runtime.gateIndex + 1, gateTotal)}/${gateTotal}`);
    const remaining = Math.max(0, (config.surviveDurationSec ?? 0) - runtime.elapsedSec);
    setText(el('scenario-hud-timer-label'), 'TIME LEFT');
    setText(el('scenario-hud-timer'), `${remaining.toFixed(1)}s`);
  } else if (isSurvive) {
    const duration = config.surviveDurationSec;
    if (duration !== undefined) {
      const remaining = Math.max(0, duration - runtime.elapsedSec);
      setText(el('scenario-hud-timer-label'), 'TIME LEFT');
      setText(el('scenario-hud-timer'), `${remaining.toFixed(1)}s`);
    } else {
      setText(el('scenario-hud-timer-label'), 'TIME');
      setText(el('scenario-hud-timer'), `${runtime.elapsedSec.toFixed(1)}s`);
    }
    setText(el('scenario-hud-kills'), `${stats.kills}`);
    const accuracy = stats.shotsFired > 0 ? Math.round((stats.hitsLanded / stats.shotsFired) * 100) : 0;
    setText(el('scenario-hud-accuracy'), `${accuracy}%`);
    if (showPlayerHits) setText(el('scenario-hud-player-hits'), `${stats.hitsTaken}`);
  } else {
    // health.points/maxPoints accumulate float damage amounts, so their difference can land a hair
    // off an integer — round for display only (same reasoning as the #s-hull panel above).
    const enemy = world.enemies[0];
    const enemyHits = enemy ? Math.round(enemy.health.maxPoints - enemy.health.points) : 0;
    const enemyMax = enemy ? Math.round(enemy.health.maxPoints) : 0;
    setText(el('scenario-hud-enemy-hits'), `${enemyHits}/${enemyMax}`);

    const ship = world.player.ship;
    const playerHits = Math.round(ship.health.maxPoints - ship.health.points);
    setText(el('scenario-hud-player-hits'), `${playerHits}/${Math.round(ship.health.maxPoints)}`);
  }
}

// Top-center PIP Trainer panel — ported from the original project's #pip-trainer-hud /
// updatePipTrainerHUD.
function updatePipTrainerHUD(world: World): void {
  const state = world.pipTrainer;
  setStyle(pipTrainerHudEl, 'display', state ? 'block' : 'none');
  if (!state) return;
  const opts = state.opts;

  setText(el('pip-trainer-reps'), `${state.reps}`);
  setText(el('pip-trainer-hold'), `${state.holdTimer.toFixed(2)}s / ${opts.holdDurationSec.toFixed(2)}s`);
  const holdPct = opts.holdDurationSec > 0
    ? Math.min(100, Math.max(0, (state.holdTimer / opts.holdDurationSec) * 100)) : 0;
  setStyle((el('pip-trainer-hold-bar')), 'width', `${holdPct}%`);
  if (opts.durationSec !== null) {
    const remaining = Math.max(0, opts.durationSec - state.elapsedSec);
    setText(el('pip-trainer-timer-label'), 'TIME LEFT');
    setText(el('pip-trainer-timer'), `${remaining.toFixed(1)}s`);
  } else {
    setText(el('pip-trainer-timer-label'), 'TIME');
    setText(el('pip-trainer-timer'), `${state.elapsedSec.toFixed(1)}s`);
  }
}

// Top-center Roll Trainer panel — see combat/rollTrainer.ts. TARGET shows the current challenge
// (the ghost mesh's own bank, rendered by render/renderer.ts); ATTEMPT counts up toward the
// per-rep time limit; SCORE is tinted by the most recent rep's tier (perfect/good/failed) until
// the next one lands.
function updateRollTrainerHUD(world: World): void {
  const state = world.rollTrainer as RollTrainerState | null;
  setStyle(rollTrainerHudEl, 'display', state ? 'block' : 'none');
  if (!state) return;
  const opts = state.opts;

  const targetDeg = Math.round(Math.abs(state.targetSignedDeg));
  const targetDir = state.targetSignedDeg < 0 ? 'LEFT' : 'RIGHT';
  setText(el('roll-trainer-target'), `${targetDeg}° ${targetDir}`);

  setText(el('roll-trainer-attempt-timer'), `${state.challengeTimer.toFixed(1)}s / ${opts.matchTimeSec.toFixed(1)}s`);
  const attemptPct = opts.matchTimeSec > 0
    ? Math.min(100, Math.max(0, (state.challengeTimer / opts.matchTimeSec) * 100)) : 0;
  setStyle(el('roll-trainer-attempt-bar'), 'width', `${attemptPct}%`);

  setText(el('roll-trainer-score'), state.score.toFixed(1));
  const scoreColor = state.lastResultTier === 'perfect' ? 'var(--hud-on)'
    : state.lastResultTier === 'good' ? '#ffd35c'
    : state.lastResultTier === 'failed' ? 'var(--hud-danger)' : '';
  setStyle(el('roll-trainer-score'), 'color', scoreColor);
  setText(el('roll-trainer-speed'), `${state.speedMultiplier}`);
  setText(el('roll-trainer-reps'), `${state.perfectReps}P ${state.goodReps}G / ${state.reps}`);

  if (opts.lapTimeSec !== null) {
    const remaining = Math.max(0, opts.lapTimeSec - state.elapsedSec);
    setText(el('roll-trainer-timer-label'), 'TIME LEFT');
    setText(el('roll-trainer-timer'), `${remaining.toFixed(1)}s`);
  } else {
    setText(el('roll-trainer-timer-label'), 'TIME');
    setText(el('roll-trainer-timer'), `${state.elapsedSec.toFixed(1)}s`);
  }
}

// Arcade-style "PERFECT!/GOOD/FAILED" popup that pops up just above the ghost target every time a
// rep finishes — see combat/rollTrainer.ts's resultSeq. Positioned by projecting the ghost's
// world position (same formula render/renderer.ts uses to place the mesh) the same way
// updatePipTrainerMarker projects the PIP Trainer's target.
//
// Tracks the RollTrainerState OBJECT (not just its resultSeq) so a brand-new run always resets
// the "last seen" seq — otherwise a fresh run's first rep landing on the same seq value as the
// previous run's last rep (both start counting from 0) would be mistaken for "already shown" and
// the popup would silently keep displaying the prior run's stale text.
let lastRollTrainerStateRef: RollTrainerState | null = null;
let lastRollResultSeq = -1;

function updateRollTrainerResultPopup(world: World): void {
  const state = world.rollTrainer as RollTrainerState | null;
  if (state !== lastRollTrainerStateRef) {
    lastRollTrainerStateRef = state;
    lastRollResultSeq = -1;
  }
  if (!state || world.player.mode !== 'pilot') {
    setStyle(rollTrainerResultEl, 'display', 'none');
    return;
  }
  setStyle(rollTrainerResultEl, 'display', 'block');

  const ship = world.player.ship;
  const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
  const gx = ship.pos.x + cam.axes.forward.x * ROLL_TRAINER_STANDOFF_M;
  const gy = ship.pos.y + cam.axes.forward.y * ROLL_TRAINER_STANDOFF_M;
  const gz = ship.pos.z + cam.axes.forward.z * ROLL_TRAINER_STANDOFF_M;
  const p = project(gx, gy, gz, cam, window.innerWidth, window.innerHeight);
  if (p) {
    setStyle(rollTrainerResultEl, 'left', `${p.x}px`);
    setStyle(rollTrainerResultEl, 'top', `${p.y}px`);
  }

  if (state.lastResultTier === null || state.resultSeq === lastRollResultSeq) return;
  lastRollResultSeq = state.resultSeq;

  const tier = state.lastResultTier;
  rollTrainerResultEl.textContent = tier === 'perfect' ? 'PERFECT!' : tier === 'good' ? 'GOOD' : 'FAILED';
  // Reset to just the tier class (drops any previous 'pop'), force a reflow, then re-add 'pop' —
  // restarts the CSS animation even when the same tier lands twice in a row (see style.css).
  rollTrainerResultEl.className = tier;
  void rollTrainerResultEl.offsetWidth;
  rollTrainerResultEl.classList.add('pop');
}

// Manual-recording indicator — see replay/recorder.ts. Only shows for an intentionally-started
// manual session, not the always-on rolling buffer (that one's invisible by design).
function updateRecordingIndicator(): void {
  const recording = Recorder.isManualRecording();
  setStyle(recIndicatorEl, 'display', recording ? 'block' : 'none');
  if (recording) {
    const s = Math.floor(Recorder.manualRecordingElapsedSec());
    setText(recIndicatorTimeEl, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }
}

// Predicted-impact-point reticle: independently recomputes findActivePip with the same inputs the
// ESP damping in control/pilot.ts uses, so the drawn diamond always matches what's actually steering
// the crosshair assist (the call is cheap — O(enemies) — so it isn't worth threading a shared result
// across modules). Ported from the original project's render/render.ts::drawPip, moved from a 2D
// canvas draw call to a positioned DOM element since this HUD is DOM, not canvas.
function updatePipMarker(world: World): void {
  const ship = world.player.ship;
  if (world.player.mode !== 'pilot' || ship.respawnTimer > 0) {
    setStyle(pipMarkerEl, 'display', 'none');
    return;
  }
  const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
  const pip = findActivePip(ship.pos, ship.vel, cam, world.enemies, window.innerWidth, window.innerHeight);
  if (!pip) {
    setStyle(pipMarkerEl, 'display', 'none');
    return;
  }
  setStyle(pipMarkerEl, 'display', 'block');
  setStyle(pipMarkerEl, 'left', `${pip.screenX}px`);
  setStyle(pipMarkerEl, 'top', `${pip.screenY}px`);
  pipMarkerEl.classList.toggle('would-hit', pip.wouldHit);
}

// PIP Trainer's bare target diamond — deliberately reuses #pip-marker's exact fixed-pixel-size
// CSS (see style.css) rather than a 3D world-space mesh, so there's exactly one "PIP" look in the
// game and its size never depends on how far the target actually is (a world-space mesh, even one
// rescaled by distance every frame, is a second reimplementation of the same idea — this is the
// real one). Projects the pip's world position with the same combat/projection.ts::project used
// for the real combat PIP above.
function updatePipTrainerMarker(world: World): void {
  const state = world.pipTrainer;
  if (!state || world.player.mode !== 'pilot') {
    setStyle(pipTrainerMarkerEl, 'display', 'none');
    return;
  }
  const ship = world.player.ship;
  const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
  const p = project(state.pos.x, state.pos.y, state.pos.z, cam, window.innerWidth, window.innerHeight);
  if (!p) {
    setStyle(pipTrainerMarkerEl, 'display', 'none');
    return;
  }
  setStyle(pipTrainerMarkerEl, 'display', 'block');
  setStyle(pipTrainerMarkerEl, 'left', `${p.x}px`);
  setStyle(pipTrainerMarkerEl, 'top', `${p.y}px`);
  const holdFrac = state.opts.holdDurationSec > 0
    ? Math.min(1, Math.max(0, state.holdTimer / state.opts.holdDurationSec)) : 0;
  pipTrainerMarkerEl.classList.toggle('held', holdFrac > 0);
}

// Mouse-look virtual-joystick reticle + ESP dampening-zone ring. Ported from the original
// project's render/render.ts::drawMouseReticle/drawEspCircle (canvas draws) onto this DOM HUD's
// SVG overlay. Vjoy only shows while mouse-look is actually captured (matches the original); the
// ESP ring is always shown while piloting, regardless of input device or scenario state — ESP is
// a standing user setting (see the F4 controls panel), not scenario-gated.
function updateFlightRings(world: World): void {
  const piloting = world.player.mode === 'pilot' && world.player.ship.respawnTimer <= 0;
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;

  setStyle(espCircleEl, 'visibility', piloting ? 'visible' : 'hidden');
  setStyle(espLabelEl, 'visibility', piloting ? 'visible' : 'hidden');
  if (piloting) {
    const r = EspAssist.getCircleRadius();
    setAttr(espCircleEl, 'cx', String(cx));
    setAttr(espCircleEl, 'cy', String(cy));
    setAttr(espCircleEl, 'r', String(r));
    // ESP label sits just below its circle
    setAttr(espLabelEl, 'x', String(cx));
    setAttr(espLabelEl, 'y', String(cy + r + 12));
  }

  // Shows on real pointer-lock capture OR while remote mouse input is streaming deltas (the
  // side-by-side-vs-SC workflow — the game canvas is never clicked/pointer-locked there, since
  // the real mouse is driving actual SC in another window; see remoteMouseInput.ts).
  const showVjoy = piloting && (MouseLook.isCaptured() || RemoteMouseInput.isConnected());
  setStyle(vjoyLineEl, 'visibility', showVjoy ? 'visible' : 'hidden');
  setStyle(vjoyTriangleEl, 'visibility', showVjoy ? 'visible' : 'hidden');
  if (showVjoy) {
    // Normalize by maxX/maxY and scale to an on-screen radius -- maxX/maxY (mouseLook.ts's
    // yawFullDeflectionCounts/pitchFullDeflectionCounts, DIFFERENT per axis -- see that file's doc
    // comment) are raw mouse-COUNT gain constants (can be in the thousands, see
    // capture/MEASUREMENTS.md), not a pixel cap, so drawing x/y as literal screen pixels would send
    // the marker arbitrarily far off-screen at a large gain. The radius itself mirrors SC's own on-
    // screen indicator, driven by `vjoyRangeDegrees` (F4 panel, SC's own "VJoy Range" slider units).
    // VJoyAnglePilots is a literal FOV-relative visual angle -- SC renders the indicator tip as if it
    // were a fixed point that many degrees off boresight, projected through the same pinhole-camera
    // math capture/analysis/angle_convert.py already uses for real landmark tracking (f = (width/2) /
    // tan(FOV_h/2), radius = f * tan(degrees)). Calibrated against two real measurements (FOV116,
    // 3840px-wide monitor): VJA=25 -> 570px, VJA=10 -> 222px; the fitted focal length (~1222px)
    // matches the theoretical f=1200px for FOV116/width=3840 within ~2%, confirming the model (not
    // just curve-fit on 2 points) -- reuses `window.innerWidth` so it scales to any window size.
    const SC_VJOY_FOV_H_DEG = 116;
    const focalLengthPx = (window.innerWidth / 2) / Math.tan((SC_VJOY_FOV_H_DEG * Math.PI / 180) / 2);
    const indicatorRadius = focalLengthPx * Math.tan(MouseLook.getVjoyRangeDegrees() * Math.PI / 180);
    const { x, y, maxX, maxY } = MouseLook.getOffset();
    const rx = cx + (maxX > 0 ? (x / maxX) * indicatorRadius : 0);
    const ry = cy + (maxY > 0 ? (y / maxY) * indicatorRadius : 0);

    setAttr(vjoyLineEl, 'x1', String(cx));
    setAttr(vjoyLineEl, 'y1', String(cy));
    setAttr(vjoyLineEl, 'x2', String(rx));
    setAttr(vjoyLineEl, 'y2', String(ry));

    // Keep the fade gradient's own coordinate span locked to the line's current endpoints
    // (gradientUnits="userSpaceOnUse" — see index.html) so the fade-out always happens at the
    // center and at the triangle tip, regardless of the line's length/angle this frame.
    setAttr(vjoyLineGradientEl, 'x1', String(cx));
    setAttr(vjoyLineGradientEl, 'y1', String(cy));
    setAttr(vjoyLineGradientEl, 'x2', String(rx));
    setAttr(vjoyLineGradientEl, 'y2', String(ry));

    // Triangle's local points (in the SVG markup) point along +x; rotate to face the deflection
    // direction (same direction the line points, away from center) and place it at the stick position.
    const angleDeg = (Math.atan2(ry - cy, rx - cx) * 180) / Math.PI;
    setAttr(vjoyTriangleEl, 'transform', `translate(${rx},${ry}) rotate(${angleDeg})`);
  }
}

// Canvas-drawn, world-anchored flight HUD, ported from the original project's render/render.ts
// canvas draws: the total-velocity indicator (prograde/retrograde flight-path marker), a
// distance + line-of-sight closing-speed readout under every live enemy, and an edge arrow
// pointing at each enemy that's off-screen or behind the camera. Positioned with the same
// combat/projection.ts::project() the PIP uses, so it lines up with the three.js render. Drawn on a
// dedicated 2D canvas beneath the DOM panels (see index.html #hud-canvas) rather than as DOM nodes,
// since these are per-frame vector draws over a variable number of targets.
const EDGE_INDICATOR_MARGIN = 28;

function updateHudCanvas(world: World): void {
  const ctx = hudCtx;
  if (!ctx) return;
  const W = window.innerWidth, H = window.innerHeight;
  if (hudCanvasEl.width !== W) hudCanvasEl.width = W;
  if (hudCanvasEl.height !== H) hudCanvasEl.height = H;
  ctx.clearRect(0, 0, W, H);

  const ship = world.player.ship;
  if (world.player.mode !== 'pilot' || ship.respawnTimer > 0) return;
  const cam: Camera = { pos: ship.pos, axes: computeAxes(ship.quat) };

  drawTotalVelocityIndicator(ctx, ship, cam, W, H);
  for (const enemy of world.enemies) {
    if (enemy.respawnTimer > 0 || enemy.health.points <= 0) continue;
    drawEnemyInfo(ctx, enemy, ship, cam, W, H);
    drawOffscreenArrow(ctx, enemy.pos, cam, W, H, '#ff7a45', 'rgba(255, 170, 110, 0.85)');
  }
  if (world.pipTrainer) {
    drawPipTrainerRing(ctx, world.pipTrainer, cam, W, H);
    drawPipTrainerInfo(ctx, world.pipTrainer, ship, cam, W, H);
  }
}

// Distance + line-of-sight closing speed under the PIP Trainer's target, mirroring drawEnemyInfo
// above (same data shape: state.pos/state.vel in place of enemy.pos/enemy.vel). Unlike a real
// enemy, the trainer's marker is a fixed-pixel-size diamond that doesn't scale with distance (see
// updatePipTrainerMarker's doc comment), so the label uses a fixed pixel offset instead of
// drawEnemyInfo's hullRadius-scaled one.
const PIP_TRAINER_INFO_OFFSET_Y = 22;

function drawPipTrainerInfo(ctx: CanvasRenderingContext2D, state: PipTrainerState, ship: ShipBody, cam: Camera, W: number, H: number): void {
  const p = project(state.pos.x, state.pos.y, state.pos.z, cam, W, H);
  if (!p) return;
  const rx = state.pos.x - ship.pos.x, ry = state.pos.y - ship.pos.y, rz = state.pos.z - ship.pos.z;
  const distance = Math.hypot(rx, ry, rz);
  if (distance < 1e-6) return;
  const rvx = state.vel.x - ship.vel.x, rvy = state.vel.y - ship.vel.y, rvz = state.vel.z - ship.vel.z;
  const closingRate = -(rx * rvx + ry * rvy + rz * rvz) / distance;
  ctx.textAlign = 'center';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillStyle = 'rgba(200, 225, 215, 0.85)';
  ctx.fillText(`${distance.toFixed(0)}m`, p.x, p.y + PIP_TRAINER_INFO_OFFSET_Y);
  ctx.fillStyle = closingRate > 0 ? 'rgba(125, 255, 160, 0.85)' : 'rgba(255, 150, 110, 0.85)';
  ctx.fillText(`${closingRate >= 0 ? '+' : ''}${closingRate.toFixed(0)} m/s`, p.x, p.y + PIP_TRAINER_INFO_OFFSET_Y + 16);
}

// Hold-progress ring + scored-rep flash ring around the PIP Trainer's diamond (#pip-trainer-marker
// in the DOM handles the diamond itself). Ported from the original project's render/render.ts::
// drawPipTrainerMarker — same radii/colors/arc math, just the ring portion, drawn on this canvas
// instead of the diamond's DOM element since a sweeping arc isn't expressible as a CSS border.
function drawPipTrainerRing(ctx: CanvasRenderingContext2D, state: PipTrainerState, cam: Camera, W: number, H: number): void {
  const p = project(state.pos.x, state.pos.y, state.pos.z, cam, W, H);
  if (!p) return;
  const r = 8;
  const opts = state.opts;
  const holdFrac = opts.holdDurationSec > 0 ? clamp(state.holdTimer / opts.holdDurationSec, 0, 1) : 0;

  if (holdFrac > 0) {
    ctx.strokeStyle = 'rgba(125,255,160,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 6, -Math.PI / 2, -Math.PI / 2 + holdFrac * Math.PI * 2);
    ctx.stroke();
  }

  if (state.scoreFlash > 0) {
    const progress = 1 - state.scoreFlash / SCORE_FLASH_DURATION;
    ctx.strokeStyle = `rgba(255,255,255,${(1 - progress).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 8 + progress * 22, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// Total-velocity indicator: a flight-path marker projected 40m along the ship's velocity vector.
// If that prograde point is behind the camera, it flips to the retrograde point and strikes it
// through. Hidden below 0.5 m/s (no meaningful travel direction).
function drawTotalVelocityIndicator(ctx: CanvasRenderingContext2D, ship: ShipBody, cam: Camera, W: number, H: number): void {
  const speed = length(ship.vel);
  if (speed <= 0.5) return;
  const dx = ship.vel.x / speed, dy = ship.vel.y / speed, dz = ship.vel.z / speed;
  let pp = project(ship.pos.x + dx * 40, ship.pos.y + dy * 40, ship.pos.z + dz * 40, cam, W, H);
  let retrograde = false;
  if (!pp) {
    pp = project(ship.pos.x - dx * 40, ship.pos.y - dy * 40, ship.pos.z - dz * 40, cam, W, H);
    retrograde = true;
  }
  if (!pp) return;
  ctx.strokeStyle = '#8fd3c7';
  ctx.lineWidth = 1.5;
  const r = 6, dash = r * 0.8, x = pp.x, y = pp.y;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x - r - dash, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + r + dash, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x, y - r - dash); ctx.stroke();
  if (retrograde) { ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.stroke(); }
}

// Distance + line-of-sight closing speed under an enemy. Relative speed is the range rate
// d|range|/dt = dot(relPos, relVel)/|relPos| (negative = closing, green; positive = opening,
// orange), NOT the raw relative-velocity magnitude. Label sits a fixed world offset below the hull,
// scaled to pixels by the projection and clamped so it stays legible at any range.
function drawEnemyInfo(ctx: CanvasRenderingContext2D, enemy: EnemyShip, ship: ShipBody, cam: Camera, W: number, H: number): void {
  const p = project(enemy.pos.x, enemy.pos.y, enemy.pos.z, cam, W, H);
  if (!p) return;
  const rx = enemy.pos.x - ship.pos.x, ry = enemy.pos.y - ship.pos.y, rz = enemy.pos.z - ship.pos.z;
  const distance = Math.hypot(rx, ry, rz);
  if (distance < 1e-6) return;
  const rvx = enemy.vel.x - ship.vel.x, rvy = enemy.vel.y - ship.vel.y, rvz = enemy.vel.z - ship.vel.z;
  // closingRate: positive when distance is shrinking (enemy approaching), negative when opening.
  const closingRate = -(rx * rvx + ry * rvy + rz * rvz) / distance;
  const offsetY = clamp(enemy.type.hullRadius * 1.8 * p.scale, 18, 60);
  ctx.textAlign = 'center';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillStyle = 'rgba(200, 225, 215, 0.85)';
  ctx.fillText(`${distance.toFixed(0)}m`, p.x, p.y + offsetY);
  ctx.fillStyle = closingRate > 0 ? 'rgba(125, 255, 160, 0.85)' : 'rgba(255, 150, 110, 0.85)';
  ctx.fillText(`${closingRate >= 0 ? '+' : ''}${closingRate.toFixed(0)} m/s`, p.x, p.y + offsetY + 16);
}

// Edge arrow for a target that's off-screen or behind the camera: gets the target's direction via
// edgeIndicatorDirection (see combat/projection.ts for why that's a raw axis projection rather than
// project()'s perspective-divided one — that distinction is what keeps this pointing the shortest
// way to turn across a full 360° sweep instead of flipping sides spuriously), clamps a ray from
// screen center to the inner edge rectangle (inset by EDGE_INDICATOR_MARGIN), then draws a triangle
// arrowhead plus a distance label there.
function drawOffscreenArrow(ctx: CanvasRenderingContext2D, pos: { x: number; y: number; z: number }, cam: Camera, W: number, H: number, arrowColor: string, labelColor: string): void {
  const cx = W / 2, cy = H / 2;
  const halfW = cx - EDGE_INDICATOR_MARGIN, halfH = cy - EDGE_INDICATOR_MARGIN;

  const p = project(pos.x, pos.y, pos.z, cam, W, H);
  const onScreen = p !== null && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
  if (onScreen) return;

  const dx = pos.x - cam.pos.x, dy = pos.y - cam.pos.y, dz = pos.z - cam.pos.z;
  let { dirX, dirY } = edgeIndicatorDirection(pos.x, pos.y, pos.z, cam);
  if (Math.abs(dirX) < 1e-6 && Math.abs(dirY) < 1e-6) dirY = 1;

  const angle = Math.atan2(dirY, dirX);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const tx = Math.abs(cosA) > 1e-6 ? halfW / Math.abs(cosA) : Infinity;
  const ty = Math.abs(sinA) > 1e-6 ? halfH / Math.abs(sinA) : Infinity;
  const t = Math.min(tx, ty);
  const ex = cx + cosA * t, ey = cy + sinA * t;

  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(angle);
  ctx.fillStyle = arrowColor;
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(-7, 6);
  ctx.lineTo(-7, -6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const distance = Math.hypot(dx, dy, dz);
  ctx.textAlign = 'center';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillStyle = labelColor;
  ctx.fillText(`${distance.toFixed(0)}m`, ex, ey + (sinA >= 0 ? 20 : -16));
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
