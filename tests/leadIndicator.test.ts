import { describe, it, expect } from 'vitest';
import { computeLeadPoint, closestApproachIfFiredNow, wouldHitIfFiredNow } from '../src/combat/leadIndicator';

const ORIGIN = { x: 0, y: 0, z: 0 };
const ZERO = { x: 0, y: 0, z: 0 };

describe('computeLeadPoint', () => {
  it('aims straight at a stationary target when the shooter is also stationary', () => {
    const lead = computeLeadPoint(ORIGIN, ZERO, { x: 100, y: 0, z: 0 }, ZERO, 100);
    expect(lead).toEqual({ x: 100, y: 0, z: 0 });
  });

  it('returns null when the discriminant is negative (target unreachable at any time)', () => {
    // target crossing perpendicular far faster than the projectile can ever catch up
    const lead = computeLeadPoint(ORIGIN, ZERO, { x: 0, y: 100, z: 0 }, { x: 10000, y: 0, z: 0 }, 100);
    expect(lead).toBeNull();
  });

  it('returns null when both quadratic roots are negative (only reachable in the past)', () => {
    const lead = computeLeadPoint(ORIGIN, ZERO, { x: -100, y: 0, z: 0 }, { x: -1000, y: 0, z: 0 }, 100);
    expect(lead).toBeNull();
  });

  it('returns null in the linear-fallback branch (|vRel| == projectileSpeed) when the target is receding', () => {
    // target moving directly away at exactly the projectile's speed can never be caught
    const lead = computeLeadPoint(ORIGIN, ZERO, { x: 100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, 100);
    expect(lead).toBeNull();
  });

  it('resolves the linear-fallback branch (|vRel| == projectileSpeed) when the target is closing', () => {
    const lead = computeLeadPoint(ORIGIN, ZERO, { x: 100, y: 0, z: 0 }, { x: -100, y: 0, z: 0 }, 100);
    expect(lead).not.toBeNull();
    expect(lead!.x).toBeCloseTo(50, 5);
    expect(lead!.y).toBeCloseTo(0, 5);
    expect(lead!.z).toBeCloseTo(0, 5);
  });
});

describe('closestApproachIfFiredNow', () => {
  it('clamps t to 0 when relative speed is ~0 (relSpeedSq < 1e-9 guard)', () => {
    const dist = closestApproachIfFiredNow(
      ORIGIN, ZERO, { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 50 }, { x: 0, y: 0, z: 100 }, // target already moving exactly with the projectile
      100, 10
    );
    expect(dist).toBeCloseTo(50, 5);
  });

  it('clamps t to maxTime rather than extrapolating to the true closest approach', () => {
    const shooterForward = { x: 0, y: 0, z: 1 };
    const target = { x: 0, y: 0, z: 1000 };
    const clamped = closestApproachIfFiredNow(ORIGIN, ZERO, shooterForward, target, ZERO, 10, 5);
    const unclamped = closestApproachIfFiredNow(ORIGIN, ZERO, shooterForward, target, ZERO, 10, 1000);
    expect(unclamped).toBeLessThan(clamped);
    expect(clamped).toBeCloseTo(950, 5); // relVel = -10 along z, sep after 5s = 1000 - 50
  });
});

describe('wouldHitIfFiredNow', () => {
  it('is true when the closest approach falls within the target radius', () => {
    const hit = wouldHitIfFiredNow(ORIGIN, ZERO, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 100 }, ZERO, 10, 100, 5);
    expect(hit).toBe(true);
  });

  it('is false when the closest approach falls outside the target radius', () => {
    const hit = wouldHitIfFiredNow(ORIGIN, ZERO, { x: 0, y: 0, z: 1 }, { x: 50, y: 0, z: 100 }, ZERO, 10, 100, 5);
    expect(hit).toBe(false);
  });
});
