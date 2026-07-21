"""Extracts steady-state yaw/pitch rate per held offset from a mouse_hold_capture trial, and fits the
rate-vs-offset curve -- the readout of what a vjoy setting (VJoyAnglePilots, ...) or the mouse input
curve itself does to flight.

Tracks the landmark (landing-pad ring / star / sun), converts pixel motion to deg/s via the pinhole
(arctan) projection from angle_convert.py, aligns the video to the commanded staircase by
cross-correlating the pad's |speed| envelope against the commanded |offset| envelope (robust to the
smoothing transients that wreck a signed-rate correlation), then medians the steady tail of each hold
(skipping the settle transient). Flags holds where the landmark lost lock or ran to the frame
excursion limit (cockpit bars) so they're excluded.

Usage:
    python hold_rate.py <trial_dir> --axis x --seed-x 1920 --seed-y 1100 --window 45 --fov 116 \
        --resolution 3840x2160 --skip 0.7
    (axis x = yaw/horizontal, axis y = pitch/vertical -- must match which mouse component the trial
    drove, see mouse_hold_capture.py --axis / curve_sweep_capture.py --axis)
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analysis.track_landmark import track  # noqa: E402
from analysis.angle_convert import (  # noqa: E402
    focal_length_px, pixel_to_angle_deg, smooth_and_differentiate, drop_non_advancing_timestamps,
)


def analyze(trial: Path, seed_x: float, seed_y: float, window: int, fov: float,
            resolution: tuple[int, int], axis: str, skip: float,
            smooth_window: int = 11, smooth_poly: int = 3):
    width, height = resolution
    rows = track(trial / "raw.mp4", seed_x, seed_y, half_window=window)
    rows = drop_non_advancing_timestamps(rows)
    t = np.array([r["t"] for r in rows])
    pk = np.array([r["peak_brightness"] for r in rows])

    # Pinhole (arctan) projection, matching angle_convert.py -- NOT a linear fov/width scale, which
    # angle_convert's own docs measured as ~37% too small near center and badly wrong at large
    # excursion (see capture/MEASUREMENTS.md "Analysis"). focal_px is always derived from the
    # HORIZONTAL dimension/fov regardless of axis (one camera-intrinsic value), matching the
    # pitch-axis fix in angle_convert.py -- deriving it from `height` for axis="y" would overstate
    # every rate by the aspect ratio, exactly the bug angle_convert.py's own history already found.
    focal_px = focal_length_px(width, fov)
    if axis == "x":
        pixel = np.array([r["pixel_x"] for r in rows])
        center_px = width / 2
        frame_dim = width
    else:
        pixel = np.array([r["pixel_y"] for r in rows])
        center_px = height / 2
        frame_dim = height
    angle_deg = pixel_to_angle_deg(pixel, center_px, focal_px)
    rate = smooth_and_differentiate(t, angle_deg, smooth_window, smooth_poly)
    speed = np.abs(rate)

    oc = list(csv.DictReader((trial / "offsets.csv").open()))
    ot = np.array([float(r["t"]) for r in oc]); oinj = np.abs(np.array([float(r["injected"]) for r in oc]))
    segs = json.loads((trial / "segments.json").read_text())

    # align: scan T0, maximize corr(|speed|(t), |cmd|(t-T0))
    best = (0.0, -1.0)
    for T0 in np.arange(0.5, 6.0, 0.02):
        c = np.interp(t - T0, ot, oinj, left=0, right=0)
        cc = np.corrcoef(speed, c)[0, 1]
        if cc > best[1]:
            best = (T0, cc)
    T0, corr = best

    lock_floor = 0.45 * pk.max()
    res = []
    for s in segs:
        a, b = s["t_start"] + T0, s["t_end"] + T0
        w = (t >= a + skip) & (t <= b)
        if w.sum() < 4:
            continue
        lost = (pk[w] < lock_floor).mean() > 0.2
        excursion = (pixel[w].min() < 60) or (pixel[w].max() > frame_dim - 60)
        res.append({"offset": s["offset"], "rate": float(np.median(rate[w])),
                    "n": int(w.sum()), "ok": not (lost or excursion)})
    res.sort(key=lambda r: r["offset"])
    return res, T0, corr


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("trial", type=Path)
    p.add_argument("--axis", choices=["x", "y"], default="x", help="x=yaw (horizontal), y=pitch (vertical)")
    p.add_argument("--seed-x", type=float, default=1920.0)
    p.add_argument("--seed-y", type=float, default=1100.0)
    p.add_argument("--window", type=int, default=45)
    p.add_argument("--fov", type=float, default=116.0)
    p.add_argument("--resolution", default="3840x2160", help="WIDTHxHEIGHT")
    p.add_argument("--skip", type=float, default=0.7, help="seconds of transient to skip at each hold start")
    args = p.parse_args()

    width, height = (int(x) for x in args.resolution.split("x"))
    res, T0, corr = analyze(args.trial, args.seed_x, args.seed_y, args.window, args.fov,
                             (width, height), args.axis, args.skip)
    print(f"align T0={T0:.2f}s corr={corr:.3f}")
    print("offset  rate_deg_s   ok")
    for r in res:
        print(f"{r['offset']:6d}  {r['rate']:8.2f}   {'ok' if r['ok'] else 'LOST'}")
    good = [r for r in res if r["ok"] and r["offset"] != 0]
    if len(good) >= 2:
        o = np.array([r["offset"] for r in good]); y = np.array([r["rate"] for r in good])
        slope, intr = np.polyfit(o, y, 1)
        print(f"linear fit (ok holds): {slope * 1000:.3f} deg/s per 1000 counts  (intercept {intr:.2f})")


if __name__ == "__main__":
    sys.exit(main())
