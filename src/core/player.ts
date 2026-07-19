import type { EnemyShip, Player, ShipBody, World } from './world';
import type { Quat, ShipType, Vec3 } from './types';
import { getShipType, DEFAULT_SHIP_TYPE_ID } from '../physics/ships';
import { BODIES, ENEMY_SPAWN, SPAWN } from '../world/celestial';
import { createHealth } from '../combat/health';
import { spawnFighterAI } from '../combat/enemyAI';

const SHIP_MAX_HEALTH = 1000; // free-flight sandbox only — scenarios override via config.hitsToKillPlayer
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

// `moving: false` makes a static ship: no 'ai', so stepCombat's `!enemy.ai` check (see
// combat/combatSystem.ts) skips it entirely — it just sits at its spawn point, still shootable and
// still respawns there, but never flies or fires. `moving: true` gets the same fighter AI as the
// original lone dogfighter; free flight now never lets any enemy actually fire (combatSystem.ts),
// so a "moving" ship just maneuvers around the player rather than attacking.
function makeEnemyShip(type: ShipType, pos: Vec3, quat: Quat, moving: boolean): EnemyShip {
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
    behavior: moving ? 'fighter' : 'cruiser',
    ai: moving ? spawnFighterAI() : undefined,
    fireCooldown: 0,
    respawnTimer: 0,
    spawnPos: { x: pos.x, y: pos.y, z: pos.z },
    spawnQuat: { x: quat.x, y: quat.y, z: quat.z, w: quat.w }
  };
}

// The free-flight fleet the player flies among: 5 AJF-12 Dvergr + 6 "SpaceShip Fighter" (Arrow),
// 11 ships total. Both types fly with the Gladius flight model (the Arrow entry is the Gladius stats
// on the Arrow hull); only the visual model differs. Interleaved so the two hulls mix rather than
// cluster. Index 0 is the lone moving dogfighter (spawned at ENEMY_SPAWN below); the rest ring around
// SPAWN. 5 Dvergr at the even indices (0,2,4,6,8), 6 Arrow at the odd ones + the last (1,3,5,7,9,10).
const DVERGR = getShipType('Gladius');
const ARROW = getShipType('Arrow');
const FREE_FLIGHT_FLEET: ShipType[] = [
  DVERGR, ARROW, DVERGR, ARROW, DVERGR, ARROW,
  DVERGR, ARROW, DVERGR, ARROW, ARROW
];

// The `types` (one per ring ship) both size the ring and assign each ship's hull — half holding
// still, half idling on the fighter AI's flight model (but never firing; see combat/combatSystem.ts).
// Laid out on a ring wide enough to clear the player's own spawn and the nearby METEORITE/ENEMY_SPAWN
// dogfighter, evenly split around the circle so movers and statics interleave rather than cluster.
const OTHER_SHIPS_RADIUS = 220; // metres from SPAWN

function makeOtherShips(types: ShipType[]): EnemyShip[] {
  const ships: EnemyShip[] = [];
  for (let i = 0; i < types.length; i++) {
    const angle = (i / types.length) * Math.PI * 2;
    const pos: Vec3 = {
      x: SPAWN.pos.x + Math.cos(angle) * OTHER_SHIPS_RADIUS,
      y: SPAWN.pos.y + Math.sin(angle * 2) * 40, // gentle vertical spread so it isn't a flat ring
      z: SPAWN.pos.z + Math.sin(angle) * OTHER_SHIPS_RADIUS
    };
    const moving = i % 2 === 0; // half moving, half static
    ships.push(makeEnemyShip(types[i], pos, SPAWN.quat, moving));
  }
  return ships;
}

export function makeWorld(): World {
  const ship = makeShipBody(getShipType(DEFAULT_SHIP_TYPE_ID)); // player flies the default AJF-12 Dvergr (Gladius stats)
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
  const enemies = [
    makeEnemyShip(FREE_FLIGHT_FLEET[0], ENEMY_SPAWN.pos, ENEMY_SPAWN.quat, true),
    ...makeOtherShips(FREE_FLIGHT_FLEET.slice(1))
  ];
  return { bodies: BODIES, player, enemies, projectiles: [], effects: [], hitMarkerTimer: 0, scenario: null, pipTrainer: null };
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
  world.effects = fresh.effects;
  world.hitMarkerTimer = 0;
  world.scenario = null; // always fully exits any in-progress scenario
  world.pipTrainer = null; // ...and any in-progress PIP Trainer session
}
