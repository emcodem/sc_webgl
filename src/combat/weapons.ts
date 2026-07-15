import type { Vec3 } from '../core/types';
import type { Projectile } from '../core/world';

// ---------- Weapons — traveling projectiles. Hit detection lives in combat/hitDetection.ts ----------
export const WEAPON = {
  muzzleSpeed: 1400,   // m/s, added on top of the shooter's own velocity (SC-style ballistics)
  fireRate: 15,        // rounds per second while the trigger is held (1.5x the original 10)
  lifetime: 2.5,       // seconds before a round despawns
  muzzleForward: 8,    // spawn offset ahead of the ship so tracers don't clip through the hull
  damage: 1,
  // Weapon convergence ("harmonization"): the offset guns are toed-in so their bore lines cross at
  // a point on the boresight this far ahead when no target range is known. With a soft-locked
  // target (a PIP), callers pass the target's range instead so rounds converge right at the pip.
  convergeDist: 800,   // metres — default harmonization range
  minConvergeDist: 150 // clamp: closer than this the toe-in angle gets silly (and would invert below muzzleForward)
};

// Seconds between shots — what fireCooldown is reset to after every round leaves the barrel. Derived
// from fireRate so the two can't drift; shared by the player and every AI shooter (combatSystem +
// scenarios/runtime) rather than each re-deriving `1 / WEAPON.fireRate` inline.
export const FIRE_COOLDOWN_SEC = 1 / WEAPON.fireRate;

// Three visually distinct hardpoints, cycled through in order on every shot: left wing, right
// wing, nose (underslung, centered). Each entry is an absolute (right, down) offset in metres,
// applied on top of forward/muzzleForward in spawnProjectileFrom. Shared across every shooter
// (player and all enemies) — which specific ship's shot advances the cycle doesn't matter, only
// that consecutive rounds from the same ship visibly rotate through its own three guns.
//
// The offsets are solved from the camera's own 70 deg vertical FOV (see render/renderer.ts) at
// muzzleForward's 8m spawn depth, assuming a representative 16:9 window: half-height there is
// 8*tan(35 deg) ~= 5.6m and half-width (x1.778 aspect) ~= 9.96m, so the screen edges sit at
// right = +/-9.96 (left/right border), down = +5.6 (bottom border) and down = -5.6 (top). `down`
// is POSITIVE toward the bottom of the screen (spawnProjectileFrom subtracts along `up`, and up is
// -Y in this convention). The two wing guns fire from the left/right borders at 20% of screen
// height up from the bottom (down = 5.6 - 0.2*11.2 = 3.36); the nose gun fires from the
// bottom-center of the screen (down = +5.6). Will drift slightly off-target at window aspects far
// from 16:9, same as any fixed 3D offset would.
const MUZZLE_MOUNTS: { right: number; down: number }[] = [
  { right: -9.96, down: 3.36 }, // left wing — left border, 20% up from bottom
  { right: 9.96, down: 3.36 },  // right wing — right border, 20% up from bottom
  { right: 0, down: 5.6 }       // nose — bottom-center of screen
];
let muzzleIndex = 0;

// Spawns one round into `out`, generic over the shooter — any ShipBody or EnemyShip, since both
// carry pos/vel and a (forward, right, up) basis from computeAxes. The round leaves from whichever
// hardpoint is next in MUZZLE_MOUNTS's cycle, so consecutive shots visibly rotate between the two
// wing guns and the nose gun rather than all leaving from one spot.
//
// Convergence: rather than firing parallel to the nose, each barrel aims from its own muzzle toward
// a single convergence point sitting `convergeDist` metres straight ahead on the boresight, so the
// left/right/nose tracers cross there. Pass the current target's range as `convergeDist` to make
// them meet right at the PIP; omit it to fall back to WEAPON.convergeDist. The point stays on the
// boresight (forward axis), so shots still go where the crosshair points — the guns just toe-in.
export function spawnProjectileFrom(
  pos: Vec3,
  vel: Vec3,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
  owner: Projectile['owner'],
  out: Projectile[],
  convergeDist: number = WEAPON.convergeDist
): void {
  const mount = MUZZLE_MOUNTS[muzzleIndex];
  const muzzleX = pos.x + right.x * mount.right - up.x * mount.down + forward.x * WEAPON.muzzleForward;
  const muzzleY = pos.y + right.y * mount.right - up.y * mount.down + forward.y * WEAPON.muzzleForward;
  const muzzleZ = pos.z + right.z * mount.right - up.z * mount.down + forward.z * WEAPON.muzzleForward;

  // Convergence point on the boresight, ahead of the ship center. Clamped so the toe-in angle stays
  // sane and can never fall behind the muzzle (which would fire the round backwards).
  const cd = Math.max(convergeDist, WEAPON.minConvergeDist);
  const convX = pos.x + forward.x * cd;
  const convY = pos.y + forward.y * cd;
  const convZ = pos.z + forward.z * cd;

  // Fire direction = from this muzzle toward the convergence point, renormalised to muzzleSpeed.
  let dirX = convX - muzzleX, dirY = convY - muzzleY, dirZ = convZ - muzzleZ;
  const invLen = 1 / (Math.hypot(dirX, dirY, dirZ) || 1);
  dirX *= invLen; dirY *= invLen; dirZ *= invLen;

  out.push({
    pos: { x: muzzleX, y: muzzleY, z: muzzleZ },
    prevPos: { x: muzzleX, y: muzzleY, z: muzzleZ }, // no travel yet — a spawn-frame hit sweeps a point
    vel: {
      x: vel.x + dirX * WEAPON.muzzleSpeed,
      y: vel.y + dirY * WEAPON.muzzleSpeed,
      z: vel.z + dirZ * WEAPON.muzzleSpeed
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
    pr.prevPos.x = pr.pos.x;
    pr.prevPos.y = pr.pos.y;
    pr.prevPos.z = pr.pos.z;
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;
    pr.pos.z += pr.vel.z * dt;
    pr.age += dt;
    if (pr.age > WEAPON.lifetime) projectiles.splice(i, 1);
  }
}
