import { describe, it, expect } from 'vitest';
import { project, type Camera } from '../src/combat/projection';

const IDENTITY_CAM: Camera = {
  pos: { x: 0, y: 0, z: 0 },
  axes: { forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } }
};

describe('project', () => {
  it('projects a point straight ahead to the viewport center', () => {
    const p = project(0, 0, 100, IDENTITY_CAM, 1000, 800);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(500, 5);
    expect(p!.y).toBeCloseTo(400, 5);
  });

  it('returns null for a point behind the camera', () => {
    expect(project(0, 0, -50, IDENTITY_CAM, 1000, 800)).toBeNull();
  });

  it('returns null exactly at the cz <= 1 boundary', () => {
    expect(project(0, 0, 1, IDENTITY_CAM, 1000, 800)).toBeNull();
    expect(project(0, 0, 1.0001, IDENTITY_CAM, 1000, 800)).not.toBeNull();
  });

  it('focal length (and therefore screen position) depends only on viewportHeight, not width', () => {
    const a = project(10, 0, 100, IDENTITY_CAM, 1000, 800);
    const b = project(10, 0, 100, IDENTITY_CAM, 500, 800);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.scale).toBeCloseTo(b!.scale, 10);
    // x differs only by the viewport-center offset (width/2), not by the projected offset itself
    expect(a!.x - 1000 / 2).toBeCloseTo(b!.x - 500 / 2, 6);
  });
});
