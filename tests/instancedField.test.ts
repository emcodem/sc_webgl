import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InstancedField, type FieldSource } from '../src/render/instancedField';
import { triangleCount } from '../src/render/geometryLOD';

// The instanced rock field (render/instancedField.ts) exists to fix three measured problems with the
// hand-rolled InstancedMesh it replaced: no LOD (8M triangles/frame), culling permanently disabled
// behind a stale bounding sphere, and a fixed instance count. These tests pin all three, plus the
// "several different rocks in one field" case the rock set is expected to grow into.

function source(segments = 32, scale = 1): FieldSource {
  return {
    geometry: new THREE.SphereGeometry(1, segments, segments),
    material: new THREE.MeshStandardMaterial(),
    baseScale: scale,
  };
}

function meshesOf(field: InstancedField): THREE.InstancedMesh[] {
  return field.group.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);
}

describe('InstancedField', () => {
  it('draws one instanced mesh per source, not one per rock', () => {
    const field = new InstancedField({
      sources: [source()], count: 80, spreadRadius: 450, minScale: 0.15, maxScale: 0.6,
    });
    const meshes = meshesOf(field);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].count).toBe(80);
  });

  it('decimates each instance to the triangle budget', () => {
    const src = source(128); // ~32k triangles, same order as the real scanned rock
    const full = triangleCount(src.geometry);
    const field = new InstancedField({
      sources: [src], count: 80, spreadRadius: 450, minScale: 0.2, maxScale: 0.6,
      targetTrianglesPerInstance: 3000,
    });
    const mesh = meshesOf(field)[0];
    expect(triangleCount(mesh.geometry)).toBeLessThanOrEqual(3000);
    // and the whole point: total submitted geometry is a small fraction of the naive version
    expect(field.trianglesPerFrame).toBeLessThan(full * 80 * 0.1);
  });

  it('instances at full resolution when no budget is given', () => {
    const src = source(32);
    const field = new InstancedField({
      sources: [src], count: 10, spreadRadius: 100, minScale: 1, maxScale: 1,
    });
    expect(meshesOf(field)[0].geometry).toBe(src.geometry);
  });

  it('is frustum-cullable: an instance bounding sphere that actually covers the scatter', () => {
    const spreadRadius = 450;
    const field = new InstancedField({
      sources: [source()], count: 80, spreadRadius, minScale: 0.15, maxScale: 0.6,
    });
    const mesh = meshesOf(field)[0];
    expect(mesh.frustumCulled).toBe(true); // the old field forced this to false
    expect(mesh.boundingSphere).not.toBeNull();
    // must enclose the scatter volume, unlike the stale 0.02-radius sphere the old field culled on
    expect(mesh.boundingSphere!.radius).toBeGreaterThan(spreadRadius * 0.5);
    expect(mesh.boundingSphere!.radius).toBeLessThan(spreadRadius * 2);
  });

  it('every instance actually sits inside the scatter volume', () => {
    const spreadRadius = 300;
    const field = new InstancedField({
      sources: [source()], count: 50, spreadRadius, minScale: 0.2, maxScale: 0.5,
    });
    const mesh = meshesOf(field)[0];
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      pos.setFromMatrixPosition(m);
      expect(pos.length()).toBeLessThanOrEqual(spreadRadius + 1e-6);
    }
  });

  it('changes count at runtime up to capacity, and refreshes the culling sphere', () => {
    const field = new InstancedField({
      sources: [source()], count: 20, capacity: 100, spreadRadius: 450, minScale: 0.2, maxScale: 0.6,
    });
    const mesh = meshesOf(field)[0];
    const radiusAt20 = mesh.boundingSphere!.radius;

    field.setCount(100);
    expect(field.count).toBe(100);
    expect(mesh.count).toBe(100);
    // more instances can only widen (or hold) the enclosing sphere, never shrink it
    expect(mesh.boundingSphere!.radius).toBeGreaterThanOrEqual(radiusAt20 - 1e-6);

    field.setCount(5);
    expect(field.count).toBe(5);
    expect(mesh.count).toBe(5);

    // clamped to capacity rather than overrunning the buffers
    field.setCount(10_000);
    expect(field.count).toBe(100);

    field.setCount(0);
    expect(field.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('deals instances round-robin across several different rocks', () => {
    const field = new InstancedField({
      sources: [source(16), source(16), source(16)], count: 10,
      spreadRadius: 200, minScale: 0.3, maxScale: 0.7,
    });
    const meshes = meshesOf(field);
    expect(meshes).toHaveLength(3);
    // 10 instances over 3 sources -> 4 + 3 + 3
    expect(meshes.map((m) => m.count)).toEqual([4, 3, 3]);
    expect(meshes.reduce((sum, m) => sum + m.count, 0)).toBe(10);
  });

  it('applies each source-s own baseScale, so sources authored at different scales can mix', () => {
    const field = new InstancedField({
      sources: [source(16, 1), source(16, 100)], count: 2,
      spreadRadius: 10, minScale: 1, maxScale: 1,
    });
    const [a, b] = meshesOf(field);
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    a.getMatrixAt(0, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(1, 5);
    b.getMatrixAt(0, m); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect(scale.x).toBeCloseTo(100, 4);
  });

  it('is deterministic for a given seed, and different for a different one', () => {
    const opts = { count: 16, spreadRadius: 400, minScale: 0.2, maxScale: 0.6 };
    const layout = (seed: number) => {
      const f = new InstancedField({ sources: [source(16)], ...opts, seed });
      const mesh = meshesOf(f)[0];
      const m = new THREE.Matrix4();
      const out: number[] = [];
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        out.push(...m.elements);
      }
      return out;
    };
    expect(layout(1234)).toEqual(layout(1234));
    expect(layout(1234)).not.toEqual(layout(5678));
  });

  it('throws rather than silently rendering nothing when given no sources', () => {
    expect(() => new InstancedField({
      sources: [], count: 10, spreadRadius: 10, minScale: 1, maxScale: 1,
    })).toThrow();
  });

  it('dispose() frees decimated geometry it created but never a shared full-res source', () => {
    const shared = source(32);
    const decimated = new InstancedField({
      sources: [shared], count: 5, spreadRadius: 10, minScale: 1, maxScale: 1,
      targetTrianglesPerInstance: 200,
    });
    decimated.dispose();
    // the caller's own geometry must survive — the hero rock still renders from it
    expect(shared.geometry.getAttribute('position')).toBeDefined();

    const fullRes = new InstancedField({
      sources: [shared], count: 5, spreadRadius: 10, minScale: 1, maxScale: 1,
    });
    fullRes.dispose();
    expect(shared.geometry.getAttribute('position')).toBeDefined();
  });
});
