"""Bring the Star Citizen window to the foreground and left-click it, so injected mouse motion
actually reaches flight input. REQUIRED before any measurement sweep: if the game isn't the focused
window, SendInput mouse motion goes nowhere useful and the indicator never moves (invalidated two
baseline captures before this existed).

Both `focus_and_click` and `focus_no_click` show a blocking native "ready?" popup (see
`confirm_switch_to_sc`) before touching the game -- a deliberate confirmation step before a script
silently grabs the foreground and starts injecting real mouse/keyboard input, added 2026-07-26 after
a session where the operator's own in-progress mouse movement collided with a capture script's.
Every capture script should reach the game through one of these two functions (not hand-roll its own
foreground/focus logic) so this confirmation is never accidentally skipped.

NOTE: the click lands at the window center = the flight reticle, so if weapons are armed it will
fire a shot. That's accepted as the cost of guaranteeing focus (harald's call). Disarm/holster if a
stray shot matters for the scene being recorded.
"""

import ctypes
import time
from ctypes import wintypes

_u = ctypes.windll.user32

SW_RESTORE = 9
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
ESC_SCAN = 0x01  # Escape hardware scan code


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class _MOUSEINPUT(ctypes.Structure):
    # only here to size the union correctly -- the real Win32 INPUT union is sized for MOUSEINPUT
    # (its largest member), so a keyboard-only union makes sizeof(INPUT) too small and SendInput
    # rejects it (returns 0). On 64-bit sizeof(INPUT) must be 40.
    _fields_ = [
        ("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class _KI_UNION(ctypes.Union):
    _fields_ = [("ki", _KEYBDINPUT), ("mi", _MOUSEINPUT)]


class _KINPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _KI_UNION)]


def _send_scan(scan: int, key_up: bool) -> None:
    """Inject a keyboard event by SCAN CODE via SendInput -- games that read raw/DirectInput
    (Star Citizen) ignore keybd_event VK injections, so use the same SendInput path the mouse uses."""
    flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if key_up else 0)
    extra = ctypes.c_ulong(0)
    ki = _KEYBDINPUT(0, scan, flags, 0, ctypes.pointer(extra))
    inp = _KINPUT(type=INPUT_KEYBOARD, u=_KI_UNION(ki=ki))
    _u.SendInput(1, ctypes.byref(inp), ctypes.sizeof(_KINPUT))


def _press_esc() -> None:
    _send_scan(ESC_SCAN, False)
    time.sleep(0.05)
    _send_scan(ESC_SCAN, True)


MB_OK = 0x00000000
MB_ICONINFORMATION = 0x00000040
MB_TOPMOST = 0x00040000
MB_SETFOREGROUND = 0x00010000


def confirm_switch_to_sc(message: str = "About to switch to Star Citizen and drive input. Ready?") -> None:
    """Blocking native Windows popup (an OK-only MessageBox) the operator must dismiss before any
    capture script touches the game. Gives a deliberate moment to tab over, close anything that
    might steal focus mid-capture, and consciously confirm before real mouse/keyboard events start
    flowing into SC -- rather than a script silently grabbing the foreground and injecting input the
    instant it's launched. Every capture script should get this via `_foreground()` (used by both
    `focus_and_click` and `focus_no_click` below) rather than calling it directly."""
    _u.MessageBoxW(0, message, "sc_webgl capture — ready?", MB_OK | MB_ICONINFORMATION | MB_TOPMOST | MB_SETFOREGROUND)


def find_windows(substr: str = "Star Citizen") -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    def cb(hwnd, _lparam):
        if _u.IsWindowVisible(hwnd):
            n = _u.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                _u.GetWindowTextW(hwnd, buf, n + 1)
                if substr.lower() in buf.value.lower():
                    out.append((hwnd, buf.value))
        return True

    _u.EnumWindows(CB(cb), 0)
    return out


def _foreground(substr: str, confirm: bool = True) -> tuple[int, str]:
    if confirm:
        confirm_switch_to_sc()
    wins = find_windows(substr)
    if not wins:
        raise RuntimeError(f"no visible window matching {substr!r} -- is Star Citizen running/visible?")
    hwnd, title = wins[0]
    _u.ShowWindow(hwnd, SW_RESTORE)
    _u.SetForegroundWindow(hwnd)
    _u.BringWindowToTop(hwnd)
    time.sleep(0.3)
    return hwnd, title


def ready_and_reset(substr: str = "Star Citizen", esc_reset: bool = True, confirm: bool = True) -> tuple[int, str]:
    """Everything that must happen BEFORE OBS recording starts: the blocking "ready?" popup,
    foregrounding SC, and the Esc x2 mouse-joystick reset (skippable via esc_reset=False). Deliberately
    excludes the center-click (see click_center below) so a caller can start OBS recording in between --
    otherwise the recorded clip's leading seconds are however long the operator takes to dismiss the
    popup (observed anywhere from ~5s to 110s+ in practice), which silently breaks
    analysis/hold_rate.py's fixed-width auto-alignment search downstream. Every capture script should
    call this, then start OBS recording, then click_center (if needed), in that order -- never call
    obs_start before this."""
    hwnd, title = _foreground(substr, confirm=confirm)
    if esc_reset:
        # First Esc opens the menu, second closes it back to flight -- resets the mouse virtual
        # joystick to neutral, clearing any residual deflection left from where the real mouse was
        # pointing (a residual pitch once drifted the ship down mid-sweep and lost the landmark
        # behind the cockpit).
        _press_esc()
        time.sleep(1.0)   # let the menu fully open before the second Esc closes it
        _press_esc()
        time.sleep(0.5)
    return hwnd, title


def click_center(hwnd: int, verbose: bool = True) -> None:
    """Clicks the window's center (the flight reticle -- fires a shot if armed, see module
    docstring). Call this AFTER OBS recording has started (post ready_and_reset), so the click
    lands inside the recorded clip instead of during the variable-length pre-recording wait."""
    rect = wintypes.RECT()
    _u.GetWindowRect(hwnd, ctypes.byref(rect))
    cx, cy = (rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2
    _u.SetCursorPos(cx, cy)
    time.sleep(0.05)
    _u.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.03)
    _u.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(0.2)
    if verbose:
        print(f"clicked center ({cx},{cy})")


def focus_no_click(substr: str = "Star Citizen", esc_reset: bool = True, verbose: bool = True,
                    confirm: bool = True) -> str:
    """Bring SC to the foreground (so injected KEYBOARD input actually lands) WITHOUT clicking the
    reticle -- for keyboard-driven captures (roll = Q/E) near a station where a center-click would
    fire a shot into it (crimestat at a security post). Keyboard SendInput only needs SC
    foregrounded, not the cursor captured, so no click is required.

    NOTE: this bundles the popup+reset AND (implicitly) the "OBS not started yet" timing together --
    for anything that records video, prefer calling ready_and_reset() directly and starting OBS
    recording right after it returns, rather than this wrapper, so the recording doesn't include the
    operator's confirmation wait. Kept for non-recording callers (e.g. recenter.py)."""
    _, title = ready_and_reset(substr, esc_reset=esc_reset, confirm=confirm)
    if verbose:
        print(f"foregrounded '{title}' (no click)")
    return title


def focus_and_click(substr: str = "Star Citizen", verbose: bool = True, confirm: bool = True) -> str:
    """Shows a blocking "ready?" popup first (skippable via confirm=False, e.g. for a tight loop
    that already confirmed once), then forces SC to the foreground and clicks its center (the
    reticle -- fires a shot if armed, see module docstring).

    NOTE: for anything that records video, prefer calling ready_and_reset() + starting OBS recording
    + click_center() directly instead of this wrapper, so the recording doesn't include the
    operator's confirmation wait (see ready_and_reset's docstring). Kept for non-recording callers."""
    hwnd, title = ready_and_reset(substr, confirm=confirm)
    click_center(hwnd, verbose=False)
    if verbose:
        print(f"focused + clicked '{title}'")
    return title


if __name__ == "__main__":
    focus_and_click()
