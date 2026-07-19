"""Records an OBS clip while driving a STAIRCASE of held mouse offsets -- the capture for measuring
what SC's vjoy settings do to FLIGHT: at each held offset the ship reaches a steady yaw rate that the
proven star-tracking pipeline (analysis/track_landmark -> angle_convert -> omega) reads off, giving a
yaw-rate-vs-offset curve. Repeat across VJoyAnglePilots values to see the setting's effect.

Drives the MOUSE virtual joystick (not the vJoy device -- see BLUEPRINT.md). Each step ramps to the
target net offset over `ramp` seconds (small per-tick deltas, accel pinned 1:1) then HOLDS it (injects
nothing -- SC's virtual joystick accumulates, so the deflection persists) for `dwell` seconds while
the ship yaws at a steady rate. Logs commanded offset every tick + a segment table (offset, t_start,
t_end) so analysis can slice each hold's steady-state window.

SETUP before running: aim so a BRIGHT star sits near screen center (the star-tracking landmark), in a
private AC/free-flight Taurus, Coupled. Pin pointer accel first (pointer_accel.py pin).

Usage:
    python mouse_hold_capture.py --offsets 0,300,600,900,1200,900,600,300,0,-300,-600,-900,-1200 --dwell 2.5
"""

import argparse
import csv
import io
import json
import math
import shutil
import sys
import time
from pathlib import Path

import ctypes  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from feeder.mouse_feeder import move_rel  # noqa: E402
from feeder.win_focus import focus_and_click  # noqa: E402
from recorder.obs_capture import connect, start as obs_start, stop as obs_stop  # noqa: E402


def _rmb(down: bool) -> None:  # right mouse button = SC boost/afterburner bind here
    ctypes.windll.user32.mouse_event(0x0008 if down else 0x0010, 0, 0, 0, 0)


def run_staircase(offsets: list[int], dwell: float, ramp: float, poll_hz: float, axis: str = "yaw"):
    """Drive the staircase; return (tick_log, segments). t is seconds from staircase start.
    axis='yaw' injects horizontal mouse deltas (X), 'pitch' vertical (Y) -- the SC virtual joystick
    maps mouse X->yaw, Y->pitch, so this measures either angular axis with the same offsets."""
    interval = 1.0 / poll_hz
    injected = 0
    ticks, segments = [], []
    t0 = time.perf_counter()

    def now():
        return time.perf_counter() - t0

    def mv(d):
        move_rel(d, 0) if axis == "yaw" else move_rel(0, d)

    for target in offsets:
        # ramp from current injected -> target over `ramp` seconds
        start_inj = injected
        r0 = now()
        while True:
            t = now()
            frac = min(1.0, (t - r0) / ramp) if ramp > 0 else 1.0
            want = int(round(start_inj + (target - start_inj) * frac))
            delta = want - injected
            if delta != 0:
                mv(delta)
                injected += delta
                ticks.append({"t": round(t, 5), "target": target, "injected": injected, "phase": "ramp"})
            if frac >= 1.0:
                break
            time.sleep(interval)
        # hold (inject nothing; SC accumulates so the offset persists)
        seg_start = now()
        while now() - seg_start < dwell:
            ticks.append({"t": round(now(), 5), "target": target, "injected": injected, "phase": "hold"})
            time.sleep(interval)
        segments.append({"offset": target, "t_start": round(seg_start, 4), "t_end": round(now(), 4)})

    # return to center
    if injected != 0:
        mv(-injected)
    return ticks, segments


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--offsets", default="0,300,600,900,1200,900,600,300,0,-300,-600,-900,-1200",
                   help="comma-separated held offsets in mouse counts")
    p.add_argument("--dwell", type=float, default=2.5, help="seconds to hold each offset")
    p.add_argument("--ramp", type=float, default=0.25, help="seconds to ramp between offsets")
    p.add_argument("--poll-hz", type=float, default=500.0)
    p.add_argument("--settle", type=float, default=1.0)
    p.add_argument("--tag", default="hold")
    p.add_argument("--axis", choices=["yaw", "pitch"], default="yaw",
                   help="yaw = horizontal mouse (X), pitch = vertical (Y)")
    p.add_argument("--boost", action="store_true", help="hold right-mouse (boost/afterburner) for the whole run")
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "indicator")
    p.add_argument("--obs-password", default="")
    args = p.parse_args()

    offsets = [int(x) for x in args.offsets.split(",")]
    out_dir = args.out / f"{args.tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    client = connect(password=args.obs_password)
    obs_start(client)
    focus_and_click()
    print(f"OBS recording; settling {args.settle}s...")
    time.sleep(args.settle)

    print(f"Staircase ({args.axis}): {offsets} ({args.dwell}s hold each)"
          + ("  [BOOST held]" if args.boost else "") + "...")
    if args.boost:
        _rmb(True)
        time.sleep(0.2)
    try:
        ticks, segments = run_staircase(offsets, args.dwell, args.ramp, args.poll_hz, args.axis)
    finally:
        if args.boost:
            _rmb(False)

    time.sleep(0.3)
    src = Path(obs_stop(client))
    video = out_dir / "raw.mp4"
    shutil.copy(src, video)

    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=["t", "target", "injected", "phase"]); w.writeheader(); w.writerows(ticks)
    (out_dir / "offsets.csv").write_text(buf.getvalue())
    (out_dir / "segments.json").write_text(json.dumps(segments, indent=2))
    (out_dir / "meta.json").write_text(json.dumps({
        "offsets": offsets, "dwell": args.dwell, "ramp": args.ramp, "settle": args.settle,
        "axis": args.axis, "boost": args.boost,
        "obs_source": str(src), "note": "mouse held-offset staircase for ship-rate measurement",
    }, indent=2))
    print(f"Done -> {out_dir}  ({len(ticks)} ticks, {len(segments)} holds, video {video.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
