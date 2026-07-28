import { describe, it, expect } from 'vitest';
import { edgeIndicatorDirection, type Camera } from '../src/combat/projection';

const IDENTITY_CAM: Camera = {
  pos: { x: 0, y: 0, z: 0 },
  axes: { forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } }
};

// Places a target at angle `alphaDeg` off the camera's forward axis, sweeping through the
// horizontal plane (right/forward), at unit distance.
function targetAt(alphaDeg: number): { x: number; y: number; z: number } {
  const a = (alphaDeg * Math.PI) / 180;
  return { x: Math.sin(a), y: 0, z: Math.cos(a) };
}

describe('edgeIndicatorDirection', () => {
  it('points right (dirX > 0) for a target just off-axis to the right, in front', () => {
    const { dirX } = edgeIndicatorDirection(targetAt(30).x, 0, targetAt(30).z, IDENTITY_CAM);
    expect(dirX).toBeGreaterThan(0);
  });

  it('points left (dirX < 0) for a target just off-axis to the left, in front', () => {
    const { dirX } = edgeIndicatorDirection(targetAt(-30).x, 0, targetAt(-30).z, IDENTITY_CAM);
    expect(dirX).toBeLessThan(0);
  });

  // Regression for the "arrow jumps side to side multiple times during a 360° yaw" bug: a target
  // more than 90° off-axis (behind the camera plane) but still less than 180° away — i.e. still
  // closer via the SAME turn direction as it was just before crossing 90° — must not flip sides.
  // A previous version flipped both axes whenever camZ < 0 (>90° off-axis), which incorrectly
  // flipped the arrow here even though turning right is still the shorter way to 100°.
  it('keeps pointing right for a target 100° right of forward (past the 90° boundary, still short way right)', () => {
    const t = targetAt(100);
    const { dirX } = edgeIndicatorDirection(t.x, 0, t.z, IDENTITY_CAM);
    expect(dirX).toBeGreaterThan(0);
  });

  it('keeps pointing left for a target 100° left of forward (past the 90° boundary, still short way left)', () => {
    const t = targetAt(-100);
    const { dirX } = edgeIndicatorDirection(t.x, 0, t.z, IDENTITY_CAM);
    expect(dirX).toBeLessThan(0);
  });

  it('flips exactly once across a full 360° sweep, at the true 180° (directly behind) ambiguity point', () => {
    let flips = 0;
    let prevSign = 0;
    for (let deg = 1; deg < 360; deg++) {
      if (deg === 180) continue; // exact antipodal point: dirX == 0, not a "side" by construction
      const t = targetAt(deg);
      const { dirX } = edgeIndicatorDirection(t.x, 0, t.z, IDENTITY_CAM);
      const sign = Math.sign(dirX);
      if (prevSign !== 0 && sign !== 0 && sign !== prevSign) flips++;
      if (sign !== 0) prevSign = sign;
    }
    expect(flips).toBe(1);
  });

  it('both components vanish exactly at the antipodal (directly behind) point', () => {
    const t = targetAt(180);
    const { dirX, dirY } = edgeIndicatorDirection(t.x, 0, t.z, IDENTITY_CAM);
    expect(dirX).toBeCloseTo(0, 10);
    expect(dirY).toBeCloseTo(0, 10);
  });

  it('dirY points up (negative) for a target above forward, and stays consistent behind camera too', () => {
    // 30° above forward, straight ahead horizontally
    const above = { x: 0, y: Math.sin((30 * Math.PI) / 180), z: Math.cos((30 * Math.PI) / 180) };
    const inFront = edgeIndicatorDirection(above.x, above.y, above.z, IDENTITY_CAM);
    // 30° above the axis pointing directly BEHIND (150° off forward in the vertical plane)
    const behindAbove = { x: 0, y: Math.sin((30 * Math.PI) / 180), z: -Math.cos((30 * Math.PI) / 180) };
    const behind = edgeIndicatorDirection(behindAbove.x, behindAbove.y, behindAbove.z, IDENTITY_CAM);
    // Screen Y is flipped (up = negative dirY) in both cases, no camZ-based sign change.
    expect(inFront.dirY).toBeLessThan(0);
    expect(behind.dirY).toBeLessThan(0);
  });
});
