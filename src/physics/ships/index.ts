import type { ShipType } from '../../core/types';
import { buildShipType } from './buildShipType';
import { GLADIUS_RAW } from './gladius';
import { ARROW_RAW } from './arrow';

// The ship registry. Each per-ship raw module (gladius.ts, arrow.ts, ...) is compiled to a flat
// ShipType here at load time (buildShipType validates it — a broken raw record throws immediately).
// This is the ONE canonical place to resolve a ship; index-based access is gone (see getShipType).

const GLADIUS = buildShipType(GLADIUS_RAW);
const ARROW = buildShipType(ARROW_RAW);

// Order kept from the old shipTypes.ts (Gladius first) for anything that still wants "all ships".
export const SHIP_TYPES: ShipType[] = [GLADIUS, ARROW];

// The default/reference ship — the measured Gladius. Use getShipType(DEFAULT_SHIP_TYPE_ID) instead
// of the old positional index-0 access.
export const DEFAULT_SHIP_TYPE_ID = 'Gladius';

const REGISTRY: ReadonlyMap<string, ShipType> = new Map(SHIP_TYPES.map((t) => [t.name, t]));

// Canonical lookup by ship name — throws on an unknown id so a typo fails loudly rather than
// silently flying the wrong ship.
export function getShipType(id: string): ShipType {
  const t = REGISTRY.get(id);
  if (!t) {
    throw new Error(`Unknown ship type '${id}'. Known: ${[...REGISTRY.keys()].join(', ')}`);
  }
  return t;
}

// Non-throwing lookup, for callers with a legitimate fallback (e.g. replay clips referencing a ship
// id that no longer exists).
export function tryGetShipType(id: string): ShipType | undefined {
  return REGISTRY.get(id);
}
