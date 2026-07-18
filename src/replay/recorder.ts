import type { World, EnemyShip, Projectile, ShipBody, VisualEffect } from '../core/world';
import type { FlightInputs } from '../physics/flightModel';
import { WEAPON } from '../combat/weapons';
import type { ReplayClip, ReplayEntitySnapshot, ReplayEvent, ReplayFireEvent, ReplayFrame, ReplayInputs } from './types';
import { REPLAY_SCHEMA_VERSION } from './types';

// ============================================================================================
// Always-on rolling buffer of recent player+enemy ship state (`buffer`) plus a parallel log of
// discrete weapon fire / impact / explosion events (`eventLog`), sampled/observed at a fixed rate
// (SAMPLE_HZ)/every frame respectively, regardless of render framerate. Two ways to get a clip out
// of this one shared stream:
//   - saveLastNSeconds(n): grab the tail retroactively ("save that last pass"), independent of
//     manual recording.
//   - startManualRecording()/stopManualRecording(): pin a start marker and suspend rolling
//     eviction until stopped, for an intentionally-recorded whole session.
// Called from main.ts every live frame while the player is piloting with controls live (see
// main.ts's controlsLive gate) — never while replaying a clip (no recording a replay of a replay).
// ============================================================================================

const SAMPLE_HZ = 20;
const SAMPLE_INTERVAL = 1 / SAMPLE_HZ;

let rollingWindowSec = 300;
let buffer: ReplayFrame[] = [];
let eventLog: ReplayEvent[] = [];
let simClock = 0;
let accumulator = 0;
let manualStartSimTime: number | null = null; // simTime at which the active manual session began

export function setRollingWindowSec(sec: number): void {
  rollingWindowSec = sec;
}
export function getRollingWindowSec(): number {
  return rollingWindowSec;
}

export function isManualRecording(): boolean {
  return manualStartSimTime !== null;
}

// Seconds elapsed since startManualRecording(), for the HUD's REC readout. 0 when not recording.
export function manualRecordingElapsedSec(): number {
  return manualStartSimTime === null ? 0 : simClock - manualStartSimTime;
}

// How much history the rolling buffer currently holds, for the replay panel's "N available" readout.
export function availableSeconds(): number {
  return buffer.length > 0 ? simClock - buffer[0].simTime : 0;
}

function toReplayInputs(inputs: FlightInputs | undefined): ReplayInputs | null {
  if (!inputs) return null;
  return {
    throttle: inputs.throttle, pitch: inputs.pitch, yaw: inputs.yaw, roll: inputs.roll,
    strafeX: inputs.strafeX, strafeY: inputs.strafeY, brake: inputs.brake, decoupled: inputs.decoupled
  };
}

function snapshotShip(ship: ShipBody): ReplayEntitySnapshot {
  return {
    shipTypeId: ship.type.name,
    pos: { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z },
    quat: { x: ship.quat.x, y: ship.quat.y, z: ship.quat.z, w: ship.quat.w },
    vel: { x: ship.vel.x, y: ship.vel.y, z: ship.vel.z },
    angVel: { pitch: ship.angVel.pitch, yaw: ship.angVel.yaw, roll: ship.angVel.roll },
    healthFrac: ship.health.maxPoints > 0 ? ship.health.points / ship.health.maxPoints : 0,
    boosting: ship.boosting,
    inputs: toReplayInputs(ship.lastInputs)
  };
}

function snapshotEnemy(enemy: EnemyShip): ReplayEntitySnapshot | null {
  if (enemy.respawnTimer > 0 || enemy.health.points <= 0) return null;
  return {
    shipTypeId: enemy.type.name,
    pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z },
    quat: { x: enemy.quat.x, y: enemy.quat.y, z: enemy.quat.z, w: enemy.quat.w },
    vel: { x: enemy.vel.x, y: enemy.vel.y, z: enemy.vel.z },
    angVel: { pitch: enemy.angVel.pitch, yaw: enemy.angVel.yaw, roll: enemy.angVel.roll },
    healthFrac: enemy.health.maxPoints > 0 ? enemy.health.points / enemy.health.maxPoints : 0,
    boosting: enemy.boosting,
    inputs: toReplayInputs(enemy.lastInputs)
  };
}

// ---------- Fire/impact/explosion events ----------
// Both are fully analytic (a projectile is constant-velocity, no drag/gravity; an effect is just a
// countdown timer), so only the spawn moment needs recording, not a continuous sample stream —
// replay/player.ts reconstructs everything else from that at whatever scrub time it's asked for.
//
// A fire event's `endSimTime` (when it stops being visible — hit something, or simply outlived
// WEAPON.lifetime) is discovered by noticing the SAME projectile object vanish from world.projectiles
// on a later frame, whichever the reason; there's no need to distinguish "hit" from "expired" since
// either way the recorded endSimTime is exactly when it actually stopped being on screen.
const liveProjectileEvents = new Map<Projectile, ReplayFireEvent>();
const seenEffects = new WeakSet<VisualEffect>();

function recordEvents(world: World): void {
  const stillLive = new Set(world.projectiles);
  for (const [proj, event] of liveProjectileEvents) {
    if (!stillLive.has(proj)) {
      event.endSimTime = simClock;
      liveProjectileEvents.delete(proj);
    }
  }

  for (const p of world.projectiles) {
    if (liveProjectileEvents.has(p)) continue;
    // Back-derive the true muzzle moment/position from the projectile's own age, since by the time
    // this scan sees it (after combatSystem/runtime's updateProjectiles has already advanced it this
    // frame) it's already travelled `age` seconds past its actual spawn point.
    const spawnSimTime = simClock - p.age;
    const event: ReplayFireEvent = {
      kind: 'fire',
      simTime: spawnSimTime,
      endSimTime: spawnSimTime + WEAPON.lifetime, // fallback — corrected above once it's seen to vanish
      owner: p.owner,
      pos: { x: p.pos.x - p.vel.x * p.age, y: p.pos.y - p.vel.y * p.age, z: p.pos.z - p.vel.z * p.age },
      vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z }
    };
    eventLog.push(event);
    liveProjectileEvents.set(p, event);
  }

  for (const e of world.effects) {
    if (seenEffects.has(e)) continue;
    seenEffects.add(e);
    eventLog.push({
      kind: e.kind,
      simTime: simClock,
      pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
      normal: e.normal ? { x: e.normal.x, y: e.normal.y, z: e.normal.z } : undefined
    });
  }
}

// Called every live sim frame from main.ts. Event capture (recordEvents) runs every call — fire/
// impact/explosion are discrete triggers, not something to thin out. Ship-state sampling is
// internally throttled to SAMPLE_HZ regardless of how often this is called, so capture rate never
// depends on render framerate.
export function sampleTick(world: World, dt: number): void {
  simClock += dt;
  recordEvents(world);

  accumulator += dt;
  if (accumulator < SAMPLE_INTERVAL) return;
  accumulator -= SAMPLE_INTERVAL;

  buffer.push({
    simTime: simClock,
    player: snapshotShip(world.player.ship),
    enemies: world.enemies.map(snapshotEnemy)
  });

  if (manualStartSimTime === null) {
    // Rolling eviction — batch-trim rather than shifting one sample/event at a time, so a long play
    // session doesn't pay per-sample Array.shift() cost.
    const cutoff = simClock - rollingWindowSec;
    let dropCount = 0;
    while (dropCount < buffer.length && buffer[dropCount].simTime < cutoff) dropCount++;
    if (dropCount > 0) buffer.splice(0, dropCount);

    let eventDropCount = 0;
    while (eventDropCount < eventLog.length && eventLog[eventDropCount].simTime < cutoff) eventDropCount++;
    if (eventDropCount > 0) eventLog.splice(0, eventDropCount);
  }
}

export function startManualRecording(): void {
  manualStartSimTime = simClock;
}

// Builds a clip from a (frame, event) slice, rebased so the clip's own timeline starts at 0 — at
// the first INCLUDED FRAME's simTime specifically (not the manual-record click moment or the
// save-last-N cutoff), since that's what actually anchors frame 0 of the resulting clip. Events
// that started slightly before that (e.g. a shot fired right as "Start Recording" was clicked, a
// fraction of a sample interval before the first captured frame) end up with a small negative
// simTime — harmless, playback just treats them as already in progress at t=0.
function buildClip(frameSlice: ReplayFrame[], eventSlice: ReplayEvent[]): ReplayClip | null {
  if (frameSlice.length === 0) return null;
  const t0 = frameSlice[0].simTime;
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    sampleHz: SAMPLE_HZ,
    frames: frameSlice.map(f => ({ ...f, simTime: f.simTime - t0 })),
    events: eventSlice.map(e => e.kind === 'fire'
      ? { ...e, simTime: e.simTime - t0, endSimTime: e.endSimTime - t0 }
      : { ...e, simTime: e.simTime - t0 })
  };
}

export function stopManualRecording(): ReplayClip | null {
  if (manualStartSimTime === null) return null;
  const cutoff = manualStartSimTime;
  manualStartSimTime = null;
  return buildClip(
    buffer.filter(f => f.simTime >= cutoff),
    eventLog.filter(e => e.simTime >= cutoff)
  );
}

export function saveLastNSeconds(n: number): ReplayClip | null {
  const cutoff = simClock - n;
  return buildClip(
    buffer.filter(f => f.simTime >= cutoff),
    eventLog.filter(e => e.simTime >= cutoff)
  );
}
