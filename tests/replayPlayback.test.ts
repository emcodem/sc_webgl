import { describe, it, expect } from 'vitest';
import { makeWorld } from '../src/core/player';
import * as ReplayPlayer from '../src/replay/player';
import { REPLAY_SCHEMA_VERSION } from '../src/replay/types';
import type { ReplayClip, ReplayEntitySnapshot, ReplayEvent } from '../src/replay/types';

// Exercises replay/player.ts's interpolated playback: lerp/slerp between two known recorded
// frames at a query simTime, and clamping behavior at the clip's start/end boundaries.

function snap(x: number): ReplayEntitySnapshot {
  return {
    shipTypeId: 'Gladius',
    pos: { x, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    vel: { x: 0, y: 0, z: 0 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    healthFrac: 1,
    boosting: false,
    inputs: null
  };
}

function makeClip(events: ReplayEvent[] = []): ReplayClip {
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    recordedAt: '2026-01-01T00:00:00.000Z',
    sampleHz: 20,
    frames: [
      { simTime: 0, player: snap(0), enemies: [] },
      { simTime: 10, player: snap(100), enemies: [] }
    ],
    events
  };
}

describe('replay playback', () => {
  it('interpolates position linearly between two recorded samples', () => {
    const world = makeWorld();
    ReplayPlayer.loadClip(world, makeClip());
    ReplayPlayer.pause();

    ReplayPlayer.seek(5); // halfway between the two frames
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.player.ship.pos.x).toBeCloseTo(50, 5);
  });

  it('clamps at the clip boundaries rather than extrapolating', () => {
    const world = makeWorld();
    ReplayPlayer.loadClip(world, makeClip());
    ReplayPlayer.pause();

    ReplayPlayer.seek(-5);
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.player.ship.pos.x).toBeCloseTo(0, 5);

    ReplayPlayer.seek(999);
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.player.ship.pos.x).toBeCloseTo(100, 5);
  });

  it('advances the clock during playback and auto-pauses at the end', () => {
    const world = makeWorld();
    ReplayPlayer.loadClip(world, makeClip());
    ReplayPlayer.setSpeed(1);

    ReplayPlayer.stepPlayback(world, 20); // longer than the whole 10s clip
    expect(ReplayPlayer.getClockSec()).toBeCloseTo(10, 5);
    expect(world.player.ship.pos.x).toBeCloseTo(100, 5);
    expect(ReplayPlayer.isPlaying()).toBe(false);
  });

  it('hides an enemy snapshot that is null (dead/despawned) rather than interpolating through it', () => {
    const world = makeWorld();
    const clip: ReplayClip = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      recordedAt: '2026-01-01T00:00:00.000Z',
      sampleHz: 20,
      frames: [
        { simTime: 0, player: snap(0), enemies: [snap(10)] },
        { simTime: 10, player: snap(100), enemies: [null] }
      ],
      events: []
    };
    ReplayPlayer.loadClip(world, clip);
    ReplayPlayer.pause();

    ReplayPlayer.seek(2); // closer to the alive (first) side of the bracket
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.enemies[0].health.points).toBeGreaterThan(0);

    ReplayPlayer.seek(8); // closer to the dead (second) side of the bracket
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.enemies[0].health.points).toBe(0);
  });

  it('reconstructs a fired round analytically at its constant velocity between spawn and endSimTime', () => {
    const world = makeWorld();
    const clip = makeClip([
      { kind: 'fire', simTime: 1, endSimTime: 3, owner: 'player', pos: { x: 0, y: 0, z: 0 }, vel: { x: 100, y: 0, z: 0 } }
    ]);
    ReplayPlayer.loadClip(world, clip);
    ReplayPlayer.pause();

    ReplayPlayer.seek(0.5); // before the shot fires
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.projectiles.length).toBe(0);

    ReplayPlayer.seek(2); // 1s into its flight
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.projectiles.length).toBe(1);
    expect(world.projectiles[0].pos.x).toBeCloseTo(100, 5); // 100 m/s * 1s

    ReplayPlayer.seek(3.5); // past endSimTime — it hit something or expired
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.projectiles.length).toBe(0);
  });

  it('fades an impact/explosion effect out over its fixed duration', () => {
    const world = makeWorld();
    const clip = makeClip([
      { kind: 'impact', simTime: 2, pos: { x: 5, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } }
    ]);
    ReplayPlayer.loadClip(world, clip);
    ReplayPlayer.pause();

    ReplayPlayer.seek(2); // right as it triggers
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.effects.length).toBe(1);
    expect(world.effects[0].timer).toBeCloseTo(world.effects[0].maxTimer, 5);

    ReplayPlayer.seek(10); // long after IMPACT_DURATION has elapsed
    ReplayPlayer.stepPlayback(world, 0);
    expect(world.effects.length).toBe(0);
  });
});
