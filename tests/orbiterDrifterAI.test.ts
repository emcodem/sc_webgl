import { describe, it, expect, vi, afterEach } from 'vitest';
import { freshCapacitors, freshCapacitorCooldowns } from '../src/combat/weapons';
import {
  ORBITER_TUNING, DRIFTER_TUNING, HIT_REACTION_TUNING, spawnOrbitState, seedOrbiterPose, orbiterThink,
  spawnDriftState, driftThink, triggerHitReaction, hitReactionThink
} from '../src/combat/ai/orbiterDrifterAI';
import { createHealth } from '../src/combat/health';
import { getShipType } from '../src/physics/ships';
import { integrateFlight } from '../src/physics/flightModel';
import { computeAxes } from '../src/math/quaternion';
import { dot, normalize } from '../src/math/vec';
import type { EnemyShip, ShipBody } from '../src/core/world';

const TYPE = getShipType('Gladius');
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

function makeEnemy(pos = ZERO): EnemyShip {
  return {
    type: TYPE, pos, vel: ZERO, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0, throttleSpoolTime: 0, verticalSpoolTime: 0,
    health: createHealth(10), behavior: 'orbiter', fireCooldown: 0,
    weaponCapacitors: freshCapacitors(TYPE.weaponType), weaponCapacitorCooldownTimers: freshCapacitorCooldowns(), respawnTimer: 0,
    spawnPos: pos, spawnQuat: IDENTITY
  };
}
function makePlayer(pos = ZERO): ShipBody {
  return {
    type: TYPE, pos, vel: ZERO, quat: IDENTITY, angVel: { pitch: 0, yaw: 0, roll: 0 },
    angAccel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, decoupled: false, spaceBrakeOn: false, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), hitFlash: 0, fireCooldown: 0,
    weaponCapacitors: freshCapacitors(TYPE.weaponType), weaponCapacitorCooldownTimers: freshCapacitorCooldowns(),
    respawnTimer: 0
  };
}

afterEach(() => vi.restoreAllMocks());

describe('spawnOrbitState / spawnDriftState — field ranges', () => {
  it('radius and angularSpeed magnitude fall within the tuned min/max range', () => {
    const speedMult = 0.6 + 0.5 * 1.2; // droneSpeedMult(0.5), mirrored here since it isn't exported
    for (let i = 0; i < 20; i++) {
      const orbit = spawnOrbitState({ x: 0, y: 0, z: 0 }, 0.5);
      expect(orbit.radius).toBeGreaterThanOrEqual(ORBITER_TUNING.minRadius);
      expect(orbit.radius).toBeLessThanOrEqual(ORBITER_TUNING.maxRadius);
      expect(Math.abs(orbit.angularSpeed)).toBeGreaterThanOrEqual(ORBITER_TUNING.minAngularSpeed * speedMult - 1e-9);
      expect(Math.abs(orbit.angularSpeed)).toBeLessThanOrEqual(ORBITER_TUNING.maxAngularSpeed * speedMult + 1e-9);
      expect(orbit.respawnTimer).toBe(0);
    }
  });

  it('drifter spawn speed and initial position fall within the tuned distance range', () => {
    for (let i = 0; i < 20; i++) {
      const player = makePlayer();
      const { pos } = spawnDriftState(player, 0.5);
      const dist = Math.hypot(pos.x - player.pos.x, pos.y - player.pos.y, pos.z - player.pos.z);
      expect(dist).toBeGreaterThanOrEqual(DRIFTER_TUNING.minSpawnDist - 1e-6);
      expect(dist).toBeLessThanOrEqual(DRIFTER_TUNING.maxSpawnDist + 1e-6);
    }
  });
});

describe('orbiterThink', () => {
  it('eases the orbit center toward the player once the drone strays past leashDistance', () => {
    const farCenter = { x: ORBITER_TUNING.leashDistance + 1000, y: 0, z: 0 };
    const enemy = makeEnemy(farCenter); // distToPlayer is measured from the drone's current pos
    enemy.orbit = {
      center: { ...farCenter }, radius: 100, angularSpeed: 0.2, phase: 0,
      planeRight: { x: 0, y: 1, z: 0 }, planeUp: { x: 0, y: 0, z: 1 }, respawnTimer: 0
    };
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    orbiterThink(enemy, player, 1 / 60);
    // center should have moved toward the player (x decreased) but not snapped all the way there
    expect(enemy.orbit.center.x).toBeLessThan(farCenter.x);
    expect(enemy.orbit.center.x).toBeGreaterThan(0);
  });

  it('leaves the orbit center alone while within leashDistance of the player', () => {
    const enemy = makeEnemy();
    const center = { x: 100, y: 0, z: 0 };
    enemy.orbit = {
      center: { ...center }, radius: 50, angularSpeed: 0.2, phase: 0,
      planeRight: { x: 0, y: 1, z: 0 }, planeUp: { x: 0, y: 0, z: 1 }, respawnTimer: 0
    };
    orbiterThink(enemy, makePlayer(), 1 / 60);
    expect(enemy.orbit.center.x).toBeCloseTo(center.x, 6);
  });
});

describe('orbiterThink — pursuit-curve flight', () => {
  it('steers and throttles toward the lead carrot when facing away from it', () => {
    const orbit = {
      center: { x: 0, y: 0, z: 0 }, radius: 200, angularSpeed: 0.2, phase: 0,
      planeRight: { x: 1, y: 0, z: 0 }, planeUp: { x: 0, y: 0, z: 1 }, respawnTimer: 0
    };
    // placed exactly on the ring at phase 0, i.e. (200, 0, 0), where the ring's tangent (and thus
    // the lead carrot) sits roughly along +Z — but facing -Z (180 degrees off), so steering has
    // real work to do rather than coincidentally already pointing the right way
    const enemy = makeEnemy({ x: 200, y: 0, z: 0 });
    enemy.quat = { x: 0, y: 1, z: 0, w: 0 };
    enemy.orbit = orbit;
    const decision = orbiterThink(enemy, makePlayer(), 1 / 60);
    expect(decision.boostRequested).toBe(false);
    expect(decision.inputs.throttle).toBeGreaterThan(0);
    expect(Math.abs(decision.inputs.pitch) + Math.abs(decision.inputs.yaw)).toBeGreaterThan(0.05);
  });

  it('seedOrbiterPose places the enemy exactly on the ring with the correct tangential speed', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy();
    enemy.orbit = spawnOrbitState(player.pos, 0.5);
    seedOrbiterPose(enemy);
    const distFromCenter = Math.hypot(
      enemy.pos.x - enemy.orbit.center.x, enemy.pos.y - enemy.orbit.center.y, enemy.pos.z - enemy.orbit.center.z
    );
    expect(distFromCenter).toBeCloseTo(enemy.orbit.radius, 6);
    const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
    expect(speed).toBeCloseTo(enemy.orbit.radius * Math.abs(enemy.orbit.angularSpeed), 6);
  });

  it('converges to and holds roughly the tuned radius while flying real physics over time', () => {
    // fixed (non-degenerate) random draw for a reproducible, mid-range orbit — this test asserts a
    // physical convergence property, not a specific radius/speed, so any non-degenerate draw works
    vi.spyOn(Math, 'random').mockReturnValue(0.6);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy();
    enemy.orbit = spawnOrbitState(player.pos, 0.5);
    seedOrbiterPose(enemy);
    vi.restoreAllMocks();

    const dt = 1 / 60;
    const totalSec = 90;
    const transientSec = 5;
    let sampled = 0, withinTolerance = 0, aligned = 0;
    for (let t = 0; t < totalSec; t += dt) {
      const decision = orbiterThink(enemy, player, dt);
      integrateFlight(enemy, decision.inputs, dt);
      if (t < transientSec) continue;
      sampled++;
      const distFromCenter = Math.hypot(
        enemy.pos.x - enemy.orbit.center.x, enemy.pos.y - enemy.orbit.center.y, enemy.pos.z - enemy.orbit.center.z
      );
      // the radial correction is proportional-only (no integral term), so it settles into a stable
      // orbit at a steady but nonzero offset from the tuned radius rather than exactly on it — this
      // just guards against real divergence (spiraling to the center or flying off to infinity), not
      // exactness; a 40% offset is still well inside ORBITER_TUNING's own 150-400m spawn-radius range
      if (Math.abs(distFromCenter - enemy.orbit.radius) / enemy.orbit.radius < 0.4) withinTolerance++;
      const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
      if (speed > 1) {
        const velDir = normalize(enemy.vel);
        const forward = computeAxes(enemy.quat).forward;
        if (dot(velDir, forward) > 0.8) aligned++;
      }
    }
    expect(sampled).toBeGreaterThan(0);
    expect(withinTolerance / sampled).toBeGreaterThan(0.9);
    expect(aligned / sampled).toBeGreaterThan(0.9);
  });
});

describe('driftThink — turn-around gating', () => {
  it('retargets baseDir away from its current heading once past turnDist while flying away from the player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: DRIFTER_TUNING.turnDist + 10 });
    enemy.vel = { x: 0, y: 0, z: 100 }; // moving further away (+Z), away from the player at origin
    enemy.drift = { respawnTimer: 0, helix: { baseDir: { x: 0, y: 0, z: 1 }, rollSign: 1, aggressiveTimer: 0, rollFraction: 0.25 } };
    driftThink(enemy, player, 1 / 60, 0.5);
    // a fresh miss-aimed heading back toward the player, not the old +Z outbound heading
    expect(enemy.drift.helix!.baseDir.z).toBeLessThan(0.5);
  });

  it('does not retarget past turnDist while already flying back toward the player', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: DRIFTER_TUNING.turnDist + 10 });
    enemy.vel = { x: 0, y: 0, z: -100 }; // heading back toward the player, not away
    const baseDir = { x: 0, y: 0, z: -1 };
    enemy.drift = { respawnTimer: 0, helix: { baseDir, rollSign: 1, aggressiveTimer: 0, rollFraction: 0.25 } };
    driftThink(enemy, player, 1 / 60, 0.5);
    expect(enemy.drift.helix!.baseDir).toEqual(baseDir);
  });

  it('does not retarget before reaching turnDist even while flying away', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: DRIFTER_TUNING.turnDist - 100 });
    enemy.vel = { x: 0, y: 0, z: 100 };
    const baseDir = { x: 0, y: 0, z: 1 };
    enemy.drift = { respawnTimer: 0, helix: { baseDir, rollSign: 1, aggressiveTimer: 0, rollFraction: 0.25 } };
    driftThink(enemy, player, 1 / 60, 0.5);
    expect(enemy.drift.helix!.baseDir).toEqual(baseDir);
  });

  it('always requests boost and full forward throttle', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: 100 });
    enemy.vel = { x: 0, y: 0, z: 100 };
    enemy.drift = { respawnTimer: 0 };
    const decision = driftThink(enemy, player, 1 / 60, 0.5);
    expect(decision.boostRequested).toBe(true);
    expect(decision.inputs.throttle).toBe(1);
    expect(decision.inputs.strafeY).toBe(1);
  });
});

describe('triggerHitReaction', () => {
  it('starts a break reaction for orbiter/drifter with breakTimer in the tuned range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const orbiter = makeEnemy();
    orbiter.behavior = 'orbiter';
    triggerHitReaction(orbiter);
    expect(orbiter.hitReaction?.mode).toBe('break');
    expect(orbiter.hitReaction!.breakTimer).toBeGreaterThanOrEqual(HIT_REACTION_TUNING.breakMinSec);
    expect(orbiter.hitReaction!.breakTimer).toBeLessThanOrEqual(HIT_REACTION_TUNING.breakMaxSec);

    const drifter = makeEnemy();
    drifter.behavior = 'drifter';
    triggerHitReaction(drifter);
    expect(drifter.hitReaction?.mode).toBe('break');
  });

  it('is a no-op for behaviors other than orbiter/drifter', () => {
    const enemy = makeEnemy();
    enemy.behavior = 'chaser';
    triggerHitReaction(enemy);
    expect(enemy.hitReaction).toBeUndefined();
  });

  it('restarts the break phase if hit again mid-reaction', () => {
    const enemy = makeEnemy();
    enemy.behavior = 'orbiter';
    triggerHitReaction(enemy);
    enemy.hitReaction!.mode = 'engaged';
    triggerHitReaction(enemy);
    expect(enemy.hitReaction!.mode).toBe('break');
  });
});

describe('hitReactionThink', () => {
  it('returns null when the enemy has no active reaction', () => {
    const enemy = makeEnemy();
    expect(hitReactionThink(enemy, makePlayer(), 1 / 60)).toBeNull();
  });

  it('break phase: full up-strafe, 25% roll left, boosted, no steering, until breakTimer elapses', () => {
    const enemy = makeEnemy({ x: 0, y: 0, z: -200 });
    enemy.hitReaction = { mode: 'break', breakTimer: 0.5, dodgeStrafeX: 0, dodgeStrafeY: 1, dodgeTimer: 0 };
    const player = makePlayer({ x: 0, y: 0, z: 0 });

    const decision = hitReactionThink(enemy, player, 1 / 60);
    expect(decision).not.toBeNull();
    expect(decision!.boostRequested).toBe(true);
    expect(decision!.inputs.strafeY).toBe(1);
    expect(decision!.inputs.roll).toBeCloseTo(-HIT_REACTION_TUNING.breakRollFraction, 6);
    expect(decision!.inputs.pitch).toBe(0);
    expect(decision!.inputs.yaw).toBe(0);
    expect(decision!.inputs.throttle).toBe(0);
    expect(enemy.hitReaction.mode).toBe('break'); // hasn't elapsed yet

    hitReactionThink(enemy, player, 1); // 1s > the 0.5s remaining
    expect(enemy.hitReaction.mode).toBe('faceAttacker');
  });

  it('faceAttacker phase: steers toward the player and locks to engaged once a shot would land', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    // facing away from the player (+Z) at close range — steering has real work to do, and isn't
    // locked on yet
    const enemy = makeEnemy({ x: 0, y: 0, z: -100 });
    enemy.quat = { x: 0, y: 1, z: 0, w: 0 };
    enemy.hitReaction = { mode: 'faceAttacker', breakTimer: 0, dodgeStrafeX: 0, dodgeStrafeY: 1, dodgeTimer: 0 };

    const decision = hitReactionThink(enemy, player, 1 / 60);
    expect(decision!.boostRequested).toBe(true);
    expect(decision!.inputs.throttle).toBe(0);
    // never yaws (see rollPitchOnlySteer) — the turn is done entirely via roll+pitch
    expect(decision!.inputs.yaw).toBe(0);
    expect(Math.abs(decision!.inputs.pitch) + Math.abs(decision!.inputs.roll)).toBeGreaterThan(0.05);
    expect(enemy.hitReaction.mode).toBe('faceAttacker'); // still turning, not locked on yet

    // now actually pointed at the (stationary, close) player — a shot fired now would land
    enemy.quat = { x: 0, y: 0, z: 0, w: 1 };
    hitReactionThink(enemy, player, 1 / 60);
    expect(enemy.hitReaction.mode).toBe('engaged');
  });

  it('engaged + far (>= engageRangeM): approaches the player, not boosted', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: -(HIT_REACTION_TUNING.engageRangeM + 50) });
    enemy.hitReaction = { mode: 'engaged', breakTimer: 0, dodgeStrafeX: 0, dodgeStrafeY: 1, dodgeTimer: 0 };
    const decision = hitReactionThink(enemy, player, 1 / 60);
    expect(decision!.boostRequested).toBe(false);
    expect(decision!.inputs.throttle).toBeGreaterThan(0);
    expect(decision!.inputs.strafeX).toBe(0);
    expect(decision!.inputs.strafeY).toBe(0);
  });

  it('engaged + near (< engageRangeM): dodges with a committed up/left/right strafe bias, no throttle', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: -100 });
    enemy.hitReaction = { mode: 'engaged', breakTimer: 0, dodgeStrafeX: 0, dodgeStrafeY: 0, dodgeTimer: 0 };
    const decision = hitReactionThink(enemy, player, 1 / 60);
    expect(decision!.inputs.throttle).toBe(0);
    expect(Math.abs(decision!.inputs.strafeX) + Math.abs(decision!.inputs.strafeY)).toBeGreaterThan(0);
    expect(decision!.inputs.brake).toBe(false);
  });

  it.each([
    ['off to one side and above', { x: -300, y: -200, z: -400 }],
    ['almost directly behind', { x: 0, y: 5, z: 300 }],
    ['almost directly ahead already', { x: 5, y: -5, z: -500 }],
    ['purely lateral (no vertical offset)', { x: -400, y: 0, z: -300 }],
    ['purely vertical (no lateral offset)', { x: 0, y: -400, z: -300 }]
  ])('faceAttacker phase converges the nose purely via roll+pitch, never yaw — %s', (_label, pos) => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy(pos);
    enemy.hitReaction = { mode: 'faceAttacker', breakTimer: 0, dodgeStrafeX: 0, dodgeStrafeY: 1, dodgeTimer: 0 };

    const dt = 1 / 60;
    for (let t = 0; t < 8 && enemy.hitReaction?.mode === 'faceAttacker'; t += dt) {
      const decision = hitReactionThink(enemy, player, dt)!;
      expect(decision.inputs.yaw).toBe(0); // never yaws, every single tick
      integrateFlight(enemy, decision.inputs, dt);
    }
    expect(enemy.hitReaction?.mode).toBe('engaged'); // actually converged and locked on within the window

    const { forward } = computeAxes(enemy.quat);
    const toPlayer = normalize({ x: player.pos.x - enemy.pos.x, y: player.pos.y - enemy.pos.y, z: player.pos.z - enemy.pos.z });
    expect(dot(forward, toPlayer)).toBeGreaterThan(0.9); // nose actually ends up on the player
  });

  it('faceAttacker uses roll for a purely lateral correction instead of leaning on yaw', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: -400, y: 0, z: -300 }); // target well off to the side, level
    enemy.hitReaction = { mode: 'faceAttacker', breakTimer: 0, dodgeStrafeX: 0, dodgeStrafeY: 1, dodgeTimer: 0 };
    const decision = hitReactionThink(enemy, player, 1 / 60)!;
    expect(decision.inputs.yaw).toBe(0);
    expect(Math.abs(decision.inputs.roll)).toBeGreaterThan(0.3);
  });

  it('engaged + near + over the speed cap: brakes instead of continuing to strafe', () => {
    const player = makePlayer({ x: 0, y: 0, z: 0 });
    const enemy = makeEnemy({ x: 0, y: 0, z: -100 });
    enemy.vel = { x: HIT_REACTION_TUNING.dodgeSpeedCapMps + 10, y: 0, z: 0 };
    enemy.hitReaction = { mode: 'engaged', breakTimer: 0, dodgeStrafeX: 1, dodgeStrafeY: 0, dodgeTimer: 1 };
    const decision = hitReactionThink(enemy, player, 1 / 60);
    expect(decision!.inputs.brake).toBe(true);
    expect(decision!.inputs.strafeX).toBe(0);
    expect(decision!.inputs.strafeY).toBe(0);
  });
});
