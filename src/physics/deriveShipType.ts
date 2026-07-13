import type { AngularState, ShipType } from '../core/types';

// Ported from the original project's ship/deriveShipType.ts. Scales turn rate only (maxAngVel /
// boostMaxAngVel), then recomputes angularThrust/boostAngularThrust from the scaled maxAngVel so
// shipTypes.ts's documented invariant (angularThrust == maxAngVel * angularDrag, per axis) still
// holds exactly for the derived ship — this function IS the invariant-preserving mechanism, not an
// exception to it. Used by scenarios/definitions.ts to build easier/harder Gladius variants without
// touching the measured base ShipType.
function scaleAngular(a: AngularState, scale: number): AngularState {
  return { pitch: a.pitch * scale, yaw: a.yaw * scale, roll: a.roll * scale };
}

function thrustFromMaxAngVel(maxAngVel: AngularState, angularDrag: AngularState): AngularState {
  return {
    pitch: maxAngVel.pitch * angularDrag.pitch,
    yaw: maxAngVel.yaw * angularDrag.yaw,
    roll: maxAngVel.roll * angularDrag.roll
  };
}

export function deriveShipType(base: ShipType, opts: { angularScale: number; name?: string }): ShipType {
  const maxAngVel = scaleAngular(base.maxAngVel, opts.angularScale);
  const boostMaxAngVel = scaleAngular(base.boostMaxAngVel, opts.angularScale);
  return {
    ...base,
    name: opts.name ?? base.name,
    maxAngVel,
    boostMaxAngVel,
    angularThrust: thrustFromMaxAngVel(maxAngVel, base.angularDrag),
    boostAngularThrust: thrustFromMaxAngVel(boostMaxAngVel, base.angularDrag)
  };
}
