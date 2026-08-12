import cv2
import numpy as np
import sys
import csv

VIDEO = r"C:\Users\User\Videos\2026-08-04_00-28-06.mp4"
OUT_CSV = r"C:\dev\sc_webgl\capture\data\unboost_strafe_cutoff\tvi_track.csv"

# Search window in full-frame coords: wide in X to catch left/right strafe.
# Capped below y=1230 to stay clear of the heading-compass ring HUD element, which is large,
# bright, and otherwise dominates the largest-bright-blob selection almost every frame.
X0, Y0, W, H = 1650, 950, 540, 250
# Fixed box covering the paren brackets + the TVI's own rest position (full-frame coords).
# The TVI overlaps this box when at rest -- that's expected, and means offset 0.
EXCLUDE = (1885, 1955, 1058, 1102)  # x0, x1, y0, y1
REST = (1920.0, 1080.0)  # nose/boresight reference == paren geometric center


def bright_mask(bgr):
    b = bgr[:, :, 0].astype(np.int16)
    g = bgr[:, :, 1].astype(np.int16)
    return (b > 180) & (g > 180)


def main():
    cap = cv2.VideoCapture(VIDEO)
    fps = cap.get(cv2.CAP_PROP_FPS)
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = int(round(fps / 30))  # sample at ~30fps
    print(f"fps={fps} n_frames={n_frames} step={step}", file=sys.stderr)

    kernel = np.ones((3, 3), np.uint8)
    rows = []
    idx = 0
    ex0, ex1, ey0, ey1 = EXCLUDE
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % step == 0:
            crop = frame[Y0:Y0 + H, X0:X0 + W]
            mask = bright_mask(crop)
            # blank out the fixed paren+rest box (local coords)
            lx0, lx1 = max(0, ex0 - X0), max(0, ex1 - X0)
            ly0, ly1 = max(0, ey0 - Y0), max(0, ey1 - Y0)
            mask[ly0:ly1, lx0:lx1] = False
            # blank out the throttle gauge / ESP crosshair / speed digits cluster on the left
            # (full-frame x < 1700 -- see gauge_check.png), which otherwise reads as a large,
            # nearly-stationary bright blob that dominates the largest-blob selection.
            gauge_lx1 = max(0, 1700 - X0)
            mask[:, :gauge_lx1] = False
            # blank out the AB%/boost-meter readout on the right (full-frame x > 2100 -- see
            # right_artifact_check.png), same contamination while boost is actively displayed.
            ab_lx0 = max(0, 2100 - X0)
            mask[:, ab_lx0:] = False
            mask_u8 = cv2.dilate((mask.astype(np.uint8)) * 255, kernel, iterations=1)
            n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask_u8, connectivity=8)
            best = None
            for i in range(1, n):
                area = stats[i, cv2.CC_STAT_AREA]
                if area < 5:
                    continue
                if best is None or area > best[1]:
                    best = (centroids[i], area)
            t = idx / fps
            if best is not None:
                (cx, cy), area = best
                fx, fy = X0 + cx, Y0 + cy
                rows.append((idx, t, fx, fy, fx - REST[0], fy - REST[1], area))
            else:
                rows.append((idx, t, REST[0], REST[1], 0.0, 0.0, 0))
        idx += 1

    with open(OUT_CSV, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["frame", "t", "x", "y", "dx", "dy", "area"])
        w.writerows(rows)
    print(f"wrote {len(rows)} rows to {OUT_CSV}", file=sys.stderr)


if __name__ == "__main__":
    main()
