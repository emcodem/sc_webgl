import { describe, it, expect } from 'vitest';
import { WEAPON, spawnProjectileFrom, updateProjectiles, tryFireWeapon } from '../src/combat/weapons';
import type { Projectile } from '../src/core/world';

const FORWARD = { x: 0, y: 0, z: 1 };
const RIGHT = { x: 1, y: 0, z: 0 };
const UP = { x: 0, y: 1, z: 0 };
const ORIGIN = { x: 0, y: 0, z: 0 };
const ZERO_VEL = { x: 0, y: 0, z: 0 };

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
    // down the nose (+Z) with muzzleSpeed added on top of the shooter's own velocity.
    spawnProjectileFrom(ORIGIN, shooterVel, FORWARD, RIGHT, UP, 'player', out, 1e7);
    const relSpeed = Math.hypot(out[0].vel.x - 5, out[0].vel.y, out[0].vel.z);
    expect(relSpeed).toBeCloseTo(WEAPON.muzzleSpeed, 3); // shot-relative speed is exactly muzzleSpeed
    expect(out[0].vel.x).toBeCloseTo(5, 1);              // inherits shooter velocity
    expect(out[0].vel.z).toBeCloseTo(WEAPON.muzzleSpeed, 0); // aimed essentially along the nose
  });

  it('toes each gun in so its bore line passes through the shared convergence point', () => {
    const out: Projectile[] = [];
    const convergeDist = 500;
    // fire all three mounts; each round's direction must point exactly at pos + forward*convergeDist
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out, convergeDist);
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out, convergeDist);
    spawnProjectileFrom(ORIGIN, ZERO_VEL, FORWARD, RIGHT, UP, 'player', out, convergeDist);
    const conv = { x: 0, y: 0, z: convergeDist }; // ORIGIN + FORWARD*convergeDist
    for (const pr of out) {
      // direction from the muzzle toward the convergence point, and the round's own direction
      const toConv = { x: conv.x - pr.pos.x, y: conv.y - pr.pos.y, z: conv.z - pr.pos.z };
      const lenToConv = Math.hypot(toConv.x, toConv.y, toConv.z);
      const dir = { x: pr.vel.x / WEAPON.muzzleSpeed, y: pr.vel.y / WEAPON.muzzleSpeed, z: pr.vel.z / WEAPON.muzzleSpeed };
      expect(dir.x).toBeCloseTo(toConv.x / lenToConv, 6);
      expect(dir.y).toBeCloseTo(toConv.y / lenToConv, 6);
      expect(dir.z).toBeCloseTo(toConv.z / lenToConv, 6);
    }
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
    return { fireCooldown: 0, weaponCapacitor: WEAPON.capacitorCapacity, weaponCapacitorCooldownTimer: 0 };
  }

  it('fires up to capacity, then refuses the next shot', () => {
    const state = freshState();
    let shots = 0;
    // hold the trigger at the weapon's own fire cadence until the capacitor runs dry
    const dt = 1 / WEAPON.fireRate;
    for (let i = 0; i < 100 && state.weaponCapacitor >= 1; i++) {
      if (tryFireWeapon(WEAPON, state, true, dt, () => { shots++; })) continue;
    }
    expect(shots).toBeGreaterThan(0);
    expect(state.weaponCapacitor).toBeLessThan(1);
    // out of charge — holding the trigger fires nothing more
    const before = shots;
    expect(tryFireWeapon(WEAPON, state, true, dt, () => { shots++; })).toBe(false);
    expect(shots).toBe(before);
  });

  it('refuses to fire through the post-fire recharge delay, then allows firing again once recharged', () => {
    const state = freshState();
    // drain to empty with one shot (capacitorCapacity < 2, per panther.ts's provisional numbers)
    expect(tryFireWeapon(WEAPON, state, true, 0, () => {})).toBe(true);
    expect(state.weaponCapacitor).toBeLessThan(1);

    // still within the recharge delay — no amount of held trigger fires a round
    let firedDuringDelay = false;
    const dt = 1 / 60;
    const delayFrames = Math.ceil(WEAPON.capacitorRechargeDelaySec / dt) - 1;
    for (let i = 0; i < delayFrames; i++) {
      if (tryFireWeapon(WEAPON, state, true, dt, () => { firedDuringDelay = true; })) firedDuringDelay = true;
    }
    expect(firedDuringDelay).toBe(false);

    // enough additional time for the capacitor to recharge back above 1 shot
    const rechargeSeconds = (1 - state.weaponCapacitor) / WEAPON.capacitorRechargeRate + 1;
    for (let i = 0; i < Math.ceil(rechargeSeconds / dt); i++) {
      tryFireWeapon(WEAPON, state, false, dt, () => {});
    }
    expect(state.weaponCapacitor).toBeGreaterThanOrEqual(1);
    expect(tryFireWeapon(WEAPON, state, true, dt, () => {})).toBe(true);
  });
});
