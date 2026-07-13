import type {
  ActionName, AxisBinding, AxisConcept, AxisMap, ButtonBinding, ButtonMap, ScDevice
} from './actions';
import { registerConfig } from './configRegistry';
import { findByVidPid, findDevice } from './gamepad';

// ============================================================================================
// Shared mutable joystick state: which physical devices the last-imported actionmaps.xml
// referenced, and which axis/button is bound to which sim concept/action. Ported from the
// original project's input/deviceState.ts + input/joystickAxes.ts + input/joystickButtons.ts.
// ============================================================================================

let scDevices: ScDevice[] = []; // devices parsed from the last-imported actionmaps.xml
let axisMap: AxisMap = {};
let buttonMap: ButtonMap = {};

export function getScDevices(): ScDevice[] {
  return scDevices;
}
export function setScDevices(devices: ScDevice[]): void {
  scDevices = devices;
}
export function getAxisMap(): AxisMap {
  return axisMap;
}
export function setAxisMap(map: AxisMap): void {
  axisMap = map;
}
export function bindAxis(concept: AxisConcept, binding: AxisBinding): void {
  axisMap[concept] = binding;
}
export function unbindAxis(concept: AxisConcept): void {
  delete axisMap[concept];
}
export function getButtonMap(): ButtonMap {
  return buttonMap;
}
export function bindButton(action: ActionName, binding: ButtonBinding): void {
  buttonMap[action] = binding;
}
export function unbindButton(action: ActionName): void {
  delete buttonMap[action];
}

registerConfig({
  key: 'axisMap',
  serialize: () => axisMap,
  deserialize: (data) => { axisMap = (data as AxisMap) || {}; }
});
registerConfig({
  key: 'buttonMap',
  serialize: () => buttonMap,
  deserialize: (data) => { buttonMap = (data as ButtonMap) || {}; }
});
// scDevices looks like session-detected metadata, but it's load-bearing: an XML-derived axis
// binding only stores an actionmaps.xml `instance` number, and readAxisFor below resolves that to
// a vid/pid via this list. Without it surviving a reload, every non-manually-captured axis
// binding silently goes dead even though the binding itself still shows as "bound" in the panel.
registerConfig({
  key: 'scDevices',
  serialize: () => scDevices,
  deserialize: (data) => { scDevices = (data as ScDevice[]) || []; }
});

// ---------- Live analog axis resolution ----------
// Known unknown: which array index in gamepad.axes corresponds to which physical axis (X, Y,
// twist/Z, etc.) is NOT guaranteed by any spec — it depends on the device's HID descriptor and OS
// driver. AXIS_INDEX below is a reasonable default guess (the common DirectInput ordering), used
// only for XML-imported bindings; manually-captured bindings observe the exact index live and
// don't need this guess at all.
const DEADZONE = 0.08;
const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, rotx: 3, roty: 4, rotz: 5, slider1: 6, slider2: 7 };
// Not persisted (matches the original project — a fresh load always starts from these defaults).
const invert: Record<AxisConcept, boolean> = {
  strafeLateral: false, strafeVertical: true, strafeLongitudinal: false,
  pitch: false, yaw: false, roll: false
};

function readAxisFor(concept: AxisConcept): number | null {
  const binding = axisMap[concept];
  if (!binding) return null; // not bound to any joystick

  let pad: ReturnType<typeof findByVidPid>, idx: number | undefined;
  if (binding.manual) {
    // manually captured via live axis-wiggle detection — exact vid/pid/index, no letter-to-index
    // guessing. Resolved via the device fingerprint so two physically-identical sticks don't collide.
    pad = findDevice(binding);
    idx = binding.axisIndex;
  } else {
    // resolved from an imported actionmaps.xml: instance -> device -> best-effort letter-to-index
    // guess (AXIS_INDEX above). No per-device discriminator here (the XML only carries a vid/pid
    // via ScDevice), so identical devices can't be told apart on this path.
    const dev = scDevices.find(d => d.instance === binding.instance);
    if (!dev || !dev.vid) return null;
    pad = findByVidPid(dev.vid, dev.pid);
    idx = AXIS_INDEX[binding.axis];
  }

  if (!pad) return null; // device known, but not currently seen by the browser
  if (idx === undefined || idx >= pad.axesValues.length) return null;
  let v = pad.axesValues[idx];
  if (Math.abs(v) < DEADZONE) v = 0;
  if (invert[concept]) v = -v;
  return v;
}

export function readAxis(concept: AxisConcept): number {
  return readAxisFor(concept) ?? 0; // 0 if unbound/not detected — additive at the call site, never exclusive
}

export function read() {
  return {
    lateral: readAxisFor('strafeLateral'),
    vertical: readAxisFor('strafeVertical'),
    longitudinal: readAxisFor('strafeLongitudinal'),
    pitch: readAxisFor('pitch'),
    yaw: readAxisFor('yaw'),
    roll: readAxisFor('roll')
  };
}

export function setInvert(concept: AxisConcept, val: boolean): void {
  invert[concept] = val;
}
export function getInvert(): Record<AxisConcept, boolean> {
  return invert;
}

// ---------- Buttons: two read modes ----------
// `justPressed` edge-detects the same way keyboard presses are, for real toggle actions like
// decoupleToggle; `isPressed` is a plain hold check, for actions like spaceBrake that should only
// be active while held down.
export function isButtonPressed(action: ActionName): boolean {
  const binding = buttonMap[action];
  if (!binding) return false;
  const pad = findDevice(binding);
  if (!pad || binding.buttonIndex >= pad.buttonsPressed.length) return false;
  return pad.buttonsPressed[binding.buttonIndex];
}

const prevPressed: Partial<Record<ActionName, boolean>> = {};
export function buttonJustPressed(action: ActionName): boolean {
  const pressed = isButtonPressed(action);
  const wasPressed = !!prevPressed[action];
  prevPressed[action] = pressed;
  return pressed && !wasPressed;
}
