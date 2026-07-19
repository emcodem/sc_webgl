"""Runs one full capture trial end-to-end: arms capture, fires a sync flash, drives the vJoy
feeder through a maneuver, stops capture, and hands the resulting clip straight through the
analysis pipeline (landmark tracking -> angle conversion -> omega(t)).

This is the normal entry point for a single trial -- the individual scripts under feeder/,
recorder/, and analysis/ stay independently runnable for debugging one stage on its own (e.g.
re-analyzing an existing clip without re-flying it).

Usage:
    python orchestrate.py feeder/maneuvers/yaw_reversal.json --ship Gladius --axis x --fov 90 --resolution 1920x1080 --backend ffmpeg
    python orchestrate.py feeder/maneuvers/pitch_reversal.json --ship Taurus --axis y --fov 90 --resolution 1920x1080 --backend obs --obs-password ...

Before running: aim so the tracked landmark (a star, or a HUD tick) sits at screen CENTER -- the
default tracking seed is the frame center (override with --seed-x/--seed-y), matching
settings_checklist.md's recommended setup.
"""

import argparse
import csv
import io
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from feeder.vjoy_feeder import load_maneuver, run as run_feeder  # noqa: E402
from analysis.track_landmark import track  # noqa: E402
from analysis.angle_convert import convert  # noqa: E402
from analysis.sync_detect import region_brightness_trace, detect_flash, detect_motion_onset  # noqa: E402

# Top-left corner flash used as a sync marker -- must match sync_detect's expectations.
FLASH_REGION = (0, 0, 80, 80)


def flash_and_hold():
    """Shows a full-white window in the flash corner and returns it, still shown -- the caller
    destroys it once the maneuver's done. The event loop is deliberately not pumped after this:
    the FIRST frame recorded with the window up is what sync_detect anchors t=0 to, and a
    static already-drawn window stays visible without a running mainloop for the few seconds a
    maneuver takes."""
    import tkinter as tk

    root = tk.Tk()
    root.overrideredirect(True)
    root.attributes("-topmost", True)
    w, h = FLASH_REGION[2], FLASH_REGION[3]
    root.geometry(f"{w}x{h}+{FLASH_REGION[0]}+{FLASH_REGION[1]}")
    root.configure(bg="white")
    root.update()
    return root


def rows_to_csv(rows: list[dict], fieldnames: list[str]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def check_flight_mode(client, obs_source_name: str, expected_flight_mode: str) -> None:
    """Grabs a live screenshot through the OBS source and checks the HUD's CPLD indicator (template-
    matched, see analysis/hud_checks.py) against what the operator asserted via --flight-mode --
    catches exactly the failure mode that silently invalidated an entire early yaw dataset this
    project hit (Decoupled active throughout, only discovered after the fact by asking). Also
    catches not being in the cockpit at all (crash/menu/loading screen). Raises rather than warns:
    a mismatched trial isn't worth capturing at all, and this check is cheap compared to a wasted
    maneuver + analysis pass."""
    import base64
    import cv2
    import numpy as np
    from analysis.hud_checks import detect_flight_state

    resp = client.get_source_screenshot(obs_source_name, "png", 3840, 2160, -1)
    data = base64.b64decode(resp.image_data.split(",", 1)[1])
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    state = detect_flight_state(img)
    if state == "not_in_cockpit":
        raise RuntimeError(
            "HUD check found no recognizable in-flight cockpit view (crash/menu/loading screen?) "
            "-- aborting before recording."
        )
    if state != expected_flight_mode:
        raise RuntimeError(
            f"--flight-mode {expected_flight_mode} was asserted, but the HUD's CPLD indicator "
            f"shows {state} -- aborting before recording (see analysis/hud_checks.py; this is "
            f"exactly the mismatch that silently invalidated an earlier dataset)."
        )
    print(f"Flight mode confirmed via HUD: {state}.")


def run_trial(maneuver_path: Path, backend: str, axis: str, fov: float, resolution: tuple[int, int],
              seed: tuple[float, float] | None, obs_kwargs: dict, ffmpeg_kwargs: dict,
              capture_settle_sec: float, out_root: Path, ship: str, flight_mode: str,
              dry_run: bool = False, track_window: int = 40, obs_source_name: str = "Desktop Capture"
              ) -> Path:
    maneuver = load_maneuver(maneuver_path)
    trial_dir = out_root / ship / maneuver["name"] / time.strftime("%Y%m%d-%H%M%S")
    trial_dir.mkdir(parents=True, exist_ok=True)
    video_path = trial_dir / "raw.mp4"

    if backend == "obs":
        from recorder.obs_capture import connect, start as obs_start
        client = connect(**obs_kwargs)
        check_flight_mode(client, obs_source_name, flight_mode)
        obs_start(client)
    else:
        from recorder.ffmpeg_capture import start as ffmpeg_start
        proc = ffmpeg_start(video_path, resolution=f"{resolution[0]}x{resolution[1]}", **ffmpeg_kwargs)

    print(f"Capture armed, settling {capture_settle_sec}s before sync flash...")
    time.sleep(capture_settle_sec)

    flash_window = flash_and_hold()
    run_feeder(maneuver, dry_run=dry_run, log_path=trial_dir / "input_log.csv", poll_hz=500.0)
    flash_window.destroy()

    time.sleep(0.3)  # let a couple of neutral frames record after the maneuver, before stopping
    if backend == "obs":
        from recorder.obs_capture import stop as obs_stop
        actual_path = Path(obs_stop(client))
    else:
        from recorder.ffmpeg_capture import stop as ffmpeg_stop
        actual_path = ffmpeg_stop(proc, video_path)

    if actual_path != video_path:
        # OBS decides its own filename/location -- copy it into the trial folder so every
        # downstream path is consistent regardless of which backend recorded it.
        import shutil
        shutil.copy(actual_path, video_path)

    meta = {
        "ship": ship, "maneuver": maneuver["name"], "axis": axis, "fov_deg": fov,
        "resolution": list(resolution), "backend": backend, "seed": seed,
        "flight_mode": flight_mode,
    }
    (trial_dir / "meta.json").write_text(json.dumps(meta, indent=2))

    print(f"Analyzing {video_path}...")
    seed_x, seed_y = seed if seed else (resolution[0] / 2, resolution[1] / 2)
    trajectory = track(video_path, seed_x, seed_y, half_window=track_window)

    try:
        brightness, fps = region_brightness_trace(video_path, FLASH_REGION)
        flash_frame = detect_flash(brightness)
        t0 = flash_frame / fps
        print(f"Sync flash at frame {flash_frame} (t={t0:.4f}s)")
    except RuntimeError as e:
        # Some games' borderless/flip-model swapchains bypass normal window compositing and paint
        # over even "always on top" windows, so the flash never actually appears in the recording --
        # fall back to detecting when the tracked landmark itself starts moving (valid because every
        # maneuver starts driving its axis immediately at t=0, see sync_detect.detect_motion_onset).
        print(f"Flash sync unavailable ({e}); falling back to motion-onset detection.")
        if axis == "roll":
            # Neither pixel_x nor pixel_y alone is reliable here -- roll moves the landmark along a
            # circular arc around frame center, so its motion can be almost entirely in the OTHER
            # dimension depending on where it happened to be seeded (e.g. seeded directly above
            # center, initial roll motion is nearly pure pixel_x). Total per-frame displacement
            # magnitude is robust regardless of seed position.
            xs = np.array([row["pixel_x"] for row in trajectory])
            ys = np.array([row["pixel_y"] for row in trajectory])
            pixel = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(xs), np.diff(ys)))])
        else:
            pixel_col = "pixel_x" if axis == "x" else "pixel_y"
            pixel = np.array([row[pixel_col] for row in trajectory])
        motion_frame = detect_motion_onset(pixel)
        t0 = trajectory[motion_frame]["t"]
        print(f"Motion onset at frame {motion_frame} (t={t0:.4f}s)")

    for row in trajectory:
        row["t"] -= t0  # rebase to maneuver-relative time via sync (flash or motion-onset fallback)
    (trial_dir / "trajectory.csv").write_text(
        rows_to_csv(trajectory, ["frame", "t", "pixel_x", "pixel_y", "peak_brightness"]))

    omega_rows = convert(trajectory, axis=axis, fov_deg=fov, resolution=resolution,
                          smooth_window=11, smooth_poly=3)
    (trial_dir / "omega.csv").write_text(rows_to_csv(omega_rows, ["t", "angle_deg", "omega_deg_s"]))

    print(f"Trial complete -> {trial_dir}")
    return trial_dir


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("maneuver", type=Path)
    parser.add_argument("--ship", required=True, help="ship name, e.g. Gladius/Taurus/Arrow -- "
                         "tags meta.json and partitions data/<ship>/<maneuver>/<timestamp>/ so "
                         "datasets from different ships never collide")
    parser.add_argument("--backend", choices=["obs", "ffmpeg"], default="ffmpeg")
    parser.add_argument("--axis", choices=["x", "y", "roll"], required=True,
                         help="x=yaw, y=pitch, roll=roll (polar angle about frame center, needs an "
                              "off-center landmark seed -- see BLUEPRINT.md)")
    parser.add_argument("--flight-mode", choices=["coupled", "decoupled"], required=True,
                         help="operator-asserted IFCS coupled/decoupled state, recorded verbatim "
                              "into meta.json -- NOT auto-detected (see BLUEPRINT.md's Gotchas: an "
                              "entire yaw dataset was silently captured in Decoupled before this "
                              "flag existed). shipTypes.ts/flightModel.ts model Coupled flight; "
                              "Decoupled data isn't comparable to it at all.")
    parser.add_argument("--fov", type=float, required=True)
    parser.add_argument("--resolution", required=True, help="WIDTHxHEIGHT")
    parser.add_argument("--seed-x", type=float, default=None)
    parser.add_argument("--seed-y", type=float, default=None)
    parser.add_argument("--window", type=int, default=40,
                         help="half-width in pixels of the tracking search window -- widen this for "
                              "a large landmark (e.g. a station marking) vs. the default sized for "
                              "a small point-source like a star")
    parser.add_argument("--capture-settle", type=float, default=1.0)
    parser.add_argument("--out", type=Path, default=Path("data"))
    parser.add_argument("--obs-host", default="localhost")
    parser.add_argument("--obs-port", type=int, default=4455)
    parser.add_argument("--obs-password", default="")
    parser.add_argument("--obs-source-name", default="Desktop Capture",
                         help="name of the OBS monitor_capture source, used to grab a live screenshot "
                              "for the automatic --flight-mode check (see check_flight_mode)")
    parser.add_argument("--fps", type=int, default=60)
    parser.add_argument("--dry-run", action="store_true",
                         help="don't touch vJoy (no driver/hardware needed) -- still arms real "
                              "capture and runs the full flash+record+analyze pipeline, useful for "
                              "testing everything except the actual in-game maneuver")
    args = parser.parse_args()

    width, height = (int(v) for v in args.resolution.lower().split("x"))
    seed = (args.seed_x, args.seed_y) if args.seed_x is not None and args.seed_y is not None else None
    obs_kwargs = {"host": args.obs_host, "port": args.obs_port, "password": args.obs_password}
    ffmpeg_kwargs = {"fps": args.fps}

    run_trial(args.maneuver, args.backend, args.axis, args.fov, (width, height), seed,
              obs_kwargs, ffmpeg_kwargs, args.capture_settle, args.out, args.ship, args.flight_mode,
              dry_run=args.dry_run, track_window=args.window, obs_source_name=args.obs_source_name)


if __name__ == "__main__":
    sys.exit(main())
