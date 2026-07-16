import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================================================
// Real glTF ship models, loading in alongside the procedural primitives in meshes.ts (see its
// header comment). Each ShipType names a `model` (core/types.ts) that maps to one entry in the
// MODELS table below; the renderer loads that model async and keeps a placeholder until it resolves.
// Two models ship today, both scaled to ~20m nose-to-tail (the Gladius' real length):
//   'dvergr' — the player's default ship and the fleet's Dvergr opponents
//   'arrow'  — the fleet's "SpaceShip Fighter" opponents (and scenario/AI drones)
//
// Attribution (CC-BY-4.0, required by license) — credit both wherever the game credits assets
// (about/credits screen, README, etc.) once one exists:
//   • 'dvergr': "AJF-12 \"Dvergr\"" by Star Conflict (https://sketchfab.com/star_conflict),
//     sketchfab.com/3d-models/ajf-12-dvergr-ecc16e103e79448faf9730f172a1d7e8 — CC-BY-4.0
//     (http://creativecommons.org/licenses/by/4.0/). See downloads/ships/ajf-12_dvergr_credits.txt.
//   • 'arrow': "SpaceShip Fighter - Version 2 [MESHY 6]" by Ethan Cox
//     (https://sketchfab.com/EthanfromEngland), sketchfab.com/3d-models/
//     spaceship-fighter-version-2-meshy-6-ff69bc6de8584bb4b2d6fac0b5a1d2ed — CC-BY-4.0
//     (http://creativecommons.org/licenses/by/4.0/).
// ============================================================================================

const TARGET_LENGTH = 20; // metres, longest axis (nose-to-tail) — matches the Gladius' ~21m length

export type ShipModelName = 'dvergr' | 'arrow';

interface ShipModelConfig {
  url: string;
  // Radians of yaw (about the up axis) applied to bring the source export's nose onto this project's
  // local +Z (forward — see render/camera.ts::setObjectBasis). A yaw about the already-correct up
  // axis never mirrors the mesh, so it can't flip winding/normals the way an axis swap/reflection
  // would. Each value is measured from the specific export's bounding box + per-end cross-section
  // spans (see the offline profiling behind these).
  noseYaw: number;
}

// Every ship model that exists. The renderer preloads all of them up front so any ship — a
// free-flight fleet member or a scenario-swapped opponent — always finds its template ready.
export const SHIP_MODEL_NAMES: ShipModelName[] = ['dvergr', 'arrow'];

const MODELS: Record<ShipModelName, ShipModelConfig> = {
  // AJF-12 Dvergr: this export's longest axis (nose-to-tail) is already local +Z and its shortest is
  // local +Y (matching "local +Y = up"); the tapered nose points at +Z (confirmed by cross-section
  // profiling — the wide winged body sits at -Z, the slim nose spar at +Z), so no yaw is needed.
  dvergr: { url: '/models/dvergr.glb', noseYaw: 0 },
  // SpaceShip Fighter: this export's longest axis is local X with the pointed nose at -X and Y
  // already the smallest (up) axis. A +90° yaw brings local -X onto local +Z (forward).
  arrow: { url: '/models/arrow.glb', noseYaw: Math.PI / 2 }
};

const templates: Partial<Record<ShipModelName, Promise<THREE.Object3D>>> = {};

// Wraps the loaded glTF scene in a group so this project's own local-axis convention (local +Z =
// forward/nose, local +Y = up) is guaranteed regardless of how the source file's own node hierarchy/
// axes were authored (Sketchfab glTF exports commonly carry a Z-up-to-Y-up correction node, an
// arbitrary import scale, and no guarantee the model's nose faces any particular local axis). The
// inner correction group is what gets rotated/scaled to fix authoring quirks; the outer wrapper is
// what callers clone and orient via setObjectBasis, so a wrong guess here needs one fix, not one per
// spawned instance.
function loadModel(name: ShipModelName): Promise<THREE.Object3D> {
  const cfg = MODELS[name];
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      cfg.url,
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
        correction.rotation.y = cfg.noseYaw;

        const largestDim = Math.max(size.x, size.y, size.z) || 1;
        correction.scale.setScalar(TARGET_LENGTH / largestDim);

        const wrapper = new THREE.Group();
        wrapper.name = name;
        wrapper.add(correction);
        resolve(wrapper);
      },
      undefined,
      reject
    );
  });
}

// Cached per model — every caller (each ship spawned of that model) shares one load and clones the
// result, so the (comparatively heavy) model/textures are only ever fetched and decoded once.
export function loadShipTemplate(name: ShipModelName): Promise<THREE.Object3D> {
  if (!templates[name]) templates[name] = loadModel(name);
  return templates[name] as Promise<THREE.Object3D>;
}

// Clones the template for one instance. THREE.Object3D.clone() is a shallow structural clone —
// geometries and materials stay shared references across every clone, so VRAM cost (textures) is
// paid once regardless of how many ships are on screen. `tint`, if given, multiplies the cloned
// material's base color without touching the shared original material — omitted by every current
// caller, so ships render in the model's own natural color rather than a distinguishing accent.
export function cloneShip(template: THREE.Object3D, tint?: number): THREE.Object3D {
  const instance = template.clone(true);
  // Clamp metalness on every clone (tinted or not) — these sources' exported metalness runs high
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
