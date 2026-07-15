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

// Enemy-death explosion — an outward SPRAY (not a solid ball): a brief white-hot central flash,
// then radial spark streaks and debris points flung outward from the center, easing out so it
// bursts fast then drifts. See combat/effects.ts and render/renderer.ts::animateExplosion. Streaks
// and debris share one set of evenly-spread directions (fibonacci sphere, deterministic — no
// per-frame RNG). Children are ordered [flash, streaks, debris] — the renderer indexes them.
export function createExplosionMesh(): THREE.Group {
  const g = new THREE.Group();

  // 0: brief central flash (small; the renderer fades it out in the first third of the burst)
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
  ));

  const N = 60;
  const dir: number[][] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229; // golden angle
    dir.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }

  // 1: spark streaks — a short radial line per direction, dim at the inner (tail) end and bright at
  // the outer (leading) end via vertex colors, so the whole thing reads as a spiky outward splash.
  const IN = 1.0, OUT = 2.6;
  const segPos = new Float32Array(N * 6);
  const segCol = new Float32Array(N * 6);
  for (let i = 0; i < N; i++) {
    const [x, y, z] = dir[i];
    segPos.set([x * IN, y * IN, z * IN, x * OUT, y * OUT, z * OUT], i * 6);
    segCol.set([1.0, 0.30, 0.06, 1.0, 0.92, 0.6], i * 6); // inner dim-orange -> outer bright
  }
  const segGeo = new THREE.BufferGeometry();
  segGeo.setAttribute('position', new THREE.BufferAttribute(segPos, 3));
  segGeo.setAttribute('color', new THREE.BufferAttribute(segCol, 3));
  g.add(new THREE.LineSegments(segGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
  })));

  // 2: debris — a bright point per direction, flung out past the streak tips
  const ptPos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) ptPos.set(dir[i], i * 3);
  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
  g.add(new THREE.Points(ptGeo, new THREE.PointsMaterial({
    color: 0xffd080, size: 2.5, sizeAttenuation: false, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false
  })));

  return g;
}

// Laser-hit spark (see combat/effects.ts) — a single small hot additive sphere, sized/faded by the
// renderer. Deliberately minimal vs the explosion: impacts are frequent and quick.
export function createImpactMesh(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false })
  );
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
        float a = smoothstep(0.5, 0.0, d);
        // mix the star's true colour toward white at the core so bright stars keep a hot centre
        vec3 c = mix(vColor, vec3(1.0), (1.0 - a) * 0.5);
        gl_FragColor = vec4(c * vBright, a);
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
