import type { World } from '../core/world';
import { updateCharacter } from '../physics/characterController';
import * as Input from '../input/input';
import * as Keybinds from '../input/keybinds';
import * as MouseLook from '../input/mouseLook';

// On-foot controller: keyboard + mouse into FootInputs, then one tick of the character controller
// (radial gravity + sphere-surface collision). Mouse drives first-person look — plain FPS-style
// relative deltas each tick (NOT the flight vjoy's persistent-offset model in input/mouseLook.ts;
// there's no "recenter" concept for looking around on foot), but shares that module's sensitivity/
// invert-Y settings so the F4 controls panel only has one mouse tuning section, not two.
//
// Bindings (rebindable in the F4 controls panel — reuses the same forward/strafe actions as
// flight, see input/actions.ts):
//   Mouse   look        W / S   walk fwd / back
//   A / D   strafe      Space   jump         F   enter ship (near it; handled in mode.ts)

const BASE_LOOK_SENS = 0.0022; // radians per pixel (at sensitivity 1x)

export function stepFoot(world: World, dt: number): void {
  const mouse = Input.consumeMouse();
  const lookSens = BASE_LOOK_SENS * MouseLook.getSensitivity();
  // mouseLook.ts's invertY polarity is opposite input/settings.ts's old (now-removed) convention —
  // its default (true) must reproduce this project's original shipped on-foot look direction, so
  // the sign here is deliberately the mirror of what a naive reuse of the flag would suggest.
  const pitchSign = MouseLook.getInvertY() ? 1 : -1;

  updateCharacter(world.player, world.bodies, {
    moveForward: Keybinds.digitalAxis('strafeBack', 'strafeForward'),
    moveRight: Keybinds.digitalAxis('strafeLeft', 'strafeRight'),
    jump: Keybinds.isActive('jump'),
    lookYawDelta: -mouse.dx * lookSens,
    lookPitchDelta: pitchSign * mouse.dy * lookSens
  }, dt);
}
