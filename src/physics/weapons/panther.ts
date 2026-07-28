import type { WeaponType } from '../../core/types';

// CF-337 Panther Repeater S3 — the Gladius carries 3 of these (left wing, right wing, nose — see
// combat/weapons.ts's MUZZLE_MOUNTS), each firing and recharging as its OWN independent gun, not a
// shared ship-wide pool. Ballistics/fire-rate carried over unchanged from the old global WEAPON
// const in combat/weapons.ts (muzzleSpeed 1400, fireRate 15 — an arcade-balance choice, already 1.5x
// the original project's 10, not a real-RPM figure — lifetime 2.5, muzzleForward 8, damage 1,
// convergeDist 800, minConvergeDist 150).
//
// Capacitor fields are NEW (GitHub #2: limited shots + reload delay, per gun). First pass copied
// reference/ships/aegs-gladius.json's `KLWE_LaserRepeater_S3` entry verbatim:
//   "capacitor": { "max_ammo_load": 75, "regen_per_second": 15, "cooldown": 0.74,
//                  "costs_per_shot": 48.5 }
// CONFIRMED BROKEN in actual play (not just "unconfirmed noise" — this was hands-on tested and
// called out): costs_per_shot (48.5) leaves only ~26.5 of a gun's 75-ammo pool after ONE shot, well
// under the 48.5 needed for a second, so a single gun fires exactly once before waiting; with 3 guns
// cycling round-robin the whole ship goes dry after 3 rounds — a single trigger pull reads as
// "empty after one shot." That 48.5 figure is also sized against the real gun's own 750rpm (12.5
// rounds/sec) cadence, not this sim's already-diverged 15 rounds/sec arcade `fireRate` (see that
// field's own note) — importing a per-shot cost tuned for a different fire rate compounds the
// mismatch on top of whatever noise was already in the wiki dump.
//
// capacitorCostPerShot is therefore HAND-TUNED (status: estimated, not measured) to actually be
// playable at this weapon's own fireRate: 5 ammo/shot, i.e. 15 shots to drain one gun from full.
// At fireRate 15/s, 3 guns cycling round-robin gives ~45 rounds (~3s of continuous fire) before
// every gun runs dry — a real sustained-fire limiter instead of an instant cutoff. capacitorCapacity
// (75) and capacitorRechargeRate (15/s, full refill in 5s) and capacitorRechargeDelaySec (0.74s) are
// kept from the JSON since they aren't the part that broke. Needs a real frame-tracked capture
// (capture/weapon_capacitor_capture.py, modeled on boost_meter_capture.py) before any of this is
// trusted — same stopgap-then-measure lifecycle the boost meter went through (see gladius.ts's boost
// provenance comment).
export const PANTHER_S3: WeaponType = {
  name: 'CF-337 Panther Repeater S3',
  muzzleSpeed: 1400,
  fireRate: 15,
  lifetime: 2.5,
  muzzleForward: 8,
  damage: 1,
  convergeDist: 800,
  minConvergeDist: 150,

  capacitorCapacity: 75,          // ammo, per gun — ESTIMATED, see note above
  capacitorCostPerShot: 5,        // ammo per shot (15 shots/gun to empty) — ESTIMATED, see note above
  capacitorRechargeRate: 15,      // ammo/s, per gun — ESTIMATED, see note above
  capacitorRechargeDelaySec: 0.74 // s — ESTIMATED, see note above
};
