import type { World, EnemyShip } from '../core/world';
import type { EnemySpawnConfig, ScenarioConfig, ScenarioRuntime } from './types';
import { createHealth } from '../combat/health';
import { resolveHits, resolveObjectHits } from '../combat/hitDetection';
import { spawnExplosion, spawnImpact, updateEffects } from '../combat/effects';
import { firePlayerWeaponIfRequested } from '../combat/combatSystem';
import { canFire, canFireWithinTolerance, spawnFighterAI, think } from '../combat/enemyAI';
import { CHASER_TUNING, chaserThink, cruiseThink } from '../combat/ai/simpleAI';
import {
  ORBITER_TUNING, DRIFTER_TUNING, driftThink, orbiterThink, spawnDriftState, spawnOrbitState
} from '../combat/ai/orbiterDrifterAI';
import { EVASIVE_TUNING, evasiveThink, spawnEvasiveState } from '../combat/ai/evasiveAI';
import { spawnProjectileFrom, updateProjectiles, FIRE_COOLDOWN_SEC } from '../combat/weapons';
import { computeAxes, lookAtQuat, rotateTowards } from '../math/quaternion';
import { integrateFlight, resolveBoost } from '../physics/flightModel';
import { evaluateGateCrossing } from './gatePath';
import { SPAWN } from '../world/celestial';

// ============================================================================================
// The scenario engine — a second, parallel top-level step function to combat/combatSystem.ts's
// stepCombat (main.ts picks one or the other per frame, never both). Ported from the original
// project's scenarios/runtime.ts, adapted so world.enemies IS the active scenario's enemy list
// (no separate ScenarioRuntime.enemies array — see scenarios/types.ts's doc comment) and so player
// weapon fire goes through combat/combatSystem.ts's shared firePlayerWeaponIfRequested instead of
// duplicating that input-handling block.
// ============================================================================================

// Enemy only opens fire once its nose is roughly on target (~3 degrees) — gives the turret a
// visible "tracking, not yet locked" phase instead of hosing the player from any angle.
const AIM_FIRE_CONE_RAD = 0.05;

function spawnEnemyFromConfig(spawn: EnemySpawnConfig, config: ScenarioConfig): EnemyShip {
  return {
    type: spawn.type,
    pos: { x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z },
    quat: { x: spawn.quat.x, y: spawn.quat.y, z: spawn.quat.z, w: spawn.quat.w },
    vel: spawn.initialVel ? { x: spawn.initialVel.x, y: spawn.initialVel.y, z: spawn.initialVel.z } : { x: 0, y: 0, z: 0 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: spawn.type.boostCapacity,
    boosting: false,
    boostCooldownTimer: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(config.hitsToKillEnemy),
    behavior: spawn.behavior,
    turnRateRadPerSec: spawn.turnRateRadPerSec,
    ai: spawn.behavior === 'fighter' ? spawnFighterAI(spawn.tuning) : undefined,
    fireCooldown: 0,
    respawnTimer: 0,
    // unused by scenarios — updateScenario() never resets a dead enemy to a spawn point (see the
    // loop below); only combatSystem.ts's free-flight stepCombat reads spawnPos/spawnQuat.
    spawnPos: { x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z },
    spawnQuat: { x: spawn.quat.x, y: spawn.quat.y, z: spawn.quat.z, w: spawn.quat.w }
  };
}

export function startScenario(world: World, config: ScenarioConfig): void {
  const ship = world.player.ship;
  // Full reset to SPAWN (not just health/vel like the original) — sc_webgl's player can be
  // anywhere (out at the moon, etc.) when the menu opens, and every scenario's enemy spawn
  // positions are absolute coordinates near SPAWN.pos, not wherever the player happens to be.
  ship.pos = { x: SPAWN.pos.x, y: SPAWN.pos.y, z: SPAWN.pos.z };
  ship.quat = { x: SPAWN.quat.x, y: SPAWN.quat.y, z: SPAWN.quat.z, w: SPAWN.quat.w };
  ship.vel = config.playerInitialVel
    ? { x: config.playerInitialVel.x, y: config.playerInitialVel.y, z: config.playerInitialVel.z }
    : { x: 0, y: 0, z: 0 };
  ship.angVel = { pitch: 0, yaw: 0, roll: 0 };
  ship.decoupled = false;
  ship.spaceBrakeOn = false;
  ship.boosting = false;
  ship.boostMeter = ship.type.boostCapacity;
  ship.boostCooldownTimer = 0;
  ship.throttleSpoolTime = 0;
  ship.verticalSpoolTime = 0;
  ship.hitFlash = 0;
  ship.fireCooldown = 0;
  ship.respawnTimer = 0;
  ship.health = createHealth(config.hitsToKillPlayer);

  const enemies = config.enemySpawns.map(spawn => spawnEnemyFromConfig(spawn, config));

  // 'orbiter'/'drifter'/'evasive' spawns don't fly from their config pos/quat — they get a fresh
  // randomized flight path (or, for 'evasive', a standoff station right in front of the player)
  // immediately on scenario start, same convention as how 'chaser'/'fighter' spawns immediately
  // take over steering.
  const aggressiveness = config.droneAggressiveness ?? 0.5;
  for (const enemy of enemies) {
    if (enemy.behavior === 'orbiter') {
      enemy.orbit = spawnOrbitState(ship.pos, aggressiveness);
    } else if (enemy.behavior === 'drifter') {
      const s = spawnDriftState(ship, aggressiveness);
      enemy.pos = s.pos;
      enemy.vel = s.vel;
      enemy.quat = lookAtQuat(s.vel);
      enemy.drift = { respawnTimer: 0 };
    } else if (enemy.behavior === 'evasive') {
      // spawns already holding its standoff station dead ahead of the player, nose-on and
      // roll-matched, rather than needing a tick to fly/turn there from an arbitrary config
      // pos/quat (same placeholder-pos convention as orbiter/drifter spawns above)
      const { forward, up } = computeAxes(ship.quat);
      enemy.pos = {
        x: ship.pos.x + forward.x * EVASIVE_TUNING.standoffDistance,
        y: ship.pos.y + forward.y * EVASIVE_TUNING.standoffDistance,
        z: ship.pos.z + forward.z * EVASIVE_TUNING.standoffDistance
      };
      // faces back toward the player (see evasiveThink's doc comment on why the nose always does),
      // not the direction it's facing away toward — lookAtQuat's forward arg is negated accordingly
      enemy.quat = lookAtQuat({ x: -forward.x, y: -forward.y, z: -forward.z }, up);
      enemy.vel = { x: ship.vel.x, y: ship.vel.y, z: ship.vel.z };
      enemy.evasive = spawnEvasiveState();
    }
  }

  world.enemies = enemies;
  world.projectiles = [];
  world.effects = []; // clear any lingering free-flight bursts so they don't carry into the drill
  world.scenario = {
    config,
    outcome: 'active',
    elapsedSec: 0,
    gateIndex: 0,
    stats: { shotsFired: 0, hitsLanded: 0, kills: 0, hitsTaken: 0 },
    bubbleTimeSec: 0
  };
}

export function bubbleTicks(runtime: ScenarioRuntime): number {
  return Math.floor(runtime.bubbleTimeSec / 0.1);
}

export function updateScenario(world: World, dt: number): void {
  const runtime = world.scenario;
  if (!runtime || runtime.outcome !== 'active') return;
  runtime.elapsedSec += dt;

  const player = world.player.ship;
  if (firePlayerWeaponIfRequested(world, dt)) runtime.stats.shotsFired++;

  for (const enemy of world.enemies) {
    // 'orbiter'/'drifter' handle their own dead-state below (countdown + respawn) — everything else
    // (turret/chaser/fighter/cruiser) just stays dead once destroyed, per the 'destroy' scenarios'
    // design. Skipping dead orbiters/drifters here too would make that respawn code unreachable.
    if (enemy.health.points <= 0 && enemy.behavior !== 'orbiter' && enemy.behavior !== 'drifter') continue;

    switch (enemy.behavior) {
      case 'cruiser':
        cruiseThink(enemy, dt);
        break;

      case 'chaser': {
        const decision = chaserThink(enemy, player);
        const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
        enemy.boostMeter = boost.boostMeter;
        enemy.boosting = boost.boosting;
        enemy.boostCooldownTimer = boost.cooldownTimer;
        integrateFlight(enemy, decision.inputs, dt);

        enemy.fireCooldown -= dt;
        if (decision.wantsToFire && enemy.fireCooldown <= 0) {
          // re-check aim post-rotation — see canFireWithinTolerance's doc comment for why.
          const { forward, right, up } = computeAxes(enemy.quat);
          const dist = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y, player.pos.z - enemy.pos.z);
          if (canFireWithinTolerance(forward, decision.aimDir, dist, CHASER_TUNING.fireRange, CHASER_TUNING.fireLateralTolerance)) {
            spawnProjectileFrom(enemy.pos, enemy.vel, forward, right, up, 'enemy', world.projectiles, dist);
            enemy.fireCooldown = FIRE_COOLDOWN_SEC;
          }
        }
        break;
      }

      case 'fighter': {
        if (!enemy.ai) break;
        const decision = think(enemy, enemy.ai, player, dt);
        const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
        enemy.boostMeter = boost.boostMeter;
        enemy.boosting = boost.boosting;
        enemy.boostCooldownTimer = boost.cooldownTimer;
        integrateFlight(enemy, decision.inputs, dt);

        enemy.fireCooldown -= dt;
        if (decision.wantsToFire && enemy.fireCooldown <= 0) {
          // re-check aim post-rotation — see canFire's doc comment for why that ordering matters.
          const { forward, right, up } = computeAxes(enemy.quat);
          const dist = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y, player.pos.z - enemy.pos.z);
          if (canFire(forward, decision.aimDir, dist, enemy.ai.tuning)) {
            spawnProjectileFrom(enemy.pos, enemy.vel, forward, right, up, 'enemy', world.projectiles, dist);
            enemy.fireCooldown = FIRE_COOLDOWN_SEC;
          }
        }
        break;
      }

      case 'turret': {
        // stays put, just turns to face the player at its capped rate and fires once boresighted
        const toPlayer = {
          x: player.pos.x - enemy.pos.x,
          y: player.pos.y - enemy.pos.y,
          z: player.pos.z - enemy.pos.z
        };
        const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
        if (dist < 1e-6) break;

        const targetQuat = lookAtQuat(toPlayer);
        enemy.quat = rotateTowards(enemy.quat, targetQuat, (enemy.turnRateRadPerSec ?? 0) * dt);

        const { forward, right, up } = computeAxes(enemy.quat);
        const aimDot = (toPlayer.x * forward.x + toPlayer.y * forward.y + toPlayer.z * forward.z) / dist;
        const aimAngle = Math.acos(Math.min(1, Math.max(-1, aimDot)));

        enemy.fireCooldown -= dt;
        if (aimAngle <= AIM_FIRE_CONE_RAD && enemy.fireCooldown <= 0) {
          spawnProjectileFrom(enemy.pos, enemy.vel, forward, right, up, 'enemy', world.projectiles, dist);
          enemy.fireCooldown = FIRE_COOLDOWN_SEC;
        }
        break;
      }
      case 'evasive': {
        if (!enemy.evasive) break;
        const decision = evasiveThink(enemy, enemy.evasive, player, dt, runtime.config.evasiveReturnFire === true);
        const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
        enemy.boostMeter = boost.boostMeter;
        enemy.boosting = boost.boosting;
        enemy.boostCooldownTimer = boost.cooldownTimer;
        integrateFlight(enemy, decision.inputs, dt);

        enemy.fireCooldown -= dt;
        if (decision.wantsToFire && enemy.fireCooldown <= 0) {
          // re-check aim post-rotation — see canFireWithinTolerance's doc comment for why.
          const { forward, right, up } = computeAxes(enemy.quat);
          const dist = Math.hypot(player.pos.x - enemy.pos.x, player.pos.y - enemy.pos.y, player.pos.z - enemy.pos.z);
          if (canFireWithinTolerance(forward, decision.aimDir, dist, EVASIVE_TUNING.fireRange, EVASIVE_TUNING.fireLateralTolerance)) {
            spawnProjectileFrom(enemy.pos, enemy.vel, forward, right, up, 'enemy', world.projectiles, dist);
            enemy.fireCooldown = FIRE_COOLDOWN_SEC;
          }
        }
        break;
      }

      case 'orbiter': {
        if (enemy.health.points <= 0) {
          if (enemy.orbit) {
            // respawnTimer counts UP elapsed dead-time, so the very first dead frame doesn't
            // instantly respawn it — spawnOrbitState() below resets it to 0 for the next death.
            enemy.orbit.respawnTimer += dt;
            if (enemy.orbit.respawnTimer >= ORBITER_TUNING.respawnDelaySec) {
              enemy.health = createHealth(runtime.config.hitsToKillEnemy);
              enemy.orbit = spawnOrbitState(player.pos, runtime.config.droneAggressiveness ?? 0.5);
            }
          }
          break;
        }
        orbiterThink(enemy, player, dt);
        break;
      }

      case 'drifter': {
        if (enemy.health.points <= 0) {
          if (enemy.drift) {
            enemy.drift.respawnTimer += dt; // see the orbiter branch above for why this counts up
            if (enemy.drift.respawnTimer >= DRIFTER_TUNING.respawnDelaySec) {
              enemy.health = createHealth(runtime.config.hitsToKillEnemy);
              const s = spawnDriftState(player, runtime.config.droneAggressiveness ?? 0.5);
              enemy.pos = s.pos;
              enemy.vel = s.vel;
              enemy.quat = lookAtQuat(s.vel);
              enemy.drift.respawnTimer = 0;
              enemy.drift.rollTimer = 0;
              enemy.drift.rollCooldown = 0;
              enemy.drift.turn = undefined; // in case it died mid turn-around
            }
          }
          break;
        }
        // no out-of-range teleport here — driftThink itself banks into a turn-around once it's
        // flown too far (see DRIFTER_TUNING.turnDist), so the same drone keeps making passes
        // indefinitely
        driftThink(enemy, player, dt, runtime.config.droneAggressiveness ?? 0.5);
        break;
      }

      default:
        break;
    }
  }

  // advance rounds first, THEN resolve hits against this frame's travel segment — same order as
  // combat/combatSystem.ts::stepCombat, so free-flight and scenarios resolve identical shots
  // identically (and so the swept hit test sees the freshly-updated prevPos→pos path)
  updateProjectiles(world.projectiles, dt);

  resolveHits(
    world.projectiles,
    player,
    world.enemies,
    () => { runtime.stats.hitsLanded++; },
    (enemy) => {
      runtime.stats.kills++;
      spawnExplosion(world.effects, enemy.pos);
    },
    () => { runtime.stats.hitsTaken++; },
    (pos, normal) => spawnImpact(world.effects, pos, normal)
  );
  resolveObjectHits(world.projectiles, world.bodies, (pos, normal) => spawnImpact(world.effects, pos, normal));

  if (runtime.config.rangeBubbleRadius !== undefined) {
    const bubbleRadius = runtime.config.rangeBubbleRadius;
    const insideBubble = world.enemies.some(enemy =>
      enemy.health.points > 0 &&
      Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z) <= bubbleRadius
    );
    if (insideBubble) runtime.bubbleTimeSec += dt;
  }

  updateEffects(world.effects, dt);

  if (player.health.points <= 0) {
    runtime.outcome = 'lost';
    runtime.failReason = 'died';
  } else if (runtime.config.winCondition === 'destroy') {
    if (world.enemies.every(e => e.health.points <= 0)) runtime.outcome = 'won';
  } else if (runtime.config.winCondition === 'survive') {
    // surviveDurationSec omitted means indefinite — the drill only ends when the player backs out
    // to the menu, it never auto-wins on a timer.
    const duration = runtime.config.surviveDurationSec;
    if (duration !== undefined && runtime.elapsedSec >= duration) runtime.outcome = 'won';
  } else {
    // 'gates' — advance/fail against the current target gate, then check the course-complete /
    // timeout conditions. Order matters: a gate clear on the final gate should win immediately, not
    // fall through to a timeout check that never gets the chance to matter.
    const gates = runtime.config.gatePath ?? [];
    const gate = gates[runtime.gateIndex];
    if (gate) {
      const crossing = evaluateGateCrossing(player.pos, gate);
      if (crossing === 'cleared') runtime.gateIndex++;
      else if (crossing === 'missed') {
        runtime.outcome = 'lost';
        runtime.failReason = 'missedGate';
      }
    }
    if (runtime.outcome === 'active') {
      if (runtime.gateIndex >= gates.length) {
        runtime.outcome = 'won';
      } else if (runtime.config.surviveDurationSec !== undefined && runtime.elapsedSec > runtime.config.surviveDurationSec) {
        runtime.outcome = 'lost';
        runtime.failReason = 'timeout';
      }
    }
  }
}
