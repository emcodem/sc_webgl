import type { Vec3 } from '../core/types';
import type { VisualEffect } from '../core/world';

// Impact sparks live ~0.9s on the GPU (see render/impactEffects.ts), but that full life is owned by
// the renderer: the sim's 'impact' effect is just a one-frame-ish TRIGGER the renderer consumes to
// fire off a self-contained burst. Keeping IMPACT_DURATION short avoids a stale trigger re-firing.

// Transient combat visual effects — a single world-level list (world.effects) drained by the
// renderer each frame, shared by free-flight (combat/combatSystem.ts) and scenarios
// (scenarios/runtime.ts). Pure sim data: a kind, a world position, and a countdown timer; the
// renderer turns each into an additive burst whose size/opacity track timer/maxTimer. Replaces the
// old scenario-only ScenarioRuntime.explosions.

// Like IMPACT_DURATION below, this is just how long the one-shot TRIGGER lingers in world.effects —
// the actual death fireball's visual life (~2s of cooling sparks + fireball) is owned by the GPU
// hot-metal system in render/impactEffects.ts (ImpactEffects.explode), consumed exactly once.
export const EXPLOSION_DURATION = 0.2; // enemy-ship destruction burst (trigger only)
export const IMPACT_DURATION = 0.16;   // small laser-hit spark, quick

export function spawnExplosion(effects: VisualEffect[], pos: Vec3): void {
  effects.push({ kind: 'explosion', pos: { x: pos.x, y: pos.y, z: pos.z }, timer: EXPLOSION_DURATION, maxTimer: EXPLOSION_DURATION });
}

export function spawnImpact(effects: VisualEffect[], pos: Vec3, normal?: Vec3): void {
  effects.push({
    kind: 'impact',
    pos: { x: pos.x, y: pos.y, z: pos.z },
    normal: normal ? { x: normal.x, y: normal.y, z: normal.z } : undefined,
    timer: IMPACT_DURATION,
    maxTimer: IMPACT_DURATION,
  });
}

// Ticks every effect's countdown and removes the expired ones. Called once per frame from whichever
// top-level step function is active (stepCombat or updateScenario).
export function updateEffects(effects: VisualEffect[], dt: number): void {
  for (let i = effects.length - 1; i >= 0; i--) {
    effects[i].timer -= dt;
    if (effects[i].timer <= 0) effects.splice(i, 1);
  }
}
