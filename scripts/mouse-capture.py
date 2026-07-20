#!/usr/bin/env python3
"""
Mouse capture script for Windows — reads RAW RELATIVE mouse deltas (Win32 Raw
Input / WM_INPUT) and streams them via WebSocket to the Node.js relay server.

Why raw input (and NOT mouse.get_position()):
    Star Citizen's mouse-flight mode leaves the OS cursor free-floating (it reads
    the mouse via raw input and hides the pointer, but does not park/recenter it).
    Polling the absolute cursor position therefore SATURATES at the monitor edge:
    once the cursor is pinned against the right border, x can't grow, so dx = 0
    even though the physical mouse keeps moving — the classic "vjoy gets stuck at
    N% and won't go further" bug. Raw Input reports the physical device's motion
    directly, independent of the cursor position or screen borders, so every
    movement in real SC is mirrored 1:1 with no boundary cap.

Usage:
    npm run capture                       (auto-starts this alongside the relay)
    python scripts/mouse-capture.py [port] (standalone, e.g. against `npm run capture:relay`)

Dependencies:
    pip install websocket-client
    pip install pygetwindow   (optional — for Star-Citizen focus gating)
"""

import sys
import json
import time
import ctypes
import threading
from ctypes import wintypes
from websocket import WebSocketApp

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
WS_URL = f'ws://localhost:{PORT}/client'  # /client path is for the capture script

try:
    import pygetwindow
    HAS_WINDOW_DETECTION = True
except ImportError:
    HAS_WINDOW_DETECTION = False
    print("[WARN] 'pygetwindow' not installed. Window focus detection disabled.")
    print("[WARN] Run: pip install pygetwindow")

print("[INIT] Python raw-input mouse capture starting")
print(f"[INIT] Target: {WS_URL}")

# ---------------------------------------------------------------------------
# Shared state between the WM_INPUT window thread and the WebSocket sender.
# ---------------------------------------------------------------------------
_lock = threading.Lock()
accum_dx = 0
accum_dy = 0
running = True
ws = None

# ---------------------------------------------------------------------------
# Win32 Raw Input plumbing (ctypes).
# ---------------------------------------------------------------------------
user32 = ctypes.WinDLL('user32', use_last_error=True)
kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

WM_INPUT = 0x00FF
RID_INPUT = 0x10000003
RIM_TYPEMOUSE = 0
RIDEV_INPUTSINK = 0x00000100          # receive input even when not focused
MOUSE_MOVE_ABSOLUTE = 0x01            # usFlags bit: 0 => relative motion
HID_USAGE_PAGE_GENERIC = 0x01
HID_USAGE_GENERIC_MOUSE = 0x02

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT,
                             wintypes.WPARAM, wintypes.LPARAM)


class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [("usUsagePage", wintypes.USHORT),
                ("usUsage", wintypes.USHORT),
                ("dwFlags", wintypes.DWORD),
                ("hwndTarget", wintypes.HWND)]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [("dwType", wintypes.DWORD),
                ("dwSize", wintypes.DWORD),
                ("hDevice", wintypes.HANDLE),
                ("wParam", wintypes.WPARAM)]


class _RAWMOUSE_BUTTONS(ctypes.Structure):
    _fields_ = [("usButtonFlags", wintypes.USHORT),
                ("usButtonData", wintypes.USHORT)]


class _RAWMOUSE_U(ctypes.Union):
    _fields_ = [("ulButtons", wintypes.ULONG),
                ("buttons", _RAWMOUSE_BUTTONS)]


class RAWMOUSE(ctypes.Structure):
    _fields_ = [("usFlags", wintypes.USHORT),
                ("u", _RAWMOUSE_U),
                ("ulRawButtons", wintypes.ULONG),
                ("lLastX", wintypes.LONG),
                ("lLastY", wintypes.LONG),
                ("ulExtraInformation", wintypes.ULONG)]


class RAWINPUT(ctypes.Structure):
    _fields_ = [("header", RAWINPUTHEADER),
                ("mouse", RAWMOUSE)]


class WNDCLASS(ctypes.Structure):
    _fields_ = [("style", wintypes.UINT),
                ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int),
                ("hInstance", wintypes.HINSTANCE),
                ("hIcon", wintypes.HICON),
                ("hCursor", wintypes.HANDLE),
                ("hbrBackground", wintypes.HBRUSH),
                ("lpszMenuName", wintypes.LPCWSTR),
                ("lpszClassName", wintypes.LPCWSTR)]


# Explicit prototypes so 64-bit handles aren't truncated to C int.
user32.DefWindowProcW.restype = LRESULT
user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT,
                                  wintypes.WPARAM, wintypes.LPARAM]
user32.GetModuleHandleW = kernel32.GetModuleHandleW
kernel32.GetModuleHandleW.restype = wintypes.HMODULE
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
user32.RegisterClassW.restype = wintypes.ATOM
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASS)]
user32.CreateWindowExW.restype = wintypes.HWND
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                   wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wintypes.HWND,
                                   wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
user32.RegisterRawInputDevices.restype = wintypes.BOOL
user32.RegisterRawInputDevices.argtypes = [ctypes.POINTER(RAWINPUTDEVICE),
                                           wintypes.UINT, wintypes.UINT]
user32.GetRawInputData.restype = wintypes.UINT
user32.GetRawInputData.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPVOID,
                                   ctypes.POINTER(wintypes.UINT), wintypes.UINT]
user32.GetMessageW.restype = wintypes.BOOL
user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND,
                               wintypes.UINT, wintypes.UINT]
user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]

HWND_MESSAGE = wintypes.HWND(-3)  # message-only window parent


def _wnd_proc(hwnd, msg, wparam, lparam):
    if msg == WM_INPUT:
        _handle_raw_input(lparam)
        # Docs require calling DefWindowProc for WM_INPUT (cleanup).
    return user32.DefWindowProcW(hwnd, msg, wparam, lparam)


# Keep a strong reference — the C callback must not be garbage-collected.
_wnd_proc_ptr = WNDPROC(_wnd_proc)


def _handle_raw_input(hraw):
    global accum_dx, accum_dy

    size = wintypes.UINT(0)
    hdr = ctypes.sizeof(RAWINPUTHEADER)
    if user32.GetRawInputData(hraw, RID_INPUT, None, ctypes.byref(size), hdr) != 0:
        return
    if size.value == 0:
        return

    buf = (ctypes.c_byte * size.value)()
    got = user32.GetRawInputData(hraw, RID_INPUT, buf, ctypes.byref(size), hdr)
    if got == wintypes.UINT(-1).value or got == 0:
        return

    raw = ctypes.cast(buf, ctypes.POINTER(RAWINPUT)).contents
    if raw.header.dwType != RIM_TYPEMOUSE:
        return

    # Relative motion is the normal case (usFlags absolute bit clear). Absolute
    # (RDP / tablet / touch digitizer) is rare for local play; we skip it rather
    # than reintroduce a boundary-limited absolute path.
    if raw.mouse.usFlags & MOUSE_MOVE_ABSOLUTE:
        return

    dx = raw.mouse.lLastX
    dy = raw.mouse.lLastY
    if dx == 0 and dy == 0:
        return

    with _lock:
        accum_dx += dx
        accum_dy += dy


def _create_message_window():
    hinst = kernel32.GetModuleHandleW(None)
    wc = WNDCLASS()
    wc.lpfnWndProc = _wnd_proc_ptr
    wc.hInstance = hinst
    wc.lpszClassName = "VectorRawMouseCapture"
    atom = user32.RegisterClassW(ctypes.byref(wc))
    if not atom:
        raise ctypes.WinError(ctypes.get_last_error())

    hwnd = user32.CreateWindowExW(0, wc.lpszClassName, "VectorRawMouseCapture",
                                  0, 0, 0, 0, 0, HWND_MESSAGE, None, hinst, None)
    if not hwnd:
        raise ctypes.WinError(ctypes.get_last_error())

    rid = RAWINPUTDEVICE()
    rid.usUsagePage = HID_USAGE_PAGE_GENERIC
    rid.usUsage = HID_USAGE_GENERIC_MOUSE
    rid.dwFlags = RIDEV_INPUTSINK
    rid.hwndTarget = hwnd
    if not user32.RegisterRawInputDevices(ctypes.byref(rid), 1, ctypes.sizeof(RAWINPUTDEVICE)):
        raise ctypes.WinError(ctypes.get_last_error())

    return hwnd


def _message_loop():
    """Pump WM_INPUT on this thread. Runs until the process exits."""
    _create_message_window()
    print("[RAWINPUT] Registered mouse raw input, pumping messages")
    msg = wintypes.MSG()
    while running and user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))


# ---------------------------------------------------------------------------
# Star Citizen focus gating (optional).
# ---------------------------------------------------------------------------
def is_sc_focused():
    if not HAS_WINDOW_DETECTION:
        return True  # can't detect — assume focused
    try:
        active_win = pygetwindow.getActiveWindow()
        if active_win:
            return "Star Citizen" in active_win.title or "StarCitizen" in active_win.title
    except Exception:
        pass
    return False


# ---------------------------------------------------------------------------
# WebSocket sender — drains the accumulated delta at ~60fps and forwards it.
# ---------------------------------------------------------------------------
def sender_loop():
    global accum_dx, accum_dy
    frame_count = 0
    while running:
        try:
            focused = is_sc_focused()

            with _lock:
                dx, dy = accum_dx, accum_dy
                accum_dx = 0
                accum_dy = 0

            frame_count += 1
            if focused and (dx != 0 or dy != 0):
                if ws and ws.sock and ws.sock.connected:
                    ws.send(json.dumps({"dx": dx, "dy": dy}))
                    if frame_count % 30 == 0:
                        print(f"[MOUSE] Sent delta: dx={dx}, dy={dy}")
            time.sleep(0.016)  # ~60fps
        except Exception as e:
            print(f"[MOUSE] Sender error: {e}")
            time.sleep(0.1)


def on_open(_ws):
    print("[WS] Connected!")


def on_message(_ws, msg):
    print(f"[WS] Message from server: {msg}")


def on_error(_ws, error):
    print(f"[WS] ERROR: {error}")


def on_close(_ws, code, reason):
    print(f"[WS] Closed (code {code})")


# ---------------------------------------------------------------------------
# Startup: raw-input pump + sender in background threads, WebSocket on a thread,
# and the Win32 message loop needs its own thread too (GetMessageW blocks).
# ---------------------------------------------------------------------------
print("[THREAD] Starting raw-input message loop")
threading.Thread(target=_message_loop, daemon=True).start()

print("[THREAD] Starting WebSocket sender")
threading.Thread(target=sender_loop, daemon=True).start()

try:
    ws = WebSocketApp(
        WS_URL,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )
    print("[WS] Attempting to connect...")
    ws.run_forever()
except KeyboardInterrupt:
    print("\n[SHUTDOWN] Stopping...")
    running = False
except Exception as e:
    print(f"[ERROR] {e}")
    print(f"[HINT] Make sure the Node.js relay server is running on port {PORT}")
