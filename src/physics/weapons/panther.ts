import type { WeaponType } from '../../core/types';

// CF-337 Panther Repeater S3 — the Gladius carries 3 of these (left wing, right wing, nose — see
// combat/weapons.ts's MUZZLE_MOUNTS), each firing and recharging as its OWN independent gun, not a
// shared ship-wide pool. Ballistics/fire-rate carried over unchanged from the old global WEAPON
// const in combat/weapons.ts (muzzleSpeed 1400, fireRate 15 — an arcade-balance choice, already 1.5x
// the original project's 10, not a real-RPM figure — lifetime 2.5, muzzleForward 8, damage 1,
// convergeDist 800, minConvergeDist 150).
//
// Capacitor fields are NEW (GitHub #2: limited shots + reload delay, per gun) — taken directly from
// reference/ships/aegs-gladius.json's `KLWE_LaserRepeater_S3` entry (line ~2741), in the SAME raw
// ammo units the game itself uses (not renormalized into a fractional "shots" count, which was an
// earlier — wrong — pass at this):
//   "capacitor": { "max_ammo_load": 75, "regen_per_second": 15, "cooldown": 0.74,
//                  "costs_per_shot": 48.5 }
// Still flagged SUSPECT pending a real frame-tracked capture (capture/weapon_capacitor_capture.py,
// modeled on boost_meter_capture.py) rather than trusted outright — same stopgap-then-measure
// lifecycle the boost meter went through (see gladius.ts's boost provenance comment). In particular,
// costs_per_shot (48.5) leaves only ~26.5 of a gun's own 75-ammo pool after one shot — well under the
// 48.5 needed for a second — so a single gun can only fire once before needing to wait on
// capacitorRechargeDelaySec + recharge; with 3 guns cycling round-robin that's still only 3 shots in
// a rapid burst before every gun is waiting. Plausible for a sustained-fire-limiting mechanic, but
// unconfirmed against how the real gun actually feels — exactly what the capture needs to check.
export const PANTHER_S3: WeaponType = {
  name: 'CF-337 Panther Repeater S3',
  muzzleSpeed: 1400,
  fireRate: 15,
  lifetime: 2.5,
  muzzleForward: 8,
  damage: 1,
  convergeDist: 800,
  minConvergeDist: 150,

  capacitorCapacity: 75,          // ammo, per gun — SUSPECT, see note above
  capacitorCostPerShot: 48.5,     // ammo per shot — SUSPECT, see note above
  capacitorRechargeRate: 15,      // ammo/s, per gun — SUSPECT, see note above
  capacitorRechargeDelaySec: 0.74 // s — plausible as-is
};
