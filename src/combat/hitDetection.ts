import type { EnemyShip, Projectile, ShipBody } from '../core/world';
import { length, sub } from '../math/vec';
import { applyDamage } from './health';
import { WEAPON } from './weapons';

// Sphere-vs-sphere hit test: enemy-owned rounds damage the player ship, player-owned rounds damage
// whichever alive enemy they land inside. Consumed rounds are removed. Generic over the `enemies`
// array so more opponents later needs no changes here.
export function resolveHits(
  projectiles: Projectile[],
  playerShip: ShipBody,
  enemies: EnemyShip[],
  onEnemyHit?: (enemy: EnemyShip) => void,
  onEnemyDestroyed?: (enemy: EnemyShip) => void,
  onPlayerHit?: () => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];

    if (pr.owner === 'enemy') {
      if (playerShip.health.points > 0 && length(sub(pr.pos, playerShip.pos)) <= playerShip.type.hullRadius) {
        applyDamage(playerShip.health, WEAPON.damage);
        playerShip.hitFlash = 1;
        onPlayerHit?.();
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
        projectiles.splice(i, 1);
        break;
      }
    }
  }
}
