import * as THREE from 'three';
import type { CelestialBody } from '../core/world';
import { fbm } from './noise';

// ---------- Mesh factories ----------
// Procedural, asset-free surface detail: bodies get noise displacement + colour mottling so they
// read as real rocky/planetary surfaces rather than flat billiard balls, plus a Fresnel atmosphere
// rim. Real glTF models can replace these later without touching the renderer.

// Displace a sphere's vertices along their radius by fBm noise and tint per-vertex, giving craggy
// terrain + surface mottling. `amp` is metres of relief; kept small for walkable bodies so the
// visual surface stays close to the collision sphere (see characterController).
function texturizeSphere(
  geo: THREE.BufferGeometry,
  radius: number,
  opts: { amp: number; freq: number; base: THREE.Color; darken: number }
): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = x / radius, ny = y / radius, nz = z / radius;

    // relief displacement
    const h = fbm(nx * opts.freq + 11.3, ny * opts.freq + 4.7, nz * opts.freq + 19.1);
    const newLen = radius + (h - 0.5) * 2 * opts.amp;
    pos.setXYZ(i, nx * newLen, ny * newLen, nz * newLen);

    // colour mottling from a second, finer noise field
    const m = fbm(nx * opts.freq * 2.3 - 5.1, ny * opts.freq * 2.3 + 8.9, nz * opts.freq * 2.3 - 2.2);
    const shade = 1 - opts.darken * (0.5 - m); // brighten/darken around the base
    c.copy(opts.base).multiplyScalar(THREE.MathUtils.clamp(shade, 0.55, 1.25));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
}

// Fresnel rim glow shell (a slightly larger sphere, additive, brightest at the limb) — a cheap
// convincing atmosphere. Rendered camera-relative like everything else, so viewDir is toward the
// GL origin where the camera sits.
function atmosphereShell(radius: number, color: number, power: number, opacity: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uPower: { value: power },
      uOpacity: { value: opacity }
    },
    vertexShader: `
      varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uPower; uniform float uOpacity;
      varying vec3 vNormalW; varying vec3 vPosW;
      void main() {
        vec3 viewDir = normalize(cameraPosition - vPosW);
        float f = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), uPower);
        gl_FragColor = vec4(uColor, f * uOpacity);
      }`
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 48), mat);
}

// Canvas-generated radial gradient, used for the sun's corona billboards (asset-free).
function makeRadialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [off, color] of stops) g.addColorStop(off, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The sun: a limb-brightened core whose shader outputs HDR values (>1) so the bloom pass turns it
// into a radiant glow with filmic highlight rolloff, wrapped in two camera-facing corona billboards
// (hot white -> yellow -> orange -> transparent) for the extended glow and outer haze.
function createSunMesh(body: CelestialBody): THREE.Object3D {
  const group = new THREE.Group();
  group.name = body.name;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius, 64, 64),
    new THREE.ShaderMaterial({
      toneMapped: true, // let ACES roll off the HDR core
      vertexShader: `
        varying vec3 vN; varying vec3 vViewDir;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vN; varying vec3 vViewDir;
        void main() {
          float mu = max(dot(normalize(vN), normalize(vViewDir)), 0.0); // 1 center -> 0 limb
          // white-hot centre easing to a warm orange limb, with a bright rim halo
          vec3 col = mix(vec3(1.0, 0.78, 0.42), vec3(1.0, 0.96, 0.88), mu);
          float intensity = 1.6 + pow(1.0 - mu, 3.0) * 3.0;
          gl_FragColor = vec4(col * intensity, 1.0);
        }`
    })
  );
  group.add(core);

  const corona = (scale: number, tint: number, stops: [number, string][]) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeRadialTexture(stops),
      color: tint,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    }));
    sp.scale.set(body.radius * scale, body.radius * scale, 1);
    return sp;
  };

  // inner corona: tight, bright, warm
  group.add(corona(5, 0xffffff, [
    [0.0, 'rgba(255,246,225,0.95)'],
    [0.22, 'rgba(255,205,120,0.55)'],
    [0.55, 'rgba(255,140,45,0.15)'],
    [1.0, 'rgba(255,120,30,0.0)']
  ]));
  // outer haze: broad, faint
  group.add(corona(11, 0xffffff, [
    [0.0, 'rgba(255,210,150,0.3)'],
    [0.4, 'rgba(255,150,70,0.1)'],
    [1.0, 'rgba(255,120,40,0.0)']
  ]));

  return group;
}

// Placeholder for the meteorite body (see world/celestial.ts's METEORITE) shown until the real
// glTF scan (render/celestialModels.ts) finishes loading and swaps in — same
// placeholder-then-swap split as createShipMesh's role for AI drones before the "Arrow" model
// resolves. A lumpy, noise-displaced icosahedron reads as an irregular rock at a glance rather
// than the smooth sphere a plain SphereGeometry would.
function createMeteoritePlaceholderMesh(body: CelestialBody): THREE.Object3D {
  const geo = new THREE.IcosahedronGeometry(body.radius, 2);
  texturizeSphere(geo, body.radius, { amp: body.radius * 0.25, freq: 2.5, base: new THREE.Color(body.color), darken: 0.5 });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = body.name;
  return mesh;
}

export function createBodyMesh(body: CelestialBody): THREE.Object3D {
  const group = new THREE.Group();
  group.name = body.name;

  const segments = body.radius > 100_000 ? 128 : 96;
  const geo = new THREE.SphereGeometry(body.radius, segments, segments);

  if (body.emissive) return createSunMesh(body);
  if (body.meteorite) return createMeteoritePlaceholderMesh(body);

  // rocky/planetary body: displaced + mottled, lit standard material
  const walkable = body.walkable;
  texturizeSphere(geo, body.radius, {
    amp: walkable ? body.radius * 0.008 : body.radius * 0.02, // small for walkables (keeps collision honest)
    freq: walkable ? 3.5 : 6,
    base: new THREE.Color(body.color),
    darken: 0.7
  });
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.0
  });
  group.add(new THREE.Mesh(geo, mat));

  if (body.atmosphere !== undefined) {
    group.add(atmosphereShell(body.radius * 1.025, body.atmosphere, 3.0, walkable ? 0.5 : 0.9));
  }
  return group;
}

// A rough Aegis-Gladius-ish fighter (~17.5 x 21 x 5.5 m). Local axes: forward +Z, right +X, up +Y.
// `accentColor` distinguishes the nose/engine-glow tint of the player's own (invisible-from-cockpit)
// ship from an AI opponent's, so a dogfight reads at a glance.
export function createShipMesh(accentColor = 0xff7a45): THREE.Object3D {
  const group = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.55, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.55, metalness: 0.35 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 11), hull);
  body.position.z = -1;
  group.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6, 12), accent);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 7.5;
  group.add(nose);

  const wingGeo = new THREE.BoxGeometry(9, 0.4, 4);
  const wingL = new THREE.Mesh(wingGeo, hull);
  wingL.position.set(-5, 0, -1.5); wingL.rotation.z = 0.08; group.add(wingL);
  const wingR = new THREE.Mesh(wingGeo, hull);
  wingR.position.set(5, 0, -1.5); wingR.rotation.z = -0.08; group.add(wingR);

  const finGeo = new THREE.BoxGeometry(0.3, 2.5, 3);
  const finL = new THREE.Mesh(finGeo, hull); finL.position.set(-1.3, 1.4, -6); group.add(finL);
  const finR = new THREE.Mesh(finGeo, hull); finR.position.set(1.3, 1.4, -6); group.add(finR);

  // engine glow (bright -> blooms)
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x9fe6ff })
  );
  glow.position.z = -6.6;
  group.add(glow);

  return group;
}

// A radial "hot core" texture for the bolt's head glow, matching the streak shader's own
// core-white -> mid-orange -> outer-red gradient (see LASER_FRAGMENT_SHADER) rather than a flat
// single-tone dot — a tight bright pinpoint bleeding out into color, same shape family as the
// sun's corona billboards above, so a dead-ahead shot (where the head sprite carries the whole
// look — see the projectile loop's doc comment in renderer.ts) still reads as a hot energy spark
// rather than a uniform flat-colored ball.
let dotTexture: THREE.CanvasTexture | null = null;
function getDotTexture(): THREE.CanvasTexture {
  if (dotTexture) return dotTexture;
  dotTexture = makeRadialTexture([
    [0.0, 'rgba(255,250,235,1)'],
    [0.16, 'rgba(255,225,170,0.95)'],
    [0.4, 'rgba(255,120,40,0.75)'],
    [0.7, 'rgba(200,20,10,0.35)'],
    [1.0, 'rgba(160,0,0,0)']
  ]);
  return dotTexture;
}

// Laser-bolt streak shader: a volumetric-looking energy streak rather than a flat colored quad —
// a narrow white-hot core (only near the head; it tapers away toward the tail, per a real energy
// weapon's motion blur) inside a saturated orange mid-glow inside a soft red outer halo, with an
// exponential transverse falloff (pow(1-dist,3)) and a longitudinal fade from a blunt bright head
// to a fully transparent tail. `vUv.x` is the transverse (width) axis, `vUv.y` the longitudinal
// (length) axis with 0 = tail, 1 = head (see createProjectileMesh's geometry setup below).
// #include <logdepthbuf_*> chunks are required here — the renderer is constructed with
// logarithmicDepthBuffer: true (see renderer.ts; needed to show a 20m ship and an 8,000,000m sun
// in the same frame), and three.js's built-in materials get that handling injected automatically,
// but a raw THREE.ShaderMaterial does not. Without it this mesh depth-tested as if the buffer were
// linear and simply never passed, rendering nothing despite otherwise-correct geometry/material
// state (confirmed by dumping the live scene graph — position, quaternion, and vertex data all
// checked out fine while the mesh stayed invisible).
const LASER_VERTEX_SHADER = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;
const LASER_FRAGMENT_SHADER = `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec2 vUv;
  uniform vec3 uTint;
  void main() {
    float centerDist = abs(vUv.x - 0.5) * 2.0; // 0 at the beam's center axis -> 1 at its edge
    float v = vUv.y;                            // 0 at the tail -> 1 at the head

    vec3 coreColor = vec3(1.0, 0.95, 0.8);
    vec3 midColor = vec3(1.0, 0.25, 0.0) * uTint;
    vec3 outerColor = vec3(0.8, 0.0, 0.0) * uTint;

    // smoothstep's edges must ascend (edge0 < edge1) — GLSL leaves edge0 >= edge1 undefined, which
    // silently rendered as nothing at all under this project's swiftshader/ANGLE test target — so
    // an inverted falloff is built as 1.0 - smoothstep(low, high, x) rather than swapping the edges.
    float coreBand = (1.0 - smoothstep(0.0, 0.16, centerDist)) * smoothstep(0.1, 0.7, v);
    float midBand = 1.0 - smoothstep(0.05, 0.6, centerDist);

    vec3 color = mix(outerColor, midColor, midBand);
    color = mix(color, coreColor, coreBand);

    float transverseFalloff = pow(max(0.0, 1.0 - centerDist), 3.0);
    float longitudinalFalloff = smoothstep(0.0, 0.3, v); // fades in from the tail
    float alpha = transverseFalloff * longitudinalFalloff;

    // pushed past 1.0 so the core clears UnrealBloomPass's luminance threshold
    gl_FragColor = vec4(color * (1.0 + coreBand * 1.8), alpha);
    #include <logdepthbuf_fragment>
  }
`;

// Additive blending via EXPLICIT blend factors (SRC_ALPHA, ONE) rather than THREE.AdditiveBlending
// (which defaults to (ONE, ONE) and would add full-strength color even where alpha has faded to
// near-0) — this is what makes the exponential transverse/longitudinal falloff above actually show
// up as a soft feathered glow instead of a hard-edged additive quad.
function createLaserStreakMaterial(tint: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTint: { value: new THREE.Color(tint) } },
    vertexShader: LASER_VERTEX_SHADER,
    fragmentShader: LASER_FRAGMENT_SHADER,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    side: THREE.DoubleSide
  });
}

// The streak's fixed local length before per-frame scaling — see render/renderer.ts's
// per-projectile loop, which rebuilds this mesh's orientation and scale.y every frame as a
// screen-space "stretched billboard" rather than a fixed 3D-oriented quad.
export const PROJECTILE_STREAK_LENGTH = 9;

// A weapon-round tracer: a camera-facing sprite at the head (a blunt, always-visible glow) plus a
// separate streak quad carrying the gradient shader above. The streak is NOT oriented like a
// normal 3D object — a plane whose length runs along the actual 3D travel direction goes edge-on
// and vanishes whenever that direction is close to the camera's own view direction, which is
// exactly what happens for the single most common case in this game: the player's own fire,
// travelling almost straight away from the camera that's aiming it. Real tracers/lasers in every
// engine solve this the same way — a "stretched billboard": the streak always fully faces the
// camera (like the sprite), and its apparent LENGTH/rotation come from projecting the 3D tail
// offset onto the camera's own (right, up) plane, so it correctly shows a full streak when viewed
// from the side and collapses toward the head sprite's small glow when viewed dead-on (which is
// also physically correct — something moving directly away from you doesn't reveal its length).
// Local geometry: width along local X, head at local Y=0 (unscaled), tail at local Y=-1 (scaled by
// mesh.scale.y each frame) — a plain, un-rotated PlaneGeometry already has this shape.
export function createProjectileMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  const headSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getDotTexture(),
    color: new THREE.Color(1, 0.95, 0.8).multiplyScalar(2.6),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  headSprite.scale.setScalar(1.1);
  group.add(headSprite);

  const streakGeo = new THREE.PlaneGeometry(0.7, 1);
  streakGeo.translate(0, -0.5, 0); // head (v=1, bright) at local y=0, tail (v=0) at local y=-1
  const streak = new THREE.Mesh(streakGeo, createLaserStreakMaterial(color));
  group.add(streak);

  return group;
}

// PIP Trainer's ESP-style marker — a small bright glow sphere, same "plain MeshBasicMaterial at a
// near-white/bright tint reads as HDR for the bloom pass" trick as the ship's engine glow and the
// projectile tracer above. See combat/pipTrainer.ts and render/renderer.ts's per-frame use.
export function createPipMarkerMesh(color = 0x9fe6ff): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 12, 12),
    new THREE.MeshBasicMaterial({ color })
  );
}

// Starfield: a fixed, camera-anchored celestial sphere of soft round glowing points with varied
// size and brightness (a custom shader — PointsMaterial can't vary per-point). Additive so they
// glow on black and feed the bloom pass.
export function createStarfield(count = 5000, radius = 1e7): THREE.Points {
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const bright = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    positions[i * 3] = radius * r * Math.cos(theta);
    positions[i * 3 + 1] = radius * u;
    positions[i * 3 + 2] = radius * r * Math.sin(theta);
    // most stars small/faint, a few large/bright
    const t = Math.random();
    sizes[i] = 1.2 + t * t * 4.5;
    bright[i] = 0.35 + Math.random() * 0.65;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `
      attribute float aSize; attribute float aBright;
      uniform float uPixelRatio; varying float vBright;
      void main() {
        vBright = aBright;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }`,
    fragmentShader: `
      varying float vBright;
      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.82, 0.9, 0.98) * vBright, a);
      }`
  });
  return new THREE.Points(geo, mat);
}

// SC-style ambient dust — ported from the original project's render/render.ts::drawSpaceDust: a
// small field of world-fixed motes wrapped tightly around the ship, invisible at a standstill and
// stretching into snow-like streaks as speed rises. This is the primary moment-to-moment visual
// cue for how hard the ship is accelerating/braking — with celestial bodies millions of metres away
// (see world/celestial.ts) there's essentially no other parallax reference at flight speeds, so
// without this the ship's actual (unchanged) acceleration/deceleration reads as sluggish or absent.
//
// `bases` are arbitrary random seeds, not real world coordinates — render/renderer.ts's per-frame
// update wraps each one against the ship's current absolute position into a bounded offset and
// renders that directly as the camera-relative position (this scene is always rendered camera-
// relative — see the floating-origin note in renderer.ts — and while piloting the camera sits
// exactly at the ship's position, so the wrapped offset from the ship IS the render position,
// with no separate eye-subtraction step needed).
export interface SpaceDust {
  mesh: THREE.LineSegments;
  bases: { x: number; y: number; z: number }[];
  field: number;
}

export function createSpaceDust(count = 70, field = 130): SpaceDust {
  const bases: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    bases.push({
      x: (Math.random() - 0.5) * field * 2,
      y: (Math.random() - 0.5) * field * 2,
      z: (Math.random() - 0.5) * field * 2
    });
  }

  const geo = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3);
  const alphas = new THREE.BufferAttribute(new Float32Array(count * 2), 1);
  positions.setUsage(THREE.DynamicDrawUsage);
  alphas.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', positions);
  geo.setAttribute('aAlpha', alphas);

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aAlpha; varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main() { gl_FragColor = vec4(0.78, 0.88, 1.0, vAlpha); }`
  });

  const mesh = new THREE.LineSegments(geo, mat);
  mesh.frustumCulled = false; // positions are rewritten every frame around the camera; a static
                               // bounding sphere would risk incorrect culling
  return { mesh, bases, field };
}
