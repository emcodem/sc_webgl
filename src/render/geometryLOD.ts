import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ============================================================================================
// Runtime geometry decimation — the "L" in the instanced-field LOD (see render/instancedField.ts).
//
// Why this exists: the scanned celestial models (render/celestialModels.ts) are research-grade
// meshes — the meteorite scan is 100,000 triangles for a single rock. That is the right budget for
// the one hero rock you can fly up to and inspect, and roughly 100x too much for the scattered
// field copies, which render 9-36 m across and usually cover a few hundred pixels. Instancing makes
// 80 of them cost ONE draw call, but a draw call still submits every triangle: 80 x 100k = 8,000,000
// triangles per frame, measured at ~64% of the entire GPU frame and (being vertex-bound) costing the
// same whether the field is filling the screen or sitting behind the camera.
//
// So the field needs a cheaper copy of whatever geometry it was handed. This must work for ANY mesh
// we are given — the rock set is expected to grow and change — so it can't rely on hand-authored LOD
// assets or an offline bake step.
//
// Method: vertex clustering (Rossignac-Borrel). Overlay a uniform grid on the mesh's bounding box,
// weld every vertex inside a cell down to that cell's averaged representative, then drop the triangles
// that collapsed to a degenerate sliver (two or three corners in the same cluster). Cell size IS the
// error bound, so the silhouette holds while interior detail melts away — exactly the trade a small
// distant rock wants.
//
// It is chosen over three's own SimplifyModifier (edge-collapse) deliberately: clustering is O(V+T)
// per pass and runs in a few milliseconds on a 100k-triangle mesh, where an edge-collapse pass over
// the same mesh takes seconds — far too slow to sit in the async model-load path. Clustering is the
// lower-quality algorithm of the two; for a 20 m rock drawn 30 px wide, that difference is invisible.
//
// ---------------------------------------------------------------------------------------------
// TWO LEVELS OF CLUSTERING, and why textured meshes need both
//
// A textured mesh's UV layout is a set of islands, and the seams between them are represented by
// DUPLICATED vertices: identical position, different UVs, joined by no edge. That makes naive
// clustering fail in two opposite ways, and fixing either one alone causes the other:
//
//   • Weld a seam's two sides into one vertex and their UVs get averaged into a coordinate that lies
//     in neither island. The face then samples a huge diagonal swath of the atlas and renders as a
//     vividly mis-coloured triangle. (Measured on the meteorite scan at a 3k budget: 610 of 2807
//     faces spanned >10% of the atlas, worst 87%, against a source maximum of 1.7%.)
//   • Keep them apart and their POSITIONS get averaged separately, from different member sets. Two
//     points that started identical drift apart, the surface tears along every seam, and you can see
//     straight through the model.
//
// The resolution is that these are different questions. Geometry welding and attribute welding are
// clustered independently:
//
//   LEVEL 1 — position clusters decide the SHAPE. Vertices weld when they share a cell and are either
//     edge-connected or exactly coincident. The coincidence rule is what pulls a seam's two sides into
//     one position, so no crack can open; the connectivity rule keeps genuinely separate shells that
//     merely pass near each other from fusing.
//   LEVEL 2 — attribute groups decide the emitted VERTICES. Each position cluster is subdivided so no
//     group's UV footprint exceeds `uvExtentLimit` of the atlas. Groups within one position cluster
//     all receive that cluster's single averaged position, and only their UVs differ.
//
// A seam therefore emits two vertices at the SAME point carrying their own island's UVs — which is
// exactly how the source represented it. Splitting on UV costs vertices, never triangles: a face is
// dropped only when two of its corners share a POSITION cluster, so the achievable triangle count is
// set purely by grid resolution.
//
// The UV extent limit also covers distortion, which connectivity cannot see: around a UV sphere's pole
// every longitude collapses to nearly one point in space while spanning the full u range, so that ring
// is legitimately edge-connected yet covers the whole atlas width.
// ============================================================================================

// Decimated results are cached per (source geometry, triangle budget), so repeated requests — a
// field rebuilt on a scenario switch, several fields sharing one rock — decimate once per page.
const cache = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry>>();

// Grid resolutions the search below is allowed to pick from. The upper bound caps the cell-id
// packing used in `clusterVertices` (512^3 stays a safe integer) and is far finer than any budget
// a field instance would ask for.
const MIN_GRID = 2;
const MAX_GRID = 512;

// Largest fraction of the texture atlas one emitted vertex group may span (level 2 above). Scaled up
// for models whose UVs are authored coarsely, so it never forces more groups than a mesh's own UV
// density warrants.
const UV_CLUSTER_EXTENT_MIN = 0.04;
const UV_CLUSTER_EXTENT_FACE_MULTIPLE = 3;

export function triangleCount(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  const pos = geo.getAttribute('position');
  if (index) return Math.floor(index.count / 3);
  return pos ? Math.floor(pos.count / 3) : 0;
}

// Triangle corner indices, whether or not the source is indexed.
function cornerIndices(geo: THREE.BufferGeometry): ArrayLike<number> {
  const index = geo.getIndex();
  if (index) return index.array as ArrayLike<number>;
  const n = geo.getAttribute('position')?.count ?? 0;
  const implicit = new Uint32Array(n);
  for (let i = 0; i < n; i++) implicit[i] = i;
  return implicit;
}

interface Clustering {
  posOf: Int32Array;  // source vertex -> position cluster (level 1: shape)
  posCount: number;
  attrOf: Int32Array; // source vertex -> emitted vertex group (level 2: position cluster + UV)
  attrCount: number;
  attrPos: Int32Array; // emitted vertex group -> its position cluster
}

// Median fraction of the atlas one source face covers — the natural unit of "how fast do this model's
// UVs vary", used to scale the extent limit to whatever UV density the mesh was authored at.
function medianFaceUvSpan(
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  corners: ArrayLike<number>
): number {
  const spans: number[] = [];
  for (let i = 0; i + 2 < corners.length; i += 3) {
    const a = corners[i], b = corners[i + 1], c = corners[i + 2];
    const u0 = uv.getX(a), u1 = uv.getX(b), u2 = uv.getX(c);
    const v0 = uv.getY(a), v1 = uv.getY(b), v2 = uv.getY(c);
    spans.push(Math.max(
      Math.max(u0, u1, u2) - Math.min(u0, u1, u2),
      Math.max(v0, v1, v2) - Math.min(v0, v1, v2)
    ));
  }
  if (spans.length === 0) return 0;
  spans.sort((x, y) => x - y);
  return spans[Math.floor(spans.length / 2)];
}

// Both clustering levels in one pass. See the header for what each level is for.
function clusterVertices(
  pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  corners: ArrayLike<number>,
  box: THREE.Box3,
  n: number,
  uv: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
  uvExtentLimit: number
): Clustering {
  const size = box.getSize(new THREE.Vector3());
  // A perfectly flat axis (size 0) would divide by zero; it collapses to a single row of cells.
  const sx = n / (size.x || 1), sy = n / (size.y || 1), sz = n / (size.z || 1);
  const count = pos.count;

  const cell = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const ix = Math.min(n - 1, Math.max(0, Math.floor((pos.getX(i) - box.min.x) * sx)));
    const iy = Math.min(n - 1, Math.max(0, Math.floor((pos.getY(i) - box.min.y) * sy)));
    const iz = Math.min(n - 1, Math.max(0, Math.floor((pos.getZ(i) - box.min.z) * sz)));
    cell[i] = (ix * n + iy) * n + iz;
  }

  // ---- level 1: position clusters ----
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; } // path compression
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // edge-connected neighbours inside one cell
  for (let i = 0; i + 2 < corners.length; i += 3) {
    const a = corners[i], b = corners[i + 1], c = corners[i + 2];
    if (cell[a] === cell[b]) union(a, b);
    if (cell[b] === cell[c]) union(b, c);
    if (cell[a] === cell[c]) union(a, c);
  }
  // exactly coincident vertices — a UV seam's two sides. These carry bit-identical positions from the
  // source (they are one point that was duplicated to hold a second UV), so exact comparison is the
  // right test, and welding them is what stops the surface tearing along the seam.
  const coincident = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
    const first = coincident.get(key);
    if (first === undefined) coincident.set(key, i);
    else union(first, i);
  }

  const posOf = new Int32Array(count);
  const posIds = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const root = find(i);
    let id = posIds.get(root);
    if (id === undefined) { id = posIds.size; posIds.set(root, id); }
    posOf[i] = id;
  }
  const posCount = posIds.size;

  // ---- level 2: attribute (UV) groups within each position cluster ----
  const attrOf = new Int32Array(count);
  if (!uv || uvExtentLimit <= 0) {
    // Nothing to protect: one emitted vertex per position cluster.
    attrOf.set(posOf);
    const attrPos = new Int32Array(posCount);
    for (let i = 0; i < count; i++) attrPos[posOf[i]] = posOf[i];
    return { posOf, posCount, attrOf, attrCount: posCount, attrPos };
  }

  interface UvGroup { uMin: number; uMax: number; vMin: number; vMax: number; id: number }
  const groupsPerPos = new Map<number, UvGroup[]>();
  const attrPosList: number[] = [];
  let nextAttr = 0;
  for (let i = 0; i < count; i++) {
    const p = posOf[i];
    const u = uv.getX(i), v = uv.getY(i);
    let groups = groupsPerPos.get(p);
    if (!groups) { groups = []; groupsPerPos.set(p, groups); }
    let id = -1;
    for (const g of groups) {
      const nuMin = Math.min(g.uMin, u), nuMax = Math.max(g.uMax, u);
      const nvMin = Math.min(g.vMin, v), nvMax = Math.max(g.vMax, v);
      if (nuMax - nuMin > uvExtentLimit || nvMax - nvMin > uvExtentLimit) continue; // would smear
      g.uMin = nuMin; g.uMax = nuMax; g.vMin = nvMin; g.vMax = nvMax;
      id = g.id;
      break;
    }
    if (id < 0) {
      id = nextAttr++;
      groups.push({ uMin: u, uMax: u, vMin: v, vMax: v, id });
      attrPosList.push(p);
    }
    attrOf[i] = id;
  }

  return { posOf, posCount, attrOf, attrCount: nextAttr, attrPos: Int32Array.from(attrPosList) };
}

// Faces that survive this clustering: a face is dropped only when two of its corners land in the same
// POSITION cluster, which makes it a zero-area sliver. Degeneracy is judged on position clusters rather
// than on emitted-vertex groups, so splitting a seam's UVs never changes the triangle count — it only
// changes which vertices those triangles reference.
//
// Coincident duplicates are deliberately NOT removed. An earlier version dropped any face whose cluster
// triple had already been emitted, which tore holes in closed meshes: on a thin ridge two genuinely
// distinct faces can collapse onto the same three clusters, and discarding one leaves its neighbours'
// shared edges used once instead of twice — a boundary edge, i.e. a hole you can see through.
// (Measured on the watertight meteorite scan: 192 boundary edges / 4.25% with dedup, 0 without.) The
// duplicates it used to save are a handful of exactly-overlapping triangles — no z-fighting, since they
// share vertices — which is a far cheaper price than holes in the silhouette.
function survivingFaces(corners: ArrayLike<number>, c: Clustering, collect: number[] | null): number {
  let n = 0;
  for (let i = 0; i + 2 < corners.length; i += 3) {
    const i0 = corners[i], i1 = corners[i + 1], i2 = corners[i + 2];
    const p0 = c.posOf[i0], p1 = c.posOf[i1], p2 = c.posOf[i2];
    if (p0 === p1 || p1 === p2 || p0 === p2) continue;
    if (collect) collect.push(c.attrOf[i0], c.attrOf[i1], c.attrOf[i2]);
    n++;
  }
  return n;
}

// Geometric normal of one face, from its winding.
function faceNormal(position: Float32Array, a: number, b: number, c: number): [number, number, number] {
  const ax = position[a * 3], ay = position[a * 3 + 1], az = position[a * 3 + 2];
  const e1x = position[b * 3] - ax, e1y = position[b * 3 + 1] - ay, e1z = position[b * 3 + 2] - az;
  const e2x = position[c * 3] - ax, e2y = position[c * 3 + 1] - ay, e2z = position[c * 3 + 2] - az;
  return [
    e1y * e2z - e1z * e2y,
    e1z * e2x - e1x * e2z,
    e1x * e2y - e1y * e2x,
  ];
}

// Fallback for vertices whose inherited normals cancelled out: accumulate the normals of the faces
// using them, exactly as computeVertexNormals would, but only for those vertices.
function accumulateFaceNormals(
  position: Float32Array,
  indices: Uint16Array | Uint32Array,
  normal: Float32Array,
  targets: number[]
): void {
  const wanted = new Set(targets);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (!wanted.has(a) && !wanted.has(b) && !wanted.has(c)) continue;
    const [nx, ny, nz] = faceNormal(position, a, b, c);
    for (const v of [a, b, c]) {
      if (!wanted.has(v)) continue;
      normal[v * 3] += nx; normal[v * 3 + 1] += ny; normal[v * 3 + 2] += nz;
    }
  }
  for (const v of targets) {
    const nx = normal[v * 3], ny = normal[v * 3 + 1], nz = normal[v * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-8) {
      normal[v * 3] = nx / len; normal[v * 3 + 1] = ny / len; normal[v * 3 + 2] = nz / len;
    } else {
      normal[v * 3] = 0; normal[v * 3 + 1] = 1; normal[v * 3 + 2] = 0; // last resort, must be unit length
    }
  }
}

// Flip the winding of any face whose geometric normal opposes its own shading normals, in place. See the
// call site for why a disagreement mis-lights the face under a double-sided material.
function orientFacesToNormals(
  position: Float32Array,
  normal: Float32Array,
  indices: Uint16Array | Uint32Array
): void {
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    const [gx, gy, gz] = faceNormal(position, a, b, c);
    const vx = (normal[a * 3] + normal[b * 3] + normal[c * 3]) / 3;
    const vy = (normal[a * 3 + 1] + normal[b * 3 + 1] + normal[c * 3 + 1]) / 3;
    const vz = (normal[a * 3 + 2] + normal[b * 3 + 2] + normal[c * 3 + 2]) / 3;
    if (gx * vx + gy * vy + gz * vz < 0) {
      indices[i + 1] = c;
      indices[i + 2] = b;
    }
  }
}

function buildFromClustering(
  source: THREE.BufferGeometry,
  corners: ArrayLike<number>,
  c: Clustering
): THREE.BufferGeometry {
  const srcPos = source.getAttribute('position');
  const srcUv = source.getAttribute('uv');
  const srcNrm = source.getAttribute('normal');

  // Positions average over the POSITION cluster, so every emitted vertex sharing that cluster — both
  // sides of a seam included — lands on exactly the same point and the surface cannot tear.
  const posSum = new Float64Array(c.posCount * 3);
  const posMembers = new Uint32Array(c.posCount);
  // UVs average over the emitted group, keeping each island's own coordinates.
  const uvSum = srcUv ? new Float64Array(c.attrCount * 2) : null;
  const uvMembers = srcUv ? new Uint32Array(c.attrCount) : null;
  // Normals are carried over from the SOURCE rather than recomputed from the decimated surface. A
  // clustered mesh has fold-overs — faces whose vertices moved past each other — and rebuilding normals
  // from that geometry propagates their reversed face normals into the vertex normals. The source
  // normals describe the real surface, so they stay correct through any amount of decimation.
  const nrmSum = srcNrm ? new Float64Array(c.attrCount * 3) : null;

  for (let i = 0; i < srcPos.count; i++) {
    const p = c.posOf[i];
    posSum[p * 3] += srcPos.getX(i);
    posSum[p * 3 + 1] += srcPos.getY(i);
    posSum[p * 3 + 2] += srcPos.getZ(i);
    posMembers[p]++;
    const a = c.attrOf[i];
    if (uvSum && uvMembers && srcUv) {
      uvSum[a * 2] += srcUv.getX(i);
      uvSum[a * 2 + 1] += srcUv.getY(i);
      uvMembers[a]++;
    }
    if (nrmSum && srcNrm) {
      nrmSum[a * 3] += srcNrm.getX(i);
      nrmSum[a * 3 + 1] += srcNrm.getY(i);
      nrmSum[a * 3 + 2] += srcNrm.getZ(i);
    }
  }

  const tris: number[] = [];
  survivingFaces(corners, c, tris);

  // Emit ONLY groups some surviving face references. Groups whose every face collapsed would otherwise
  // linger as orphan vertices: dead weight, and computeVertexNormals leaves them a zero-length normal.
  const remap = new Int32Array(c.attrCount).fill(-1);
  let used = 0;
  for (const id of tris) if (remap[id] < 0) remap[id] = used++;

  const position = new Float32Array(used * 3);
  const uv = uvSum ? new Float32Array(used * 2) : null;
  const normal = nrmSum ? new Float32Array(used * 3) : null;
  // Emitted vertices whose source normals summed to ~zero (a cluster spanning opposing surfaces).
  const degenerateNormals: number[] = [];
  for (let a = 0; a < c.attrCount; a++) {
    const out = remap[a];
    if (out < 0) continue;
    const p = c.attrPos[a];
    const pm = posMembers[p] || 1;
    position[out * 3] = posSum[p * 3] / pm;
    position[out * 3 + 1] = posSum[p * 3 + 1] / pm;
    position[out * 3 + 2] = posSum[p * 3 + 2] / pm;
    if (uv && uvSum && uvMembers) {
      const um = uvMembers[a] || 1;
      uv[out * 2] = uvSum[a * 2] / um;
      uv[out * 2 + 1] = uvSum[a * 2 + 1] / um;
    }
    if (normal && nrmSum) {
      const nx = nrmSum[a * 3], ny = nrmSum[a * 3 + 1], nz = nrmSum[a * 3 + 2];
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-8) {
        normal[out * 3] = nx / len;
        normal[out * 3 + 1] = ny / len;
        normal[out * 3 + 2] = nz / len;
      } else {
        degenerateNormals.push(out);
      }
    }
  }

  const indices = used > 65535 ? new Uint32Array(tris.length) : new Uint16Array(tris.length);
  for (let i = 0; i < tris.length; i++) indices[i] = remap[tris[i]];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

  if (normal) {
    // Rebuild the few normals that cancelled out, from the faces that actually use them.
    if (degenerateNormals.length > 0) accumulateFaceNormals(position, indices, normal, degenerateNormals);
    geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    // Make every face's winding agree with its shading normal. The rock material is THREE.DoubleSide,
    // and three negates the normal for back-facing fragments, so a face wound against its own normal is
    // shaded with an inverted normal — it lights up as if facing the sun while sitting on the dark side.
    // Clustering causes this by moving vertices: the smooth vertex normals stay outward while a face's
    // winding flips. (Measured on the meteorite scan at a 3k budget: 113 of 2682 faces disagreed, 4.21%,
    // against 0 of 100000 in the source.)
    orientFacesToNormals(position, normal, indices);
  } else {
    // No source normals to inherit — derive them, accepting that fold-overs will influence the result.
    geo.computeVertexNormals();
  }

  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Returns a copy of `source` reduced towards `targetTriangles`, or `source` itself when it is already
// within budget (callers must therefore never dispose the result without checking whether it is the
// original — see instancedField.ts's ownedGeometries handling).
//
// `targetTriangles` is a budget, not an exact count: grid cell size is the tunable, so the achieved
// count lands at or under the target rather than exactly on it. A mesh cannot fall below the handful of
// triangles the coarsest grid (2x2x2) yields.
export function decimateGeometry(source: THREE.BufferGeometry, targetTriangles: number): THREE.BufferGeometry {
  const sourceTris = triangleCount(source);
  if (targetTriangles <= 0 || sourceTris <= targetTriangles) return source;

  let perSource = cache.get(source);
  if (!perSource) { perSource = new Map(); cache.set(source, perSource); }
  const hit = perSource.get(targetTriangles);
  if (hit) return hit;

  if (!source.getAttribute('position')) return source;

  // Position clustering welds coincident and edge-connected vertices, so the working geometry must
  // actually have shared vertices. A non-indexed mesh duplicates every triangle corner — index it
  // first. mergeVertices joins only vertices identical in ALL attributes, so UV seams survive it.
  const work = source.getIndex() ? source : mergeVertices(source);
  const pos = work.getAttribute('position');
  const box = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
  const corners = cornerIndices(work);
  const uv = work.getAttribute('uv') ?? null;
  const uvExtentLimit = uv
    ? Math.max(UV_CLUSTER_EXTENT_MIN, medianFaceUvSpan(uv, corners) * UV_CLUSTER_EXTENT_FACE_MULTIPLE)
    : 0;

  // Triangle count rises monotonically with grid resolution, so binary-search the finest grid that
  // still fits the budget. Each probe is one O(V+T) pass; ~9 probes over the 2..512 range.
  let lo = MIN_GRID, hi = MAX_GRID;
  let best: Clustering | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const clustering = clusterVertices(pos, corners, box, mid, uv, uvExtentLimit);
    if (survivingFaces(corners, clustering, null) <= targetTriangles) {
      best = clustering;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Even the coarsest grid overshot the budget (a pathological target of a handful of triangles) —
  // use it anyway rather than returning the full-resolution mesh, which is the thing we're avoiding.
  if (!best) best = clusterVertices(pos, corners, box, MIN_GRID, uv, uvExtentLimit);

  const result = buildFromClustering(work, corners, best);
  if (work !== source) work.dispose(); // scratch copy from mergeVertices, never rendered
  perSource.set(targetTriangles, result);
  return result;
}
