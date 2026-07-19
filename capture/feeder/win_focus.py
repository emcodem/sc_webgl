"""Bring the Star Citizen window to the foreground and left-click it, so injected mouse motion
actually reaches flight input. REQUIRED before any measurement sweep: if the game isn't the focused
window, SendInput mouse motion goes nowhere useful and the indicator never moves (invalidated two
baseline captures before this existed).

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


def _foreground(substr: str) -> tuple[int, str]:
    wins = find_windows(substr)
    if not wins:
        raise RuntimeError(f"no visible window matching {substr!r} -- is Star Citizen running/visible?")
    hwnd, title = wins[0]
    _u.ShowWindow(hwnd, SW_RESTORE)
    _u.SetForegroundWindow(hwnd)
    _u.BringWindowToTop(hwnd)
    time.sleep(0.3)
    return hwnd, title


def focus_no_click(substr: str = "Star Citizen", esc_reset: bool = True, verbose: bool = True) -> str:
    """Bring SC to the foreground (so injected KEYBOARD input actually lands) WITHOUT clicking the
    reticle -- for keyboard-driven captures (roll = Q/E) near a station where the center-click of
    focus_and_click would fire a shot into it (crimestat at a security post). Keyboard SendInput only
    needs SC foregrounded, not the cursor captured, so no click is required. Esc x2 still resets any
    residual mouse-look stick deflection (skippable via esc_reset=False)."""
    hwnd, title = _foreground(substr)
    if esc_reset:
        _press_esc()
        time.sleep(1.0)
        _press_esc()
        time.sleep(0.5)
    if verbose:
        print(f"foregrounded '{title}' (no click)")
    return title


def focus_and_click(substr: str = "Star Citizen", verbose: bool = True) -> str:
    hwnd, title = _foreground(substr)
    # Esc x2 resets the mouse virtual joystick to neutral -- clears any residual deflection left from
    # where the real mouse was pointing (a residual pitch once drifted the ship down mid-sweep and
    # lost the landmark behind the cockpit). First Esc opens the menu, second closes it back to flight.
    _press_esc()
    time.sleep(1.0)   # let the menu fully open before the second Esc closes it
    _press_esc()
    time.sleep(0.5)
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
        print(f"focused + clicked '{title}' (center {cx},{cy})")
    return title


if __name__ == "__main__":
    focus_and_click()
