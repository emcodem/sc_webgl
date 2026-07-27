"""Tracks roll via the BEARING between two separately-tracked point landmarks, for scenes with no
single elongated object to feed track_orientation.py's PCA approach (e.g. two lit station landing
pads a few percent off-center instead of a rod/post). Equivalent in spirit to track_orientation.py
(an orientation angle, not a position) but computed directly from two tracked points instead of one
object's intensity-weighted principal axis.

Method: track_landmark.track() independently on each point (point A, point B), then take the
bearing angle = atan2(y_B - y_A, x_B - x_A) per frame -- the angle of the line connecting them.
Under roll, both points rotate rigidly about screen center, so this bearing changes 1:1 with the
ship's roll angle. Unlike a symmetric rod, two distinguishable points need no mod-180 angle-doubling
trick -- np.unwrap on the raw bearing is sufficient, and the sign of the roll is directly recoverable
(no need to infer it from the driven key).

Usage:
    python track_roll_twopoint.py <video> --seed-a-x 1800 --seed-a-y 1050 --seed-b-x 2030 --seed-b-y 1050 \
        --window 40 [--out roll.csv]
"""

import argparse
import csv
import sys
from pathlib import Path

import numpy as np

from track_landmark import track
from angle_convert import smooth_and_differentiate, drop_non_advancing_timestamps


def bearing_track(video: Path, seed_a: tuple[float, float], seed_b: tuple[float, float],
                   window: int, smooth_window: int, smooth_poly: int) -> list[dict]:
    rows_a = drop_non_advancing_timestamps(track(video, seed_a[0], seed_a[1], window))
    rows_b = drop_non_advancing_timestamps(track(video, seed_b[0], seed_b[1], window))

    n = min(len(rows_a), len(rows_b))
    rows_a, rows_b = rows_a[:n], rows_b[:n]

    t = np.array([r["t"] for r in rows_a])
    ax = np.array([r["pixel_x"] for r in rows_a])
    ay = np.array([r["pixel_y"] for r in rows_a])
    bx = np.array([r["pixel_x"] for r in rows_b])
    by = np.array([r["pixel_y"] for r in rows_b])
    pb_a = np.array([r["peak_brightness"] for r in rows_a])
    pb_b = np.array([r["peak_brightness"] for r in rows_b])

    separation = np.hypot(bx - ax, by - ay)
    bearing_deg = np.degrees(np.unwrap(np.arctan2(by - ay, bx - ax)))
    omega_deg_s = smooth_and_differentiate(t, bearing_deg, smooth_window, smooth_poly)

    return [
        {"t": tt, "bearing_deg": br, "omega_deg_s": w, "separation_px": sep,
         "peak_brightness_a": pa, "peak_brightness_b": pbb}
        for tt, br, w, sep, pa, pbb in zip(t, bearing_deg, omega_deg_s, separation, pb_a, pb_b)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", type=Path)
    parser.add_argument("--seed-a-x", type=float, required=True)
    parser.add_argument("--seed-a-y", type=float, required=True)
    parser.add_argument("--seed-b-x", type=float, required=True)
    parser.add_argument("--seed-b-y", type=float, required=True)
    parser.add_argument("--window", type=int, default=40, help="half-width of each point's search window, in pixels")
    parser.add_argument("--smooth-window", type=int, default=11)
    parser.add_argument("--smooth-poly", type=int, default=3)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    rows = bearing_track(args.video, (args.seed_a_x, args.seed_a_y), (args.seed_b_x, args.seed_b_y),
                          args.window, args.smooth_window, args.smooth_poly)

    peaks = np.array([min(r["peak_brightness_a"], r["peak_brightness_b"]) for r in rows])
    lock_floor = 0.5 * peaks.max()
    lost_lock = [i for i, p in enumerate(peaks) if p < lock_floor]
    if lost_lock:
        print(f"WARNING: {len(lost_lock)} frame(s) had a point below half the clip's peak brightness "
              f"(first at index {lost_lock[0]}) -- likely lost lock on one of the two points.")

    seps = np.array([r["separation_px"] for r in rows])
    print(f"separation: {seps.min():.1f}-{seps.max():.1f}px (seeded {np.hypot(args.seed_b_x-args.seed_a_x, args.seed_b_y-args.seed_a_y):.1f}px apart)")

    out_path = args.out or args.video.with_suffix(".roll.csv")
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["t", "bearing_deg", "omega_deg_s", "separation_px",
                                                "peak_brightness_a", "peak_brightness_b"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(rows)} frames -> {out_path}")


if __name__ == "__main__":
    sys.exit(main())
