# Vector — WebGL Universe

A Newtonian, Star Citizen–inspired space sim rebuilt on **three.js / WebGL**, architected from the
start to grow into a whole explorable universe: fly your ship, **get out and walk** on a moon,
seamlessly, over one shared world.

This is the WebGL successor to the original 2D-canvas project at
**`D:\dev\starcitizen_flightsim`** (referred to below as "the original"). It **reuses the original's
frame-counted, real-measured Gladius flight model** but is otherwise a ground-up universe-scale
architecture.

> This README is the **pick-up-the-work handoff**. For architecture rationale and load-bearing
> invariants, also read `CLAUDE.md` in this folder. The original's `CLAUDE.md` / `HANDOFF.md` remain
> the source of truth for *why* the flight tuning is the way it is.

---

## The goal

A single game where the same world holds:
- **Newtonian ship flight** (the real Gladius handling), and
- **On-foot movement** (walk on planets/moons/stations under local gravity), with
- a **seamless transition** between them (leave the cockpit and walk around; climb back in),
- at **universe scale** (a solar system that spans hundreds of millions of metres, and eventually
  more), rendered with real 3D graphics (lighting, materials, atmospheres, bloom).

The long-term vision the user stated: "the game will become a whole universe … one can leave the
ship, walk on a planet or station etc."

---

## Where we are right now  (as of 2026-07-12)

**Milestone 1 — seamless ship ↔ on-foot — is DONE and verified in a real headless browser.**

Playable loop today:
1. Spawn **piloting** the Gladius above a small moon (Cellin), sun + distant planet + starfield.
2. Fly with the ported flight model (settles at exactly 226 m/s SCM — confirmed).
3. Press **F** near the surface → the ship **auto-lands belly-down** and you **step out**.
4. **Walk** the moon's curved surface under radial gravity (mouse-look, WASD, jump).
5. Press **F** by the ship → **climb back in** and fly off.

**Visual-realism pass — DONE.** Filmic tone mapping (ACES) + **bloom**; procedurally
displaced/mottled planets & moons with a **Fresnel atmosphere rim**; a proper **sun** (HDR
limb-brightened core shader + layered warm corona billboards); glowing, size-varied stars. All
asset-free (procedural / canvas-generated). The user is happy with the planets and the sun.

**Known-crude / next up:** the **ship model** (still boxy primitives — the biggest remaining
eyesore) and close-up moon-surface detail (kept deliberately subtle so the visual surface stays
matched to the collision sphere).

---

## Quick start

```bash
npm install
npm run dev      # Vite dev server (http://localhost:5173)
npm test         # vitest — tuning-invariant guards
npm run build    # tsc typecheck gate + static build to dist/
```

Requires a WebGL2 browser. Only runtime dependency: **three.js** (`^0.169`).

### Controls
**Click** the view to capture the mouse.

Flying: mouse = aim (yaw/pitch) · `W`/`S` throttle · `A`/`D` roll · `Q`/`E` yaw · arrows = strafe
(L/R + up/down) · `Shift` boost · `Space` brake · `C` decouple · `F` disembark (auto-lands near a
surface).

On foot: mouse = look · `WASD` walk · `Space` jump · `F` board (when near the ship).

---

## Architecture at a glance

Three strictly-separated layers so "in a ship" vs "on foot" is a **mode over shared state**, not a
fork, and so the renderer can be extended/replaced without touching the sim. See `CLAUDE.md` for the
full description.

```
core/       renderer-agnostic sim state — ABSOLUTE f64 world coords, NO three.js
  types.ts    Vec3/Quat/AngularState/ShipType  (ported shapes)
  world.ts    World, CelestialBody, ShipBody, Player (mode: 'pilot' | 'onfoot')
  player.ts   makeWorld() / makeShipBody()
math/        vec.ts, quaternion.ts             (ported + universe-scale helpers)
physics/     flightModel.ts (PORTED VERBATIM), shipTypes.ts (PORTED), characterController.ts (NEW)
world/       celestial.ts — starter system (SUN, PLANET, MOON) + SPAWN, as data
input/       input.ts — minimal keyboard held/justPressed + pointer-lock mouse deltas
control/     pilot.ts, foot.ts (input -> physics), mode.ts (F/C edges, exit/enter + auto-land)
render/      renderer.ts (three.js + floating-origin sync + bloom), camera.ts, meshes.ts, noise.ts
hud/         hud.ts — minimal DOM overlay
main.ts      bootstrap + RAF loop (dt clamped to 50 ms, matching the original)
```

Two things that will bite you if you don't know them (both detailed in `CLAUDE.md`):
- **Floating origin = fully camera-relative rendering.** `render/renderer.ts` is the ONLY place it
  happens; the sim moves things in absolute f64 space. Keep three.js out of `core/`.
- **Axis-convention seam.** `computeAxes` uses forward=+Z, right=+X, **up=-Y** (the original's
  convention — load-bearing for the flight model). `render/camera.ts` builds camera/object
  orientation from an explicit world (forward, up) basis so three.js's own +Y-up/-Z-forward never
  fights it. Consequence: at the spawn attitude, screen-down is world **+Y**, which is why the moon
  sits at +Y in `celestial.ts`. Gravity/collision are radial and convention-independent.

---

## PORTED from the original — in detail

Everything here was carried over from `D:\dev\starcitizen_flightsim`. "Verbatim" means copied with
only import-path changes; "adapted" means reshaped for the new architecture.

| New file | From original | Status | Notes |
| --- | --- | --- | --- |
| `src/physics/flightModel.ts` | `src/physics/flightModel.ts` | **Verbatim** | `integrateFlight` + `resolveBoost`, and the `FlightBody`/`FlightInputs` shapes. The complete Newtonian model: shared rotational-authority budget, per-axis angular thrust/drag (drag from tick-start angVel), snap-to-zero floor, per-direction engine **spool delays** (main/retro/vertical), **space brake** (combined-axis velocity controller), **coastDecel** flat coast, proportional drag while thrusting, and the **flight-computer speed governor**. |
| `src/physics/shipTypes.ts` | `src/ship/shipTypes.ts` | **Verbatim** (values) | The `Gladius` `ShipType` with every measured constant. Full measurement provenance was summarised into the file's comment; the original file has the exhaustive frame-by-frame traces. |
| `src/core/types.ts` | `src/types.ts` | **Adapted** | Ported the value types the flight model needs: `Vec3`, `Quat`, `AngularState`, `ShipType`. (The original's combat/AI/input/binding types were **not** brought over — see below.) |
| `src/math/vec.ts` | `src/math/vec.ts` | **Verbatim + extended** | `clamp`, `addScaled`, `cross`, `normalize` verbatim. **Added** (new): `dot`, `sub`, `add`, `scale`, `length`, `clone`, `projectOntoPlane`, `rotateAboutAxis` for the character controller. |
| `src/math/quaternion.ts` | `src/math/quaternion.ts` | **Verbatim (subset)** | `quatMultiply`, `quatNormalize`, `rotateVecByQuat`, `integrateOrientation`, `computeAxes`, `lookAtQuat`, `quatFromAxes`, `slerp`. **NOT** ported: `rotateTowards` (was AI-facing — bring it over when enemy AI is ported). |
| `tests/shipTuning.test.ts` | `tests/shipTuning.test.ts` (+ deriveShipType) | **Adapted** | Guards the ported invariants (`angularThrust==maxAngVel*angularDrag`, boost derivations, verticalDown==verticalUp/2) plus a behavioural check that full throttle settles at `scmSpeed`. |

**Ported concepts / behaviours (not files):**
- `dt` clamped to 50 ms in the main loop (matches the original).
- Quaternion-only ship attitude, body-frame integration (load-bearing invariant).
- First-person camera with **no offset** (in pilot mode the camera sits at the ship origin; the ship
  mesh is hidden while flying — same as the original's cockpit-less first person).
- Additive input philosophy (currently only keyboard+mouse are summed; joystick not yet present).
- Decoupled = edge toggle; space brake = hold — kept distinct.

---

## NOT yet ported from the original — in detail

These exist in the original and are **absent** here. This is the backlog. None of it should require
changing the layer boundaries above.

### Combat & weapons (entirely absent)
| Original module | What it does |
| --- | --- |
| `world/weapons.ts` | Projectiles, firing, `updateProjectiles`. |
| `combat/health.ts` | Generic points/damage pool. |
| `combat/hitDetection.ts` | Sphere-test projectile hit resolution by owner. |
| `combat/leadIndicator.ts` | Firing-solution intercept math for the PIP. |
| `combat/pipTargeting.ts` | Active-PIP selection + screen projection. |
| `combat/espAssist.ts` | ESP aim-damping near a PIP. |
| `combat/enemyAI.ts` | All enemy behaviours: turret / fighter / chaser / orbiter / drifter / cruiser / evasive (+ their tuning presets). |
| `combat/pipTrainer.ts` | Bare PIP aim-tracking trainer mode. |

### Scenarios (entirely absent)
| Original module | What it does |
| --- | --- |
| `scenarios/types.ts`, `definitions.ts`, `runtime.ts`, `gatePath.ts` | Data-driven training scenarios: enemy spawns, win/lose conditions, gate paths, results. |
| `EnemyShip` type & derived-ship scaling (`ship/deriveShipType.ts`) | Scenario opponents that fly on the same flight model. |

### Input stack (replaced by a minimal version)
The original has a full device/rebinding stack; here `input/input.ts` is a **deliberately minimal**
keyboard-held/justPressed + pointer-lock relative-mouse surface. **Not ported:**
| Original module | What it does (missing here) |
| --- | --- |
| `input/controlsModule.ts` | Keybinds, **actionmaps.xml** parsing, chord resolution. |
| `input/mouseLook.ts` | Pointer-Lock **absolute** virtual-stick mouse-flight (here it's simple relative aim). |
| `input/gamepadModule.ts`, `joystickAxes.ts`, `joystickButtons.ts`, `deviceState.ts` | **Joystick / gamepad / HOTAS** support. |
| `input/mouseButtons.ts` | Mouse-button action bindings. |
| `input/configRegistry.ts`, `presetStore.ts` | Control **presets** save/load/import/export. |
| `input/touchInput.ts` | Touch / gyro input. |

### UI (entirely absent)
| Original module | What it does |
| --- | --- |
| `ui/scenarioMenu.ts` | Main-menu / scenario picker / results screen. |
| `ui/startupModal.ts` | Browser-compat + Ctrl-safety modal. |
| `ui/fullscreenGuard.ts` | Fullscreen + Ctrl-key guard, keydown/keyup wiring. |
| `ui/mouseCapture.ts` | Click-to-capture + firing wiring (a tiny slice is reimplemented in `input.ts`). |
| `ui/controlsPanel/*` | Full rebind UI: presets, actionmaps import, bindings table, joystick detection. |
| `ui/modeToggle.ts`, `espSettingsUI.ts`, `deviceDetect.ts`, `touchControls.ts` | Coupled/decoupled flag, ESP settings, device detection, on-screen touch controls. |

### Rendering & HUD (replaced by three.js — original 2D canvas NOT ported)
The original `render/render.ts` + `render/projection.ts` (hand-rolled 2D perspective) are **fully
replaced** by the three.js layer. The rich 2D HUD/overlays are **not** ported: PIP reticle, lead
indicator, total-velocity indicator, off-screen enemy arrows, drone contrails, explosions, hit-flash,
range bubble, gate-path overlay, space dust, beacon field, reference grid/pillars, and the detailed
flight/scenario HUD readouts. Here `hud/hud.ts` is a minimal DOM overlay (mode + speed/throttle/
boost/brake or ground/stance).

### Misc
- `ship/decoupledPersist.ts` (persisting the decouple toggle) — here it's a plain in-memory toggle.
- Ship `health`/explosion/respawn wiring — absent (no combat yet).

---

## NEW in this project (not in the original)

- **three.js render layer** (`render/`): camera-relative floating origin, logarithmic depth buffer,
  ACES tone mapping, UnrealBloom, `setCameraBasis`/`setObjectBasis` convention seam.
- **Procedural celestial rendering** (`render/meshes.ts` + `render/noise.ts`): fBm value-noise
  surface displacement + colour mottling, Fresnel atmosphere shell, HDR sun core shader + corona
  billboards, shader starfield.
- **On-foot character controller** (`physics/characterController.ts`): nearest-walkable-body radial
  gravity, spherical-surface collision, tangent-plane movement, curved-surface first-person look.
- **Seamless mode transition** (`control/mode.ts`): exit/enter ship over one shared `Player`, with
  auto-land onto a nearby surface (or zero-g EVA float otherwise).
- **Universe-scale world** (`core/world.ts`, `world/celestial.ts`): absolute f64 coordinates,
  `CelestialBody` data model.

---

## Verifying changes (nothing renders in `npm test`)

`npm test` only covers pure logic. To verify gameplay/render, drive the real app in a headless
browser (same recipe as the original's `.claude/skills/verify`):

- **Playwright** is available globally (`C:\Users\Gam3r1\node_modules`, v1.61.1 + Chromium). Don't
  install it into this repo. Run scripts with `cd ~ && node <script>.mjs`.
- Launch Chromium with software-WebGL flags:
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
  WebGL2 works headless this way (confirmed).
- `main.ts` exposes live state as **`window.__world`** for assertions.
- Keyboard events go on `window` — no canvas focus needed. **Do NOT click the canvas** (pointer-lock
  confines the real OS cursor — see the original's verify notes).
- Screenshots are the practical way to judge visuals (the sun/planet/moon passes were verified this
  way).

---

## Environment gotchas (Windows)

- **Node 20.18** is installed; Vite 7 prints a "wants 20.19+" warning but builds/serves fine.
- The **Bash tool resets cwd on `cd`** — run local binaries directly via PowerShell, e.g.
  `& "D:\dev\sc_webgl\node_modules\.bin\tsc.cmd" -p D:\dev\sc_webgl\tsconfig.json --noEmit`.
- No git repo initialised yet (a `.gitignore` is in place). Ask before committing.

---

## Suggested next steps (priority order)

1. **Ship model** — the current boxy primitive is the biggest visual weakness. Either a much richer
   procedural Gladius or a real glTF asset (get user sign-off before pulling third-party files).
2. **Port combat** — weapons/projectiles → hit detection → lead/PIP → enemy AI → scenarios (bring
   `rotateTowards` over with the AI). Large, but the flight model it rides on is already here.
3. **Richer on-foot** — station structures, non-sphere (mesh/box) surface collision, jetpack/EVA.
4. **Input parity** — re-layer joystick/gamepad + rebinding + presets on top of `input/input.ts`.
5. **Universe** — more bodies, body streaming, larger distances, docking.
