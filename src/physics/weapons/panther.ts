import type { WeaponType } from '../../core/types';

// CF-337 Panther Repeater S3 — the Gladius carries 3 of these (left wing, right wing, nose — see
// combat/weapons.ts's MUZZLE_MOUNTS), each an independent gun for capacitor purposes, not a shared
// ship-wide pool.
//
// muzzleSpeed/fireRate corrected to the REAL gun's own figures (per user correction, matching
// reference/ships/aegs-gladius.json's `KLWE_LaserRepeater_S3` entry): 1480 m/s ammunition speed,
// 750 rpm = 12.5 rounds/sec. Supersedes the old global WEAPON const's placeholder 1400/15 (a
// made-up "1.5x the original project's 10" arcade value, never actually measured against this gun).
//
// FIRING MODEL (per user correction): all 3 mounts fire TOGETHER every tick (see
// combat/weapons.ts's tryFireWeapon), not cycling one-at-a-time. A single-stream cycling model was
// tried first but couldn't be reconciled with the real, directly-observed timing: a real gun's own
// 75-round capacitor visibly empties in ~7s of continuous fire, which only lines up with the real
// 12.5 rounds/sec rate (75/12.5 = 6s, close enough) if that ONE gun receives (very nearly) every
// tick's shot — cycling 3 guns 1-in-3 would stretch that to ~18s, and did in testing. Firing all 3
// together triples total rounds/damage output relative to a single 12.5rds/sec stream, so `damage`
// below is cut to 1/3 of the original placeholder (1 -> 1/3) to keep overall DPS roughly where it
// was rather than tripling it outright — an arbitrary compensating choice, not a measured one.
//
// Capacitor fields are NEW (GitHub #2: limited shots + reload delay, per gun). First pass copied
// reference/ships/aegs-gladius.json's capacitor block verbatim:
//   "capacitor": { "max_ammo_load": 75, "regen_per_second": 15, "cooldown": 0.74,
//                  "costs_per_shot": 48.5 }
// CONFIRMED BROKEN in actual play: costs_per_shot (48.5) leaves only ~26.5 of a gun's 75-ammo pool
// after ONE shot, well under the 48.5 needed for a second. A hand-tuned 5-ammo/shot patch (15
// shots/gun) was tried next and also wasn't grounded in anything real.
//
// capacitorCostPerShot is now the more defensible literal reading of max_ammo_load itself: 75 SHOTS
// per gun, 1 ammo per shot — no invented conversion factor, and matches "75" reading naturally as
// "75 rounds in the mag." Combined with the simultaneous-fire model above, that's ~6s of continuous
// fire per gun before it runs dry — matching the real ~7s observation. capacitorRechargeRate (15/s)
// is kept from the JSON since it isn't the part that broke; capacitorRechargeDelaySec is corrected
// below (per user correction) from the JSON's 0.74s to 0.5s. Still needs a real frame-tracked
// capture (capture/weapon_capacitor_capture.py, modeled on boost_meter_capture.py) before any of
// this is trusted — same stopgap-then-measure lifecycle the boost meter went through (see
// gladius.ts's boost provenance comment).
export const PANTHER_S3: WeaponType = {
  name: 'CF-337 Panther Repeater S3',
  muzzleSpeed: 1480,
  fireRate: 12.5,
  lifetime: 2.5,
  muzzleForward: 8,
  damage: 1 / 3,          // cut from 1 to compensate for firing 3x as many rounds/tick — see note above
  convergeDist: 800,
  minConvergeDist: 150,

  capacitorCapacity: 75,          // ammo (== shots), per gun — ESTIMATED, see note above
  capacitorCostPerShot: 1,        // ammo per shot (75 shots/gun to empty) — ESTIMATED, see note above
  capacitorRechargeRate: 15,      // ammo/s, per gun — ESTIMATED, see note above
  capacitorRechargeDelaySec: 0.5  // s — per user correction (was 0.74, the JSON's literal value)
};
