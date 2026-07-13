import type { EnemyBehavior, FighterTuning, Quat, ShipType, Vec3 } from '../core/types';

// Ported from the original project's scenarios/types.ts. Data-driven scenario definition — adding
// a new scenario is a new entry in scenarios/definitions.ts, not new engine code (see
// scenarios/runtime.ts, which is generic over any config shaped like this).

export interface EnemySpawnConfig {
  type: ShipType;
  pos: Vec3;
  quat: Quat;
  behavior: EnemyBehavior;
  turnRateRadPerSec?: number; // required in practice for 'turret' spawns, unused otherwise
  tuning?: FighterTuning;     // 'fighter' only — a FIGHTER_TUNING_* preset (see combat/enemyAI.ts)
  initialVel?: Vec3;          // 'cruiser' only — its fixed flight velocity for the whole scenario
}

// A single "fly through this ring" waypoint in a scripted gate path (see scenarios/gatePath.ts).
// `quat`'s forward axis is the intended direction of travel through the ring.
export interface FlightGate {
  pos: Vec3;
  quat: Quat;
  radius: number;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  enemySpawns: EnemySpawnConfig[];
  hitsToKillEnemy: number;
  hitsToKillPlayer: number;
  // Kept for shape parity with the original project. Every scenario here (as in the original) sets
  // this false — sc_webgl has no near-field obstacle/hazard concept to gate on, so this is
  // currently read nowhere.
  includeStation: boolean;
  // 'destroy' — land hitsToKillEnemy hits before taking hitsToKillPlayer.
  // 'gates' — evasion drills: clear every gatePath entry in order before surviveDurationSec runs
  // out (or fly past one outside its ring, which is an immediate loss).
  // 'survive' — no fail state, just wins once surviveDurationSec of elapsed time passes (or runs
  // forever if omitted, until the player backs out to the menu).
  winCondition: 'destroy' | 'gates' | 'survive';
  gatePath?: FlightGate[]; // 'gates' only
  surviveDurationSec?: number; // 'gates': required time limit. 'survive': optional drill length.
  // 0..1 practice-drill difficulty knob for 'orbiter'/'drifter' spawns — scales their flight speed.
  // Unused outside Aim Training. Defaults to 0.5 when omitted.
  droneAggressiveness?: number;
  // Player's world-space velocity at scenario start — omitted means {0,0,0}.
  playerInitialVel?: Vec3;
  // Meters — when set, the renderer draws a wireframe "range bubble" around every live enemy.
  rangeBubbleRadius?: number;
  // Evasive Pilot only — whether the 'evasive' spawn may snap around and shoot back.
  evasiveReturnFire?: boolean;
}

// A brief visual burst at an enemy's position when it's destroyed.
export interface EnemyExplosion {
  pos: Vec3;
  timer: number; // seconds remaining, counts down to 0
}

// Unlike the original project's ScenarioRuntime, this does NOT carry its own enemies[] —
// world.enemies IS the active scenario's enemy list (see scenarios/runtime.ts::startScenario).
export interface ScenarioRuntime {
  config: ScenarioConfig;
  outcome: 'active' | 'won' | 'lost';
  failReason?: 'died' | 'missedGate' | 'timeout';
  elapsedSec: number;
  gateIndex: number; // index of the next uncleared gate in config.gatePath — 'gates' scenarios only
  stats: { shotsFired: number; hitsLanded: number; kills: number; hitsTaken: number };
  explosions: EnemyExplosion[];
  // Total seconds the player has spent within any live enemy's rangeBubbleRadius (Merge Drill).
  bubbleTimeSec: number;
}
