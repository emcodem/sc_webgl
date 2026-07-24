import type { AngularState } from '../../core/types';

// ============================================================================================
// Raw ship-measurement schema — the AUTHORING shape for a ship's flight tuning.
//
// One file per ship (gladius.ts, arrow.ts, future taurus.ts, ...) exports a `RawShipMeasurement`.
// physics/ships/buildShipType.ts compiles it into the flat `ShipType` (core/types.ts) that
// flightModel.ts consumes — deriving the redundant angularThrust/boostAngularThrust from the
// primitives so the tuning invariants hold by construction (see buildShipType.ts).
//
// Design notes:
//   - This mirrors `ShipType` field-for-field EXCEPT angularThrust/boostAngularThrust, which are
//     DROPPED here — they are computed outputs of buildShipType, never hand-authored (that was the
//     one hand-duplicated redundancy in the old flat data). maxAngVel/boostMaxAngVel + angularDrag
//     are the authored primitives.
//   - `name` is the canonical lookup key (== compiled ShipType.name). Replay clips serialize it
//     (replay/types.ts) and the registry keys by it — NEVER rename a ship's `name` once clips
//     reference it.
//   - Thrust/drag/mass are authored per-ship, never auto-derived from mass. Cross-ship mass-scaling
//     is unresolved research (see capture/BLUEPRINT.md): mass only sets the time constant
//     tau = mass/drag, not the steady-state rate thrust/drag. A scaling law needs 2+ independently
//     fitted ships before it's checkable, so each ship stands on its own measured (or explicitly
//     placeholder) numbers.
// ============================================================================================

export type MeasurementStatus =
  | 'measured'            // fitted to real-game capture data (see capture/MEASUREMENTS.md)
  | 'cloned-placeholder'  // flies another ship's stats verbatim until measured (see `clonedFrom`)
  | 'wiki-reference-only' // taken from the star-citizen.wiki API dump, not our own capture
  | 'estimated';          // hand-guessed / seeded, not yet measured

export interface Provenance {
  status: MeasurementStatus;
  note: string;         // method / source prose — where these numbers came from
  date?: string;        // ISO date of the measurement or clone
  clonedFrom?: string;  // source ship `name`, when status === 'cloned-placeholder'
}

// Escape-hatch grouping for a ship with genuinely mixed provenance (e.g. wiki-sourced mass but
// hand-guessed thrust). Leave `fieldGroups` unset until a ship actually needs it — `overall` covers
// the uniform case (Gladius: all measured; Arrow: all cloned).
export type RawFieldGroup =
  | 'rotation' | 'linearThrust' | 'spool' | 'drag' | 'coast' | 'brake'
  | 'speedCaps' | 'boostMeter' | 'boostRotation' | 'boostLinear' | 'mass' | 'hull';

export interface ShipProvenance {
  overall: Provenance;
  fieldGroups?: Partial<Record<RawFieldGroup, Provenance>>;
}

// Measured findings that are NOT applied to the compiled ShipType flightModel.ts reads today —
// each would require an equation change in the ported-verbatim flightModel.ts, which is gated behind
// an explicit go-ahead (see CLAUDE.md, capture/MEASUREMENTS.md). Carried here so the numbers are
// discoverable and ready to apply later. buildShipType.ts NEVER reads this block.
export interface CandidateRefinements {
  // Boost raises strafe/vertical too (coded boostLinearThrust only has main/retro). Measured: strafe
  // accel ~x1.3, and a shared boosted-maneuvering speed cap distinct from (and below) boostSpeedForward.
  boostedLateralVertical?: {
    note: string;
    strafeAccel: number;          // m/s^2 (~127 measured, ~x1.3 over coupled strafe)
    maneuveringSpeedCap: number;  // m/s (~385 measured, shared strafe/vertical cap, < boostSpeedForward)
  };
}

export interface RawShipMeasurement {
  name: string;   // canonical registry key == compiled ShipType.name — never rename once clips exist
  model: string;  // render hull id (render/shipModels.ts's ShipModelName) — NOT physics
  provenance: ShipProvenance;

  mass: number;    // gameplay-tuning mass, doubles as rotational inertia (NOT massKg)
  massKg: number;  // real-world reference mass, informational only

  linearThrust: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
  mainSpoolDelay: number;
  retroSpoolDelay: number;
  verticalSpoolDelay: number;
  linearDrag: number;
  coastDecel: number;
  brakeGain: number;

  angularDrag: AngularState;   // primitive — per-axis RCS damping (tau = mass/drag); roll-only in practice
                               // now that angularThrust is derived from this for pitch/yaw too but no
                               // longer drives their live integration — see core/types.ts's ShipType doc
  maxAngVel: AngularState;     // primitive — angularThrust DERIVED from this + angularDrag

  // Flat rad/s^2 deceleration applied on roll-release (governor, not proportional drag) — see
  // core/types.ts's ShipType.rollReleaseDecel for the full rationale.
  rollReleaseDecel: number;

  // Natural frequency (rad/s) / damping ratio of pitch/yaw's 2nd-order spool-up+release model — see
  // core/types.ts's ShipType.angularSpoolOmega doc.
  angularSpoolOmega: { pitch: number; yaw: number };
  angularSpoolZeta: { pitch: number; yaw: number };

  scmSpeed: number;
  scmSpeedBack: number;

  boostSpeedForward: number;
  boostSpeedBack: number;
  boostLinearDrag: number;
  boostLinearThrust: { main: number; retro: number };  // no strafe/vertical yet — see candidateRefinements
  boostMaxAngVel: AngularState;                         // primitive — boostAngularThrust DERIVED
  boostAngularSpoolOmega: { pitch: number; yaw: number };
  boostAngularSpoolZeta: { pitch: number; yaw: number };

  boostCapacity: number;
  boostRedZonePct: number;
  boostReactivatePct: number;
  boostDrainRate: number;
  boostDrainRateRedZone: number;
  boostRechargeRate: number;
  boostRechargeRateRedZone: number;
  boostRechargeDelaySec: number;

  hullRadius: number;

  candidateRefinements?: CandidateRefinements;
}
