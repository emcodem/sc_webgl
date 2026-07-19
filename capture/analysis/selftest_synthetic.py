"""Validates the CV pipeline (track_landmark.py + angle_convert.py) against a synthetic clip with a
KNOWN ground-truth angular-rate profile -- the only way to catch a wrong FOV/focal-length formula
or a tracking/differentiation bug independent of noisy real game footage. Run this after any change
to the tracking or angle-conversion math, and before trusting a result from real footage.

The synthetic clip's dot motion is generated from an INDEPENDENT projection formula (written out
here from scratch, not imported from angle_convert.py) so this is a genuine round-trip check of
that module's own pixel<->angle formula, not a tautology that would pass even if both sides shared
a bug.
"""

import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from track_landmark import track  # noqa: E402
from angle_convert import convert  # noqa: E402
from sync_detect import region_brightness_trace, detect_flash  # noqa: E402

WIDTH, HEIGHT = 640, 360  # 16:9, deliberately non-square -- see the axis="y" case below
FPS = 60.0
FOV_DEG = 90.0  # horizontal FOV, used for both generation (independently) and recovery
MASS = 1.5
DURATION_S = 2.0

# Real measured constants per axis (see ../../src/physics/shipTypes.ts) -- reuse the same
# first-order lag ODE flightModel.ts uses, so each synthetic ground truth is an actual reversal
# transient shape, not an arbitrary one. Timing matches feeder/maneuvers/{yaw,pitch}_reversal.json.
AXIS_CASES = {
    # pixel_axis: the trajectory column driven; angle_convert_axis: what convert(axis=...) expects
    "x": dict(pixel_axis="x", angle_convert_axis="x", thrust=14.0721, drag=15.4639, max_ang_vel=0.91,
              segment_times=(0.5, 1.5)),
    # Shorter hold than the real pitch_reversal.json's 0.8s -- pitch's faster max_ang_vel integrated
    # over 0.8s exceeds this synthetic test's own 90deg FOV (45deg half-FOV), sending the dot
    # partway off its own frame and contaminating the RMS with an edge-tracking artifact unrelated
    # to angle_convert.py's math. This test only needs a big-enough excursion to be a meaningful
    # check, not to match the real maneuver's exact timing.
    "y": dict(pixel_axis="y", angle_convert_axis="y", thrust=12.2261, drag=10.2740, max_ang_vel=1.19,
              segment_times=(0.35, 1.0)),
}


def make_input_fn(t_flip: float, t_neutral: float):
    def input_fn(t: float) -> float:
        if t < t_flip:
            return 1.0
        if t < t_neutral:
            return -1.0
        return 0.0
    return input_fn


def ground_truth_omega_and_angle(thrust: float, drag: float, max_ang_vel: float,
                                  segment_times: tuple[float, float], dt_fine: float = 1 / 2000):
    input_fn = make_input_fn(*segment_times)
    n_fine = int(DURATION_S / dt_fine)
    t_fine = np.arange(n_fine) * dt_fine
    omega = np.zeros(n_fine)
    angle = np.zeros(n_fine)
    w = 0.0
    a = 0.0
    for i in range(1, n_fine):
        u = input_fn(t_fine[i])
        w += (u * thrust / MASS - w * drag / MASS) * dt_fine
        w = max(-max_ang_vel, min(max_ang_vel, w))
        a += w * dt_fine
        omega[i] = w
        angle[i] = a
    return t_fine, omega, angle


def render_synthetic_clip(video_path: Path, t_fine: np.ndarray, angle_fine: np.ndarray,
                           pixel_axis: str) -> tuple[float, float, float]:
    """Renders a bright dot moving per `angle_fine` via pixel = center + focal*tan(angle) (the
    inverse projection, written independently of angle_convert.py) along either the x or y pixel
    axis, plus a one-frame sync flash in the top-left corner on frame 0. `focal_px` is always
    derived from WIDTH (the horizontal dimension) regardless of which pixel axis is driven -- this
    is the actual camera-intrinsic invariant angle_convert.py must also respect (see its comment on
    the axis="y" fix), so rendering it any other way would make this test a tautology instead of an
    independent check. Returns (seed_x, seed_y, max_abs_angle_deg)."""
    focal_px = (WIDTH / 2) / np.tan(np.radians(FOV_DEG) / 2)
    center_x, center_y = WIDTH / 2, HEIGHT / 2

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(video_path), fourcc, FPS, (WIDTH, HEIGHT))

    n_frames = int(DURATION_S * FPS)
    seed_x = seed_y = None
    max_abs_angle = 0.0
    for frame_idx in range(n_frames):
        t = frame_idx / FPS
        angle = np.interp(t, t_fine, angle_fine)
        max_abs_angle = max(max_abs_angle, abs(angle))
        offset = focal_px * np.tan(angle)
        px = center_x + offset if pixel_axis == "x" else center_x
        py = center_y + offset if pixel_axis == "y" else center_y

        img = np.full((HEIGHT, WIDTH, 3), 20, dtype=np.uint8)
        cv2.circle(img, (int(round(px)), int(round(py))), 6, (255, 255, 255), -1)
        if frame_idx == 0:
            cv2.rectangle(img, (0, 0), (80, 80), (255, 255, 255), -1)
            seed_x, seed_y = px, py

        writer.write(img)
    writer.release()
    return seed_x, seed_y, np.degrees(max_abs_angle)


def run_case(axis_label: str, case: dict) -> bool:
    t_fine, omega_fine, angle_fine = ground_truth_omega_and_angle(
        case["thrust"], case["drag"], case["max_ang_vel"], case["segment_times"])

    max_frame_angle_deg = np.degrees(np.abs(angle_fine).max())
    fov_margin_deg = FOV_DEG / 2
    print(f"[axis={axis_label}] Ground truth peak excursion: {max_frame_angle_deg:.1f} deg "
          f"(frame half-FOV: {fov_margin_deg:.1f} deg)")
    if max_frame_angle_deg > 0.9 * fov_margin_deg:
        print("WARNING: ground-truth excursion is close to the frame edge -- if this fails, the "
              "maneuver's timing (or the test's FOV) needs to leave more margin.")

    with tempfile.TemporaryDirectory() as tmp:
        video_path = Path(tmp) / "synthetic.mp4"
        seed_x, seed_y, _ = render_synthetic_clip(video_path, t_fine, angle_fine, case["pixel_axis"])

        brightness, fps = region_brightness_trace(video_path, (0, 0, 80, 80))
        flash_frame = detect_flash(brightness)
        if flash_frame != 0:
            print(f"FAIL: sync_detect found the flash at frame {flash_frame}, expected frame 0")
            return False
        print(f"[axis={axis_label}] sync_detect: flash found at frame 0 as expected (fps={fps:.1f})")

        trajectory = track(video_path, seed_x, seed_y, half_window=40)
        result = convert(trajectory, axis=case["angle_convert_axis"], fov_deg=FOV_DEG,
                          resolution=(WIDTH, HEIGHT), smooth_window=11, smooth_poly=3)

    t_recovered = np.array([r["t"] for r in result])
    omega_recovered_deg_s = np.array([r["omega_deg_s"] for r in result])
    omega_ground_truth_deg_s = np.degrees(np.interp(t_recovered, t_fine, omega_fine))

    # Trim the first/last few frames: the savgol window and the tracker's first-frame seed both
    # bias the edges -- not a real-pipeline concern once trimmed to the maneuver's interior.
    trim = 8
    err = omega_recovered_deg_s[trim:-trim] - omega_ground_truth_deg_s[trim:-trim]
    rms_err = np.sqrt(np.mean(err ** 2))
    max_err = np.max(np.abs(err))

    print(f"[axis={axis_label}] RMS omega error: {rms_err:.3f} deg/s, max: {max_err:.3f} deg/s "
          f"(ground truth peaks at {np.degrees(case['max_ang_vel']):.1f} deg/s)")

    tolerance_deg_s = 3.0
    if rms_err > tolerance_deg_s:
        print(f"FAIL: RMS error {rms_err:.3f} exceeds tolerance {tolerance_deg_s} for axis={axis_label}")
        return False
    return True


def main() -> None:
    results = {label: run_case(label, case) for label, case in AXIS_CASES.items()}
    if not all(results.values()):
        failed = [label for label, ok in results.items() if not ok]
        print(f"FAIL: {failed}")
        sys.exit(1)
    print("PASS")


if __name__ == "__main__":
    sys.exit(main())
