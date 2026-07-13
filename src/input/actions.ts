// ============================================================================================
// The action/axis vocabulary for rebindable controls — one place both the keyboard layer
// (keybinds.ts) and the joystick/gamepad layer (joystickMap.ts) target, so a physical control
// (key, stick axis, pad button, mouse button) always binds to the same sim-level concept
// regardless of device. Ported 1:1 from the original project's types.ts + input/controlsModule.ts
// default bindings, including its exact default key layout (see AskUserQuestion in this session —
// switching sc_webgl's own defaults to match was a deliberate choice, not an oversight).
//
// ActionName = discrete/digital intents (a key or a button either is or isn't pressed).
// AxisConcept = continuous intents a joystick axis can drive directly (a key pair can also drive
// these digitally — see keybinds.ts's digitalAxis — since keyboard and joystick are additive).
// ============================================================================================

export type ActionName =
  | 'pitchUp' | 'pitchDown'
  | 'yawLeft' | 'yawRight'
  | 'rollLeft' | 'rollRight'
  | 'strafeForward' | 'strafeBack'
  | 'strafeLeft' | 'strafeRight'
  | 'strafeUp' | 'strafeDown'
  | 'decoupleToggle' | 'spaceBrake' | 'boost' | 'primaryFire' | 'interact'
  | 'jump'; // on-foot only — not in the original project (no on-foot mode there)

export type AxisConcept =
  | 'pitch' | 'yaw' | 'roll'
  | 'strafeLateral' | 'strafeVertical' | 'strafeLongitudinal';

export type KeyChord = string[]; // ANDed KeyboardEvent.code values
export type KeyBindings = Record<ActionName, KeyChord[]>;

// Default bindings match the original project's input/controlsModule.ts defaultBindings()
// exactly (jump is the only addition, for on-foot movement, which the original has no equivalent
// of — it defaults to the same physical key as strafeUp since the two modes are never both active).
export function defaultKeyBindings(): KeyBindings {
  return {
    pitchUp: [['ArrowUp']],
    pitchDown: [['ArrowDown']],
    yawLeft: [['ArrowLeft']],
    yawRight: [['ArrowRight']],
    rollLeft: [['KeyQ']],
    rollRight: [['KeyE']],
    strafeForward: [['KeyW']],
    strafeBack: [['KeyS']],
    strafeLeft: [['KeyA']],
    strafeRight: [['KeyD']],
    strafeUp: [['Space'], ['KeyR']],
    strafeDown: [['ControlLeft']],
    decoupleToggle: [['KeyC']],
    spaceBrake: [['KeyX']],
    boost: [['ShiftLeft']],
    primaryFire: [], // unbound by default on keyboard — default fire input is the mouse
    interact: [['KeyF']],
    jump: [['Space']]
  };
}

export const ACTION_LABELS: Record<ActionName, string> = {
  pitchUp: 'Pitch up', pitchDown: 'Pitch down',
  yawLeft: 'Yaw left', yawRight: 'Yaw right',
  rollLeft: 'Roll left', rollRight: 'Roll right',
  strafeForward: 'Strafe forward', strafeBack: 'Strafe back',
  strafeLeft: 'Strafe left', strafeRight: 'Strafe right',
  strafeUp: 'Strafe up', strafeDown: 'Strafe down',
  decoupleToggle: 'Decouple toggle', spaceBrake: 'Space brake', boost: 'Boost', primaryFire: 'Primary fire',
  interact: 'Interact (board/exit ship)',
  jump: 'Jump (on foot)'
};

export const AXIS_LABELS: Record<AxisConcept, string> = {
  pitch: 'Pitch', yaw: 'Yaw', roll: 'Roll',
  strafeLongitudinal: 'Strafe Forward/Back', strafeLateral: 'Strafe Left/Right', strafeVertical: 'Strafe Up/Down'
};

// ---------- Mouse button binding ----------
// A separate concept from a joystick ButtonBinding (no vid/pid: there's only ever one system
// mouse), resolved via native MouseEvent.button rather than the Gamepad API.
export interface MouseButtonBinding {
  button: number; // MouseEvent.button: 0=left, 1=middle, 2=right, 3=back, 4=forward
  label: string;
}
export type MouseButtonMap = Partial<Record<ActionName, MouseButtonBinding>>;

// primaryFire ships bound to left-click by default — universal like a keyboard default, unlike
// axis/button joystick bindings which have no sane universal device.
export function defaultMouseButtonMap(): MouseButtonMap {
  return { primaryFire: { button: 0, label: 'Left Click' } };
}

// ---------- Joystick/gamepad device-binding shapes ----------
export interface ScDevice {
  instance: string;
  name: string;
  guid: string | null;
  vid: string | null;
  pid: string | null;
}

export interface GamepadSnapshot {
  index: number;
  id: string;
  axesValues: number[];
  buttonsPressed: boolean[];
  vid: string | null;
  pid: string | null;
}

// A stored reference to one physical device. vid/pid alone aren't unique when two identical
// devices are connected (e.g. two vJoy sticks both reporting the same USB IDs), so a manually
// captured binding also records a capability fingerprint (axis/button counts) — the same trick
// Joystick Gremlin uses to tell same-model devices apart. Not a GUID/serial; it's the best the
// Gamepad API exposes.
export interface DeviceRef {
  vid: string | null;
  pid: string | null;
  axisCount?: number;
  buttonCount?: number;
}

// Resolved from an imported actionmaps.xml: instance -> device -> best-effort letter-to-index
// guess (see joystickMap.ts's AXIS_INDEX).
export interface XmlAxisBinding {
  instance: string;
  axis: string;
  scName: string;
  manual?: false;
}
// Captured live by wiggling a stick — exact vid/pid/array-index, no letter-to-index guessing.
export interface ManualAxisBinding extends DeviceRef {
  axisIndex: number;
  label: string;
  manual: true;
}
export type AxisBinding = XmlAxisBinding | ManualAxisBinding;
export type AxisMap = Partial<Record<AxisConcept, AxisBinding>>;

export interface ButtonBinding extends DeviceRef {
  buttonIndex: number;
  label: string;
}
export type ButtonMap = Partial<Record<ActionName, ButtonBinding>>;

export interface StickAxes {
  lateral: number | null;
  vertical: number | null;
  longitudinal: number | null;
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
}
