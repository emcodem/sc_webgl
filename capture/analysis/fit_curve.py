"""Fits the mouse virtual-joystick's offset->rate curve from one or more hold-capture trials (see
curve_sweep_capture.py), and compares it against the CURRENT sc_webgl model (rescaled deadzone +
single power exponent, src/input/axisCurve.ts) to check whether that model can actually reproduce
real SC's behavior across the WHOLE range, not just the small-offset points it was eyeballed from.

WHY a second model: the existing 150-600-count yaw fit (MEASUREMENTS.md "Input-curve shape", exponent
~1.48) extrapolated to the measured full-deflection point (2500 counts -> 49.2 deg/s) predicts ~168
deg/s -- a 3.4x overshoot. A pure power law's slope only ever increases outward, so it cannot also
turn over and saturate near full stick. This script additionally fits a Kumaraswamy-CDF-shaped curve
(1 - (1-x^a)^b, x = deadzone-rescaled offset in [0,1]), which is monotonic and fixed at (0,0)/(1,1)
like the power law, but can turn over near x=1 -- a strict superset of the power law (b=1 reduces it
to x^a). Compares RMS fit error of both models side by side.

Usage:
    python fit_curve.py yaw --trials "data/curve/yaw_*" --seed-x 1920 --seed-y 1100 --fov 116 \
        --resolution 3840x2160 --anchor 2500:49.2 --out data/curve/yaw_fit.json

`--trials` is a glob (quote it so the shell doesn't expand it) matched against this file's own
directory-relative `data/`, or pass explicit trial-dir paths space-separated instead.
`--anchor OFFSET:RATE` adds a known point not covered by a fresh trial (e.g. an existing max-deflection
capture like data/angular/yaw-max-*) -- pass as many as you have; at least one near/at saturation is
important since the whole point is constraining the curve's turnover, which the mid-range sweep alone
under-constrains.
"""

import argparse
import glob
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analysis.hold_rate import analyze  # noqa: E402


def collect_points(trial_dirs: list[Path], seed_x: float, seed_y: float, window: int, fov: float,
                    resolution: tuple[int, int], axis: str, skip: float) -> dict[int, list[float]]:
    """offset(abs, counts) -> list of measured |rate| (deg/s), one per ok hold across all trials."""
    by_offset: dict[int, list[float]] = {}
    for trial in trial_dirs:
        try:
            res, T0, corr = analyze(trial, seed_x, seed_y, window, fov, resolution, axis, skip)
        except Exception as e:
            print(f"  SKIP {trial}: {e}")
            continue
        print(f"  {trial}  align T0={T0:.2f}s corr={corr:.3f}")
        for r in res:
            if r["offset"] == 0 or not r["ok"]:
                continue
            off = abs(r["offset"])
            by_offset.setdefault(off, []).append(abs(r["rate"]))
            if not r["ok"]:
                print(f"    offset {r['offset']}: LOST, excluded")
    return by_offset


def power_model(params, offset, dz_frac):
    full_range, exponent, max_rate = params
    dz = dz_frac * full_range
    x = np.clip((offset - dz) / max(full_range - dz, 1e-6), 0, 1)
    return max_rate * x ** exponent


def kumaraswamy_model(params, offset, dz_frac):
    full_range, a, b, max_rate = params
    dz = dz_frac * full_range
    x = np.clip((offset - dz) / max(full_range - dz, 1e-6), 0, 1)
    return max_rate * (1 - (1 - x ** a) ** b)


def fit(model_fn, params0, bounds_lo, bounds_hi, offsets, rates, dz_frac):
    def resid(p):
        return model_fn(p, offsets, dz_frac) - rates
    sol = least_squares(resid, params0, bounds=(bounds_lo, bounds_hi))
    rms = float(np.sqrt(np.mean(sol.fun ** 2)))
    return sol.x, rms


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("axis_name", choices=["yaw", "pitch"])
    p.add_argument("--trials", nargs="+", required=True,
                   help="glob pattern(s) (quoted) or explicit trial-dir paths")
    p.add_argument("--seed-x", type=float, required=True)
    p.add_argument("--seed-y", type=float, required=True)
    p.add_argument("--window", type=int, default=45)
    p.add_argument("--fov", type=float, default=116.0)
    p.add_argument("--resolution", default="3840x2160")
    p.add_argument("--skip", type=float, default=0.7)
    p.add_argument("--dz-frac", type=float, default=0.0445, help="mouse deadzone as a fraction (SC's VJoyCombinedDeadZone default)")
    p.add_argument("--anchor", action="append", default=[], help="OFFSET:RATE, e.g. an existing max-deflection capture; repeatable")
    p.add_argument("--out", type=Path, default=None, help="write fitted params + a sampled curve table here")
    args = p.parse_args()

    axis = "x" if args.axis_name == "yaw" else "y"
    width, height = (int(v) for v in args.resolution.split("x"))

    trial_dirs: list[Path] = []
    for pattern in args.trials:
        matches = glob.glob(pattern)
        if matches:
            trial_dirs.extend(Path(m) for m in matches)
        elif Path(pattern).is_dir():
            trial_dirs.append(Path(pattern))
        else:
            print(f"  no match for {pattern!r}")
    if not trial_dirs:
        sys.exit("no trial directories found")
    print(f"Analyzing {len(trial_dirs)} trial(s) for axis={args.axis_name}...")

    by_offset = collect_points(sorted(trial_dirs), args.seed_x, args.seed_y, args.window, args.fov,
                                (width, height), axis, args.skip)

    offsets = []
    rates = []
    for off, vals in sorted(by_offset.items()):
        med = float(np.median(vals))
        offsets.append(off); rates.append(med)
        print(f"  offset {off:6d}  n={len(vals):2d}  median rate {med:7.2f} deg/s  (reps: {['%.1f' % v for v in vals]})")

    for a in args.anchor:
        off_s, rate_s = a.split(":")
        offsets.append(float(off_s)); rates.append(float(rate_s))
        print(f"  anchor  {float(off_s):6.0f}  rate {float(rate_s):7.2f} deg/s")

    if len(offsets) < 4:
        sys.exit(f"only {len(offsets)} usable point(s) -- need at least 4 (incl. anchors) to fit 3-4 free params meaningfully")

    offsets_arr = np.array(offsets); rates_arr = np.array(rates)
    max_rate_guess = float(rates_arr.max()) * 1.05
    max_offset_guess = float(offsets_arr.max())

    pw_x0 = [max_offset_guess, 1.48, max_rate_guess]
    pw_params, pw_rms = fit(power_model, pw_x0, [500, 0.3, 1], [10000, 5, 1000],
                            offsets_arr, rates_arr, args.dz_frac)

    ks_x0 = [max_offset_guess, 1.5, 1.0, max_rate_guess]
    ks_params, ks_rms = fit(kumaraswamy_model, ks_x0, [500, 0.2, 0.2, 1], [10000, 6, 6, 1000],
                             offsets_arr, rates_arr, args.dz_frac)

    print(f"\ncurrent-model shape (rescaled deadzone + power exponent):")
    print(f"  full_range={pw_params[0]:.0f}  exponent={pw_params[1]:.3f}  max_rate={pw_params[2]:.2f}  RMS={pw_rms:.2f} deg/s")
    print(f"saturating-model shape (rescaled deadzone + Kumaraswamy a/b):")
    print(f"  full_range={ks_params[0]:.0f}  a={ks_params[1]:.3f}  b={ks_params[2]:.3f}  max_rate={ks_params[3]:.2f}  RMS={ks_rms:.2f} deg/s")

    print(f"\n{'offset':>8} {'measured':>10} {'power_pred':>11} {'ks_pred':>9}")
    for off, rate in sorted(zip(offsets, rates)):
        pw_pred = power_model(pw_params, np.array([off]), args.dz_frac)[0]
        ks_pred = kumaraswamy_model(ks_params, np.array([off]), args.dz_frac)[0]
        print(f"{off:8.0f} {rate:10.2f} {pw_pred:11.2f} {ks_pred:9.2f}")

    if args.out:
        xs = np.linspace(0, 1, 201)
        table = [{"x": float(x), "ks_ratio": float((1 - (1 - x ** ks_params[1]) ** ks_params[2]))} for x in xs]
        args.out.write_text(json.dumps({
            "axis": args.axis_name, "dz_frac": args.dz_frac,
            "power_model": {"full_range": pw_params[0], "exponent": pw_params[1], "max_rate": pw_params[2], "rms": pw_rms},
            "kumaraswamy_model": {"full_range": ks_params[0], "a": ks_params[1], "b": ks_params[2], "max_rate": ks_params[3], "rms": ks_rms},
            "points": [{"offset": o, "rate": r} for o, r in zip(offsets, rates)],
            "sampled_curve": table,
        }, indent=2))
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
