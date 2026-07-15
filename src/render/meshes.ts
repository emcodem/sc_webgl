import * as THREE from 'three';
import type { CelestialBody } from '../core/world';
import { loadBrightStars } from '../world/brightStars';
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

// Shared GLSL: hash-based 3D value noise + fBm + domain-warped turbulence, the GPU cousin of
// render/noise.ts. Used to boil the sun's photosphere and ripple its corona in real time. Sampled on
// the unit sphere (so it tiles seamlessly over the surface) and scrolled by a time uniform.
const SUN_NOISE_GLSL = `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                   mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                   mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }
    return s;
  }
`;

// The sun. Best-practice recipe for a convincing star with no textures:
//   1. an animated photosphere — domain-warped fBm noise boils across the sphere, mapped through a
//      blackbody temperature ramp (dark convection lanes -> bright granule cells) so the surface
//      churns instead of sitting flat;
//   2. physical limb darkening (the disk dims and reddens toward its edge) plus a thin hot
//      chromosphere rim, which is what actually makes it read as a glowing sphere rather than a
//      flat disk;
//   3. HDR output (colours pushed >1) so the bloom pass blooms the bright granules into real glare;
//   4. a soft additive corona rendered as a camera-facing shader billboard — a smooth exponential
//      radial falloff (no hard sprite edge) with a slow low-frequency ripple, sized just over the
//      disk so it hugs the limb.
// Materials that animate expose their `uTime` uniform via group.userData.timeUniforms; the renderer
// advances them each frame.
function createSunMesh(body: CelestialBody): THREE.Object3D {
  const group = new THREE.Group();
  group.name = body.name;
  const timeUniforms: { value: number }[] = [];

  // --- photosphere ---
  const coreMat = new THREE.ShaderMaterial({
    toneMapped: true, // let ACES roll off the HDR core
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vViewDir; varying vec3 vObj;
      void main() {
        vObj = normalize(position);
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vViewDir = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vN; varying vec3 vViewDir; varying vec3 vObj;
      ${SUN_NOISE_GLSL}
      void main() {
        vec3 p = vObj * 3.5;
        float t = uTime * 0.06;
        // domain warp two slow flows into a third sample -> churning plasma, not a static crust
        float w1 = fbm(p * 1.3 + vec3(0.0, t, 0.0));
        float w2 = fbm(p * 2.7 - vec3(t * 1.3, 0.0, t));
        float n = fbm(p + vec3(w1, w2, w1 - w2) * 1.6 + vec3(0.0, 0.0, t * 0.5));
        n = clamp(n * 1.15, 0.0, 1.0);

        // blackbody-ish ramp: cool dark downflow lanes -> orange granules -> hot yellow-white cells
        vec3 cCool = vec3(0.70, 0.16, 0.02);
        vec3 cMid  = vec3(1.00, 0.48, 0.10);
        vec3 cHot  = vec3(1.00, 0.85, 0.52);
        vec3 col = mix(cCool, cMid, smoothstep(0.30, 0.58, n));
        col = mix(col, cHot, smoothstep(0.58, 0.92, n));

        float mu = max(dot(normalize(vN), normalize(vViewDir)), 0.0); // 1 centre -> 0 limb
        float limb = 0.40 + 0.60 * pow(mu, 0.55);                     // physical limb darkening
        // keep the base disk near ~1 so granule structure stays legible; only the hottest cells
        // push past the bloom threshold and glare, rather than the whole disk saturating to white
        float bright = (0.55 + n * 0.85) * limb;
        vec3 rim = vec3(1.0, 0.33, 0.10) * pow(1.0 - mu, 4.0) * 0.91;  // thin hot chromosphere rim
        gl_FragColor = vec4(col * bright * 1.76 + rim, 1.0);           // ~30% brighter -> more bloom
      }`
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(body.radius, 96, 96), coreMat));
  timeUniforms.push(coreMat.uniforms.uTime);

  // No corona/haze billboard: a star has no atmosphere, so the extended glow it produced read as
  // one. The disk's own HDR output (hot granules + chromosphere rim, all >1) is left for the bloom
  // pass to bloom into a tight natural glare — that is the sun's only halo.
  group.userData.timeUniforms = timeUniforms;
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

// Placeholder for the Europa body (see world/celestial.ts's EUROPA) shown until the real glTF model
// (render/celestialModels.ts) finishes loading and swaps in — same split as the meteorite above.
function createEuropaPlaceholderMesh(body: CelestialBody): THREE.Object3D {
  const geo = new THREE.SphereGeometry(body.radius, 64, 64);
  texturizeSphere(geo, body.radius, { amp: body.radius * 0.02, freq: 6, base: new THREE.Color(body.color), darken: 0.7 });
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = body.name;
  return mesh;
}

export function createBodyMesh(body: CelestialBody): THREE.Object3D {
  // these branches build their own mesh — return before allocating the sphere geometry + group
  // below (the sun's is a 128^2 sphere), which they'd otherwise discard unused
  if (body.emissive) return createSunMesh(body);
  if (body.meteorite) return createMeteoritePlaceholderMesh(body);
  if (body.europa) return createEuropaPlaceholderMesh(body);

  const group = new THREE.Group();
  group.name = body.name;

  const segments = body.radius > 100_000 ? 128 : 96;
  const geo = new THREE.SphereGeometry(body.radius, segments, segments);

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

// A weapon-round tracer: a simple straight red line, PROJECTILE_LENGTH metres long, oriented in
// true 3D along the round's travel direction (see render/renderer.ts's per-projectile loop). A thin
// cylinder rather than a THREE.Line so it has real world-space thickness and stays visible at any
// distance (WebGL ignores LineBasicMaterial.linewidth > 1 on most platforms). The geometry lies
// along local +Z with the head at the local origin and the tail PROJECTILE_LENGTH behind it, so the
// renderer just points local +Z down the velocity vector each frame — no billboarding, no shader.
// The renderer also scales the cross-section up with distance so the line stays visible out to
// several km rather than shrinking to a sub-pixel (invisible) sliver. A bolt fired straight away
// from the camera foreshortens to a small dot, which is correct.
export const PROJECTILE_LENGTH = 6;
export const PROJECTILE_RADIUS = 0.16; // base half-thickness at close range (widened per-distance)

export function createProjectileMesh(color: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(PROJECTILE_RADIUS, PROJECTILE_RADIUS, PROJECTILE_LENGTH, 6, 1);
  geo.rotateX(Math.PI / 2);              // reorient the cylinder's long axis from +Y to +Z
  geo.translate(0, 0, -PROJECTILE_LENGTH / 2); // head at local origin, tail at local -Z
  // MeshBasicMaterial (unlit) pushed past 1.0 so the line clears UnrealBloomPass's threshold and
  // reads as a hot glowing red beam rather than a flat matte bar.
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) });
  return new THREE.Mesh(geo, mat);
}

// (Both enemy-death explosions and laser-hit sparks are now the GPU "hot metal" system in
// render/impactEffects.ts — ImpactEffects.explode / .trigger — not meshes built here.)

// PIP Trainer's ESP-style marker — a hollow diamond "PIP" reticle, matching the original 2D
// project's drawPipTrainerMarker (a stroked diamond, not a filled blip). Built as a flat
// picture-frame shape (outer diamond with a smaller diamond hole) rather than a THREE.Line so its
// stroke has real geometric width and stays crisp regardless of GL line-width support. It's billboarded
// to face the camera every frame in render/renderer.ts (this shape only reads as a diamond square-on).
export function createPipMarkerMesh(color = 0xffe696): THREE.Mesh {
  const outerR = 1.6;
  const innerR = 1.15;
  const outer = new THREE.Shape();
  outer.moveTo(0, outerR);
  outer.lineTo(outerR, 0);
  outer.lineTo(0, -outerR);
  outer.lineTo(-outerR, 0);
  outer.closePath();
  const hole = new THREE.Path();
  hole.moveTo(0, innerR);
  hole.lineTo(innerR, 0);
  hole.lineTo(0, -innerR);
  hole.lineTo(-innerR, 0);
  hole.closePath();
  outer.holes.push(hole);

  return new THREE.Mesh(
    new THREE.ShapeGeometry(outer),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true })
  );
}

// Starfield: a fixed, camera-anchored celestial sphere built from the real Yale Bright Star
// Catalog (see world/brightStars.ts) — true positions, per-star brightness from visual magnitude,
// and per-star colour from the catalogue's blackbody temperature. Rendered as soft round glowing
// points via a custom shader (PointsMaterial can't vary size/colour per point). Additive so they
// glow on black and feed the bloom pass.
export function createStarfield(radius = 1e7): THREE.Points {
  const stars = loadBrightStars(radius);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(stars.positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(stars.sizes, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(stars.bright, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(stars.colors, 3));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `
      attribute float aSize; attribute float aBright; attribute vec3 aColor;
      uniform float uPixelRatio; varying float vBright; varying vec3 vColor;
      void main() {
        vBright = aBright;
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }`,
    fragmentShader: `
      varying float vBright; varying vec3 vColor;
      void main() {
        float d = distance(gl_PointCoord, vec2(0.5));
        if (d > 0.5) discard;
        // no whitening toward the centre — keep the true hue across the whole disc (this is what
        // NASA's Eyes on the Solar System star shader does: only alpha falls off toward the edge,
        // colour never desaturates toward white; a punchy core comes from brightness/bloom, not tint)
        float a = pow(clamp(1.0 - 2.0 * d, 0.0, 1.0), 2.2);
        gl_FragColor = vec4(vColor * vBright, a);
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
