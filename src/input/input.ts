// ============================================================================================
// Raw input: keyboard held-state + edge-triggered "just pressed", and pointer-lock relative mouse
// deltas (used by control/foot.ts's FPS-style look). This is the lowest layer everything else
// builds on: input/keybinds.ts queries held/justPressed by ActionName instead of a hardcoded key
// code, and input/mouseLook.ts/mouseButtons.ts run their own independent listeners for flight aim
// and rebindable mouse buttons respectively.
//
// Also owns the Ctrl-key guard: Ctrl is withheld from game input entirely until the mouse is
// captured (pointer lock) or the page is fullscreen, so the browser's own Ctrl+combos
// (copy/paste, address bar, etc.) work normally while you're not playing. See below for why
// fullscreen specifically, not capture, is what actually keeps Ctrl+W/Q from closing the tab —
// capture alone only makes Ctrl live as game input, it doesn't make it safe.
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
function flashCtrlWarning(message: string): void {
  const el = document.getElementById('ctrl-flash-warning') as HTMLElement;
  el.textContent = message;
  el.style.opacity = '1';
  if (ctrlFlashTimeout) clearTimeout(ctrlFlashTimeout);
  ctrlFlashTimeout = setTimeout(() => { el.style.opacity = '0'; }, 1400);
}

// Keyboard Lock (the only thing that can stop Ctrl+W reaching the browser) only arms in
// fullscreen — pointer lock alone doesn't count, and neither does merely blocking Ctrl from
// game input (that preventDefault is on the Ctrl keydown, not the browser's own Ctrl+W handling
// of the following W). So the same warning applies whether Ctrl is blocked or live: outside
// fullscreen, Ctrl+W is never actually safe. Specifically F2, not F11 — F11 is the browser's own
// native fullscreen, invisible to document.fullscreenElement/fullscreenchange, so it never arms
// Keyboard Lock; only the page-driven Fullscreen API (what F2 calls) does.
const CTRL_UNSAFE_MSG = '⚠ Ctrl+W still closes this tab here — press F2 (not F11) to protect it';

const keyboardLockSupported = !!(navigator.keyboard && navigator.keyboard.lock);

// Best-effort: Chromium only actually withholds Ctrl+W/Q from the browser UI while the document
// is also in fullscreen — outside fullscreen this request has no visible effect, but it's
// harmless to ask regardless of that state. Shared by both the pointer-lock capture path below
// and buttonBar.ts's F2 fullscreen toggle, since either one alone can put the page in a state
// where these combos should be withheld.
export function requestKeyboardLock(): void {
  if (keyboardLockSupported) {
    navigator.keyboard!.lock(['ControlLeft', 'ControlRight', 'KeyW', 'KeyQ']).catch((err) => {
      console.warn('Keyboard lock failed:', err);
    });
  }
}
export function releaseKeyboardLock(): void {
  if (keyboardLockSupported) {
    try { navigator.keyboard!.unlock(); } catch { /* ignore */ }
  }
}

export function initInput(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (e) => {
    const isCtrlCode = e.code === 'ControlLeft' || e.code === 'ControlRight';
    const fullscreen = document.fullscreenElement != null;
    // Either capture or fullscreen counts as "playing" for Ctrl purposes — buttonBar.ts's F2
    // fullscreen toggle supports flying without ever pointer-locking the canvas, so gating this
    // on `captured` alone used to leave fullscreen-only sessions with Ctrl wrongly blocked.
    const inputEnabled = captured || fullscreen;

    // Browsers won't let any page block Ctrl+W (close tab) or Ctrl+Q (quit) via preventDefault
    // outside this state, so keep Ctrl out of game input entirely until capture or fullscreen
    // engages — that's the only thing this branch buys: not letting a bare Ctrl register as
    // game input while you're not playing.
    if (isCtrlCode && !inputEnabled) {
      e.preventDefault();
      if (!e.repeat) flashCtrlWarning(CTRL_UNSAFE_MSG);
      return;
    }

    // Playing but not fullscreen: Ctrl is live game input below, but Ctrl+W genuinely can still
    // close the tab here. Keep warning on every press rather than just once — this is the state
    // most likely to cause an accidental close.
    if (isCtrlCode && !fullscreen && !e.repeat) flashCtrlWarning(CTRL_UNSAFE_MSG);

    // While not playing, Ctrl isn't bound to any game action, so a Ctrl/Cmd-held combo (Ctrl+C,
    // Ctrl+V, Ctrl+A, etc.) is standard browser behavior, not game input — leave it alone
    // entirely rather than falling through to held/justPressed + the scroll-key preventDefault
    // below. Once playing, Ctrl combos are real game input (e.g. a rebound Ctrl+<key> chord), so
    // don't skip them there.
    if ((e.ctrlKey || e.metaKey) && !isCtrlCode && !inputEnabled) return;

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
    // Keyboard lock is also requested/released by buttonBar.ts's fullscreenchange handler — only
    // release here if fullscreen isn't independently holding it too.
    if (captured) requestKeyboardLock();
    else if (!document.fullscreenElement) releaseKeyboardLock();
  });
  document.addEventListener('mousemove', (e) => {
    if (!captured) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  });

  // dropping focus/visibility clears held keys so nothing sticks "on"
  window.addEventListener('blur', () => { held.clear(); });

  // Cross-browser fallback for accidental Ctrl+W/Q: unlike Keyboard Lock (Chromium + fullscreen
  // only), a beforeunload listener forces the browser's native "leave site?" confirmation on tab
  // close/reload in effectively every browser. Gated on the same captured-or-fullscreen check as
  // the Ctrl warning above — only prompt while actually playing, so it doesn't nag on every dev
  // reload/link click while idle at the menu. Custom returnValue text is ignored by modern
  // browsers (they show their own generic prompt), but the confirmation dialog itself appears.
  window.addEventListener('beforeunload', (e) => {
    if (!captured && !document.fullscreenElement) return;
    e.preventDefault();
    e.returnValue = '';
  });
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
