import type { Vec3 } from '../core/types';
import type { ShipAxes } from '../math/quaternion';

// Shared world-to-screen projection — render-API-agnostic (just camera-axis math, no three.js),
// so combat/pipTargeting.ts can compute a PIP's screen position without any renderer reference.
// Ported from the original project's render/projection.ts.

export interface Camera {
  pos: Vec3;
  axes: ShipAxes;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

// Vertical FOV of the real three.js camera (render/renderer.ts's `new THREE.PerspectiveCamera(70, ...)`)
// — kept in sync here so this HUD-space math lines up with what's actually on screen, rather than
// the original canvas renderer's arbitrary fixed focal length (there was no real 3D camera to match).
const CAMERA_FOV_DEG = 70;

export function project(
  px: number, py: number, pz: number,
  cam: Camera,
  viewportWidth: number, viewportHeight: number
): ProjectedPoint | null {
  // transform world point into camera space using camera axes
  const dx = px - cam.pos.x, dy = py - cam.pos.y, dz = pz - cam.pos.z;
  const { forward, right, up } = cam.axes;
  const cx = dx * right.x + dy * right.y + dz * right.z;
  const cy = dx * up.x + dy * up.y + dz * up.z;
  const cz = dx * forward.x + dy * forward.y + dz * forward.z;
  if (cz <= 1) return null; // behind camera
  const focalLength = viewportHeight / (2 * Math.tan((CAMERA_FOV_DEG * Math.PI) / 180 / 2));
  const f = focalLength / cz;
  return { x: viewportWidth / 2 + cx * f, y: viewportHeight / 2 - cy * f, scale: f, depth: cz };
}

// Direction to rotate the camera to bring an off-screen point toward center, as a screen-space
// (x, y) vector — used by hud.ts's off-screen edge-arrow indicator. Deliberately the RAW
// (non-perspective-divided) projection of the point's direction onto the camera's right/up axes,
// NOT project()'s cx/cy*f: that raw projection already continuously encodes "which way is the
// shorter turn" across the entire sphere around the camera, with exactly one unavoidable
// ambiguity point (directly behind, where either turn direction is equally 180° — both components
// go to (0, 0) there, so callers should treat that as "undefined/pick arbitrarily", not as an
// error). Do NOT divide by depth (cz) or otherwise branch on its sign: an earlier version mirrored
// both axes whenever the point was more than 90° off-axis (cz < 0), on the mistaken theory that
// "behind the camera" needs flipping the way a perspective-divided screen coordinate would — but
// since this is NOT perspective-divided, that flip fired at the wrong threshold (90°/270° instead
// of the true 180° ambiguity), producing two spurious extra direction flips per full 360° sweep.
export function edgeIndicatorDirection(
  px: number, py: number, pz: number,
  cam: Camera
): { dirX: number; dirY: number } {
  const dx = px - cam.pos.x, dy = py - cam.pos.y, dz = pz - cam.pos.z;
  const { right, up } = cam.axes;
  const dirX = dx * right.x + dy * right.y + dz * right.z;
  const dirY = -(dx * up.x + dy * up.y + dz * up.z);
  return { dirX, dirY };
}
