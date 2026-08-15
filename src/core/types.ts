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
// scenarios/runtime.ts's orbiter branch for why). center/radius/angularSpeed/planeRight/planeUp
// describe the imaginary ring the drone chases via real steering, NOT its literal position — see
// combat/ai/orbiterDrifterAI.ts's orbiterThink, which reads the drone's OWN current position to
// find where it is on that ring rather than trusting phase to track it once it's actually flying.
// phase itself is only read once, by seedOrbiterPose, to place a freshly (re)spawned drone.
export interface OrbitState {
  center: Vec3;
  radius: number;
  angularSpeed: number;
  phase: number;
  planeRight: Vec3;
  planeUp: Vec3;
  respawnTimer: number;
}

// Continuous, always-boosted-forward corkscrew for a 'drifter' — see
// combat/ai/orbiterDrifterAI.ts's driftThink. `baseDir` is the current target nose heading (world
// space): fixed for a cruise pass, retargeted (not scripted-animated) once the drone has flown far
// enough to trigger a turn-around, then re-approached under the real flight model's own turn-rate
// lag via steeringToward — there is no separate scripted U-turn state anymore. `rollSign` is the
// fixed spin direction (+1/-1) for the current pass, chosen once so the corkscrew doesn't flip mid-
// roll. `aggressiveTimer` is a hysteresis hold: >0 while the escalation conditions held recently
// enough to still count as "under fire". `rollFraction` is the CURRENT, eased roll-INPUT fraction
// (0.25..0.75, fed straight to FlightInputs.roll) — it chases whatever aggressiveTimer implies at a
// limited rate rather than snapping instantly, so an escalation ramps the roll rate up/down smoothly
// instead of a jarring one-tick "whip"; the flight model's own roll spin-up/release then smooths the
// actual angular response on top of that.
export interface HelixState {
  baseDir: Vec3;
  rollSign: number;
  aggressiveTimer: number;
  rollFraction: number;
}

// 'drifter' behavior memory — a drone that streaks past on a straight miss-aimed line, banks
// around once it's flown too far, and repeats. respawnTimer counts UP, same convention as OrbitState.
export interface DriftState {
  respawnTimer: number;
  helix?: HelixState;
}

// Shared 'orbiter'/'drifter' counter-attack state, entered the instant either behavior takes a hit —
// see combat/ai/orbiterDrifterAI.ts's triggerHitReaction/hitReactionThink. Permanent for the rest of
// that drone's life (only cleared on respawn, alongside a fresh OrbitState/DriftState): once a
// practice target has been shot at, it stops being harmless. Three phases, advanced in order and
// never reverted within one life:
//   'break'        — a startled boosted vertical break (see hitReactionThink) for a few random
//                    seconds (breakTimer counts down)
//   'faceAttacker' — turn to face the player as fast as the flight model allows
//   'engaged'      — permanent from here on: dodge (strafe) within engageRangeM of the player, or
//                    close back in beyond it — see hitReactionThink for the distance split.
// dodgeStrafeX/Y is the CURRENT committed strafe bias (engaged+dodging only), re-picked every
// dodgeTimer seconds from HIT_REACTION_TUNING's candidate set — never negative Y (never dives, only
// climbs/strafes, per the "up/left/right" behavior these drones were asked to fly).
export interface HitReactionState {
  mode: 'break' | 'faceAttacker' | 'engaged';
  breakTimer: number;
  dodgeStrafeX: number;
  dodgeStrafeY: number;
  dodgeTimer: number;
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
  // Keyboard/joystick throttle-COMMAND ramp rate (1/s: fraction of full -1..1 travel per second) —
  // distinct from mainSpoolDelay/retroSpoolDelay above, which gate when thrust *catches* once
  // throttle is already fully commanded. This instead governs how fast the commanded throttle
  // itself can move, since pressing/releasing W or S isn't an instant 0-to-full digital snap in
  // real SC. See control/pilot.ts and capture/MEASUREMENTS.md's "Throttle input ramp" section
  // (2026-08-01): measured ~0.20s for a full 0↔1 traversal, same rate for both directions and both
  // activating and releasing (an initial reading suggesting backward activated instantly turned out
  // to be a HUD display bug, not a real asymmetry).
  throttleRampRate: number;
  linearDrag: number;               // negligible for the Gladius — governor-cap does the limiting
  // DERIVED per axis (physics/ships/linearInvariant.ts, called from buildShipType) as
  // boostLinearThrust / (mass * boostGovernorOvershoot * that axis's own boost speed cap) — NOT
  // authored, so it can't drift from the thrust it's paired with. Only read on an axis firing an
  // ALIGNED boosted thruster (see boostCounterThrust below and flightModel.ts's drag branch): a
  // COUNTERING axis is measured dead flat, so drag must not touch it.
  //
  // Per-axis rather than one scalar because the axes genuinely differ once thrust does: main's
  // asymptote has to clear its own 520 cap, while the maneuvering axes settle near 440. Deriving it
  // from the cap makes the "boost is governor-limited, not drag-limited" invariant structural — the
  // asymptote is boostGovernorOvershoot * cap for every axis by construction, so a future ship can't
  // silently reintroduce the drag-limited bug that hit strafe/vertical before 2026-07-28.
  boostLinearDrag: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
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
  // Unboosted lateral+vertical (non-longitudinal) top speed — the unboosted counterpart of
  // boostManeuveringSpeedCap below, added for the same reason: without it, the scmSpeed/scmSpeedBack
  // governor caps forward+strafe+vertical as ONE combined 3-vector magnitude, so adding vertical/
  // lateral thrust while already near scmSpeed bleeds INTO the forward component instead of adding on
  // top of it (felt as the ship "dragging away" from a target while circling it on forward+downstrafe).
  // EXTRAPOLATED, not measured — no unboosted maneuvering-cap capture exists (see
  // capture/MEASUREMENTS.md / BLUEPRINT.md) — scaled from the boosted case's own measured ratio
  // (boostManeuveringSpeedCap / boostSpeedForward = 394/520 = 0.7577) applied to scmSpeed, per user
  // go-ahead 2026-07-31. Re-derive against a real capture if one ever exists. See
  // physics/flightModel.ts's governor block and physics/ships/gladius.ts.
  maneuveringSpeedCap: number;
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
  // The three authored boost-linear PRIMITIVES, kept on the compiled type (like maxAngVel/angularDrag
  // are) so the derivations below can be asserted structurally rather than against magic numbers.
  boostThrustMultiplier: number;   // aligned boost thrust as a multiple of the unboosted thruster
  boostCounterMultiplier: number;  // countering (braking/reversing) boost thrust, same basis
  boostGovernorOvershoot: number;  // aligned asymptote / that axis's cap; must be > 1 (see boostLinearDrag)
  // Boosted thrust in the ALIGNED role — pushing further along an axis's existing velocity, or from
  // rest. DERIVED as linearThrust * boostThrustMultiplier per axis (see linearInvariant.ts). Paired
  // with boostLinearDrag above: this role has real proportional drag and curves to an asymptote above
  // the speed cap, exactly matching boosted main's own dense 2026-07-15 trace.
  boostLinearThrust: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
  // Boosted thrust in the COUNTERING role — opposing an existing velocity on that axis (braking or
  // reversing). DERIVED as linearThrust * boostCounterMultiplier per axis. Held in THRUST units, not
  // m/s^2, so it substitutes directly for boostLinearThrust in flightModel.ts's assembly.
  //
  // This is a genuinely separate regime, not a scaling of the above: measured 2026-08-02 on four
  // independent axes (retro/strafe/up/down), countering is a FLAT constant decel with NO drag at all
  // (linear-fit RMS 0.3-0.9 m/s across an entire 222->2 m/s range — any real drag term would visibly
  // bend that line) at ~1.30x the unboosted opposing thruster, versus ~2.09x WITH drag when aligned.
  // One thrust value per axis could not fit both roles, which is why boosted reverse braking was ~3x
  // too strong before this split. See flightModel.ts's countering block and RETRO.md.
  boostCounterThrust: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
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
  fireRate: number;      // rounds/sec while the trigger is held — see panther.ts's note
  lifetime: number;      // s before a round despawns
  muzzleForward: number; // spawn offset ahead of the ship so tracers don't clip through the hull
  damage: number;
  // Weapon convergence ("harmonization"): the offset guns are toed-in so their bore lines cross at a
  // point on the boresight this far ahead when no target range is known.
  convergeDist: number;    // metres — default harmonization range
  minConvergeDist: number; // clamp: closer than this the toe-in angle gets silly
  // Per-shot mechanical inaccuracy: each round's convergence-aimed direction is randomly deviated by
  // up to this many degrees (uniform over the solid angle of the cone, not just the boresight plane)
  // — see combat/weapons.ts's applySpread. 0 = perfectly aimed every shot.
  spreadDeg: number;

  capacitorCapacity: number;          // max charge PER GUN, in raw ammo units (real SC's max_ammo_load)
  capacitorCostPerShot: number;       // ammo consumed by that gun per shot it fires
  capacitorRechargeRate: number;      // ammo/s a gun recharges once its post-fire delay has elapsed
  capacitorRechargeDelaySec: number;  // s after a GUN's own last shot before that gun starts recharging
}
