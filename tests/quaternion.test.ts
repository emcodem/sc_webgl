import { describe, it, expect } from 'vitest';
import { computeAxes, lookAtQuat, rotateTowards, slerp, quatNormalize } from '../src/math/quaternion';
import type { Quat, Vec3 } from '../src/core/types';

function len(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function quatDot(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}
function negateQuat(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
}
// Rotation of `angle` radians about a unit `axis`, used to build known test fixtures.
function axisAngleQuat(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return quatNormalize({ x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) });
}
function angleBetween(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.max(-1, Math.abs(quatDot(a, b))));
  return 2 * Math.acos(d);
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

describe('computeAxes', () => {
  it('produces an orthonormal basis at identity, matching the forward=+Z/right=+X/up=-Y convention', () => {
    const axes = computeAxes(IDENTITY);
    expect(axes.forward).toEqual({ x: 0, y: 0, z: 1 });
    expect(axes.right).toEqual({ x: 1, y: 0, z: 0 });
    expect(axes.up).toEqual({ x: 0, y: -1, z: 0 });
  });

  it('stays orthonormal after an arbitrary rotation', () => {
    const q = axisAngleQuat({ x: 0, y: 1, z: 0 }, 0.7);
    const axes = computeAxes(q);
    expect(len(axes.forward)).toBeCloseTo(1, 10);
    expect(len(axes.right)).toBeCloseTo(1, 10);
    expect(len(axes.up)).toBeCloseTo(1, 10);
    expect(dot(axes.forward, axes.right)).toBeCloseTo(0, 10);
    expect(dot(axes.forward, axes.up)).toBeCloseTo(0, 10);
    expect(dot(axes.right, axes.up)).toBeCloseTo(0, 10);
  });
});

describe('lookAtQuat', () => {
  it('falls back to a different up hint when forward is parallel to upHint', () => {
    // default upHint is {0,1,0}; forward pointing straight along it is the degenerate case.
    const q = lookAtQuat({ x: 0, y: 1, z: 0 });
    const axes = computeAxes(q);
    expect(len(axes.forward)).toBeCloseTo(1, 10);
    expect(dot(axes.forward, { x: 0, y: 1, z: 0 })).toBeCloseTo(1, 5);
    // right/up must still be a valid orthonormal completion, not NaN from a zero-length cross product.
    expect(Number.isFinite(axes.right.x)).toBe(true);
    expect(dot(axes.forward, axes.right)).toBeCloseTo(0, 10);
  });

  it('builds a basis whose forward matches the requested direction in the non-degenerate case', () => {
    const q = lookAtQuat({ x: 1, y: 0, z: 0 });
    const axes = computeAxes(q);
    expect(axes.forward.x).toBeCloseTo(1, 10);
    expect(axes.forward.y).toBeCloseTo(0, 10);
    expect(axes.forward.z).toBeCloseTo(0, 10);
  });
});

describe('slerp', () => {
  it('near-parallel quats (dot > 0.9995) take the linear-interpolation branch and land at t between them', () => {
    const a = IDENTITY;
    const b = axisAngleQuat({ x: 0, y: 1, z: 0 }, 0.01); // tiny rotation, dot(a,b) well above 0.9995
    const mid = slerp(a, b, 0.5);
    const angleAM = angleBetween(a, mid);
    const angleAB = angleBetween(a, b);
    expect(angleAM).toBeCloseTo(angleAB / 2, 3);
  });

  it('opposite-hemisphere quats (dot < 0) are flipped so slerp still takes the short path', () => {
    const a = axisAngleQuat({ x: 0, y: 0, z: 1 }, 0.3);
    const b = negateQuat(a); // represents the exact same rotation as `a`, but dot(a,b) < 0
    const result = slerp(a, b, 0.5);
    // a and b are the same orientation, so the short-path result must equal that orientation too.
    expect(angleBetween(result, a)).toBeCloseTo(0, 6);
  });
});

describe('rotateTowards', () => {
  const axis = { x: 0, y: 1, z: 0 };

  it('snaps directly to the target once within maxAngleRad', () => {
    const target = axisAngleQuat(axis, 0.1);
    const result = rotateTowards(IDENTITY, target, 0.2);
    expect(angleBetween(result, target)).toBeCloseTo(0, 6);
  });

  it('advances by exactly maxAngleRad when the target is farther than that', () => {
    const target = axisAngleQuat(axis, 0.5);
    const result = rotateTowards(IDENTITY, target, 0.1);
    expect(angleBetween(IDENTITY, result)).toBeCloseTo(0.1, 3);
  });
});
