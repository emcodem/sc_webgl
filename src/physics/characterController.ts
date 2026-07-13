import type { CelestialBody, Player } from '../core/world';
import {
  add, clone, cross, dot, length, normalize, projectOntoPlane,
  rotateAboutAxis, scale, sub, clamp
} from '../math/vec';
import type { Vec3 } from '../core/types';

// ============================================================================================
// On-foot character controller. The player is a point (feet position) attracted to the nearest
// walkable celestial body and colliding with its spherical surface, so "walking on a planet" is
// just radial gravity + a sphere clamp — the same code works standing anywhere on the globe, with
// local "up" always pointing away from the body's center. Movement and look are expressed on the
// tangent plane at the player's feet.
//
// This is intentionally simple for milestone 1 (sphere surfaces, no station-interior geometry, no
// slopes/steps). It is the seam a richer collision system slots into later without touching flight.
// ============================================================================================

const WALK_SPEED = 8;          // m/s ground speed
const AIR_CONTROL = 0.12;      // 0..1 how much steering authority you have mid-air/mid-fall
const JUMP_SPEED = 6;          // m/s initial upward velocity on jump
const PITCH_LIMIT = Math.PI / 2 - 0.05; // just shy of straight up/down
const GROUND_EPS = 0.08;       // metres above surface still counted as "on the ground"

export interface FootInputs {
  moveForward: number;   // -1..1 (W/S)
  moveRight: number;     // -1..1 (D/A)
  jump: boolean;
  lookYawDelta: number;  // radians this tick (mouse X)
  lookPitchDelta: number; // radians this tick (mouse Y, + looks up)
}

// Nearest walkable body to a point (by surface distance). Returns null if there are none.
export function nearestWalkable(pos: Vec3, bodies: CelestialBody[]): CelestialBody | null {
  let best: CelestialBody | null = null;
  let bestDist = Infinity;
  for (const b of bodies) {
    if (!b.walkable) continue;
    const d = length(sub(pos, b.pos)) - b.radius;
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

// Local surface "up" at the character's feet (radial away from the ground body's center). Falls
// back to world +Y when there's no ground body (open-space EVA — no meaningful up).
export function localUp(player: Player): Vec3 {
  if (!player.groundBody) return { x: 0, y: 1, z: 0 };
  return normalize(sub(player.charPos, player.groundBody.pos));
}

// Re-tangentialize the stored heading against the current up, apply mouse yaw, and return an
// orthonormal { forward (tangent), right (tangent), up } frame plus the pitch-adjusted camera
// forward. The heading is stored on the player so yaw persists as you walk around the curve.
export function footFrame(
  player: Player,
  up: Vec3
): { forward: Vec3; right: Vec3; up: Vec3; camForward: Vec3 } {
  // keep heading tangent to the surface as `up` changes underfoot
  let heading = projectOntoPlane(player.heading, up);
  if (length(heading) < 1e-5) {
    // heading became parallel to up (looked straight along the pole) — pick any tangent
    heading = projectOntoPlane({ x: 1, y: 0, z: 0 }, up);
    if (length(heading) < 1e-5) heading = projectOntoPlane({ x: 0, y: 0, z: 1 }, up);
  }
  heading = normalize(heading);
  const right = normalize(cross(heading, up));
  // camera forward tilts out of the tangent plane by pitch (+ looks toward up)
  const camForward = normalize(
    add(scale(heading, Math.cos(player.lookPitch)), scale(up, Math.sin(player.lookPitch)))
  );
  return { forward: heading, right, up, camForward };
}

export function updateCharacter(
  player: Player,
  bodies: CelestialBody[],
  input: FootInputs,
  dt: number
): void {
  player.groundBody = nearestWalkable(player.charPos, bodies);
  const body = player.groundBody;
  const up = localUp(player);

  // --- look: yaw rotates the tangent heading about up; pitch is a clamped scalar ---
  player.heading = normalize(projectOntoPlane(player.heading, up));
  if (input.lookYawDelta !== 0) {
    player.heading = normalize(rotateAboutAxis(player.heading, up, input.lookYawDelta));
  }
  player.lookPitch = clamp(player.lookPitch + input.lookPitchDelta, -PITCH_LIMIT, PITCH_LIMIT);

  const frame = footFrame(player, up);

  // --- decompose velocity into along-up (gravity/jump) and tangent (walking) parts ---
  let verticalSpeed = dot(player.charVel, up);
  let horiz = projectOntoPlane(player.charVel, up);

  // gravity toward the body center
  const g = body ? body.gravity : 0;
  verticalSpeed -= g * dt;

  // jump
  if (input.jump && player.onGround) {
    verticalSpeed = JUMP_SPEED;
    player.onGround = false;
  }

  // walking: full control on the ground, limited authority in the air
  const desired = add(
    scale(frame.forward, input.moveForward * WALK_SPEED),
    scale(frame.right, input.moveRight * WALK_SPEED)
  );
  if (player.onGround) {
    horiz = desired;
  } else {
    horiz = add(horiz, scale(sub(desired, horiz), AIR_CONTROL));
  }

  player.charVel = add(scale(up, verticalSpeed), horiz);

  // integrate
  player.charPos = add(player.charPos, scale(player.charVel, dt));

  // --- surface collision (sphere clamp) ---
  if (body) {
    const toChar = sub(player.charPos, body.pos);
    const dist = length(toChar);
    const surfaceN = normalize(toChar);
    if (dist < body.radius) {
      // pushed below the surface — snap feet to the surface and kill inward velocity
      player.charPos = add(body.pos, scale(surfaceN, body.radius));
      const vn = dot(player.charVel, surfaceN);
      if (vn < 0) player.charVel = sub(player.charVel, scale(surfaceN, vn));
      player.onGround = true;
    } else {
      player.onGround = dist - body.radius <= GROUND_EPS;
    }
  } else {
    player.onGround = false;
  }
}

// Snapshot used by the render layer to place the on-foot camera. Eye sits a fixed height above the
// feet along local up; orientation is the pitch-adjusted look frame.
const EYE_HEIGHT = 1.7;
export function footEye(player: Player): { pos: Vec3; forward: Vec3; up: Vec3 } {
  const up = localUp(player);
  const frame = footFrame(player, up);
  return { pos: add(clone(player.charPos), scale(up, EYE_HEIGHT)), forward: frame.camForward, up };
}
