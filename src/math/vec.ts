import type { Vec3 } from '../core/types';

// ---------- Small Vec3 helpers ----------
// Ported verbatim from the original 2D-canvas project (starcitizen_flightsim/src/math/vec.ts) —
// the flight model depends on the exact shape of these, so don't "modernize" them.

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function addScaled(target: Vec3, vec: Vec3, s: number): void {
  target.x += vec.x * s;
  target.y += vec.y * s;
  target.z += vec.z * s;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

// ---------- Additions for the universe-scale sim (not in the original) ----------

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function clone(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

// Linear interpolation between two points — used by replay/player.ts to reconstruct a smooth
// position/velocity between two recorded samples (orientation uses quaternion.ts's slerp instead).
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

// Component of `v` remaining after removing everything along unit vector `axis` — i.e. the
// projection of v onto the plane whose normal is `axis`. Used by the character controller to keep
// movement/heading tangent to a planet's curved surface.
export function projectOntoPlane(v: Vec3, axis: Vec3): Vec3 {
  const d = dot(v, axis);
  return { x: v.x - axis.x * d, y: v.y - axis.y * d, z: v.z - axis.z * d };
}

// Rotate `v` about unit vector `axis` by `angle` radians (Rodrigues' rotation formula). Used for
// on-foot yaw (rotating the tangent heading around the local surface up).
export function rotateAboutAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const d = dot(axis, v);
  const cr = cross(axis, v);
  return {
    x: v.x * c + cr.x * s + axis.x * d * (1 - c),
    y: v.y * c + cr.y * s + axis.y * d * (1 - c),
    z: v.z * c + cr.z * s + axis.z * d * (1 - c)
  };
}
