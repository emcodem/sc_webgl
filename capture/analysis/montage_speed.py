"""Tiles a small HUD region (the speed / OSD readout) sampled every N frames into ONE labelled
montage image, so the speed(t) curve can be read straight off it -- the analysis half of the LINEAR
(strafe / throttle) capture, where speed is a HUD NUMBER, not a trackable landmark (see
linear_hold_capture.py). No OCR engine required: read the montage by eye (or hand it to a vision
model) and transcribe speed vs the burned-in timestamp.

Pick --region from a single extracted frame (crop the speed readout; with motion blur OFF the OSD
velocity line or the cockpit 'NNN m/s' number are both crisp). Sample densely enough to resolve the
accel ramp and the coast decay -- ~6-8 fps of samples (step 8-10 at 60fps) is usually plenty.

Usage:
    python montage_speed.py <video> --region 1590,1120,150,90 --step 8 --cols 10 --out speed_montage.png
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np


def build(video: Path, region: tuple[int, int, int, int], step: int, cols: int,
          start_frame: int, end_frame: int | None, scale: float) -> np.ndarray:
    x, y, w, h = region
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video}")
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    end = min(end_frame or total, total)

    tiles = []
    idx = start_frame
    while idx < end:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok:
            break
        crop = frame[y:y + h, x:x + w].copy()
        if scale != 1.0:
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        # burn in the timestamp (video seconds) so each tile is self-labelling
        t = idx / fps
        label = np.zeros((26, crop.shape[1], 3), np.uint8)
        cv2.putText(label, f"t={t:5.2f}", (2, 19), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 1, cv2.LINE_AA)
        tile = np.vstack([label, crop])
        cv2.rectangle(tile, (0, 0), (tile.shape[1] - 1, tile.shape[0] - 1), (60, 60, 60), 1)
        tiles.append(tile)
        idx += step
    cap.release()

    if not tiles:
        raise RuntimeError("no tiles produced -- check --start-frame/--end-frame/--region")
    th, tw = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    sheet = np.zeros((rows * th, cols * tw, 3), np.uint8)
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet[r * th:r * th + th, c * tw:c * tw + tw] = tile
    return sheet


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", type=Path)
    p.add_argument("--region", required=True, help="x,y,w,h of the speed readout in the full frame")
    p.add_argument("--step", type=int, default=8, help="sample every N frames (60fps: 8 ~= 7.5 samples/s)")
    p.add_argument("--cols", type=int, default=10)
    p.add_argument("--start-frame", type=int, default=0)
    p.add_argument("--end-frame", type=int, default=None)
    p.add_argument("--scale", type=float, default=3.0, help="upscale each crop (nearest) for legibility")
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    region = tuple(int(v) for v in args.region.split(","))
    if len(region) != 4:
        p.error("--region must be x,y,w,h")
    sheet = build(args.video, region, args.step, args.cols, args.start_frame, args.end_frame, args.scale)
    out = args.out or args.video.with_name("speed_montage.png")
    cv2.imwrite(str(out), sheet)
    print(f"montage {sheet.shape[1]}x{sheet.shape[0]} -> {out}")


if __name__ == "__main__":
    sys.exit(main())
