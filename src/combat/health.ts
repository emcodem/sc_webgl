import type { Health } from '../core/types';

export function createHealth(maxPoints: number): Health {
  return { points: maxPoints, maxPoints };
}

// Subtracts `amount` points and returns true once this call brings points to 0 or below, i.e. the
// target is destroyed.
export function applyDamage(health: Health, amount: number): boolean {
  health.points = Math.max(0, health.points - amount);
  return health.points <= 0;
}
