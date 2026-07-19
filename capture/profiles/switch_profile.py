"""Switch control profiles -- swaps Star Citizen's live actionmaps.xml between your normal control
setup and the vJoy-bound one this toolchain drives for capture sessions.

Star Citizen has no separate "select profile" mechanism we can drive from outside the game -- it
always loads whatever's physically sitting at LIVE_ACTIONMAPS_PATH below, in the "default" profile
slot. So "switching profiles" here means: overwrite that file with a saved copy, having first
archived whatever was there.

Every `activate` call archives the CURRENT live file to a fresh timestamped copy before overwriting
it, regardless of which profile is currently live -- so calling this repeatedly, in any order, never
loses a state; it just piles up timestamped history in ../data/actionmaps_backups/.

Usage:
    python switch_profile.py activate vjoy       # switch to the vJoy-bound profile
    python switch_profile.py activate original   # switch back to your normal profile
    python switch_profile.py status              # show which one is currently live (by content hash)

Restart Star Citizen (or use its in-game control-reload, if any) after switching -- it reads
actionmaps.xml at launch/profile-load time, not continuously.
"""

import argparse
import hashlib
import shutil
import sys
import time
from pathlib import Path

# The one file Star Citizen actually reads. Noted here explicitly per the "note the original
# filepath" requirement -- if this ever changes (a patch, a different install location, a
# different profile slot), this is the one line to update.
LIVE_ACTIONMAPS_PATH = Path(
    r"C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\USER\Client\0\Profiles\default\actionmaps.xml"
)

PROFILES_DIR = Path(__file__).parent
BACKUPS_DIR = PROFILES_DIR.parent / "data" / "actionmaps_backups"

KNOWN_PROFILES = {
    "vjoy": PROFILES_DIR / "vjoy_actionmaps.xml",
    "original": PROFILES_DIR / "original_actionmaps.xml",
}


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def archive_live() -> Path:
    BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    archive_path = BACKUPS_DIR / f"actionmaps_{ts}.xml"
    shutil.copy(LIVE_ACTIONMAPS_PATH, archive_path)
    return archive_path


def activate(name: str) -> None:
    profile_path = KNOWN_PROFILES[name]
    if not profile_path.exists():
        print(f"FAIL: {profile_path} doesn't exist -- nothing saved under the name '{name}' yet.")
        sys.exit(1)

    archive_path = archive_live()
    print(f"Archived current live profile -> {archive_path}")

    shutil.copy(profile_path, LIVE_ACTIONMAPS_PATH)
    print(f"Activated '{name}' -> {LIVE_ACTIONMAPS_PATH}")
    print("Restart Star Citizen (or reload controls in-game) for this to take effect.")


def status() -> None:
    print(f"Live file: {LIVE_ACTIONMAPS_PATH}")
    if not LIVE_ACTIONMAPS_PATH.exists():
        print("  MISSING")
        return

    live_hash = file_hash(LIVE_ACTIONMAPS_PATH)
    matched = None
    for name, path in KNOWN_PROFILES.items():
        if path.exists() and file_hash(path) == live_hash:
            matched = name
            break

    if matched:
        print(f"  currently active: '{matched}'")
    else:
        print("  currently active: unknown/custom (doesn't match any saved profile -- "
              "you may have made in-game changes since the last switch)")

    for name, path in KNOWN_PROFILES.items():
        print(f"  known profile '{name}': {path} ({'exists' if path.exists() else 'MISSING'})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    activate_parser = sub.add_parser("activate")
    activate_parser.add_argument("name", choices=list(KNOWN_PROFILES.keys()))

    sub.add_parser("status")

    args = parser.parse_args()
    if args.command == "activate":
        activate(args.name)
    else:
        status()


if __name__ == "__main__":
    sys.exit(main())
