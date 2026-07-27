"""Records ONE continuous OBS clip spanning boost meter drain (hold boost) immediately followed by
recharge (release boost, keep recording) -- so there's no dead time between the two phases for the
meter to recharge unrecorded (a gap that voided an earlier two-script-invocation attempt entirely).
Companion to linear_hold_capture.py; same focus/OBS plumbing. Read the AB% readout after with
analysis/montage_speed.py --region <boost meter box> (see BOOST_FINDINGS.md item 1).

Usage:
    python boost_meter_capture.py --drain 22 --recharge-watch 100 --tag boost-meter-cycle --out data/Gladius/linear
"""

import argparse
import ctypes
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from feeder.win_focus import ready_and_reset, click_center  # noqa: E402
from recorder.obs_capture import connect, start as obs_start, stop as obs_stop  # noqa: E402

_MOUSE_BTN = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}


def _mouse_btn(button: str, down: bool) -> None:
    ctypes.windll.user32.mouse_event(_MOUSE_BTN[button][0 if down else 1], 0, 0, 0, 0)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--drain", type=float, required=True, help="seconds to hold boost (drain phase)")
    p.add_argument("--recharge-watch", type=float, required=True,
                   help="seconds to keep recording after releasing boost (recharge phase)")
    p.add_argument("--boost-mouse", choices=["left", "right", "middle"], default="right")
    p.add_argument("--settle", type=float, default=1.5)
    p.add_argument("--tag", default="boost-meter-cycle")
    p.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "linear")
    p.add_argument("--obs-password", default="")
    p.add_argument("--no-focus", action="store_true")
    p.add_argument("--click", action="store_true")
    args = p.parse_args()

    out_dir = args.out / f"{args.tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    client = connect(password=args.obs_password)
    hwnd = None
    if not args.no_focus:
        hwnd, _ = ready_and_reset()
    obs_start(client)
    if args.click and hwnd is not None:
        click_center(hwnd)
    print(f"OBS recording; settling {args.settle}s...")
    time.sleep(args.settle)

    t0 = time.perf_counter()
    print(f"Boost DOWN for {args.drain}s (drain phase)...")
    _mouse_btn(args.boost_mouse, True)
    time.sleep(args.drain)
    _mouse_btn(args.boost_mouse, False)
    print(f"Boost UP at t={time.perf_counter() - t0:.2f}s; watching recharge for {args.recharge_watch}s...")
    time.sleep(args.recharge_watch)

    src = Path(obs_stop(client))
    video = out_dir / "raw.mp4"
    shutil.copy(src, video)
    print(f"Done -> {out_dir}  (video {video.stat().st_size} bytes, "
          f"drain@[0,{args.drain}] recharge-watch@[{args.drain},{args.drain + args.recharge_watch}])")


if __name__ == "__main__":
    sys.exit(main())
