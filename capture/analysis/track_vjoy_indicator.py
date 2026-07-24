"""Tracks Star Citizen's mouse-virtual-joystick deflection indicator (the faint horizontal line +
triangle at screen center) frame-by-frame, to measure what the "vjoy" settings (VJoyAnglePilots,
deadzone, ...) do. Companion to mouse_sweep_capture.py; see BLUEPRINT.md's "Mouse virtual-joystick"
section for the indicator constants and findings.

Detection method: COLOR, not the temporal f0 lock-in this script used previously.

The lock-in approach (per-pixel correlation with the driven sweep frequency, on the assumption that
only the indicator oscillates at f0) FAILED on a real capture (2026-07-21 session): the tracked
X0:X1/Y0:Y1 band also contains a bright in-world target-lock/range-readout element that moves because
the SHIP is actually yawing at f0 -- so it correlates with f0 just as strongly as the indicator, is far
higher-contrast, and dominated the mask, producing a garbage (negative, wrong-magnitude) fit downstream.

Color discrimination sidesteps this: the indicator has a distinct, documented hue (dark blue-grey at
rest brightening towards lavender/blue at full deflection -- BLUEPRINT.md's "Indicator constants"
section, `#1C2332` -> `#8C8AE9` when last measured) that the contaminating bright white/grey HUD
elements don't share. Within a narrow y-band (the indicator is a ~2px-tall horizontal line) and the
known x-travel band, we connected-component the color-distance mask, reject blobs too narrow to be the
indicator (single-pixel star/noise matches), reject anything outside a sane pixel-offset ceiling (static
false-positive clusters elsewhere in the band), and take the largest remaining blob per frame.

**The indicator's exact color DRIFTS across SC patches/settings** -- confirmed 2026-07-21, it read
`#37738B` (bluer/darker than the BLUEPRINT-documented `#8C8AE9`) that session. Re-sample it before
trusting a capture: grab a frame during a clear deflection (`--dump-frame`), find the indicator by eye,
and read its color, then pass `--color`. Don't reuse an old default across sessions without checking.

Coordinates are for 3840x2160 captures; re-measure for other resolutions (BLUEPRINT constants).

Usage:
    python track_vjoy_indicator.py <video> --color 37738B [--out indicator.csv]
    python track_vjoy_indicator.py <video> --dump-frame 30.0 --dump-frame-out frame.png  # to re-sample color
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np

X0, X1 = 1264, 2550          # indicator x-travel band (BLUEPRINT constant)
Y_CENTER, Y_HEIGHT = 1080, 6  # narrow row the indicator line lives in (measured 2026-07-21: ~1080.5)
CENTER_X = 1907.0
COLOR_THRESH = 28.0           # max color-distance (BGR Euclidean) to count as an indicator-color pixel
MIN_WIDTH = 4                 # reject blobs narrower than this (single-pixel star/noise matches)
BOOTSTRAP_MIN_AREA = 20.0     # min blob area to seed tracking on (avoids locking onto a small static
                               # false-positive cluster before the real indicator is ever seen)
MAX_JUMP_PX = 150.0           # max per-frame movement from the last accepted position -- rejects a
                               # separate static false-positive cluster elsewhere in the band (found at
                               # y~1051-1053, ~450px away) without needing a fixed absolute sanity ceiling


def hex_to_bgr(hexstr: str) -> np.ndarray:
    hexstr = hexstr.lstrip("#")
    r, g, b = int(hexstr[0:2], 16), int(hexstr[2:4], 16), int(hexstr[4:6], 16)
    return np.array([b, g, r], dtype=np.float64)


def track(video_path: Path, color_bgr: np.ndarray, center_x: float = CENTER_X,
          y_center: int = Y_CENTER, y_height: int = Y_HEIGHT,
          thresh: float = COLOR_THRESH, min_width: int = MIN_WIDTH,
          bootstrap_min_area: float = BOOTSTRAP_MIN_AREA,
          max_jump_px: float = MAX_JUMP_PX) -> list[dict]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")

    y0, y1 = y_center - y_height // 2, y_center + y_height // 2
    rows = []
    frame_i = 0
    last_good_x = None  # full-frame x of the last accepted detection -- anchors temporal continuity
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        crop = frame[y0:y1, X0:X1].astype(np.float64)
        dist = np.linalg.norm(crop - color_bgr, axis=2)
        mask = (dist < thresh).astype(np.uint8)
        n, _labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)

        candidates = []
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            w = stats[i, cv2.CC_STAT_WIDTH]
            if w < min_width:
                continue
            candidates.append((area, centroids[i][0] + X0))

        chosen = None
        if candidates:
            if last_good_x is None:
                # Bootstrap: no track yet, so temporal continuity can't help -- require a large blob
                # to avoid seeding on a small static false-positive cluster before the real indicator
                # is ever seen (found at y~1051-1053 in one session, a few px wide).
                best = max(candidates, key=lambda c: c[0])
                if best[0] >= bootstrap_min_area:
                    chosen = best
            else:
                # Already tracking: prefer the candidate nearest the last accepted position, but only
                # accept if the jump is physically plausible -- rejects locking onto a distant static
                # cluster during a frame where the real indicator goes undetected.
                nearest = min(candidates, key=lambda c: abs(c[1] - last_good_x))
                if abs(nearest[1] - last_good_x) <= max_jump_px:
                    chosen = nearest

        if chosen:
            last_good_x = chosen[1]
            pos = chosen[1] - center_x
            weight = float(chosen[0])
        else:
            pos = float("nan")
            weight = 0.0
        rows.append({"frame": frame_i, "t": t, "pos": pos, "weight": weight})
        frame_i += 1
    cap.release()
    if not rows:
        raise RuntimeError(f"{video_path} has no frames")
    return rows


def dump_frame(video_path: Path, t: float, out: Path) -> None:
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 60.0
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise RuntimeError(f"could not read frame at t={t}")
    crop = frame[Y_CENTER - 30:Y_CENTER + 30, X0:X1]
    zoom = cv2.resize(crop, (crop.shape[1], crop.shape[0] * 4), interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(out), zoom)
    print(f"wrote {out} (crop of y=[{Y_CENTER-30},{Y_CENTER+30}), x=[{X0},{X1}], 4x vertical zoom) "
          f"-- inspect to find the indicator and re-sample its color")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", type=Path)
    p.add_argument("--color", type=str, default=None,
                   help="indicator color as hex RGB (e.g. 37738B) -- RE-SAMPLE PER SESSION, see docstring")
    p.add_argument("--center", type=float, default=CENTER_X)
    p.add_argument("--y-center", type=int, default=Y_CENTER)
    p.add_argument("--y-height", type=int, default=Y_HEIGHT)
    p.add_argument("--thresh", type=float, default=COLOR_THRESH)
    p.add_argument("--min-width", type=int, default=MIN_WIDTH)
    p.add_argument("--bootstrap-min-area", type=float, default=BOOTSTRAP_MIN_AREA)
    p.add_argument("--max-jump-px", type=float, default=MAX_JUMP_PX)
    p.add_argument("--f0", type=float, default=None,
                   help="optional: sweep frequency in Hz, for the post-hoc dominant-frequency sanity check only")
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--dump-frame", type=float, default=None,
                   help="instead of tracking, dump a zoomed crop at this timestamp (seconds) to re-sample the indicator's color")
    p.add_argument("--dump-frame-out", type=Path, default=Path("indicator_band.png"))
    args = p.parse_args()

    if args.dump_frame is not None:
        dump_frame(args.video, args.dump_frame, args.dump_frame_out)
        return

    if not args.color:
        raise SystemExit("--color is required (unless using --dump-frame) -- see docstring: the "
                          "indicator's color drifts between sessions, re-sample rather than guessing")

    rows = track(args.video, hex_to_bgr(args.color), args.center, args.y_center, args.y_height,
                 args.thresh, args.min_width, args.bootstrap_min_area, args.max_jump_px)

    pos = np.array([r["pos"] for r in rows], float)
    v = ~np.isnan(pos)
    print(f"{len(rows)} frames, {v.sum()} valid ({100*v.sum()/len(rows):.0f}%); "
          f"range [{np.nanmin(pos):.0f},{np.nanmax(pos):.0f}]px" if v.sum() else f"{len(rows)} frames, 0 valid")
    if args.f0 and v.sum() > 8:
        ts = np.array([r["t"] for r in rows])
        fps = 1.0 / np.median(np.diff(ts))
        c = pos[v] - pos[v].mean()
        F = np.abs(np.fft.rfft(c * np.hanning(len(c))))
        f = np.fft.rfftfreq(len(c), 1.0 / fps)
        print(f"pos dominant freq {f[1 + np.argmax(F[1:])]:.2f}Hz (expect {args.f0:.2f})")

    out = args.out or args.video.with_name("indicator.csv")
    with out.open("w", newline="") as fh:
        wtr = csv.DictWriter(fh, fieldnames=["frame", "t", "pos", "weight"])
        wtr.writeheader(); wtr.writerows(rows)
    print(f"wrote {out}")


if __name__ == "__main__":
    sys.exit(main())
