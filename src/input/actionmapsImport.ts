import type { ActionName, AxisConcept, AxisMap, KeyChord, ScDevice, XmlAxisBinding } from './actions';

// ============================================================================================
// Star Citizen actionmaps.xml import — ported from the original project's input/controlsModule.ts
// XML-parsing functions. SC only writes REBOUND actions into actionmaps.xml, not defaults — so a
// file where the player never touched keyboard flight controls may have nothing to import for
// some actions. The action-name-to-sim-control table below is a best-effort mapping based on
// commonly known SC action identifiers; it isn't guaranteed to match every game version. Anything
// not found is reported plainly rather than silently guessed at.
// ============================================================================================

export interface ParsedActionMaps {
  actionsRaw: Record<string, string[]>;
}
export type AxisRaw = Record<string, { instance: string; axis: string }[]>;

export interface MatchedOverride {
  simAction: ActionName;
  scName: string;
  chords: KeyChord[];
}
export interface NotFoundOverride {
  simAction: ActionName;
  candidates: string[];
}
export interface BuiltOverrides {
  overrides: Partial<Record<ActionName, KeyChord[]>>;
  matched: MatchedOverride[];
  notFound: NotFoundOverride[];
}

// Best-effort mapping from our sim actions to real SC action identifiers. Ordered lists — first
// one found in the uploaded file wins. `jump` has no SC equivalent (this project's on-foot mode
// doesn't exist in the original) so it's simply never matched by an import.
const ACTION_NAME_CANDIDATES: Partial<Record<ActionName, string[]>> = {
  pitchUp: ['v_pitch_up'],
  pitchDown: ['v_pitch_down'],
  yawLeft: ['v_yaw_left'],
  yawRight: ['v_yaw_right'],
  rollLeft: ['v_roll_left'],
  rollRight: ['v_roll_right'],
  strafeForward: ['v_strafe_forward', 'v_throttle_up'],
  strafeBack: ['v_strafe_back', 'v_throttle_down'],
  strafeLeft: ['v_strafe_left'],
  strafeRight: ['v_strafe_right'],
  strafeUp: ['v_strafe_up'],
  strafeDown: ['v_strafe_down'],
  decoupleToggle: ['v_ifcs_vector_decoupling_toggle'],
  spaceBrake: ['v_space_brake'],
  boost: ['v_afterburner'],
  primaryFire: ['v_attack1'],
  interact: ['v_use']
};

const TOKEN_TO_CODE: Record<string, string> = {
  lshift: 'ShiftLeft', rshift: 'ShiftRight',
  lctrl: 'ControlLeft', rctrl: 'ControlRight',
  lalt: 'AltLeft', ralt: 'AltRight',
  space: 'Space',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  equals: 'Equal', minus: 'Minus',
  period: 'Period', comma: 'Comma',
  backslash: 'Backslash', slash: 'Slash',
  lbracket: 'BracketLeft', rbracket: 'BracketRight',
  semicolon: 'Semicolon', apostrophe: 'Quote',
  tab: 'Tab', capslock: 'CapsLock', backspace: 'Backspace',
  enter: 'Enter', escape: 'Escape', grave: 'Backquote'
};

export function tokenToCode(tok: string | null | undefined): string | null {
  if (!tok) return null;
  tok = tok.trim().toLowerCase();
  if (!tok) return null;
  if (TOKEN_TO_CODE[tok]) return TOKEN_TO_CODE[tok];
  if (/^[a-z]$/.test(tok)) return 'Key' + tok.toUpperCase();
  if (/^[0-9]$/.test(tok)) return 'Digit' + tok;
  const fMatch = tok.match(/^f([1-9]|1[0-9]|2[0-4])$/);
  if (fMatch) return 'F' + fMatch[1];
  return null; // mouse buttons / unsupported tokens — not usable as a keyboard chord
}

export function inputStringToChord(inputStr: string): KeyChord | null {
  // e.g. "kb1_lshift+right" -> ['ShiftLeft','ArrowRight']
  const parts = inputStr.replace(/^kb1_/, '').split('+');
  const codes = parts.map(tokenToCode);
  if (codes.some(c => !c)) return null; // unsupported token in this chord — skip it
  return codes as string[];
}

function parseXmlDoc(xmlText: string): Document {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) throw new Error('Could not parse XML file.');
  return doc;
}

export function parseActionMapsXML(xmlText: string): ParsedActionMaps {
  const doc = parseXmlDoc(xmlText);
  const actionsRaw: Record<string, string[]> = {}; // scActionName -> array of raw "kb1_..." input strings
  doc.querySelectorAll('actionmap > action').forEach((actionEl) => {
    const name = actionEl.getAttribute('name');
    if (!name) return;
    const kbInputs = Array.from(actionEl.querySelectorAll('rebind'))
      .map(r => r.getAttribute('input'))
      .filter((s): s is string => !!s && s.startsWith('kb1_'));
    if (kbInputs.length) {
      actionsRaw[name] = (actionsRaw[name] || []).concat(kbInputs);
    }
  });
  return { actionsRaw };
}

// Extracts the joystick devices SC knows about from <options type="joystick" .../>. The Product
// attribute looks like " VKBsim Gladiator EVO L    {0201231D-0000-0000-0000-504944564944}". That
// GUID is Windows' DirectInput device-instance GUID: the first 8 hex digits are ProductID+VendorID
// back to back (both as 4-hex little bits), and the trailing "504944564944" is literally the ASCII
// bytes for "PIDVID" — a fixed DirectInput suffix, not device-specific. We split the first 8 chars
// in half to recover PID and VID.
export function parseJoystickDevices(xmlText: string): ScDevice[] {
  const doc = parseXmlDoc(xmlText);
  const devices: ScDevice[] = [];
  doc.querySelectorAll('options[type="joystick"]').forEach((el) => {
    const instance = el.getAttribute('instance') ?? '';
    const product = (el.getAttribute('Product') || '').trim();
    if (!product) return; // empty slot, e.g. instance="3" with no Product attribute at all
    const m = product.match(/^(.*?)\s*\{([0-9A-Fa-f]{8})-0000-0000-0000-504944564944\}$/);
    if (!m) { devices.push({ instance, name: product, guid: null, vid: null, pid: null }); return; }
    const name = m[1].trim();
    const hex8 = m[2].toUpperCase();
    const pid = hex8.slice(0, 4);
    const vid = hex8.slice(4, 8);
    devices.push({ instance, name, guid: m[2], vid, pid });
  });
  return devices;
}

// Extracts joystick AXIS bindings (as opposed to keyboard chords) for the handful of sim concepts
// that can plausibly be analog: strafe lateral/vertical/longitudinal, plus pitch/yaw/roll in case
// a future profile binds those to a stick too. Real SC axis tokens look like "js1_x", "js2_rotz"
// etc — a blank placeholder like "js1_ " (no letter) means the action exists but was never
// actually bound, and won't match.
const AXIS_TOKEN_RE = /^js(\d+)_(x|y|z|rotx|roty|rotz|slider1|slider2)$/i;
const AXIS_ACTION_CANDIDATES: Record<AxisConcept, string[]> = {
  strafeLateral: ['v_strafe_lateral'],
  strafeVertical: ['v_strafe_vertical'],
  strafeLongitudinal: ['v_strafe_longitudinal'],
  pitch: ['v_pitch'],
  yaw: ['v_yaw'],
  roll: ['v_roll']
};

export function parseJoystickAxisBindings(xmlText: string): AxisRaw {
  const doc = parseXmlDoc(xmlText);
  const axisRaw: AxisRaw = {}; // scActionName -> [{instance, axis}, ...]
  doc.querySelectorAll('actionmap > action').forEach((actionEl) => {
    const name = actionEl.getAttribute('name');
    if (!name) return;
    Array.from(actionEl.querySelectorAll('rebind')).forEach((r) => {
      const input = (r.getAttribute('input') || '').trim();
      const m = input.match(AXIS_TOKEN_RE);
      if (m) (axisRaw[name] = axisRaw[name] || []).push({ instance: m[1], axis: m[2].toLowerCase() });
    });
  });
  return axisRaw;
}

export function buildAxisMap(axisRaw: AxisRaw): AxisMap {
  const map: AxisMap = {};
  for (const concept of Object.keys(AXIS_ACTION_CANDIDATES) as AxisConcept[]) {
    for (const cand of AXIS_ACTION_CANDIDATES[concept]) {
      if (axisRaw[cand] && axisRaw[cand].length) {
        const binding: XmlAxisBinding = { instance: axisRaw[cand][0].instance, axis: axisRaw[cand][0].axis, scName: cand };
        map[concept] = binding;
        break;
      }
    }
  }
  return map;
}

export function buildOverridesFromParsed(parsed: ParsedActionMaps): BuiltOverrides {
  // Automatically matches file actions to sim actions via the best-effort name table above.
  // Returns what matched (and will be applied) plus what wasn't found, so the import result is
  // transparent even though it's applied automatically.
  const overrides: Partial<Record<ActionName, KeyChord[]>> = {};
  const matched: MatchedOverride[] = [];
  const notFound: NotFoundOverride[] = [];
  for (const simAction of Object.keys(ACTION_NAME_CANDIDATES) as ActionName[]) {
    const candidates = ACTION_NAME_CANDIDATES[simAction]!;
    let scName: string | null = null;
    let rawInputs: string[] | null = null;
    for (const cand of candidates) {
      if (parsed.actionsRaw[cand]) { scName = cand; rawInputs = parsed.actionsRaw[cand]; break; }
    }
    if (rawInputs) {
      const chords = rawInputs.map(inputStringToChord).filter((c): c is KeyChord => !!c);
      if (chords.length) {
        overrides[simAction] = chords;
        matched.push({ simAction, scName: scName as string, chords });
        continue;
      }
    }
    notFound.push({ simAction, candidates });
  }
  return { overrides, matched, notFound };
}
