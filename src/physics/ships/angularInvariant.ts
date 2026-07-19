import type { AngularState } from '../../core/types';

// Shared per-axis angular helpers. Kept in ONE place so buildShipType.ts (raw → ShipType) and
// deriveShipType.ts (ShipType → scaled variant) can't drift apart on how "thrust from maxAngVel"
// is computed. This IS the mechanism that keeps the load-bearing invariant
// `angularThrust == maxAngVel * angularDrag` (per axis) true by construction — see
// physics/ships/buildShipType.ts and tests/shipTuning.test.ts.

export function scaleAngular(a: AngularState, scale: number): AngularState {
  return { pitch: a.pitch * scale, yaw: a.yaw * scale, roll: a.roll * scale };
}

export function thrustFromMaxAngVel(maxAngVel: AngularState, angularDrag: AngularState): AngularState {
  return {
    pitch: maxAngVel.pitch * angularDrag.pitch,
    yaw: maxAngVel.yaw * angularDrag.yaw,
    roll: maxAngVel.roll * angularDrag.roll
  };
}
