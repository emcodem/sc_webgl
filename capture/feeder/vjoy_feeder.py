"""Drives a vJoy virtual joystick through a scripted axis waveform (a "maneuver").

Maneuver file format (see maneuvers/*.json):
{
  "name": "yaw_reversal",
  "description": "...",
  "segments": [
    {"start": 0.0, "end": 2.0, "axes": {"yaw": 1.0}},
    {"start": 2.0, "end": 5.0, "axes": {"yaw": -1.0}},
    {"start": 5.0, "end": 6.0, "axes": {"yaw": 0.0}}
  ]
}

Each segment holds its axes at a constant value for [start, end) in maneuver-relative seconds;
axis values are -1..1. Segments must be given in order and should be contiguous (no gaps) -- a gap
just means "hold whatever the previous segment set" since axis state isn't reset between segments.

Logical axis names (yaw/pitch/roll) are mapped to vJoy's X/Y/Z per AXIS_MAP below -- bind Star
Citizen's yaw/pitch rotation to the vJoy device's X/Y axes to match (see ../README.md).

Run with --dry-run (no vJoy device / pyvjoy install needed) to print the schedule instead of
actually driving a device -- useful for checking a maneuver file or for developing on a machine
without the vJoy driver installed.
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

# Logical name -> vJoy axis. Star Citizen's control bindings must point each of these at the same
# vJoy axis for the maneuver to actually reach the axis it claims to -- in SC's actionmaps.xml
# these correspond to v_yaw/v_pitch/v_roll and v_strafe_lateral/v_strafe_vertical/
# v_strafe_longitudinal respectively.
AXIS_MAP = {
    "yaw": "X", "pitch": "Y", "roll": "Z",
    "strafe_lateral": "RX", "strafe_vertical": "RY", "strafe_longitudinal": "RZ",
}

# vJoy axes are 0x1..0x8000 (1..32768), centered at 16384. Convert from our -1..1 convention.
VJOY_AXIS_MIN = 1
VJOY_AXIS_MAX = 32768
VJOY_AXIS_CENTER = 16384


def axis_value_to_vjoy(value: float) -> int:
    value = max(-1.0, min(1.0, value))
    if value >= 0:
        return round(VJOY_AXIS_CENTER + value * (VJOY_AXIS_MAX - VJOY_AXIS_CENTER))
    return round(VJOY_AXIS_CENTER + value * (VJOY_AXIS_CENTER - VJOY_AXIS_MIN))


def load_maneuver(path: Path) -> dict:
    maneuver = json.loads(path.read_text())
    segments = maneuver["segments"]
    for a, b in zip(segments, segments[1:]):
        if b["start"] < a["end"]:
            raise ValueError(f"overlapping segments: {a} then {b}")
    return maneuver


def active_axes(segments: list, t: float) -> dict:
    """Axes commanded at maneuver-relative time t -- the last segment whose start <= t, holding
    its values even into any gap before the next segment (see module docstring)."""
    current = {}
    for seg in segments:
        if seg["start"] <= t:
            current = seg["axes"]
        else:
            break
    return current


def run(maneuver: dict, dry_run: bool, log_path: Path | None, poll_hz: float) -> None:
    segments = maneuver["segments"]
    duration = segments[-1]["end"]
    poll_interval = 1.0 / poll_hz

    device = None
    if not dry_run:
        import pyvjoy  # local import: not required for --dry-run

        device = pyvjoy.VJoyDevice(1)

    log_rows = []
    last_axes: dict = {}
    t0 = time.perf_counter()
    print(f"Running '{maneuver.get('name', '?')}' for {duration:.3f}s "
          f"({'DRY RUN' if dry_run else 'driving vJoy device 1'})...")

    while True:
        t = time.perf_counter() - t0
        if t >= duration:
            break
        axes = active_axes(segments, t)
        changed = axes != last_axes
        # Re-send every axis EVERY poll cycle, not just on change -- a real Gladius yaw trial and a
        # real roll trial both showed the ship rotating briefly right after an axis value changed,
        # then stalling completely for the rest of a segment despite the command supposedly still
        # being held (see BLUEPRINT.md's Gotchas). The only SetAxis calls being made were exactly at
        # the 3 segment-change instants (confirmed via input_log.csv having exactly 3 rows) -- i.e.
        # vJoy's axis was set once and left untouched for the whole hold. If Star Citizen's input
        # polling (or the vJoy/Windows layer) needs periodic refresh to keep recognizing sustained
        # input, that alone would fully explain "moves right after a SetAxis call, then stops."
        # Continuously refreshing costs nothing and directly rules this out (or fixes it).
        for logical, value in axes.items():
            vjoy_axis = AXIS_MAP[logical]
            raw = axis_value_to_vjoy(value)
            if dry_run:
                if changed:
                    print(f"  t={t:7.4f}s  {logical:>5s} ({vjoy_axis}) = {value:+.2f}  (raw {raw})")
            else:
                device.set_axis(getattr(__import__("pyvjoy"), f"HID_USAGE_{vjoy_axis}"), raw)
        if changed:
            log_rows.append({"t": t, **{f"axis_{k}": v for k, v in axes.items()}})
            last_axes = axes
        time.sleep(poll_interval)

    # neutral everything on exit, whatever the last segment's axes were
    for logical in set().union(*(seg["axes"].keys() for seg in segments)):
        vjoy_axis = AXIS_MAP[logical]
        raw = axis_value_to_vjoy(0.0)
        if not dry_run:
            device.set_axis(getattr(__import__("pyvjoy"), f"HID_USAGE_{vjoy_axis}"), raw)
    print("Done, axes returned to neutral.")

    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        fieldnames = ["t"] + sorted({k for row in log_rows for k in row if k != "t"})
        with log_path.open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(log_rows)
        print(f"Input-change log written to {log_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("maneuver", type=Path, help="path to a maneuver JSON file")
    parser.add_argument("--dry-run", action="store_true", help="print the schedule, don't touch vJoy")
    parser.add_argument("--log", type=Path, default=None, help="write an input-change CSV log here")
    parser.add_argument("--poll-hz", type=float, default=500.0, help="internal scheduling poll rate")
    args = parser.parse_args()

    maneuver = load_maneuver(args.maneuver)
    run(maneuver, dry_run=args.dry_run, log_path=args.log, poll_hz=args.poll_hz)


if __name__ == "__main__":
    sys.exit(main())
