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

const MAX_BURSTS = 32;          // concurrent spark bursts (ring-buffer reused when exceeded). A ship
                                // death fires several at once, so this is a bit larger than for impacts.
const PARTICLES_PER_BURST = 48; // capacity of each burst's buffer
const MAX_FLASHES = 12;
const MAX_GLOWS = 24;
const MAX_FIREBALLS = 12;       // concurrent death-fireball billboards (2-3 per ship explosion)

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

// Death-fireball sprite: a hot white core bleeding out through yellow/orange to a soft transparent
// edge. Softer and rounder than the impact glow so a big one reads as a volumetric ball of flame
// rather than a flat disc. Colour over life is animated on the sprite material (white->orange->red).
function createFireballSpriteTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.18, 'rgba(255,240,190,0.95)');
  grad.addColorStop(0.42, 'rgba(255,170,70,0.65)');
  grad.addColorStop(0.72, 'rgba(220,70,20,0.28)');
  grad.addColorStop(1.0, 'rgba(120,20,0,0.0)');
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
  private fireballs: Billboard[] = [];
  private burstCursor = 0;
  private flashCursor = 0;
  private glowCursor = 0;
  private fireballCursor = 0;

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
  private fireballTex: THREE.CanvasTexture;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.lutTex = createBlackbodyLUT();
    this.sparkTex = createSparkSpriteTexture();
    this.flashTex = createSparkSpriteTexture(64);
    this.glowTex = createGlowSpriteTexture(128);
    this.fireballTex = createFireballSpriteTexture(256);

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
    for (let i = 0; i < MAX_FIREBALLS; i++) this.fireballs.push(this.buildBillboard(this.fireballTex, 1.6));
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
    const frame = this.computeFrame(normal);
    this.fillBurst(origin, frame, now, opts);
    const scale = opts.scale ?? 1.0;
    this.spawnFlash(origin, now, 0.4 * scale);
    this.spawnGlow(origin, frame.n, now, 0.3 * scale);
  }

  // Enemy-ship death — a big, long-lived version of the same hot-metal look: a hard white flash, a
  // swelling cooling FIREBALL (2 overlapping billboards for volume), and a full-sphere spray of
  // cooling sparks fired as several overlapping bursts so it reads as chaotic shrapnel, not one tidy
  // shell. Like trigger(), owns the whole ~2s visual life from here; the sim just drops the trigger.
  explode(origin: Vec3, now: number, scale = 1.0): void {
    // Full 4π spark spray. No surface normal — sparks fly every direction; fire several overlapping
    // bursts (each capped at PARTICLES_PER_BURST) for both particle count and shape variety. High
    // speed spread + long life range means a few fast sparks streak far while most cool close in.
    const sparkOpts: ImpactOptions = {
      count: PARTICLES_PER_BURST,
      scale,
      speedMin: 10, speedMax: 78,
      spreadAngle: Math.PI, // whole sphere
      lifeMin: 0.55, lifeMax: 2.0,
      sizeMin: 3.5, sizeMax: 8.0,
    };
    for (let i = 0; i < 3; i++) {
      this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
      this.fillBurst(origin, this.computeFrame(undefined), now, sparkOpts);
    }

    // Hard, brief white flash at the instant of detonation (bigger + slightly longer than an impact).
    this.spawnFlash(origin, now, 7.0 * scale, 0.16);
    // Fireball body: a large slow ball plus a hotter inner one, both expanding and cooling. The two
    // durations/scales staggered so the core burns out first and the outer smoke-glow lingers.
    this.spawnFireball(origin, now, 14.0 * scale, 1.7);
    this.spawnFireball(origin, now, 8.0 * scale, 1.1);
  }

  // Orthonormal frame around a surface normal (fall back to +Y outward if none supplied). The spray
  // cone is built in this frame; for a full-sphere spread (explosions) the axis is irrelevant.
  private computeFrame(normal?: Vec3): { n: Vec3; t: Vec3; b: Vec3 } {
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
    const b = { x: n.y * tz - n.z * ty, y: n.z * tx - n.x * tz, z: n.x * ty - n.y * tx };
    return { n, t: { x: tx, y: ty, z: tz }, b };
  }

  // Fill the next ring-buffer spark burst from `opts`, born at `origin` and sprayed into `frame`.
  private fillBurst(origin: Vec3, frame: { n: Vec3; t: Vec3; b: Vec3 }, now: number, opts: ImpactOptions): void {
    const scale = opts.scale ?? 1.0;
    const count = Math.min(opts.count ?? 36, PARTICLES_PER_BURST);
    const speedMin = (opts.speedMin ?? 6.0) * scale;
    const speedMax = (opts.speedMax ?? 26.0) * scale;
    const spreadAngle = opts.spreadAngle ?? Math.PI * 0.42; // ~76deg hammer-strike spray
    const lifeMin = opts.lifeMin ?? 0.22;
    const lifeMax = opts.lifeMax ?? 0.75;
    const sizeMin = (opts.sizeMin ?? 3.0) * scale;
    const sizeMax = (opts.sizeMax ?? 7.0) * scale;
    const { n, t, b } = frame;

    const burst = this.bursts[this.burstCursor];
    this.burstCursor = (this.burstCursor + 1) % this.bursts.length;

    let maxLife = 0;
    for (let i = 0; i < PARTICLES_PER_BURST; i++) {
      if (i >= count) { burst.startTimes[i] = -9999; continue; } // deactivate leftover slots on reuse

      const theta = this.rand() * Math.PI * 2;
      const phi = this.rand() * spreadAngle;
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const ct = Math.cos(theta), st = Math.sin(theta);
      const dx = n.x * cp + t.x * sp * ct + b.x * sp * st;
      const dy = n.y * cp + t.y * sp * ct + b.y * sp * st;
      const dz = n.z * cp + t.z * sp * ct + b.z * sp * st;

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
  }

  private spawnFlash(origin: Vec3, now: number, maxScale: number, duration?: number): void {
    const f = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    f.origin = { x: origin.x, y: origin.y, z: origin.z };
    f.birth = now;
    f.maxScale = maxScale;
    if (duration !== undefined) f.duration = duration; // explosions punch a bigger, slightly longer flash
    f.active = true;
    f.sprite.visible = true;
  }

  // A cooling death-fireball billboard (see explode + the fireballs update loop). `duration` lets a
  // single explosion stack a short hot core over a longer smoky outer ball.
  private spawnFireball(origin: Vec3, now: number, maxScale: number, duration: number): void {
    const fb = this.fireballs[this.fireballCursor];
    this.fireballCursor = (this.fireballCursor + 1) % this.fireballs.length;
    fb.origin = { x: origin.x, y: origin.y, z: origin.z };
    fb.birth = now;
    fb.maxScale = maxScale;
    fb.duration = duration;
    fb.sprite.material.color.setRGB(1, 1, 1);
    fb.active = true;
    fb.sprite.visible = true;
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

    for (const fb of this.fireballs) {
      if (!fb.active) continue;
      const t = (now - fb.birth) / fb.duration;
      if (t < 0 || t > 1) { fb.active = false; fb.sprite.visible = false; continue; }
      fb.sprite.position.set(fb.origin.x - eye.x, fb.origin.y - eye.y, fb.origin.z - eye.z);
      // Swells fast then keeps expanding slowly (ease-out) over its whole life, like a real fireball
      // ballooning out and cooling — never shrinks.
      const ease = 1 - (1 - t) * (1 - t);
      fb.sprite.scale.setScalar(fb.maxScale * (0.3 + 0.9 * ease));
      // Punch in over the first ~6% of life, then an ease-out fade for the long lingering tail.
      const inT = Math.min(t / 0.06, 1);
      fb.sprite.material.opacity = 0.9 * inT * (1 - t) * (1 - t);
      // White-hot core -> orange -> deep red as it cools (green drops, then blue).
      const gc = 1.0 - 0.7 * Math.min(t * 1.2, 1);
      const bc = 1.0 - Math.min(t * 2.2, 1);
      fb.sprite.material.color.setRGB(1.0, Math.max(gc, 0), Math.max(bc, 0));
    }
  }

  dispose(): void {
    for (const b of this.bursts) { this.scene.remove(b.points); b.geometry.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.sprite); f.sprite.material.dispose(); }
    for (const g of this.glows) { this.scene.remove(g.sprite); g.sprite.material.dispose(); }
    for (const fb of this.fireballs) { this.scene.remove(fb.sprite); fb.sprite.material.dispose(); }
    this.material.dispose();
    this.lutTex.dispose();
    this.sparkTex.dispose();
    this.flashTex.dispose();
    this.glowTex.dispose();
    this.fireballTex.dispose();
  }
}
