// =====================================================================
// ESP — "Enhanced Stick Precision"-style aim assist. Always active: whenever the crosshair's
// current lead-indicator (see combat/pipTargeting.ts) falls within a configurable circle around
// screen center, yaw/pitch input is dampened the closer it gets to dead center. This is meant to
// curb overshoot when sweeping onto a fast-moving target, not to aim for the player. Modeled on
// real SC's actual ESP (per a player's first-hand description, 2026-07-29): it dampens purely by
// crosshair/PIP proximity, INCLUDING full-deflection stick input — there is no separate "is the
// player's own stick also near center" gate. An earlier version of this file (ported from the
// original 2D-canvas project) added such a gate, plus let dampening reach a hard 0 (full input
// lockout) at max strength; both read as the game actively fighting the player rather than the
// "magnetic, feels like a good pilot" sensation real ESP gives, so both are gone here.
// =====================================================================

import { registerConfig } from '../input/configRegistry';

const DEFAULT_CIRCLE_RADIUS_PX = 45; // px around screen center — smaller than the mouse-look reticle circle
const DEFAULT_DAMPENING_STRENGTH = 0.7; // 0..1 — fraction of input speed removed at dead center
let circleRadiusPx = DEFAULT_CIRCLE_RADIUS_PX;
let dampeningStrength = DEFAULT_DAMPENING_STRENGTH;

// Never fully zeroes input, even at dampeningStrength's max — real ESP lowers sensitivity, it
// doesn't lock the player out. Starting guess pending in-game feel-testing, not a measured value
// (ESP has no real-SC capture data the way flight tuning does).
const MIN_SCALE = 0.25;
// How fast the applied multiplier itself catches up to its target value, in 1/s. Without this, a
// PIP dancing right at the zone boundary (a jittery/fast-moving target) snaps the multiplier
// between ~1 and MIN_SCALE every frame it crosses the edge, which reads as twitchy resistance
// rather than a smooth "sticky" pull. Also a starting guess, not measured.
const SMOOTH_SPEED = 15;
let smoothedScalar = 1;

export function getCircleRadius(): number {
  return circleRadiusPx;
}
export function setCircleRadius(v: number): void {
  circleRadiusPx = v;
}
export function getDampeningStrength(): number {
  return dampeningStrength;
}
export function setDampeningStrength(v: number): void {
  dampeningStrength = v;
}

// 1 = no dampening (at/beyond the circle radius), ramping down to MIN_SCALE (never lower) at dead
// center. The ramp is eased (sqrt) rather than linear: a purely linear ramp only reaches full
// strength exactly at dead center, so a target sitting anywhere but the precise middle of even a
// maxed-out circle barely felt dampened at all (GitHub #4 in the original project). Squaring the
// proximity's square root front-loads the effect so most of the circle's interior already sits
// close to full strength.
export function targetScalarForDistance(screenDist: number): number {
  if (screenDist >= circleRadiusPx || circleRadiusPx <= 0) return 1;
  const proximity = 1 - screenDist / circleRadiusPx; // 0 at edge, 1 at center
  const eased = Math.sqrt(proximity);
  const maxRemoval = (1 - MIN_SCALE) * dampeningStrength;
  return 1 - maxRemoval * eased;
}

// Advances the smoothed multiplier one tick toward its target (1 if there's no active PIP, i.e.
// pipScreenDist is null) and returns it. Call this every tick regardless of whether a PIP is
// currently locked, so the multiplier decays smoothly back to 1 when a target is lost instead of
// snapping.
export function stepDamping(pipScreenDist: number | null, dt: number): number {
  const target = pipScreenDist === null ? 1 : targetScalarForDistance(pipScreenDist);
  const rate = Math.min(1, Math.max(0, dt) * SMOOTH_SPEED);
  smoothedScalar += (target - smoothedScalar) * rate;
  return smoothedScalar;
}

export function resetDamping(): void {
  smoothedScalar = 1;
}

interface EspConfig {
  circleRadiusPx: number;
  dampeningStrength: number;
}
registerConfig({
  key: 'esp',
  serialize: (): EspConfig => ({ circleRadiusPx, dampeningStrength }),
  deserialize: (data) => {
    const d = data as Partial<EspConfig> | null | undefined;
    if (!d) return;
    if (typeof d.circleRadiusPx === 'number') circleRadiusPx = d.circleRadiusPx;
    if (typeof d.dampeningStrength === 'number') dampeningStrength = d.dampeningStrength;
  },
  resetToDefault: () => {
    circleRadiusPx = DEFAULT_CIRCLE_RADIUS_PX;
    dampeningStrength = DEFAULT_DAMPENING_STRENGTH;
  }
});
