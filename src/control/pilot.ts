import type { World } from '../core/world';
import { clamp } from '../math/vec';
import { computeAxes } from '../math/quaternion';
import { integrateFlight, resolveBoost } from '../physics/flightModel';
import * as Keybinds from '../input/keybinds';
import * as MouseLook from '../input/mouseLook';
import * as MouseButtons from '../input/mouseButtons';
import * as Joystick from '../input/joystickMap';
import * as EspAssist from '../combat/espAssist';
import { findActivePip } from '../combat/pipTargeting';

// Pilot controller: combines keyboard (rebindable actions), mouse (absolute virtual-joystick aim
// — see input/mouseLook.ts — plus rebindable mouse buttons for boost/brake), and an optional
// joystick/gamepad axis (additive, never exclusive — the stick is always optional) into
// FlightInputs, then runs one tick of the ported Newtonian flight model. ESP (combat/espAssist.ts)
// dampens the combined pitch/yaw once the crosshair nears a locked target, same as the original.
//
// Default bindings (all rebindable in the F4 controls panel — see input/actions.ts):
//   Mouse (vjoy)   aim (yaw + pitch)          W / S      strafe forward / back
//   A / D          strafe left / right        Q / E      roll left / right
//   Arrows         pitch/yaw (digital)        Shift      boost
//   Space / R      strafe up                  Ctrl       strafe down
//   X              space brake                C          toggle decoupled (handled in mode.ts)

export function stepPilot(world: World, dt: number): void {
  const ship = world.player.ship;

  // boost meter bookkeeping (drains held, recharges idle)
  const boostRequested = Keybinds.isActive('boost') || Joystick.isButtonPressed('boost') || MouseButtons.isPressed('boost');
  const boost = resolveBoost(ship.type, ship.boostMeter, ship.boosting, ship.boostCooldownTimer, boostRequested, dt);
  ship.boostMeter = boost.boostMeter;
  ship.boosting = boost.boosting;
  ship.boostCooldownTimer = boost.cooldownTimer;

  const mouse = MouseLook.consume();

  // Throttle ramps toward the commanded target rather than snapping — real SC's keyboard/joystick
  // throttle isn't an instant digital 0-to-full; see core/types.ts's ShipType.throttleRampRate doc
  // and capture/MEASUREMENTS.md's "Throttle input ramp" section (measured ~0.20s for a full 0..1
  // traversal, same rate in both directions and on both activating and releasing).
  const throttleTarget = clamp(Keybinds.digitalAxis('strafeBack', 'strafeForward') + Joystick.readAxis('strafeLongitudinal'), -1, 1);
  const maxThrottleDelta = ship.type.throttleRampRate * dt;
  ship.throttle += clamp(throttleTarget - ship.throttle, -maxThrottleDelta, maxThrottleDelta);

  const roll = Keybinds.digitalAxis('rollLeft', 'rollRight') + Joystick.readAxis('roll');
  let yawInput = Keybinds.digitalAxis('yawLeft', 'yawRight') + mouse.yaw + Joystick.readAxis('yaw');
  let pitchInput = Keybinds.digitalAxis('pitchUp', 'pitchDown') + mouse.pitch + Joystick.readAxis('pitch');

  const strafeX = Keybinds.digitalAxis('strafeLeft', 'strafeRight') + Joystick.readAxis('strafeLateral');
  const strafeY = Keybinds.digitalAxis('strafeDown', 'strafeUp') + Joystick.readAxis('strafeVertical');

  // ESP: dampen the already-combined pitch/yaw purely by crosshair-to-PIP proximity (see
  // espAssist.ts's module doc comment) — stepped every tick, PIP or not, so the smoothed
  // multiplier decays back to 1 rather than snapping when a target is lost.
  const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
  const pip = findActivePip(ship.pos, ship.vel, cam, world.enemies, window.innerWidth, window.innerHeight);
  const pipScreenDist = pip
    ? Math.hypot(pip.screenX - window.innerWidth / 2, pip.screenY - window.innerHeight / 2)
    : null;
  const factor = EspAssist.stepDamping(pipScreenDist, dt);
  pitchInput *= factor;
  yawInput *= factor;

  ship.spaceBrakeOn = Keybinds.isActive('spaceBrake') || Joystick.isButtonPressed('spaceBrake') || MouseButtons.isPressed('spaceBrake');

  const inputs = {
    throttle: ship.throttle,
    pitch: clamp(pitchInput, -1, 1),
    yaw: clamp(yawInput, -1, 1),
    roll: clamp(roll, -1, 1),
    strafeX: clamp(strafeX, -1, 1),
    strafeY: clamp(strafeY, -1, 1),
    brake: ship.spaceBrakeOn,
    decoupled: ship.decoupled
  };
  integrateFlight(ship, inputs, dt);
  ship.lastInputs = inputs; // see core/world.ts's ShipBody.lastInputs — read by replay/recorder.ts
}
