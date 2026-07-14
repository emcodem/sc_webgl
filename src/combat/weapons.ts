import type { Vec3 } from '../core/types';
import type { Projectile } from '../core/world';

// ---------- Weapons — traveling projectiles. Hit detection lives in combat/hitDetection.ts ----------
export const WEAPON = {
  muzzleSpeed: 1400,   // m/s, added on top of the shooter's own velocity (SC-style ballistics)
  fireRate: 15,        // rounds per second while the trigger is held (1.5x the original 10)
  lifetime: 2.5,       // seconds before a round despawns
  muzzleForward: 8,    // spawn offset ahead of the ship so tracers don't clip through the hull
  damage: 1
};

// Three visually distinct hardpoints, cycled through in order on every shot: left wing, right
// wing, nose (underslung, centered). Each entry is an absolute (right, down) offset in metres,
// applied on top of forward/muzzleForward in spawnProjectileFrom. Shared across every shooter
// (player and all enemies) — which specific ship's shot advances the cycle doesn't matter, only
// that consecutive rounds from the same ship visibly rotate through its own three guns.
//
// The wing offsets are sized so a shot spawns near the left/right edge of the screen at roughly
// 20% down from the top — solved from the camera's own 70 deg vertical FOV (see render/renderer.ts)
// at muzzleForward's 8m spawn depth, assuming a representative 16:9 window: half-height there is
// 8*tan(35 deg) ~= 5.6m, half-width (x1.778 aspect) ~= 9.96m. right = 90% of that half-width
// (~9m, close to the edge without clipping); down = -(0.6 * half-height) (~-3.4m — NEGATIVE
// because spawnProjectileFrom subtracts along `up`, so a negative "down" moves the spawn point
// *up* screen, toward that 20%-from-top target) rather than the vertical screen-center a `down: 0`
// wing mount would otherwise sit at. Will drift slightly off-target at window aspects far from
// 16:9, same as any fixed 3D offset would.
const MUZZLE_MOUNTS: { right: number; down: number }[] = [
  { right: -9, down: -3.4 }, // left wing
  { right: 9, down: -3.4 },  // right wing
  { right: 0, down: 1.1 }    // nose, underslung
];
let muzzleIndex = 0;

// Spawns one round into `out`, generic over the shooter — any ShipBody or EnemyShip, since both
// carry pos/vel and a (forward, right, up) basis from computeAxes. The round leaves from whichever
// hardpoint is next in MUZZLE_MOUNTS's cycle, so consecutive shots visibly rotate between the two
// wing guns and the nose gun rather than all leaving from one spot.
export function spawnProjectileFrom(
  pos: Vec3,
  vel: Vec3,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
  owner: Projectile['owner'],
  out: Projectile[]
): void {
  const mount = MUZZLE_MOUNTS[muzzleIndex];
  const muzzleX = right.x * mount.right - up.x * mount.down + forward.x * WEAPON.muzzleForward;
  const muzzleY = right.y * mount.right - up.y * mount.down + forward.y * WEAPON.muzzleForward;
  const muzzleZ = right.z * mount.right - up.z * mount.down + forward.z * WEAPON.muzzleForward;
  out.push({
    pos: { x: pos.x + muzzleX, y: pos.y + muzzleY, z: pos.z + muzzleZ },
    vel: {
      x: vel.x + forward.x * WEAPON.muzzleSpeed,
      y: vel.y + forward.y * WEAPON.muzzleSpeed,
      z: vel.z + forward.z * WEAPON.muzzleSpeed
    },
    age: 0,
    owner
  });
  muzzleIndex = (muzzleIndex + 1) % MUZZLE_MOUNTS.length;
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
