import type { World, EnemyShip, Projectile, ShipBody, VisualEffect } from '../core/world';
import type { Quat, Vec3 } from '../core/types';
import type { ReplayClip, ReplayEntitySnapshot, ReplayFrame } from './types';
import { getShipType, tryGetShipType, DEFAULT_SHIP_TYPE_ID } from '../physics/ships';
import { lerp } from '../math/vec';
import { slerp } from '../math/quaternion';
import { createHealth } from '../combat/health';
import { WEAPON } from '../combat/weapons';
import { EXPLOSION_DURATION, IMPACT_DURATION } from '../combat/effects';

// ============================================================================================
// Replay playback — reuses the existing render/HUD pipeline instead of a parallel one: each frame
// this overwrites world.player.ship / world.enemies[] fields directly, the same fields
// render/renderer.ts and hud/hud.ts already read every frame for live flight. Matches this
// project's "mode over shared state, never a scene swap" principle (see CLAUDE.md). main.ts
// substitutes stepPlayback() for the normal stepPilot/stepCombat block while isActive().
// ============================================================================================

let clip: ReplayClip | null = null;
let clockSec = 0;
let playing = false;
let speed = 1;

export function isActive(): boolean {
  return clip !== null;
}
export function isPlaying(): boolean {
  return clip !== null && playing;
}
export function getSpeed(): number {
  return speed;
}
export function setSpeed(x: number): void {
  speed = x;
}
export function getClockSec(): number {
  return clockSec;
}
export function getDurationSec(): number {
  if (!clip || clip.frames.length === 0) return 0;
  return clip.frames[clip.frames.length - 1].simTime;
}

function findShipType(id: string) {
  return tryGetShipType(id) ?? getShipType(DEFAULT_SHIP_TYPE_ID);
}

// A minimally-valid EnemyShip to hold interpolated playback state — never touched by AI/combat
// (those only run outside replay), just written into every frame by applyToEnemy below.
function makePlaceholderEnemy(shipTypeId: string): EnemyShip {
  const type = findShipType(shipTypeId);
  return {
    type,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: type.boostCapacity,
    boosting: false,
    boostCooldownTimer: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(100), // fine-grained enough that healthFrac rounding never spuriously hits 0
    behavior: 'cruiser',
    fireCooldown: 0,
    respawnTimer: 0,
    spawnPos: { x: 0, y: 0, z: 0 },
    spawnQuat: { x: 0, y: 0, z: 0, w: 1 }
  };
}

// Loads a clip and immediately rebuilds world.enemies to match its (fixed-size, index-stable)
// enemy count — a fresh array reference so render/renderer.ts's `world.enemies !== currentEnemyList`
// check rebuilds meshes for it, same as any scenario switch. Clears scenario/pipTrainer so their
// HUD panels don't show stale state from whatever was running before playback started.
export function loadClip(world: World, replay: ReplayClip): void {
  world.scenario = null;
  world.pipTrainer = null;

  clip = replay;
  clockSec = 0;
  playing = true;
  speed = 1;

  const firstFrame = replay.frames[0] as ReplayFrame | undefined;
  const enemyCount = firstFrame ? firstFrame.enemies.length : 0;
  const enemies: EnemyShip[] = [];
  for (let i = 0; i < enemyCount; i++) {
    const snap = firstFrame!.enemies[i];
    enemies.push(makePlaceholderEnemy(snap ? snap.shipTypeId : DEFAULT_SHIP_TYPE_ID));
  }
  world.enemies = enemies;

  applyFrame(world, sampleAt(0));
  applyEvents(world, 0);
}

export function stop(): void {
  clip = null;
  playing = false;
}
export function play(): void {
  if (clip) playing = true;
}
export function pause(): void {
  playing = false;
}
export function seek(t: number): void {
  if (!clip) return;
  clockSec = Math.max(0, Math.min(getDurationSec(), t));
}

export function stepPlayback(world: World, dt: number): void {
  if (!clip) return;
  if (playing) {
    clockSec = Math.min(getDurationSec(), clockSec + dt * speed);
    if (clockSec >= getDurationSec()) playing = false;
  }
  applyFrame(world, sampleAt(clockSec));
  applyEvents(world, clockSec);
}

// Binary-searches the bracketing pair of frames around `t`, returning them plus the interpolation
// fraction between them. Clamps to the first/last frame rather than extrapolating past either end.
function findBracket(frames: ReplayFrame[], t: number): [ReplayFrame, ReplayFrame, number] {
  const last = frames.length - 1;
  if (last <= 0 || t <= frames[0].simTime) return [frames[0], frames[0], 0];
  if (t >= frames[last].simTime) return [frames[last], frames[last], 0];
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].simTime <= t) lo = mid; else hi = mid;
  }
  const a = frames[lo], b = frames[hi];
  const span = b.simTime - a.simTime;
  return [a, b, span > 1e-9 ? (t - a.simTime) / span : 0];
}

// A gap on either side (entity dead/despawned in one of the two bracketing frames) snaps to
// whichever side is closer rather than interpolating through the gap.
function lerpEntity(a: ReplayEntitySnapshot | null, b: ReplayEntitySnapshot | null, t: number): ReplayEntitySnapshot | null {
  if (!a || !b) return t < 0.5 ? a : b;
  return {
    shipTypeId: a.shipTypeId,
    pos: lerp(a.pos, b.pos, t),
    quat: slerp(a.quat, b.quat, t),
    vel: lerp(a.vel, b.vel, t),
    angVel: {
      pitch: a.angVel.pitch + (b.angVel.pitch - a.angVel.pitch) * t,
      yaw: a.angVel.yaw + (b.angVel.yaw - a.angVel.yaw) * t,
      roll: a.angVel.roll + (b.angVel.roll - a.angVel.roll) * t
    },
    healthFrac: a.healthFrac + (b.healthFrac - a.healthFrac) * t,
    boosting: t < 0.5 ? a.boosting : b.boosting,
    inputs: t < 0.5 ? a.inputs : b.inputs
  };
}

interface Sampled {
  player: ReplayEntitySnapshot;
  enemies: (ReplayEntitySnapshot | null)[];
}

function sampleAt(t: number): Sampled | null {
  if (!clip || clip.frames.length === 0) return null;
  const [a, b, frac] = findBracket(clip.frames, t);
  const enemyCount = Math.max(a.enemies.length, b.enemies.length);
  const enemies: (ReplayEntitySnapshot | null)[] = [];
  for (let i = 0; i < enemyCount; i++) {
    enemies.push(lerpEntity(a.enemies[i] ?? null, b.enemies[i] ?? null, frac));
  }
  // player is never null — recording only samples while the ship is live/flyable (see
  // main.ts's controlsLive gate), so both bracketing frames always have a player snapshot.
  return { player: lerpEntity(a.player, b.player, frac)!, enemies };
}

function applyToShip(ship: ShipBody, snap: ReplayEntitySnapshot): void {
  ship.pos = { x: snap.pos.x, y: snap.pos.y, z: snap.pos.z };
  ship.quat = { x: snap.quat.x, y: snap.quat.y, z: snap.quat.z, w: snap.quat.w };
  ship.vel = { x: snap.vel.x, y: snap.vel.y, z: snap.vel.z };
  ship.angVel = { pitch: snap.angVel.pitch, yaw: snap.angVel.yaw, roll: snap.angVel.roll };
  ship.boosting = snap.boosting;
  ship.health.points = Math.round(snap.healthFrac * ship.health.maxPoints);
  ship.respawnTimer = 0;
  if (snap.inputs) {
    // cheap fidelity win for the HUD's throttle bar / decoupled+brake indicators during playback
    ship.throttle = snap.inputs.throttle;
    ship.decoupled = snap.inputs.decoupled;
    ship.spaceBrakeOn = snap.inputs.brake;
  }
}

function applyToEnemy(enemy: EnemyShip, snap: ReplayEntitySnapshot | null): void {
  if (!snap) {
    enemy.health.points = 0; // renderer/HUD already hide a dead enemy on this same condition
    enemy.respawnTimer = 0;
    return;
  }
  enemy.pos = { x: snap.pos.x, y: snap.pos.y, z: snap.pos.z };
  enemy.quat = { x: snap.quat.x, y: snap.quat.y, z: snap.quat.z, w: snap.quat.w };
  enemy.vel = { x: snap.vel.x, y: snap.vel.y, z: snap.vel.z };
  enemy.angVel = { pitch: snap.angVel.pitch, yaw: snap.angVel.yaw, roll: snap.angVel.roll };
  enemy.boosting = snap.boosting;
  enemy.health.points = Math.max(1, Math.round(snap.healthFrac * enemy.health.maxPoints));
  enemy.respawnTimer = 0;
}

function applyFrame(world: World, sampled: Sampled | null): void {
  if (!sampled) return;
  applyToShip(world.player.ship, sampled.player);
  for (let i = 0; i < sampled.enemies.length; i++) {
    const enemy = world.enemies[i];
    if (enemy) applyToEnemy(enemy, sampled.enemies[i]);
  }
}

// ---------- Weapon fire / impact / explosion playback ----------
// Both event kinds are fully analytic (constant-velocity projectile, countdown-timer effect), so
// rather than incrementally simulating world.projectiles/world.effects forward frame by frame (which
// would need special-casing every time the user scrubs backward or jumps), every call just rebuilds
// both arrays from scratch from whichever recorded events are actually "in flight" at `t` — cheap and
// scrub-safe, no persisted mid-flight state to get out of sync.
const MAX_EVENT_VISIBLE_DURATION = Math.max(WEAPON.lifetime, EXPLOSION_DURATION, IMPACT_DURATION);

// First index whose simTime >= t — both clip.events and clip.frames are simTime-ordered (see
// replay/recorder.ts), so a window of [that index .. first index whose simTime > t] bounds
// everything that could possibly still matter at `t`, regardless of how long the overall clip is.
function lowerBound<T extends { simTime: number }>(items: T[], t: number): number {
  let lo = 0, hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].simTime < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function applyEvents(world: World, t: number): void {
  const projectiles: Projectile[] = [];
  const effects: VisualEffect[] = [];
  if (clip) {
    const start = lowerBound(clip.events, t - MAX_EVENT_VISIBLE_DURATION);
    for (let i = start; i < clip.events.length; i++) {
      const ev = clip.events[i];
      if (ev.simTime > t) break;
      if (ev.kind === 'fire') {
        if (t > ev.endSimTime) continue;
        const age = t - ev.simTime;
        const pos = { x: ev.pos.x + ev.vel.x * age, y: ev.pos.y + ev.vel.y * age, z: ev.pos.z + ev.vel.z * age };
        projectiles.push({ pos, prevPos: { ...pos }, vel: { ...ev.vel }, age, owner: ev.owner });
      } else {
        const duration = ev.kind === 'explosion' ? EXPLOSION_DURATION : IMPACT_DURATION;
        const age = t - ev.simTime;
        if (age > duration) continue;
        effects.push({
          kind: ev.kind,
          pos: { ...ev.pos },
          normal: ev.normal ? { ...ev.normal } : undefined,
          timer: duration - age,
          maxTimer: duration
        });
      }
    }
  }
  world.projectiles = projectiles;
  world.effects = effects;
}

// ---------- Movement trail query (render/renderer.ts's flat "roll band" while reviewing a replay) ----------
// Read-only: hands back recorded (pos, quat) history for the trailing `windowSec` seconds ending at
// the CURRENT playback clock — the renderer appends today's live interpolated position itself (it
// already has it) and builds the actual ribbon geometry; this just answers "what were the samples."
export interface TrailPoint {
  pos: Vec3;
  quat: Quat;
}

// A dead/despawned gap partway through the window (entity destroyed then respawned) drops
// everything recorded before the gap — a ribbon should never bridge across a teleport.
function collectTrail(pick: (f: ReplayFrame) => ReplayEntitySnapshot | null, windowSec: number): TrailPoint[] {
  if (!clip) return [];
  const tStart = clockSec - windowSec;
  const startIdx = lowerBound(clip.frames, tStart);
  let points: TrailPoint[] = [];
  for (let i = startIdx; i < clip.frames.length; i++) {
    const f = clip.frames[i];
    if (f.simTime > clockSec) break;
    const snap = pick(f);
    if (!snap) { points = []; continue; }
    points.push({ pos: snap.pos, quat: snap.quat });
  }
  return points;
}

export function getPlayerTrail(windowSec: number): TrailPoint[] {
  return collectTrail(f => f.player, windowSec);
}

export function getEnemyTrail(index: number, windowSec: number): TrailPoint[] {
  return collectTrail(f => f.enemies[index] ?? null, windowSec);
}
