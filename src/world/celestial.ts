import type { CelestialBody } from '../core/world';

// ---------- The starter star system ----------
// A distant sun as backdrop, plus a nearby rock within easy reach of spawn for free flight.
// All positions absolute, metres. This is data — the render layer turns each body into a mesh.
// Adding a real explorable universe later is just more entries here (and, eventually, streaming
// them in/out rather than a static list).

// A scanned meteorite sample, rendered at asteroid scale — a nearby landmark to fly around in
// free flight. Well within 1km of SPAWN so it's immediately reachable without a transit. Not
// walkable this milestone (no interior/surface collision for an irregular mesh yet — same
// restriction the space station this replaces had). Rendered from a real glTF scan, not a
// sphere — see render/meshes.ts's meteorite branch and render/celestialModels.ts.
export const METEORITE: CelestialBody = {
  name: 'MIL 15307',
  pos: { x: -400, y: 100, z: 500 }, // distance from SPAWN (0,0,0) ~= 648m, comfortably inside 1km
  radius: 30, // collision radius; render/celestialModels.ts derives its model target size (2×) from this
  gravity: 0,
  walkable: false,
  color: 0x9a8f82,
  meteorite: true
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

// A huge, distant terraformed-moon backdrop — planet-scale (20,000km diameter) and placed far
// enough out that it's deliberately unreachable in normal flight, same "backdrop only" role as SUN
// rather than a landmark to fly to (contrast METEORITE, which is a close, reachable landmark). Not
// walkable this milestone — same restriction as METEORITE (no interior/surface collision for an
// irregular scanned mesh yet). Rendered from a real glTF model, not a sphere — see
// render/meshes.ts's europa branch and render/celestialModels.ts.
export const EUROPA: CelestialBody = {
  name: 'Europa',
  pos: { x: 29_360_000, y: -5_872_000, z: -95_420_000 }, // ~100,000km from SPAWN — far beyond cruise range
  radius: 10_000_000, // collision radius; render/celestialModels.ts derives its model target size (2×) from this
  gravity: 0,
  walkable: false,
  color: 0x8fb6c9,
  europa: true
};

export const BODIES: CelestialBody[] = [SUN, METEORITE, EUROPA];

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
