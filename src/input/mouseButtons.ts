import type { ActionName, MouseButtonMap } from './actions';
import { defaultMouseButtonMap } from './actions';
import { registerConfig } from './configRegistry';

// ============================================================================================
// MouseButtons — same isPressed/justPressed shape as joystickMap's button functions, but resolved
// against native MouseEvent.button state instead of the Gamepad API (there's only ever one system
// mouse, so no vid/pid device lookup needed). Ported from the original project's mouseButtons.ts.
// ============================================================================================

let mouseButtonMap: MouseButtonMap = defaultMouseButtonMap();

registerConfig({
  key: 'mouseButtonMap',
  serialize: () => mouseButtonMap,
  // A config saved before this feature existed has no 'mouseButtonMap' key at all — fall back to
  // the default rather than leaving fire unbound.
  deserialize: (data) => { mouseButtonMap = (data as MouseButtonMap) || defaultMouseButtonMap(); }
});

const pressed: Record<number, boolean> = {};
window.addEventListener('mousedown', (e) => { pressed[e.button] = true; });
window.addEventListener('mouseup', (e) => { pressed[e.button] = false; });

export function getMouseButtonMap(): MouseButtonMap {
  return mouseButtonMap;
}
export function bindMouseButton(action: ActionName, binding: MouseButtonMap[ActionName]): void {
  mouseButtonMap[action] = binding;
}
export function unbindMouseButton(action: ActionName): void {
  delete mouseButtonMap[action];
}
export function resetToDefault(): void {
  mouseButtonMap = defaultMouseButtonMap();
}

export function isPressed(action: ActionName): boolean {
  const binding = mouseButtonMap[action];
  if (!binding) return false;
  return !!pressed[binding.button];
}

const prevPressed: Partial<Record<ActionName, boolean>> = {};
export function justPressed(action: ActionName): boolean {
  const isNowPressed = isPressed(action);
  const wasPressed = !!prevPressed[action];
  prevPressed[action] = isNowPressed;
  return isNowPressed && !wasPressed;
}

export function mouseButtonLabel(button: number): string {
  return ({ 0: 'Left Click', 1: 'Middle Click', 2: 'Right Click', 3: 'Back Button', 4: 'Forward Button' } as Record<number, string>)[button]
    || `Mouse Button ${button}`;
}
