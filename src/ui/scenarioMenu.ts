import {
  SCENARIOS, buildAimTrainingScenario, AIM_TRAINING_DEFAULTS,
  buildMergeDrillScenario, MERGE_DRILL_DEFAULTS,
  buildEvasivePilotScenario, EVASIVE_PILOT_DEFAULTS,
  buildTurretDrillScenario, TURRET_DRILL_DEFAULTS
} from '../scenarios/definitions';
import type {
  AimTrainingOptions, MergeDrillOptions, EvasivePilotOptions, TurretDrillOptions
} from '../scenarios/definitions';
import type { ScenarioConfig, ScenarioRuntime } from '../scenarios/types';
import type { World } from '../core/world';
import { PIP_TRAINER_DEFAULTS } from '../combat/pipTrainer';
import type { PipTrainerOptions, PipTrainerState } from '../combat/pipTrainer';
import { ROLL_TRAINER_DEFAULTS } from '../combat/rollTrainer';
import type { RollTrainerOptions, RollTrainerState } from '../combat/rollTrainer';
import { notifyScenarioResult } from './mainMenu';

// ============================================================================================
// The scenario picker + results screen, ported from the original project's ui/scenarioMenu.ts.
// Renders inside sc_webgl's existing F3 overlay (#main-menu-overlay/#main-menu-box) rather than a
// second overlay — see ui/mainMenu.ts, which shows this picker every time the menu opens, below
// the pre-existing Resume/Restart row.
// ============================================================================================

export interface ScenarioMenuHandlers {
  startScenario(world: World, config: ScenarioConfig): void;
  startFreeFlight(world: World): void;
  startPipTrainer(world: World, opts: PipTrainerOptions): void;
  startRollTrainer(world: World, opts: RollTrainerOptions): void;
}

let picker: HTMLElement;
let list: HTMLElement;
let resultEl: HTMLElement;
let subtitleEl: HTMLElement;
let mainMenuLinksEl: HTMLElement;
let handlers: ScenarioMenuHandlers;
let world: World;
let hideOverlay: () => void;

// Persisted in localStorage so a player's tuned drill settings survive a page reload, not just
// menu open/close. Deliberately NOT routed through input/configRegistry.ts — that registry is a
// different persistence model (multiple named, export/import-able control-preset bundles); this is
// just "remember the last value of this one slider," one storage key per scenario.
const AIM_TRAINING_STORAGE_KEY = 'vector_aim_training_options';

function loadAimTrainingOptions(): AimTrainingOptions {
  try {
    const raw = localStorage.getItem(AIM_TRAINING_STORAGE_KEY);
    if (!raw) return { ...AIM_TRAINING_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      droneCount: typeof parsed.droneCount === 'number' ? parsed.droneCount : AIM_TRAINING_DEFAULTS.droneCount,
      aggressiveness: typeof parsed.aggressiveness === 'number' ? parsed.aggressiveness : AIM_TRAINING_DEFAULTS.aggressiveness,
      durationSec: typeof parsed.durationSec === 'number' || parsed.durationSec === null
        ? parsed.durationSec : AIM_TRAINING_DEFAULTS.durationSec
    };
  } catch {
    return { ...AIM_TRAINING_DEFAULTS }; // localStorage unavailable (e.g. private browsing) or corrupt data
  }
}

function saveAimTrainingOptions(): void {
  try { localStorage.setItem(AIM_TRAINING_STORAGE_KEY, JSON.stringify(aimTrainingOptions)); }
  catch { /* localStorage can be unavailable (e.g. private browsing) — non-fatal */ }
}

const aimTrainingOptions: AimTrainingOptions = loadAimTrainingOptions();

const MERGE_DRILL_STORAGE_KEY = 'vector_merge_drill_options';

function loadMergeDrillOptions(): MergeDrillOptions {
  try {
    const raw = localStorage.getItem(MERGE_DRILL_STORAGE_KEY);
    if (!raw) return { ...MERGE_DRILL_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      rangeBubbleRadius: typeof parsed.rangeBubbleRadius === 'number'
        ? parsed.rangeBubbleRadius : MERGE_DRILL_DEFAULTS.rangeBubbleRadius
    };
  } catch {
    return { ...MERGE_DRILL_DEFAULTS };
  }
}

function saveMergeDrillOptions(): void {
  try { localStorage.setItem(MERGE_DRILL_STORAGE_KEY, JSON.stringify(mergeDrillOptions)); }
  catch { /* non-fatal */ }
}

const mergeDrillOptions: MergeDrillOptions = loadMergeDrillOptions();

const EVASIVE_PILOT_STORAGE_KEY = 'vector_evasive_pilot_options';

function loadEvasivePilotOptions(): EvasivePilotOptions {
  try {
    const raw = localStorage.getItem(EVASIVE_PILOT_STORAGE_KEY);
    if (!raw) return { ...EVASIVE_PILOT_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      returnFire: typeof parsed.returnFire === 'boolean' ? parsed.returnFire : EVASIVE_PILOT_DEFAULTS.returnFire,
      durationSec: typeof parsed.durationSec === 'number' || parsed.durationSec === null
        ? parsed.durationSec : EVASIVE_PILOT_DEFAULTS.durationSec
    };
  } catch {
    return { ...EVASIVE_PILOT_DEFAULTS };
  }
}

function saveEvasivePilotOptions(): void {
  try { localStorage.setItem(EVASIVE_PILOT_STORAGE_KEY, JSON.stringify(evasivePilotOptions)); }
  catch { /* non-fatal */ }
}

const evasivePilotOptions: EvasivePilotOptions = loadEvasivePilotOptions();

const TURRET_DRILL_STORAGE_KEY = 'vector_turret_drill_options';

function loadTurretDrillOptions(): TurretDrillOptions {
  try {
    const raw = localStorage.getItem(TURRET_DRILL_STORAGE_KEY);
    if (!raw) return { ...TURRET_DRILL_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      turnRateScale: typeof parsed.turnRateScale === 'number'
        ? parsed.turnRateScale : TURRET_DRILL_DEFAULTS.turnRateScale
    };
  } catch {
    return { ...TURRET_DRILL_DEFAULTS };
  }
}

function saveTurretDrillOptions(): void {
  try { localStorage.setItem(TURRET_DRILL_STORAGE_KEY, JSON.stringify(turretDrillOptions)); }
  catch { /* non-fatal */ }
}

const turretDrillOptions: TurretDrillOptions = loadTurretDrillOptions();

const PIP_TRAINER_STORAGE_KEY = 'vector_pip_trainer_options';

function loadPipTrainerOptions(): PipTrainerOptions {
  try {
    const raw = localStorage.getItem(PIP_TRAINER_STORAGE_KEY);
    if (!raw) return { ...PIP_TRAINER_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      speed: typeof parsed.speed === 'number' ? parsed.speed : PIP_TRAINER_DEFAULTS.speed,
      randomness: typeof parsed.randomness === 'number' ? parsed.randomness : PIP_TRAINER_DEFAULTS.randomness,
      holdDurationSec: typeof parsed.holdDurationSec === 'number' ? parsed.holdDurationSec : PIP_TRAINER_DEFAULTS.holdDurationSec,
      avoidDegrees: typeof parsed.avoidDegrees === 'number' ? parsed.avoidDegrees : PIP_TRAINER_DEFAULTS.avoidDegrees,
      durationSec: typeof parsed.durationSec === 'number' || parsed.durationSec === null
        ? parsed.durationSec : PIP_TRAINER_DEFAULTS.durationSec
    };
  } catch {
    return { ...PIP_TRAINER_DEFAULTS };
  }
}

function savePipTrainerOptions(): void {
  try { localStorage.setItem(PIP_TRAINER_STORAGE_KEY, JSON.stringify(pipTrainerOptions)); }
  catch { /* non-fatal */ }
}

const pipTrainerOptions: PipTrainerOptions = loadPipTrainerOptions();

const ROLL_TRAINER_STORAGE_KEY = 'vector_roll_trainer_options';

function loadRollTrainerOptions(): RollTrainerOptions {
  try {
    const raw = localStorage.getItem(ROLL_TRAINER_STORAGE_KEY);
    if (!raw) return { ...ROLL_TRAINER_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      allowLeft: typeof parsed.allowLeft === 'boolean' ? parsed.allowLeft : ROLL_TRAINER_DEFAULTS.allowLeft,
      allowRight: typeof parsed.allowRight === 'boolean' ? parsed.allowRight : ROLL_TRAINER_DEFAULTS.allowRight,
      randomDegree: typeof parsed.randomDegree === 'boolean' ? parsed.randomDegree : ROLL_TRAINER_DEFAULTS.randomDegree,
      allow45: typeof parsed.allow45 === 'boolean' ? parsed.allow45 : ROLL_TRAINER_DEFAULTS.allow45,
      allow90: typeof parsed.allow90 === 'boolean' ? parsed.allow90 : ROLL_TRAINER_DEFAULTS.allow90,
      allow180: typeof parsed.allow180 === 'boolean' ? parsed.allow180 : ROLL_TRAINER_DEFAULTS.allow180,
      allow270: typeof parsed.allow270 === 'boolean' ? parsed.allow270 : ROLL_TRAINER_DEFAULTS.allow270,
      matchTimeSec: typeof parsed.matchTimeSec === 'number' ? parsed.matchTimeSec : ROLL_TRAINER_DEFAULTS.matchTimeSec,
      speedStart: typeof parsed.speedStart === 'number' ? parsed.speedStart : ROLL_TRAINER_DEFAULTS.speedStart,
      lapTimeSec: typeof parsed.lapTimeSec === 'number' || parsed.lapTimeSec === null
        ? parsed.lapTimeSec : ROLL_TRAINER_DEFAULTS.lapTimeSec
    };
  } catch {
    return { ...ROLL_TRAINER_DEFAULTS };
  }
}

function saveRollTrainerOptions(): void {
  try { localStorage.setItem(ROLL_TRAINER_STORAGE_KEY, JSON.stringify(rollTrainerOptions)); }
  catch { /* non-fatal */ }
}

const rollTrainerOptions: RollTrainerOptions = loadRollTrainerOptions();

function sliderRow(
  label: string, initial: number, min: number, max: number, step: number,
  format: (v: number) => string, onChange: (v: number) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'scenario-slider-row';

  const top = document.createElement('div');
  top.className = 'scenario-slider-top';
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'scenario-slider-value';
  valueEl.textContent = format(initial);
  top.appendChild(labelEl);
  top.appendChild(valueEl);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueEl.textContent = format(v);
    onChange(v);
  });
  // Dragging a slider shouldn't also drag/click through to whatever's under the card.
  input.addEventListener('click', e => e.stopPropagation());

  row.appendChild(top);
  row.appendChild(input);
  return row;
}

function checkboxRow(label: string, initial: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'scenario-checkbox-row';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.addEventListener('change', () => onChange(input.checked));
  input.addEventListener('click', e => e.stopPropagation());

  const labelEl = document.createElement('span');
  labelEl.textContent = label;

  row.appendChild(input);
  row.appendChild(labelEl);
  return row;
}

function buildAimTrainingControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Drones', aimTrainingOptions.droneCount, 2, 100, 2,
    v => `${v}`,
    v => { aimTrainingOptions.droneCount = v; saveAimTrainingOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Aggressiveness', Math.round(aimTrainingOptions.aggressiveness * 9) + 1, 1, 10, 1,
    v => `${v}/10`,
    v => { aimTrainingOptions.aggressiveness = (v - 1) / 9; saveAimTrainingOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Duration', aimTrainingOptions.durationSec === null ? 11 : Math.round(aimTrainingOptions.durationSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { aimTrainingOptions.durationSec = v >= 11 ? null : v * 60; saveAimTrainingOptions(); }
  ));

  return wrap;
}

// descEl's text is kept in sync with the slider so the card's stated bubble size never drifts
// from the value it'll actually be started with (the description text embeds the meter figure).
function buildMergeDrillControls(descEl: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Bubble Size', mergeDrillOptions.rangeBubbleRadius, 10, 1000, 10,
    v => `${v}m`,
    v => {
      mergeDrillOptions.rangeBubbleRadius = v;
      saveMergeDrillOptions();
      descEl.textContent = buildMergeDrillScenario(mergeDrillOptions).description;
    }
  ));

  return wrap;
}

// descEl's text is kept in sync with the return-fire checkbox, same convention as
// buildMergeDrillControls.
function buildEvasivePilotControls(descEl: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Duration', evasivePilotOptions.durationSec === null ? 11 : Math.round(evasivePilotOptions.durationSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { evasivePilotOptions.durationSec = v >= 11 ? null : v * 60; saveEvasivePilotOptions(); }
  ));
  wrap.appendChild(checkboxRow(
    'Return fire', evasivePilotOptions.returnFire,
    v => {
      evasivePilotOptions.returnFire = v;
      saveEvasivePilotOptions();
      descEl.textContent = buildEvasivePilotScenario(evasivePilotOptions).description;
    }
  ));

  return wrap;
}

// descEl's text is kept in sync with the turn-speed lever, same convention as buildMergeDrillControls.
function buildTurretDrillControls(descEl: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Turn Speed', Math.round(turretDrillOptions.turnRateScale * 100), 10, 150, 5,
    v => `${v}%`,
    v => {
      turretDrillOptions.turnRateScale = v / 100;
      saveTurretDrillOptions();
      descEl.textContent = buildTurretDrillScenario(turretDrillOptions).description;
    }
  ));

  return wrap;
}

// Speed/Randomness/Hold Time/Duration knobs for the PIP Trainer card — see combat/pipTrainer.ts.
function buildPipTrainerControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Speed', pipTrainerOptions.speed, 20, 400, 5,
    v => `${v} m/s`,
    v => { pipTrainerOptions.speed = v; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Randomness', Math.round(pipTrainerOptions.randomness * 9) + 1, 1, 10, 1,
    v => `${v}/10`,
    v => { pipTrainerOptions.randomness = (v - 1) / 9; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Hold Time', Math.round(pipTrainerOptions.holdDurationSec * 1000), 1, 2000, 1,
    v => v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v}ms`,
    v => { pipTrainerOptions.holdDurationSec = v / 1000; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Avoid Radius', pipTrainerOptions.avoidDegrees, 0, 25, 1,
    v => v === 0 ? 'Off' : `${v}°`,
    v => { pipTrainerOptions.avoidDegrees = v; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Duration', pipTrainerOptions.durationSec === null ? 11 : Math.round(pipTrainerOptions.durationSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { pipTrainerOptions.durationSec = v >= 11 ? null : v * 60; savePipTrainerOptions(); }
  ));

  return wrap;
}

// Direction + degree checkboxes, plus Speed/Time Limit/Lap Time levers — see combat/rollTrainer.ts.
// The four degree checkboxes are disabled (but left visible/checked) whenever Random Degree is on,
// since that option ignores them entirely.
function buildRollTrainerControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  const checkRow = document.createElement('div');
  checkRow.className = 'scenario-checkbox-block';

  const leftRow = checkboxRow('Left', rollTrainerOptions.allowLeft,
    v => { rollTrainerOptions.allowLeft = v; saveRollTrainerOptions(); });
  const rightRow = checkboxRow('Right', rollTrainerOptions.allowRight,
    v => { rollTrainerOptions.allowRight = v; saveRollTrainerOptions(); });

  const degreeRows: { row: HTMLElement; key: 'allow45' | 'allow90' | 'allow180' | 'allow270' }[] = [
    { row: checkboxRow('45°', rollTrainerOptions.allow45, v => { rollTrainerOptions.allow45 = v; saveRollTrainerOptions(); }), key: 'allow45' },
    { row: checkboxRow('90°', rollTrainerOptions.allow90, v => { rollTrainerOptions.allow90 = v; saveRollTrainerOptions(); }), key: 'allow90' },
    { row: checkboxRow('180°', rollTrainerOptions.allow180, v => { rollTrainerOptions.allow180 = v; saveRollTrainerOptions(); }), key: 'allow180' },
    { row: checkboxRow('270°', rollTrainerOptions.allow270, v => { rollTrainerOptions.allow270 = v; saveRollTrainerOptions(); }), key: 'allow270' }
  ];

  function setDegreeRowsDisabled(disabled: boolean): void {
    for (const { row } of degreeRows) {
      const input = row.querySelector('input') as HTMLInputElement;
      input.disabled = disabled;
      row.classList.toggle('disabled', disabled);
    }
  }

  const randomRow = checkboxRow('Random Degree', rollTrainerOptions.randomDegree, v => {
    rollTrainerOptions.randomDegree = v;
    saveRollTrainerOptions();
    setDegreeRowsDisabled(v);
  });
  setDegreeRowsDisabled(rollTrainerOptions.randomDegree);

  checkRow.appendChild(leftRow);
  checkRow.appendChild(rightRow);
  checkRow.appendChild(randomRow);
  for (const { row } of degreeRows) checkRow.appendChild(row);
  wrap.appendChild(checkRow);

  wrap.appendChild(sliderRow(
    'Time Limit', Math.round(rollTrainerOptions.matchTimeSec * 10), 5, 100, 1,
    v => `${(v / 10).toFixed(1)}s`,
    v => { rollTrainerOptions.matchTimeSec = v / 10; saveRollTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Speed', rollTrainerOptions.speedStart, 0, 20, 1,
    v => `${v}`,
    v => { rollTrainerOptions.speedStart = v; saveRollTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Lap Time', rollTrainerOptions.lapTimeSec === null ? 11 : Math.round(rollTrainerOptions.lapTimeSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { rollTrainerOptions.lapTimeSec = v >= 11 ? null : v * 60; saveRollTrainerOptions(); }
  ));

  return wrap;
}

function renderList(): void {
  list.innerHTML = '';

  const freeFlightCard = document.createElement('div');
  freeFlightCard.className = 'scenario-card';
  freeFlightCard.innerHTML = '<h3>Free Flight</h3><p>No opponents — open sandbox flying.</p>';
  const freeBtn = document.createElement('button');
  freeBtn.textContent = 'START';
  freeBtn.addEventListener('click', () => {
    hideOverlay();
    handlers.startFreeFlight(world);
  });
  freeFlightCard.appendChild(freeBtn);
  list.appendChild(freeFlightCard);

  // Not a ScenarioConfig — a bare, physically-damped ESP-style PIP to flick/track onto, with no
  // ship, hull, or health involved at all. See combat/pipTrainer.ts for why this is deliberately
  // separate from the ship-based drills below.
  const pipTrainerCard = document.createElement('div');
  pipTrainerCard.className = 'scenario-card';
  pipTrainerCard.innerHTML =
    '<h3>PIP Trainer</h3><p>A single ESP-style PIP jinks around in front of you with no ship attached to it — ' +
    'just pure tracking practice. It actively flees your crosshair rather than sitting still or drifting onto it, ' +
    'so you have to chase it down. Keep your nose on it continuously for the configured hold time to score a rep, ' +
    'then it immediately jinks again.</p>';
  pipTrainerCard.appendChild(buildPipTrainerControls());
  const pipTrainerBtn = document.createElement('button');
  pipTrainerBtn.textContent = 'START';
  pipTrainerBtn.addEventListener('click', () => {
    hideOverlay();
    handlers.startPipTrainer(world, pipTrainerOptions);
  });
  pipTrainerCard.appendChild(pipTrainerBtn);
  list.appendChild(pipTrainerCard);

  // Also not a ScenarioConfig — a translucent ghost hull holds a target bank angle 50m off your
  // nose; roll to match it before time runs out. See combat/rollTrainer.ts.
  const rollTrainerCard = document.createElement('div');
  rollTrainerCard.className = 'scenario-card';
  rollTrainerCard.innerHTML =
    '<h3>Roll Trainer</h3><p>A ghost ship holds station 50m ahead, banked at a target roll angle — ' +
    'roll your own ship to match it and stop before the time limit runs out. Perfectness (how close ' +
    'you land) is scored, multiplied by a speed rating that climbs by one every time you land a perfect ' +
    'roll, so later reps are worth more than early ones.</p>';
  rollTrainerCard.appendChild(buildRollTrainerControls());
  const rollTrainerBtn = document.createElement('button');
  rollTrainerBtn.textContent = 'START';
  rollTrainerBtn.addEventListener('click', () => {
    hideOverlay();
    handlers.startRollTrainer(world, rollTrainerOptions);
  });
  rollTrainerCard.appendChild(rollTrainerBtn);
  list.appendChild(rollTrainerCard);

  for (const config of SCENARIOS) {
    const isAimTraining = config.id === 'aim-training';
    const isMergeDrill = config.id === 'merge-drill';
    const isEvasivePilot = config.id === 'evasive-pilot';
    const isTurretDrill = config.id === 'turret-drill';
    // merge-drill/evasive-pilot/turret-drill's description embeds the configured options, so it's
    // rebuilt from the player's saved options rather than using the default-built SCENARIOS entry as-is.
    const displayConfig = isMergeDrill ? buildMergeDrillScenario(mergeDrillOptions)
      : isEvasivePilot ? buildEvasivePilotScenario(evasivePilotOptions)
      : isTurretDrill ? buildTurretDrillScenario(turretDrillOptions)
      : config;
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.innerHTML = `<h3>${displayConfig.name}</h3><p>${displayConfig.description}</p>`;
    if (isAimTraining) card.appendChild(buildAimTrainingControls());
    if (isMergeDrill) card.appendChild(buildMergeDrillControls(card.querySelector('p') as HTMLElement));
    if (isEvasivePilot) card.appendChild(buildEvasivePilotControls(card.querySelector('p') as HTMLElement));
    if (isTurretDrill) card.appendChild(buildTurretDrillControls(card.querySelector('p') as HTMLElement));
    const btn = document.createElement('button');
    btn.textContent = 'START';
    btn.addEventListener('click', () => {
      hideOverlay();
      handlers.startScenario(
        world,
        isAimTraining ? buildAimTrainingScenario(aimTrainingOptions)
          : isMergeDrill ? buildMergeDrillScenario(mergeDrillOptions)
          : isEvasivePilot ? buildEvasivePilotScenario(evasivePilotOptions)
          : isTurretDrill ? buildTurretDrillScenario(turretDrillOptions)
          : config
      );
    });
    card.appendChild(btn);
    list.appendChild(card);
  }
}

export function showPicker(): void {
  picker.style.display = 'block';
  resultEl.style.display = 'none';
  resultEl.className = '';
  subtitleEl.style.display = '';
  mainMenuLinksEl.style.display = '';
  renderList();
}

export function initScenarioMenu(w: World, h: ScenarioMenuHandlers, hide: () => void): void {
  world = w;
  handlers = h;
  hideOverlay = hide;
  picker = document.getElementById('scenario-menu-picker') as HTMLElement;
  list = document.getElementById('scenario-menu-list') as HTMLElement;
  resultEl = document.getElementById('scenario-menu-result') as HTMLElement;
  subtitleEl = document.getElementById('main-menu-subtitle') as HTMLElement;
  mainMenuLinksEl = document.getElementById('main-menu-links') as HTMLElement;
}

// Hides the source/feedback link row and subtitle for the results view — RETRY/BACK TO MENU
// (appended below in showScenarioResult/showPipTrainerResult) already cover both, so repeating
// them read as clutter right above the outcome text.
function hideMenuLinksRow(): void {
  subtitleEl.style.display = 'none';
  mainMenuLinksEl.style.display = 'none';
}

export function showScenarioResult(
  outcome: 'won' | 'lost',
  config: ScenarioConfig,
  failReason?: 'died' | 'missedGate' | 'timeout',
  stats?: { shotsFired: number; hitsLanded: number; kills: number; hitsTaken: number },
  bubbleTicks?: number // Merge Drill's "100ms ticks spent in range" count — see scenarios/runtime.ts
): void {
  picker.style.display = 'none';
  resultEl.style.display = 'block';
  resultEl.className = outcome;
  hideMenuLinksRow();

  const isGates = config.winCondition === 'gates';
  const isSurvive = config.winCondition === 'survive';
  let title: string;
  let detail: string;
  if (outcome === 'won') {
    title = isGates ? 'MANEUVER COMPLETE' : isSurvive ? 'DRILL COMPLETE' : 'TARGET DESTROYED';
    detail = `${config.name} — training complete.`;
  } else if (failReason === 'missedGate') {
    title = 'GATE MISSED';
    detail = `${config.name} — flew past a gate outside its ring.`;
  } else if (failReason === 'timeout') {
    title = 'TIME EXPIRED';
    detail = `${config.name} — didn't clear the course in time.`;
  } else {
    title = 'YOU WERE DESTROYED';
    detail = `${config.name} — you took ${config.hitsToKillPlayer} hits.`;
  }
  if (stats && stats.shotsFired > 0) {
    const accuracy = Math.round((stats.hitsLanded / stats.shotsFired) * 100);
    detail += ` Accuracy: ${accuracy}% (${stats.hitsLanded}/${stats.shotsFired}).`;
    if (isSurvive) detail += ` Kills: ${stats.kills}.`;
  }
  if (stats && config.evasiveReturnFire) detail += ` Hits taken: ${stats.hitsTaken}.`;
  if (config.rangeBubbleRadius !== undefined && bubbleTicks !== undefined) {
    detail += ` In range: ${bubbleTicks} (${(bubbleTicks / 10).toFixed(1)}s).`;
  }
  resultEl.innerHTML = `<h2>${title}</h2><p class="scenario-result-detail">${detail}</p>`;

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'RETRY';
  retryBtn.addEventListener('click', () => {
    hideOverlay();
    handlers.startScenario(world, config);
  });
  const menuBtn = document.createElement('button');
  menuBtn.textContent = 'BACK TO MENU';
  menuBtn.addEventListener('click', showPicker);

  resultEl.appendChild(retryBtn);
  resultEl.appendChild(menuBtn);
}

// Edge-triggers showScenarioResult the instant a scenario's outcome leaves 'active' — called every
// frame from main.ts. Tracks the last ScenarioRuntime object it already reported on so a result
// isn't shown twice for the same run (e.g. across multiple frames before the player backs out).
let lastReportedScenario: ScenarioRuntime | null = null;

export function checkScenarioResult(w: World): void {
  const runtime = w.scenario;
  if (!runtime || runtime.outcome === 'active') {
    if (!runtime) lastReportedScenario = null;
    return;
  }
  if (runtime === lastReportedScenario) return;
  lastReportedScenario = runtime;

  const bubbleTicks = runtime.config.rangeBubbleRadius !== undefined
    ? Math.floor(runtime.bubbleTimeSec / 0.1)
    : undefined;
  showScenarioResult(runtime.outcome, runtime.config, runtime.failReason, runtime.stats, bubbleTicks);
  notifyScenarioResult();
}

export function showPipTrainerResult(state: PipTrainerState, opts: PipTrainerOptions): void {
  picker.style.display = 'none';
  resultEl.style.display = 'block';
  resultEl.className = 'won'; // PIP Trainer has no lose state — it only ends by running out the clock
  hideMenuLinksRow();

  const perMinute = state.elapsedSec > 0 ? (state.reps / state.elapsedSec) * 60 : 0;
  const scoreLine = `Score: ${state.reps} reps (${perMinute.toFixed(1)}/min over ${state.elapsedSec.toFixed(1)}s).`;

  // Echo back the exact settings the run used — same formatting conventions as the slider labels
  // in buildPipTrainerControls, so this reads as "here's what you ran," not a different unit system.
  const holdMs = Math.round(opts.holdDurationSec * 1000);
  const holdLabel = holdMs >= 1000 ? `${(holdMs / 1000).toFixed(2)}s` : `${holdMs}ms`;
  const randomnessLabel = `${Math.round(opts.randomness * 9) + 1}/10`;
  const avoidLabel = opts.avoidDegrees === 0 ? 'Off' : `${opts.avoidDegrees}°`;
  const durationLabel = opts.durationSec === null ? 'Indefinite' : `${Math.round(opts.durationSec / 60)} min`;
  const settingsLine = `Speed: ${opts.speed} m/s &middot; Randomness: ${randomnessLabel} &middot; ` +
    `Hold Time: ${holdLabel} &middot; Avoid Radius: ${avoidLabel} &middot; Duration: ${durationLabel}`;

  resultEl.innerHTML =
    `<h2>DRILL COMPLETE</h2>` +
    `<p class="scenario-result-detail">${scoreLine}</p>` +
    `<p class="scenario-result-detail" style="font-size:11px">${settingsLine}</p>`;

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'RETRY';
  retryBtn.addEventListener('click', () => {
    hideOverlay();
    handlers.startPipTrainer(world, opts);
  });
  const menuBtn = document.createElement('button');
  menuBtn.textContent = 'BACK TO MENU';
  menuBtn.addEventListener('click', showPicker);

  resultEl.appendChild(retryBtn);
  resultEl.appendChild(menuBtn);
}

// Edge-triggers showPipTrainerResult once a PIP Trainer run's outcome leaves 'active' — same
// last-reported tracking convention as checkScenarioResult, called every frame from main.ts.
let lastReportedPipTrainer: PipTrainerState | null = null;

export function checkPipTrainerResult(w: World): void {
  const state = w.pipTrainer;
  if (!state || state.outcome === 'active') {
    if (!state) lastReportedPipTrainer = null;
    return;
  }
  if (state === lastReportedPipTrainer) return;
  lastReportedPipTrainer = state;

  showPipTrainerResult(state, state.opts);
  notifyScenarioResult();
}

export function showRollTrainerResult(state: RollTrainerState, opts: RollTrainerOptions): void {
  picker.style.display = 'none';
  resultEl.style.display = 'block';
  resultEl.className = 'won'; // Roll Trainer has no lose state — it only ends by running out the clock
  hideMenuLinksRow();

  const scoreLine = `Score: ${state.score.toFixed(1)} — ${state.perfectReps} perfect, ${state.goodReps} good, ` +
    `of ${state.reps} rolls over ${state.elapsedSec.toFixed(1)}s (speed reached ${state.speedMultiplier}).`;

  // Echo back the exact settings the run used — same convention as showPipTrainerResult.
  const dirLabel = opts.allowLeft && opts.allowRight ? 'Left/Right' : opts.allowLeft ? 'Left' : 'Right';
  const degreeLabel = opts.randomDegree ? 'Random' : [
    opts.allow45 && '45°', opts.allow90 && '90°', opts.allow180 && '180°', opts.allow270 && '270°'
  ].filter(Boolean).join('/') || 'Random';
  const lapTimeLabel = opts.lapTimeSec === null ? 'Indefinite' : `${Math.round(opts.lapTimeSec / 60)} min`;
  const settingsLine = `Directions: ${dirLabel} &middot; Degrees: ${degreeLabel} &middot; ` +
    `Time Limit: ${opts.matchTimeSec.toFixed(1)}s &middot; Speed: ${opts.speedStart} &middot; Lap Time: ${lapTimeLabel}`;

  resultEl.innerHTML =
    `<h2>DRILL COMPLETE</h2>` +
    `<p class="scenario-result-detail">${scoreLine}</p>` +
    `<p class="scenario-result-detail" style="font-size:11px">${settingsLine}</p>`;

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'RETRY';
  retryBtn.addEventListener('click', () => {
    hideOverlay();
    handlers.startRollTrainer(world, opts);
  });
  const menuBtn = document.createElement('button');
  menuBtn.textContent = 'BACK TO MENU';
  menuBtn.addEventListener('click', showPicker);

  resultEl.appendChild(retryBtn);
  resultEl.appendChild(menuBtn);
}

// Edge-triggers showRollTrainerResult once a Roll Trainer run's outcome leaves 'active' — same
// last-reported tracking convention as checkPipTrainerResult, called every frame from main.ts.
let lastReportedRollTrainer: RollTrainerState | null = null;

export function checkRollTrainerResult(w: World): void {
  const state = w.rollTrainer;
  if (!state || state.outcome === 'active') {
    if (!state) lastReportedRollTrainer = null;
    return;
  }
  if (state === lastReportedRollTrainer) return;
  lastReportedRollTrainer = state;

  showRollTrainerResult(state, state.opts);
  notifyScenarioResult();
}
