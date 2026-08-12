"""Records an OBS clip while driving roll through the vJoy virtual joystick (device 1, axis Z --
see feeder/vjoy_feeder.py's AXIS_MAP) at arbitrary PARTIAL deflections, not just full Q/E on/off.

Unlike roll_hold_capture.py (keyboard Q/E -- digital, always 100% or 0%), this drives an ANALOG
axis, so it can hold any percentage (3%, 5%, 25%, 50%, ...) to answer: does roll rate scale
linearly with stick deflection, does releasing a small input still leave residual drift, and what
does a direction reversal look like at partial (not just full) deflection.

Reuses feeder.vjoy_feeder.run() (the same tested device-driving loop orchestrate.py uses, including
its continuous-refresh-per-poll-cycle fix) instead of reimplementing axis driving -- this script
only adds the OBS-record wrapper and a compact sequence syntax for building the maneuver's segment
list. Analysis is the same track_orientation.py pipeline as roll_hold_capture.py clips.

SETUP: Star Citizen's roll control bound to vJoy device 1 / axis Z (confirmed by the operator, not
auto-detected). Private AC/free-flight or a stable 0 m/s hover, Coupled, off-center landmark ~300+
px from frame center. OBS running with obs-websocket enabled.

** KNOWN HAZARD: actually driving/acquiring the vJoy device has caused a full machine bluescreen on
this project's dev machine before (see capture/README.md's "Known hazard" section). Never run this
without --dry-run except with the operator's explicit go-ahead in the moment. **

Sequence syntax: comma-separated `token:seconds`, token = a signed percentage (-100..100) or `_`
(neutral/0%). Percentages map directly to vJoy axis value (pct/100, clamped -1..1); sign convention
(which of + / - is visually left/right) is unconfirmed and must be read off the footage itself.

Usage:
    python roll_vjoy_capture.py --sequence "3:2,_:2,5:2,_:2,10:2,_:2,20:2,_:2,25:2,_:2,50:2,_:2,100:2,_:2" --tag magnitude-sweep
    python roll_vjoy_capture.py --sequence "50:2,-50:2,_:2,100:2,-50:2,_:2,50:2,-100:2,_:2" --tag direction-change
    python roll_vjoy_capture.py --sequence "10:2,_:2" --dry-run   # print the schedule, no vJoy/OBS touched
"""

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from feeder.win_focus import ready_and_reset  # noqa: E402
from feeder.vjoy_feeder import run as run_feeder  # noqa: E402
from recorder.obs_capture import connect, start as obs_start, stop as obs_stop  # noqa: E402


def _force_center_roll(dry_run: bool) -> None:
    """Re-acquires the device fresh and centers axis Z directly -- run_feeder() only resets to
    neutral when its own loop exits normally, so any interrupt/exception mid-run leaves the last
    commanded deflection stuck on the device forever (confirmed the hard way: killing a run mid-hold
    left the ship rolling with no python process left running at all). Called from a finally block
    so it still runs on Ctrl+C/exception -- a hard kill (SIGKILL/taskkill -F) bypasses this entirely,
    same limitation vjoy_feeder.py's own cleanup has."""
    if dry_run:
        return
    import pyvjoy
    device = pyvjoy.VJoyDevice(1)
    device.set_axis(pyvjoy.HID_USAGE_Z, 16384)


def parse_sequence(spec: str) -> list[dict]:
    """"3:2,_:2,-50:1.5" -> contiguous {"start","end","axes":{"roll":value}} segments, value in -1..1."""
    segments = []
    t = 0.0
    for part in spec.split(","):
        tok, _, secs = part.strip().partition(":")
        tok = tok.strip()
        dur = float(secs)
        value = 0.0 if tok == "_" else max(-1.0, min(1.0, float(tok) / 100.0))
        segments.append({"start": round(t, 4), "end": round(t + dur, 4), "axes": {"roll": value}})
        t += dur
    return segments


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sequence", required=True,
                   help="comma-separated token:seconds; token = signed percent (-100..100) or _ (neutral)")
    p.add_argument("--poll-hz", type=float, default=500.0)
    p.add_argument("--settle", type=float, default=1.5, help="seconds of stillness after focus before driving roll")
    p.add_argument("--tag", default="roll-vjoy")
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "roll")
    p.add_argument("--obs-password", default="")
    p.add_argument("--no-focus", action="store_true", help="skip focusing entirely (assume SC already foreground)")
    p.add_argument("--dry-run", action="store_true", help="print the schedule; never opens the vJoy device")
    args = p.parse_args()

    segments = parse_sequence(args.sequence)
    out_dir = args.out / f"{args.tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    client = connect(password=args.obs_password)
    hwnd = None
    if not args.no_focus:
        hwnd, _ = ready_and_reset(esc_reset=False)
    obs_start(client)
    print(f"OBS recording; settling {args.settle}s (ship must be still before driving roll)...")
    time.sleep(args.settle)

    pretty = " ".join(f"{seg['axes']['roll']*100:+.0f}%:{seg['end']-seg['start']:.2f}s" for seg in segments)
    print(f"Roll vjoy sequence: {pretty}" + ("  [DRY RUN]" if args.dry_run else ""))
    maneuver = {"name": args.tag, "segments": segments}
    try:
        run_feeder(maneuver, dry_run=args.dry_run, log_path=out_dir / "input_log.csv", poll_hz=args.poll_hz)
    finally:
        _force_center_roll(args.dry_run)

    time.sleep(0.3)
    src = Path(obs_stop(client))
    video = out_dir / "raw.mp4"
    shutil.copy(src, video)

    (out_dir / "segments.json").write_text(json.dumps([
        {"key": f"{seg['axes']['roll']*100:+.0f}%", "t_start": seg["start"], "t_end": seg["end"]}
        for seg in segments
    ], indent=2))
    (out_dir / "meta.json").write_text(json.dumps({
        "sequence": args.sequence, "settle": args.settle, "obs_source": str(src),
        "note": "vJoy device 1 / axis Z roll schedule for partial-deflection rate/release/reversal measurement",
        "analysis": "analysis/track_orientation.py (elongated landmark long-axis angle)",
    }, indent=2))
    print(f"Done -> {out_dir}  ({len(segments)} segments, video {video.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
