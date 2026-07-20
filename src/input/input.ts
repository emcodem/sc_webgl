// ============================================================================================
// Raw input: keyboard held-state + edge-triggered "just pressed", and pointer-lock relative mouse
// deltas (used by control/foot.ts's FPS-style look). This is the lowest layer everything else
// builds on: input/keybinds.ts queries held/justPressed by ActionName instead of a hardcoded key
// code, and input/mouseLook.ts/mouseButtons.ts run their own independent listeners for flight aim
// and rebindable mouse buttons respectively.
//
// Also owns the Ctrl-key guard: Ctrl is withheld from game input entirely until the mouse is
// captured (pointer lock), so the browser's own Ctrl+combos (copy/paste, address bar, etc.) work
// normally while you're not playing. See below for why capture, not this, is what actually keeps
// Ctrl+W/Q from closing the tab.
// ============================================================================================

// Keyboard Lock API — Chromium-only, experimental, not in lib.dom.d.ts.
declare global {
  interface Navigator {
    keyboard?: {
      lock(codes: string[]): Promise<void>;
      unlock(): void;
    };
  }
}

const held = new Set<string>();
const justPressedSet = new Set<string>();
let mouseDX = 0;
let mouseDY = 0;
let captured = false;

let ctrlFlashTimeout: ReturnType<typeof setTimeout> | null = null;
function flashCtrlDisabledWarning(): void {
  const el = document.getElementById('ctrl-flash-warning') as HTMLElement;
  el.style.opacity = '1';
  if (ctrlFlashTimeout) clearTimeout(ctrlFlashTimeout);
  ctrlFlashTimeout = setTimeout(() => { el.style.opacity = '0'; }, 700);
}

const keyboardLockSupported = !!(navigator.keyboard && navigator.keyboard.lock);

export function initInput(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (e) => {
    const isCtrlCode = e.code === 'ControlLeft' || e.code === 'ControlRight';

    // Ctrl is disabled outside capture — browsers won't let any page block Ctrl+W (close tab)
    // or Ctrl+Q (quit) via preventDefault; the Keyboard Lock request fired on capture below is
    // the only real protection (and even that needs Chromium + fullscreen to actually take
    // effect). So the only thing this branch buys us is not letting a bare Ctrl register as
    // game input until capture is engaged.
    if (isCtrlCode && !captured) {
      e.preventDefault();
      if (!e.repeat) flashCtrlDisabledWarning();
      return;
    }

    // Outside capture, Ctrl isn't bound to any game action, so a Ctrl/Cmd-held combo (Ctrl+C,
    // Ctrl+V, Ctrl+A, etc.) is standard browser behavior, not game input — leave it alone
    // entirely rather than falling through to held/justPressed + the scroll-key preventDefault
    // below. Once captured, Ctrl combos are real game input (e.g. a rebound Ctrl+<key> chord),
    // so don't skip them there.
    if ((e.ctrlKey || e.metaKey) && !isCtrlCode && !captured) return;

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
    if (captured) {
      // Best-effort: Chromium only actually withholds Ctrl+W/Q from the browser UI while the
      // document is also in fullscreen (F2) — outside fullscreen this request has no visible
      // effect, but it's harmless to ask regardless of that state.
      if (keyboardLockSupported) {
        navigator.keyboard!.lock(['ControlLeft', 'ControlRight', 'KeyW', 'KeyQ']).catch((err) => {
          console.warn('Keyboard lock failed:', err);
        });
      }
    } else if (keyboardLockSupported) {
      try { navigator.keyboard!.unlock(); } catch { /* ignore */ }
    }
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

// Discard any accumulated pointer-lock movement. Only foot mode calls consumeMouse(), so the
// deltas pile up unconsumed through an entire pilot session; without this, the first on-foot frame
// after disembarking would apply the whole backlog at once as one violent look snap. Call on any
// switch into a mode that reads these relative deltas.
export function resetMouseDeltas(): void {
  mouseDX = 0;
  mouseDY = 0;
}

export function isCaptured(): boolean {
  return captured;
}

// Called at the very end of each frame to clear edge-triggered state.
export function endFrame(): void {
  justPressedSet.clear();
}
