"""Lightweight, non-ML pixel checks against fixed HUD regions -- for automating things this project
previously relied on the operator eyeballing a screenshot for (flight mode, crash/menu detection).

Coordinates/template below are calibrated against a 3840x2160 capture with this project's observed
HUD scale/layout -- if resolution or HUD scale changes, re-derive them the same way this file's own
docstring describes (crop a tight reference image of the indicator from a known-good screenshot,
re-run the calibration sweep over a batch of known screenshots to re-derive thresholds).

Superseded a first version of this check that counted bright pixels in a fixed region instead of
template-matching the actual glyph -- raised as a real concern (correctly): a nearby element (ESP's
own box) can bleed brightness into that region independent of whether CPLD itself is present,
producing a false read. Confirmed happening in practice: the brightness-count version once reported
Decoupled when Coupled was actually on. Template matching against the specific "CPLD" glyph shape is
far more specific and was validated across every screenshot taken this session (see git history /
session notes for the calibration sweep) -- cleanly separated into three bands:
  < ~0.5           : not even in the cockpit (menu, crash, loading screen, blank capture)
  ~0.70 - 0.75     : Decoupled (ESP box present, CPLD absent)
  ~0.82 - 1.0      : Coupled (ESP + CPLD both present)
"""

from pathlib import Path

import cv2
import numpy as np

_TEMPLATE_PATH = Path(__file__).parent / "cpld_template.png"
_TEMPLATE = cv2.cvtColor(cv2.imread(str(_TEMPLATE_PATH)), cv2.COLOR_BGR2GRAY)

# Generous search window around the indicator's expected position -- matchTemplate finds the best
# alignment within it, so this doesn't need to be pixel-exact the way a fixed-region brightness
# check would.
SEARCH_REGION = (1380, 1000, 1550, 1130)  # x0, y0, x1, y1 at 3840x2160

NOT_IN_COCKPIT_THRESHOLD = 0.5   # below this: not a recognizable in-flight cockpit HUD at all
COUPLED_THRESHOLD = 0.80         # at/above this: Coupled; between the two thresholds: Decoupled


def cpld_match_score(image_bgr: np.ndarray) -> float:
    x0, y0, x1, y1 = SEARCH_REGION
    gray = cv2.cvtColor(image_bgr[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    result = cv2.matchTemplate(gray, _TEMPLATE, cv2.TM_CCOEFF_NORMED)
    return float(result.max())


def detect_flight_state(image_bgr: np.ndarray) -> str:
    """Returns 'not_in_cockpit', 'decoupled', or 'coupled'."""
    score = cpld_match_score(image_bgr)
    if score < NOT_IN_COCKPIT_THRESHOLD:
        return "not_in_cockpit"
    return "coupled" if score >= COUPLED_THRESHOLD else "decoupled"


def detect_coupled(image_bgr: np.ndarray) -> bool:
    """Back-compat boolean wrapper -- True only for a confirmed Coupled cockpit HUD. Note this
    means 'not_in_cockpit' also returns False; callers that care about that distinction should use
    detect_flight_state directly instead."""
    return detect_flight_state(image_bgr) == "coupled"


def detect_coupled_from_file(path: str) -> bool:
    img = cv2.imread(path)
    if img is None:
        raise RuntimeError(f"could not open {path}")
    return detect_coupled(img)
