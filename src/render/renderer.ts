import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { World, CelestialBody, EnemyShip } from '../core/world';
import type { Vec3 } from '../core/types';
import type { FlightGate } from '../scenarios/types';
import { ENEMY_EXPLOSION_DURATION } from '../scenarios/runtime';
import { computeAxes } from '../math/quaternion';
import { add, cross, dot, normalize, scale as vecScale } from '../math/vec';
import { footEye } from '../physics/characterController';
import { SUN } from '../world/celestial';
import {
  createBodyMesh, createPipMarkerMesh, createProjectileMesh, createShipMesh, createSpaceDust, createStarfield,
  PROJECTILE_STREAK_LENGTH, type SpaceDust
} from './meshes';
import { setCameraBasis, setObjectBasis } from './camera';
import { cloneArrow, loadArrowTemplate } from './shipModels';
import { loadMeteoriteField, loadMeteoriteTemplate } from './celestialModels';

// Player and enemy tracers share one look — a saturated laser red — so a dogfight's incoming vs.
// outgoing fire reads as the same weapon type; only owner-based hit detection tells them apart.
const LASER_COLOR = 0xff2a2a;

// ============================================================================================
// three.js render layer. This is the ONLY module that knows about the GPU, and the only place the
// floating origin is applied: every frame we compute the camera's absolute world position (the
// pilot's cockpit seat, or the walking character's eye), then render everything camera-relative by
// subtracting that position. The camera itself stays pinned at the GL origin and only rotates.
//
// A logarithmic depth buffer lets a single camera show both a 20 m ship in the foreground and a
// sun 8 million metres away without z-fighting.
// ============================================================================================

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private bodyMeshes = new Map<string, THREE.Object3D>();
  private shipMesh: THREE.Object3D;
  private enemyMeshes = new Map<EnemyShip, THREE.Object3D>();
  private currentEnemyList: EnemyShip[] | null = null;
  private arrowTemplate: THREE.Object3D | null = null;
  private projectilePool: THREE.Object3D[] = [];
  private gateMeshes: THREE.Mesh[] = [];
  private currentGatePath: FlightGate[] | null = null;
  private rangeBubbleMesh: THREE.Mesh | null = null;
  private explosionPool: THREE.Mesh[] = [];
  private pipMarkerMesh: THREE.Mesh | null = null;
  private starfield: THREE.Points;
  private spaceDust: SpaceDust;
  private meteoriteFieldMesh: THREE.InstancedMesh | null = null;
  private meteoriteFieldCenter: Vec3 | null = null;
  private sunLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, logarithmicDepthBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // filmic tone mapping + sRGB output (via OutputPass at the end of the composer) turns the flat
    // clamped look into something with real highlight rolloff.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070a);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1e9);
    this.camera.position.set(0, 0, 0);

    // starfield — camera-anchored celestial sphere (never translates)
    this.starfield = createStarfield();
    this.scene.add(this.starfield);

    // speed-reactive ambient dust (see createSpaceDust's doc comment) — piloting-only, updated
    // per frame in render() below
    this.spaceDust = createSpaceDust();
    this.scene.add(this.spaceDust.mesh);

    // celestial bodies
    for (const body of world.bodies) {
      const mesh = createBodyMesh(body);
      this.bodyMeshes.set(body.name, mesh);
      this.scene.add(mesh);
    }

    // real meteorite scan (see render/celestialModels.ts) loads in async — the meteorite body
    // renders as the procedural placeholder rock (createBodyMesh's meteorite branch) until it
    // resolves, then swaps onto the real model, same split as the Arrow enemy model below.
    const meteoriteBody = world.bodies.find((b) => b.meteorite);
    if (meteoriteBody) {
      loadMeteoriteTemplate().then((model) => {
        const old = this.bodyMeshes.get(meteoriteBody.name);
        if (old) this.scene.remove(old);
        this.bodyMeshes.set(meteoriteBody.name, model);
        this.scene.add(model);
      });

      // a scattered field of smaller copies of the same rock around it (see
      // celestialModels.ts::loadMeteoriteField's doc comment on how 80 instances cost about as
      // much as 1) — positioned every frame in render() below, same floating-origin convention as
      // every other object in the scene.
      this.meteoriteFieldCenter = meteoriteBody.pos;
      loadMeteoriteField().then((field) => {
        this.meteoriteFieldMesh = field;
        this.scene.add(field);
      });
    }

    // ship — hidden while piloting (no cockpit yet; the camera sits at the ship origin), shown when
    // the player is on foot so the parked ship is visible.
    this.shipMesh = createShipMesh();
    this.shipMesh.visible = false;
    this.scene.add(this.shipMesh);

    // AI opponents — see the rebuildEnemyMeshes() call at the top of render(): the mesh set is
    // (re)built there, not here, since a scenario can swap world.enemies to a different array with
    // a different length at any time (see scenarios/runtime.ts::startScenario).
    this.rebuildEnemyMeshes(world.enemies);

    // "Arrow" drone model (see shipModels.ts) loads in async — enemies render as the procedural
    // placeholder ship until it resolves, then get rebuilt onto the real model. Cached at module
    // level, so this is a no-op fetch/decode after the very first Renderer in the page's lifetime.
    loadArrowTemplate().then((template) => {
      this.arrowTemplate = template;
      this.rebuildEnemyMeshes(this.currentEnemyList ?? world.enemies);
    });

    // lighting: a strong warm directional light from the sun, a dim cool hemisphere fill so
    // shadowed sides read as starlit rather than pure black, a soft ambient floor (metals with no
    // env map have no diffuse response at all, so they need *some* non-directional light or their
    // unlit faces go true black), and a "headlight" that always shines in the direction the camera
    // is looking (see its per-frame update in render()) so whatever ship you're looking at — an
    // opponent on the far side of the sun from you, say — always has its camera-facing side lit
    // regardless of where the sun happens to be.
    this.sunLight = new THREE.DirectionalLight(0xfff2d8, 2.6);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.scene.add(new THREE.HemisphereLight(0x3d5a7a, 0x14161e, 0.65));
    this.scene.add(new THREE.AmbientLight(0x404652, 0.35));
    this.fillLight = new THREE.DirectionalLight(0xcfe0ff, 1.1);
    this.scene.add(this.fillLight);
    this.scene.add(this.fillLight.target);

    // post: bloom (only bright things — sun, engine glow, bright stars) + tone-mapping output pass
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.6,  // strength
      0.5,  // radius
      0.85  // luminance threshold — keep it high so only genuinely bright emitters glow
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Absolute world position + orientation basis of the camera this frame, per control mode.
  private cameraView(world: World): { eye: Vec3; forward: Vec3; up: Vec3 } {
    const p = world.player;
    if (p.mode === 'pilot') {
      const axes = computeAxes(p.ship.quat);
      return { eye: p.ship.pos, forward: axes.forward, up: axes.up };
    }
    const eye = footEye(p);
    return { eye: eye.pos, forward: eye.forward, up: eye.up };
  }

  render(world: World): void {
    const view = this.cameraView(world);
    const eye = view.eye;

    setCameraBasis(this.camera, view.forward, view.up);

    // floating origin: place every object relative to the camera's absolute position
    for (const body of world.bodies) {
      const mesh = this.bodyMeshes.get(body.name);
      if (mesh) mesh.position.set(body.pos.x - eye.x, body.pos.y - eye.y, body.pos.z - eye.z);
    }

    if (this.meteoriteFieldMesh && this.meteoriteFieldCenter) {
      const c = this.meteoriteFieldCenter;
      this.meteoriteFieldMesh.position.set(c.x - eye.x, c.y - eye.y, c.z - eye.z);
    }

    const ship = world.player.ship;
    this.spaceDust.mesh.visible = world.player.mode === 'pilot';
    if (this.spaceDust.mesh.visible) this.updateSpaceDust(ship.pos, ship.vel);

    this.shipMesh.visible = world.player.mode === 'onfoot';
    if (this.shipMesh.visible) {
      this.shipMesh.position.set(ship.pos.x - eye.x, ship.pos.y - eye.y, ship.pos.z - eye.z);
      const axes = computeAxes(ship.quat);
      setObjectBasis(this.shipMesh, axes.forward, axes.up);
    }

    // AI opponents — rebuild the mesh set only when world.enemies is a different array (a scenario
    // starting/switching, or Restart/Free-Flight via resetWorld) — orbiter/drifter respawn-in-place
    // mutates the same array/objects, so this correctly does NOT rebuild on every kill/respawn.
    if (world.enemies !== this.currentEnemyList) this.rebuildEnemyMeshes(world.enemies);

    // hidden while destroyed and waiting to respawn (respawnTimer > 0) or dead (health <= 0) — a
    // scenario enemy that's simply destroyed (no respawn) never sets respawnTimer, so the health
    // check is required too, not just the timer.
    world.enemies.forEach((enemy) => {
      const mesh = this.enemyMeshes.get(enemy);
      if (!mesh) return;
      const alive = enemy.respawnTimer <= 0 && enemy.health.points > 0;
      mesh.visible = alive;
      if (!alive) return;
      mesh.position.set(enemy.pos.x - eye.x, enemy.pos.y - eye.y, enemy.pos.z - eye.z);
      const axes = computeAxes(enemy.quat);
      setObjectBasis(mesh, axes.forward, axes.up);
    });

    // weapon-round tracers — a pooled mesh per live projectile. The streak (mesh.children[1] — see
    // createProjectileMesh) is a screen-space "stretched billboard": it always fully faces the
    // camera, and its apparent length/rotation come from projecting the 3D tail offset onto the
    // camera's own (right, up) plane rather than from any 3D orientation of the quad itself. A
    // plane oriented along the true 3D travel direction goes edge-on and vanishes whenever that
    // direction is close to the camera's own view direction — which is exactly the player's own
    // fire, travelling almost straight away from the camera that's aiming it, so a naive "orient
    // toward the camera" billboard still went invisible for the single most common case in this
    // game. camRight/camUp are the same for every projectile this frame, computed once from the
    // camera's own basis (matches render/camera.ts::setCameraBasis's construction exactly).
    const camRight = normalize(cross(view.forward, view.up));
    const camUp = normalize(cross(camRight, view.forward));
    world.projectiles.forEach((p, i) => {
      const mesh = this.projectileMesh(i);
      mesh.visible = true;
      mesh.position.set(p.pos.x - eye.x, p.pos.y - eye.y, p.pos.z - eye.z);

      const dir = normalize(p.vel);
      const tailOffset = vecScale(dir, -PROJECTILE_STREAK_LENGTH);
      const dx = dot(tailOffset, camRight), dy = dot(tailOffset, camUp);
      // On-screen beam length = the 3D tail offset projected onto the camera plane. While piloting,
      // the ship's own forward axis IS the camera's forward axis, so the player's own fire
      // (dir ~= view.forward) projects to ~0 here — that's the single most common case, not a rare
      // edge. There is NO honest 2D direction for a bolt flying straight away from you, so rather
      // than invent one (an earlier version floored the length and fell back to camUp, which drew
      // every boresighted shot as an upright vertical "candle" 90deg off the true into-screen travel
      // line) we simply hide the streak below STREAK_MIN and let the head spark alone carry a
      // dead-ahead shot — which is also what you'd actually see. Above the threshold: a proper long
      // gradient beam for anything with real screen-space travel (enemy fire, your own shots once
      // you're off-boresight).
      const projected = Math.hypot(dx, dy);
      const STREAK_MIN = 1.5;
      const streak = mesh.children[1];
      if (projected > STREAK_MIN) {
        streak.visible = true;
        const screenDir = normalize(add(vecScale(camRight, dx), vecScale(camUp, dy)));
        setObjectBasis(streak, view.forward, screenDir);
        streak.scale.set(1, projected, 1);
      } else {
        streak.visible = false;
      }

      // Head glow: a small spark that grows modestly as the beam lengthens on screen, so it reads
      // as the hot tip of a tracer rather than a fixed round ball dominating a short/collapsed beam
      // (the old fixed 1.1 scale looked like a "tennisball on the tip" for dead-ahead fire). Ranges
      // ~0.5 dead-on to ~1.0 fully side-on.
      const headSprite = mesh.children[0];
      headSprite.scale.setScalar(0.5 + 0.06 * Math.min(projected, PROJECTILE_STREAK_LENGTH));
    });
    for (let i = world.projectiles.length; i < this.projectilePool.length; i++) {
      this.projectilePool[i].visible = false;
    }

    // scenario gate path (winCondition: 'gates') — rebuilt only when the config's gatePath
    // reference changes (scenario start/switch), same identity-diff idiom as enemy meshes.
    const gatePath = world.scenario?.config.gatePath ?? null;
    if (gatePath !== this.currentGatePath) this.rebuildGateMeshes(gatePath);
    if (gatePath) {
      const gateIndex = world.scenario!.gateIndex;
      gatePath.forEach((gate, i) => {
        const mesh = this.gateMeshes[i];
        mesh.position.set(gate.pos.x - eye.x, gate.pos.y - eye.y, gate.pos.z - eye.z);
        const axes = computeAxes(gate.quat);
        setObjectBasis(mesh, axes.forward, axes.up);
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.set(i < gateIndex ? 0x3a5a3a : i === gateIndex ? 0x7dffa0 : 0x555555);
      });
    }

    // scenario range bubble (Merge Drill's rangeBubbleRadius) — a wireframe sphere around the
    // nearest live enemy, hidden whenever no scenario config asks for one.
    const bubbleRadius = world.scenario?.config.rangeBubbleRadius;
    if (bubbleRadius !== undefined) {
      const target = world.enemies.find(e => e.respawnTimer <= 0 && e.health.points > 0);
      if (target) {
        const mesh = this.rangeBubbleMesh ?? this.createRangeBubbleMesh();
        mesh.scale.setScalar(bubbleRadius / 20); // base geometry radius is 20 (see createRangeBubbleMesh)
        mesh.position.set(target.pos.x - eye.x, target.pos.y - eye.y, target.pos.z - eye.z);
        mesh.visible = true;
      } else if (this.rangeBubbleMesh) {
        this.rangeBubbleMesh.visible = false;
      }
    } else if (this.rangeBubbleMesh) {
      this.rangeBubbleMesh.visible = false;
    }

    // scenario explosion bursts — a pooled mesh per live entry in world.scenario.explosions,
    // fading out as its timer counts down.
    const explosions = world.scenario?.explosions ?? [];
    explosions.forEach((exp, i) => {
      const mesh = this.explosionMesh(i);
      mesh.visible = true;
      mesh.position.set(exp.pos.x - eye.x, exp.pos.y - eye.y, exp.pos.z - eye.z);
      const t = Math.max(0, exp.timer / ENEMY_EXPLOSION_DURATION);
      mesh.scale.setScalar(1 + (1 - t) * 3);
      (mesh.material as THREE.MeshBasicMaterial).opacity = t;
    });
    for (let i = explosions.length; i < this.explosionPool.length; i++) {
      this.explosionPool[i].visible = false;
    }

    // PIP Trainer marker — a small bright glow sphere at the pip's live position, only while a
    // PIP Trainer session is active. Scales up briefly on a scored rep (scoreFlash), same visual
    // language as the explosion bursts' fade-out above.
    if (world.pipTrainer) {
      const pip = world.pipTrainer;
      const mesh = this.pipMarkerMesh ?? this.createPipMarker();
      mesh.visible = true;
      mesh.position.set(pip.pos.x - eye.x, pip.pos.y - eye.y, pip.pos.z - eye.z);
      const flash = pip.scoreFlash > 0 ? 1 + (pip.scoreFlash / 0.25) * 2 : 1;
      mesh.scale.setScalar(flash);
    } else if (this.pipMarkerMesh) {
      this.pipMarkerMesh.visible = false;
    }

    // aim the sun light from the sun's relative direction toward the origin (camera)
    const sunRel = this.relDir(SUN, eye);
    this.sunLight.position.set(sunRel.x, sunRel.y, sunRel.z);
    this.sunLight.target.position.set(0, 0, 0);

    // the headlight shines in the direction the camera looks — position it behind the origin along
    // -forward so light travels toward +forward, same as the view direction (see the lighting
    // comment in the constructor)
    this.fillLight.position.set(-view.forward.x * 1e5, -view.forward.y * 1e5, -view.forward.z * 1e5);
    this.fillLight.target.position.set(0, 0, 0);

    this.composer.render();
  }

  // Lazily grows the projectile mesh pool to match however many rounds are in flight. Every round
  // uses the same LASER_COLOR regardless of owner, so unlike the pool's other users there's nothing
  // to re-tint per frame.
  private projectileMesh(i: number): THREE.Object3D {
    if (i >= this.projectilePool.length) {
      const mesh = createProjectileMesh(LASER_COLOR);
      this.scene.add(mesh);
      this.projectilePool.push(mesh);
    }
    return this.projectilePool[i];
  }

  // Tears down and recreates one mesh per current enemy, using the model's own natural color (no
  // tint) rather than a distinguishing accent — see cloneArrow's own doc comment for how an
  // omitted tint skips the color-multiply step entirely. Called whenever world.enemies is swapped
  // for a brand-new array (scenario start/switch, restart) — see the render() call site — and once
  // more when the "Arrow" drone model (shipModels.ts) finishes loading, to swap the placeholder for it.
  private rebuildEnemyMeshes(enemies: EnemyShip[]): void {
    for (const mesh of this.enemyMeshes.values()) this.scene.remove(mesh);
    this.enemyMeshes.clear();
    for (const enemy of enemies) {
      const mesh = this.arrowTemplate ? cloneArrow(this.arrowTemplate) : createShipMesh();
      this.scene.add(mesh);
      this.enemyMeshes.set(enemy, mesh);
    }
    this.currentEnemyList = enemies;
  }

  // One ring mesh per gate in a 'gates' scenario's course, torn down and rebuilt whenever the
  // gatePath reference changes (a scenario starting/switching, or ending — null clears them).
  private rebuildGateMeshes(gatePath: FlightGate[] | null): void {
    for (const mesh of this.gateMeshes) this.scene.remove(mesh);
    this.gateMeshes = [];
    if (gatePath) {
      for (const gate of gatePath) {
        const mesh = new THREE.Mesh(
          new THREE.TorusGeometry(gate.radius, Math.max(1, gate.radius * 0.06), 8, 32),
          new THREE.MeshBasicMaterial({ color: 0x555555 })
        );
        this.scene.add(mesh);
        this.gateMeshes.push(mesh);
      }
    }
    this.currentGatePath = gatePath;
  }

  private createRangeBubbleMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(20, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x7dffa0, wireframe: true, transparent: true, opacity: 0.35 })
    );
    this.scene.add(mesh);
    this.rangeBubbleMesh = mesh;
    return mesh;
  }

  // Lazily grows the explosion-burst pool to match however many are active, same pooling idiom as
  // projectileMesh — a bright, additive sphere that scales up and fades out over its lifetime.
  private explosionMesh(i: number): THREE.Mesh {
    if (i >= this.explosionPool.length) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(3, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 1, blending: THREE.AdditiveBlending })
      );
      this.scene.add(mesh);
      this.explosionPool.push(mesh);
    }
    return this.explosionPool[i];
  }

  private createPipMarker(): THREE.Mesh {
    const mesh = createPipMarkerMesh();
    this.scene.add(mesh);
    this.pipMarkerMesh = mesh;
    return mesh;
  }

  // Recomputes every dust mote's head/tail vertex positions and head alpha from the ship's current
  // absolute position and velocity — see createSpaceDust's doc comment for why no eye-subtraction
  // is needed here (the ship's own position IS the eye while piloting).
  private updateSpaceDust(shipPos: Vec3, vel: Vec3): void {
    const { bases, field } = this.spaceDust;
    const m = field * 2;
    const streakSeconds = 0.0225; // matches the original's DUST_STREAK_SECONDS
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    const visibility = speed < 0.05 ? 0 : Math.min(0.22, Math.max(0.05, Math.sqrt(speed) / 20));
    const wrap = (v: number) => (((v % m) + m) % m) - field;

    const posAttr = this.spaceDust.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const alphaAttr = this.spaceDust.mesh.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    for (let i = 0; i < bases.length; i++) {
      const b = bases[i];
      const relX = wrap(b.x - shipPos.x), relY = wrap(b.y - shipPos.y), relZ = wrap(b.z - shipPos.z);
      const proximity = Math.min(1, Math.max(0, 1 - Math.hypot(relX, relY, relZ) / field));
      const i2 = i * 2;
      posAttr.setXYZ(i2, relX, relY, relZ);
      posAttr.setXYZ(i2 + 1, relX + vel.x * streakSeconds, relY + vel.y * streakSeconds, relZ + vel.z * streakSeconds);
      alphaAttr.setX(i2, proximity * visibility);
      alphaAttr.setX(i2 + 1, 0);
    }
    posAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  }

  private relDir(body: CelestialBody, eye: Vec3): Vec3 {
    const dx = body.pos.x - eye.x, dy = body.pos.y - eye.y, dz = body.pos.z - eye.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const s = 1e6 / len;
    return { x: dx * s, y: dy * s, z: dz * s };
  }
}
