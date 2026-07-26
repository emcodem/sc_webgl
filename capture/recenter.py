"""Closed-loop visual servo that re-centers a bright landmark (normally the sun) on screen by
injecting small corrective mouse-vjoy PULSES and re-screenshotting between them -- replaces the
open-loop "calculate one pulse from a rate/tau model" repositioning method
(feedback_calculate_dont_iterate_repositioning) that overshot badly for pitch (the sun left the
frame entirely -- see MEASUREMENTS.md). Because this loop corrects off LIVE pixel feedback, an
imprecise rate/tau model only costs an extra iteration or two, never a blind miss.

Physical model this assumes (important, and different from FPS mouselook): SC's mouse virtual
joystick ACCUMULATES injected deltas into a HELD STICK DEFLECTION, and a held deflection commands a
ROTATION RATE, not an angle -- see feeder/mouse_feeder.py. So every corrective nudge here is a
self-contained pulse: ramp the stick up to an offset over `--ramp` seconds, hold it for `--hold`
seconds (the ship visibly rotates), then ramp back down to zero over `--ramp` seconds. Net injected
ends at (0, 0) every pulse, so the ship holds its new attitude steady instead of continuing to spin.

Two-tier detection:
  - FINE: full-res brightness-weighted centroid in a small window around the last known position
    (analysis/track_landmark.centroid_in_window, reused as-is) -- sub-pixel precision once located.
  - COARSE: only used when FINE's peak brightness drops below the lock floor (landmark left the
    tracking window, or the frame entirely). Downsamples the whole frame and looks for ANY blob
    that stands out from the background, with a known false-positive region masked out (see
    MEASUREMENTS.md's "fixed, non-moving bright object" note -- re-tune/disable via
    --exclude for a map where that HUD element isn't present, e.g. a different UI layout).

Recovery when COARSE also finds nothing (landmark fully undetectable): repeats a pulse in the
signed direction of whatever we were already correcting toward (we know the sign of our last
command even when we don't trust its magnitude), re-screenshotting between attempts; if that still
finds nothing after a few tries, falls back to a slow methodical one-direction yaw sweep (with an
occasional pitch nudge to change band), since a bounded real search beats a blind full-360 spin.

SAFETY (same as feeder/mouse_feeder.py, which this calls): only run this while actually in-cockpit,
pointer-locked, in a private AC/free-flight instance -- injected motion moves the real desktop
cursor outside of that. Per this project's established rule (capture/README.md "Known hazard: vJoy
device interaction bluescreens this machine"), do not invoke this script unattended/autonomously --
run it yourself, or explicitly confirm each real (non---dry-run) invocation in the moment.

Usage:
    python recenter.py --seed-x 1920 --seed-y 1080 --resolution 3840x2160 [--dry-run]
    python recenter.py --seed-x 1920 --seed-y 1080 --target-x 1920 --target-y 1080 \\
        --resolution 3840x2160 --exclude 0.5,0.90,0.03
"""

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from analysis.track_landmark import centroid_in_window  # noqa: E402
from feeder.mouse_feeder import move_rel  # noqa: E402
from feeder.win_focus import focus_no_click  # noqa: E402

# Known static bright HUD element seen at 3840x2160 in prior captures, NOT the sun -- see
# MEASUREMENTS.md. Fractional (cx, cy, radius) of frame dimensions so it scales with --resolution.
# Override with --exclude, or --exclude "" to disable if this map/HUD doesn't have it.
DEFAULT_EXCLUDE_FRACS = [(0.5, 0.90, 0.03)]


def grab_gray(sct, monitor) -> np.ndarray:
    frame = np.array(sct.grab(monitor))  # BGRA
    return cv2.cvtColor(frame, cv2.COLOR_BGRA2GRAY)


def coarse_find(gray: np.ndarray, exclude_fracs: list[tuple[float, float, float]],
                 downsample: int) -> tuple[float, float, float] | None:
    """Downsampled whole-frame brightest-spot search -- only used to relocate a fully-lost
    landmark. Returns (x, y, peak) in FULL-RES pixel coords, or None if nothing stands out from the
    background anywhere on screen (a hard floor, not "dimmer than the previous lock" -- this IS the
    lost-vs-found decision for the recovery path)."""
    h, w = gray.shape
    small = cv2.resize(gray, (max(1, w // downsample), max(1, h // downsample)),
                        interpolation=cv2.INTER_AREA).astype(np.float64)

    min_dim = min(w, h)
    for cxf, cyf, rf in exclude_fracs:
        cx, cy, r = cxf * small.shape[1], cyf * small.shape[0], rf * min_dim / downsample
        ys, xs = np.mgrid[0:small.shape[0], 0:small.shape[1]]
        small[(xs - cx) ** 2 + (ys - cy) ** 2 <= r ** 2] = -1

    peak = float(small.max())
    floor = float(np.percentile(small, 50))
    if peak < floor + 20:  # deliberately loose -- centroid_in_window does the real localization
        return None

    y_s, x_s = np.unravel_index(np.argmax(small), small.shape)
    return float(x_s * downsample), float(y_s * downsample), peak


def pulse_xy(dx_target: int, dy_target: int, ramp: float, hold: float, poll_hz: float,
             dry_run: bool) -> None:
    """One self-contained corrective nudge: ramp to (dx_target, dy_target) counts, hold, ramp back
    to (0, 0) -- see module docstring for why this shape (not a raw one-shot delta) is required."""
    interval = 1.0 / poll_hz
    injected = [0, 0]

    def ramp_to(tx: int, ty: int, duration: float) -> None:
        start_x, start_y = injected
        steps = max(1, int(duration * poll_hz))
        for s in range(1, steps + 1):
            frac = s / steps
            want_x = int(round(start_x + (tx - start_x) * frac))
            want_y = int(round(start_y + (ty - start_y) * frac))
            ddx, ddy = want_x - injected[0], want_y - injected[1]
            if ddx or ddy:
                if not dry_run:
                    move_rel(ddx, ddy)
                injected[0], injected[1] = want_x, want_y
            time.sleep(interval)

    ramp_to(dx_target, dy_target, ramp)
    if hold > 0:
        time.sleep(hold)
    ramp_to(0, 0, ramp)


def recenter(seed_x: float, seed_y: float, target_x: float, target_y: float, *,
             resolution: tuple[int, int], monitor_index: int = 1, window: int = 40,
             downsample: int = 8, lock_floor_frac: float = 0.5, px_to_counts: float = 1.5,
             max_offset: int = 400, ramp: float = 0.08, hold: float = 0.12, poll_hz: float = 200.0,
             settle_sec: float = 0.35, tol_px: float = 3.0, max_iters: int = 40,
             search_offset: int = 300, search_hold: float = 0.5, search_pitch_every: int = 4,
             exclude_fracs: list[tuple[float, float, float]] = DEFAULT_EXCLUDE_FRACS,
             dry_run: bool = False) -> dict:
    """Drive the landmark from (seed_x, seed_y) to (target_x, target_y) via closed-loop pulses.
    Returns {"ok", "iterations", "final_x", "final_y", "history"} -- never raises on failure to
    converge, so a caller can decide what to do (retry, alert, fall back to manual) rather than the
    whole capture session dying on one bad recenter."""
    import mss  # local import: only needed by this live-screenshot path

    width, height = resolution
    history: list[dict] = []
    last_sign = [0, 0]  # sign of the last real correction we issued -- gives recovery a direction

    with mss.mss() as sct:
        monitor = sct.monitors[monitor_index]
        cx, cy = seed_x, seed_y
        peaks: list[float] = []
        locked = True
        search_step = 0

        for it in range(max_iters):
            gray = grab_gray(sct, monitor)

            if locked:
                cx, cy, peak = centroid_in_window(gray, cx, cy, window)
                peaks.append(peak)
                if peak < lock_floor_frac * max(peaks):
                    locked = False

            if not locked:
                found = coarse_find(gray, exclude_fracs, downsample)
                if found:
                    fx, fy, _ = found
                    cx, cy, peak = centroid_in_window(gray, fx, fy, window)
                    locked, peaks = True, [peak]
                    history.append({"iter": it, "state": "relocked", "x": cx, "y": cy})
                else:
                    if last_sign[0] or last_sign[1]:
                        dx, dy = last_sign[0] * search_offset, last_sign[1] * search_offset
                        h = search_hold
                    else:
                        # No direction history at all (cold start) -- methodical one-way yaw sweep,
                        # with an occasional pitch nudge to change band, rather than a blind spin.
                        pitch_tick = (search_step + 1) % search_pitch_every == 0
                        dx, dy = (0, search_offset) if pitch_tick else (search_offset, 0)
                        h = search_hold
                    search_step += 1
                    history.append({"iter": it, "state": "searching", "dx": dx, "dy": dy})
                    pulse_xy(dx, dy, ramp, h, poll_hz, dry_run)
                    time.sleep(settle_sec)
                    continue

            err_x, err_y = target_x - cx, target_y - cy
            history.append({"iter": it, "state": "tracking", "x": cx, "y": cy,
                             "err_x": err_x, "err_y": err_y})
            if abs(err_x) < tol_px and abs(err_y) < tol_px:
                return {"ok": True, "iterations": it + 1, "final_x": cx, "final_y": cy,
                        "history": history}

            dx = int(np.clip(round(px_to_counts * err_x), -max_offset, max_offset))
            dy = int(np.clip(round(px_to_counts * err_y), -max_offset, max_offset))
            last_sign[0] = (dx > 0) - (dx < 0) or last_sign[0]
            last_sign[1] = (dy > 0) - (dy < 0) or last_sign[1]
            pulse_xy(dx, dy, ramp, hold, poll_hz, dry_run)
            time.sleep(settle_sec)

    return {"ok": False, "iterations": max_iters, "final_x": cx, "final_y": cy, "history": history}


def _parse_exclude(spec: str) -> list[tuple[float, float, float]]:
    if not spec:
        return []
    out = []
    for part in spec.split(";"):
        cx, cy, r = (float(v) for v in part.split(","))
        out.append((cx, cy, r))
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--seed-x", type=float, required=True)
    p.add_argument("--seed-y", type=float, required=True)
    p.add_argument("--target-x", type=float, default=None, help="default: frame center")
    p.add_argument("--target-y", type=float, default=None, help="default: frame center")
    p.add_argument("--resolution", required=True, help="WIDTHxHEIGHT, e.g. 3840x2160")
    p.add_argument("--monitor", type=int, default=1, help="mss monitor index (1 = first physical monitor)")
    p.add_argument("--window", type=int, default=40, help="fine-tracking half-width, px")
    p.add_argument("--downsample", type=int, default=8, help="coarse-search downsample factor")
    p.add_argument("--px-to-counts", type=float, default=1.5, help="proportional gain: mouse counts per pixel of error")
    p.add_argument("--max-offset", type=int, default=400, help="clamp on any single pulse's stick offset")
    p.add_argument("--ramp", type=float, default=0.08, help="seconds to ramp a pulse up/down")
    p.add_argument("--hold", type=float, default=0.12, help="seconds to hold a corrective pulse")
    p.add_argument("--settle", type=float, default=0.35, help="seconds to wait after a pulse before re-screenshotting")
    p.add_argument("--tol-px", type=float, default=3.0, help="convergence tolerance, px")
    p.add_argument("--max-iters", type=int, default=40)
    p.add_argument("--search-offset", type=int, default=300, help="stick offset used while searching for a lost landmark")
    p.add_argument("--search-hold", type=float, default=0.5, help="hold duration used while searching")
    p.add_argument("--exclude", default="0.5,0.90,0.03",
                   help="';'-separated cx,cy,radius (fractions of frame) to mask from the coarse "
                        "search, e.g. a known static HUD element. Empty string to disable.")
    p.add_argument("--dry-run", action="store_true", help="print pulses instead of injecting them")
    p.add_argument("--out", type=Path, default=None, help="write the result JSON here")
    args = p.parse_args()

    width, height = (int(v) for v in args.resolution.lower().split("x"))
    target_x = args.target_x if args.target_x is not None else width / 2
    target_y = args.target_y if args.target_y is not None else height / 2

    print(f"Recentering ({args.seed_x:.0f}, {args.seed_y:.0f}) -> ({target_x:.0f}, {target_y:.0f})"
          + ("  [DRY RUN]" if args.dry_run else ""))
    if not args.dry_run:
        # no reticle click needed (pulses are pure mouse-vjoy motion), and a click here would fire
        # a shot if armed for no reason -- focus_no_click still shows the "ready?" popup and resets
        # any residual stick deflection via Esc x2.
        focus_no_click()
    result = recenter(
        args.seed_x, args.seed_y, target_x, target_y,
        resolution=(width, height), monitor_index=args.monitor, window=args.window,
        downsample=args.downsample, px_to_counts=args.px_to_counts, max_offset=args.max_offset,
        ramp=args.ramp, hold=args.hold, settle_sec=args.settle, tol_px=args.tol_px,
        max_iters=args.max_iters, search_offset=args.search_offset, search_hold=args.search_hold,
        exclude_fracs=_parse_exclude(args.exclude), dry_run=args.dry_run,
    )

    status = "OK" if result["ok"] else "FAILED TO CONVERGE"
    print(f"{status} after {result['iterations']} iteration(s) -> "
          f"({result['final_x']:.1f}, {result['final_y']:.1f})")
    if args.out:
        args.out.write_text(json.dumps(result, indent=2))
        print(f"Result -> {args.out}")


if __name__ == "__main__":
    sys.exit(main())
