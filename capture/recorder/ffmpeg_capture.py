"""Screen capture via ffmpeg's `ddagrab` filter (Windows DXGI Desktop Duplication API) + GPU
h264_nvenc encoding -- use this if OBS + obs-websocket isn't set up. No in-scene burned-in timer
overlay (orchestrate.py's sync flash still shows up fine, since that's just drawn on-screen -- when
it's actually visible; some games' swapchains bypass normal window compositing, see
sync_detect.detect_motion_onset for the fallback), and you own picking the right resolution/monitor
offset yourself. Requires `ffmpeg` on PATH with ddagrab support (check `ffmpeg -filters`).

Measured on this project's dev machine at 3840x2160: the old `gdigrab` (GDI BitBlt) backend achieved
only ~16-19fps against a 60fps request, regardless of encoder (swapping libx264 for h264_nvenc alone
made no difference -- confirming gdigrab's own capture step, not encoding, was the bottleneck).
`ddagrab` (DXGI-based, GPU-side) reached ~55fps requesting 60. Both are still short of a true 60fps,
so downstream timing MUST come from each frame's own container timestamp (see
analysis/track_landmark.py's use of CAP_PROP_POS_MSEC), not an assumed-uniform frame_idx/fps -- this
matters doubly here since `dup_frames=false` deliberately keeps only genuinely new captures rather
than padding gaps with repeated frames, so frame-to-frame spacing is NOT uniform.
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path


def start(output_path: Path, resolution: str = "1920x1080", fps: int = 60,
          monitor_offset: tuple[int, int] = (0, 0)) -> subprocess.Popen:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    width, height = resolution.split("x")
    ddagrab_opts = (
        f"ddagrab=0:framerate={fps}:dup_frames=false"
        f":video_size={width}x{height}:offset_x={monitor_offset[0]}:offset_y={monitor_offset[1]}"
    )
    cmd = [
        "ffmpeg", "-y",
        "-init_hw_device", "d3d11va",
        "-filter_complex", ddagrab_opts,
        "-fps_mode", "passthrough",
        "-c:v", "h264_nvenc", "-cq:v", "20",
        str(output_path),
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop(proc: subprocess.Popen, output_path: Path, timeout: float = 10.0) -> Path:
    """Asks ffmpeg to finish the file cleanly ('q' on stdin, like an interactive session) rather
    than killing it -- a hard kill can leave the mp4 with no valid moov atom (unplayable)."""
    try:
        proc.communicate(input=b"q", timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.terminate()
        proc.wait(timeout=5)
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Manual start/stop of an ffmpeg gdigrab capture (for testing).")
    parser.add_argument("action", choices=["start", "stop"])
    parser.add_argument("--output", type=Path, default=Path("data/manual_capture.mp4"))
    parser.add_argument("--resolution", default="1920x1080")
    parser.add_argument("--fps", type=int, default=60)
    parser.add_argument("--seconds", type=float, default=5.0, help="only used for 'start': how long to record before auto-stopping")
    args = parser.parse_args()

    if args.action == "start":
        proc = start(args.output, args.resolution, args.fps)
        print(f"Recording -> {args.output} for {args.seconds}s...")
        time.sleep(args.seconds)
        stop(proc, args.output)
        print("Done.")
    else:
        print("Standalone 'stop' has no process handle to attach to outside a single run; "
              "use --seconds with 'start', or call start()/stop() from orchestrate.py.")


if __name__ == "__main__":
    sys.exit(main())
