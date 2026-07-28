import type { Vec3, WeaponType } from '../core/types';
import type { Projectile } from '../core/world';
import { PANTHER_S3 } from '../physics/weapons/panther';

// ---------- Weapons — traveling projectiles. Hit detection lives in combat/hitDetection.ts ----------

// Every ship in the sim carries this gun today (see physics/ships/gladius.ts's weaponType) — kept as
// a convenience default for spawnProjectileFrom and for the read-only ballistic lookups
// (combat/enemyAI.ts, combat/pipTargeting.ts, combat/ai/evasiveAI.ts, replay/player.ts,
// replay/recorder.ts) that predict shot behavior (lead points, replay event windows) without caring
// which specific shooter's gun it is — accurate as long as there's only one WeaponType in the game. A
// real second weapon would need those read-only call sites threaded with the actual shooter's
// ship.type.weaponType the same way the fire call sites below now are.
export const WEAPON: WeaponType = PANTHER_S3;

// Three hardpoints that fire TOGETHER every cycle (matches the real gun's 3-barrel repeater
// behavior — see tryFireWeapon): left wing, right wing, nose (underslung, centered). Each entry is
// an absolute (right, down) offset in metres, applied on top of forward/muzzleForward in
// spawnProjectileFrom. Each is also its OWN independent gun for capacitor purposes (GitHub #2) — see
// ShipBody/EnemyShip's weaponCapacitors, one entry per mount here, NOT a single ship-wide pool —
// though since all 3 always fire together they stay in lockstep, never partially depleted relative
// to each other.
//
// The offsets are solved from the camera's own 70 deg vertical FOV (see render/renderer.ts) at
// muzzleForward's 8m spawn depth, assuming a representative 16:9 window: half-height there is
// 8*tan(35 deg) ~= 5.6m and half-width (x1.778 aspect) ~= 9.96m, so the screen edges sit at
// right = +/-9.96 (left/right border), down = +5.6 (bottom border) and down = -5.6 (top). `down`
// is POSITIVE toward the bottom of the screen (spawnProjectileFrom subtracts along `up`, and up is
// -Y in this convention). The two wing guns fire from the left/right borders at 20% of screen
// height up from the bottom (down = 5.6 - 0.2*11.2 = 3.36); the nose gun fires from the
// bottom-center of the screen (down = +5.6). Will drift slightly off-target at window aspects far
// from 16:9, same as any fixed 3D offset would.
const MUZZLE_MOUNTS: { right: number; down: number }[] = [
  { right: -9.96, down: 3.36 }, // left wing — left border, 20% up from bottom
  { right: 9.96, down: 3.36 },  // right wing — right border, 20% up from bottom
  { right: 0, down: 5.6 }       // nose — bottom-center of screen
];

// Number of independent guns (and independent capacitors) a ship mounts — see core/world.ts's
// ShipBody.weaponCapacitors/weaponCapacitorCooldownTimers, both arrays of this length.
export const NUM_GUNS = MUZZLE_MOUNTS.length;

// Fallback cycle used only when a caller doesn't know/care which specific mount is firing (e.g. a
// test calling spawnProjectileFrom directly with no mountIndex). Real fire (tryFireWeapon below)
// always passes an explicit mountIndex — every mount fires every tick, so there's nothing to cycle.
let fallbackMuzzleIndex = 0;

// Spawns one round into `out`, generic over the shooter — any ShipBody or EnemyShip, since both
// carry pos/vel and a (forward, right, up) basis from computeAxes. `mountIndex` selects which
// MUZZLE_MOUNTS hardpoint fires (the caller — tryFireWeapon — tracks this per-shooter); omit it to
// fall back to a shared auto-cycling index, useful for callers that don't track per-gun state.
//
// Convergence: rather than firing parallel to the nose, each barrel aims from its own muzzle toward
// a single convergence point sitting `convergeDist` metres straight ahead on the boresight, so the
// left/right/nose tracers cross there. Pass the current target's range as `convergeDist` to make
// them meet right at the PIP; omit it to fall back to the weapon's own convergeDist. The point stays
// on the boresight (forward axis), so shots still go where the crosshair points — the guns just toe-in.
//
// `weapon` defaults to WEAPON (today's only gun) but callers that know their shooter's actual
// ship.type.weaponType should pass it explicitly — this is the one place ballistics are genuinely
// per-weapon rather than a shared assumption.
export function spawnProjectileFrom(
  pos: Vec3,
  vel: Vec3,
  forward: Vec3,
  right: Vec3,
  up: Vec3,
  owner: Projectile['owner'],
  out: Projectile[],
  convergeDist: number = WEAPON.convergeDist,
  weapon: WeaponType = WEAPON,
  mountIndex?: number
): void {
  if (mountIndex === undefined) {
    mountIndex = fallbackMuzzleIndex;
    fallbackMuzzleIndex = (fallbackMuzzleIndex + 1) % MUZZLE_MOUNTS.length;
  }
  const mount = MUZZLE_MOUNTS[mountIndex];
  const muzzleX = pos.x + right.x * mount.right - up.x * mount.down + forward.x * weapon.muzzleForward;
  const muzzleY = pos.y + right.y * mount.right - up.y * mount.down + forward.y * weapon.muzzleForward;
  const muzzleZ = pos.z + right.z * mount.right - up.z * mount.down + forward.z * weapon.muzzleForward;

  // Convergence point on the boresight, ahead of the ship center. Clamped so the toe-in angle stays
  // sane and can never fall behind the muzzle (which would fire the round backwards).
  const cd = Math.max(convergeDist, weapon.minConvergeDist);
  const convX = pos.x + forward.x * cd;
  const convY = pos.y + forward.y * cd;
  const convZ = pos.z + forward.z * cd;

  // Fire direction = from this muzzle toward the convergence point, renormalised to muzzleSpeed.
  let dirX = convX - muzzleX, dirY = convY - muzzleY, dirZ = convZ - muzzleZ;
  const invLen = 1 / (Math.hypot(dirX, dirY, dirZ) || 1);
  dirX *= invLen; dirY *= invLen; dirZ *= invLen;

  out.push({
    pos: { x: muzzleX, y: muzzleY, z: muzzleZ },
    prevPos: { x: muzzleX, y: muzzleY, z: muzzleZ }, // no travel yet — a spawn-frame hit sweeps a point
    vel: {
      x: vel.x + dirX * weapon.muzzleSpeed,
      y: vel.y + dirY * weapon.muzzleSpeed,
      z: vel.z + dirZ * weapon.muzzleSpeed
    },
    age: 0,
    owner
  });
}

// Advances every round by dt and removes any that have outlived the weapon's lifetime.
export function updateProjectiles(projectiles: Projectile[], dt: number, weapon: WeaponType = WEAPON): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.prevPos.x = pr.pos.x;
    pr.prevPos.y = pr.pos.y;
    pr.prevPos.z = pr.pos.z;
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;
    pr.pos.z += pr.vel.z * dt;
    pr.age += dt;
    if (pr.age > weapon.lifetime) projectiles.splice(i, 1);
  }
}

// Fresh per-gun capacitor state for a newly (re)spawned ship — NUM_GUNS entries, each starting full.
// Paired with an equal-length all-zero cooldown-timers array.
export function freshCapacitors(weapon: WeaponType): number[] {
  return new Array(NUM_GUNS).fill(weapon.capacitorCapacity);
}
export function freshCapacitorCooldowns(): number[] {
  return new Array(NUM_GUNS).fill(0);
}

// ---------- Weapon capacitor (GitHub #2) ----------
// EACH gun has its own charge pool (raw ammo units, matching real SC) that drains by
// capacitorCostPerShot when IT fires and, after a post-fire dwell (capacitorRechargeDelaySec),
// recharges at capacitorRechargeRate. Pure step function mirroring physics/flightModel.ts's
// resolveBoost, but reacting to a discrete "did THIS gun just fire" edge rather than a held-input
// percentage drain.
export function resolveCapacitor(
  weapon: WeaponType,
  capacitor: number,
  cooldownTimer: number,
  dt: number,
  justFired: boolean
): { capacitor: number; cooldownTimer: number } {
  if (justFired) {
    return { capacitor: capacitor - weapon.capacitorCostPerShot, cooldownTimer: weapon.capacitorRechargeDelaySec };
  }
  if (cooldownTimer > 0) {
    return { capacitor, cooldownTimer: Math.max(0, cooldownTimer - dt) };
  }
  const next = capacitor + weapon.capacitorRechargeRate * dt;
  return { capacitor: Math.min(weapon.capacitorCapacity, next), cooldownTimer: 0 };
}

// Consolidates the fire-cooldown + per-gun-capacitor gating that used to be hand-duplicated across 5
// call sites (the player in combat/combatSystem.ts, and four enemy behaviors in scenarios/runtime.ts).
// The real Panther S3 fires all 3 barrels together on every cycle (matches its real 12.5 rounds/sec
// cadence draining a single barrel's own 75-round capacitor in ~6s — a real single-stream
// interpretation left each gun firing only 1-in-3 rounds, stretching that to ~18s), so every
// successful tick spawns from EVERY mount and drains EVERY gun's capacitor together — they stay in
// lockstep, never partially depleted relative to each other. Ticks every gun's capacitor every frame
// regardless of whether the volley fires this frame (same "always ticks" convention as the old
// per-site `fireCooldown -= dt`), so recharge bookkeeping keeps running on frames nothing fires.
// `spawn` is the caller's own spawnProjectileFrom(...) call, invoked once per mount index so each
// site keeps its own aim/convergeDist logic.
export function tryFireWeapon(
  weapon: WeaponType,
  state: {
    fireCooldown: number;
    weaponCapacitors: number[];
    weaponCapacitorCooldownTimers: number[];
  },
  requested: boolean,
  dt: number,
  spawn: (mountIndex: number) => void
): boolean {
  state.fireCooldown -= dt;
  const canFire = requested && state.fireCooldown <= 0 &&
    state.weaponCapacitors.every((c) => c >= weapon.capacitorCostPerShot);
  for (let i = 0; i < state.weaponCapacitors.length; i++) {
    const res = resolveCapacitor(weapon, state.weaponCapacitors[i], state.weaponCapacitorCooldownTimers[i], dt, canFire);
    state.weaponCapacitors[i] = res.capacitor;
    state.weaponCapacitorCooldownTimers[i] = res.cooldownTimer;
  }
  if (!canFire) return false;
  for (let i = 0; i < state.weaponCapacitors.length; i++) spawn(i);
  state.fireCooldown = 1 / weapon.fireRate;
  return true;
}
