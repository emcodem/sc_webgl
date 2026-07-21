"""Denser multi-magnitude mouse-offset sweep for YAW and/or PITCH, to properly characterize the
mouse virtual-joystick's input curve (see MEASUREMENTS.md "Input-curve shape") -- one held-offset
probe (0,M,-M,M,-M, same shape as mouse_hold_capture.py) per (axis, magnitude, rep), each its own OBS
clip, looped so a whole sweep doesn't need re-typing mouse_hold_capture.py's CLI per magnitude.

WHY this exists over just calling mouse_hold_capture.py N times by hand: the existing yaw curve data
(MEASUREMENTS.md "Input-curve shape") only covers 150-600 counts; extrapolating that fit to the
measured full-deflection point (2500 counts -> 49.2 deg/s) overshoots by ~3.4x, meaning the real
curve bends over well before full stick -- a single power-law exponent can't be right across the
whole range. Filling in 750-2100 (yaw) and the ENTIRE range for pitch (currently zero shape data,
only the two endpoints) is what analysis/fit_curve.py needs to fit a curve that actually saturates.

Each magnitude's trial writes the exact same offsets.csv/segments.json/meta.json/raw.mp4 shape as
mouse_hold_capture.py's output, under data/curve/<axis>_<magnitude>[_repN]-<timestamp>/, so
analysis/hold_rate.py (pass --axis x for yaw, --axis y for pitch) and analysis/fit_curve.py work on
it unmodified.

SEMI-automated, not fully hands-off: repeated yaw/pitch holds drift the ship's heading over many
magnitudes, and the landmark seed (fixed --seed-x/--seed-y for the whole session) can walk out of the
tracking window. By default this pauses before each trial for you to glance at the game and nudge the
mouse back to re-center the landmark if it's drifted (Enter to continue); pass --no-interactive to
skip the pauses if you're confident drift is small enough (e.g. a short sweep, small magnitudes).

SETUP: same as mouse_hold_capture.py -- private AC/free-flight, Coupled, ship ~0 m/s, POINT landmark
(the sun/a star -- NOT Kareah's post; that's the ROLL landmark, tracked by orientation and wants to
stay centered, the opposite of what this needs) seeded near screen center, pointer_accel.py pin first.

At the higher magnitudes the ship's rate is fast enough to sweep any point landmark out of frame well
within the dwell -- that's fine (analysis/hold_rate.py only needs a brief steady window right after
the ramp settles, not the whole hold), but it means the symmetric 0/+M/-M/+M/-M probe (fine at small
magnitudes) stops working: whichever direction the seed has less margin toward will exit almost
immediately. Pass --one-directional for these -- each magnitude becomes two single-direction probes
(0,+M and 0,-M), matching how the existing full-deflection captures (data/angular/yaw-max-*,
pitch-max-*) were shot, so you can re-seed with margin biased toward the commanded direction before
each (the interactive re-center prompt is exactly for this). Also shorten --dwell/--ramp so
rate*dwell stays under roughly half the FOV -- at Gladius's ballpark 50-70 deg/s and FOV 116, that's
dwell of ~0.6-0.8s, well under the 2.0s default that's fine for the small magnitudes.

Usage:
    # small magnitudes: symmetric probe, default dwell is fine
    python curve_sweep_capture.py --axes yaw,pitch --magnitudes 750,900 --repeats 2 --tag curve
    # large magnitudes: one-directional, shorter dwell, re-seed toward each commanded direction
    python curve_sweep_capture.py --axes yaw,pitch --magnitudes 1200,1500,1800,2100 --one-directional \
        --dwell 0.6 --ramp 0.15 --repeats 2 --tag curve
"""

import argparse
import csv
import io
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from mouse_hold_capture import run_staircase, _rmb  # noqa: E402
from feeder.win_focus import focus_and_click  # noqa: E402
from recorder.obs_capture import connect, start as obs_start, stop as obs_stop  # noqa: E402


def run_one(client, axis: str, offsets: list[int], magnitude: int, dwell: float, ramp: float,
            poll_hz: float, settle: float, boost: bool, out_root: Path, tag: str, rep: int) -> Path:
    label = str(magnitude).replace("-", "neg")
    out_dir = out_root / f"{axis}_{label}_rep{rep}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    obs_start(client)
    focus_and_click()
    time.sleep(settle)
    if boost:
        _rmb(True)
        time.sleep(0.2)
    try:
        ticks, segments = run_staircase(offsets, dwell, ramp, poll_hz, axis)
    finally:
        if boost:
            _rmb(False)
    time.sleep(0.3)
    src = Path(obs_stop(client))
    video = out_dir / "raw.mp4"
    shutil.copy(src, video)

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["t", "target", "injected", "phase"]); w.writeheader(); w.writerows(ticks)
    (out_dir / "offsets.csv").write_text(buf.getvalue())
    (out_dir / "segments.json").write_text(json.dumps(segments, indent=2))
    (out_dir / "meta.json").write_text(json.dumps({
        "offsets": offsets, "dwell": dwell, "ramp": ramp, "settle": settle,
        "axis": axis, "magnitude": magnitude, "rep": rep, "boost": boost,
        "obs_source": str(src),
        "note": "curve_sweep_capture: single-magnitude probe, part of a denser input-curve sweep",
    }, indent=2))
    print(f"  -> {out_dir} ({len(ticks)} ticks, {len(segments)} holds, video {video.stat().st_size} bytes)")
    return out_dir


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--axes", default="yaw,pitch", help="comma-separated: yaw, pitch, or both")
    p.add_argument("--magnitudes", required=True, help="comma-separated held offsets in mouse counts")
    p.add_argument("--repeats", type=int, default=1, help="reps per (axis, magnitude), for averaging/outlier check")
    p.add_argument("--dwell", type=float, default=2.0, help="seconds to hold each offset")
    p.add_argument("--ramp", type=float, default=0.25, help="seconds to ramp between offsets")
    p.add_argument("--poll-hz", type=float, default=500.0)
    p.add_argument("--settle", type=float, default=1.0)
    p.add_argument("--boost", action="store_true", help="hold right-mouse (boost/afterburner) for every trial")
    p.add_argument("--tag", default="curve")
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "curve")
    p.add_argument("--obs-password", default="")
    p.add_argument("--one-directional", action="store_true",
                    help="probe each magnitude as two single-direction holds (0,+M and 0,-M) instead of "
                         "the symmetric 0,+M,-M,+M,-M -- needed once the landmark can't survive both "
                         "directions' excursion from one centered seed (see module docstring)")
    p.add_argument("--no-interactive", action="store_true",
                    help="skip the re-center pause before each trial (risk: landmark drifts out of the seed window)")
    args = p.parse_args()

    axes = [a.strip() for a in args.axes.split(",") if a.strip()]
    for a in axes:
        if a not in ("yaw", "pitch"):
            sys.exit(f"unknown axis {a!r} -- must be 'yaw' or 'pitch'")
    magnitudes = [int(m) for m in args.magnitudes.split(",")]

    # jobs: (axis, offsets, magnitude_label, rep). One-directional splits each magnitude into two
    # separate single-direction probes so a seed biased toward the commanded direction can be reset
    # between them; symmetric keeps the original single-clip 0/+M/-M/+M/-M shape.
    jobs = []
    for axis in axes:
        for mag in magnitudes:
            signed_mags = [mag, -mag] if args.one_directional else [mag]
            for signed in signed_mags:
                offsets = [0, signed] if args.one_directional else [0, mag, -mag, mag, -mag]
                for rep in range(1, args.repeats + 1):
                    jobs.append((axis, offsets, signed, rep))
    print(f"Sweep: {len(jobs)} trials ({axes} x {magnitudes} x {args.repeats} rep(s)"
          + (", one-directional" if args.one_directional else "") + ")")

    client = connect(password=args.obs_password)
    args.out.mkdir(parents=True, exist_ok=True)
    done = []
    for i, (axis, offsets, mag_label, rep) in enumerate(jobs, 1):
        print(f"[{i}/{len(jobs)}] axis={axis} offsets={offsets} rep={rep}"
              + ("  [BOOST held]" if args.boost else ""))
        if not args.no_interactive:
            dir_hint = ""
            if args.one_directional:
                dir_hint = f" -- about to command {'+' if mag_label > 0 else '-'}{abs(mag_label)}, bias the seed away from that side"
            input(f"  Re-center the landmark if it's drifted{dir_hint}, then press Enter to record this trial...")
        out_dir = run_one(client, axis, offsets, mag_label, args.dwell, args.ramp, args.poll_hz, args.settle,
                           args.boost, args.out, args.tag, rep)
        done.append(out_dir)

    print(f"\nSweep done: {len(done)} trials under {args.out}")
    for d in done:
        print(f"  {d}")


if __name__ == "__main__":
    sys.exit(main())
