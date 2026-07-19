"""Tracks Star Citizen's mouse-virtual-joystick deflection indicator (the faint horizontal line +
triangle at screen center) frame-by-frame, to measure what the "vjoy" settings (VJoyAnglePilots,
deadzone, ...) do. Companion to mouse_sweep_capture.py; see BLUEPRINT.md's "Mouse virtual-joystick"
section for the indicator constants and findings.

Detection method (this is the one that actually works -- earlier attempts and why they failed are in
BLUEPRINT.md):
- The indicator is FAINT and small, flanked by BRIGHT static cockpit struts at the strip edges. A
  "brightest/farthest bluish pixel" tracker locks onto the struts and reports fake full deflection.
- The robust discriminator is TEMPORAL, not spatial/color: only the indicator oscillates at the
  driven sweep frequency f0. A per-pixel lock-in at f0 builds a MASK of the indicator's track;
  static struts (no f0 energy) and slowly-drifting scene objects (incoherent with f0) are both
  excluded by construction. The per-frame f0-masked, motion-weighted centroid then tracks position.
- REQUIRES f0 (the sweep frequency = 1/period from the capture's meta.json). REQUIRES a FAST sweep:
  at fast rates the ship barely rotates so the scene isn't coherent at f0 (slow sweeps make the scene
  move at f0 too, defeating the mask). Consequence of SC's indicator smoothing: a fast sweep only
  partially deflects the indicator (small but clean signal) -- see BLUEPRINT.md.

Coordinates are for 3840x2160 captures; re-measure for other resolutions (BLUEPRINT constants).

Usage:
    python track_vjoy_indicator.py <video> --f0 1.0 [--out indicator.csv]
"""

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np

X0, X1 = 1264, 2550          # indicator x-travel band (BLUEPRINT constant)
Y0, Y1 = 1050, 1110          # thin band at screen-center y where the indicator line lives
CENTER_X = 1907.0
MASK_FRAC = 0.40             # keep pixels with >= this fraction of the peak f0 lock-in amplitude
MIN_MASS = 5.0               # min per-frame masked motion weight to yield a reading (else NaN)


def track(video_path: Path, f0: float, center_x: float = CENTER_X) -> list[dict]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"could not open {video_path}")
    grays, ts = [], []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        ts.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
        grays.append(cv2.cvtColor(f[Y0:Y1, X0:X1], cv2.COLOR_BGR2GRAY).astype(np.float64))
    cap.release()
    if not grays:
        raise RuntimeError(f"{video_path} has no frames")

    S = np.stack(grays)                                  # (T, H, W)
    tsa = np.array(ts)
    T = len(S)
    mean = S.mean(0)

    # per-pixel lock-in at the sweep frequency -> indicator-track mask (rejects static + non-f0 drift)
    sn = np.sin(2 * np.pi * f0 * tsa)[:, None, None]
    cs = np.cos(2 * np.pi * f0 * tsa)[:, None, None]
    I = ((S - mean) * sn).sum(0)
    Q = ((S - mean) * cs).sum(0)
    amp = 2.0 / T * np.sqrt(I * I + Q * Q)
    mask = amp > (MASK_FRAC * amp.max())

    xs = np.arange(X0, X1)
    rows = []
    for i in range(T):
        w = (np.abs(S[i] - mean) * mask).sum(0)          # per-column motion weight, indicator track only
        tot = w.sum()
        pos = float((w * xs).sum() / tot - center_x) if tot > MIN_MASS else np.nan
        rows.append({"frame": i, "t": float(tsa[i]), "pos": pos, "weight": float(tot)})
    return rows


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("video", type=Path)
    p.add_argument("--f0", type=float, required=True, help="sweep frequency in Hz (= 1/period from meta.json)")
    p.add_argument("--center", type=float, default=CENTER_X)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    rows = track(args.video, args.f0, args.center)
    pos = np.array([r["pos"] for r in rows], float)
    v = ~np.isnan(pos)
    if v.sum() > 8:
        ts = np.array([r["t"] for r in rows])
        fps = 1.0 / np.median(np.diff(ts))
        c = pos[v] - pos[v].mean()
        F = np.abs(np.fft.rfft(c * np.hanning(len(c))))
        f = np.fft.rfftfreq(len(c), 1.0 / fps)
        print(f"{len(rows)} frames, {v.sum()} valid; pos dominant freq {f[1 + np.argmax(F[1:])]:.2f}Hz "
              f"(expect {args.f0:.2f}); range [{np.nanmin(pos):.0f},{np.nanmax(pos):.0f}]px")

    out = args.out or args.video.with_name("indicator.csv")
    with out.open("w", newline="") as fh:
        wtr = csv.DictWriter(fh, fieldnames=["frame", "t", "pos", "weight"])
        wtr.writeheader(); wtr.writerows(rows)
    print(f"wrote {out}")


if __name__ == "__main__":
    sys.exit(main())
