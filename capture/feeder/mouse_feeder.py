"""Injects relative mouse motion so Star Citizen's MOUSE virtual joystick can be driven with a
scripted, repeatable waveform -- the counterpart to vjoy_feeder.py, but for the mouse path instead
of the bound vJoy hardware device.

Why this exists (see BLUEPRINT.md): SC's on-screen "vjoy" indicator responds to the MOUSE virtual
joystick, NOT to the bound vJoy device (confirmed: the indicator ignored a device-axis sweep). The
settings we want to characterize (VJoyAnglePilots, VJoyCombinedDeadZone, ...) are Virtual-Joystick =
mouse-joystick settings, so they must be measured by driving the MOUSE and watching the indicator /
ship -- the vJoy device never touches them.

Injection method: Win32 SendInput with MOUSEEVENTF_MOVE (relative deltas). Absolute SetCursorPos is
deliberately NOT used -- under flight pointer-lock it generally doesn't register as stick input.
`dx`/`dy` are relative counts per event. NOTE for the later quantitative phase: Windows pointer
speed + "Enhance pointer precision" (mouse acceleration) can scale WM_MOUSEMOVE-based input; games
reading Raw Input (WM_INPUT) see the raw delta unscaled. Which path SC's flight uses is unconfirmed
-- for the first existence/verification check it doesn't matter (we only need the indicator to move
at all); for calibrated measurement, pin pointer speed to 6/11 and disable Enhance-pointer-precision,
or confirm SC reads raw input, and record whichever in each trial's meta.

SAFETY: while NOT in a pointer-locked flight view (e.g. sitting in a menu/desktop), injected motion
moves the real desktop cursor. Only run this while in-cockpit in flight. There is no "neutral" to
restore on exit (motion is relative) -- stopping simply stops injecting.

Usage:
    python mouse_feeder.py oscillate yaw --period 4 --amplitude 10   # slow left/right sway to verify
    python mouse_feeder.py oscillate pitch --period 4                # up/down
    python mouse_feeder.py --dry-run oscillate yaw                   # print deltas, inject nothing
"""

import argparse
import ctypes
import math
import sys
import time
from ctypes import wintypes

INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001

# Logical axis -> which relative component it drives. yaw = horizontal (dx), pitch = vertical (dy).
AXES = {"yaw": "x", "pitch": "y"}


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG)),
    ]


class _INPUTunion(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT)]


class INPUT(ctypes.Structure):
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUTunion)]


_user32 = ctypes.windll.user32


def move_rel(dx: int, dy: int) -> None:
    """Inject a single relative mouse-move event of (dx, dy) counts."""
    extra = ctypes.c_ulong(0)
    mi = MOUSEINPUT(dx, dy, 0, MOUSEEVENTF_MOVE, 0, ctypes.pointer(extra))
    inp = INPUT(type=INPUT_MOUSE, u=_INPUTunion(mi=mi))
    _user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def oscillate(logical_axis: str, period_sec: float, amplitude: float, poll_hz: float,
              dry_run: bool) -> None:
    """Sway one axis symmetrically about center. SC's mouse virtual joystick ACCUMULATES relative
    deltas into an absolute stick position (confirmed empirically), so to make the indicator follow
    position = amplitude*sin(2*pi*t/period) we inject each tick's DISCRETE DERIVATIVE -- the delta
    between this tick's target offset and the net we've already injected. (Injecting the velocity
    sin(t) directly was the original bug: its running sum is amplitude*(1-cos t) >= 0, i.e. rightward
    only, which is exactly what we observed.)

    `amplitude` is the peak stick-position offset in cumulative mouse counts. Injecting small
    per-tick deltas (rather than one big jump) also keeps each move in the low-speed regime where
    Windows pointer acceleration is closest to linear. On stop, best-effort re-center by injecting
    the inverse of the net offset so the stick doesn't stay parked off-center.

    NOTE: `injected` is our OWN running total, valid only if SC maps counts 1:1 and doesn't
    auto-recenter. For the actual measurement the indicator is tracked optically (ground truth), so
    this internal estimate only needs to be good enough to drive a visible, roughly-centered sway."""
    component = AXES[logical_axis]
    interval = 1.0 / poll_hz
    print(f"Oscillating MOUSE {logical_axis} ({component}), period {period_sec}s, "
          f"peak offset {amplitude} counts @ {poll_hz:.0f}Hz "
          f"({'DRY RUN -- injecting nothing' if dry_run else 'INJECTING relative motion'}).")
    print("Be in-cockpit in flight before this matters; Ctrl+C to stop.")

    injected = 0  # net counts injected so far this run (our estimate of the stick's offset)
    t0 = time.perf_counter()
    try:
        while True:
            t = time.perf_counter() - t0
            target = amplitude * math.sin(2 * math.pi * t / period_sec)
            delta = int(round(target)) - injected
            if delta != 0:
                dx, dy = (delta, 0) if component == "x" else (0, delta)
                if dry_run:
                    print(f"  t={t:6.3f}s  target={target:+7.1f}  d{component}={delta:+d}")
                else:
                    move_rel(dx, dy)
                injected += delta
            time.sleep(interval)
    except KeyboardInterrupt:
        if not dry_run and injected != 0:
            dx, dy = (-injected, 0) if component == "x" else (0, -injected)
            move_rel(dx, dy)  # best-effort re-center
        print("\nStopped injecting (re-centered).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="print deltas instead of injecting")
    sub = parser.add_subparsers(dest="command", required=True)
    osc = sub.add_parser("oscillate", help="sway one axis with a sine velocity (verification)")
    osc.add_argument("axis", choices=list(AXES.keys()))
    osc.add_argument("--period", type=float, default=4.0, help="seconds for one full sway cycle")
    osc.add_argument("--amplitude", type=float, default=250.0, help="peak stick-position offset in cumulative mouse counts")
    osc.add_argument("--poll-hz", type=float, default=100.0)
    args = parser.parse_args()

    if args.command == "oscillate":
        oscillate(args.axis, args.period, args.amplitude, args.poll_hz, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
