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
  const boost = resolveBoost(ship.type, ship.boostMeter, boostRequested, dt);
  ship.boostMeter = boost.boostMeter;
  ship.boosting = boost.boosting;

  const mouse = MouseLook.consume();

  const throttle = Keybinds.digitalAxis('strafeBack', 'strafeForward') + Joystick.readAxis('strafeLongitudinal');
  ship.throttle = clamp(throttle, -1, 1);

  const roll = Keybinds.digitalAxis('rollLeft', 'rollRight') + Joystick.readAxis('roll');
  let yawInput = Keybinds.digitalAxis('yawLeft', 'yawRight') + mouse.yaw + Joystick.readAxis('yaw');
  let pitchInput = Keybinds.digitalAxis('pitchUp', 'pitchDown') + mouse.pitch + Joystick.readAxis('pitch');

  const strafeX = Keybinds.digitalAxis('strafeLeft', 'strafeRight') + Joystick.readAxis('strafeLateral');
  const strafeY = Keybinds.digitalAxis('strafeDown', 'strafeUp') + Joystick.readAxis('strafeVertical');

  // ESP: dampen the already-combined pitch/yaw once the crosshair nears the active PIP, but only
  // while the stick itself is also near center — see espAssist.ts's dampingFactor doc comment.
  const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
  const pip = findActivePip(ship.pos, ship.vel, cam, world.enemies, window.innerWidth, window.innerHeight);
  if (pip) {
    const screenDist = Math.hypot(pip.screenX - window.innerWidth / 2, pip.screenY - window.innerHeight / 2);
    const stickOffset = MouseLook.getOffset();
    const stickDist = Math.hypot(stickOffset.x, stickOffset.y);
    const factor = EspAssist.dampingFactor(screenDist, stickDist);
    pitchInput *= factor;
    yawInput *= factor;
  }

  ship.spaceBrakeOn = Keybinds.isActive('spaceBrake') || Joystick.isButtonPressed('spaceBrake') || MouseButtons.isPressed('spaceBrake');

  integrateFlight(ship, {
    throttle: ship.throttle,
    pitch: clamp(pitchInput, -1, 1),
    yaw: clamp(yawInput, -1, 1),
    roll: clamp(roll, -1, 1),
    strafeX: clamp(strafeX, -1, 1),
    strafeY: clamp(strafeY, -1, 1),
    brake: ship.spaceBrakeOn,
    decoupled: ship.decoupled
  }, dt);
}
