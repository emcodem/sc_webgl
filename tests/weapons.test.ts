import { describe, it, expect } from 'vitest';
import { WEAPON, spawnProjectileFrom, updateProjectiles } from '../src/combat/weapons';
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

  it('adds muzzle speed along forward on top of the shooter velocity', () => {
    const out: Projectile[] = [];
    const shooterVel = { x: 5, y: 0, z: 0 };
    spawnProjectileFrom(ORIGIN, shooterVel, FORWARD, RIGHT, UP, 'player', out);
    expect(out[0].vel).toEqual({ x: 5, y: 0, z: WEAPON.muzzleSpeed });
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
    const projectiles: Projectile[] = [{ pos: { x: 0, y: 0, z: 0 }, vel: { x: 10, y: 0, z: 0 }, age: 0, owner: 'player' }];
    updateProjectiles(projectiles, 0.5);
    expect(projectiles[0].pos.x).toBeCloseTo(5, 6);
    expect(projectiles[0].age).toBeCloseTo(0.5, 6);
  });

  it('keeps a round exactly at its lifetime boundary (age > lifetime removes, not >=)', () => {
    const projectiles: Projectile[] = [{ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: WEAPON.lifetime, owner: 'player' }];
    updateProjectiles(projectiles, 0);
    expect(projectiles).toHaveLength(1);
  });

  it('removes a round once its age exceeds lifetime', () => {
    const projectiles: Projectile[] = [{ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: WEAPON.lifetime, owner: 'player' }];
    updateProjectiles(projectiles, 0.001);
    expect(projectiles).toHaveLength(0);
  });
});
