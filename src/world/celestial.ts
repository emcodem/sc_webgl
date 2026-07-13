import type { CelestialBody } from '../core/world';

// ---------- The starter star system ----------
// A distant sun as backdrop, plus a space station within easy reach of spawn for free flight.
// All positions absolute, metres. This is data — the render layer turns each body into a mesh.
// Adding a real explorable universe later is just more entries here (and, eventually, streaming
// them in/out rather than a static list).

// A space station where Crusader used to be — placed within 20 km of SPAWN so it's reachable in
// free flight without a long transit. Not walkable this milestone (you can't fly to it, let alone
// dock, yet). Rendered as a procedural ring-and-hub structure, not a sphere — see
// render/meshes.ts createStationMesh.
export const STATION: CelestialBody = {
  name: 'Baijini Point',
  pos: { x: 0, y: 3_000, z: 15_000 },
  radius: 2_000,
  gravity: 0,
  walkable: false,
  color: 0x9aa4ad,
  station: true
};

// The sun — backdrop AND the scene's single directional light source (the render layer aims a
// directional light from here). Warm, self-lit, enormous.
export const SUN: CelestialBody = {
  name: 'Stanton',
  pos: { x: 7_835_600, y: 163_000, z: 810_600 },
  radius: 300_000,
  gravity: 0,
  walkable: false,
  color: 0xfff6df,
  emissive: true
};

export const BODIES: CelestialBody[] = [SUN, STATION];

// Where the ship (and thus the player) starts: nose forward (+Z), at rest.
export const SPAWN = {
  pos: { x: 0, y: 0, z: 0 },
  quat: { x: 0, y: 0, z: 0, w: 1 }
};

// Where the AI dogfighter (and its respawns) start: off to the side and ahead, far enough from
// SPAWN for a real merge/engage. Exact facing doesn't matter — the AI (see
// combat/enemyAI.ts) reorients itself the instant it starts thinking.
export const ENEMY_SPAWN = {
  pos: { x: 550, y: -90, z: 700 },
  quat: { x: 0, y: 0, z: 0, w: 1 }
};
