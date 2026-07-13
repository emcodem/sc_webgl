// ---------- Shared value types ----------
// Vec3/Quat/AngularState/ShipType are ported from the original project unchanged in shape, since
// the ported flight model (physics/flightModel.ts) depends on them exactly. New universe-scale
// types (CelestialBody, entities, etc.) live in core/world.ts.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface AngularState {
  pitch: number;
  yaw: number;
  roll: number;
}

// Generic points pool for combat — every hit currently subtracts a flat amount (see
// combat/weapons.ts's WEAPON.damage), but applyDamage already takes an amount so a future
// per-weapon damage value plugs straight in.
export interface Health {
  points: number;
  maxPoints: number;
}

// Difficulty knobs for the AI dogfighter (see combat/enemyAI.ts). Ported from the original
// project's FighterTuning — ship-agnostic, so a harder/easier opponent later is just another
// preset object, not new code.
export interface FighterTuning {
  steerGain: number;             // proportional steering aggressiveness (quaternion-error -> stick)
  engageRange: number;           // ideal stand-off distance for gunnery, meters
  engageBand: number;            // tolerance around engageRange before throttle corrects
  closeRange: number;            // beyond this, burn straight at the player to close distance
  fireRange: number;             // won't pull the trigger past this range
  fireLateralTolerance: number;  // meters of allowed miss at the target, implied by aim-error * range
  overshootAngleRad: number;     // aim error beyond which it gives up turning and extends instead
  repositionExtendBias: number;  // 0..1 weight on "keep extending" vs "turn back toward the player"
  repositionBoost: boolean;      // whether it burns boost while repositioning
  threatRange: number;           // player must be this close to be treated as a real threat
  threatConeRad: number;         // how tightly the player must be boresighted on us to evade
  evadeMinSeconds: number;       // minimum time spent evading once triggered, avoids flicker
  modeCommitSeconds: number;     // minimum time spent in whatever mode evade hands off to
  weaveFreq: number;             // rad/s, engage/evade weave oscillation speed
}

// Persistent per-enemy AI memory — a small state machine plus timers so its maneuvering has
// continuity frame to frame instead of re-deciding from scratch every tick.
export interface FighterAIMemory {
  mode: 'close' | 'engage' | 'evade' | 'reposition';
  modeTimer: number; // seconds remaining before the current mode may be involuntarily overridden
  clock: number;     // free-running elapsed seconds, used to phase weave/jink oscillations
  jinkSeed: number;  // randomized per spawn so multiple fighters don't jink in lockstep
  tuning: FighterTuning;
}

// Every scenario-spawnable AI archetype (see combat/enemyAI.ts and combat/ai/*). 'fighter' is the
// only one that predates the scenario port; the rest are ported from the original project's
// combat/enemyAI.ts alongside scenarios/runtime.ts.
export type EnemyBehavior = 'turret' | 'fighter' | 'chaser' | 'orbiter' | 'drifter' | 'cruiser' | 'evasive';

// 'orbiter' behavior memory — a drone circling a fixed center on a randomized plane, ported from
// the original project's combat/enemyAI.ts. respawnTimer counts UP elapsed dead-time (see
// scenarios/runtime.ts's orbiter branch for why, and combat/ai/orbiterDrifterAI.ts for the roll
// flourish fields).
export interface OrbitState {
  center: Vec3;
  radius: number;
  angularSpeed: number;
  phase: number;
  planeRight: Vec3;
  planeUp: Vec3;
  respawnTimer: number;
  rollTimer?: number;
  rollCooldown?: number;
  rollAxisRight?: Vec3;
  rollAxisUp?: Vec3;
}

// A single in-progress "bank into a U-turn" maneuver for a 'drifter' that has flown out of range —
// see combat/ai/orbiterDrifterAI.ts's startDriftTurn/advanceDriftTurn.
export interface DriftTurnState {
  fromDir: Vec3;
  axis: Vec3;
  angleTotal: number;
  speed: number;
  elapsed: number;
  duration: number;
  rollTurns: number;
}

// 'drifter' behavior memory — a drone that streaks past on a straight miss-aimed line, banks
// around once it's flown too far, and repeats. respawnTimer counts UP, same convention as OrbitState.
export interface DriftState {
  respawnTimer: number;
  rollTimer?: number;
  rollCooldown?: number;
  rollAxisRight?: Vec3;
  rollAxisUp?: Vec3;
  rollOffsetPrev?: Vec3;
  turn?: DriftTurnState;
}

// 'evasive' behavior memory — the receding-horizon MPC dodge planner's persistent state (see
// combat/ai/evasiveAI.ts). Ported from the original project's combat/enemyAI.ts verbatim.
export interface EvasiveAIMemory {
  jinkStrafeX: number;
  jinkStrafeY: number;
  jinkBoost: boolean;
  jinkReplanTimer: number;
  mode: 'block' | 'shootback';
  modeTimer: number;
  wasThreatened: boolean;
  chasing: boolean;
  chaseStruggleTimer: number;
  chaseCooldownTimer: number;
}

// Full ship tuning — ported verbatim from the original project's ShipType. Every field carries a
// measured, load-bearing value (see physics/shipTypes.ts's comment block). Do NOT drop or collapse
// fields without a real re-measurement.
export interface ShipType {
  name: string;
  mass: number;    // gameplay-tuning mass, doubles as rotational inertia
  massKg: number;  // real-world reference mass, informational only
  linearThrust: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
  angularThrust: AngularState;      // == maxAngVel * angularDrag per axis
  mainSpoolDelay: number;
  retroSpoolDelay: number;
  verticalSpoolDelay: number;
  linearDrag: number;               // negligible for the Gladius — governor-cap does the limiting
  boostLinearDrag: number;
  coastDecel: number;               // flat m/s^2 coast brake (no input, coupled)
  brakeGain: number;                // 1/s space-brake velocity-controller gain
  angularDrag: AngularState;        // per-axis
  maxAngVel: AngularState;
  scmSpeed: number;
  scmSpeedBack: number;
  boostSpeedForward: number;
  boostSpeedBack: number;
  boostCapacity: number;
  boostRechargeRate: number;
  boostMaxAngVel: AngularState;
  boostAngularThrust: AngularState;
  boostLinearThrust: { main: number; retro: number };
  hullRadius: number;
}
