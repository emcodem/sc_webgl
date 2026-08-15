import type { ActionName, AxisConcept } from './actions';

// ============================================================================================
// Touch input: dual virtual-stick + button + optional device-tilt state for phones/tablets.
// Ported from the original project's input/touchInput.ts (its analog stick/gyro state) and
// ui/touchControls.ts (the DOM wiring lives there; see that file). Exposes the same
// readAxis/isButtonPressed/buttonJustPressed shape as input/joystickMap.ts, so control/pilot.ts,
// control/foot.ts, control/mode.ts and combat/combatSystem.ts all sum this in additively alongside
// keyboard/mouse/joystick — a no-op (everything 0/false) unless ui/touchControls.ts's DOM handlers
// are actually wired in, which only happens on a touch-primary device (see
// ui/deviceDetect.ts's isTouchPrimary()).
//
// The original project is ship-only (no on-foot mode), so its touch layer only ever drove flight
// axes. sc_webgl reuses the SAME left stick for on-foot move (strafeLateral/strafeLongitudinal are
// shared axis concepts between control/pilot.ts and control/foot.ts already) and adds a jump
// button and a rate-based look reading off the right stick (see readAimStick, consumed by
// control/foot.ts) — there's no original on-foot touch precedent to port for that part.
// ============================================================================================

let leftX = 0, leftY = 0; // left stick: strafeLateral (x), strafeLongitudinal / throttle-or-move (y)
let aimX = 0, aimY = 0;   // right stick: yaw (x), pitch (y) in pilot mode; raw look drive on foot
let gyroRoll = 0, gyroPitch = 0; // opt-in device-tilt roll + pitch assist (pilot mode only)

const held = new Set<ActionName>();
// Edge-triggered the same way joystickMap.ts's buttonJustPressed is: each action key compares
// against its own last-read state, updated on every call. Fine as long as each action is only
// queried once per frame, same as this codebase's actual call sites (control/mode.ts).
const prevPressed = new Set<ActionName>();

export function setLeftStick(x: number, y: number): void { leftX = x; leftY = y; }
export function setAimStick(x: number, y: number): void { aimX = x; aimY = y; }
export function setGyro(roll: number, pitch: number): void { gyroRoll = roll; gyroPitch = pitch; }

export function setButton(action: ActionName, pressed: boolean): void {
  if (pressed) held.add(action);
  else held.delete(action);
}

export function readAxis(concept: AxisConcept): number {
  if (concept === 'strafeLateral') return leftX;
  if (concept === 'strafeLongitudinal') return leftY;
  if (concept === 'strafeVertical') return (held.has('strafeUp') ? 1 : 0) - (held.has('strafeDown') ? 1 : 0);
  if (concept === 'yaw') return aimX;
  if (concept === 'pitch') return aimY + gyroPitch;
  if (concept === 'roll') return gyroRoll;
  return 0;
}

// Raw right-stick deflection (-1..1 each axis, before the pitch/gyro blend readAxis('pitch')
// applies) — control/foot.ts turns this into a per-tick look delta itself (rate * dt), since
// on-foot look has no persistent-vjoy/joystick-axis concept of its own, just relative deltas.
export function readAimStick(): { x: number; y: number } {
  return { x: aimX, y: aimY };
}

export function isButtonPressed(action: ActionName): boolean {
  return held.has(action);
}

export function buttonJustPressed(action: ActionName): boolean {
  const pressed = held.has(action);
  const was = prevPressed.has(action);
  if (pressed) prevPressed.add(action);
  else prevPressed.delete(action);
  return pressed && !was;
}
