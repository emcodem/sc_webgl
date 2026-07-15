import { describe, it, expect, vi, afterEach } from 'vitest';
import { PIP_TRAINER_DEFAULTS, updatePipTrainer, type PipTrainerState } from '../src/combat/pipTrainer';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/physics/shipTypes';
import { normalize } from '../src/math/vec';
import { lookAtQuat } from '../src/math/quaternion';
import type { ShipBody } from '../src/core/world';

const TYPE = SHIP_TYPES[0];
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

function makePlayer(pos = ZERO, quat = IDENTITY): ShipBody {
  return {
    type: TYPE, pos, vel: ZERO, quat, angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, decoupled: false, spaceBrakeOn: false, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), hitFlash: 0, fireCooldown: 0,
    respawnTimer: 0
  };
}

afterEach(() => vi.restoreAllMocks());

describe('avoidance vs. anchor cage priority', () => {
  it('flees the crosshair (moving away from anchor) rather than being pulled back to it when both would apply', () => {
    const anchor = { x: 0, y: 0, z: 300 };
    const startPos = { x: 60, y: 0, z: 300 }; // 60m from anchor, past WANDER_RADIUS (45m)
    // player's forward is aimed close to (but not exactly at) startPos, so the pip sits just inside
    // the 6-degree avoid cone at this range, while still being clearly past the wander radius.
    const forwardDir = normalize({ x: 55, y: 0, z: 300 });
    const player = makePlayer(ZERO, lookAtQuat(forwardDir));

    function run(avoidDegrees: number): number {
      const state: PipTrainerState = {
        anchor: { ...anchor }, pos: { ...startPos }, vel: ZERO, targetVel: ZERO,
        decisionTimer: 10, holdTimer: 0, elapsedSec: 0, reps: 0, scoreFlash: 0, outcome: 'active',
        opts: { ...PIP_TRAINER_DEFAULTS, avoidDegrees, durationSec: null }
      };
      updatePipTrainer(state, player, 1);
      return Math.hypot(state.pos.x - anchor.x, state.pos.y - anchor.y, state.pos.z - anchor.z);
    }

    const distWithAvoidance = run(6);
    const distWithoutAvoidance = run(0);

    expect(distWithoutAvoidance).toBeLessThan(60); // cage alone pulls it back toward the anchor
    expect(distWithAvoidance).toBeGreaterThan(distWithoutAvoidance); // avoidance overrides that pull
  });
});

describe('dead-on-boresight avoidance fallback', () => {
  it('picks a fresh (non-NaN, correctly-scaled) flee direction when lateralLen is ~0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25); // deterministic angle for the fresh-direction pick
    const player = makePlayer(); // faces +Z; pip sits dead ahead -> lateralLen exactly 0
    const state: PipTrainerState = {
      anchor: { x: 0, y: 0, z: 300 }, pos: { x: 0, y: 0, z: 300 }, vel: ZERO, targetVel: ZERO,
      decisionTimer: 10, holdTimer: 0, elapsedSec: 0, reps: 0, scoreFlash: 0, outcome: 'active',
      opts: { ...PIP_TRAINER_DEFAULTS, avoidDegrees: 6, durationSec: null }
    };
    updatePipTrainer(state, player, 1 / 60);
    expect(Number.isFinite(state.targetVel.x)).toBe(true);
    expect(Number.isFinite(state.targetVel.y)).toBe(true);
    expect(Number.isFinite(state.targetVel.z)).toBe(true);
    const mag = Math.hypot(state.targetVel.x, state.targetVel.y, state.targetVel.z);
    expect(mag).toBeGreaterThan(0);
  });
});

describe('accel-limited approach to target velocity', () => {
  it('snaps directly to targetVel when the required delta-v is within this tick\'s accel budget', () => {
    const player = makePlayer();
    const state: PipTrainerState = {
      anchor: { x: 0, y: 0, z: 300 }, pos: { x: 0, y: 0, z: 300 }, vel: { x: 1, y: 0, z: 0 }, targetVel: { x: 2, y: 0, z: 0 },
      decisionTimer: 10, holdTimer: 0, elapsedSec: 0, reps: 0, scoreFlash: 0, outcome: 'active',
      opts: { ...PIP_TRAINER_DEFAULTS, avoidDegrees: 0, durationSec: null }
    };
    // dv = 1 m/s, trivially within any reasonable accel*dt budget
    updatePipTrainer(state, player, 1 / 60);
    expect(state.vel.x).toBeCloseTo(2, 3);
  });

  it('caps the step to maxAccel*dt when the required delta-v is large', () => {
    const player = makePlayer();
    const opts = { ...PIP_TRAINER_DEFAULTS, avoidDegrees: 0, durationSec: null, speed: 100, randomness: 0 };
    const maxAccel = opts.speed * 1.5; // randomness=0 -> no extra accel headroom
    const dt = 1 / 60;
    const state: PipTrainerState = {
      // anchor == pos (dist 0, well under WANDER_RADIUS) so the anchor cage stays inactive and
      // doesn't override the targetVel this test is deliberately forcing.
      anchor: { x: 0, y: 0, z: 0 }, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, targetVel: { x: 1000, y: 0, z: 0 },
      decisionTimer: 10, holdTimer: 0, elapsedSec: 0, reps: 0, scoreFlash: 0, outcome: 'active', opts
    };
    updatePipTrainer(state, player, dt);
    expect(state.vel.x).toBeCloseTo(maxAccel * dt, 3);
    expect(state.vel.x).toBeLessThan(1000);
  });
});

describe('holdTimer', () => {
  it('resets to 0 the instant the player is no longer aimed on the pip', () => {
    const player = makePlayer(); // faces +Z
    const state: PipTrainerState = {
      anchor: { x: 0, y: 0, z: 300 }, pos: { x: 1000, y: 1000, z: 300 }, vel: ZERO, targetVel: ZERO,
      decisionTimer: 10, holdTimer: 5, elapsedSec: 0, reps: 0, scoreFlash: 0, outcome: 'active',
      opts: { ...PIP_TRAINER_DEFAULTS, avoidDegrees: 0, durationSec: null }
    };
    updatePipTrainer(state, player, 1 / 60);
    expect(state.holdTimer).toBe(0);
  });
});

describe('durationSec === null', () => {
  it('never transitions to "won" regardless of elapsed time', () => {
    const player = makePlayer();
    const state: PipTrainerState = {
      anchor: { x: 0, y: 0, z: 300 }, pos: { x: 0, y: 0, z: 300 }, vel: ZERO, targetVel: ZERO,
      decisionTimer: 10, holdTimer: 0, elapsedSec: 100000, reps: 0, scoreFlash: 0, outcome: 'active',
      opts: { ...PIP_TRAINER_DEFAULTS, durationSec: null }
    };
    updatePipTrainer(state, player, 1);
    expect(state.outcome).toBe('active');
  });
});
