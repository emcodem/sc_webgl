import type { DeviceRef, GamepadSnapshot } from './actions';

// ============================================================================================
// Thin wrapper around the browser's Gamepad API — generic HOTAS/gamepad support (no
// Star-Citizen-specific actionmaps.xml import; devices are bound by manually wiggling/pressing
// them, see joystickMap.ts). Ported from the original project's gamepadModule.ts, trimmed of its
// verbose vJoy-troubleshooting console logging.
//
// Caveats worth knowing:
//  - Chrome/Edge only reveal a gamepad to the page after it receives input from that device (a
//    privacy protection) — a stick plugged in but untouched won't appear yet.
//  - The Gamepad API's `id` string isn't standardized; both Chromium's "<name> (Vendor: xxxx
//    Product: yyyy)" and Firefox's "xxxx-yyyy-<name>" formats are parsed here.
//  - navigator.getGamepads() must be polled; there's no reliable per-frame change event.
// ============================================================================================

let snapshot: GamepadSnapshot[] = [];
const VID_PID_RE_CHROMIUM = /Vendor:\s*([0-9a-fA-F]{2,4}).*?Product:\s*([0-9a-fA-F]{2,4})/i;
const VID_PID_RE_FIREFOX = /^([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-/;

export function parseVidPid(id: string): { vid: string | null; pid: string | null } {
  const m = id.match(VID_PID_RE_CHROMIUM) || id.match(VID_PID_RE_FIREFOX);
  return {
    vid: m ? m[1].padStart(4, '0').toUpperCase() : null,
    pid: m ? m[2].padStart(4, '0').toUpperCase() : null
  };
}

export function isSupported(): boolean {
  return !!navigator.getGamepads;
}

export function poll(): void {
  if (!isSupported()) { snapshot = []; return; }
  const pads = navigator.getGamepads();
  snapshot = Array.from(pads)
    .filter((p): p is Gamepad => !!p)
    .map(p => ({
      index: p.index,
      id: p.id,
      axesValues: Array.from(p.axes),
      buttonsPressed: Array.from(p.buttons).map(b => b.pressed || b.value > 0.5),
      ...parseVidPid(p.id)
    }));
}

export function getSnapshot(): GamepadSnapshot[] {
  return snapshot;
}

// Nudges Chrome into surfacing non-XInput HID sticks the instant they connect/disconnect, and
// lets the controls panel refresh immediately rather than waiting for the next poll.
export function initConnectionListeners(onChange?: () => void): void {
  window.addEventListener('gamepadconnected', () => { poll(); onChange?.(); });
  window.addEventListener('gamepaddisconnected', () => { poll(); onChange?.(); });
}

// True when `pad` matches `ref`'s identity — same vid/pid and same capability fingerprint (axis/
// button counts). The count checks are skipped when the ref didn't record them, so an
// older-format binding still resolves by vid/pid alone.
function inDeviceGroup(pad: GamepadSnapshot, ref: DeviceRef): boolean {
  if (pad.vid !== ref.vid || pad.pid !== ref.pid) return false;
  if (ref.axisCount !== undefined && pad.axesValues.length !== ref.axisCount) return false;
  if (ref.buttonCount !== undefined && pad.buttonsPressed.length !== ref.buttonCount) return false;
  return true;
}

// Resolves a stored device reference to a live gamepad snapshot. Returns null if no matching
// device is currently seen. Two identically-configured devices sharing a fingerprint can't be
// told apart; the first match is returned as a best effort.
export function findDevice(ref: DeviceRef): GamepadSnapshot | null {
  return snapshot.find(p => inDeviceGroup(p, ref)) || null;
}

// Back-compat convenience for callers that only have a vid/pid and don't need to distinguish
// same-model devices (there's only ever one system mouse, one XML-imported device per instance).
export function findByVidPid(vid: string | null, pid: string | null): GamepadSnapshot | null {
  return findDevice({ vid, pid });
}

// Low-level picture of why a device may or may not be visible — surfaced in the detection panel
// so "connected but no input yet" is distinguishable from "not enumerated at all". Chrome is far
// stricter than Firefox: it only exposes gamepads on a secure origin and only delivers state to
// the focused document after a real button/axis press.
export interface GamepadDiagnostics {
  supported: boolean;
  secureContext: boolean;
  focused: boolean;
  rawSlotCount: number;
  activeCount: number;
}
export function getDiagnostics(): GamepadDiagnostics {
  const supported = isSupported();
  const raw = supported ? Array.from(navigator.getGamepads()) : [];
  return {
    supported,
    secureContext: !!window.isSecureContext,
    focused: document.hasFocus(),
    rawSlotCount: raw.length,
    activeCount: raw.filter(Boolean).length
  };
}
