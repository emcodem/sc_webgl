import type { WeaponType } from '../../core/types';
import { PANTHER_S3 } from './panther';

// The weapon registry — mirrors physics/ships/index.ts's getShipType/tryGetShipType shape. Only one
// weapon exists today (every ship resolves to the same Panther S3 entry); adding a second weapon
// later is a new data file here, not a code change at any call site.

export const WEAPON_TYPES: WeaponType[] = [PANTHER_S3];

export const DEFAULT_WEAPON_TYPE_ID = 'CF-337 Panther Repeater S3';

const REGISTRY: ReadonlyMap<string, WeaponType> = new Map(WEAPON_TYPES.map((t) => [t.name, t]));

export function getWeaponType(id: string): WeaponType {
  const t = REGISTRY.get(id);
  if (!t) {
    throw new Error(`Unknown weapon type '${id}'. Known: ${[...REGISTRY.keys()].join(', ')}`);
  }
  return t;
}

export function tryGetWeaponType(id: string): WeaponType | undefined {
  return REGISTRY.get(id);
}
