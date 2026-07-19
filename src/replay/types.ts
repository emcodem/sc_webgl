import type { AngularState, Quat, Vec3 } from '../core/types';

// ============================================================================================
// Replay clip schema — a recorded sequence of player + enemy ship state, for in-app flight
// review, file-based sharing, and (later, not built yet) a relative-motion AI training dataset.
// State-snapshot, not input-replay: each frame stores the REALIZED pos/quat/vel/angVel etc., not
// just control inputs to re-simulate, so it's immune to any physics/AI nondeterminism and is
// exactly what a future dataset would want (real trajectories). Inputs are stored alongside the
// state anyway (see ReplayEntitySnapshot.inputs) since they're cheap to capture now and expensive
// to retrofit into old clips later, even though nothing consumes them yet.
//
// See replay/recorder.ts (produces clips), replay/player.ts (plays them back), replay/io.ts
// (file export/import).
// ============================================================================================

// v2: the file format (see replay/io.ts) switched from verbose named-object JSON to a compact
// array/manifest encoding + gzip, after measuring a real recorded clip at ~5KB/frame with 11
// enemies (mostly repeated "shipTypeId":"Gladius" strings and full float64 precision nobody
// needed) — v1 files are no longer readable. This in-memory ReplayClip/ReplayFrame shape itself
// is unchanged; only how it's serialized to a file changed.
// v3: added ReplayEvent (fire/impact/explosion) — v2 files are no longer readable.
export const REPLAY_SCHEMA_VERSION = 3;

export interface ReplayInputs {
  throttle: number;
  pitch: number;
  yaw: number;
  roll: number;
  strafeX: number;
  strafeY: number;
  brake: boolean;
  decoupled: boolean;
}

export interface ReplayEntitySnapshot {
  shipTypeId: string; // ShipType.name (see physics/ships' registry) — looked up on
                       // playback rather than duplicating the full (large, static) tuning object.
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  angVel: AngularState;
  healthFrac: number; // health.points / health.maxPoints — a ratio survives replay against a
                       // placeholder ship whose maxPoints won't generally match the original run.
  boosting: boolean;
  inputs: ReplayInputs | null; // null = no flight-model tick ran for this entity this sample
                               // (e.g. a behavior with no FlightInputs, like turret/cruiser)
}

export interface ReplayFrame {
  simTime: number; // seconds since recording start — NOT assumed uniformly spaced
  player: ReplayEntitySnapshot;
  enemies: (ReplayEntitySnapshot | null)[]; // null = that enemy was dead/despawned this sample;
                                             // index-stable across the whole clip
}

// Weapon fire and impact/explosion bursts are recorded as discrete EVENTS, not per-frame
// snapshots — both are fully analytic (a projectile travels at constant velocity with no
// drag/gravity; an effect is just a countdown timer), so replaying them only needs the spawn
// moment, not a continuous sample stream. See replay/recorder.ts for how these are derived and
// replay/player.ts for how they're reconstructed at an arbitrary scrub time.
export interface ReplayFireEvent {
  kind: 'fire';
  simTime: number;    // when the round left the muzzle
  endSimTime: number; // when it stopped being visible — hit something or hit WEAPON.lifetime,
                      // whichever came first in the original recording (always >= simTime)
  owner: 'player' | 'enemy';
  pos: Vec3; // muzzle position at simTime (back-derived from the projectile's age when first seen,
             // not wherever it happened to already be by the time the recorder noticed it)
  vel: Vec3; // constant for the round's whole life
}

export interface ReplayEffectEvent {
  kind: 'impact' | 'explosion';
  simTime: number; // when the burst triggered
  pos: Vec3;
  normal?: Vec3; // 'impact' only
}

export type ReplayEvent = ReplayFireEvent | ReplayEffectEvent;

export interface ReplayClip {
  schemaVersion: number;
  recordedAt: string; // ISO timestamp, for filenames/listing
  sampleHz: number;   // nominal capture rate (informational only — simTime is authoritative)
  frames: ReplayFrame[];
  events: ReplayEvent[]; // simTime-ordered
}
