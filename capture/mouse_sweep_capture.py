"""Records an OBS clip while driving a KNOWN, bounded mouse sweep -- the capture half of measuring
what SC's mouse-virtual-joystick settings (VJoyAnglePilots, VJoyCombinedDeadZone, ...) actually do.

Drives SC's mouse virtual joystick (which the on-screen vjoy indicator responds to -- unlike the
bound vJoy device, see BLUEPRINT.md) through a position sweep = amplitude*sin(2*pi*t/period) for a
whole number of cycles, logging the commanded stick offset every tick. The resulting clip + offsets
log let analysis/find_indicator.py (a) LOCATE the indicator (the on-screen thing whose motion
correlates with the sweep) and (b) later map commanded-offset -> indicator-deflection per setting.

Single process on purpose: OBS start -> settle -> sweep (t=0 at sweep start) -> OBS stop, so the
sweep's timing relative to the recording is known without a separate sync flash. Motion onset also
still works as a cross-check (the indicator is dead still until the sweep starts).

Usage:
    python mouse_sweep_capture.py --amplitude 2200 --period 6 --cycles 2 --tag locate_default
"""

import argparse
import csv
import io
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from feeder.mouse_feeder import move_rel, AXES  # noqa: E402
from feeder.win_focus import focus_and_click  # noqa: E402
from recorder.obs_capture import connect, start as obs_start, stop as obs_stop  # noqa: E402

import math


def sweep(axis: str, amplitude: float, period: float, cycles: float, poll_hz: float) -> list[dict]:
    """Position-sine sweep; injects per-tick deltas (see mouse_feeder.oscillate for the why). Returns
    the commanded log [{t, target, injected}]. Best-effort re-centers at the end."""
    component = AXES[axis]
    interval = 1.0 / poll_hz
    duration = cycles * period
    rows = []
    injected = 0
    t0 = time.perf_counter()
    while True:
        t = time.perf_counter() - t0
        if t >= duration:
            break
        target = amplitude * math.sin(2 * math.pi * t / period)
        delta = int(round(target)) - injected
        if delta != 0:
            dx, dy = (delta, 0) if component == "x" else (0, delta)
            move_rel(dx, dy)
            injected += delta
            rows.append({"t": round(t, 5), "target": round(target, 2), "injected": injected})
        time.sleep(interval)
    if injected != 0:
        dx, dy = (-injected, 0) if component == "x" else (0, -injected)
        move_rel(dx, dy)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--axis", choices=list(AXES.keys()), default="yaw")
    parser.add_argument("--amplitude", type=float, default=2200.0, help="peak stick-offset in mouse counts")
    parser.add_argument("--period", type=float, default=6.0, help="seconds per full sweep cycle")
    parser.add_argument("--cycles", type=float, default=2.0)
    parser.add_argument("--poll-hz", type=float, default=120.0)
    parser.add_argument("--settle", type=float, default=1.0, help="seconds of still recording before the sweep")
    parser.add_argument("--tag", default="sweep", help="label for the output dir")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "indicator")
    parser.add_argument("--obs-password", default="")
    args = parser.parse_args()

    out_dir = args.out / f"{args.tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    client = connect(password=args.obs_password)
    obs_start(client)
    focus_and_click()  # REQUIRED: injected motion only reaches flight if SC is the focused window
    print(f"OBS recording; settling {args.settle}s (indicator held still)...")
    time.sleep(args.settle)

    print(f"Sweeping {args.axis}: +-{args.amplitude} counts, period {args.period}s x{args.cycles}...")
    rows = sweep(args.axis, args.amplitude, args.period, args.cycles, args.poll_hz)

    time.sleep(0.3)
    src = Path(obs_stop(client))
    video = out_dir / "raw.mp4"
    shutil.copy(src, video)

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["t", "target", "injected"])
    w.writeheader(); w.writerows(rows)
    (out_dir / "offsets.csv").write_text(buf.getvalue())
    (out_dir / "meta.json").write_text(json.dumps({
        "axis": args.axis, "amplitude": args.amplitude, "period": args.period,
        "cycles": args.cycles, "poll_hz": args.poll_hz, "settle": args.settle,
        "obs_source": str(src), "note": "mouse virtual joystick sweep for indicator measurement",
    }, indent=2))

    print(f"Done -> {out_dir}  ({len(rows)} logged ticks, video {video.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
