import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EUROPA, METEORITE } from '../world/celestial';
import { InstancedField, type FieldSource } from './instancedField';

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

const METEORITE_MODEL_URL = `${import.meta.env.BASE_URL}models/meteorite.glb`;
// Largest dimension (diameter) the scanned model is scaled to. Derived from the world-data collision
// radius so the visual can't silently drift from what gravity/collision use — see world/celestial.ts.
const METEORITE_TARGET_SIZE = METEORITE.radius * 2; // metres — an explorable asteroid-scale rock

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

// ============================================================================================
// "Europa Terraformed" backdrop planet (see world/celestial.ts's EUROPA) — same "load in async,
// swap onto the placeholder sphere" split as the meteorite above, but a single body with no
// instanced field.
//
// Attribution: "Europa Terraformed" (https://sketchfab.com/3d-models/europa-terraformed-91f8f5e827fc4d32902906511cb7e64d)
// by uperesito (https://sketchfab.com/uperesito), licensed CC-BY-4.0
// (http://creativecommons.org/licenses/by/4.0/). Credit this source wherever the game credits
// assets (about/credits screen, README, etc.) once one exists — same convention as
// shipModels.ts's Arrow credit block. See also downloads/planets/europa_terraformed_credits.txt.
// ============================================================================================

const EUROPA_MODEL_URL = `${import.meta.env.BASE_URL}models/europa.glb`;
const EUROPA_TARGET_SIZE = EUROPA.radius * 2; // metres — see METEORITE_TARGET_SIZE's doc comment above

let europaPromise: Promise<THREE.Object3D> | null = null;

function loadEuropa(): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      EUROPA_MODEL_URL,
      (gltf) => {
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = new THREE.Vector3();
        box.getSize(size);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const wrapper = new THREE.Group();
        wrapper.name = 'Europa';
        wrapper.add(gltf.scene);
        gltf.scene.position.sub(center);

        const largestDim = Math.max(size.x, size.y, size.z) || 1;
        wrapper.scale.setScalar(EUROPA_TARGET_SIZE / largestDim);

        resolve(wrapper);
      },
      undefined,
      reject
    );
  });
}

// Cached — a page only ever needs one Europa load regardless of how many Renderers get built.
export function loadEuropaTemplate(): Promise<THREE.Object3D> {
  if (!europaPromise) europaPromise = loadEuropa();
  return europaPromise;
}

// ---------- Reusing the same rock 50-100x without either a perf hit or visible repetition ----------
// A THREE.InstancedMesh draws every instance in ONE GPU draw call sharing one geometry/material, so
// the cost of 80 rocks is roughly the cost of 1 DRAW — but emphatically not of 1 rock's worth of
// GEOMETRY: a draw call still submits every triangle it covers. Instancing the 100k-triangle scan
// 80 times submitted 8,000,000 triangles per frame, measured at ~64% of the entire GPU frame.
//
// So the field is built through render/instancedField.ts, which decimates the source to a per-
// instance triangle budget (render/geometryLOD.ts) and keeps THREE.InstancedMesh's own instance
// bounding sphere current so frustum culling actually works. Everything below is parameters — count,
// spread, size range, budget — and the field accepts several different source rocks, so growing or
// changing the rock set needs no new code here.
const FIELD_COUNT = 80;
const FIELD_CAPACITY = 256;      // headroom so the count can be raised at runtime without a rebuild
const FIELD_SPREAD_RADIUS = 450; // metres — scatter volume around the field's center
const FIELD_MIN_SCALE = 0.15;    // relative to the single big rock's own 60m normalized scale
const FIELD_MAX_SCALE = 0.6;     // (so field rocks range roughly 9m-36m — smaller than the "main" rock)

// Triangles per field instance. These render 9-36 m across — a few hundred pixels at typical
// range — so the scan's full 100k is roughly 100x more than the silhouette can show. 3000 keeps the
// lumpy profile that makes the rocks read as irregular while cutting the field's geometry load ~33x.
// The one hero rock (loadMeteoriteTemplate, flown right up to) is deliberately left at full detail.
const FIELD_TRIANGLES_PER_INSTANCE = 3000;

// Pulls the one instanceable mesh out of a loaded model wrapper, baking the wrapper-relative
// transform (the axis correction + recentering applied at load) into a CLONED geometry so the
// original — still displayed as the full-detail hero body — is never mutated. The wrapper's own
// size-normalizing scale is returned separately as `baseScale` rather than baked in, since each
// instance multiplies it by its own random size variation.
function toFieldSource(wrapper: THREE.Object3D): FieldSource {
  let found: THREE.Mesh | null = null;
  wrapper.traverse((o) => { if (!found && o instanceof THREE.Mesh) found = o; });
  if (!found) throw new Error('model template has no mesh to instance');
  const sourceMesh: THREE.Mesh = found;

  wrapper.updateMatrixWorld(true);
  const wrapperInverse = new THREE.Matrix4().copy(wrapper.matrixWorld).invert();
  const localMatrix = new THREE.Matrix4().multiplyMatrices(wrapperInverse, sourceMesh.matrixWorld);
  const geometry = sourceMesh.geometry.clone();
  geometry.applyMatrix4(localMatrix);

  return { geometry, material: sourceMesh.material, baseScale: wrapper.scale.x };
}

// Scatters `count` rocks around the field's own local origin — NOT around the absolute world center.
// The caller repositions the returned field every frame as `center - cameraEye` (see
// render/renderer.ts), the same floating-origin convention every other object in the scene follows.
//
// Extra rock models drop in by appending their loaded wrappers to `extraSources`: instances are
// dealt round-robin across all sources, each decimated to the same budget.
export async function loadMeteoriteField(
  count = FIELD_COUNT,
  spreadRadius = FIELD_SPREAD_RADIUS,
  extraSources: Promise<THREE.Object3D>[] = []
): Promise<InstancedField> {
  const wrappers = await Promise.all([loadMeteoriteTemplate(), ...extraSources]);
  return new InstancedField({
    sources: wrappers.map(toFieldSource),
    count,
    capacity: Math.max(FIELD_CAPACITY, count),
    spreadRadius,
    minScale: FIELD_MIN_SCALE,
    maxScale: FIELD_MAX_SCALE,
    targetTrianglesPerInstance: FIELD_TRIANGLES_PER_INSTANCE,
  });
}
