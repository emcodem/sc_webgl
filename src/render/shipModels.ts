import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================================================
// Real glTF ship models, loading in alongside the procedural primitives in meshes.ts (see its
// header comment — "real glTF models can replace these later without touching the renderer").
// First one in: "Arrow", used for AI drones (see renderer.ts's rebuildEnemyMeshes). Loading is
// async and the model is large-ish to parse, so callers get a promise and should keep using a
// placeholder mesh until it resolves.
//
// Attribution (CC-BY-4.0, required by license): "SpaceShip Fighter - Version 2 [MESHY 6]" by
// Ethan Cox (https://sketchfab.com/EthanfromEngland), sketchfab.com/3d-models/
// spaceship-fighter-version-2-meshy-6-ff69bc6de8584bb4b2d6fac0b5a1d2ed — CC-BY-4.0
// (http://creativecommons.org/licenses/by/4.0/). Credit this source wherever the game credits
// assets (about/credits screen, README, etc.) once one exists.
// ============================================================================================

const ARROW_MODEL_URL = '/models/arrow.glb';
const ARROW_TARGET_LENGTH = 20; // metres, nose-to-tail — matches the Gladius' ~21m real length

let arrowPromise: Promise<THREE.Object3D> | null = null;

// Wraps the loaded glTF scene in a group so this project's own local-axis convention (local +Z =
// forward/nose, local +Y = up — see render/camera.ts::setObjectBasis) is guaranteed regardless of
// how the source file's own node hierarchy/axes were authored (Sketchfab glTF exports commonly
// carry a Z-up-to-Y-up correction node, an arbitrary import scale, and no guarantee the model's
// nose faces any particular local axis). The inner correction group is what actually gets rotated
// to fix authoring-orientation quirks; the outer wrapper is what callers clone and orient via
// setObjectBasis, so a wrong guess here only needs one fix, not one per spawned instance.
function loadArrow(): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      ARROW_MODEL_URL,
      (gltf) => {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const correction = new THREE.Group();
        correction.add(gltf.scene);
        // recenter so the wrapper rotates/scales about the model's own middle, not an off-origin pivot
        gltf.scene.position.sub(center);

        // Measured from this specific export's bounding box: (x=20, y=4.6, z=13.6) — the model's
        // longest axis (nose-to-tail) is its own local X, not Z, and Y is already the smallest
        // (top-to-bottom) axis, matching this project's "local +Y = up" convention. A +90° yaw
        // brings local -X (the tapered/pointed end, confirmed by sampling per-end cross-section
        // spans — the nose) onto local +Z (forward) without mirroring the mesh (an axis swap/
        // reflection would flip winding/normals; a rotation about the already-correct up axis does not).
        correction.rotation.y = Math.PI / 2;

        const largestDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = ARROW_TARGET_LENGTH / largestDim;
        correction.scale.setScalar(scale);

        const wrapper = new THREE.Group();
        wrapper.name = 'Arrow';
        wrapper.add(correction);
        resolve(wrapper);
      },
      undefined,
      reject
    );
  });
}

// Cached — every caller (each drone spawned) shares one load and clones the result, so the
// (comparatively heavy, ~4.5MB) model/textures are only ever fetched and decoded once.
export function loadArrowTemplate(): Promise<THREE.Object3D> {
  if (!arrowPromise) arrowPromise = loadArrow();
  return arrowPromise;
}

// Clones the template for one instance. THREE.Object3D.clone() is a shallow structural clone —
// geometries and materials stay shared references across every clone, so VRAM cost (textures) is
// paid once regardless of how many drones are on screen. `tint`, if given, multiplies the cloned
// material's base color without touching the shared original material — omitted by every current
// caller, so enemies render in the model's own natural color rather than a distinguishing accent.
export function cloneArrow(template: THREE.Object3D, tint?: number): THREE.Object3D {
  const instance = template.clone(true);
  // Clamp metalness on every clone (tinted or not) — this source's exported metalness runs high
  // enough that, with this scene's single directional sun and no environment map (metals have no
  // diffuse response at all — they only reflect specular/env light), the model's shadowed side reads
  // as pure black. See the lighting comment in render/renderer.ts's constructor for the other half
  // of the fix (ambient + camera headlight).
  instance.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const wasArray = Array.isArray(obj.material);
    const mats = (wasArray ? obj.material : [obj.material]) as THREE.MeshStandardMaterial[];
    const cloned = mats.map((m) => {
      const c = m.clone();
      c.metalness = Math.min(c.metalness, 0.45);
      if (tint !== undefined) c.color.multiply(new THREE.Color(tint));
      return c;
    });
    obj.material = wasArray ? cloned : cloned[0];
  });
  return instance;
}
