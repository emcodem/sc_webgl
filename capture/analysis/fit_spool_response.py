"""Fits the rotational spool-up transient -- rate rising from 0 to steady-state after a fast-ramped
mouse-vjoy step (`--ramp 0.05`, approximating a true step input) -- against two candidate models:
the coded 1st-order exponential lag and a 2nd-order underdamped step response. This is the reusable
version of the ad hoc fit already used for pitch/yaw x boosted/non-boosted -- see
capture/MEASUREMENTS.md's "Spool-up transient is a 2nd-order underdamped step response" section for
the method and the findings it reproduces (rate_ss/omega_n/zeta table).

  1st-order lag:  rate(t) = rate_ss * (1 - exp(-t/tau))
  2nd-order:      rate(t) = rate_ss * (1 - exp(-zeta*wn*t) * (cos(wd*t) + (zeta*wn/wd)*sin(wd*t)))
                  wd = wn * sqrt(1 - zeta**2)  -- only valid underdamped (0 < zeta < 1)

Fits happen in the ANGLE domain, not the rate domain: each model's rate curve is numerically
integrated (cumulative trapezoid) and compared against the tracked angle(t) curve directly, rather
than differencing the model against `angle_convert.py`'s already-differentiated (and therefore
noise-amplified) rate curve. Both fits also run a small multi-start grid over initial (rate_ss, wn,
zeta) guesses, since a single seed can still land in a local minimum on a partial window.

**RESOLVED (2026-07-26) -- the earlier instability was a WINDOW-LENGTH problem, not a domain
problem.** A short (~0.55-0.6s) dwell only shows the initial rise and overshoot, never the
return/undershoot swing -- with no full oscillation to anchor it, angle-domain fitting degenerates to
a flat near-critically-damped curve that quietly satisfies low RMS (the overshoot's extra area nearly
cancels the missing undershoot's area deficit) while completely missing the real transient shape. A
longer dwell (~1.1s) that captures a full overshoot-THEN-undershoot cycle fixes this cleanly: fit
against pitch-UP-boosted converged to rate_ss=76.69 deg/s, wn=8.14 rad/s, zeta=0.71, RMS 0.14 deg (2nd
order) vs 0.51 deg (1st order) -- both wn and the 2nd-order/1st-order RMS ratio (~3.7x) land right in
line with the original four-condition table's ~8.0-8.6 rad/s / 2-4x claim, suggesting that original
result was likely sound and this tool's earlier short-window failures were the anomaly, not the
original ad hoc fits. Practical implication: **always capture enough dwell to see the rate visibly
turn back down (or up) after its first overshoot** before trusting an output's wn/zeta -- a fit that
only sees a single rise-and-peak is not reliable, no matter how low its reported RMS looks. A longer
dwell risks the landmark exiting frame or the tracker drifting onto a different bright object once
the true target nears the edge (watch `peak_brightness` for an abrupt, erratic swing away from its
otherwise-steady baseline -- that's the tell, not a hard position/frame-edge threshold) -- use
`--trim-end` to cut the analysis window before that contamination starts.

Tracks the landmark itself (reuses track_landmark.track + angle_convert.py's pinhole projection),
then isolates the rise window: from when the ramp begins (the mouse_hold_capture.py convention is
that a hold's `t_start` marks when its ramp COMPLETES, so the true step onset is `t_start - ramp`)
through that hold's `t_end`. The commanded-offset timeline and the video's own timeline are aligned
first via the same cross-correlation method hold_rate.py uses (there's an unknown, OBS-settle-plus-
focus-click offset between them).

Usage:
    python fit_spool_response.py data/indicator/pitch-spoolup-boost-up-<ts> --axis y \\
        --seed-x 1920 --seed-y 200 --window 40 --fov 116 --resolution 3840x2160
    (axis x = yaw/horizontal, axis y = pitch/vertical -- must match mouse_hold_capture.py --axis)
"""

import argparse
import csv
import json
import sys
from itertools import product
from pathlib import Path

import numpy as np
from scipy.integrate import cumulative_trapezoid
from scipy.optimize import least_squares

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analysis.track_landmark import track  # noqa: E402
from analysis.angle_convert import (  # noqa: E402
    focal_length_px, pixel_to_angle_deg, smooth_and_differentiate, drop_non_advancing_timestamps,
)


def find_alignment(t: np.ndarray, speed: np.ndarray, offsets_csv: Path, segs: list[dict]) -> tuple[float, float]:
    """Same method as hold_rate.py: the commanded-offset timeline (segments.json / offsets.csv,
    relative to when the script's staircase itself started) and the video's own timeline are offset
    by an unknown T0 -- OBS settle + focus/click overhead before the script starts injecting. Scan T0
    and keep whichever maximizes corr(|tracked rate|(t), |commanded offset|(t - T0)); the offset
    magnitude envelope survives regardless of sign convention, unlike a signed correlation."""
    oc = list(csv.DictReader(offsets_csv.open()))
    ot = np.array([float(r["t"]) for r in oc])
    oinj = np.abs(np.array([float(r["injected"]) for r in oc]))
    last_end = max(s["t_end"] for s in segs)
    best = (0.0, -1.0)
    for T0 in np.arange(0.0, 8.0, 0.02):
        c = np.interp(t - T0, ot, oinj, left=0, right=0)
        if c.max() <= 0:
            continue
        cc = np.corrcoef(speed, c)[0, 1]
        if cc > best[1]:
            best = (T0, cc)
    return best


def first_order_rate(t: np.ndarray, rate_ss: float, tau: float) -> np.ndarray:
    return rate_ss * (1.0 - np.exp(-t / tau))


def first_order_angle(t: np.ndarray, rate_ss: float, tau: float) -> np.ndarray:
    return rate_ss * (t - tau * (1.0 - np.exp(-t / tau)))


def second_order_rate(t: np.ndarray, rate_ss: float, wn: float, zeta: float) -> np.ndarray:
    wd = wn * np.sqrt(1.0 - zeta ** 2)
    return rate_ss * (1.0 - np.exp(-zeta * wn * t) * (np.cos(wd * t) + (zeta * wn / wd) * np.sin(wd * t)))


def second_order_angle(t: np.ndarray, rate_ss: float, wn: float, zeta: float) -> np.ndarray:
    r = second_order_rate(t, rate_ss, wn, zeta)
    return np.concatenate([[0.0], cumulative_trapezoid(r, t)])


# Multi-start grid: a single initial guess can land in a local minimum (a spuriously
# near-critically-damped fit) on a partial window that only shows one overshoot, not a full
# oscillation -- see module docstring. Cheap enough (a few dozen least_squares calls) to just
# grid-search the initial guess and keep the best RMS.
_WN0_GRID = (3.0, 5.0, 8.0, 12.0, 20.0)
_ZETA0_GRID = (0.3, 0.5, 0.7, 0.85, 0.95)
_TAU0_GRID = (0.05, 0.1, 0.2, 0.4)
_RSS0_GRID = (50.0, 65.0, 75.0, 85.0)


def fit_first_order(t: np.ndarray, angle: np.ndarray, rate_ss_guess: float) -> dict:
    def residuals(p):
        return first_order_angle(t, *p) - angle

    best = None
    for tau0, rss0 in product(_TAU0_GRID, (rate_ss_guess, *_RSS0_GRID)):
        result = least_squares(residuals, [rss0, tau0], bounds=([0.0, 1e-3], [np.inf, 5.0]))
        rms = float(np.sqrt(np.mean(result.fun ** 2)))
        if best is None or rms < best[0]:
            best = (rms, result.x)
    rms, (rate_ss, tau) = best
    return {"rate_ss": float(rate_ss), "tau": float(tau), "rms_deg": rms}


def fit_second_order(t: np.ndarray, angle: np.ndarray, rate_ss_guess: float) -> dict:
    def residuals(p):
        return second_order_angle(t, *p) - angle

    best = None
    for wn0, zeta0, rss0 in product(_WN0_GRID, _ZETA0_GRID, (rate_ss_guess, *_RSS0_GRID)):
        result = least_squares(residuals, [rss0, wn0, zeta0],
                                bounds=([0.0, 1e-3, 1e-3], [np.inf, 100.0, 0.999]))
        rms = float(np.sqrt(np.mean(result.fun ** 2)))
        if best is None or rms < best[0]:
            best = (rms, result.x)
    rms, (rate_ss, wn, zeta) = best
    return {
        "rate_ss": float(rate_ss), "wn": float(wn), "zeta": float(zeta),
        "envelope_tau": float(1.0 / (zeta * wn)), "rms_deg": rms,
        "near_critical_damping": bool(zeta > 0.99),
    }


def analyze(trial: Path, axis: str, seed_x: float, seed_y: float, window: int, fov: float,
            resolution: tuple[int, int], smooth_window: int = 11, smooth_poly: int = 3,
            trim_end: float | None = None, t0_override: float | None = None) -> dict:
    width, height = resolution
    rows = track(trial / "raw.mp4", seed_x, seed_y, half_window=window)
    rows = drop_non_advancing_timestamps(rows)
    t_full = np.array([r["t"] for r in rows])

    focal_px = focal_length_px(width, fov)
    if axis == "x":
        pixel = np.array([r["pixel_x"] for r in rows])
        center_px = width / 2
    else:
        pixel = np.array([r["pixel_y"] for r in rows])
        center_px = height / 2
    angle_deg = pixel_to_angle_deg(pixel, center_px, focal_px)
    rate_full = smooth_and_differentiate(t_full, angle_deg, smooth_window, smooth_poly)

    meta = json.loads((trial / "meta.json").read_text())
    segs = json.loads((trial / "segments.json").read_text())
    ramp = meta["ramp"]
    # the rise segment is the first hold with a nonzero commanded offset
    rise_seg = next(s for s in segs if s["offset"] != 0)

    T0, corr = find_alignment(t_full, np.abs(rate_full), trial / "offsets.csv", segs)
    if t0_override is not None:
        # find_alignment's correlation search gets unreliable on a long dwell whose tail runs into
        # frame-edge/lost-lock contamination (corr visibly drops well below the ~0.95+ seen on short,
        # clean captures) -- in that case, read the true step onset by eye off the printed rate trace
        # (where it visibly departs from ~0) and pass it here directly instead of trusting the search.
        t0 = t0_override
        t1 = rise_seg["t_end"] - rise_seg["t_start"] + ramp + t0
    else:
        t0 = rise_seg["t_start"] - ramp + T0
        t1 = rise_seg["t_end"] + T0
    if trim_end is not None:
        t1 = min(t1, t0 + trim_end)

    win = (t_full >= t0) & (t_full <= t1)
    if win.sum() < 6:
        raise ValueError(f"only {win.sum()} samples in rise window [{t0:.3f}, {t1:.3f}]s -- "
                          "check seed/window or that the capture actually held long enough")

    t = t_full[win] - t0
    rate = rate_full[win]
    angle = angle_deg[win]

    # normalize sign so rate_ss fits positive regardless of which way the landmark swept on screen,
    # then rebase angle to 0 at the window start (models are all defined relative to a step at t=0)
    sign = np.sign(np.median(rate[-max(3, len(rate) // 10):])) or 1.0
    rate = rate * sign
    angle = (angle - angle[0]) * sign
    rate_ss_guess = float(np.median(rate[-max(3, len(rate) // 10):]))

    first = fit_first_order(t, angle, rate_ss_guess)
    second = fit_second_order(t, angle, rate_ss_guess)

    peak_i = int(np.argmax(rate))

    return {
        "trial": str(trial), "axis": axis, "offset": rise_seg["offset"], "sign_applied": float(sign),
        "n_samples": int(win.sum()), "window": [float(t0), float(t1)], "align_T0": float(T0),
        "align_corr": float(corr), "peak_rate": float(rate[peak_i]), "peak_t": float(t[peak_i]),
        "first_order": first, "second_order": second,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("trial", type=Path)
    p.add_argument("--axis", choices=["x", "y"], required=True, help="x=yaw (horizontal), y=pitch (vertical)")
    p.add_argument("--seed-x", type=float, required=True)
    p.add_argument("--seed-y", type=float, required=True)
    p.add_argument("--window", type=int, default=40)
    p.add_argument("--fov", type=float, default=116.0)
    p.add_argument("--resolution", default="3840x2160", help="WIDTHxHEIGHT")
    p.add_argument("--smooth-window", type=int, default=11)
    p.add_argument("--smooth-poly", type=int, default=3)
    p.add_argument("--trim-end", type=float, default=None,
                    help="seconds after step onset to stop analyzing (cuts off the analysis window "
                         "before it reaches the hold's nominal end) -- use when the landmark starts "
                         "approaching the frame edge or another object confuses the tracker before "
                         "the hold is actually over; watch peak_brightness for an abrupt, erratic "
                         "swing away from its otherwise-steady baseline as the tell")
    p.add_argument("--t0", type=float, default=None,
                    help="override the auto-detected step-onset video timestamp (bypasses "
                         "find_alignment's correlation search entirely). Use when align_corr comes "
                         "back low (well under ~0.9) -- a long dwell whose tail runs into frame-edge "
                         "contamination can pull the correlation search to the wrong T0. Read the true "
                         "onset by eye off a printed rate trace (analysis/track_landmark.py + "
                         "angle_convert.py, or a throwaway script) where it visibly departs from ~0.")
    args = p.parse_args()

    width, height = (int(v) for v in args.resolution.lower().split("x"))
    result = analyze(args.trial, args.axis, args.seed_x, args.seed_y, args.window, args.fov,
                      (width, height), args.smooth_window, args.smooth_poly, args.trim_end, args.t0)

    f, s = result["first_order"], result["second_order"]
    print(f"trial={result['trial']}  axis={result['axis']}  offset={result['offset']}  "
          f"n={result['n_samples']}  window={result['window'][0]:.3f}-{result['window'][1]:.3f}s  "
          f"align_T0={result['align_T0']:.3f}s align_corr={result['align_corr']:.3f}  "
          f"sign_applied={result['sign_applied']:+.0f}")
    print(f"  peak observed rate (model-free): {result['peak_rate']:.2f} deg/s at t={result['peak_t']:.3f}s")
    print(f"  (fit against the integrated ANGLE curve; RMS is in degrees of angle, not deg/s -- "
          f"see module docstring for when to trust wn/zeta -- needs a full overshoot+undershoot "
          f"cycle in the window, not just the initial rise)")
    print(f"  1st-order lag : rate_ss={f['rate_ss']:7.2f} deg/s  tau={f['tau']:.4f}s"
          f"                      RMS={f['rms_deg']:.3f} deg")
    print(f"  2nd-order     : rate_ss={s['rate_ss']:7.2f} deg/s  wn={s['wn']:.3f} rad/s  "
          f"zeta={s['zeta']:.3f}  envelope_tau={s['envelope_tau']:.4f}s  RMS={s['rms_deg']:.3f} deg"
          + ("  [WARNING: zeta pinned near the 0.999 bound -- likely a degenerate/near-critically-"
             "damped fit, not a genuine underdamped result; treat with suspicion]"
             if s["near_critical_damping"] else ""))
    winner = "2nd-order" if s["rms_deg"] < f["rms_deg"] else "1st-order"
    print(f"  winner: {winner} ({min(s['rms_deg'], f['rms_deg']):.3f} vs "
          f"{max(s['rms_deg'], f['rms_deg']):.3f} deg)")


if __name__ == "__main__":
    sys.exit(main())
