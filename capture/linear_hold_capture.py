"""Records an OBS clip while driving a SCRIPTED sequence of LINEAR-thrust inputs -- the capture for
Gladius linear thrust: max speed + acceleration (held ramp), coast deceleration (release), and the
**COUNTER movement** (command the opposite direction while moving = active braking / reversal).
Companion to `roll_hold_capture.py` (rotational); same focus/OBS/scan-code plumbing.

Strafe is pure translation -- no landmark bearing to track -- so speed is read off the HUD `m/s`
number via `analysis/montage_speed.py` (tiles it per frame; no OCR). Point anywhere.

Why the counter matters, esp. DECOUPLED: in coupled mode a release auto-brakes to 0, so you can't
tell whether that decel is a separate governor or just the opposing thruster firing. In DECOUPLED a
release just keeps drifting (Newtonian) -- so to stop you must COUNTER-thrust, and that decel is the
**pure thruster authority** (no flight-computer governor), which nails down per-axis/per-direction
coast decel (see MEASUREMENTS.md "Gladius LINEAR").

Sequence tokens (comma-separated `TOKEN:seconds`): a direction key, or `_` = release (coast/drift).
  W=fwd  S=back  A=left  D=right  UP=vertical-up(Space)  DN=vertical-down(LCtrl)
Only one direction key is held at a time; switching releases the old key first (a real counter).
`--boost` holds the boost input (right mouse by default) DOWN for the whole sequence.

SETUP: private AC free-flight (stable), 0 m/s start. Coupled OR Decoupled (mode is a game state, not
a flag -- verify from the HUD CPLD checkbox). Motion blur can't be disabled here; the compact cockpit
`NNN m/s` number stays legible through it. OBS 50 Mbps.

Usage:
    # lateral accel + coast (coupled):           --sequence "D:5,_:8"
    # lateral counter/reversal:                  --sequence "D:4,A:5,_:4"
    # decoupled: accel, drift, then counter-stop: --sequence "D:3,_:3,A:4,_:4"   (run in Decoupled)
    # boosted lateral:                            --sequence "D:5,_:8" --boost
    # vertical up accel + coast:                  --sequence "UP:4,_:8"
"""

import argparse
import ctypes
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from feeder.win_focus import _send_scan, focus_and_click, focus_no_click  # noqa: E402
from recorder.obs_capture import connect, start as obs_start, stop as obs_stop  # noqa: E402

# Named linear-thrust binds (standard here): W/S fwd/back, A/D left/right, Space up, L-Ctrl down.
LINEAR = {"W": 0x11, "S": 0x1F, "A": 0x1E, "D": 0x20, "UP": 0x39, "DN": 0x1D}
_MOUSE_BTN = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}
C_SCAN = 0x2E  # coupled/decoupled toggle (SC 'C' bind). --decoupled toggles it on, then back off.


def _tap(scan: int) -> None:
    _send_scan(scan, key_up=False)
    time.sleep(0.05)
    _send_scan(scan, key_up=True)


def _mouse_btn(button: str, down: bool) -> None:
    ctypes.windll.user32.mouse_event(_MOUSE_BTN[button][0 if down else 1], 0, 0, 0, 0)


def parse_sequence(spec: str) -> list[tuple[str | None, float]]:
    segs = []
    for part in spec.split(","):
        tok, _, secs = part.strip().partition(":")
        tok = tok.strip().upper()
        key = None if tok == "_" else tok
        if key is not None and key not in LINEAR:
            raise ValueError(f"unknown linear token {tok!r} (use {'/'.join(LINEAR)} or _)")
        segs.append((key, float(secs)))
    return segs


def run_sequence(segs, poll_hz):
    """One direction key held at a time; switching releases the old key first (a real counter)."""
    interval = 1.0 / poll_hz
    events, held, t0 = [], None, time.perf_counter()

    def now():
        return time.perf_counter() - t0

    def release():
        nonlocal held
        if held is not None:
            _send_scan(LINEAR[held], key_up=True)
            events.append({"t": round(now(), 5), "event": "up", "key": held})
            held = None

    def press(key):
        nonlocal held
        if held == key:
            return
        release()
        _send_scan(LINEAR[key], key_up=False)
        held = key
        events.append({"t": round(now(), 5), "event": "down", "key": key})

    for key, dur in segs:
        press(key) if key else release()
        seg_start = now()
        while now() - seg_start < dur:
            time.sleep(interval)
    release()
    return events


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sequence", required=True, help="comma-separated TOKEN:seconds; TOKEN in W/S/A/D/UP/DN or _")
    p.add_argument("--decoupled", action="store_true",
                   help="tap C to enter DECOUPLED before the run, then tap C again after to restore "
                        "COUPLED (assumes you START coupled -- the session default). Verify via the HUD "
                        "CPLD checkbox on the clip.")
    p.add_argument("--boost", action="store_true", help="hold boost (right mouse by default) for the whole sequence")
    p.add_argument("--boost-mouse", choices=["left", "right", "middle"], default="right")
    p.add_argument("--boost-scan", type=lambda v: int(v, 0), default=None, help="scan code if boost is a KEY")
    p.add_argument("--poll-hz", type=float, default=200.0)
    p.add_argument("--settle", type=float, default=1.5)
    p.add_argument("--tag", default="linear")
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "linear")
    p.add_argument("--obs-password", default="")
    p.add_argument("--no-focus", action="store_true")
    p.add_argument("--click", action="store_true", help="full focus+center-click (fires if armed)")
    args = p.parse_args()

    segs = parse_sequence(args.sequence)
    out_dir = args.out / f"{args.tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    def boost(down):
        if args.boost_scan is not None:
            _send_scan(args.boost_scan, key_up=not down)
        else:
            _mouse_btn(args.boost_mouse, down)

    client = connect(password=args.obs_password)
    if not args.no_focus:
        (focus_and_click if args.click else focus_no_click)()
    if args.decoupled:
        _tap(C_SCAN)  # coupled -> decoupled (before recording, so the whole clip is decoupled)
        time.sleep(0.5)
    obs_start(client)
    print(f"OBS recording; settling {args.settle}s (0 m/s)"
          + (" [DECOUPLED]" if args.decoupled else "") + "...")
    time.sleep(args.settle)

    pretty = " ".join(f"{k or '_'}:{d}" for k, d in segs)
    print(f"Linear sequence: {pretty}" + ("  [BOOST held]" if args.boost else ""))
    if args.boost:
        boost(True)
        time.sleep(0.2)
    try:
        events = run_sequence(segs, args.poll_hz)
    finally:
        if args.boost:
            boost(False)
        if args.decoupled:
            _tap(C_SCAN)  # restore COUPLED (session default), even on error

    time.sleep(0.3)
    src = Path(obs_stop(client))
    video = out_dir / "raw.mp4"
    shutil.copy(src, video)

    segments, t = [], 0.0
    for key, dur in segs:
        segments.append({"key": key or "_", "t_start": round(t, 4), "t_end": round(t + dur, 4)})
        t += dur
    (out_dir / "events.json").write_text(json.dumps(events, indent=2))
    (out_dir / "segments.json").write_text(json.dumps(segments, indent=2))
    (out_dir / "meta.json").write_text(json.dumps({
        "sequence": args.sequence, "settle": args.settle, "boost": args.boost,
        "obs_source": str(src), "note": "linear-thrust schedule; read speed via analysis/montage_speed.py",
    }, indent=2))
    print(f"Done -> {out_dir}  ({len(events)} key events, video {video.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
