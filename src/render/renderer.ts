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
import { normalize } from '../math/vec';
import { footEye } from '../physics/characterController';
import { SUN } from '../world/celestial';
import { createBodyMesh, createPipMarkerMesh, createProjectileMesh, createShipMesh, createStarfield } from './meshes';
import { setCameraBasis, setObjectBasis } from './camera';

const PROJECTILE_COLOR = { player: 0x9fe6ff, enemy: 0xff6a55 };

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
  private projectilePool: THREE.Mesh[] = [];
  private gateMeshes: THREE.Mesh[] = [];
  private currentGatePath: FlightGate[] | null = null;
  private rangeBubbleMesh: THREE.Mesh | null = null;
  private explosionPool: THREE.Mesh[] = [];
  private pipMarkerMesh: THREE.Mesh | null = null;
  private starfield: THREE.Points;
  private sunLight: THREE.DirectionalLight;
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

    // celestial bodies
    for (const body of world.bodies) {
      const mesh = createBodyMesh(body);
      this.bodyMeshes.set(body.name, mesh);
      this.scene.add(mesh);
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

    // lighting: a strong warm directional light from the sun, plus a dim cool hemisphere fill so
    // shadowed sides read as starlit rather than pure black.
    this.sunLight = new THREE.DirectionalLight(0xfff2d8, 2.6);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.scene.add(new THREE.HemisphereLight(0x35506e, 0x0a0a12, 0.5));

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

    const ship = world.player.ship;
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

    // weapon-round tracers — a pooled mesh per live projectile, orientated along its velocity
    world.projectiles.forEach((p, i) => {
      const mesh = this.projectileMesh(i, p.owner);
      mesh.visible = true;
      mesh.position.set(p.pos.x - eye.x, p.pos.y - eye.y, p.pos.z - eye.z);
      const dir = normalize(p.vel);
      const up = Math.abs(dir.y) > 0.99 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      setObjectBasis(mesh, dir, up);
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

    this.composer.render();
  }

  // Lazily grows the projectile mesh pool to match however many rounds are in flight; the material
  // color is re-tinted per owner each frame rather than keeping separate pools, since which slot a
  // given round occupies isn't stable frame to frame.
  private projectileMesh(i: number, owner: 'player' | 'enemy'): THREE.Mesh {
    if (i >= this.projectilePool.length) {
      const mesh = createProjectileMesh(PROJECTILE_COLOR[owner]);
      this.scene.add(mesh);
      this.projectilePool.push(mesh);
    }
    const mesh = this.projectilePool[i];
    (mesh.material as THREE.MeshBasicMaterial).color.set(PROJECTILE_COLOR[owner]);
    return mesh;
  }

  // Tears down and recreates one mesh per current enemy, tinted red so a dogfight reads at a
  // glance against the player's own orange accent. Called whenever world.enemies is swapped for a
  // brand-new array (scenario start/switch, restart) — see the render() call site.
  private rebuildEnemyMeshes(enemies: EnemyShip[]): void {
    for (const mesh of this.enemyMeshes.values()) this.scene.remove(mesh);
    this.enemyMeshes.clear();
    for (const enemy of enemies) {
      const mesh = createShipMesh(0xff3344);
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

  private relDir(body: CelestialBody, eye: Vec3): Vec3 {
    const dx = body.pos.x - eye.x, dy = body.pos.y - eye.y, dz = body.pos.z - eye.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const s = 1e6 / len;
    return { x: dx * s, y: dy * s, z: dz * s };
  }
}
