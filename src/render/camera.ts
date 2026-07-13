import * as THREE from 'three';
import type { Vec3 } from '../core/types';

// Orient a three.js camera from an explicit world-space (forward, up) basis, sidestepping any
// convention mismatch between the sim's axis convention (forward=+Z, up=-Y — see math/quaternion.ts)
// and three.js's camera convention (looks down local -Z, up local +Y). We build a proper
// right-handed orthonormal basis and set the quaternion from it directly.
//
// The camera always sits at the GL origin (0,0,0) — the world is rendered camera-relative for the
// floating origin — so only its orientation is ever set here.

const _z = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function setCameraBasis(camera: THREE.Camera, forward: Vec3, up: Vec3): void {
  _fwd.set(forward.x, forward.y, forward.z).normalize();
  _up.set(up.x, up.y, up.z).normalize();

  // camera local +Z points opposite the look direction
  _z.copy(_fwd).multiplyScalar(-1);
  // right = up x z  (right-handed)
  _x.crossVectors(_up, _z).normalize();
  // re-derive a clean orthonormal up so a non-perpendicular (forward, up) pair still yields a
  // valid rotation
  _y.crossVectors(_z, _x);

  _m.makeBasis(_x, _y, _z);
  camera.quaternion.setFromRotationMatrix(_m);
}

// Orient a regular Object3D (e.g. the ship mesh) so its local +Z maps to world `forward` and local
// +Y to world `up`. Unlike the camera, an object looks/points along its own +Z, so no negation.
const _oz = new THREE.Vector3();
const _ox = new THREE.Vector3();
const _oy = new THREE.Vector3();
const _om = new THREE.Matrix4();

export function setObjectBasis(obj: THREE.Object3D, forward: Vec3, up: Vec3): void {
  _oz.set(forward.x, forward.y, forward.z).normalize();
  _oy.set(up.x, up.y, up.z).normalize();
  _ox.crossVectors(_oy, _oz).normalize();
  _oy.crossVectors(_oz, _ox);
  _om.makeBasis(_ox, _oy, _oz);
  obj.quaternion.setFromRotationMatrix(_om);
}
