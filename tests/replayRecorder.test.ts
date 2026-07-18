import { describe, it, expect } from 'vitest';
import { makeWorld } from '../src/core/player';
import * as Recorder from '../src/replay/recorder';

// Exercises replay/recorder.ts's always-on rolling buffer: fixed-rate thinning independent of how
// often sampleTick is called, manual start/stop slicing the right range, rolling eviction
// respecting the configured window, and control-input capture riding alongside the state.

describe('replay recorder', () => {
  it('throttles sampling to a fixed rate regardless of call frequency', () => {
    const world = makeWorld();

    Recorder.startManualRecording();
    for (let i = 0; i < 5; i++) Recorder.sampleTick(world, 0.005); // 0.025s total — under the 0.05s (20Hz) interval
    expect(Recorder.stopManualRecording()).toBeNull(); // nothing crossed the interval yet, so no clip

    Recorder.startManualRecording();
    Recorder.sampleTick(world, 0.05); // exactly one interval's worth — pushes exactly one sample
    Recorder.sampleTick(world, 0.02); // not enough for a second sample yet
    const clip = Recorder.stopManualRecording();
    expect(clip).not.toBeNull();
    expect(clip!.frames.length).toBe(1);
    expect(clip!.frames[0].simTime).toBe(0); // rebased to start at 0
  });

  it('manual recording captures the ship\'s control inputs alongside its state', () => {
    const world = makeWorld();
    world.player.ship.lastInputs = {
      throttle: 0.7, pitch: 0.1, yaw: -0.2, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false
    };

    Recorder.startManualRecording();
    Recorder.sampleTick(world, 0.05); // pushes exactly one new sample carrying this world's lastInputs
    const clip = Recorder.stopManualRecording();

    expect(clip).not.toBeNull();
    const lastFrame = clip!.frames[clip!.frames.length - 1];
    expect(lastFrame.player.inputs).toEqual({
      throttle: 0.7, pitch: 0.1, yaw: -0.2, roll: 0, strafeX: 0, strafeY: 0, brake: false, decoupled: false
    });
  });

  it('rolling eviction keeps only the configured window once not manually recording', () => {
    const world = makeWorld();
    Recorder.setRollingWindowSec(1);
    for (let i = 0; i < 300; i++) Recorder.sampleTick(world, 0.01); // 3s of sim time at a 1s window

    // eviction only runs at push time (every ~1/20s), so availableSeconds can lag the true window
    // by up to one sample interval — allow that slack rather than asserting an exact 1.0 cutoff.
    expect(Recorder.availableSeconds()).toBeLessThanOrEqual(1.1);
    expect(Recorder.availableSeconds()).toBeGreaterThan(0.8);
  });

  it('saveLastNSeconds grabs just the tail, rebased to start at 0', () => {
    const world = makeWorld();
    Recorder.setRollingWindowSec(300);
    for (let i = 0; i < 100; i++) Recorder.sampleTick(world, 0.05); // 5s of new samples

    const clip = Recorder.saveLastNSeconds(1);
    expect(clip).not.toBeNull();
    expect(clip!.frames[0].simTime).toBe(0);
    expect(clip!.frames[clip!.frames.length - 1].simTime).toBeLessThanOrEqual(1 + 1e-9);
    expect(clip!.frames.length).toBeGreaterThan(1);
  });

  it('records a fire event with the true spawn position/time, back-derived from projectile age', () => {
    const world = makeWorld();
    world.projectiles = [];
    Recorder.startManualRecording();
    Recorder.sampleTick(world, 0.1); // guarantees at least one ship-state frame gets pushed

    // A projectile that just spawned and was already advanced by one frame's dt (age=0.02) before
    // this scan sees it — exactly combat/combatSystem.ts's real per-frame ordering (fire, then
    // updateProjectiles advances everything including the brand-new round, same frame).
    world.projectiles.push({
      pos: { x: 2, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 },
      vel: { x: 100, y: 0, z: 0 }, age: 0.02, owner: 'player'
    });
    Recorder.sampleTick(world, 0.1);

    world.projectiles.length = 0; // consumed by a hit/expiry on a later tick
    Recorder.sampleTick(world, 0.1);

    const clip = Recorder.stopManualRecording();
    expect(clip).not.toBeNull();
    expect(clip!.events.length).toBe(1);
    const ev = clip!.events[0];
    expect(ev.kind).toBe('fire');
    if (ev.kind !== 'fire') return;
    expect(ev.owner).toBe('player');
    // back-derived spawn pos = observed pos - vel * age = (2,0,0) - (100,0,0)*0.02 = (0,0,0)
    expect(ev.pos.x).toBeCloseTo(0, 5);
    expect(ev.endSimTime).toBeGreaterThan(ev.simTime);
  });

  it('records impact/explosion effect triggers', () => {
    const world = makeWorld();
    world.effects = [];
    Recorder.startManualRecording();
    Recorder.sampleTick(world, 0.1);

    world.effects.push({ kind: 'impact', pos: { x: 5, y: 1, z: 2 }, normal: { x: 1, y: 0, z: 0 }, timer: 0.16, maxTimer: 0.16 });
    Recorder.sampleTick(world, 0.1);

    const clip = Recorder.stopManualRecording();
    expect(clip).not.toBeNull();
    expect(clip!.events.length).toBe(1);
    const ev = clip!.events[0];
    expect(ev.kind).toBe('impact');
    if (ev.kind === 'impact' || ev.kind === 'explosion') {
      expect(ev.pos).toEqual({ x: 5, y: 1, z: 2 });
      expect(ev.normal).toEqual({ x: 1, y: 0, z: 0 });
    }
  });
});
