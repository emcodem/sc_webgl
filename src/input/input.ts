// ============================================================================================
// Raw input: keyboard held-state + edge-triggered "just pressed", and pointer-lock relative mouse
// deltas (used by control/foot.ts's FPS-style look). This is the lowest layer everything else
// builds on: input/keybinds.ts queries held/justPressed by ActionName instead of a hardcoded key
// code, and input/mouseLook.ts/mouseButtons.ts run their own independent listeners for flight aim
// and rebindable mouse buttons respectively.
// ============================================================================================

const held = new Set<string>();
const justPressedSet = new Set<string>();
let mouseDX = 0;
let mouseDY = 0;
let captured = false;

export function initInput(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (e) => {
    // ignore OS auto-repeat for edge detection, but keep held-state true
    if (!e.repeat) justPressedSet.add(e.code);
    held.add(e.code);
    // stop the page from scrolling on arrows/space while playing
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { held.delete(e.code); });

  // click to capture the mouse (pointer lock); once captured, movement drives look/aim
  canvas.addEventListener('click', () => {
    if (!captured) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    captured = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', (e) => {
    if (!captured) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  });

  // dropping focus/visibility clears held keys so nothing sticks "on"
  window.addEventListener('blur', () => { held.clear(); });
}

const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
]);

export function isDown(code: string): boolean {
  return held.has(code);
}

// True exactly once for the frame a key went down. Cleared by endFrame().
export function justPressed(code: string): boolean {
  return justPressedSet.has(code);
}

// Accumulated pointer-lock movement since the last call, then reset. Only the active-mode
// controller should call this so deltas aren't double-consumed.
export function consumeMouse(): { dx: number; dy: number } {
  const out = { dx: mouseDX, dy: mouseDY };
  mouseDX = 0;
  mouseDY = 0;
  return out;
}

export function isCaptured(): boolean {
  return captured;
}

// Called at the very end of each frame to clear edge-triggered state.
export function endFrame(): void {
  justPressedSet.clear();
}

// -1..1 axis from a negative/positive key pair (held).
export function axis(negCode: string, posCode: string): number {
  return (held.has(posCode) ? 1 : 0) - (held.has(negCode) ? 1 : 0);
}
