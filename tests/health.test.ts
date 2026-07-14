import { describe, it, expect } from 'vitest';
import { createHealth, applyDamage } from '../src/combat/health';

describe('createHealth', () => {
  it('starts full at maxPoints', () => {
    expect(createHealth(10)).toEqual({ points: 10, maxPoints: 10 });
  });
});

describe('applyDamage', () => {
  it('subtracts the given amount', () => {
    const h = createHealth(10);
    applyDamage(h, 3);
    expect(h.points).toBe(7);
  });

  it('clamps to 0 rather than going negative when damage exceeds remaining points', () => {
    const h = createHealth(5);
    applyDamage(h, 100);
    expect(h.points).toBe(0);
  });

  it('returns false while points remain above 0', () => {
    const h = createHealth(10);
    expect(applyDamage(h, 9)).toBe(false);
  });

  it('returns true exactly when points reach 0', () => {
    const h = createHealth(10);
    expect(applyDamage(h, 10)).toBe(true);
  });

  it('returns true when damage overkills past 0', () => {
    const h = createHealth(10);
    expect(applyDamage(h, 999)).toBe(true);
  });
});
