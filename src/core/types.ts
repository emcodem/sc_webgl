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
// measured, load-bearing value (see physics/ships/gladius.ts's comment block). Do NOT drop or collapse
// fields without a real re-measurement.
export interface ShipType {
  name: string;
  model: string;   // render-layer glTF id (see render/shipModels.ts's MODELS map) — NOT physics;
                   // which visual hull this ship wears. Multiple ShipTypes may share flight stats
                   // but wear different models (e.g. 'Arrow' is the Gladius' stats on the 'arrow' hull).
  mass: number;    // gameplay-tuning mass, doubles as rotational inertia
  massKg: number;  // real-world reference mass, informational only
  linearThrust: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
  // angularThrust/angularDrag: == maxAngVel * angularDrag per axis (angularThrust), by construction.
  // Still fully live for ROLL's spin-up. For PITCH/YAW they're vestigial as of 2026-07-24 — flightModel
  // no longer uses them to drive the rotation integrator (superseded by angularSpoolOmega/Zeta below,
  // a 2nd-order model) — kept because the structural invariant test (tests/shipTuning.test.ts) and
  // angularDrag's role in roll still reference these fields; don't delete.
  angularThrust: AngularState;
  mainSpoolDelay: number;
  retroSpoolDelay: number;
  verticalSpoolDelay: number;
  linearDrag: number;               // negligible for the Gladius — governor-cap does the limiting
  boostLinearDrag: number;
  coastDecel: number;               // informational/legacy only — flightModel.ts's coast branch derives
                                     // the real per-(axis,direction) decel from linearThrust/mass instead
                                     // (see physics/ships/gladius.ts's coastDecel doc comment)
  brakeGain: number;                // 1/s space-brake velocity-controller gain
  angularDrag: AngularState;        // per-axis — still live for roll; vestigial for pitch/yaw (see above)
  maxAngVel: AngularState;
  // Natural frequency (rad/s) and damping ratio of the 2nd-order underdamped step response that models
  // PITCH/YAW rotation spool-up AND release/reversal (roll keeps its own separate spin-up + governor-
  // release model, no equivalent here) — see physics/flightModel.ts's rotation integrator and
  // physics/ships/gladius.ts's dated comment citing capture/MEASUREMENTS.md's "Spool-up transient is a
  // 2nd-order underdamped step response" section. No roll component: roll isn't modeled this way.
  angularSpoolOmega: { pitch: number; yaw: number };
  angularSpoolZeta: { pitch: number; yaw: number };
  // Roll-release governor: on releasing roll input, real Gladius stops with a hard, roughly-constant
  // deceleration (rad/s^2), distinct from roll's own spin-up model and from pitch/yaw's 2nd-order
  // spool model (angularSpoolOmega/Zeta above), which covers both their spin-up AND release/reversal
  // in one continuous equation — measured ~40deg roll-out from full rate (200deg/s) vs the old
  // exponential model's ~56deg tail (see capture/BLUEPRINT.md's roll-reversal findings: fitted drag
  // pins at exactly 0 during release). See physics/flightModel.ts.
  rollReleaseDecel: number;
  scmSpeed: number;
  scmSpeedBack: number;
  boostSpeedForward: number;
  boostSpeedBack: number;
  boostCapacity: number;
  boostRechargeRate: number;         // %/s recharged above the red zone
  boostRedZonePct: number;           // meter %; drain/recharge switch to their red-zone rates below this
  boostReactivatePct: number;        // meter % a fresh burn must climb back to before it can (re)start
  boostDrainRate: number;            // %/s drained while boosting above the red zone
  boostDrainRateRedZone: number;     // %/s drained while boosting at/below the red zone
  boostRechargeRateRedZone: number;  // %/s recharged below the red zone (faster than boostRechargeRate)
  boostRechargeDelaySec: number;     // s after boost ends before recharge begins
  boostMaxAngVel: AngularState;
  boostAngularThrust: AngularState;
  // Boosted variant of angularSpoolOmega/Zeta above — boost changes the pitch/yaw spool transient's
  // damping (measured, not just the steady-state rate), so these are independent values, not derived.
  boostAngularSpoolOmega: { pitch: number; yaw: number };
  boostAngularSpoolZeta: { pitch: number; yaw: number };
  boostLinearThrust: { main: number; retro: number };
  hullRadius: number;
}
