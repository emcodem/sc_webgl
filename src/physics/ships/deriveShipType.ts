import type { ShipType } from '../../core/types';
import { scaleAngular, thrustFromMaxAngVel } from './angularInvariant';

// Ported from the original project's ship/deriveShipType.ts. Scales turn rate only (maxAngVel /
// boostMaxAngVel), then recomputes angularThrust/boostAngularThrust from the scaled maxAngVel so the
// invariant (angularThrust == maxAngVel * angularDrag, per axis) still holds exactly for the derived
// ship — this function IS the invariant-preserving mechanism, not an exception to it. Used by
// scenarios/definitions.ts to build easier/harder Gladius variants without touching the measured base.
//
// This operates on an already-compiled ShipType (canonical -> scaled variant), a separate concern
// from buildShipType (raw measurement -> canonical). Both share angularInvariant.ts's helpers so the
// "thrust from maxAngVel" computation has exactly one implementation.
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
