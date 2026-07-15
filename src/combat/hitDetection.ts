import type { CelestialBody, EnemyShip, Projectile, ShipBody } from '../core/world';
import type { Vec3 } from '../core/types';
import { add, clamp, dot, normalize, scale, sub } from '../math/vec';
import { applyDamage } from './health';
import { WEAPON } from './weapons';

// Swept segment-vs-sphere: does the round's path this frame (prevPos → pos) pass within `radius` of
// `center`? A round travels up to ~70 m per frame (1400 m/s × the 50 ms dt clamp) against hulls only
// ~10 m across, so a bare point-in-sphere test at pos alone would let rounds tunnel clean through a
// target between frames. We test the closest point on the travel segment instead. Returns that
// contact point (clamped onto the segment) so the caller can spawn the impact where the path grazes
// the sphere rather than wherever the round happened to land past it.
function sweepHitsSphere(prev: Vec3, pos: Vec3, center: Vec3, radius: number): Vec3 | null {
  const seg = sub(pos, prev);
  const toStart = sub(prev, center);
  const segLenSq = dot(seg, seg);
  // Fraction along the segment closest to the sphere center (0 = prev, 1 = pos); degenerate
  // zero-length segment (spawn frame) collapses to a point test at prev.
  const t = segLenSq < 1e-12 ? 0 : clamp(-dot(toStart, seg) / segLenSq, 0, 1);
  const closest = add(prev, scale(seg, t));
  const d = sub(closest, center);
  return dot(d, d) <= radius * radius ? closest : null;
}

// Enemy-owned rounds damage the player ship, player-owned rounds damage whichever alive enemy their
// path crosses. Consumed rounds are removed. Generic over the `enemies` array so more opponents
// later needs no changes here. `onImpact` fires at the contact point for every landed hit (both
// sides), so the caller can spawn a hit spark there — see combat/effects.ts.
export function resolveHits(
  projectiles: Projectile[],
  playerShip: ShipBody,
  enemies: EnemyShip[],
  onEnemyHit?: (enemy: EnemyShip) => void,
  onEnemyDestroyed?: (enemy: EnemyShip) => void,
  onPlayerHit?: () => void,
  onImpact?: (pos: Vec3, normal: Vec3) => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];

    if (pr.owner === 'enemy') {
      if (playerShip.health.points > 0) {
        const hit = sweepHitsSphere(pr.prevPos, pr.pos, playerShip.pos, playerShip.type.hullRadius);
        if (hit) {
          applyDamage(playerShip.health, WEAPON.damage);
          playerShip.hitFlash = 1;
          onPlayerHit?.();
          onImpact?.(hit, normalize(sub(hit, playerShip.pos)));
          projectiles.splice(i, 1);
        }
      }
      continue;
    }

    for (const enemy of enemies) {
      if (enemy.respawnTimer > 0 || enemy.health.points <= 0) continue;
      const hit = sweepHitsSphere(pr.prevPos, pr.pos, enemy.pos, enemy.type.hullRadius);
      if (hit) {
        const destroyed = applyDamage(enemy.health, WEAPON.damage);
        onEnemyHit?.(enemy);
        if (destroyed) onEnemyDestroyed?.(enemy);
        onImpact?.(hit, normalize(sub(hit, enemy.pos)));
        projectiles.splice(i, 1);
        break;
      }
    }
  }
}

// Projectile-vs-celestial-body: any round (either owner) that enters a body's radius is consumed and
// reports an impact at its position, so firing at the moon/planet/etc. shows a hit spark instead of
// the round silently passing through. Separate from resolveHits since bodies take no damage and the
// player/enemy checks are hull-sphere, not body-radius. Call after resolveHits so a round that hit a
// ship this frame is already gone.
export function resolveObjectHits(
  projectiles: Projectile[],
  bodies: CelestialBody[],
  onImpact?: (pos: Vec3, normal: Vec3) => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    for (const body of bodies) {
      const hit = sweepHitsSphere(pr.prevPos, pr.pos, body.pos, body.radius);
      if (hit) {
        onImpact?.(hit, normalize(sub(hit, body.pos)));
        projectiles.splice(i, 1);
        break;
      }
    }
  }
}
