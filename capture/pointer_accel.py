"""Pin / restore Windows mouse pointer acceleration + speed, so injected mouse counts (mouse_feeder)
map 1:1 to what Star Citizen receives -- otherwise the OS pointer-speed slider and "Enhance pointer
precision" (acceleration) sit between our command and the game and pollute the measured input curve
(a ~0.8x, nonlinear scaling was observed on this machine).

`pin`  -> back up current settings to data/pointer_settings_backup.json (only if no backup exists
          yet, so the FIRST-seen originals are never lost), then set speed=10 (the 6/11 middle notch
          = 1:1) and acceleration OFF, applied live via SystemParametersInfo.
`restore` -> re-apply whatever's in the backup file.
`status`  -> print the current live settings.

Applied with SPIF_SENDCHANGE only (not UPDATEINIFILE) so nothing is persisted to the registry --
the change is live for the session and `restore` puts back the exact originals.
"""

import argparse
import ctypes
import json
import sys
from pathlib import Path

_u = ctypes.windll.user32
SPI_GETMOUSE, SPI_SETMOUSE = 0x0003, 0x0004
SPI_GETMOUSESPEED, SPI_SETMOUSESPEED = 0x0070, 0x0071
SPIF_SENDCHANGE = 0x02

BACKUP = Path(__file__).parent / "data" / "pointer_settings_backup.json"


def get() -> dict:
    arr = (ctypes.c_int * 3)()
    _u.SystemParametersInfoW(SPI_GETMOUSE, 0, arr, 0)
    speed = ctypes.c_int()
    _u.SystemParametersInfoW(SPI_GETMOUSESPEED, 0, ctypes.byref(speed), 0)
    return {"threshold1": arr[0], "threshold2": arr[1], "accel": arr[2], "speed": speed.value}


def apply(s: dict) -> None:
    arr = (ctypes.c_int * 3)(s["threshold1"], s["threshold2"], s["accel"])
    _u.SystemParametersInfoW(SPI_SETMOUSE, 0, arr, SPIF_SENDCHANGE)
    _u.SystemParametersInfoW(SPI_SETMOUSESPEED, 0, ctypes.c_void_p(s["speed"]), SPIF_SENDCHANGE)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["pin", "restore", "status"])
    args = p.parse_args()

    if args.command == "status":
        print("current:", get()); return

    if args.command == "restore":
        if not BACKUP.exists():
            print(f"no backup at {BACKUP} -- nothing to restore"); sys.exit(1)
        s = json.loads(BACKUP.read_text()); apply(s)
        print(f"restored {s}; now: {get()}"); return

    # pin
    cur = get()
    BACKUP.parent.mkdir(parents=True, exist_ok=True)
    if not BACKUP.exists():
        BACKUP.write_text(json.dumps(cur, indent=2))
        print(f"backed up originals -> {BACKUP}: {cur}")
    else:
        print(f"backup already exists ({BACKUP}), keeping it; live was {cur}")
    apply({"threshold1": 0, "threshold2": 0, "accel": 0, "speed": 10})
    print(f"pinned (accel off, speed 10 = 1:1); now: {get()}")


if __name__ == "__main__":
    sys.exit(main())
