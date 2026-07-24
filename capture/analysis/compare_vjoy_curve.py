"""Compares sc_webgl's raw vjoy accumulator against real SC's on-screen indicator, driven by the
SAME physical/injected mouse motion (via mouse-capture.py's relay), to fit sc_webgl's true
full-deflection raw-mouse-count gain from real synchronized data instead of eyeballing a slider.

Inputs are two INDEPENDENT recordings -- no shared clock, no simultaneous-capture requirement:
  - --ours: a CSV from sc_webgl's console tool (window.__vjoyLog.start()/.stop(), see
    src/debug/vjoyRecorder.ts) -- columns t,offsetX,offsetY, RAW mouse counts (not curved/normalized).
  - --sc: indicator.csv from analysis/track_vjoy_indicator.py, run against a video of real SC driven
    by the SAME mouse_feeder.py oscillate run (same axis, same --period, matching --f0) -- columns
    frame,t,pos,weight, pos = indicator pixel offset from screen-center-x.

Method:
  1. Each recording's own t=0 is arbitrary (whenever the console tool / video capture happened to
     start) -- align them independently via detect_motion_onset (reused from sync_detect.py) on
     each recording's own position trace, since both are driven by the identical scripted waveform
     starting from a held-neutral stick (same assumption that function's docstring already relies
     on for the vJoy-device captures).
  2. Convert SC's pixel trace to a normalized stick ratio (-1..1) via the pinhole/FOV projection
     already validated for the indicator (capture/MEASUREMENTS.md's "indicator pixel travel" finding):
     SC renders the indicator at `vja_degrees * ratio` off boresight, so
     ratio = arctan(pos / focal_length) / radians(vja_degrees).
  3. Resample the sparser trace onto the denser one's timestamps (linear interpolation) over the
     overlapping time range.
  4. Fit `full_range` (raw counts for ratio=1) by least-squares through the origin:
     full_range = sum(ours_counts * sc_ratio) / sum(sc_ratio^2)
     (ignores deadzone/curve-shape near center -- a first-pass linear gain fit; large residuals
     concentrated near zero would point at a deadzone mismatch instead, worth eyeballing the
     --dump-csv output for if the fit RMS looks high).

Usage:
    python compare_vjoy_curve.py --ours vjoy-log-....csv --sc indicator.csv \\
        --axis x --vja 10 --fov 116 --width 3840 [--dump-csv aligned.csv]
"""

import argparse
import csv
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from sync_detect import detect_motion_onset  # noqa: E402  (reused, not duplicated)


def read_ours(path: Path, axis: str) -> tuple[np.ndarray, np.ndarray]:
    t, v = [], []
    with path.open() as f:
        for row in csv.DictReader(f):
            t.append(float(row["t"]))
            v.append(float(row["offsetX" if axis == "x" else "offsetY"]))
    return np.array(t), np.array(v)


def read_sc(path: Path) -> tuple[np.ndarray, np.ndarray]:
    t, pos = [], []
    with path.open() as f:
        for row in csv.DictReader(f):
            p = row["pos"]
            if p == "" or p.lower() == "nan":
                continue
            t.append(float(row["t"]))
            pos.append(float(p))
    return np.array(t), np.array(pos)


def align_to_onset(t: np.ndarray, v: np.ndarray, **kwargs) -> np.ndarray:
    idx = detect_motion_onset(v, **kwargs)
    return t - t[idx]


MIN_OURS_STD = 200.0  # reject a candidate alignment whose overlap window has less spread than this in
                       # our own raw counts -- otherwise a shift with NO real overlapping motion (both
                       # traces near rest) gives a trivial, meaningless "perfect" 0/0 fit that an RMS
                       # search would otherwise treat as the best answer (confirmed 2026-07-21: a wide
                       # blind search landed on exactly this degenerate minimum before this guard existed)


def fit_at_shift(t_ours: np.ndarray, ours_counts: np.ndarray, t_sc: np.ndarray, sc_ratio: np.ndarray,
                  shift: float) -> tuple[float, float, float, np.ndarray] | None:
    """Fits full_range with the SC trace's timebase shifted by `shift` seconds. Returns
    (full_range, rms, corr, grid) or None if the shift leaves no overlapping time range, or no real
    signal (see MIN_OURS_STD)."""
    t_sc_shifted = t_sc - shift
    lo, hi = max(t_ours.min(), t_sc_shifted.min()), min(t_ours.max(), t_sc_shifted.max())
    if lo >= hi:
        return None
    grid = t_sc_shifted if len(t_sc_shifted) <= len(t_ours) else t_ours
    grid = grid[(grid >= lo) & (grid <= hi)]
    if len(grid) < 20:
        return None
    ours_g = np.interp(grid, t_ours, ours_counts)
    ratio_g = np.interp(grid, t_sc_shifted, sc_ratio)
    if np.std(ours_g) < MIN_OURS_STD or np.std(ratio_g) == 0:
        return None
    denom = np.sum(ratio_g ** 2)
    if denom == 0:
        return None
    full_range = float(np.sum(ours_g * ratio_g) / denom)
    rms = float(np.sqrt(np.mean((ours_g - full_range * ratio_g) ** 2)))
    corr = float(np.corrcoef(ours_g, ratio_g)[0, 1])
    return full_range, rms, corr, grid


def refine_alignment(t_ours: np.ndarray, ours_counts: np.ndarray, t_sc: np.ndarray, sc_ratio: np.ndarray,
                      window: float, step: float) -> float:
    """detect_motion_onset's rough onset estimate can be off by MORE than a couple seconds on a
    sparse/gappy trace (e.g. a color-tracked indicator with many NaN-dropped frames near center
    violates its assumption of uniformly-spaced samples) -- confirmed 2026-07-21, off by several
    seconds on a real capture, enough that a narrow local refinement around it missed the true
    alignment entirely.

    Scores by CORRELATION STRENGTH (|r|), not raw fit RMS -- minimizing RMS alone is gameable: a
    shift that lands the overlap window on a low-signal/uncorrelated stretch of both traces can have
    LOWER raw RMS than the true alignment simply because there's less to be wrong about, even though
    the "fit" there is meaningless (confirmed 2026-07-21: an RMS-only search found exactly such a
    window, with a small/wrong-sign full_range that had *lower* RMS than the correct, strongly-
    correlated alignment). Correlation is scale-invariant and isn't fooled by this.

    Two-stage search, so a badly-off initial estimate doesn't trap this in the wrong neighborhood:
    a COARSE pass across the full +/-window range finds roughly the right neighborhood, then a FINE
    pass at `step` resolution around that coarse best."""
    coarse_step = max(step, window / 150)
    best_shift, best_abscorr = 0.0, -1.0
    for shift in np.arange(-window, window + coarse_step, coarse_step):
        result = fit_at_shift(t_ours, ours_counts, t_sc, sc_ratio, shift)
        if result is None:
            continue
        _full_range, _rms, corr, _grid = result
        if abs(corr) > best_abscorr:
            best_shift, best_abscorr = shift, abs(corr)

    fine_window = coarse_step * 2
    for shift in np.arange(best_shift - fine_window, best_shift + fine_window + step, step):
        result = fit_at_shift(t_ours, ours_counts, t_sc, sc_ratio, shift)
        if result is None:
            continue
        _full_range, _rms, corr, _grid = result
        if abs(corr) > best_abscorr:
            best_shift, best_abscorr = shift, abs(corr)
    return best_shift


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ours", type=Path, required=True)
    p.add_argument("--sc", type=Path, required=True)
    p.add_argument("--axis", choices=["x", "y"], default="x", help="which of our offsetX/offsetY was driven (x=yaw, y=pitch)")
    p.add_argument("--vja", type=float, required=True, help="VJoyAnglePilots value active during the SC capture")
    p.add_argument("--fov", type=float, default=116.0, help="SC's horizontal FOV during capture")
    p.add_argument("--width", type=float, required=True, help="SC capture resolution width in px")
    p.add_argument("--noise-floor-px", type=float, default=1.5, help="passed to detect_motion_onset for the SC trace")
    p.add_argument("--noise-floor-counts", type=float, default=1.0, help="passed to detect_motion_onset for our own trace")
    p.add_argument("--hold-frames", type=int, default=8,
                   help="passed to detect_motion_onset for BOTH traces -- sync_detect.py's own "
                        "default of 3 is prone to false-triggering on tracker/sample noise before "
                        "the real onset (verified via a synthetic test: 3 desynced by ~1s on "
                        "1px-std noise; 8 recovered the exact true onset). Raise further if a real "
                        "trace still triggers early; too high overshoots PAST the true onset instead.")
    p.add_argument("--refine-window", type=float, default=45.0,
                   help="seconds of extra time-shift to search on the SC trace after the initial "
                        "onset alignment, picking whichever minimizes fit RMS (see refine_alignment "
                        "docstring -- corrects for detect_motion_onset misfiring on a sparse/gappy "
                        "trace, which was off by more than a couple seconds on a real capture). Set "
                        "to 0 to disable and trust detect_motion_onset alone.")
    p.add_argument("--refine-step", type=float, default=0.02, help="grid step in seconds for --refine-window")
    p.add_argument("--dump-csv", type=Path, default=None, help="optional: write the aligned/resampled comparison for manual inspection")
    args = p.parse_args()

    t_ours, ours_counts = read_ours(args.ours, args.axis)
    t_sc, sc_pos = read_sc(args.sc)

    t_ours = align_to_onset(t_ours, ours_counts, noise_floor_px=args.noise_floor_counts, hold_frames=args.hold_frames)
    t_sc = align_to_onset(t_sc, sc_pos, noise_floor_px=args.noise_floor_px, hold_frames=args.hold_frames)

    focal_length = (args.width / 2) / np.tan(np.radians(args.fov) / 2)
    sc_ratio = np.arctan(sc_pos / focal_length) / np.radians(args.vja)

    if args.refine_window > 0:
        shift = refine_alignment(t_ours, ours_counts, t_sc, sc_ratio, args.refine_window, args.refine_step)
        if abs(shift) > 1e-9:
            print(f"refined SC-trace alignment by {shift:+.2f}s beyond the initial onset detection")
        t_sc = t_sc - shift

    result = fit_at_shift(t_ours, ours_counts, t_sc, sc_ratio, 0.0)
    if result is None:
        raise SystemExit("no overlapping time range between the two traces after alignment -- "
                          "check both recordings actually cover the same maneuver")
    full_range, rms, corr, grid = result
    ours_on_grid = np.interp(grid, t_ours, ours_counts)
    sc_ratio_on_grid = np.interp(grid, t_sc, sc_ratio)
    predicted = sc_ratio_on_grid * full_range

    print(f"{len(grid)} aligned samples over {grid.max() - grid.min():.2f}s overlap")
    print(f"focal_length={focal_length:.1f}px (fov={args.fov}, width={args.width})")
    print(f"fitted full_range (raw counts @ ratio=1): {full_range:.1f}")
    print(f"fit RMS (our raw counts vs full_range*sc_ratio): {rms:.1f} counts, correlation: {corr:.4f}")
    print("Large RMS concentrated near ratio=0 would point at a deadzone mismatch rather than a "
          "pure gain error -- check --dump-csv if this looks high. Low |correlation| (well under "
          "0.9) means the alignment itself is suspect, not just the gain fit.")

    if args.dump_csv:
        with args.dump_csv.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["t", "ours_raw_counts", "sc_ratio", "sc_ratio_times_fitted_full_range"])
            for row in zip(grid, ours_on_grid, sc_ratio_on_grid, predicted):
                w.writerow(row)
        print(f"wrote {args.dump_csv}")


if __name__ == "__main__":
    sys.exit(main())
