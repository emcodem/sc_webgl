"""Tracks the ORIENTATION (long-axis angle) of an ELONGATED object across a clip -> roll angle(t)
-> roll rate omega(t). The roll-measurement front-end for a long landmark (Security Post Kareah, or
any rod/post-shaped structure), as opposed to track_landmark.py which tracks a compact point's
POSITION.

Why orientation, not position: under roll the whole world image rotates about screen center. A
compact point must sit OFF-center to move measurably (its pixel speed scales with radius from
center). An elongated object instead reveals roll through its long axis ANGLE, which is independent
of where the object sits -- so the object can (and ideally does) sit CENTERED on the roll axis: it
then stays framed for a full rotation and never swings behind the cockpit dash. Start it VERTICAL at
roll=0 and its axis angle, minus 90 deg, is the roll amount.

Method per frame: in a re-centering search window around the object, brightness-weight the pixels
above a floor (the lit structure against dark space) and take the second central moments -- the
major-axis angle is 0.5*atan2(2*mu11, mu20 - mu02). This is the intensity-weighted principal axis
(PCA) of the bright structure, robust for a clearly elongated, high-contrast object.

180-deg symmetry: a bare rod's axis angle is only defined mod 180 deg (swapping ends looks
identical). np.unwrap on 2*theta (period 2pi on the doubled angle == period pi on theta) stitches
the true continuous curve across both the +-90deg axis wrap AND the mod-180 ambiguity, provided the
per-frame roll stays < 90 deg (trivially true: ~3-4 deg/frame at 60fps even at 200 deg/s). Sign of
the roll (which way) is not recoverable from a symmetric rod alone -- take it from the driven key
(Q=left/E=right) in the capture's segments.json, or, if the object's two ends differ visibly, from
an end-asymmetry check (not done here; add if needed).

Elongation (major/minor eigenvalue ratio) is logged per frame as a LOCK/QUALITY signal: if it drops
toward 1 the window has lost the elongated object (grabbed a blob of HUD or background) and that
frame's angle is meaningless -- the fitted omega there will be garbage, same role peak_brightness
plays in track_landmark.

Usage:
    python track_orientation.py <video> --seed-x 1920 --seed-y 1000 --window 220 [--out o.csv]
    # then inspect o.csv's omega_deg_s; the driven segments come from the capture's segments.json
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.signal import savgol_filter


def orientation_in_window(gray: np.ndarray, cx: float, cy: float, half: int,
                          floor_pct: float, mask_below: float | None = None) -> tuple[float, float, float, float, float]:
    """Intensity-weighted principal axis of the bright structure in a (2*half)-square window.
    Returns (centroid_x, centroid_y, angle_deg, elongation, peak). angle_deg in [0,180): the major
    axis measured CCW from the +x image axis (note image y points down, so this is a screen angle;
    only its CHANGE over time matters for roll rate). elongation = sqrt(lambda_major/lambda_minor).

    mask_below: an ABSOLUTE image y (screen-fixed); pixels below it get zero weight. Use it to drop a
    fixed occluder that overlaps the object -- e.g. the cockpit radar dish / boost bars / velocity
    vector that hide and out-shine the bottom of a centered vertical post. The visible upper part
    still fixes the axis direction (a rod's principal axis is the same whether you see half or all)."""
    h, w = gray.shape
    x0, x1 = max(0, int(cx - half)), min(w, int(cx + half))
    y0, y1 = max(0, int(cy - half)), min(h, int(cy + half))
    patch = gray[y0:y1, x0:x1].astype(np.float64)

    # Weight only pixels meaningfully brighter than the window's own background, so the dark space
    # around the lit structure contributes no torque to the moment fit (same floor-subtraction idea
    # as track_landmark's centroid).
    floor = np.percentile(patch, floor_pct)
    wts = np.clip(patch - floor, 0, None)
    if mask_below is not None:
        row_abs_y = np.arange(y0, y1)[:, None]  # absolute image y for each patch row
        wts = np.where(row_abs_y > mask_below, 0.0, wts)
    total = wts.sum()
    peak = float(patch.max())
    if total <= 1e-6:
        return cx, cy, float("nan"), 1.0, peak

    ys, xs = np.mgrid[0:patch.shape[0], 0:patch.shape[1]]
    mx = (wts * xs).sum() / total
    my = (wts * ys).sum() / total
    # central second moments (normalized)
    mu20 = (wts * (xs - mx) ** 2).sum() / total
    mu02 = (wts * (ys - my) ** 2).sum() / total
    mu11 = (wts * (xs - mx) * (ys - my)).sum() / total

    angle = 0.5 * np.arctan2(2 * mu11, mu20 - mu02)  # radians, major axis, (-pi/2, pi/2]
    angle_deg = np.degrees(angle) % 180.0

    # eigenvalues of the 2x2 covariance [[mu20,mu11],[mu11,mu02]] -> elongation
    tr, det = mu20 + mu02, mu20 * mu02 - mu11 ** 2
    disc = max(tr * tr / 4 - det, 0.0)
    lam_major = tr / 2 + np.sqrt(disc)
    lam_minor = max(tr / 2 - np.sqrt(disc), 1e-9)
    elong = float(np.sqrt(lam_major / lam_minor))

    return float(mx + x0), float(my + y0), float(angle_deg), elong, peak


def track(video_path: Path, seed_x: float, seed_y: float, half: int, floor_pct: float,
          mask_below: float | None = None, settle_iterations: int = 5) -> list[dict]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")

    cx, cy = seed_x, seed_y
    ok, first = cap.read()
    if not ok:
        raise RuntimeError(f"{video_path} has no frames")
    fg = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
    for _ in range(settle_iterations):
        cx, cy, *_ = orientation_in_window(fg, cx, cy, half, floor_pct, mask_below)
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    rows, idx = [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        cx, cy, ang, elong, peak = orientation_in_window(gray, cx, cy, half, floor_pct, mask_below)
        rows.append({"frame": idx, "t": t, "cx": cx, "cy": cy,
                     "angle_deg": ang, "elongation": elong, "peak": peak})
        idx += 1
    cap.release()
    return rows


def compute_omega(rows: list[dict], window: int, poly: int) -> list[dict]:
    """Mod-180 unwrap (via doubling) + savgol-smoothed derivative -> roll rate deg/s."""
    # drop non-advancing timestamps (see angle_convert.drop_non_advancing_timestamps)
    filt, last = [], None
    for r in rows:
        if last is None or r["t"] > last:
            filt.append(r); last = r["t"]
    t = np.array([r["t"] for r in filt])
    ang = np.array([r["angle_deg"] for r in filt])

    # unwrap the DOUBLED angle (period pi on theta) so the +-90 axis-wrap and the 180 end-swap both
    # stitch, then halve back. nan-guard: fill nan by forward hold so unwrap stays continuous.
    good = ~np.isnan(ang)
    if good.sum() >= 2:
        ang = np.interp(np.arange(len(ang)), np.flatnonzero(good), ang[good])
    theta2 = np.unwrap(np.radians(2 * ang))
    theta = np.degrees(theta2) / 2.0

    win = min(window, len(theta) if len(theta) % 2 == 1 else len(theta) - 1)
    theta_s = savgol_filter(theta, win, poly) if win >= poly + 2 else theta
    omega = np.gradient(theta_s, t)

    return [{"t": tt, "angle_unwrapped_deg": a, "omega_deg_s": w, "elongation": r["elongation"], "peak": r["peak"]}
            for tt, a, w, r in zip(t, theta, omega, filt)]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", type=Path)
    p.add_argument("--seed-x", type=float, required=True, help="approx object center x in frame 0")
    p.add_argument("--seed-y", type=float, required=True, help="approx object center y in frame 0")
    p.add_argument("--window", type=int, default=220, help="half-size of search window (px); cover the whole post + margin")
    p.add_argument("--floor-pct", type=float, default=80.0, help="percentile brightness floor inside window")
    p.add_argument("--mask-below", type=float, default=None,
                   help="absolute image y; zero-weight pixels below it (drop a fixed occluder like the radar dish)")
    p.add_argument("--smooth-window", type=int, default=11)
    p.add_argument("--smooth-poly", type=int, default=3)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    rows = track(args.video, args.seed_x, args.seed_y, args.window, args.floor_pct, args.mask_below)
    result = compute_omega(rows, args.smooth_window, args.smooth_poly)

    elo = np.array([r["elongation"] for r in result])
    weak = int((elo < 1.5).sum())
    if weak:
        print(f"WARNING: {weak}/{len(result)} frames had elongation < 1.5 (near-round) -- likely "
              f"lost the elongated object in those frames; their angle/omega are unreliable.")

    out = args.out or args.video.with_suffix(".orient.csv")
    with out.open("w", newline="") as f:
        wtr = csv.DictWriter(f, fieldnames=["t", "angle_unwrapped_deg", "omega_deg_s", "elongation", "peak"])
        wtr.writeheader(); wtr.writerows(result)
    print(f"{len(result)} frames -> {out}")
    om = np.array([r["omega_deg_s"] for r in result])
    print(f"omega range {om.min():.1f}..{om.max():.1f} deg/s; |median| while moving "
          f"{np.median(np.abs(om[np.abs(om) > 5])) if (np.abs(om) > 5).any() else 0:.1f} deg/s")


if __name__ == "__main__":
    sys.exit(main())
