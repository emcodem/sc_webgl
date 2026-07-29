import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { decimateGeometry, triangleCount } from '../src/render/geometryLOD';

// Guards the runtime decimation behind the instanced rock field (see render/instancedField.ts). The
// field's whole reason for existing is that instancing 80 copies of a 100k-triangle scan still
// submits 8M triangles a frame, so the properties that matter here are: the budget is actually
// respected, the mesh stays a usable renderable mesh, and the silhouette survives.

function highPolySphere(): THREE.BufferGeometry {
  // ~8k triangles — same shape of problem as the scanned rock, small enough to keep the test fast
  return new THREE.SphereGeometry(10, 64, 64);
}

describe('decimateGeometry', () => {
  it('respects the triangle budget', () => {
    const source = highPolySphere();
    const before = triangleCount(source);
    expect(before).toBeGreaterThan(5000);

    for (const budget of [4000, 2000, 1000, 500, 200] as const) {
      const out = decimateGeometry(source, budget);
      expect(triangleCount(out)).toBeGreaterThan(0);
      expect(triangleCount(out)).toBeLessThanOrEqual(budget);
    }
  });

  // Because UV splitting adds vertices rather than triangles (see the two-level clustering note in
  // geometryLOD.ts), a textured mesh has no triangle floor above the coarsest grid — aggressive
  // budgets keep reducing rather than stalling.
  it('keeps reducing at aggressive budgets rather than stalling', () => {
    const source = highPolySphere();
    expect(triangleCount(decimateGeometry(source, 50)))
      .toBeLessThan(triangleCount(decimateGeometry(source, 200)));
  });

  it('returns the source untouched when already within budget', () => {
    const source = new THREE.BoxGeometry(1, 1, 1); // 12 triangles
    expect(decimateGeometry(source, 5000)).toBe(source);
  });

  it('produces a renderable indexed mesh with normals', () => {
    const out = decimateGeometry(highPolySphere(), 800);
    expect(out.getIndex()).not.toBeNull();
    expect(out.getAttribute('position')).toBeDefined();
    // normals are inherited from the source surface (see the 'normals' block below for why)
    const normals = out.getAttribute('normal');
    expect(normals).toBeDefined();
    expect(normals.count).toBe(out.getAttribute('position').count);
    // every normal is unit length
    for (let i = 0; i < normals.count; i++) {
      const len = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
      expect(len).toBeCloseTo(1, 3);
    }
  });

  // Regression: clustering moves vertices, so a face's winding can flip while its smooth vertex normals
  // still point outward. The rock material is THREE.DoubleSide, and three negates the normal for
  // back-facing fragments, so such a face is shaded with an inverted normal — it appears fully sun-lit
  // while sitting on the dark side. Measured on the meteorite scan: 113 of 2682 faces (4.21%) disagreed,
  // against 0 of 100000 in the source.
  describe('normals', () => {
    function facesDisagreeingWithWinding(geo: THREE.BufferGeometry): number {
      const pos = geo.getAttribute('position');
      const nrm = geo.getAttribute('normal');
      const idx = geo.getIndex()!;
      let bad = 0;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
        const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
        const e1x = pos.getX(b) - ax, e1y = pos.getY(b) - ay, e1z = pos.getZ(b) - az;
        const e2x = pos.getX(c) - ax, e2y = pos.getY(c) - ay, e2z = pos.getZ(c) - az;
        const gx = e1y * e2z - e1z * e2y, gy = e1z * e2x - e1x * e2z, gz = e1x * e2y - e1y * e2x;
        const vx = (nrm.getX(a) + nrm.getX(b) + nrm.getX(c)) / 3;
        const vy = (nrm.getY(a) + nrm.getY(b) + nrm.getY(c)) / 3;
        const vz = (nrm.getZ(a) + nrm.getZ(b) + nrm.getZ(c)) / 3;
        if (gx * vx + gy * vy + gz * vz < 0) bad++;
      }
      return bad;
    }

    it('never leaves a face wound against its own shading normal', () => {
      for (const source of [new THREE.SphereGeometry(10, 64, 64), new THREE.IcosahedronGeometry(10, 20)]) {
        for (const budget of [3000, 1000] as const) {
          expect(facesDisagreeingWithWinding(decimateGeometry(source, budget))).toBe(0);
        }
      }
    });

    it('inherits normals from the source rather than re-deriving them', () => {
      const source = new THREE.SphereGeometry(10, 64, 64);
      const out = decimateGeometry(source, 2000);
      const nrm = out.getAttribute('normal');
      const pos = out.getAttribute('position');
      // On a sphere the true normal is the outward radial direction; inherited normals track it closely,
      // whereas normals rebuilt from a clustered surface drift wherever a fold-over occurred.
      let worst = 1;
      for (let i = 0; i < nrm.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const pl = Math.hypot(px, py, pz) || 1;
        const dot = (nrm.getX(i) * px + nrm.getY(i) * py + nrm.getZ(i) * pz) / pl;
        worst = Math.min(worst, dot);
      }
      expect(worst).toBeGreaterThan(0.7);
    });

    it('emits unit-length normals', () => {
      const out = decimateGeometry(new THREE.IcosahedronGeometry(10, 20), 1500);
      const nrm = out.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++) {
        expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 3);
      }
    });
  });

  it('preserves UVs when the source has them', () => {
    const out = decimateGeometry(highPolySphere(), 800);
    expect(out.getAttribute('uv')).toBeDefined();
    expect(out.getAttribute('uv').count).toBe(out.getAttribute('position').count);
  });

  it('keeps the silhouette — bounding radius stays close to the original', () => {
    const source = highPolySphere();
    source.computeBoundingSphere();
    const out = decimateGeometry(source, 500);
    out.computeBoundingSphere();
    const before = source.boundingSphere!.radius;
    const after = out.boundingSphere!.radius;
    // vertex clustering can only pull vertices inward by at most a cell, never balloon the shape
    expect(after).toBeLessThanOrEqual(before * 1.02);
    expect(after).toBeGreaterThan(before * 0.85);
  });

  it('emits no degenerate triangles', () => {
    const out = decimateGeometry(highPolySphere(), 600);
    const idx = out.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      expect(a === b || b === c || a === c).toBe(false);
    }
  });

  it('caches per (geometry, budget) so a repeated request decimates once', () => {
    const source = highPolySphere();
    const first = decimateGeometry(source, 700);
    expect(decimateGeometry(source, 700)).toBe(first);
    // a different budget is a different result
    expect(decimateGeometry(source, 300)).not.toBe(first);
  });

  // Regression: welding across a UV seam averages coordinates that land in neither texture island,
  // so the face samples a huge diagonal swath of the atlas and renders as a vividly mis-coloured
  // triangle. Observed on the meteorite scan at a 3k budget: 610 of 2807 faces spanned >10% of the
  // atlas, worst 87%, against a source maximum of 1.7%.
  describe('UV seams', () => {
    // Per-face UV footprint — the fraction of the atlas one triangle covers.
    function uvSpans(geo: THREE.BufferGeometry): number[] {
      const uv = geo.getAttribute('uv');
      const idx = geo.getIndex()!;
      const spans: number[] = [];
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
        const us = [uv.getX(a), uv.getX(b), uv.getX(c)];
        const vs = [uv.getY(a), uv.getY(b), uv.getY(c)];
        spans.push(Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)));
      }
      return spans;
    }

    // A sphere's UV sphere already has a seam where u wraps 1 -> 0, plus pole fans; good enough to
    // reproduce the failure, since coincident-in-space vertices there carry far-apart UVs.
    it('never welds a face across a texture seam', () => {
      const source = new THREE.SphereGeometry(10, 64, 64);
      // Measured worst cases before the guard existed: 0.868 here and on the real meteorite scan.
      for (const budget of [3000, 2000, 1000] as const) {
        const out = decimateGeometry(source, budget);
        expect(Math.max(...uvSpans(out))).toBeLessThan(0.1);
      }
    });

    it('leaves no face spanning a large fraction of the atlas', () => {
      const out = decimateGeometry(new THREE.SphereGeometry(10, 64, 64), 2000);
      const spans = uvSpans(out);
      // the artifact was 610 of 2807 faces over 0.1, worst 0.868
      expect(spans.filter((s) => s > 0.1)).toHaveLength(0);
      expect(spans.filter((s) => s > 0.25)).toHaveLength(0);
    });

    // Regression: the first version of the seam guard split a seam's two sides into separate clusters
    // and then averaged each cluster's POSITION from its own members, so two points that started
    // identical drifted apart — the surface tore along every seam and you could see through the rock.
    // Positions must weld across a seam even though UVs must not.
    it('does not tear the surface open at a seam', () => {
      // The sharpest possible statement of the requirement: decimating the SAME mesh with and without
      // UVs must produce the same surface. Any hole that UV handling introduces shows up as extra
      // boundary edges (an edge used by one face instead of two) in the textured version only.
      //
      // Vertex clustering is not manifold-preserving in general, so both versions carry some boundary
      // edges (measured: 1.86% at a 2000 budget on this mesh, against 1.10% in three's own source
      // sphere, whose pole fans are already non-manifold). That baseline is inherent to the algorithm
      // and identical in both runs; what must not happen is the textured run tearing further.
      const withUv = new THREE.SphereGeometry(10, 64, 64);
      const withoutUv = new THREE.SphereGeometry(10, 64, 64);
      withoutUv.deleteAttribute('uv');

      const count = (geo: THREE.BufferGeometry) => {
        const out = decimateGeometry(geo, 2000);
        const pos = out.getAttribute('position');
        const idx = out.getIndex()!;
        const key = (i: number) =>
          `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
        const use = new Map<string, number>();
        for (let i = 0; i < idx.count; i += 3) {
          const k = [key(idx.getX(i)), key(idx.getX(i + 1)), key(idx.getX(i + 2))];
          for (const [a, b] of [[k[0], k[1]], [k[1], k[2]], [k[2], k[0]]]) {
            const e = a < b ? `${a}|${b}` : `${b}|${a}`;
            use.set(e, (use.get(e) ?? 0) + 1);
          }
        }
        return {
          triangles: triangleCount(out),
          boundary: [...use.values()].filter((n) => n === 1).length,
          edges: use.size,
        };
      };

      const textured = count(withUv);
      const plain = count(withoutUv);
      // Splitting a seam's UVs costs extra VERTICES, never extra triangles or extra boundary.
      expect(textured.triangles).toBe(plain.triangles);
      expect(textured.boundary).toBe(plain.boundary);
      expect(textured.edges).toBe(plain.edges);
    });

    it('keeps seam vertices co-located while giving them distinct UVs', () => {
      const out = decimateGeometry(new THREE.SphereGeometry(10, 64, 64), 2000);
      const pos = out.getAttribute('position');
      const uv = out.getAttribute('uv');

      // Group emitted vertices by exact position; any position holding more than one vertex is a seam
      // split. Those must agree in position (by construction) and differ in UV — that is the whole point.
      const byPos = new Map<string, number[]>();
      for (let i = 0; i < pos.count; i++) {
        const k = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
        const list = byPos.get(k);
        if (list) list.push(i); else byPos.set(k, [i]);
      }
      const shared = [...byPos.values()].filter((l) => l.length > 1);
      expect(shared.length).toBeGreaterThan(0); // the u-wrap seam must produce some
      for (const group of shared) {
        const uvs = new Set(group.map((i) => `${uv.getX(i)},${uv.getY(i)}`));
        expect(uvs.size).toBeGreaterThan(1);
      }
    });

    it('still hits the triangle budget with the seam guard enabled', () => {
      // The guard must not defeat the decimation by refusing so many welds that the reduction
      // disappears — the triangle cut is the whole point.
      const source = new THREE.SphereGeometry(10, 64, 64);
      const out = decimateGeometry(source, 1500);
      expect(triangleCount(out)).toBeLessThanOrEqual(1500);
      expect(triangleCount(out)).toBeGreaterThan(200);
      expect(triangleCount(out)).toBeLessThan(triangleCount(source) * 0.25);
    });

    it('still decimates geometry that has no UVs at all', () => {
      const source = new THREE.SphereGeometry(10, 48, 48);
      source.deleteAttribute('uv');
      const out = decimateGeometry(source, 500);
      expect(triangleCount(out)).toBeLessThanOrEqual(500);
      expect(triangleCount(out)).toBeGreaterThan(0);
      expect(out.getAttribute('uv')).toBeUndefined();
    });
  });

  // A non-indexed mesh duplicates every triangle corner, so nothing is topologically adjacent and the
  // seam guard would block every weld — decimateGeometry indexes it first (via mergeVertices) to
  // recover the shared vertices, which is what makes this reduce at all.
  it('handles non-indexed geometry', () => {
    const source = highPolySphere().toNonIndexed();
    expect(source.getIndex()).toBeNull();
    const out = decimateGeometry(source, 1500);
    expect(triangleCount(out)).toBeGreaterThan(0);
    expect(triangleCount(out)).toBeLessThanOrEqual(1500);
    expect(triangleCount(out)).toBeLessThan(triangleCount(source) * 0.25);
  });

  // Regression: an earlier version dropped faces whose cluster triple had already been emitted. On a
  // closed mesh two genuinely distinct faces can collapse onto the same three clusters (a thin ridge),
  // so discarding one left its neighbours' shared edges used once instead of twice — holes you could
  // see through. Measured on the watertight meteorite scan: 192 boundary edges with that dedup, 0
  // without. A watertight source must decimate to a watertight result.
  it('keeps a closed surface closed (no holes)', () => {
    // IcosahedronGeometry is a watertight sphere approximation with real UV seams.
    const source = new THREE.IcosahedronGeometry(10, 20);

    const boundaryEdges = (geo: THREE.BufferGeometry) => {
      const pos = geo.getAttribute('position');
      const idx = geo.getIndex();
      const n = idx ? idx.count : pos.count;
      const at = (i: number) => (idx ? idx.getX(i) : i);
      // keyed by POSITION, so a legitimate seam UV-split is not miscounted as a hole
      const key = (i: number) =>
        `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      const use = new Map<string, number>();
      for (let i = 0; i < n; i += 3) {
        const k = [key(at(i)), key(at(i + 1)), key(at(i + 2))];
        for (const [a, b] of [[k[0], k[1]], [k[1], k[2]], [k[2], k[0]]]) {
          const e = a < b ? `${a}|${b}` : `${b}|${a}`;
          use.set(e, (use.get(e) ?? 0) + 1);
        }
      }
      return [...use.values()].filter((c) => c === 1).length;
    };

    expect(boundaryEdges(source)).toBe(0); // sanity: the source really is closed
    for (const budget of [4000, 2000, 800] as const) {
      expect(boundaryEdges(decimateGeometry(source, budget))).toBe(0);
    }
  });

  it('emits no orphan vertices (every vertex is used by some face)', () => {
    const out = decimateGeometry(highPolySphere(), 900);
    const idx = out.getIndex()!;
    const used = new Set<number>();
    for (let i = 0; i < idx.count; i++) used.add(idx.getX(i));
    expect(used.size).toBe(out.getAttribute('position').count);
  });
});
