import * as THREE from 'three';
import { decimateGeometry, triangleCount } from './geometryLOD';

// ============================================================================================
// A scattered field of instanced bodies (today: the meteorite field around MIL 15307 — see
// render/celestialModels.ts). Deliberately generic rather than meteorite-specific, because the rock
// set is expected to change: the count is a runtime knob, several different source models can be
// mixed in one field, and the per-instance triangle budget is a parameter rather than a baked asset.
//
// Three things this owns that a bare `new THREE.InstancedMesh(...)` did not:
//
//   1. LOD. Every source geometry is decimated once to `targetTrianglesPerInstance` (see
//      render/geometryLOD.ts). Instancing collapses N rocks into one draw call but NOT into one
//      rock's worth of triangles — the un-decimated field submitted 80 x 100k = 8M triangles/frame,
//      about 64% of the whole GPU frame, measured.
//   2. Correct frustum culling. THREE.InstancedMesh maintains its OWN boundingSphere over the
//      per-instance transforms (Frustum.intersectsObject prefers it over the geometry's), so culling
//      just needs that sphere kept in sync — computeBoundingSphere() after any matrix/count change.
//      The previous field set `frustumCulled = false` with a bounding sphere left over from the
//      un-instanced geometry (radius 0.02 against a 450 m scatter), so it drew in full even when it
//      was entirely behind the camera. Because the cost is vertex-bound, that was the full price:
//      measured 0.957 ms with the field pushed far enough away to cover no pixels, vs 0.959 ms
//      filling the screen.
//   3. A dynamic count. Instance transforms are generated up to `capacity` once; `setCount()` then
//      re-slices how many are drawn without reallocating or regenerating anything.
//
// Positions are generated around the field's own local origin, NOT around an absolute world point:
// the caller moves `group` to `center - cameraEye` every frame, the same floating-origin convention
// every other object in the scene follows (see render/renderer.ts).
// ============================================================================================

export interface FieldSource {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  // Uniform scale that brings this source's raw geometry to its natural world size. Each instance
  // multiplies it by its own random size variation, so mixing sources authored at wildly different
  // export scales works without pre-normalizing them.
  baseScale: number;
}

export interface InstancedFieldOptions {
  sources: FieldSource[];
  // Instances drawn now. May be changed later via setCount() up to `capacity`.
  count: number;
  // Transforms generated up front; defaults to `count`. Set this higher than `count` when the field
  // is expected to grow at runtime, so growing never has to rebuild the buffers.
  capacity?: number;
  spreadRadius: number;      // metres — radius of the scatter volume
  minScale: number;          // relative to each source's baseScale
  maxScale: number;
  // Per-instance triangle budget. Omit or pass 0 to instance the sources at full resolution.
  targetTrianglesPerInstance?: number;
  // Brightness multiplier range written to instanceColor, so a shared mesh doesn't read as a wall of
  // identical clones.
  minBrightness?: number;
  maxBrightness?: number;
  seed?: number;             // deterministic layout; same seed => same field
}

// mulberry32 — a small deterministic PRNG. Seeded so a field's layout is reproducible (tests, and
// identical geometry across a scenario restart) instead of reshuffling on every construction.
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ken Shoemake's uniform-random-rotation formula. Randomizing Euler angles per axis instead would
// cluster orientations near the poles rather than covering all rotations evenly.
function randomQuaternion(rand: () => number): THREE.Quaternion {
  const u1 = rand(), u2 = rand(), u3 = rand();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  return new THREE.Quaternion(
    s1 * Math.sin(2 * Math.PI * u2),
    s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3),
    s2 * Math.cos(2 * Math.PI * u3)
  );
}

export class InstancedField {
  // Add this to the scene and move it to (fieldCenter - cameraEye) each frame.
  readonly group = new THREE.Group();

  private meshes: THREE.InstancedMesh[] = [];
  // Instance i of the whole field belongs to source (i % sources.length); this records, per source,
  // how many of its slots are filled, so setCount can re-slice without touching the buffers.
  private readonly stride: number;
  private capacity: number;
  private activeCount = 0;
  // Geometries this field created via decimation and must therefore dispose; a source used at full
  // resolution is shared with whoever else holds it and must NOT be disposed here.
  private ownedGeometries: THREE.BufferGeometry[] = [];

  constructor(opts: InstancedFieldOptions) {
    const sources = opts.sources;
    if (sources.length === 0) throw new Error('InstancedField needs at least one source');

    this.group.name = 'InstancedField';
    this.stride = sources.length;
    this.capacity = Math.max(opts.capacity ?? opts.count, opts.count);

    const budget = opts.targetTrianglesPerInstance ?? 0;
    const rand = makeRng(opts.seed ?? 0x9e3779b9);
    const minB = opts.minBrightness ?? 0.8;
    const maxB = opts.maxBrightness ?? 1.2;

    // Per-source instance capacity: instances are dealt round-robin, so source s owns slots
    // s, s+stride, s+2*stride, ... — a deterministic split that setCount can re-derive exactly.
    for (let s = 0; s < sources.length; s++) {
      const src = sources[s];
      const geometry = budget > 0 ? decimateGeometry(src.geometry, budget) : src.geometry;
      if (geometry !== src.geometry) this.ownedGeometries.push(geometry);

      const slots = this.slotsFor(s, this.capacity);
      const mesh = new THREE.InstancedMesh(geometry, src.material, Math.max(slots, 1));
      mesh.name = `field-source-${s}`;
      // Instance transforms never change after construction, so three.js can skip re-uploading them.
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      this.meshes.push(mesh);
      this.group.add(mesh);
    }

    // Fill every slot up to capacity, dealing round-robin across the sources.
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const perSourceCursor = new Array(sources.length).fill(0);
    for (let i = 0; i < this.capacity; i++) {
      const s = i % this.stride;
      const src = sources[s];
      const mesh = this.meshes[s];
      const slot = perSourceCursor[s]++;

      // Uniform density inside a solid sphere: cbrt() on the radius, otherwise instances bunch
      // toward the centre.
      const theta = Math.acos(2 * rand() - 1);
      const phi = 2 * Math.PI * rand();
      const r = opts.spreadRadius * Math.cbrt(rand());
      dummy.position.set(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta)
      );
      dummy.quaternion.copy(randomQuaternion(rand));
      dummy.scale.setScalar(src.baseScale * (opts.minScale + rand() * (opts.maxScale - opts.minScale)));
      dummy.updateMatrix();
      mesh.setMatrixAt(slot, dummy.matrix);
      mesh.setColorAt(slot, color.setScalar(minB + rand() * (maxB - minB)));
    }

    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    this.setCount(opts.count);
  }

  // How many of the first `total` field instances belong to source `s` under round-robin dealing.
  private slotsFor(s: number, total: number): number {
    if (total <= s) return 0;
    return Math.floor((total - s - 1) / this.stride) + 1;
  }

  // Change how many instances are drawn, up to the capacity the field was built with. Cheap: it only
  // re-slices the existing buffers and refreshes the culling spheres.
  setCount(count: number): void {
    const clamped = Math.max(0, Math.min(count, this.capacity));
    this.activeCount = clamped;
    for (let s = 0; s < this.meshes.length; s++) {
      const mesh = this.meshes[s];
      mesh.count = this.slotsFor(s, clamped);
      // Keep the instance bounding sphere in step with the live slice, so frustum culling stays
      // correct (three.js caches it and will not recompute on its own once it exists).
      mesh.boundingSphere = null;
      mesh.computeBoundingSphere();
      mesh.visible = mesh.count > 0;
    }
  }

  get count(): number { return this.activeCount; }

  // Triangles this field submits per frame when fully visible — handy for perf assertions.
  get trianglesPerFrame(): number {
    let total = 0;
    for (const mesh of this.meshes) total += triangleCount(mesh.geometry) * mesh.count;
    return total;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose(); // instance buffers; geometry/material are shared and handled below
    }
    // Only the geometries this field decimated itself — a full-resolution source belongs to its owner.
    for (const geo of this.ownedGeometries) geo.dispose();
    this.ownedGeometries = [];
    this.meshes = [];
  }
}
