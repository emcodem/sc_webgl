import type { CelestialBody, EnemyShip, Projectile, ShipBody } from '../core/world';
import type { Vec3 } from '../core/types';
import { length, sub } from '../math/vec';
import { applyDamage } from './health';
import { WEAPON } from './weapons';

// Sphere-vs-sphere hit test: enemy-owned rounds damage the player ship, player-owned rounds damage
// whichever alive enemy they land inside. Consumed rounds are removed. Generic over the `enemies`
// array so more opponents later needs no changes here. `onImpact` fires at the round's position for
// every landed hit (both sides), so the caller can spawn a hit spark there — see combat/effects.ts.
export function resolveHits(
  projectiles: Projectile[],
  playerShip: ShipBody,
  enemies: EnemyShip[],
  onEnemyHit?: (enemy: EnemyShip) => void,
  onEnemyDestroyed?: (enemy: EnemyShip) => void,
  onPlayerHit?: () => void,
  onImpact?: (pos: Vec3) => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];

    if (pr.owner === 'enemy') {
      if (playerShip.health.points > 0 && length(sub(pr.pos, playerShip.pos)) <= playerShip.type.hullRadius) {
        applyDamage(playerShip.health, WEAPON.damage);
        playerShip.hitFlash = 1;
        onPlayerHit?.();
        onImpact?.(pr.pos);
        projectiles.splice(i, 1);
      }
      continue;
    }

    for (const enemy of enemies) {
      if (enemy.respawnTimer > 0 || enemy.health.points <= 0) continue;
      if (length(sub(pr.pos, enemy.pos)) <= enemy.type.hullRadius) {
        const destroyed = applyDamage(enemy.health, WEAPON.damage);
        onEnemyHit?.(enemy);
        if (destroyed) onEnemyDestroyed?.(enemy);
        onImpact?.(pr.pos);
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
  onImpact?: (pos: Vec3) => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    for (const body of bodies) {
      if (length(sub(pr.pos, body.pos)) <= body.radius) {
        onImpact?.(pr.pos);
        projectiles.splice(i, 1);
        break;
      }
    }
  }
}
