import type {
  DriftState, EnemyBehavior, EvasiveAIMemory, FighterAIMemory, Health, OrbitState, Quat, ShipType, Vec3
} from './types';
import type { ScenarioRuntime } from '../scenarios/types';
import type { PipTrainerState } from '../combat/pipTrainer';

// ============================================================================================
// The renderer-agnostic simulation world. Everything here is expressed in ABSOLUTE, f64
// world-space coordinates (plain JS numbers are already 64-bit doubles). The render layer is the
// only place that rebases into 32-bit camera-relative space for the GPU — see render/renderer.ts
// and the "floating origin" note below. Keep three.js out of this file entirely.
//
// FLOATING ORIGIN: a solar system spans hundreds of millions of metres, far beyond f32 precision.
// Rather than a periodic re-center, we render fully camera-relative: every frame the render layer
// subtracts the camera's absolute position from every object, so the camera is always at the GL
// origin and near-field geometry keeps full precision no matter how far the player has travelled.
// The sim never needs to know about this; it just moves things in absolute space.
// ============================================================================================

// A star, planet, moon, or free-floating rock. Bodies are spheres for now (radius = surface
// radius). Walkable bodies have gravity and an on-foot-collidable surface; backdrop bodies (sun,
// distant planet) are purely visual and far enough that the player can't reach them this milestone.
export interface CelestialBody {
  name: string;
  pos: Vec3;              // absolute world position of the body's center
  radius: number;         // surface radius, metres
  gravity: number;        // surface gravitational acceleration, m/s^2 (0 = none)
  walkable: boolean;      // whether the character controller collides with / stands on it
  color: number;          // base albedo (three.js hex), used by the render layer
  emissive?: boolean;     // true for the sun — self-lit and acts as the scene light source
  atmosphere?: number;    // optional atmosphere tint (three.js hex) for a soft rim glow
  meteorite?: boolean;    // true for the free-flight sandbox's nearby rock — render layer loads a
                           // real scanned-meteorite glTF model (see render/celestialModels.ts)
                           // instead of building a sphere; `radius` is its overall bounding size,
                           // not a walkable surface (not walkable at all currently — see
                           // physics/characterController.ts's nearestWalkable, which this is
                           // excluded from same as the station it replaces)
}

// The ship as a physics body (satisfies FlightBody in physics/flightModel.ts). Absolute coords.
export interface ShipBody {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: { pitch: number; yaw: number; roll: number };
  throttle: number;
  decoupled: boolean;
  spaceBrakeOn: boolean;
  boostMeter: number;
  boosting: boolean;
  throttleSpoolTime: number;
  verticalSpoolTime: number;
  health: Health;
  hitFlash: number;      // 0..1, set to 1 when hit, decays over time — drives the HUD damage flash
  fireCooldown: number;  // seconds until the next shot may fire (see combat/weapons.ts WEAPON.fireRate)
  respawnTimer: number;  // >0 while destroyed and waiting to respawn; 0 = alive/flyable
}

// A traveling weapon round — see combat/weapons.ts. `owner` tags which side it damages on hit.
export interface Projectile {
  pos: Vec3;
  vel: Vec3;
  age: number;
  owner: 'player' | 'enemy';
}

// An AI-flown opponent. Structurally a superset of FlightBody (physics/flightModel.ts) so the same
// Newtonian integrator drives it — see combat/enemyAI.ts and combat/ai/*. Deliberately not a full
// ShipBody: no player-console concepts like throttle/decoupled/spaceBrakeOn, since input never
// drives it directly.
export interface EnemyShip {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: { pitch: number; yaw: number; roll: number };
  boostMeter: number;
  boosting: boolean;
  throttleSpoolTime: number;
  verticalSpoolTime: number;
  health: Health;
  behavior: EnemyBehavior;
  turnRateRadPerSec?: number; // 'turret' only
  ai?: FighterAIMemory;       // 'fighter' only
  orbit?: OrbitState;         // 'orbiter' only
  drift?: DriftState;         // 'drifter' only
  evasive?: EvasiveAIMemory;  // 'evasive' only
  fireCooldown: number;
  respawnTimer: number; // >0 while destroyed and waiting to respawn; 0 = alive/flyable. Only the
                         // free-flight sandbox fighter (core/player.ts) and scenario enemies whose
                         // behavior has no in-place respawn ever use this — orbiter/drifter respawn
                         // in place via their own orbit.respawnTimer/drift.respawnTimer instead.
}

export type ControlMode = 'pilot' | 'onfoot';

// The player: one avatar that is either piloting the ship (camera in the cockpit, flight model
// drives movement) or on foot (character controller drives movement). The ship always exists in
// the world; while piloting, the character state is slaved to it, and vice-versa. This single
// structure is the seam that makes "get out and walk" just a mode switch over shared world state
// rather than a separate game.
export interface Player {
  mode: ControlMode;
  ship: ShipBody;

  // ---- on-foot character state (absolute coords) ----
  charPos: Vec3;          // feet position
  charVel: Vec3;
  onGround: boolean;
  // First-person look on a curved surface: a heading unit vector kept tangent to the local surface
  // (yaw) plus a pitch angle. Rebuilt into a camera basis each frame in render/camera.ts.
  heading: Vec3;
  lookPitch: number;      // radians, clamped near +/- vertical
  // The body the character is currently standing on / falling toward (nearest walkable), cached for
  // the HUD and camera. null in open space (zero-g EVA).
  groundBody: CelestialBody | null;
}

export interface World {
  bodies: CelestialBody[];
  player: Player;
  enemies: EnemyShip[];
  projectiles: Projectile[];
  hitMarkerTimer: number; // >0 briefly after the player's own shot lands — drives the HUD hit marker
  // Non-null while a training scenario (see scenarios/runtime.ts) is running — main.ts steps
  // scenarios/runtime.ts::updateScenario instead of combat/combatSystem.ts::stepCombat while set.
  scenario: ScenarioRuntime | null;
  // Non-null while the PIP Trainer (see combat/pipTrainer.ts) is running — fully independent of
  // `scenario`/`enemies`/hit detection; stepCombat keeps running unmodified underneath it.
  pipTrainer: PipTrainerState | null;
}
