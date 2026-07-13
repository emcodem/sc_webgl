# CLAUDE.md

Orientation file for the WebGL rebuild of "Vector". The original 2D-canvas project lives at
`C:\dev\starcitizen_flightsim` (referred to below as "the original"); this project reuses its
hard-won flight tuning but is a ground-up universe-scale architecture.

## What this is

A **three.js / WebGL** rebuild of Vector, architected from the start to grow into a whole universe:
Newtonian ship flight **and** on-foot movement over the same world, with a seamless transition
between them (get out of your ship and walk on a moon). Plain **TypeScript + Vite** static web app.
The only runtime dependency is **three.js** (`^0.169`) — deliberately, unlike the original's
zero-deps stance, because a universe game needs a real 3D engine under it.

Milestone 1 (DONE): fly the Gladius in a lit 3D scene (sun, planet, walkable moonlet, starfield)
→ press **F** to auto-land and disembark onto the moon → walk its curved surface under radial
gravity → **F** to re-board. Verified in a real headless browser (see below).

## Commands

- `npm run dev` — Vite dev server (HMR)
- `npm test` — `vitest run` (currently the ported-tuning guard in `tests/shipTuning.test.ts`)
- `npm run build` — `tsc && vite build` (typecheck gate, then static `dist/`)
- `npm run preview` — serve the built `dist/`

Node note: the user's Node is 20.18; Vite 7 *warns* it wants 20.19+ but builds/serves fine. On
Windows the Bash tool resets cwd on `cd` — run the local binaries directly via PowerShell, e.g.
`& "C:\dev\sc_webgl\node_modules\.bin\tsc.cmd" -p C:\dev\sc_webgl\tsconfig.json --noEmit`.

## Architecture (the important part)

Three layers, strictly separated so "in a ship" vs "on foot" is a mode over shared state, not a
fork, and so the renderer can be swapped/extended without touching the sim:

```
core/        renderer-agnostic sim state — ABSOLUTE f64 world coords, no three.js
  types.ts     Vec3/Quat/AngularState/ShipType (ported shapes — flight model depends on them)
  world.ts     World, CelestialBody, ShipBody, Player (mode: 'pilot' | 'onfoot')
  player.ts    makeWorld() / makeShipBody()
math/          vec.ts, quaternion.ts (ported verbatim + universe-scale helpers)
physics/       flightModel.ts (PORTED VERBATIM), shipTypes.ts (PORTED), characterController.ts (new)
world/         celestial.ts — the starter system (SUN, PLANET, MOON) + SPAWN, all as data
input/         input.ts — keyboard held/justPressed + pointer-lock mouse deltas
control/       pilot.ts, foot.ts (input -> physics), mode.ts (F/C edges, exit/enter + auto-land)
render/        renderer.ts (three.js scene + per-frame floating-origin sync), camera.ts, meshes.ts
hud/           hud.ts — minimal DOM overlay
main.ts        bootstrap + RAF loop (dt clamped to 50ms, matching the original)
```

### Load-bearing invariants

- **The flight model in `physics/flightModel.ts` and the stats in `physics/shipTypes.ts` are ported
  VERBATIM from the original and fit to frame-counted real-Star-Citizen measurements.** Every
  constant matters. Do NOT "clean up" or retune without re-measuring. The key invariants
  (`angularThrust == maxAngVel*angularDrag`, the boost-thrust derivation, negligible `linearDrag`
  with a governor cap, flat `coastDecel`, three separate spool delays) are documented in
  `shipTypes.ts` and guarded by `tests/shipTuning.test.ts`. The original's CLAUDE.md has the full
  "why".
- **Quaternion-only ship attitude, body-frame integration** (`math/quaternion.ts`). Never Euler.
- **Floating origin = fully camera-relative rendering.** The sim moves things in absolute f64 space;
  `render/renderer.ts` is the *only* place that rebases — every frame it subtracts the camera's
  absolute position from every object and pins the three.js camera at the GL origin. A logarithmic
  depth buffer spans the 20 m ship ↔ 8,000,000 m sun range. Keep three.js out of `core/`.
- **Axis-convention seam.** `computeAxes` uses forward=+Z, right=+X, **up=-Y** (the original's
  convention, load-bearing for the flight model). The render layer never assumes three.js's own
  +Y-up/-Z-forward — `render/camera.ts` (`setCameraBasis`/`setObjectBasis`) builds orientations from
  an explicit world (forward, up) basis. Consequence: at the identity spawn attitude, screen-down is
  world **+Y**, which is why the moon is placed at +Y in `celestial.ts`. Gravity/collision are fully
  radial and convention-independent.
- **On-foot = radial gravity + sphere clamp** (`physics/characterController.ts`). "Walk on a planet"
  is: nearest walkable body → up = radial, gravity toward center, feet clamped to `radius`, movement
  on the tangent plane, heading kept tangent as you cross the curve. Intentionally simple (spheres
  only, no interior/station geometry yet) — that's the seam richer collision slots into later.
- **The transition** (`control/mode.ts`) acts on one `Player`/`ShipBody`. Exiting near a surface
  (< `AUTOLAND_ALT`) sets the ship belly-down on the ground and steps you out beside it; otherwise
  it's a zero-g EVA beside the hull. This is the whole point of the milestone — keep it a mode
  switch over shared state, never a scene swap.

## Verifying (nothing renders in `npm test`)

`npm test` only covers pure logic. To verify gameplay/render, drive the real app in a headless
browser — same recipe as the original's `.claude/skills/verify`. Playwright is available globally
(`C:\Users\Gam3r1\node_modules`, v1.61.1 + Chromium). Launch Chromium with WebGL software-rendering
flags (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) — WebGL2 works headless
this way. `main.ts` exposes live state as `window.__world` for assertions; keyboard events go on
`window` (no canvas focus needed); do NOT click the canvas (pointer-lock confines the real cursor —
see the original's verify notes). A working script is in this session's job tmp
(`.../jobs/6f4fcc22/tmp/verify.mjs`).

## Scenarios / training drills

Ported from the original project: a data-driven scenario system layered on top of the combat
primitives above. `scenarios/types.ts` (`ScenarioConfig`/`ScenarioRuntime` — `world.enemies` IS the
active scenario's enemy list, no separate array), `scenarios/definitions.ts` (all 8 `SCENARIOS`:
aim-training, merge-drill, evasive-pilot, slow-turret-drill, fighter-intercept rookie/ace, two
barrel-roll gate-path drills), `scenarios/runtime.ts` (`startScenario`/`updateScenario` — a second
top-level step function parallel to `combat/combatSystem.ts::stepCombat`; `main.ts` picks one or
the other per frame), `scenarios/gatePath.ts` (the `'gates'` win condition's ring course). New AI
behaviors beyond the free-flight sandbox's `fighter` live in `combat/ai/` (`simpleAI.ts` for
chaser/cruiser, `orbiterDrifterAI.ts`, `evasiveAI.ts` — the MPC dodge planner). `ui/scenarioMenu.ts`
extends the F3 menu into a picker + results screen; `combat/pipTrainer.ts` is a fully separate,
ship-less aim-tracking drill layered on top of Free Flight rather than built on `EnemyShip`.

## Not yet built (milestone-1 scope boundaries)

Gamepad/joystick & rebinding UI are actually done too (see `input/joystickMap.ts`,
`input/gamepad.ts`, `ui/controlsPanel/`) — this list only tracks genuinely outstanding work: real
ship/character/station models (currently procedural primitives), station-interior walking,
atmosphere/terrain, universe streaming (bodies are a static list), and a near-field obstacle/hazard
concept (the original project's sandbox "station" cube — `ScenarioConfig.includeStation` is kept
for shape parity but wired to nothing here, since every scenario sets it `false` and there's no
equivalent hazard object to gate). None of these should require changing the layer boundaries above.
