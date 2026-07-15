import * as THREE from 'three';
import type { Vec3 } from '../core/types';

// ============================================================================================
// "Hot metal" weapon-impact effect — GPU spark spray + white flash + cooling molten glow, in the
// blackbody colour language (white -> yellow -> orange -> red -> out). Adapted from a standalone
// three.js system to fit this project's two load-bearing render invariants:
//
//   1. FLOATING ORIGIN. The sim keeps absolute f64 world coords; the renderer is the only place that
//      rebases into camera-relative f32 space (see render/renderer.ts). A burst is born at an
//      absolute world point and lives ~0.7s, during which the camera moves — in a dogfight, hundreds
//      of metres. So every active burst/flash/glow stores its ABSOLUTE origin and is rebased every
//      frame by `origin - eye`. For the sparks this is one transform assignment per burst: the GPU
//      integrates each particle's motion in a burst-local frame (positions attribute is all zeros —
//      born at the local origin), and the Points object's own position carries `origin - eye`, so a
//      single f64 subtraction rebases the whole cloud with full f32 precision no matter how far the
//      player has flown.
//   2. SIM/RENDER SEPARATION. This module is render-only. The sim just drops a one-shot 'impact'
//      trigger into world.effects (combat/effects.ts); the renderer consumes it once (see the
//      WeakSet in render/renderer.ts) and calls trigger() here, which then owns the burst's full
//      visual life independently of when the sim drops the (much shorter-lived) trigger.
//
// One extra wrinkle vs. the source system: the scene renders with a logarithmic depth buffer, so
// the custom spark shader must emit matching log depth (#include <logdepthbuf_*>) or it would
// depth-test wrongly against the rest of the scene. The flash/glow use built-in SpriteMaterial,
// which three.js patches for log depth automatically.
// ============================================================================================

const MAX_BURSTS = 24;          // concurrent spark bursts (ring-buffer reused when exceeded)
const PARTICLES_PER_BURST = 48; // capacity of each burst's buffer
const MAX_FLASHES = 12;
const MAX_GLOWS = 24;

// -------------------------------------------------------------------------------------------------
// Runtime-built textures (no external assets) — a soft round spark sprite, a molten-glow sprite, and
// a 1D blackbody LUT that IS the "hot metal cooling" curve (colour + alpha over the 0->1 life).
// -------------------------------------------------------------------------------------------------

function createSparkSpriteTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createGlowSpriteTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,200,120,0.85)');
  grad.addColorStop(0.65, 'rgba(255,90,20,0.35)');
  grad.addColorStop(1.0, 'rgba(255,40,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createBlackbodyLUT(width = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0.00, 'rgba(255,255,255,1.0)');   // white-hot flash
  grad.addColorStop(0.08, 'rgba(255,247,220,1.0)');   // near-white, slight warmth
  grad.addColorStop(0.22, 'rgba(255,214,120,1.0)');   // bright yellow
  grad.addColorStop(0.42, 'rgba(255,150,40,0.95)');   // yellow-orange
  grad.addColorStop(0.62, 'rgba(230,80,20,0.85)');    // orange-red
  grad.addColorStop(0.80, 'rgba(140,30,10,0.55)');    // dying ember, dark red
  grad.addColorStop(0.92, 'rgba(60,10,5,0.2)');       // almost out
  grad.addColorStop(1.00, 'rgba(0,0,0,0.0)');         // gone
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  return tex;
}

// -------------------------------------------------------------------------------------------------
// Spark shaders. The GPU integrates each particle's motion analytically from (uTime - aStartTime),
// so a burst is fire-and-forget: fill the buffers once at trigger, then only uTime changes per frame.
// The <logdepthbuf_*> includes make these write the same log depth as the rest of the scene.
// -------------------------------------------------------------------------------------------------

const sparkVertexShader = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_vertex>

  attribute vec3 aVelocity;
  attribute float aStartTime;
  attribute float aLifetime;
  attribute float aSeed;
  attribute float aSize;

  uniform float uTime;
  uniform float uDrag;
  uniform float uPixelRatio;

  varying float vT;
  varying float vSeed;
  varying float vAlive;

  void main() {
    float age = uTime - aStartTime;
    float lifeT = clamp(age / aLifetime, 0.0, 1.0);
    vT = lifeT;
    vSeed = aSeed;

    // Exponential drag integrated analytically (stable at any dt): sparks decelerate as they cool.
    float d = max(uDrag, 0.0001);
    float dragFactor = 1.0 - exp(-d * age);
    vec3 displacement = aVelocity * (dragFactor / d);

    vec3 pos = position + displacement;

    float alive = step(0.0, age) * step(age, aLifetime);
    vAlive = alive;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Shrink as they cool/burn out; scale with distance so far sparks don't vanish to sub-pixel.
    float sizeCurve = mix(1.0, 0.15, lifeT);
    gl_PointSize = aSize * sizeCurve * alive * (uPixelRatio * 460.0 / max(-mvPosition.z, 0.001));

    #include <logdepthbuf_vertex>
  }
`;

const sparkFragmentShader = /* glsl */`
  #include <common>
  #include <logdepthbuf_pars_fragment>

  uniform sampler2D uLUT;
  uniform sampler2D uSpriteMap;

  varying float vT;
  varying float vSeed;
  varying float vAlive;

  void main() {
    if (vAlive < 0.5) discard;

    #include <logdepthbuf_fragment>

    vec4 lutColor = texture2D(uLUT, vec2(vT, 0.5));
    vec4 sprite = texture2D(uSpriteMap, gl_PointCoord);

    // Per-particle brightness variance so a burst doesn't look uniform.
    float flicker = 0.8 + 0.2 * fract(sin(vSeed * 12.9898) * 43758.5453);

    vec3 color = lutColor.rgb * sprite.rgb * flicker * 1.1; // slight overdrive so the hot core reads, but sparks stay crisp points rather than blooming into blobs
    float alpha = lutColor.a * sprite.a;

    gl_FragColor = vec4(color, alpha);
  }
`;

// A single spark burst: its own geometry/buffers + a Points object rebased each frame by origin-eye.
interface Burst {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  velocities: Float32Array;
  startTimes: Float32Array;
  lifetimes: Float32Array;
  seeds: Float32Array;
  sizes: Float32Array;
  origin: Vec3;   // absolute world point the burst was fired at
  birth: number;  // clock time (s) at trigger
  maxLife: number; // longest particle lifetime this burst used, for expiry
  active: boolean;
}

interface Billboard {
  sprite: THREE.Sprite;
  origin: Vec3;
  birth: number;
  duration: number;
  maxScale: number;
  active: boolean;
}

export interface ImpactOptions {
  count?: number;
  scale?: number;      // overall size multiplier (big vs. small weapon / hull)
  speedMin?: number;   // m/s
  speedMax?: number;
  spreadAngle?: number; // cone half-angle around the normal, radians
  lifeMin?: number;
  lifeMax?: number;
  sizeMin?: number;
  sizeMax?: number;
}

export class ImpactEffects {
  private scene: THREE.Scene;
  private material: THREE.ShaderMaterial;
  private bursts: Burst[] = [];
  private flashes: Billboard[] = [];
  private glows: Billboard[] = [];
  private burstCursor = 0;
  private flashCursor = 0;
  private glowCursor = 0;

  // Deterministic pseudo-random so the module never touches Math.random at import/construct time and
  // stays reproducible; seeded per-call by an integer that ticks on every trigger.
  private rngState = 0x9e3779b9;
  private rand(): number {
    // xorshift32
    let x = this.rngState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 0xffffffff;
  }

  private lutTex: THREE.CanvasTexture;
  private sparkTex: THREE.CanvasTexture;
  private flashTex: THREE.CanvasTexture;
  private glowTex: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.lutTex = createBlackbodyLUT();
    this.sparkTex = createSparkSpriteTexture();
    this.flashTex = createSparkSpriteTexture(64);
    this.glowTex = createGlowSpriteTexture(128);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDrag: { value: 2.2 },
        uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
        uLUT: { value: this.lutTex },
        uSpriteMap: { value: this.sparkTex },
      },
      vertexShader: sparkVertexShader,
      fragmentShader: sparkFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    for (let i = 0; i < MAX_BURSTS; i++) this.bursts.push(this.buildBurst());
    for (let i = 0; i < MAX_FLASHES; i++) this.flashes.push(this.buildBillboard(this.flashTex, 0.09));
    for (let i = 0; i < MAX_GLOWS; i++) this.glows.push(this.buildBillboard(this.glowTex, 0.25));
  }

  private buildBurst(): Burst {
    const cap = PARTICLES_PER_BURST;
    const geometry = new THREE.BufferGeometry();
    // Positions are all zero and never change — particles are born at the burst-local origin and the
    // Points object's transform carries the (origin - eye) rebasing. See the class header.
    const positions = new Float32Array(cap * 3);
    const velocities = new Float32Array(cap * 3);
    const startTimes = new Float32Array(cap).fill(-9999);
    const lifetimes = new Float32Array(cap).fill(0.0001);
    const seeds = new Float32Array(cap);
    const sizes = new Float32Array(cap);

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('aStartTime', new THREE.BufferAttribute(startTimes, 1));
    geometry.setAttribute('aLifetime', new THREE.BufferAttribute(lifetimes, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const points = new THREE.Points(geometry, this.material);
    points.frustumCulled = false; // particles move via the shader; a static AABB would wrongly cull
    points.visible = false;
    this.scene.add(points);

    return {
      points, geometry, velocities, startTimes, lifetimes, seeds, sizes,
      origin: { x: 0, y: 0, z: 0 }, birth: -9999, maxLife: 0, active: false,
    };
  }

  private buildBillboard(tex: THREE.CanvasTexture, duration: number): Billboard {
    const material = new THREE.SpriteMaterial({
      map: tex, color: 0xffffff, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(0.001);
    sprite.visible = false;
    this.scene.add(sprite);
    return { sprite, origin: { x: 0, y: 0, z: 0 }, birth: -9999, duration, maxScale: 1, active: false };
  }

  // Fire off one impact. `origin`/`normal` are ABSOLUTE world-space (normal points out of the struck
  // surface). `now` is the shared render clock (seconds). Owns the burst's whole visual life from here.
  trigger(origin: Vec3, normal: Vec3 | undefined, now: number, opts: ImpactOptions = {}): void {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0; // advance so successive bursts differ

    const scale = opts.scale ?? 1.0;
    const count = Math.min(opts.count ?? 36, PARTICLES_PER_BURST);
    const speedMin = (opts.speedMin ?? 6.0) * scale;
    const speedMax = (opts.speedMax ?? 26.0) * scale;
    const spreadAngle = opts.spreadAngle ?? Math.PI * 0.42; // ~76deg hammer-strike spray
    const lifeMin = opts.lifeMin ?? 0.22;
    const lifeMax = opts.lifeMax ?? 0.75;
    const sizeMin = (opts.sizeMin ?? 3.0) * scale;
    const sizeMax = (opts.sizeMax ?? 7.0) * scale;

    // Orthonormal frame around the normal (fall back to +Y outward if no normal supplied).
    const nx = normal?.x ?? 0, ny = normal?.y ?? 1, nz = normal?.z ?? 0;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const n = { x: nx / nlen, y: ny / nlen, z: nz / nlen };
    let tx: number, ty: number, tz: number;
    if (Math.abs(n.y) < 0.99) { // t = normalize(worldUp x n)
      tx = 1 * n.z - 0 * n.y; ty = 0 * n.x - 0 * n.z; tz = 0 * n.y - 1 * n.x;
    } else {
      tx = 0 * n.z - 0 * n.y; ty = 0 * n.x - 1 * n.z; tz = 1 * n.y - 0 * n.x;
    }
    const tlen = Math.hypot(tx, ty, tz) || 1;
    tx /= tlen; ty /= tlen; tz /= tlen;
    // bitangent = n x t
    const bx = n.y * tz - n.z * ty;
    const by = n.z * tx - n.x * tz;
    const bz = n.x * ty - n.y * tx;

    const burst = this.bursts[this.burstCursor];
    this.burstCursor = (this.burstCursor + 1) % this.bursts.length;

    let maxLife = 0;
    for (let i = 0; i < PARTICLES_PER_BURST; i++) {
      if (i >= count) { burst.startTimes[i] = -9999; continue; } // deactivate leftover slots on reuse

      const theta = this.rand() * Math.PI * 2;
      const phi = this.rand() * spreadAngle;
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const ct = Math.cos(theta), st = Math.sin(theta);
      const dx = n.x * cp + tx * sp * ct + bx * sp * st;
      const dy = n.y * cp + ty * sp * ct + by * sp * st;
      const dz = n.z * cp + tz * sp * ct + bz * sp * st;

      const speed = speedMin + (speedMax - speedMin) * this.rand();
      burst.velocities[i * 3 + 0] = dx * speed;
      burst.velocities[i * 3 + 1] = dy * speed;
      burst.velocities[i * 3 + 2] = dz * speed;

      burst.startTimes[i] = now;
      const life = lifeMin + (lifeMax - lifeMin) * this.rand();
      burst.lifetimes[i] = life;
      if (life > maxLife) maxLife = life;
      burst.seeds[i] = this.rand() * 1000;
      burst.sizes[i] = sizeMin + (sizeMax - sizeMin) * this.rand();
    }

    burst.geometry.attributes.aVelocity.needsUpdate = true;
    burst.geometry.attributes.aStartTime.needsUpdate = true;
    burst.geometry.attributes.aLifetime.needsUpdate = true;
    burst.geometry.attributes.aSeed.needsUpdate = true;
    burst.geometry.attributes.aSize.needsUpdate = true;

    burst.origin = { x: origin.x, y: origin.y, z: origin.z };
    burst.birth = now;
    burst.maxLife = maxLife;
    burst.active = true;
    burst.points.visible = true;

    this.spawnFlash(origin, now, 0.4 * scale);
    this.spawnGlow(origin, n, now, 0.3 * scale);
  }

  private spawnFlash(origin: Vec3, now: number, maxScale: number): void {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.origin = { x: origin.x, y: origin.y, z: origin.z };
    f.birth = now;
    f.maxScale = maxScale;
    f.active = true;
    f.sprite.visible = true;
  }

  private spawnGlow(origin: Vec3, n: Vec3, now: number, maxScale: number): void {
    const g = this.glows[this.glowCursor];
    this.glowCursor = (this.glowCursor + 1) % this.glows.length;
    // Nudge slightly out along the normal so it sits proud of the struck surface.
    g.origin = { x: origin.x + n.x * 0.05, y: origin.y + n.y * 0.05, z: origin.z + n.z * 0.05 };
    g.birth = now;
    g.maxScale = maxScale;
    g.active = true;
    g.sprite.visible = true;
  }

  // Call every frame with the shared render clock and the camera's absolute eye position. Advances
  // the sparks' uTime, rebases every active burst/flash/glow by (origin - eye), and retires the dead.
  update(now: number, eye: Vec3): void {
    this.material.uniforms.uTime.value = now;

    for (const b of this.bursts) {
      if (!b.active) continue;
      if (now - b.birth > b.maxLife) {
        b.active = false;
        b.points.visible = false;
        continue;
      }
      b.points.position.set(b.origin.x - eye.x, b.origin.y - eye.y, b.origin.z - eye.z);
    }

    for (const f of this.flashes) {
      if (!f.active) continue;
      const t = (now - f.birth) / f.duration;
      if (t < 0 || t > 1) { f.active = false; f.sprite.visible = false; continue; }
      f.sprite.position.set(f.origin.x - eye.x, f.origin.y - eye.y, f.origin.z - eye.z);
      // Fast punch-in, fast fade — reads as an instant flash, not a glow. Opacity is held below 1 so
      // the additive flash tints the hit point rather than blowing it (and the bloom pass) to solid white.
      const s = f.maxScale * (0.3 + 0.7 * Math.min(t * 4, 1));
      f.sprite.scale.setScalar(s);
      f.sprite.material.opacity = 0.55 * (1.0 - t);
    }

    for (const g of this.glows) {
      if (!g.active) continue;
      const t = (now - g.birth) / g.duration;
      if (t < 0 || t > 1) { g.active = false; g.sprite.visible = false; continue; }
      g.sprite.position.set(g.origin.x - eye.x, g.origin.y - eye.y, g.origin.z - eye.z);
      // Blooms fast, then slowly shrinks/cools as it fades — mirrors the LUT story on the surface.
      const growT = Math.min(t / 0.15, 1);
      const s = g.maxScale * (0.4 + 0.6 * growT) * (1.0 - 0.3 * t);
      g.sprite.scale.setScalar(s);
      // Kept faint (peaks ~0.3) so the molten spot reads as a translucent heat-smudge you can see
      // through to the sparks/scene behind, not an opaque white blob.
      g.sprite.material.opacity = 0.3 * (1.0 - t) * (1.0 - t); // ease-out fade
      // White-hot -> deep red as it cools.
      const gc = 1.0 - 0.85 * t;
      const bc = 1.0 - Math.min(t * 1.5, 1);
      g.sprite.material.color.setRGB(1.0, gc, bc);
    }
  }

  dispose(): void {
    for (const b of this.bursts) { this.scene.remove(b.points); b.geometry.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.sprite); f.sprite.material.dispose(); }
    for (const g of this.glows) { this.scene.remove(g.sprite); g.sprite.material.dispose(); }
    this.material.dispose();
    this.lutTex.dispose();
    this.sparkTex.dispose();
    this.flashTex.dispose();
    this.glowTex.dispose();
  }
}
