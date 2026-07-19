"""Records an OBS clip while driving a SCRIPTED Q/E roll sequence -- the capture for measuring
Gladius ROLL behaviour: max roll rate + spool-up, the roll END (deceleration to zero when the key
is released), and DIRECTION REVERSAL (full-left -> full-right). Roll is keyboard-only in SC (Q =
roll left, E = roll right); this holds/releases those keys by SCAN CODE via SendInput -- the same
path win_focus uses, because SC ignores VK (keybd_event) injection (see BLUEPRINT.md).

Unlike the mouse (an accumulating analog stick, mouse_hold_capture.py), a held roll key is a DIGITAL
input: press -> constant roll input while held (ship spools to a steady roll rate) -> release ->
input goes to zero (ship spools down / coasts to a stop). So the "capture" is just a timed schedule
of key-down / key-up events; we log each event's wall time (perf_counter from sequence start) so
analysis can map the omega(t) curve's motion-onset anchor onto the whole schedule.

ANALYSIS is the proven single-point roll pipeline, unchanged:
    track_landmark.py --seed-x <off-center feature> --seed-y ...   (a star / structure corner)
    angle_convert.py --axis roll --resolution 3840x2160           (polar angle about frame center)
The tracked feature MUST be seeded OFF-CENTER -- a point on the roll axis (screen center) barely
moves under roll however fast the ship spins (pixel speed scales with radius from center).

SETUP before running: Gladius, private AC/free-flight (or a stable 0 m/s hover), Coupled, a crisp
OFF-CENTER feature ~300-500 px from screen center. Pin pointer accel is NOT needed for roll (keys,
not mouse) but doesn't hurt. OBS running with obs-websocket enabled.

Sequence syntax: comma-separated `token:seconds`, token = Q (roll left) | E (roll right) | _ (coast,
no key held). Default exercises all three behaviours in one clip:
    Q:1.0  spool up + steady roll left
    _:1.5  RELEASE -> roll END (decel to zero)
    E:1.0  spool up + steady roll right
    _:1.5  RELEASE -> roll END
    Q:1.0,E:1.0  back-to-back = DIRECTION REVERSAL (full-left -> full-right, no coast between)
    _:1.5  final settle

Usage:
    python roll_hold_capture.py                         # default sequence above
    python roll_hold_capture.py --sequence "Q:1.5,_:2.0"    # one hold + one release, for a clean test
    python roll_hold_capture.py --sequence "Q:0.8,E:0.8,Q:0.8,E:0.8"  # rapid reversals only
"""

import argparse
import ctypes
import io
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from feeder.win_focus import _send_scan, focus_and_click, focus_no_click  # noqa: E402
from recorder.obs_capture import connect, start as obs_start, stop as obs_stop  # noqa: E402

# SC roll keybinds (hardware scan codes -- see MEASUREMENTS.md "IMMEDIATE NEXT TASK").
SCAN = {"Q": 0x10, "E": 0x12}
BOOST_SCAN = 0x2A  # Left Shift = SC afterburner default bind; used only if boost is on a KEY

# Mouse-button (down, up) event flags -- SC's boost is often bound to a mouse button (e.g. right-click),
# which is a global button state (position-independent), so holding it anywhere = boost held.
_MOUSE_BTN = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}


def _mouse_btn(button: str, down: bool) -> None:
    ctypes.windll.user32.mouse_event(_MOUSE_BTN[button][0 if down else 1], 0, 0, 0, 0)


def parse_sequence(spec: str) -> list[tuple[str | None, float]]:
    """"Q:1.0,_:1.5,E:1.0" -> [("Q",1.0),(None,1.5),("E",1.0)]. token "_" = coast (no key)."""
    segs: list[tuple[str | None, float]] = []
    for part in spec.split(","):
        tok, _, secs = part.strip().partition(":")
        tok = tok.strip().upper()
        key = None if tok == "_" else tok
        if key is not None and key not in SCAN:
            raise ValueError(f"unknown roll token {tok!r} (use Q, E, or _)")
        segs.append((key, float(secs)))
    return segs


def run_sequence(segs: list[tuple[str | None, float]], poll_hz: float):
    """Run the schedule; return an events log. Only ONE roll key is ever held at once -- switching
    Q<->E releases the current key before pressing the next, so a reversal is release-then-press with
    no double-hold (matching how a human rolls). t is seconds from sequence start."""
    interval = 1.0 / poll_hz
    events = []
    held: str | None = None
    t0 = time.perf_counter()

    def now():
        return time.perf_counter() - t0

    def release():
        nonlocal held
        if held is not None:
            _send_scan(SCAN[held], key_up=True)
            events.append({"t": round(now(), 5), "event": "up", "key": held})
            held = None

    def press(key: str):
        nonlocal held
        if held == key:
            return
        release()
        _send_scan(SCAN[key], key_up=False)
        held = key
        events.append({"t": round(now(), 5), "event": "down", "key": key})

    for key, dur in segs:
        if key is None:
            release()
        else:
            press(key)
        seg_start = now()
        while now() - seg_start < dur:
            time.sleep(interval)

    release()  # never leave a key stuck down
    return events


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sequence", default="Q:1.0,_:1.5,E:1.0,_:1.5,Q:1.0,E:1.0,_:1.5",
                   help="comma-separated token:seconds; token = Q | E | _ (coast)")
    p.add_argument("--poll-hz", type=float, default=200.0)
    p.add_argument("--settle", type=float, default=1.5, help="seconds of stillness after focus before rolling")
    p.add_argument("--esc-reset", action="store_true",
                   help="Esc x2 before rolling to clear residual mouse-stick deflection -- OFF by default "
                        "for roll (opens the pause menu into the clip, and keyboard roll needs no reset)")
    p.add_argument("--tag", default="roll")
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "roll")
    p.add_argument("--obs-password", default="")
    p.add_argument("--boost", action="store_true",
                   help="hold the boost/afterburner input DOWN for the whole sequence -> measures "
                        "BOOSTED roll rate (coded boostMaxAngVel.roll = 240 deg/s). Default input is "
                        "the right mouse button (--boost-mouse right); use --boost-scan for a key bind.")
    p.add_argument("--boost-mouse", choices=["left", "right", "middle"], default="right",
                   help="mouse button bound to boost (default right); set --boost-scan to use a key instead")
    p.add_argument("--boost-scan", type=lambda v: int(v, 0), default=None,
                   help="scan code of the boost KEY (e.g. 0x2A for Left Shift); overrides --boost-mouse")
    p.add_argument("--no-focus", action="store_true", help="skip focusing entirely (assume SC already foreground)")
    p.add_argument("--click", action="store_true",
                   help="use the full focus+center-click (WILL FIRE if weapons armed) instead of the "
                        "default click-free foregrounding -- avoid near a station")
    args = p.parse_args()

    segs = parse_sequence(args.sequence)
    out_dir = args.out / f"{args.tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    client = connect(password=args.obs_password)
    # Focus BEFORE recording so any focus-time flicker (and the Esc menu, if --esc-reset) never lands
    # in the clip -- the tracker needs a clean, stable pre-roll baseline.
    if not args.no_focus:
        if args.click:
            focus_and_click()
        else:
            focus_no_click(esc_reset=args.esc_reset)
    obs_start(client)
    print(f"OBS recording; settling {args.settle}s (ship must be still before first roll)...")
    time.sleep(args.settle)

    boost_desc = (f"key 0x{args.boost_scan:02X}" if args.boost_scan is not None
                  else f"{args.boost_mouse}-mouse") if args.boost else None

    def boost(down: bool) -> None:
        if args.boost_scan is not None:
            _send_scan(args.boost_scan, key_up=not down)
        else:
            _mouse_btn(args.boost_mouse, down)

    pretty = " ".join(f"{k or '_'}:{d}" for k, d in segs)
    print(f"Roll sequence: {pretty}" + (f"  [BOOST held: {boost_desc}]" if args.boost else ""))
    # Hold boost DOWN across the whole sequence (try/finally so it's always released, never stuck on).
    if args.boost:
        boost(True)
        time.sleep(0.2)
    try:
        events = run_sequence(segs, args.poll_hz)
    finally:
        if args.boost:
            boost(False)

    time.sleep(0.3)
    src = Path(obs_stop(client))
    video = out_dir / "raw.mp4"
    shutil.copy(src, video)

    # segments.json: derive held-window per segment from the schedule, so analysis can slice each
    # steady-roll plateau and each coast without re-parsing the event stream.
    segments, t = [], 0.0
    for key, dur in segs:
        segments.append({"key": key or "_", "t_start": round(t, 4), "t_end": round(t + dur, 4)})
        t += dur

    (out_dir / "events.json").write_text(json.dumps(events, indent=2))
    (out_dir / "segments.json").write_text(json.dumps(segments, indent=2))
    (out_dir / "meta.json").write_text(json.dumps({
        "sequence": args.sequence, "settle": args.settle, "boost": args.boost, "obs_source": str(src),
        "note": "keyboard Q/E roll schedule for Gladius roll rate / end / reversal measurement"
                + (" (BOOST held)" if args.boost else ""),
        "analysis": "analysis/track_orientation.py (elongated landmark long-axis angle)",
    }, indent=2))
    print(f"Done -> {out_dir}  ({len(events)} key events, {len(segments)} segments, "
          f"video {video.stat().st_size} bytes)")


if __name__ == "__main__":
    sys.exit(main())
