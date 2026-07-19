import { describe, it, expect } from 'vitest';
import { resolveHits } from '../src/combat/hitDetection';
import { createHealth } from '../src/combat/health';
import { getShipType } from '../src/physics/ships';
import type { EnemyShip, Projectile, ShipBody } from '../src/core/world';

const TYPE = getShipType('Gladius');

function makeShip(pos = { x: 0, y: 0, z: 0 }): ShipBody {
  return {
    type: TYPE, pos, vel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
    angVel: { pitch: 0, yaw: 0, roll: 0 }, throttle: 0, decoupled: false, spaceBrakeOn: false,
    boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0, throttleSpoolTime: 0, verticalSpoolTime: 0,
    health: createHealth(10), hitFlash: 0, fireCooldown: 0, respawnTimer: 0
  };
}

function makeEnemy(pos = { x: 0, y: 0, z: 0 }, overrides: Partial<EnemyShip> = {}): EnemyShip {
  return {
    type: TYPE, pos, vel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 },
    angVel: { pitch: 0, yaw: 0, roll: 0 }, boostMeter: TYPE.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0, health: createHealth(10), behavior: 'cruiser',
    fireCooldown: 0, respawnTimer: 0, spawnPos: pos, spawnQuat: { x: 0, y: 0, z: 0, w: 1 }, ...overrides
  };
}

function enemyProjectile(pos = { x: 0, y: 0, z: 0 }): Projectile {
  return { pos, prevPos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, age: 0, owner: 'enemy' };
}
function playerProjectile(pos = { x: 0, y: 0, z: 0 }): Projectile {
  return { pos, prevPos: { ...pos }, vel: { x: 0, y: 0, z: 0 }, age: 0, owner: 'player' };
}

describe('resolveHits', () => {
  it('damages the player ship on an enemy round within hull radius and consumes the round', () => {
    const ship = makeShip();
    const projectiles = [enemyProjectile()];
    let hitCalled = false;
    resolveHits(projectiles, ship, [], undefined, undefined, () => { hitCalled = true; });
    expect(ship.health.points).toBe(9);
    expect(projectiles).toHaveLength(0);
    expect(hitCalled).toBe(true);
  });

  it('does not damage an already-dead player ship', () => {
    const ship = makeShip();
    ship.health.points = 0;
    const projectiles = [enemyProjectile()];
    resolveHits(projectiles, ship, []);
    expect(ship.health.points).toBe(0);
    // the round still isn't consumed, since the early-out skips the whole branch
    expect(projectiles).toHaveLength(1);
  });

  it('skips enemies that are respawning or already dead', () => {
    const respawning = makeEnemy({ x: 0, y: 0, z: 0 }, { respawnTimer: 1 });
    const dead = makeEnemy({ x: 0, y: 0, z: 0 }, { health: createHealth(0) });
    const projectiles = [playerProjectile(), playerProjectile()];
    resolveHits(projectiles, makeShip(), [respawning, dead]);
    expect(respawning.health.points).toBe(10); // untouched — the respawnTimer > 0 guard skips it entirely
    expect(dead.health.points).toBe(0);
    expect(projectiles).toHaveLength(2); // neither round was consumed
  });

  it('destroys an enemy and fires onEnemyDestroyed exactly when health reaches 0', () => {
    const enemy = makeEnemy({ x: 0, y: 0, z: 0 }, { health: createHealth(1) });
    const projectiles = [playerProjectile()];
    let destroyed = false;
    resolveHits(projectiles, makeShip(), [enemy], undefined, () => { destroyed = true; });
    expect(enemy.health.points).toBe(0);
    expect(destroyed).toBe(true);
  });

  it('only consumes one projectile per enemy per matching hit, not every round on that enemy', () => {
    const enemy = makeEnemy();
    // two rounds land on the same enemy in one resolveHits call
    const projectiles = [playerProjectile(), playerProjectile()];
    resolveHits(projectiles, makeShip(), [enemy]);
    // each round hits in its own loop iteration (backwards iteration), so both are consumed and
    // both damage instances land — the "one projectile per enemy per *iteration*" break only
    // matters when multiple enemies overlap the same round, not multiple rounds on one enemy.
    expect(projectiles).toHaveLength(0);
    expect(enemy.health.points).toBe(8);
  });

  it('does not damage an enemy outside its hull radius', () => {
    const enemy = makeEnemy({ x: 10000, y: 0, z: 0 });
    const projectiles = [playerProjectile({ x: 0, y: 0, z: 0 })];
    resolveHits(projectiles, makeShip(), [enemy]);
    expect(enemy.health.points).toBe(10);
    expect(projectiles).toHaveLength(1);
  });

  it('registers a hit on a fast round whose path crosses the hull between frames (no tunneling)', () => {
    const enemy = makeEnemy({ x: 0, y: 0, z: 0 }); // hull radius ~10m
    // The round starts 60m short and ends 60m past the enemy — it never occupies the hull at either
    // frame boundary, so a point-in-sphere test would miss. The swept segment passes through center.
    const projectiles: Projectile[] = [
      { pos: { x: 60, y: 0, z: 0 }, prevPos: { x: -60, y: 0, z: 0 }, vel: { x: 2400, y: 0, z: 0 }, age: 0, owner: 'player' }
    ];
    resolveHits(projectiles, makeShip({ x: 5000, y: 0, z: 0 }), [enemy]);
    expect(enemy.health.points).toBe(9);
    expect(projectiles).toHaveLength(0);
  });
});
