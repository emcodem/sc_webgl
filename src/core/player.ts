import type { EnemyShip, Player, ShipBody, World } from './world';
import type { Quat, ShipType, Vec3 } from './types';
import { SHIP_TYPES } from '../physics/shipTypes';
import { BODIES, ENEMY_SPAWN, SPAWN } from '../world/celestial';
import { createHealth } from '../combat/health';
import { spawnFighterAI } from '../combat/enemyAI';

const SHIP_MAX_HEALTH = 10;
const ENEMY_MAX_HEALTH = 10;

export function makeShipBody(type: ShipType): ShipBody {
  return {
    type,
    pos: { x: SPAWN.pos.x, y: SPAWN.pos.y, z: SPAWN.pos.z },
    vel: { x: 0, y: 0, z: 0 },
    quat: { x: SPAWN.quat.x, y: SPAWN.quat.y, z: SPAWN.quat.z, w: SPAWN.quat.w },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0,
    decoupled: false,
    spaceBrakeOn: false,
    boostMeter: type.boostCapacity,
    boosting: false,
    boostCooldownTimer: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(SHIP_MAX_HEALTH),
    hitFlash: 0,
    fireCooldown: 0,
    respawnTimer: 0
  };
}

function makeEnemyShip(type: ShipType, pos: Vec3, quat: Quat): EnemyShip {
  return {
    type,
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: 0, y: 0, z: 0 },
    quat: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: type.boostCapacity,
    boosting: false,
    boostCooldownTimer: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(ENEMY_MAX_HEALTH),
    behavior: 'fighter',
    ai: spawnFighterAI(),
    fireCooldown: 0,
    respawnTimer: 0
  };
}

export function makeWorld(): World {
  const ship = makeShipBody(SHIP_TYPES[0]);
  const player: Player = {
    mode: 'pilot',
    ship,
    charPos: { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z },
    charVel: { x: 0, y: 0, z: 0 },
    onGround: false,
    heading: { x: 0, y: 0, z: 1 },
    lookPitch: 0,
    groundBody: null
  };
  const enemies = [makeEnemyShip(SHIP_TYPES[0], ENEMY_SPAWN.pos, ENEMY_SPAWN.quat)];
  return { bodies: BODIES, player, enemies, projectiles: [], hitMarkerTimer: 0, scenario: null, pipTrainer: null };
}

// Restores `world` to a fresh start (F1 / restart button — see ui/buttonBar.ts) by overwriting its
// top-level fields in place, so the one World instance the renderer/main loop already hold a
// reference to stays valid rather than needing to be swapped out everywhere it's captured.
export function resetWorld(world: World): void {
  const fresh = makeWorld();
  world.bodies = fresh.bodies;
  world.player = fresh.player;
  world.enemies = fresh.enemies;
  world.projectiles = fresh.projectiles;
  world.hitMarkerTimer = 0;
  world.scenario = null; // always fully exits any in-progress scenario
  world.pipTrainer = null; // ...and any in-progress PIP Trainer session
}
