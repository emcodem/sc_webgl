"""Interactive feel-test for the pitch/yaw reversal question -- no OBS, no landmark tracking, just
drives the mouse virtual joystick to one deflection for `--dur1` seconds, hard-flips to the opposite
deflection for `--dur2` seconds, then returns to zero. Run it, watch/feel what the ship actually does,
then rerun with a different --dur2 to binary-search the hold length where the ship visibly starts
moving the other way -- this is the same "massentraegheit"/reversal-lag question as GitHub issue #12
and capture/MEASUREMENTS.md's reversal-fit rows, just probed by feel instead of through the
CV-tracking pipeline (which turned out to be fiddly to seed cleanly for this maneuver in one session).

SETUP: private AC/free-flight instance, Gladius, Coupled, full engine power (see
settings_checklist.md) -- same preconditions as any other capture, minus the landmark/OBS parts.

Usage:
    python reversal_feel_test.py --axis pitch --mag1 1080 --dur1 1.0 --mag2 -1080 --dur2 0.3
    python reversal_feel_test.py --axis yaw --mag1 1700 --dur1 1.0 --dur2 0.15 --boost
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from feeder.mouse_feeder import move_rel  # noqa: E402
from feeder.win_focus import ready_and_reset  # noqa: E402

import ctypes  # noqa: E402


def _rmb(down: bool) -> None:
    ctypes.windll.user32.mouse_event(0x0008 if down else 0x0010, 0, 0, 0, 0)


def ramp_to(injected: int, target: int, ramp: float, poll_hz: float, axis: str, t0: float) -> int:
    interval = 1.0 / poll_hz
    start_inj = injected
    r0 = time.perf_counter() - t0
    while True:
        t = time.perf_counter() - t0
        frac = min(1.0, (t - r0) / ramp) if ramp > 0 else 1.0
        want = int(round(start_inj + (target - start_inj) * frac))
        delta = want - injected
        if delta != 0:
            (move_rel(delta, 0) if axis == "yaw" else move_rel(0, delta))
            injected += delta
        if frac >= 1.0:
            break
        time.sleep(interval)
    return injected


def hold(seconds: float, poll_hz: float, t0: float, label: str) -> None:
    interval = 1.0 / poll_hz
    end = time.perf_counter() - t0 + seconds
    print(f"  [{time.perf_counter() - t0:6.3f}s] holding {label} for {seconds:.3f}s...")
    while time.perf_counter() - t0 < end:
        time.sleep(interval)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--axis", choices=["yaw", "pitch"], required=True)
    p.add_argument("--mag1", type=int, required=True, help="first deflection, in mouse counts (signed)")
    p.add_argument("--dur1", type=float, required=True, help="seconds to hold the first deflection")
    p.add_argument("--mag2", type=int, default=None,
                   help="second (reversal) deflection, mouse counts (signed) -- defaults to -mag1")
    p.add_argument("--dur2", type=float, required=True, help="seconds to hold the reversed deflection")
    p.add_argument("--ramp", type=float, default=0.05, help="seconds to snap between deflections")
    p.add_argument("--poll-hz", type=float, default=500.0)
    p.add_argument("--boost", action="store_true", help="hold right-mouse (boost) for the whole run")
    args = p.parse_args()

    mag2 = args.mag2 if args.mag2 is not None else -args.mag1

    hwnd, title = ready_and_reset()
    print(f"foregrounded '{title}'. axis={args.axis} mag1={args.mag1} dur1={args.dur1}s "
          f"mag2={mag2} dur2={args.dur2}s ramp={args.ramp}s" + ("  [BOOST]" if args.boost else ""))

    t0 = time.perf_counter()
    injected = 0
    if args.boost:
        _rmb(True)
        time.sleep(0.2)
    try:
        injected = ramp_to(injected, args.mag1, args.ramp, args.poll_hz, args.axis, t0)
        hold(args.dur1, args.poll_hz, t0, f"{args.mag1}")
        injected = ramp_to(injected, mag2, args.ramp, args.poll_hz, args.axis, t0)
        hold(args.dur2, args.poll_hz, t0, f"{mag2} (reversed)")
    finally:
        if args.boost:
            _rmb(False)
        ramp_to(injected, 0, args.ramp, args.poll_hz, args.axis, t0)
        print(f"  [{time.perf_counter() - t0:6.3f}s] back to zero. Done.")


if __name__ == "__main__":
    sys.exit(main())
