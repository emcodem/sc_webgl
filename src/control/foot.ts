import type { World } from '../core/world';
import { updateCharacter } from '../physics/characterController';
import * as Input from '../input/input';
import * as Keybinds from '../input/keybinds';
import * as MouseLook from '../input/mouseLook';
import * as Touch from '../input/touchInput';

// On-foot controller: keyboard + mouse into FootInputs, then one tick of the character controller
// (radial gravity + sphere-surface collision). Mouse drives first-person look — plain FPS-style
// relative deltas each tick (NOT the flight vjoy's persistent-offset model in input/mouseLook.ts;
// there's no "recenter" concept for looking around on foot), but shares that module's invert-Y
// setting so the F4 controls panel only has one mouse tuning section, not two.
//
// Bindings (rebindable in the F4 controls panel — reuses the same forward/strafe actions as
// flight, see input/actions.ts):
//   Mouse   look        W / S   walk fwd / back
//   A / D   strafe      Space   jump         F   enter ship (near it; handled in mode.ts)
//
// Touch (ui/touchControls.ts, no original-project precedent — that project has no on-foot mode):
// reuses the same left move-stick as flight's strafe/throttle axes, plus a continuous look-rate
// off the right stick (there's no persistent-vjoy/joystick-axis concept for on-foot look, so this
// turns the stick's raw deflection into a per-tick delta itself, at FOOT_LOOK_RATE rad/s).

const LOOK_SENS = 0.0022; // radians per pixel
const FOOT_LOOK_RATE = 2.2; // rad/s at full touch-stick deflection

export function stepFoot(world: World, dt: number): void {
  const mouse = Input.consumeMouse();
  // mouseLook.ts's invertY polarity is opposite input/settings.ts's old (now-removed) convention —
  // its default (true) must reproduce this project's original shipped on-foot look direction, so
  // the sign here is deliberately the mirror of what a naive reuse of the flag would suggest.
  const pitchSign = MouseLook.getInvertY() ? 1 : -1;
  const touchAim = Touch.readAimStick();

  updateCharacter(world.player, world.bodies, {
    moveForward: Keybinds.digitalAxis('strafeBack', 'strafeForward') + Touch.readAxis('strafeLongitudinal'),
    moveRight: Keybinds.digitalAxis('strafeLeft', 'strafeRight') + Touch.readAxis('strafeLateral'),
    jump: Keybinds.isActive('jump') || Touch.isButtonPressed('jump'),
    lookYawDelta: -mouse.dx * LOOK_SENS + touchAim.x * FOOT_LOOK_RATE * dt,
    lookPitchDelta: pitchSign * mouse.dy * LOOK_SENS + pitchSign * touchAim.y * FOOT_LOOK_RATE * dt
  }, dt);
}
