import type { Vec3 } from '../core/types';
import type { Projectile } from '../core/world';
import { add, scale } from '../math/vec';

// ---------- Weapons — traveling projectiles. Hit detection lives in combat/hitDetection.ts ----------
export const WEAPON = {
  muzzleSpeed: 1400,   // m/s, added on top of the shooter's own velocity (SC-style ballistics)
  fireRate: 10,        // rounds per second while the trigger is held
  lifetime: 2.5,       // seconds before a round despawns
  muzzleForward: 8,    // spawn offset ahead of the ship so tracers don't clip through the hull
  damage: 1
};

// Spawns one round into `out`, generic over the shooter — any ShipBody or EnemyShip, since both
// carry pos/vel and a forward direction from computeAxes.
export function spawnProjectileFrom(
  pos: Vec3,
  vel: Vec3,
  forward: Vec3,
  owner: Projectile['owner'],
  out: Projectile[]
): void {
  out.push({
    pos: add(pos, scale(forward, WEAPON.muzzleForward)),
    vel: add(vel, scale(forward, WEAPON.muzzleSpeed)),
    age: 0,
    owner
  });
}

// Advances every round by dt and removes any that have outlived WEAPON.lifetime.
export function updateProjectiles(projectiles: Projectile[], dt: number): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;
    pr.pos.z += pr.vel.z * dt;
    pr.age += dt;
    if (pr.age > WEAPON.lifetime) projectiles.splice(i, 1);
  }
}
