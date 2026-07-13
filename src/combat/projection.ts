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
