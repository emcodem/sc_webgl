import type { WeaponType } from '../../core/types';

// CF-337 Panther Repeater S3 — the Gladius carries 3 of these (left wing, right wing, nose — see
// combat/weapons.ts's MUZZLE_MOUNTS), each firing and recharging as its OWN independent gun, not a
// shared ship-wide pool.
//
// muzzleSpeed/fireRate corrected to the REAL gun's own figures (per user correction, matching
// reference/ships/aegs-gladius.json's `KLWE_LaserRepeater_S3` entry): 1480 m/s ammunition speed,
// 750 rpm = 12.5 rounds/sec. Supersedes the old global WEAPON const's placeholder 1400/15 (a
// made-up "1.5x the original project's 10" arcade value, never actually measured against this gun).
//
// Capacitor fields are NEW (GitHub #2: limited shots + reload delay, per gun). First pass copied
// reference/ships/aegs-gladius.json's capacitor block verbatim:
//   "capacitor": { "max_ammo_load": 75, "regen_per_second": 15, "cooldown": 0.74,
//                  "costs_per_shot": 48.5 }
// CONFIRMED BROKEN in actual play: costs_per_shot (48.5) leaves only ~26.5 of a gun's 75-ammo pool
// after ONE shot, well under the 48.5 needed for a second — a single gun fires exactly once before
// waiting, so with 3 guns cycling round-robin the whole ship goes dry after 3 rounds. A hand-tuned
// 5-ammo/shot patch (15 shots/gun) was tried next and also isn't grounded in anything real.
//
// capacitorCostPerShot is now the more defensible literal reading of max_ammo_load itself: 75 SHOTS
// per gun, 1 ammo per shot — no invented conversion factor, and matches "75" reading naturally as
// "75 rounds in the mag" rather than some abstract energy unit. At 12.5 rounds/sec split 3 ways
// (~4.17 shots/sec per individual gun while cycling), that's ~18s of continuous fire per gun before
// it runs dry — a real magazine, not an instant cutoff. capacitorRechargeRate (15/s) and
// capacitorRechargeDelaySec (0.74s) are kept from the JSON since they aren't the part that broke.
// Still needs a real frame-tracked capture (capture/weapon_capacitor_capture.py, modeled on
// boost_meter_capture.py) before any of this is trusted — same stopgap-then-measure lifecycle the
// boost meter went through (see gladius.ts's boost provenance comment).
export const PANTHER_S3: WeaponType = {
  name: 'CF-337 Panther Repeater S3',
  muzzleSpeed: 1480,
  fireRate: 12.5,
  lifetime: 2.5,
  muzzleForward: 8,
  damage: 1,
  convergeDist: 800,
  minConvergeDist: 150,

  capacitorCapacity: 75,          // ammo (== shots), per gun — ESTIMATED, see note above
  capacitorCostPerShot: 1,        // ammo per shot (75 shots/gun to empty) — ESTIMATED, see note above
  capacitorRechargeRate: 15,      // ammo/s, per gun — ESTIMATED, see note above
  capacitorRechargeDelaySec: 0.74 // s — ESTIMATED, see note above
};
