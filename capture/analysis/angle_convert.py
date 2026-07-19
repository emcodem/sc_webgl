"""Converts a landmark's pixel trajectory (from track_landmark.py) into an angle(t) curve via a
pinhole-camera model, then differentiates (with light smoothing) to get the angular-rate curve
omega(t) the flight-model fit actually needs.

angle = atan2(pixel_offset_from_center, focal_length_px)
focal_length_px = (frame_dimension_px / 2) / tan(fov_deg / 2)

`--axis x` (yaw) uses pixel_x against the horizontal FOV and frame width; `--axis y` (pitch) uses
pixel_y against the vertical FOV and frame height. Only valid for a landmark that stays reasonably
close to boresight/center-of-frame -- this is a small-angle-friendly approximation of the true lens
projection, not an exact model for a landmark that wanders to the frame's edge.

`--axis roll` uses a COMPLETELY DIFFERENT model, because roll rotates the image around its own
center rather than translating a landmark's apparent bearing: angle is the landmark's polar angle
atan2(y - center_y, x - center_x) around the frame center. This is exact for any FOV/lens (no
small-angle approximation, no FOV dependence at all -- a pure image-plane rotation), but it REQUIRES
the landmark to be seeded well off-center (a landmark sitting at/near the frame center barely moves
under roll at all, however fast the ship is actually rolling -- angular pixel speed around the
center scales with the landmark's radius from center). `--fov`/`--resolution` are still required for
CLI consistency with x/y but resolution's only use for roll is locating the frame center.

Usage:
    python angle_convert.py <trajectory.csv> --axis x --fov 90 --resolution 1920x1080 [--out omega.csv]
    python angle_convert.py <trajectory.csv> --axis roll --resolution 1920x1080 [--out omega.csv]
"""

import argparse
import csv
import sys
from pathlib import Path

import numpy as np
from scipy.signal import savgol_filter


def focal_length_px(dimension_px: float, fov_deg: float) -> float:
    return (dimension_px / 2) / np.tan(np.radians(fov_deg) / 2)


def pixel_to_angle_deg(pixel: np.ndarray, center_px: float, focal_px: float) -> np.ndarray:
    return np.degrees(np.arctan2(pixel - center_px, focal_px))


def pixel_to_roll_angle_deg(pixel_x: np.ndarray, pixel_y: np.ndarray,
                             center_x: float, center_y: float) -> np.ndarray:
    """Polar angle of the landmark around the frame center -- roll IS this angle changing over
    time, exactly (no lens/FOV model needed, unlike yaw/pitch's pinhole projection). atan2 wraps at
    +-180 deg, which a fast roll maneuver (Gladius: ~200 deg/s) can easily cross within a ~1-2s
    clip -- np.unwrap stitches those wrap-around jumps back into a continuous curve before
    differentiating, same reason as any angle-integration problem."""
    angle_deg = np.degrees(np.arctan2(pixel_y - center_y, pixel_x - center_x))
    return np.degrees(np.unwrap(np.radians(angle_deg)))


def smooth_and_differentiate(t: np.ndarray, angle_deg: np.ndarray, window: int, polyorder: int) -> np.ndarray:
    """Savitzky-Golay smoothing before differentiating -- smoothing the raw angle first (rather
    than differentiating raw pixel noise and smoothing the noisy result after) avoids amplifying
    per-frame pixel-tracking jitter into a much noisier rate curve."""
    window = min(window, len(angle_deg) if len(angle_deg) % 2 == 1 else len(angle_deg) - 1)
    if window < polyorder + 2:
        # too few samples to smooth meaningfully -- fall back to raw finite differences
        smoothed = angle_deg
    else:
        smoothed = savgol_filter(angle_deg, window_length=window, polyorder=polyorder)
    return np.gradient(smoothed, t)


def drop_non_advancing_timestamps(trajectory_rows: list[dict]) -> list[dict]:
    """Some capture backends occasionally emit two frames sharing an identical container timestamp
    (e.g. a rounding collision, or a genuinely repeated capture) -- a zero time gap between samples
    makes np.gradient divide by zero (see smooth_and_differentiate). Keeps the first frame at each
    timestamp and drops the rest; a repeated timestamp carries no new temporal information anyway."""
    filtered = []
    last_t = None
    for row in trajectory_rows:
        if last_t is None or row["t"] > last_t:
            filtered.append(row)
            last_t = row["t"]
    return filtered


def convert(trajectory_rows: list[dict], axis: str, fov_deg: float, resolution: tuple[int, int],
            smooth_window: int, smooth_poly: int) -> list[dict]:
    trajectory_rows = drop_non_advancing_timestamps(trajectory_rows)
    t = np.array([r["t"] for r in trajectory_rows])
    width, height = resolution

    if axis == "roll":
        pixel_x = np.array([r["pixel_x"] for r in trajectory_rows])
        pixel_y = np.array([r["pixel_y"] for r in trajectory_rows])
        angle_deg = pixel_to_roll_angle_deg(pixel_x, pixel_y, width / 2, height / 2)
    else:
        # Focal length (in pixels) is a single camera-intrinsic value for square pixels -- it must
        # always be derived from the HORIZONTAL dimension/FOV (what --fov actually is, matching SC's
        # Options > Graphics FOV setting), then reused as-is for the vertical/pitch axis too. A prior
        # version of this function derived focal_px from `height` using the same (horizontal) fov_deg
        # for axis=="y" -- that treats the horizontal FOV as if it were vertical, understating focal_px
        # by exactly the aspect ratio (3840/2160 = 1.778) and so overstating every pitch angle/rate by
        # that same factor. Caught because a pitch reversal fit's peak rate (~110-120 deg/s) divided by
        # 1.778 landed almost exactly on the coded maxAngVel.pitch (68.2 deg/s) -- see BLUEPRINT.md.
        focal_px = focal_length_px(width, fov_deg)
        if axis == "x":
            pixel = np.array([r["pixel_x"] for r in trajectory_rows])
            center_px = width / 2
        else:
            pixel = np.array([r["pixel_y"] for r in trajectory_rows])
            center_px = height / 2
        angle_deg = pixel_to_angle_deg(pixel, center_px, focal_px)

    omega_deg_s = smooth_and_differentiate(t, angle_deg, smooth_window, smooth_poly)

    return [
        {"t": tt, "angle_deg": a, "omega_deg_s": w}
        for tt, a, w in zip(t, angle_deg, omega_deg_s)
    ]


def load_trajectory(path: Path) -> list[dict]:
    with path.open() as f:
        reader = csv.DictReader(f)
        return [
            {"frame": int(row["frame"]), "t": float(row["t"]),
             "pixel_x": float(row["pixel_x"]), "pixel_y": float(row["pixel_y"])}
            for row in reader
        ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("trajectory", type=Path)
    parser.add_argument("--axis", choices=["x", "y", "roll"], required=True,
                         help="x=yaw (horizontal), y=pitch (vertical), roll=polar angle about frame center")
    parser.add_argument("--fov", type=float, required=True, help="FOV in degrees for the chosen axis's dimension")
    parser.add_argument("--resolution", required=True, help="WIDTHxHEIGHT, e.g. 1920x1080")
    parser.add_argument("--smooth-window", type=int, default=11)
    parser.add_argument("--smooth-poly", type=int, default=3)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    width, height = (int(v) for v in args.resolution.lower().split("x"))
    rows = load_trajectory(args.trajectory)
    result = convert(rows, args.axis, args.fov, (width, height), args.smooth_window, args.smooth_poly)

    out_path = args.out or args.trajectory.with_suffix("").with_suffix(".omega.csv")
    with out_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["t", "angle_deg", "omega_deg_s"])
        writer.writeheader()
        writer.writerows(result)
    print(f"{len(result)} samples -> {out_path}")


if __name__ == "__main__":
    sys.exit(main())
