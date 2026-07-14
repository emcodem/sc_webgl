import { describe, it, expect } from 'vitest';
import {
  clamp, cross, normalize, dot, sub, add, scale, length, projectOntoPlane, rotateAboutAxis
} from '../src/math/vec';

describe('clamp', () => {
  it('passes values inside the range through unchanged', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps to lo/hi outside the range', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('normalize', () => {
  it('unit-length result for a non-zero vector', () => {
    const n = normalize({ x: 3, y: 0, z: 4 });
    expect(n).toEqual({ x: 0.6, y: 0, z: 0.8 });
  });

  it('does not throw on the zero vector, returns zero rather than NaN', () => {
    const n = normalize({ x: 0, y: 0, z: 0 });
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('cross / dot', () => {
  it('cross of +X and +Y is +Z (right-handed)', () => {
    expect(cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('dot of orthogonal unit vectors is 0', () => {
    expect(dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
  });

  it('dot of a vector with itself is its squared length', () => {
    const v = { x: 3, y: 4, z: 0 };
    expect(dot(v, v)).toBeCloseTo(length(v) ** 2, 10);
  });
});

describe('add / sub / scale / length', () => {
  it('add and sub are inverses', () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: 4, y: -5, z: 6 };
    expect(sub(add(a, b), b)).toEqual(a);
  });

  it('scale multiplies each component', () => {
    expect(scale({ x: 1, y: -2, z: 3 }, 2)).toEqual({ x: 2, y: -4, z: 6 });
  });

  it('length matches the euclidean norm', () => {
    expect(length({ x: 3, y: 4, z: 0 })).toBe(5);
  });
});

describe('projectOntoPlane', () => {
  it('leaves a vector already tangent to the axis unchanged', () => {
    const tangent = { x: 1, y: 0, z: 0 };
    const p = projectOntoPlane(tangent, { x: 0, y: 1, z: 0 });
    expect(p.x).toBeCloseTo(1, 10);
    expect(p.y).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(0, 10);
  });

  it('returns ~zero when v is parallel to axis (degenerate tangent case)', () => {
    const p = projectOntoPlane({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(0, 10);
  });

  it('strips the axis-aligned component of a mixed vector', () => {
    const p = projectOntoPlane({ x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(p).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe('rotateAboutAxis', () => {
  it('angle 0 leaves the vector unchanged', () => {
    const v = { x: 1, y: 2, z: 3 };
    const r = rotateAboutAxis(v, { x: 0, y: 0, z: 1 }, 0);
    expect(r.x).toBeCloseTo(v.x, 10);
    expect(r.y).toBeCloseTo(v.y, 10);
    expect(r.z).toBeCloseTo(v.z, 10);
  });

  it('rotating +X by +90deg about +Z gives +Y (right-handed)', () => {
    const r = rotateAboutAxis({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(1, 10);
    expect(r.z).toBeCloseTo(0, 10);
  });

  it('rotating by PI negates a vector perpendicular to the axis', () => {
    const v = { x: 1, y: 0, z: 0 };
    const r = rotateAboutAxis(v, { x: 0, y: 0, z: 1 }, Math.PI);
    expect(r.x).toBeCloseTo(-1, 10);
    expect(r.y).toBeCloseTo(0, 10);
    expect(r.z).toBeCloseTo(0, 10);
  });

  it('leaves the component along the axis untouched', () => {
    const r = rotateAboutAxis({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 1 }, Math.PI / 3);
    expect(r.z).toBeCloseTo(5, 10);
  });
});
