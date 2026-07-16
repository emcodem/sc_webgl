import type { World } from '../core/world';
import { SPAWN } from '../world/celestial';
import { computeAxes } from '../math/quaternion';
import { length, sub } from '../math/vec';
import { integrateFlight, resolveBoost } from '../physics/flightModel';
import * as Keybinds from '../input/keybinds';
import * as Joystick from '../input/joystickMap';
import * as MouseButtons from '../input/mouseButtons';
import * as MouseLook from '../input/mouseLook';
import { think } from './enemyAI';
import { createHealth } from './health';
import { resolveHits, resolveObjectHits } from './hitDetection';
import { spawnExplosion, spawnImpact, updateEffects } from './effects';
import { spawnProjectileFrom, updateProjectiles, WEAPON, FIRE_COOLDOWN_SEC } from './weapons';
import { findActivePip } from './pipTargeting';

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
  // Converge the offset guns at the soft-locked target's range (the PIP's firing solution) so rounds
  // meet right at the pip; with no lock, spawnProjectileFrom falls back to its default harmonization.
  const cam = { pos: ship.pos, axes };
  const pip = findActivePip(ship.pos, ship.vel, cam, world.enemies, window.innerWidth, window.innerHeight);
  const convergeDist = pip
    ? length(sub(pip.lead, ship.pos))
    : WEAPON.convergeDist;
  spawnProjectileFrom(ship.pos, ship.vel, axes.forward, axes.right, axes.up, 'player', world.projectiles, convergeDist);
  ship.fireCooldown = FIRE_COOLDOWN_SEC;
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
        enemy.pos = { x: enemy.spawnPos.x, y: enemy.spawnPos.y, z: enemy.spawnPos.z };
        enemy.vel = { x: 0, y: 0, z: 0 };
        enemy.quat = { x: enemy.spawnQuat.x, y: enemy.spawnQuat.y, z: enemy.spawnQuat.z, w: enemy.spawnQuat.w };
        enemy.angVel = { pitch: 0, yaw: 0, roll: 0 };
        enemy.health = createHealth(enemy.health.maxPoints);
      }
      continue;
    }
    if (!enemy.ai) continue; // static free-flight ships (core/player.ts) have no 'ai' and just sit
                              // in place; only a moving free-flight ship or a scenario's fighter
                              // ever has one, and scenarios are driven by
                              // scenarios/runtime.ts::updateScenario, not stepCombat

    const decision = think(enemy, enemy.ai, ship, dt);
    const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
    enemy.boostMeter = boost.boostMeter;
    enemy.boosting = boost.boosting;
    enemy.boostCooldownTimer = boost.cooldownTimer;
    integrateFlight(enemy, decision.inputs, dt);
    // Free-flight opponents fly and maneuver but never fire — this is a sandbox to practice flying
    // and shooting AT them, not a dogfight where they shoot back. Scenarios (updateScenario) are the
    // only place enemies actually open fire.
  }

  updateProjectiles(world.projectiles, dt);

  resolveHits(
    world.projectiles,
    ship,
    world.enemies,
    () => { world.hitMarkerTimer = 0.15; },
    (enemy) => { enemy.respawnTimer = RESPAWN_DELAY; spawnExplosion(world.effects, enemy.pos); },
    undefined,
    (pos, normal) => spawnImpact(world.effects, pos, normal)
  );
  resolveObjectHits(world.projectiles, world.bodies, (pos, normal) => spawnImpact(world.effects, pos, normal));
  updateEffects(world.effects, dt);

  world.hitMarkerTimer = Math.max(0, world.hitMarkerTimer - dt);
}
