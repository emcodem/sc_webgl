"""Continuously oscillates one vJoy axis in the background, so Star Citizen's control-binding
"press/move the control you wish to assign" capture picks it up on its own -- solves the problem
where switching to a terminal to trigger input (alt-tab) cancels the game's listening state before
the input actually arrives.

Start this FIRST, from a terminal, BEFORE opening Star Citizen's keybinding screen. Leave it
running, then alt-tab into the game once (that's fine -- you're not touching this script again
until you're done). Open Options > Keybindings, click into the Yaw (or Pitch/Roll) field to arm
capture, and the already-oscillating axis gets picked up without any further input from you. Ctrl+C
here once it's bound.

A slow sine sweep is used rather than a sharp back-and-forth step so the axis is essentially always
mid-motion (a full square-wave step spends most of its time sitting still at the extremes, between
brief transitions) -- more robust against whatever sampling window the game's capture logic uses.

Usage: python bind_helper.py yaw   (or: pitch, roll)
"""

import argparse
import math
import sys
import time

from vjoy_feeder import AXIS_MAP, axis_value_to_vjoy


def oscillate(logical_axis: str, period_sec: float, poll_hz: float) -> None:
    import pyvjoy

    device = pyvjoy.VJoyDevice(1)
    vjoy_axis = AXIS_MAP[logical_axis]
    axis_const = getattr(pyvjoy, f"HID_USAGE_{vjoy_axis}")

    print(f"Oscillating vJoy axis {vjoy_axis} ({logical_axis}) with a {period_sec}s period.")
    print("Switch to Star Citizen now, open Keybindings, and click to bind this axis.")
    print("Ctrl+C here once it's bound.")

    t0 = time.perf_counter()
    try:
        while True:
            t = time.perf_counter() - t0
            value = math.sin(2 * math.pi * t / period_sec)
            device.set_axis(axis_const, axis_value_to_vjoy(value))
            time.sleep(1.0 / poll_hz)
    except KeyboardInterrupt:
        device.set_axis(axis_const, axis_value_to_vjoy(0.0))
        print("\nStopped, axis centered.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("axis", choices=list(AXIS_MAP.keys()))
    parser.add_argument("--period", type=float, default=2.0, help="seconds for one full sweep cycle")
    parser.add_argument("--poll-hz", type=float, default=100.0)
    args = parser.parse_args()

    oscillate(args.axis, args.period, args.poll_hz)


if __name__ == "__main__":
    sys.exit(main())
