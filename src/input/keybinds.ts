import type { ActionName, KeyBindings, KeyChord } from './actions';
import { ACTION_LABELS, defaultKeyBindings } from './actions';
import { registerConfig } from './configRegistry';
import * as Input from './input';

// ============================================================================================
// Rebindable keyboard layer, sitting on top of input/input.ts's raw held/justPressed key state.
// Everywhere that used to check a hardcoded KeyboardEvent.code now checks an ActionName here
// instead, so control/pilot.ts, foot.ts, and mode.ts never hardcode a key again.
// ============================================================================================

let KEYBINDS: KeyBindings = defaultKeyBindings();

registerConfig({
  key: 'keybinds',
  serialize: () => KEYBINDS,
  // merge over defaults (not replace outright) so a config saved before a new action existed
  // still leaves that action at its default chord instead of undefined
  deserialize: (data) => { KEYBINDS = { ...defaultKeyBindings(), ...(data as Partial<KeyBindings>) }; },
  resetToDefault: () => resetToDefault() // hoisted function declaration below, not a self-reference
});

export function isActive(action: ActionName): boolean {
  const chords = KEYBINDS[action];
  return chords.some(chord => chord.length > 0 && chord.every(code => Input.isDown(code)));
}

// Edge-triggered: the chord is fully held AND at least one of its keys was pressed THIS frame —
// so holding a multi-key chord doesn't refire every frame past the initial press.
export function justPressed(action: ActionName): boolean {
  const chords = KEYBINDS[action];
  return chords.some(chord =>
    chord.length > 0 && chord.every(code => Input.isDown(code)) && chord.some(code => Input.justPressed(code))
  );
}

// -1..1 from a bound key pair, keyed by ActionName rather than raw key code — additive with
// mouse/joystick contributions to the same axis concept (see control/pilot.ts).
export function digitalAxis(negAction: ActionName, posAction: ActionName): number {
  return (isActive(posAction) ? 1 : 0) - (isActive(negAction) ? 1 : 0);
}

export function getBindings(): KeyBindings {
  return KEYBINDS;
}

export function setBinding(action: ActionName, chords: KeyChord[]): void {
  KEYBINDS[action] = chords;
}

export function resetToDefault(): void {
  KEYBINDS = defaultKeyBindings();
}

export function getActionLabels(): Record<ActionName, string> {
  return ACTION_LABELS;
}

function codeToLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return ({
    ShiftLeft: 'Shift', ShiftRight: 'RShift', ControlLeft: 'Ctrl', ControlRight: 'RCtrl',
    AltLeft: 'Alt', AltRight: 'RAlt', Space: 'Space'
  } as Record<string, string>)[code] || code;
}

export function chordToLabel(chord: KeyChord): string {
  return chord.map(codeToLabel).join('+');
}

// e.g. [['ShiftLeft'], ['ShiftRight']] -> "Shift or RShift"; [] -> "—"
export function bindingLabel(action: ActionName): string {
  const chords = KEYBINDS[action];
  if (!chords.length) return '—';
  return chords.map(chordToLabel).join(' or ');
}
