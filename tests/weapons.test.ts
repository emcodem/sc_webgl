import { describe, it, expect } from 'vitest';
import {
  WEAPON, NUM_GUNS, spawnProjectileFrom, updateProjectiles, tryFireWeapon,
  freshCapacitors, freshCapacitorCooldowns
} from '../src/combat/weapons';
import type { Projectile } from '../src/core/world';

const FORWARD = { x: 0, y: 0, z: 1 };
const RIGHT = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 1, z: 0 };
const ORIGIN = { x: 0, y: 0, z: 0 };
const ZERO_VEL = { x: 0, y: 0, z: 0 };
// A zero-spread copy of the real weapon, for tests that assert exact aim direction — spread is
// covered separately below and would otherwise make every direction-exactness assertion flaky.
const NO_SPREAD_WEAPON = { ...WEAPON, spreadDeg: 0 };

describe('spawnProjectileFrom', () => {
  it('cycles through the 3 muzzle mounts in order across consecutive calls', () => {
    const out: Projectile[] = [];
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out);
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out);
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out);
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out);
    expect(out).toHaveLength(4);
    // mounts are (right:-9.96,down:3.36), (right:9.96,down:3.36), (right:0,down:5.6) then wraps.
    // pos offsets along -up, so a positive `down` yields a negative pos.y here (UP = +Y).
    expect(out[0].pos.x).toBeCloseTo(-9.96, 6);
    expect(out[0].pos.y).toBeCloseTo(-3.36, 6); // left wing, 20% up from bottom
    expect(out[1].pos.x).toBeCloseTo(9.96, 6);
    expect(out[2].pos.x).toBeCloseTo(0, 6);
    expect(out[2].pos.y).toBeCloseTo(-5.6, 6); // nose mount, bottom-center
    expect(out[3].pos.x).toBeCloseTo(out[0].pos.x, 6); // cycle wrapped back to the first mount
  });

  it('adds muzzle speed on top of the shooter velocity, aimed at the convergence point', () => {
    const out: Projectile[] = [];
    const shooterVel = { x: 5, y: 0, z: 0 };
    // A very long convergence range makes the toe-in negligible, so the round leaves ~straight
    // down the nose (+Z) with muzzleSpeed added on top of the shooter's own velocity. Spread is
    // zeroed here (see NO_SPREAD_WEAPON) since it would otherwise perturb this exact-aim check.
    spawnProjectileFrom(ORIGIN, shooterVel, FORWARD, RIGHT, UP, 'player', out, 1e7, NO_SPREAD_WEAPON);
    const relSpeed = Math.hypot(out[0].vel.x - 5, out[0].vel.y, out[0].vel.z);
    expect(relSpeed).toBeCloseTo(NO_SPREAD_WEAPON.muzzleSpeed, 3); // shot-relative speed is exactly muzzleSpeed
    expect(out[0].vel.x).toBeCloseTo(5, 1);              // inherits shooter velocity
    expect(out[0].vel.z).toBeCloseTo(WEAPON.muzzleSpeed, 0); // aimed essentially along the nose
  });

  it('toes each gun in so its bore line passes through the shared convergence point', () => {
    const out: Projectile[] = [];
    const convergeDist = 500;
    // fire all three mounts; each round's direction must point exactly at pos + forward*convergeDist.
    // Spread zeroed (see NO_SPREAD_WEAPON) — it's checked separately below.
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out, convergeDist, NO_SPREAD_WEAPON);
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out, convergeDist, NO_SPREAD_WEAPON);
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out, convergeDist, NO_SPREAD_WEAPON);
    const conv = { x: 0, y: 0, z: convergeDist }; // ORIGIN + FORWARD*convergeDist
    for (const pr of out) {
      // direction from the muzzle toward the convergence point, and the round's own direction
      const toConv = { x: conv.x - pr.pos.x, y: conv.y - pr.pos.y, z: conv.z - pr.pos.z };
      const lenToConv = Math.hypot(toConv.x, toConv.y, toConv.z);
      const dir = { x: pr.vel.x / NO_SPREAD_WEAPON.muzzleSpeed, y: pr.vel.y / NO_SPREAD_WEAPON.muzzleSpeed, z: pr.vel.z / NO_SPREAD_WEAPON.muzzleSpeed };
      expect(dir.x).toBeCloseTo(toConv.x / lenToConv, 6);
      expect(dir.y).toBeCloseTo(toConv.y / lenToConv, 6);
      expect(dir.z).toBeCloseTo(toConv.z / lenToConv, 6);
    }
  });

  it('deviates the aim by up to spreadDeg, uniformly around the convergence direction', () => {
    // Deviation is measured against each shot's OWN pre-spread aim — the line from its muzzle to the
    // shared convergence point — not against the nose axis (+Z).
    //
    // Assuming +Z made this test flaky at ~5% of runs. A long convergence range makes the toe-in
    // small but not zero: no mountIndex is passed, so every trial cycles to a different muzzle (see
    // spawnProjectileFrom's fallback index), and a wing mount sitting 10.5 m off-axis while aiming
    // 1e7 m ahead is toed in by ~1.05e-6 rad — a thousand times the 1e-9 float slack below. Measuring
    // from +Z therefore reported toe-in + spread, so any trial that happened to draw a near-cone-edge
    // deviation pointing the same way as its toe-in tripped the assertion. Taking the muzzle position
    // from the returned round (out[0].pos) removes the bias exactly, without duplicating the
    // production offset math or exporting MUZZLE_MOUNTS, and makes 1e-9 an honest float tolerance.
    const trials = 500;
    const convergeDist = 1e7;
    const conv = { x: 0, y: 0, z: convergeDist }; // ORIGIN + FORWARD*convergeDist
    const spreadRad = (WEAPON.spreadDeg * Math.PI) / 180;
    let maxAngle = 0;
    let sumAngle = 0;
    for (let i = 0; i < trials; i++) {
      const out: Projectile[] = [];
      spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out, convergeDist);
      const dir = { x: out[0].vel.x, y: out[0].vel.y, z: out[0].vel.z };
      const len = Math.hypot(dir.x, dir.y, dir.z);
      const aim = { x: conv.x - out[0].pos.x, y: conv.y - out[0].pos.y, z: conv.z - out[0].pos.z };
      const aimLen = Math.hypot(aim.x, aim.y, aim.z);
      const cosAngle = (dir.x * aim.x + dir.y * aim.y + dir.z * aim.z) / (len * aimLen);
      const angle = Math.acos(Math.min(1, Math.max(-1, cosAngle)));
      maxAngle = Math.max(maxAngle, angle);
      sumAngle += angle;
    }
    // Never exceeds the weapon's cone (small numerical slack for float error).
    expect(maxAngle).toBeLessThanOrEqual(spreadRad + 1e-9);
    // With a real cone, some meaningful fraction of shots should land off-dead-center — this would
    // be ~0 if applySpread were a no-op.
    expect(sumAngle / trials).toBeGreaterThan(spreadRad * 0.1);
  });

  it('tags the round with the given owner and starts age at 0', () => {
    const out: Projectile[] = [];
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'enemy', out);
    expect(out[0].owner).toBe('enemy');
    expect(out[0].age).toBe(0);
  });
});

describe('updateProjectiles', () => {
  it('advances position by velocity * dt and ages the round', () => {
    const projectiles: Projectile[] = [{ pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, vel: { x: 10, y: 0, z: 0 }, age: 0, owner: 'player' }];
    updateProjectiles(projectiles, 0.5);
    expect(projectiles[0].pos.x).toBeCloseTo(5, 6);
    expect(projectiles[0].prevPos.x).toBeCloseTo(0, 6); // start-of-frame position captured for swept hit tests
    expect(projectiles[0].age).toBeCloseTo(0.5, 6);
  });

  it('keeps a round exactly at its lifetime boundary (age > lifetime removes, not >=)', () => {
    const projectiles: Projectile[] = [{ pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: WEAPON.lifetime, owner: 'player' }];
    updateProjectiles(projectiles, 0);
    expect(projectiles).toHaveLength(1);
  });

  it('removes a round once its age exceeds lifetime', () => {
    const projectiles: Projectile[] = [{ pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: WEAPON.lifetime, owner: 'player' }];
    updateProjectiles(projectiles, 0.001);
    expect(projectiles).toHaveLength(0);
  });
});

describe('tryFireWeapon', () => {
  function freshState() {
    return {
      fireCooldown: 0,
      weaponCapacitors: freshCapacitors(WEAPON),
      weaponCapacitorCooldownTimers: freshCapacitorCooldowns()
    };
  }

  it('fires every gun simultaneously, draining each by capacitorCostPerShot and starting its dwell', () => {
    const state = freshState();
    const mountsFired: number[] = [];
    expect(tryFireWeapon(WEAPON, state, true, 0, (mount) => { mountsFired.push(mount); })).toBe(true);
    expect(mountsFired.slice().sort()).toEqual(Array.from({ length: NUM_GUNS }, (_, i) => i));
    for (const c of state.weaponCapacitors) {
      expect(c).toBeCloseTo(WEAPON.capacitorCapacity - WEAPON.capacitorCostPerShot, 6);
    }
    for (const t of state.weaponCapacitorCooldownTimers) {
      expect(t).toBeCloseTo(WEAPON.capacitorRechargeDelaySec, 6);
    }
  });

  it('refuses once every gun is drained under cost', () => {
    const state = freshState();
    let shots = 0;
    // fire at the weapon's own cadence — dt=0 between shots would never let fireCooldown clear
    const fireDt = 1 / WEAPON.fireRate;
    const shotsToEmpty = Math.ceil(WEAPON.capacitorCapacity / WEAPON.capacitorCostPerShot);
    for (let i = 0; i < shotsToEmpty; i++) {
      expect(tryFireWeapon(WEAPON, state, true, fireDt, () => { shots++; })).toBe(true);
    }
    expect(shots).toBe(shotsToEmpty * NUM_GUNS);
    for (const c of state.weaponCapacitors) {
      expect(c).toBeLessThan(WEAPON.capacitorCostPerShot); // can't afford another volley yet
    }
    // every gun is now under cost — holding the trigger fires nothing more
    expect(tryFireWeapon(WEAPON, state, true, fireDt, () => { shots++; })).toBe(false);
    expect(shots).toBe(shotsToEmpty * NUM_GUNS);
  });

  it('does not begin the post-fire recharge dwell while the trigger is still held, even once empty', () => {
    const state = freshState();
    const fireDt = 1 / WEAPON.fireRate;
    const shotsToEmpty = Math.ceil(WEAPON.capacitorCapacity / WEAPON.capacitorCostPerShot);
    for (let i = 0; i < shotsToEmpty; i++) tryFireWeapon(WEAPON, state, true, fireDt, () => {});
    expect(state.weaponCapacitors.every((c) => c < WEAPON.capacitorCostPerShot)).toBe(true);
    const frozenAt = state.weaponCapacitorCooldownTimers[0];
    expect(frozenAt).toBeCloseTo(WEAPON.capacitorRechargeDelaySec, 6); // just fired, freshly reset

    // keep holding the (now-empty, can't-actually-fire) trigger for a long stretch — the dwell timer
    // must stay frozen at exactly its last-reset value the whole time, not tick down just because
    // fireCooldown/capacitor happens to block firing on any given frame.
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) tryFireWeapon(WEAPON, state, true, dt, () => {});
    expect(state.weaponCapacitorCooldownTimers.every((t) => t === frozenAt)).toBe(true);
    expect(state.weaponCapacitors.every((c) => c < WEAPON.capacitorCostPerShot)).toBe(true); // no recharge either
  });

  it('refuses to fire through the post-fire recharge delay once released, then fires again once recharged', () => {
    const state = freshState();
    const fireDt = 1 / WEAPON.fireRate;
    const shotsToEmpty = Math.ceil(WEAPON.capacitorCapacity / WEAPON.capacitorCostPerShot);
    for (let i = 0; i < shotsToEmpty; i++) tryFireWeapon(WEAPON, state, true, fireDt, () => {});
    expect(state.weaponCapacitors.every((c) => c < WEAPON.capacitorCostPerShot)).toBe(true);

    // every gun fired on the same tick, so their dwell timers are in lockstep — read any one.
    const dt = 1 / 60;
    const remainingDelay = state.weaponCapacitorCooldownTimers[0];
    expect(remainingDelay).toBeCloseTo(WEAPON.capacitorRechargeDelaySec, 6); // just fired, freshly reset

    // trigger released (requested=false) — still within the recharge delay, so no volley fires
    let firedDuringDelay = false;
    const delayFrames = Math.ceil(remainingDelay / dt) - 1;
    for (let i = 0; i < delayFrames; i++) {
      if (tryFireWeapon(WEAPON, state, false, dt, () => { firedDuringDelay = true; })) firedDuringDelay = true;
    }
    expect(firedDuringDelay).toBe(false);

    // enough additional time for every gun to recharge back above cost
    const need = WEAPON.capacitorCostPerShot - state.weaponCapacitors[0];
    const rechargeSeconds = need / WEAPON.capacitorRechargeRate + 1;
    for (let i = 0; i < Math.ceil(rechargeSeconds / dt); i++) {
      tryFireWeapon(WEAPON, state, false, dt, () => {});
    }
    expect(state.weaponCapacitors.every((c) => c >= WEAPON.capacitorCostPerShot)).toBe(true);
    expect(tryFireWeapon(WEAPON, state, true, dt, () => {})).toBe(true);
  });
});
