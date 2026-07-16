import type { World } from '../core/world';
import { computeAxes, lookAtQuat } from '../math/quaternion';
import { add, clone, length, normalize, projectOntoPlane, scale, sub } from '../math/vec';
import { nearestWalkable } from '../physics/characterController';
import * as Keybinds from '../input/keybinds';
import * as Joystick from '../input/joystickMap';
import * as Input from '../input/input';
import * as MouseLook from '../input/mouseLook';

// ============================================================================================
// The seamless ship <-> on-foot transition. Pressing F toggles between piloting and walking; C
// toggles decoupled flight. Both act on the SAME world state (one Player, one ShipBody) — exiting
// the ship is a mode switch plus a hand-off of position/velocity, not a scene change. This is the
// core piece that lets the sim grow into "leave your ship and walk around" without a separate game.
// ============================================================================================

const EXIT_OFFSET = 6;    // metres to the side of the ship the pilot steps out to (clear of the hull)
const ENTER_RANGE = 16;   // must be within this of the ship to climb back in
const AUTOLAND_ALT = 200; // if within this altitude of a walkable surface, disembarking sets the
                          // ship (belly-down) and pilot onto the ground so the walk/re-board loop
                          // is clean; higher/deeper than this, you free-float beside the ship (EVA)
const SHIP_HOVER = 2.5;   // metres the landed ship's origin sits above the surface (hull clearance)

// EVA/on-foot disembarking is temporarily hidden — F just releases the pointer lock (shows the
// cursor) instead of exiting the ship. Flip this back to true to restore F as the board/exit toggle.
const EVA_ENABLED = false;

let statusMessage = '';

export function getStatusMessage(): string {
  return statusMessage;
}

// Process one-shot key edges (F: enter/exit, C: decouple). Call once per frame from the main loop.
export function handleEdgeActions(world: World): void {
  const p = world.player;

  const decoupleToggled = Keybinds.justPressed('decoupleToggle') || Joystick.buttonJustPressed('decoupleToggle');
  if (decoupleToggled && p.mode === 'pilot') {
    p.ship.decoupled = !p.ship.decoupled;
  }

  const interacted = Keybinds.justPressed('interact') || Joystick.buttonJustPressed('interact');
  if (interacted) {
    if (!EVA_ENABLED) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (p.mode === 'pilot') {
      exitShip(world);
    } else {
      enterShip(world);
    }
  }
}

function exitShip(world: World): void {
  const p = world.player;
  const ship = p.ship;

  // park the ship: cut thrust and spin so it stays put where you left it
  ship.vel = { x: 0, y: 0, z: 0 };
  ship.angVel = { pitch: 0, yaw: 0, roll: 0 };
  ship.throttle = 0;
  ship.boosting = false;

  // If we're near a walkable surface, set the ship down belly-first and step the pilot out onto the
  // ground beside it — so you can walk around and climb back in. Otherwise it's a zero-g EVA: float
  // out beside the hull.
  const body = nearestWalkable(ship.pos, world.bodies);
  const altitude = body ? length(sub(ship.pos, body.pos)) - body.radius : Infinity;

  if (body && altitude < AUTOLAND_ALT) {
    const surfaceN = normalize(sub(ship.pos, body.pos));
    // keep the current heading, flattened onto the surface, as the landed facing
    let fwd = projectOntoPlane(computeAxes(ship.quat).forward, surfaceN);
    if (length(fwd) < 1e-4) fwd = projectOntoPlane({ x: 0, y: 0, z: 1 }, surfaceN);
    fwd = normalize(fwd);

    ship.pos = add(scale(surfaceN, body.radius + SHIP_HOVER), body.pos);
    ship.quat = lookAtQuat(fwd, surfaceN); // belly (ship up) points along the surface normal
    const right = normalize(computeAxes(ship.quat).right);

    p.charPos = add(clone(ship.pos), scale(right, EXIT_OFFSET)); // beside the ship; collision seats it
    p.charVel = { x: 0, y: 0, z: 0 };
    p.heading = fwd;
    p.onGround = false; // the first character tick will snap feet to the surface
  } else {
    const axes = computeAxes(ship.quat);
    p.charPos = add(clone(ship.pos), scale(axes.right, EXIT_OFFSET));
    p.charVel = clone(ship.vel); // inherit momentum for a realistic EVA
    p.heading = clone(axes.forward);
    p.onGround = false;
  }
  p.lookPitch = 0;
  // start on-foot look from a clean slate — drain the pointer-lock delta backlog that piled up
  // unconsumed while piloting (foot look reads these; flight aim uses MouseLook instead)
  Input.resetMouseDeltas();

  p.mode = 'onfoot';
  statusMessage = 'On foot — F near the ship to board';
}

function enterShip(world: World): void {
  const p = world.player;
  const dist = length(sub(p.charPos, p.ship.pos));
  if (dist > ENTER_RANGE) {
    statusMessage = `Too far from ship to board (${dist.toFixed(0)}m)`;
    return;
  }
  // recenter the flight virtual-stick so the deflection held while walking around doesn't yank the
  // ship the instant you climb back in
  MouseLook.recenter();
  p.mode = 'pilot';
  statusMessage = 'Piloting — F to disembark';
}
