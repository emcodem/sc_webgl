import type { EnemyShip, ShipBody } from '../../core/world';
import type { FighterDecision } from '../enemyAI';
import { computeAxes } from '../../math/quaternion';
import { clamp, normalize } from '../../math/vec';
import { angleBetween, steeringToward } from '../enemyAI';

// ===========================================================================
// ChaserAI — the 'chaser' EnemyShip behavior, used by the evasion drills (see
// scenarios/definitions.ts). Unlike FighterAI there's no state machine: it always just flies to
// hold a fixed offset directly behind the player and fires when boresighted. It deliberately never
// disengages or repositions — the player's job is to break its aim (e.g. by flying a barrel-roll
// gate path), not to out-fight it. Ported verbatim from the original project's combat/enemyAI.ts.
// ===========================================================================
export const CHASER_TUNING = {
  standoffDistance: 130, // meters directly behind the player it tries to hold station at
  steerGain: 5,
  fireRange: 450,
  fireLateralTolerance: 8
};

export function chaserThink(enemy: EnemyShip, player: ShipBody): FighterDecision {
  const { forward: playerForward } = computeAxes(player.quat);
  const stationPoint = {
    x: player.pos.x - playerForward.x * CHASER_TUNING.standoffDistance,
    y: player.pos.y - playerForward.y * CHASER_TUNING.standoffDistance,
    z: player.pos.z - playerForward.z * CHASER_TUNING.standoffDistance
  };
  const toStation = {
    x: stationPoint.x - enemy.pos.x,
    y: stationPoint.y - enemy.pos.y,
    z: stationPoint.z - enemy.pos.z
  };
  const distToStation = Math.hypot(toStation.x, toStation.y, toStation.z);
  const steerDir = distToStation > 1 ? normalize(toStation) : playerForward;

  const toPlayer = {
    x: player.pos.x - enemy.pos.x,
    y: player.pos.y - enemy.pos.y,
    z: player.pos.z - enemy.pos.z
  };
  const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z) || 1;
  const aimDir = normalize(toPlayer);

  const steer = steeringToward(enemy.quat, steerDir, CHASER_TUNING.steerGain);
  const { forward: enemyForward } = computeAxes(enemy.quat);

  return {
    inputs: {
      throttle: clamp(distToStation / 150, 0.15, 1),
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      strafeX: 0,
      strafeY: 0,
      brake: false,
      decoupled: false
    },
    boostRequested: distToStation > 350,
    wantsToFire: dist <= CHASER_TUNING.fireRange && angleBetween(enemyForward, aimDir) < 0.3,
    aimDir
  };
}

// 'cruiser' behavior — no thinking at all, just holds its spawn velocity forever. Used by the
// Merge Drill's head-on bandit (see scenarios/definitions.ts): it flies straight through the merge
// and never fires back.
export function cruiseThink(enemy: EnemyShip, dt: number): void {
  enemy.pos.x += enemy.vel.x * dt;
  enemy.pos.y += enemy.vel.y * dt;
  enemy.pos.z += enemy.vel.z * dt;
}
