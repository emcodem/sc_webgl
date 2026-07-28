import type { WeaponType } from '../../core/types';

// CF-337 Panther Repeater S3 — the Gladius' twin guns (reference/ships/aegs-gladius.json confirms
// the real Gladius carries two of these). Ballistics/fire-rate carried over unchanged from the old
// global WEAPON const in combat/weapons.ts (muzzleSpeed 1400, fireRate 15 — an arcade-balance choice,
// already 1.5x the original project's 10, not a real-RPM figure — lifetime 2.5, muzzleForward 8,
// damage 1, convergeDist 800, minConvergeDist 150).
//
// Capacitor fields are NEW (GitHub #2: limited shots + reload delay) and PROVISIONAL/SUSPECT —
// seeded from reference/ships/aegs-gladius.json's `KLWE_LaserRepeater_S3` entry (line ~2741):
//   "capacitor": { "max_ammo_load": 75, "regen_per_second": 15, "cooldown": 0.74,
//                  "costs_per_shot": 48.5 }
// Converted to "shots" units (capacity/regen divided by costs_per_shot) rather than re-derived from
// a real capture, same stopgap the boost meter briefly used before its own capture landed. This
// ratio is NOISE, not a trustworthy number: max_ammo_load / costs_per_shot ~= 1.5 "shots" doesn't
// hold up for a repeater (same kind of wiki/datamine noise the boost work hit — see gladius.ts's
// boost provenance comment for that precedent). Needs a real frame-tracked capture
// (capture/weapon_capacitor_capture.py, modeled on boost_meter_capture.py) before this is trusted —
// do not treat these three fields as measured. cooldown (0.74s, the post-fire recharge dwell) is the
// one field here plausibly trustworthy as-is, since it's a plain seconds value with no unit
// conversion needed.
export const PANTHER_S3: WeaponType = {
  name: 'CF-337 Panther Repeater S3',
  muzzleSpeed: 1400,
  fireRate: 15,
  lifetime: 2.5,
  muzzleForward: 8,
  damage: 1,
  convergeDist: 800,
  minConvergeDist: 150,

  capacitorCapacity: 75 / 48.5,          // ~1.546 shots — SUSPECT, see note above
  capacitorRechargeRate: 15 / 48.5,      // ~0.309 shots/sec — SUSPECT, see note above
  capacitorRechargeDelaySec: 0.74        // s — plausible as-is
};
