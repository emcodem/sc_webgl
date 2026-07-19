import type { RawShipMeasurement } from './rawShipType';
import { GLADIUS_RAW } from './gladius';

// Arrow — the "SpaceShip Fighter" hull (render/shipModels.ts's 'arrow' model). We have no separate
// Arrow flight data yet, so per harald it flies with the Gladius' EXACT stats — the spread below
// copies every measured value; only `name`, `model`, and `provenance` differ. The clone status is now
// a queryable field (provenance.status === 'cloned-placeholder'), not just a comment. Swap in real
// Arrow specs here if/when they're ever measured (change status to 'measured', drop clonedFrom).
//
// candidateRefinements is explicitly cleared: the spread would otherwise copy Gladius's, falsely
// implying Arrow has its own capture evidence — it has none.
export const ARROW_RAW: RawShipMeasurement = {
  ...GLADIUS_RAW,
  name: 'Arrow',
  model: 'arrow',
  provenance: {
    overall: {
      status: 'cloned-placeholder',
      clonedFrom: 'Gladius',
      note: 'No real Arrow flight data yet; flies the Gladius stats verbatim on the Arrow hull until measured.'
    }
  },
  candidateRefinements: undefined
};
