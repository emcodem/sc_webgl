import type { World, EnemyShip, ShipBody } from '../core/world';
import { length, sub, clamp } from '../math/vec';
import { getStatusMessage } from '../control/mode';
import * as Input from '../input/input';
import { computeAxes } from '../math/quaternion';
import { project, type Camera } from '../combat/projection';
import { findActivePip } from '../combat/pipTargeting';
import * as MouseLook from '../input/mouseLook';
import * as EspAssist from '../combat/espAssist';
import { bubbleTicks } from '../scenarios/runtime';
import { SCORE_FLASH_DURATION, type PipTrainerState } from '../combat/pipTrainer';

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

const hudCanvasEl = document.getElementById('hud-canvas') as HTMLCanvasElement;
const hudCtx = hudCanvasEl.getContext('2d');

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
  updatePipTrainerMarker(world);
  updateFlightRings(world);
  updateHudCanvas(world);

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
    statsModeEl.style.display = 'block';
    statsModeEl.textContent = 'SHIP DESTROYED';
    el('s-respawn').textContent = `${ship.respawnTimer.toFixed(1)}s`;
    return;
  }

  if (showFoot) {
    statsModeEl.style.display = 'block';
    statsModeEl.textContent = 'ON FOOT — EVA';
    const speed = length(p.charVel);
    el('s-ground').textContent = p.groundBody ? p.groundBody.name : '— (zero-g)';
    (el('s-foot-speed')).textContent = `${speed.toFixed(1)} m/s`;
    const stanceEl = el('s-stance');
    stanceEl.textContent = p.onGround ? 'GROUNDED' : 'AIRBORNE';
    stanceEl.className = p.onGround ? 'value on' : 'value';
    return;
  }

  // The "PILOTING — <SHIP>" banner is redundant (the SHIP row below already names it), so it's
  // hidden while flying — the panel leads straight into the flight readout.
  statsModeEl.style.display = 'none';

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

// Predicted-impact-point reticle: independently recomputes findActivePip with the same inputs the
// ESP damping in control/pilot.ts uses, so the drawn diamond always matches what's actually steering
// the crosshair assist (the call is cheap — O(enemies) — so it isn't worth threading a shared result
// across modules). Ported from the original project's render/render.ts::drawPip, moved from a 2D
// canvas draw call to a positioned DOM element since this HUD is DOM, not canvas.
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

// PIP Trainer's bare target diamond — deliberately reuses #pip-marker's exact fixed-pixel-size
// CSS (see style.css) rather than a 3D world-space mesh, so there's exactly one "PIP" look in the
// game and its size never depends on how far the target actually is (a world-space mesh, even one
// rescaled by distance every frame, is a second reimplementation of the same idea — this is the
// real one). Projects the pip's world position with the same combat/projection.ts::project used
// for the real combat PIP above.
function updatePipTrainerMarker(world: World): void {
  const state = world.pipTrainer;
  if (!state || world.player.mode !== 'pilot') {
    pipTrainerMarkerEl.style.display = 'none';
    return;
  }
  const ship = world.player.ship;
  const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
  const p = project(state.pos.x, state.pos.y, state.pos.z, cam, window.innerWidth, window.innerHeight);
  if (!p) {
    pipTrainerMarkerEl.style.display = 'none';
    return;
  }
  pipTrainerMarkerEl.style.display = 'block';
  pipTrainerMarkerEl.style.left = `${p.x}px`;
  pipTrainerMarkerEl.style.top = `${p.y}px`;
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
  if (world.pipTrainer) drawPipTrainerRing(ctx, world.pipTrainer, cam, W, H);
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

// Edge arrow for a target that's off-screen or behind the camera: recomputes the target's
// camera-space direction (mirroring both axes when it's behind, so the arrow points the way you
// must actually turn), clamps a ray from screen center to the inner edge rectangle (inset by
// EDGE_INDICATOR_MARGIN), and draws a triangle arrowhead plus a distance label there.
function drawOffscreenArrow(ctx: CanvasRenderingContext2D, pos: { x: number; y: number; z: number }, cam: Camera, W: number, H: number, arrowColor: string, labelColor: string): void {
  const cx = W / 2, cy = H / 2;
  const halfW = cx - EDGE_INDICATOR_MARGIN, halfH = cy - EDGE_INDICATOR_MARGIN;
  const { forward, right, up } = cam.axes;

  const p = project(pos.x, pos.y, pos.z, cam, W, H);
  const onScreen = p !== null && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
  if (onScreen) return;

  const dx = pos.x - cam.pos.x, dy = pos.y - cam.pos.y, dz = pos.z - cam.pos.z;
  const camX = dx * right.x + dy * right.y + dz * right.z;
  const camY = dx * up.x + dy * up.y + dz * up.z;
  const camZ = dx * forward.x + dy * forward.y + dz * forward.z;

  let dirX = camX, dirY = -camY;
  if (camZ < 0) { dirX = -dirX; dirY = -dirY; }
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
