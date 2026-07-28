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
  // 'evade' mode's committed break direction (world-space, perpendicular to the flee heading — see
  // combat/enemyAI.ts's pickBreakDir) and how much longer it holds before re-picking. null until the
  // first tick spent in 'evade'.
  evadeBankDir: Vec3 | null;
  evadeBankTimer: number;
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
  speed: number;      // actual travel speed during the reversal (raw cruise speed, boosted once)
  baseSpeed: number;  // the RAW (unboosted) cruise speed to resume the next helix at — do not derive
                      // this from `speed`/enemy.vel after the turn, since both already carry the
                      // boost multiplier; re-deriving from a boosted value would compound it further
                      // every reversal (a real bug this field exists to prevent)
  elapsed: number;
  duration: number;
  rollTurns: number;
}

// Continuous corkscrew for a 'drifter' flying its straight cruise segment (i.e. not mid
// turn-around) — see combat/ai/orbiterDrifterAI.ts's spawnHelix/computeHelixVelocity. `right`/`up`
// are a perpendicular frame and `baseDir`/`baseSpeed` the cruise heading/speed, all fixed at the
// moment the current segment began (spawn, respawn, or the end of a turn-around) so the corkscrew
// curves a stable heading rather than chasing itself. `angle` accumulates continuously (mod 2π) at
// a rate set by `rollFraction` — the drone is always rolling, just harder when actively threatened.
// `aggressiveTimer` is a hysteresis hold: >0 while the escalation conditions held recently enough to
// still count as "under fire". `rollFraction` is the CURRENT, eased roll-rate fraction (0.25..0.75) —
// it chases whatever aggressiveTimer implies at a limited rate rather than snapping instantly, so an
// escalation ramps the roll rate up/down smoothly instead of a jarring one-tick "whip".
export interface HelixState {
  baseDir: Vec3;
  baseSpeed: number;
  right: Vec3;
  up: Vec3;
  angle: number;
  aggressiveTimer: number;
  rollFraction: number;
}

// 'drifter' behavior memory — a drone that streaks past on a straight miss-aimed line, banks
// around once it's flown too far, and repeats. respawnTimer counts UP, same convention as OrbitState.
export interface DriftState {
  respawnTimer: number;
  turn?: DriftTurnState;
  helix?: HelixState;
}

// 'evasive' behavior memory — the receding-horizon MPC dodge planner's persistent state (see
// combat/ai/evasiveAI.ts). This project's own system, not a verbatim port. Every committed jink is
// always boosted by design (see EVASIVE_TUNING's doc comment), so there's no separate boost flag.
export interface EvasiveAIMemory {
  jinkStrafeX: number;
  jinkStrafeY: number;
  jinkReplanTimer: number;
  mode: 'block' | 'shootback';
  modeTimer: number;
  wasThreatened: boolean;
  chasing: boolean;
  chaseStruggleTimer: number;
  chaseCooldownTimer: number;
  // Hard, unconditional ceiling on how long the forward-axis standoff servo may keep pushing the
  // same sustained direction before a forced break — see EVASIVE_TUNING.forcedBreakIntervalSec's
  // doc comment for why this exists independently of the (already sub-1s) jink replan cadence.
  forcedBreakTimer: number;
  // >0 while a forced break's occasional "fly forward to pass the player" override is active — see
  // EVASIVE_TUNING.passThroughChance.
  passThroughTimer: number;
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
  // Pitch/yaw REVERSAL governor: when the commanded target opposes the ship's current spin (a hard
  // flip, not a release-to-neutral), real Gladius decelerates at a roughly constant rate rather than
  // through the oscillating angularSpoolOmega/Zeta spring-damper above — same governor shape as
  // rollReleaseDecel, just gating a different condition (sign-flip vs. release). See
  // physics/flightModel.ts's rotation integrator and capture/MEASUREMENTS.md's "Reversal stop-time —
  // felt-threshold method" section (2026-07-27/28). Applied per user go-ahead 2026-07-28 though the
  // underlying data is SUSPECT (felt-threshold, not frame-tracked): pitch's constant is well-
  // validated (a 3-point linear fit correctly predicted 3 held-out points before they were measured);
  // yaw's is much rougher (never independently validated). Neither has boosted data — this same
  // constant is reused regardless of `boosting`. Also unmeasured: how this decel depends on the
  // opposing input's own magnitude — one exploratory data point suggests it saturates near this same
  // value well before full counter-deflection, so flightModel.ts applies it whenever the target
  // opposes current spin AT ALL, not scaled by how hard the stick is pushed the other way.
  pitchYawReversalDecel: { pitch: number; yaw: number };
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
  boostLinearThrust: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
  // Boosted lateral+vertical (non-longitudinal) top speed — separate from and lower than
  // boostSpeedForward/Back, which govern only the forward-axis component. Without this, boosted
  // sideways/vertical flight was ungoverned up to the much higher forward boost cap (see
  // physics/flightModel.ts's governor block and physics/ships/gladius.ts's measurement note).
  boostManeuveringSpeedCap: number;
  hullRadius: number;
  weaponType: WeaponType;
}

// A ship's fitted gun — ballistics + fire-rate values (previously a single hardcoded WEAPON const
// in combat/weapons.ts) plus a capacitor: EACH individual gun has its own charge pool (in raw ammo
// units, matching real SC's per-weapon capacitor, not a ship-wide pool) that drains per shot and,
// after a post-fire dwell, recharges over time (GitHub #2). A ship mounts combat/weapons.ts's
// NUM_GUNS of this WeaponType (today: 3, matching the existing left-wing/right-wing/nose muzzle
// cycling) — see core/world.ts's ShipBody.weaponCapacitors (one entry per gun). Per-ship via
// ShipType.weaponType rather than global, since ships will eventually carry different guns. See
// physics/weapons/panther.ts for the one weapon that exists today and its provenance.
export interface WeaponType {
  name: string;
  muzzleSpeed: number;   // m/s, added on top of the shooter's own velocity
  fireRate: number;      // rounds/sec while the trigger is held (arcade-balance value, not
                         // necessarily the real RPM — see panther.ts's note)
  lifetime: number;      // s before a round despawns
  muzzleForward: number; // spawn offset ahead of the ship so tracers don't clip through the hull
  damage: number;
  // Weapon convergence ("harmonization"): the offset guns are toed-in so their bore lines cross at a
  // point on the boresight this far ahead when no target range is known.
  convergeDist: number;    // metres — default harmonization range
  minConvergeDist: number; // clamp: closer than this the toe-in angle gets silly

  capacitorCapacity: number;          // max charge PER GUN, in raw ammo units (real SC's max_ammo_load)
  capacitorCostPerShot: number;       // ammo consumed by that gun per shot it fires
  capacitorRechargeRate: number;      // ammo/s a gun recharges once its post-fire delay has elapsed
  capacitorRechargeDelaySec: number;  // s after a GUN's own last shot before that gun starts recharging
}
