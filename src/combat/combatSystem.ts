import type { World } from '../core/world';
import { ENEMY_SPAWN, SPAWN } from '../world/celestial';
import { computeAxes } from '../math/quaternion';
import { length, sub } from '../math/vec';
import { integrateFlight, resolveBoost } from '../physics/flightModel';
import * as Keybinds from '../input/keybinds';
import * as Joystick from '../input/joystickMap';
import * as MouseButtons from '../input/mouseButtons';
import * as MouseLook from '../input/mouseLook';
import { canFire, think } from './enemyAI';
import { createHealth } from './health';
import { resolveHits } from './hitDetection';
import { spawnProjectileFrom, updateProjectiles, WEAPON } from './weapons';

// ============================================================================================
// Per-frame combat orchestration: player weapon fire, enemy AI + flight + weapon fire, projectile
// travel, hit resolution, and destroy/respawn bookkeeping for both sides. Runs every frame
// regardless of pilot/on-foot mode — the ship (and any enemies) keep fighting even while the player
// is out walking around it.
// ============================================================================================

const RESPAWN_DELAY = 3; // seconds a destroyed ship waits before respawning at its spawn point

// Reads the player's current fire input (keybind/joystick/mouse) and, if the trigger is held and
// the cooldown has elapsed, spawns a round. Decrements fireCooldown unconditionally so it always
// ticks down regardless of whether the trigger is actually held. Shared by stepCombat (free-flight
// sandbox) and scenarios/runtime.ts::updateScenario (scenarios don't respawn the player ship on
// death — they end the run instead — but still need this exact fire-input handling).
export function firePlayerWeaponIfRequested(world: World, dt: number): boolean {
  const player = world.player;
  const ship = player.ship;
  ship.fireCooldown -= dt;
  // mouse click only counts once the pointer is actually captured, so the very first click on the
  // canvas just captures the mouse instead of also firing
  const mouseReady = MouseLook.isCaptured();
  const firing = Keybinds.isActive('primaryFire') || Joystick.isButtonPressed('primaryFire') ||
    (mouseReady && MouseButtons.isPressed('primaryFire'));
  if (player.mode !== 'pilot' || !firing || ship.fireCooldown > 0) return false;
  const axes = computeAxes(ship.quat);
  spawnProjectileFrom(ship.pos, ship.vel, axes.forward, axes.right, axes.up, 'player', world.projectiles);
  ship.fireCooldown = 1 / WEAPON.fireRate;
  return true;
}

export function stepCombat(world: World, dt: number): void {
  const player = world.player;
  const ship = player.ship;

  if (ship.respawnTimer > 0) {
    ship.respawnTimer -= dt;
    if (ship.respawnTimer <= 0) {
      ship.pos = { x: SPAWN.pos.x, y: SPAWN.pos.y, z: SPAWN.pos.z };
      ship.vel = { x: 0, y: 0, z: 0 };
      ship.quat = { x: SPAWN.quat.x, y: SPAWN.quat.y, z: SPAWN.quat.z, w: SPAWN.quat.w };
      ship.angVel = { pitch: 0, yaw: 0, roll: 0 };
      ship.health = createHealth(ship.health.maxPoints);
    }
  } else if (ship.health.points <= 0) {
    ship.respawnTimer = RESPAWN_DELAY;
  } else {
    firePlayerWeaponIfRequested(world, dt);
  }
  ship.hitFlash = Math.max(0, ship.hitFlash - dt * 2);

  for (const enemy of world.enemies) {
    if (enemy.respawnTimer > 0) {
      enemy.respawnTimer -= dt;
      if (enemy.respawnTimer <= 0) {
        enemy.pos = { x: ENEMY_SPAWN.pos.x, y: ENEMY_SPAWN.pos.y, z: ENEMY_SPAWN.pos.z };
        enemy.vel = { x: 0, y: 0, z: 0 };
        enemy.quat = { x: ENEMY_SPAWN.quat.x, y: ENEMY_SPAWN.quat.y, z: ENEMY_SPAWN.quat.z, w: ENEMY_SPAWN.quat.w };
        enemy.angVel = { pitch: 0, yaw: 0, roll: 0 };
        enemy.health = createHealth(enemy.health.maxPoints);
      }
      continue;
    }
    if (!enemy.ai) continue; // free-flight sandbox enemies always have 'ai' (see core/player.ts);
                              // only a scenario's non-fighter enemies ever lack it, and scenarios
                              // are driven by scenarios/runtime.ts::updateScenario, not stepCombat

    const decision = think(enemy, enemy.ai, ship, dt);
    const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
    enemy.boostMeter = boost.boostMeter;
    enemy.boosting = boost.boosting;
    enemy.boostCooldownTimer = boost.cooldownTimer;
    integrateFlight(enemy, decision.inputs, dt);

    enemy.fireCooldown -= dt;
    if (decision.wantsToFire && enemy.fireCooldown <= 0) {
      const axes = computeAxes(enemy.quat);
      const dist = length(sub(ship.pos, enemy.pos));
      if (canFire(axes.forward, decision.aimDir, dist, enemy.ai.tuning)) {
        spawnProjectileFrom(enemy.pos, enemy.vel, axes.forward, axes.right, axes.up, 'enemy', world.projectiles);
        enemy.fireCooldown = 1 / WEAPON.fireRate;
      }
    }
  }

  updateProjectiles(world.projectiles, dt);

  resolveHits(
    world.projectiles,
    ship,
    world.enemies,
    () => { world.hitMarkerTimer = 0.15; },
    (enemy) => { enemy.respawnTimer = RESPAWN_DELAY; }
  );

  world.hitMarkerTimer = Math.max(0, world.hitMarkerTimer - dt);
}
