import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================================================
// Real glTF celestial-body models, loading in alongside the procedural primitives in meshes.ts —
// same "async load, placeholder until it resolves" split as render/shipModels.ts, but for
// CelestialBody meshes (world/celestial.ts) rather than ships. First one in: a scanned meteorite
// sample, used for the free-flight sandbox's nearby rock (see world/celestial.ts's METEORITE and
// render/meshes.ts's meteorite branch of createBodyMesh).
//
// Attribution: "Antarctic Meteorite Sample MIL 153070", a 3D scan from NASA's Astromaterials 3D
// program (Astromaterials Acquisition and Curation Office, NASA Johnson Space Center), published
// via their Sketchfab account (sketchfab.com/AstroMaterials3D). Credit this source wherever the
// game credits assets (about/credits screen, README, etc.) once one exists — same convention as
// shipModels.ts's Arrow credit block. Confirm the exact license terms on the source Sketchfab
// model page if that becomes load-bearing (e.g. before any public release).
// ============================================================================================

const METEORITE_MODEL_URL = '/models/meteorite.glb';
const METEORITE_TARGET_SIZE = 60; // metres, largest dimension — an explorable asteroid-scale rock

let meteoritePromise: Promise<THREE.Object3D> | null = null;

// Wraps the loaded glTF scene in a group, recentered and scaled to METEORITE_TARGET_SIZE. Unlike
// shipModels.ts's Arrow loader, there's no "which axis is forward" correction to make — a rock has
// no forward, so the source's own orientation (after glTF's standard node-transform handling,
// already applied by the time Box3.setFromObject runs) is kept as-is.
function loadMeteorite(): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      METEORITE_MODEL_URL,
      (gltf) => {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const wrapper = new THREE.Group();
        wrapper.name = 'Meteorite';
        wrapper.add(gltf.scene);
        // recenter so the wrapper scales about the model's own middle, not an off-origin pivot
        gltf.scene.position.sub(center);

        const largestDim = Math.max(size.x, size.y, size.z) || 1;
        wrapper.scale.setScalar(METEORITE_TARGET_SIZE / largestDim);

        resolve(wrapper);
      },
      undefined,
      reject
    );
  });
}

// Cached — a page only ever needs one meteorite load regardless of how many Renderers get built.
export function loadMeteoriteTemplate(): Promise<THREE.Object3D> {
  if (!meteoritePromise) meteoritePromise = loadMeteorite();
  return meteoritePromise;
}

// ---------- Reusing the same rock 50-100x without either a perf hit or visible repetition ----------
// A THREE.InstancedMesh draws every instance in ONE GPU draw call sharing one geometry/material, so
// the cost of 80 rocks is roughly the cost of 1 — the alternative (this project's usual
// `template.clone(true)` pattern, see shipModels.ts's cloneArrow) would instead cost one full draw
// call per instance. Visual variety comes entirely from per-instance data (transform + a subtle
// brightness tint via instanceColor), not from any per-instance geometry difference, which is what
// keeps a shared mesh from reading as a wall of identical clones.
const FIELD_COUNT = 80;
const FIELD_SPREAD_RADIUS = 450; // metres — scatter volume around the field's center
const FIELD_MIN_SCALE = 0.15;    // relative to the single big rock's own 60m normalized scale
const FIELD_MAX_SCALE = 0.6;     // (so field rocks range roughly 9m-36m — smaller than the "main" rock)

// Ken Shoemake's uniform-random-rotation formula. three.js's Quaternion has no built-in "random"
// method, and naively randomizing Euler angles per axis clusters orientations near the poles
// instead of distributing them evenly over all possible rotations.
function randomQuaternion(): THREE.Quaternion {
  const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  return new THREE.Quaternion(
    s1 * Math.sin(2 * Math.PI * u2),
    s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3),
    s2 * Math.cos(2 * Math.PI * u3)
  );
}

// Scatters `count` copies of the meteorite's geometry/material into a single InstancedMesh.
// Positions are relative to (0,0,0), NOT to the absolute world `center` — the caller repositions
// the returned mesh every frame as `center - cameraEye` (see render/renderer.ts), the same
// floating-origin convention every other object in the scene follows, rather than baking an
// absolute world position into the instance transforms themselves.
export async function loadMeteoriteField(
  count = FIELD_COUNT,
  spreadRadius = FIELD_SPREAD_RADIUS
): Promise<THREE.InstancedMesh> {
  const wrapper = await loadMeteoriteTemplate();
  let found: THREE.Mesh | null = null;
  wrapper.traverse((o) => { if (!found && o instanceof THREE.Mesh) found = o; });
  if (!found) throw new Error('meteorite template has no mesh to instance');
  const sourceMesh: THREE.Mesh = found;

  // Bake the source mesh's transform relative to the wrapper — the root axis-correction rotation
  // plus the recentering translation loadMeteorite applied — into a CLONED geometry. Cloned so this
  // never mutates the shared geometry the single big rock (renderer.ts's meteoriteBody branch)
  // still displays. The wrapper's own size-normalizing scale is deliberately excluded here; it's
  // reapplied per-instance below, multiplied by each instance's own random size variation.
  wrapper.updateMatrixWorld(true);
  const wrapperInverse = new THREE.Matrix4().copy(wrapper.matrixWorld).invert();
  const localMatrix = new THREE.Matrix4().multiplyMatrices(wrapperInverse, sourceMesh.matrixWorld);
  const geometry = sourceMesh.geometry.clone();
  geometry.applyMatrix4(localMatrix);

  const baseScale = wrapper.scale.x; // uniform — set via setScalar in loadMeteorite

  const mesh = new THREE.InstancedMesh(geometry, sourceMesh.material, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // a uniform-density point inside a solid sphere: cbrt(random) for the radius avoids the
    // clustering-toward-the-center a plain `random() * spreadRadius` would produce
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = 2 * Math.PI * Math.random();
    const r = spreadRadius * Math.cbrt(Math.random());
    dummy.position.set(
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.sin(theta) * Math.sin(phi),
      r * Math.cos(theta)
    );
    dummy.quaternion.copy(randomQuaternion());
    const scaleMul = FIELD_MIN_SCALE + Math.random() * (FIELD_MAX_SCALE - FIELD_MIN_SCALE);
    dummy.scale.setScalar(baseScale * scaleMul);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    const brightness = 0.8 + Math.random() * 0.4;
    mesh.setColorAt(i, color.setScalar(brightness));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // Scattered over hundreds of metres around a point far from the mesh's own local origin — a
  // correct bounding sphere would need real computing, and at only ~100 instances the draw cost of
  // simply never culling is negligible, so skip that and always draw.
  mesh.frustumCulled = false;

  return mesh;
}
