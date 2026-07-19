"""Tracks a bright landmark (a star, or a HUD tick) frame-by-frame in a captured clip and writes
its pixel trajectory to CSV. Deliberately simple (brightness-weighted centroid in a re-centering
search window) rather than a general-purpose tracker -- the landmark is a small, high-contrast
point against a comparatively uniform background (space, or a dark HUD element), which is exactly
the case this kind of centroid tracking is robust for, without pulling in a heavier tracking model.

Usage:
    python track_landmark.py <video> --seed-x 960 --seed-y 400 [--window 40] [--out trajectory.csv]

--seed-x/--seed-y is the landmark's approximate pixel position in the FIRST frame (click it in any
video player / paused frame first). The search window re-centers on the previous frame's centroid
each frame, so it follows the landmark as it drifts across the screen during the maneuver -- as
long as the per-frame motion stays smaller than --window (increase --window for fast reversals if
tracking loses lock; the fitted `omega` from a lost-lock trace will show an obvious discontinuity).
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np


def centroid_in_window(gray: np.ndarray, cx: float, cy: float, half: int) -> tuple[float, float, float]:
    """Brightness-weighted centroid within a (2*half)-square window centered at (cx, cy), clamped
    to the frame. Returns (x, y, peak_brightness) -- peak_brightness lets the caller flag a
    likely lost-lock frame (window centered on background noise, not the landmark)."""
    h, w = gray.shape
    x0, x1 = max(0, int(cx - half)), min(w, int(cx + half))
    y0, y1 = max(0, int(cy - half)), min(h, int(cy + half))
    patch = gray[y0:y1, x0:x1].astype(np.float64)

    # Subtract a floor so dim background doesn't drag the centroid toward the window's geometric
    # center once the landmark itself is bright and localized -- only pixels meaningfully brighter
    # than the patch's own background contribute weight.
    floor = np.percentile(patch, 50)
    weights = np.clip(patch - floor, 0, None)
    total = weights.sum()
    if total <= 1e-6:
        return cx, cy, float(patch.max())

    ys, xs = np.mgrid[0:patch.shape[0], 0:patch.shape[1]]
    wx = (weights * xs).sum() / total + x0
    wy = (weights * ys).sum() / total + y0
    return float(wx), float(wy), float(patch.max())


def track(video_path: Path, seed_x: float, seed_y: float, half_window: int,
          settle_iterations: int = 5) -> list[dict]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")

    cx, cy = seed_x, seed_y

    # `seed_x`/`seed_y` is only an approximate, human-eyeballed position -- re-centering onto the
    # true local centroid takes a frame or two of the main loop below, which otherwise shows up in
    # the trajectory as several pixels of "motion" on the very first frames. That's indistinguishable
    # from real motion to a naive onset detector (sync_detect.detect_motion_onset would trigger on
    # frame 0 every time). Converge on frame 0 BEFORE recording anything, by re-running the centroid
    # calculation on the same still frame repeatedly until it stabilizes.
    ok, first_frame = cap.read()
    if not ok:
        raise RuntimeError(f"{video_path} has no frames")
    first_gray = cv2.cvtColor(first_frame, cv2.COLOR_BGR2GRAY)
    for _ in range(settle_iterations):
        cx, cy, _ = centroid_in_window(first_gray, cx, cy, half_window)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # rewind so the main loop below re-reads frame 0 normally

    rows = []
    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        # The container's own per-frame timestamp, NOT frame_idx/fps -- some capture backends
        # (e.g. recorder/ffmpeg_capture.py's ddagrab, which drops duplicate frames rather than
        # padding gaps with repeats) produce genuinely non-uniform frame spacing even within one
        # clip, so assuming a constant fps here would silently distort the derived angular rate.
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        cx, cy, peak = centroid_in_window(gray, cx, cy, half_window)
        rows.append({
            "frame": frame_idx,
            "t": t,
            "pixel_x": cx,
            "pixel_y": cy,
            "peak_brightness": peak,
        })
        frame_idx += 1
    cap.release()
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", type=Path)
    parser.add_argument("--seed-x", type=float, required=True)
    parser.add_argument("--seed-y", type=float, required=True)
    parser.add_argument("--window", type=int, default=40, help="half-width of the search window, in pixels")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    rows = track(args.video, args.seed_x, args.seed_y, args.window)

    peaks = [r["peak_brightness"] for r in rows]
    lock_floor = 0.5 * max(peaks)
    lost_lock = [r["frame"] for r in rows if r["peak_brightness"] < lock_floor]
    if lost_lock:
        print(f"WARNING: {len(lost_lock)} frame(s) fell below half the clip's peak brightness "
              f"(first at frame {lost_lock[0]}) -- likely lost lock (landmark exited the search "
              f"window or the frame itself). Check --window and the maneuver's timing/FOV margin.")

    out_path = args.out or args.video.with_suffix(".trajectory.csv")
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["frame", "t", "pixel_x", "pixel_y", "peak_brightness"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(rows)} frames tracked -> {out_path}")


if __name__ == "__main__":
    sys.exit(main())
