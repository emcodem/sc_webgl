"""Finds the sync-flash frame in a captured clip -- the corner of the screen orchestrate.py flashes
white at the exact moment it starts driving the maneuver -- so video-frame time can be mapped to
maneuver-relative time (t=0 at the flash) without relying on capture-start latency, which varies
run to run (OBS/ffmpeg startup is not instantaneous and isn't the same every time).

Usage:
    python sync_detect.py <video> --region 0,0,80,80
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np


def region_brightness_trace(video_path: Path, region: tuple[int, int, int, int]) -> tuple[np.ndarray, float]:
    x, y, w, h = region
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0

    brightness = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        patch = frame[y:y + h, x:x + w]
        brightness.append(float(patch.mean()))
    cap.release()
    return np.array(brightness), fps


def detect_flash(brightness: np.ndarray, threshold_sigma: float = 5.0) -> int:
    """Returns the index of the first frame that spikes `threshold_sigma` median-absolute-deviations
    above the trace's baseline -- robust to a mostly-dark or mostly-lit region, since MAD (unlike
    stdev) isn't itself blown out by the one spike frame we're trying to detect."""
    baseline = np.median(brightness)
    mad = np.median(np.abs(brightness - baseline)) + 1e-6
    spikes = np.where(brightness > baseline + threshold_sigma * mad)[0]
    if len(spikes) == 0:
        raise RuntimeError("no flash detected in this region -- check --region covers where "
                            "orchestrate.py's flash actually appears on screen, and that capture "
                            "started before the flash fired")
    return int(spikes[0])


def detect_motion_onset(pixel: np.ndarray, noise_floor_px: float = 1.5, hold_frames: int = 3) -> int:
    """Fallback sync when a visual flash marker isn't usable (some games' borderless/flip-model
    swapchains bypass normal window compositing and paint over even 'always on top' windows, so the
    flash never actually appears in the recording). Finds the first frame where frame-to-frame
    pixel motion exceeds `noise_floor_px` and stays above it for `hold_frames` consecutive frames --
    a sustained motion onset, not a single noisy jump.

    Only valid because every maneuver in feeder/maneuvers/ starts moving immediately (each JSON's
    first segment begins at t=0 with a non-zero axis value), and the ship is expected to be holding
    a steady, undriven attitude right up to that instant -- so "landmark starts moving" and
    "maneuver t=0" are the same event."""
    delta = np.abs(np.diff(pixel))
    for i in range(len(delta) - hold_frames):
        if np.all(delta[i:i + hold_frames] > noise_floor_px):
            return i
    raise RuntimeError("no sustained motion onset detected -- the tracked landmark never appears "
                        "to start moving; check the seed position and that the maneuver actually ran")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", type=Path)
    parser.add_argument("--region", required=True, help="x,y,w,h of the flash corner in pixels")
    parser.add_argument("--threshold-sigma", type=float, default=5.0)
    parser.add_argument("--dump-trace", type=Path, default=None, help="optional: write the full brightness trace for debugging")
    args = parser.parse_args()

    region = tuple(int(v) for v in args.region.split(","))
    brightness, fps = region_brightness_trace(args.video, region)
    frame_idx = detect_flash(brightness, args.threshold_sigma)
    t0 = frame_idx / fps

    if args.dump_trace:
        with args.dump_trace.open("w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["frame", "t", "brightness"])
            for i, b in enumerate(brightness):
                writer.writerow([i, i / fps, b])

    print(f"sync flash detected at frame {frame_idx}, t={t0:.4f}s (fps={fps:.3f})")


if __name__ == "__main__":
    sys.exit(main())
