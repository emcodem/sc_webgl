import { registerConfig } from './configRegistry';

// Joystick / vJoy-device near-center deadzone — a SEPARATE config from the mouse deadzone and the
// shared input curve (both in axisCurve.ts). Value is a fraction of full deflection (0..1); default
// 0.03 matches SC's default joystick deadzone. Applied in joystickMap.ts via axisCurve.shapeAxis, and
// persisted independently under its own 'joystickDeadzone' preset key.

const DEFAULT_JOYSTICK_DEADZONE = 0.03;
let joystickDeadzone = DEFAULT_JOYSTICK_DEADZONE;

export function getJoystickDeadzone(): number { return joystickDeadzone; }
export function setJoystickDeadzone(v: number): void { joystickDeadzone = v; }
export function getDefaultJoystickDeadzone(): number { return DEFAULT_JOYSTICK_DEADZONE; }

registerConfig({
  key: 'joystickDeadzone',
  serialize: () => ({ deadzone: joystickDeadzone }),
  deserialize: (data) => {
    const d = data as { deadzone?: number } | null | undefined;
    if (d && typeof d.deadzone === 'number') joystickDeadzone = d.deadzone;
  },
  resetToDefault: () => { joystickDeadzone = DEFAULT_JOYSTICK_DEADZONE; }
});
