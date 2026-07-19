"""Fits candidate rotational-response models against captured omega(t) trace(s) (typically reps of
a reversal maneuver's omega.csv, from orchestrate.py), and reports which minimal change to the
existing single-pole model (see ../../src/physics/flightModel.ts) best reproduces them -- following
the same grid-search-then-residual-check philosophy the existing ship tuning was derived with (see
../../src/physics/shipTypes.ts's measurement notes).

Three candidate models are provided; add more to MODELS as real data suggests they're needed:

  symmetric   -- the CURRENT ported model: dw/dt = (u*thrust - w*drag)/mass, one drag per axis
                 regardless of whether input aids or opposes the current spin, mass fixed at
                 --mass. Included as the baseline to beat, not a serious candidate for the
                 reversal transient itself. thrust and drag both float.
  asymmetric  -- same equation, but drag takes a different value while input opposes the current
                 spin direction (an active reversal) vs. while it aids/coasts. The minimal change
                 that could produce a slower-than-symmetric-predicts reversal, if that's what the
                 data shows. thrust, drag_normal, drag_reversal all float; mass fixed at --mass.
  mass_only   -- tests the hypothesis that the CURRENT thrust/drag constants (--thrust0/--drag0)
                 are already right and it's the assumed mass that's off: thrust and drag are held
                 fixed at --thrust0/--drag0, only mass floats (initial guess --mass). Since mass
                 cancels out of the steady-state ratio thrust/drag, this model CANNOT fit a
                 steady-state peak rate different from thrust0/drag0's -- if the measured peak
                 rate differs from that, mass_only's RMS will be visibly worse than symmetric's/
                 asymmetric's regardless of how well it captures the transient's timing, and that
                 itself is a real result (mass alone doesn't explain the data).

If neither symmetric/asymmetric model's RMS error is much better than the other, or asymmetric's
drag_normal and drag_reversal fit to nearly the same value, that itself is a real result: it means
the existing symmetric model was already fine and the perceived reversal lag is a human-perception/
UX artifact (not a physics-model gap) -- don't force an asymmetry into the constants if the data
doesn't support one.

Fits jointly across multiple trial reps when given more than one -- residuals from every trial are
concatenated into one least_squares call, so the reported params are a single best fit across all
reps rather than one fit per trial (more reps -> tighter/more trustworthy fit, same as averaging
would, but properly weighted by each trial's own sample density).

Usage:
    python fit_model.py ../feeder/maneuvers/yaw_reversal.json \\
        data/Gladius/yaw_reversal/<timestamp1> data/Gladius/yaw_reversal/<timestamp2> ... \\
        --mass 1.5 --thrust0 14.0721 --drag0 15.4639

Each trial directory must contain omega.csv (from angle_convert.py) and meta.json (from
orchestrate.py); all trials passed in one invocation must share the same maneuver and axis.

Sign convention: a positive vJoy command doesn't necessarily produce a positive pixel-tracked
omega -- e.g. a "nose right" yaw command slides a background landmark LEFT across the screen, so
depending on which screen direction the pixel->angle conversion calls positive, the measured omega
can come out with the opposite sign from the command. symmetric/asymmetric can absorb this by
simply fitting a negative thrust (harmless -- it's just a sign flag, magnitudes still compare
directly to shipTypes.ts). mass_only CANNOT: its thrust/drag are fixed positive from --thrust0/
--drag0, so a sign-inverted trace makes the model fight the wrong direction entirely and the
optimizer degenerates to a huge, meaningless mass (driving the response toward ~0 as the
least-bad fit). Check a first symmetric-model run's fitted thrust sign; if negative, re-run
everything (including mass_only) with --sign -1 to flip the loaded omega before fitting.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

sys.path.insert(0, str(Path(__file__).parent.parent))
from feeder.vjoy_feeder import load_maneuver, active_axes  # noqa: E402

# Must match feeder/vjoy_feeder.py's AXIS_MAP direction (logical name -> vJoy axis letter).
LOGICAL_AXIS_OF = {"x": "yaw", "y": "pitch", "roll": "roll"}


def load_omega_trace(path: Path, sign: float = 1.0) -> tuple[np.ndarray, np.ndarray]:
    t, omega = [], []
    with path.open() as f:
        for row in csv.DictReader(f):
            t.append(float(row["t"]))
            omega.append(sign * np.radians(float(row["omega_deg_s"])))
    return np.array(t), np.array(omega)


def load_trial(trial_dir: Path, sign: float = 1.0) -> tuple[np.ndarray, np.ndarray, dict]:
    t, omega = load_omega_trace(trial_dir / "omega.csv", sign=sign)
    meta = json.loads((trial_dir / "meta.json").read_text())
    return t, omega, meta


def input_fn_from_maneuver(maneuver: dict, logical_axis: str):
    segments = maneuver["segments"]

    def u(t: float) -> float:
        return active_axes(segments, t).get(logical_axis, 0.0)

    return u


def simulate(model_dw_dt, params, t: np.ndarray, u_fn, extra) -> np.ndarray:
    """Forward-Euler at the trace's own (possibly irregular, real-video-derived) sample times --
    matches how flightModel.ts itself integrates frame-by-frame rather than with a continuous-time
    solver, so the fit is apples-to-apples with how this will actually run in the sim. `extra` is
    whatever fixed context the specific model needs (a plain mass float for symmetric/asymmetric,
    a (thrust, drag) tuple for mass_only) -- opaque to simulate(), interpreted by model_dw_dt."""
    w = np.zeros_like(t)
    for i in range(1, len(t)):
        dt = t[i] - t[i - 1]
        u = u_fn(t[i - 1])
        w[i] = w[i - 1] + model_dw_dt(w[i - 1], u, params, extra) * dt
    return w


def symmetric_model(w, u, params, extra):
    thrust, drag = params
    mass = extra
    return (u * thrust - w * drag) / mass


def asymmetric_model(w, u, params, extra):
    thrust, drag_normal, drag_reversal = params
    mass = extra
    opposing = u != 0 and w != 0 and np.sign(u) != np.sign(w)
    drag = drag_reversal if opposing else drag_normal
    return (u * thrust - w * drag) / mass


def mass_only_model(w, u, params, extra):
    (mass,) = params
    thrust, drag = extra
    return (u * thrust - w * drag) / mass


MODELS = {
    "symmetric": (symmetric_model, ["thrust", "drag"]),
    "asymmetric": (asymmetric_model, ["thrust", "drag_normal", "drag_reversal"]),
    "mass_only": (mass_only_model, ["mass"]),
}


def fit(model_name: str, trials: list[tuple[np.ndarray, np.ndarray]], u_fn, extra,
        initial_guess: list) -> dict:
    model_fn, param_names = MODELS[model_name]

    def residuals(params):
        return np.concatenate([
            simulate(model_fn, params, t, u_fn, extra) - omega_measured
            for t, omega_measured in trials
        ])

    # Every current parameter (thrust, drag*, mass) is physically non-negative -- thrust should
    # come out positive once omega's sign is corrected to match the command's (see --sign), and
    # drag can only ever oppose motion, never add energy to it. Without this bound, a short/noisy
    # transient (e.g. the few samples right after a reversal) can pull a drag term negative to
    # chase noise rather than reflecting anything physical -- seen in practice on a single-trial
    # asymmetric fit (drag_reversal fit to -5.2 before this bound was added).
    result = least_squares(residuals, initial_guess, bounds=(0, np.inf))
    rms = float(np.sqrt(np.mean(result.fun ** 2)))

    per_trial_rms = []
    offset = 0
    for t, omega_measured in trials:
        n = len(t)
        trial_res = result.fun[offset:offset + n]
        per_trial_rms.append(float(np.degrees(np.sqrt(np.mean(trial_res ** 2)))))
        offset += n

    return {
        "model": model_name,
        "params": dict(zip(param_names, result.x)),
        "rms_error_rad_s": rms,
        "rms_error_deg_s": np.degrees(rms),
        "per_trial_rms_deg_s": per_trial_rms,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("maneuver_json", type=Path)
    parser.add_argument("trial_dirs", type=Path, nargs="+",
                         help="one or more trial directories, each containing omega.csv + meta.json")
    parser.add_argument("--mass", type=float, required=True,
                         help="ship mass -- fixed constant for symmetric/asymmetric, initial guess for mass_only")
    parser.add_argument("--thrust0", type=float, required=True,
                         help="existing angularThrust for this axis -- initial guess for symmetric/asymmetric, fixed constant for mass_only")
    parser.add_argument("--drag0", type=float, required=True,
                         help="existing angularDrag for this axis -- initial guess for symmetric/asymmetric, fixed constant for mass_only")
    parser.add_argument("--sign", type=float, default=1.0, choices=[1.0, -1.0],
                         help="multiply loaded omega by this before fitting -- set -1 if a prior "
                              "symmetric-model run fit a negative thrust (see module docstring's "
                              "'Sign convention' note); required for mass_only to mean anything")
    args = parser.parse_args()

    loaded = [load_trial(d, sign=args.sign) for d in args.trial_dirs]
    metas = [meta for _, _, meta in loaded]
    axes = {meta["axis"] for meta in metas}
    if len(axes) > 1:
        raise ValueError(f"trials span more than one axis: {axes}")
    logical_axis = LOGICAL_AXIS_OF[metas[0]["axis"]]
    maneuver = load_maneuver(args.maneuver_json)
    u_fn = input_fn_from_maneuver(maneuver, logical_axis)
    trials = [(t, omega) for t, omega, _ in loaded]

    ships = {meta.get("ship", "?") for meta in metas}
    print(f"Fitting {len(trials)} trial(s) ({', '.join(str(d) for d in args.trial_dirs)})")
    print(f"ship(s)={ships}  axis={logical_axis}  total samples={sum(len(t) for t, _ in trials)}\n")

    for model_name in MODELS:
        n_params = len(MODELS[model_name][1])
        if model_name == "mass_only":
            extra = (args.thrust0, args.drag0)
            initial_guess = [args.mass]
        else:
            extra = args.mass
            initial_guess = [args.thrust0, args.drag0, args.drag0][:n_params]
        result = fit(model_name, trials, u_fn, extra, initial_guess)
        params_str = ", ".join(f"{k}={v:.4f}" for k, v in result["params"].items())
        per_trial = ", ".join(f"{v:.2f}" for v in result["per_trial_rms_deg_s"])
        print(f"{result['model']:>12s}: RMS error = {result['rms_error_deg_s']:.3f} deg/s   "
              f"params = {params_str}")
        if len(trials) > 1:
            print(f"{'':>12s}  per-trial RMS (deg/s) = [{per_trial}]")


if __name__ == "__main__":
    sys.exit(main())
