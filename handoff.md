# Handoff — full-engine-power recapture plan (2026-07-27)

Written for a fresh session with no prior context. Read `capture/MEASUREMENTS.md`'s "⚠ Standing
confound: engine power-triangle allocation" section first for the full story; this file is just the
action list. Two sessions have now worked this plan (2026-07-26 opened it, 2026-07-26/27 overnight
did Priority 1 and Priority 2) — the priorities below are what's left.

## DONE — do not re-capture

- **Priority 1 (pitch spool-up)**: complete. Boosted pitch UP/DOWN steady rate CONFIRMED at full
  power (~81.7-82.0°/s both directions). 2nd-order spool shape (ωₙ/ζ) also has a first converged
  reading both directions (ωₙ ~9.5-10.3 rad/s) — single-rep, noisier than ideal, but real. See
  `MEASUREMENTS.md`'s Pitch and spool-up tables.
- **Priority 2 (afterburner ratios, all 3 rotational axes)**: essentially complete.
  - **Roll: CONFIRMED**, 1.199× (non-boosted 199.6°/s, boosted 239.4°/s, 2 reps × 2 directions each,
    very tight). Matches coded 1.2× almost exactly.
  - **Pitch: CONFIRMED**, 1.190× (non-boosted UP 68.75°/s, 2 reps; boosted UP from Priority 1).
  - **Yaw: SUSPECT**, 1.165× (non-boosted 50.95°/s solid, 2 reps; boosted 59.36°/s is a SINGLE noisy
    rep — see "Yaw boosted repeat" below).
  - Headline finding: all three ratios sit much closer to the coded uniform 1.2× at full power than
    the earlier non-full-power values (1.18×/1.06×/1.057×) — the power-triangle confound was masking
    a real, near-uniform afterburner multiplier across every rotational axis.
- **Priority 3 (non-boosted rotational baselines)**: done as a byproduct of Priority 2 — roll
  (199.6°/s), pitch (68.75°/s), yaw (50.95°/s) are all CONFIRMED non-boosted full-power reads.

## Not yet started

- **Priority 4 (linear thrust/speed)**: forward/back/lateral/up/down accel + coast-decel, max
  speeds, boosted lateral/vertical, boosted forward/retro top speed and boost-release decay rates —
  `linear_hold_capture.py` + `montage_speed.py`. All currently single-rep at unconfirmed power
  (predates the power-triangle fix). Untouched this session.

## Loose ends worth tidying

- ~~Yaw boosted — needs a clean repeat~~ **DONE 2026-07-27**: root cause was NOT focus interruption
  (that was never actually confirmed) — it was a genuine **field-of-view excursion**. Boosted yaw is
  fast enough (~55-61°/s) that the old 1.5s dwell drove the tracked star past the 58° half-FOV edge
  before the hold ended, corrupting the median with post-excursion garbage. Fixed by shortening the
  dwell to 0.7s (keeps the star in-frame the whole hold); 3 clean reps now agree tightly (61.68 /
  58.61 / 61.26°/s, mean 60.52, std 1.36) → afterburner ratio 1.188×, matching roll/pitch. See
  `MEASUREMENTS.md`'s Yaw table.
- ~~Pitch UP 360-test repeat is marginal~~ **DONE 2026-07-27**: redone with 2s extra dwell margin so
  the sun's return is comfortably mid-clip. Used a crossing-time read (exact video-time the sun
  re-crosses its starting pixel row, found via precise `centroid_in_window` reads bracketing the
  crossing, with T0 fit from the clean early portion of the trace only — continuous tracking through
  the whole clip is still unreliable, per `BLUEPRINT.md`'s existing warning, and in fact false-locked
  onto the radar-cone HUD graphic around t≈1.7s in this same clip, exactly the documented gotcha).
  Implied rate ≈80.4°/s (range 79.8-81.1 depending on T0-fit precision) — within ~2% of the 81.98°/s
  reference, confirms it. See `MEASUREMENTS.md`'s Pitch table.
- ~~Pitch DOWN 360-test is fully invalidated~~ **DONE 2026-07-27**: relocated to genuinely empty
  space and redone with the same margined crossing-time method as the UP repeat above. Implied rate
  ≈81.1°/s (range 80.6-81.6), matching the established 80.5-82.0°/s full-power cluster. See
  `MEASUREMENTS.md`'s Pitch table.

## New tooling from this session

- **`capture/analysis/track_roll_twopoint.py`** (new): tracks roll via the bearing between two
  independently-tracked point landmarks (e.g. two lit station structures/landing pads a few percent
  off-center), for scenes with no single elongated object for `track_orientation.py`'s PCA approach.
  Used successfully for all of this session's roll captures. See its own docstring.
- **Recording-flow fix (`feeder/win_focus.py` + all capture scripts), 2026-07-27**: every
  `*_capture.py` script used to call `obs_start()` *before* the operator's confirmation popup
  (`656d6f7`'s safety gate), so the recorded clip's leading seconds were however long the operator
  took to click "ready?" — observed anywhere from ~5s to 110s+ in practice. This silently broke
  `analysis/hold_rate.py`'s fixed 0.5-6.0s auto-alignment search (near-zero correlation, no error
  raised) and was the proximate trigger for digging into the yaw gotcha above. Fixed by splitting
  `win_focus.py`'s `focus_and_click`/`focus_no_click` into `ready_and_reset()` (popup + foreground +
  Esc×2 reset) and a separate `click_center(hwnd)`, and reordering every capture script to:
  `ready_and_reset()` → `obs_start()` → `click_center()` (if needed) → settle → maneuver. Recordings
  are now consistently a few seconds long instead of tens-to-hundreds, and `hold_rate.py` also grew a
  `--t0-max` flag (still defaults to 6.0s) in case a future capture's lead-in is unusually long again
  — check `corr` is high (>0.7ish) and widen it before assuming a capture is bad.

## Gotchas hit this session (both already added to `MEASUREMENTS.md` and memory)

- **A too-narrow `--window` on `fit_spool_response.py`/`track_landmark.py` can cause a false-lock
  onto a static bright object well before the landmark's true physical exit**, producing a
  degenerate/pinned fit that looks like "not enough data" when it's actually a tracking-parameter
  problem. Fix: widen `--window` (40→80 or more) and re-analyze the SAME already-captured video —
  no recapture needed. See `feedback_widen_tracking_window_before_recapturing` memory.
- **Pitch specifically can false-lock onto the radar/scan-cone HUD graphic** (fixed screen position,
  roughly y≈1470-1490 at 3840×2160/116° FOV) well before any real physical limit, if seeded too
  close to center. `BLUEPRINT.md` already documented this ("seed well above center, ~25% margin from
  the top") — check that file's Gotchas section before deep-diagnosing a similar-looking freeze.
- **Yaw's own full-deflection point (~1500 counts) is well above pitch's clamp (1080)** — using 1080
  for a yaw capture undershoots yaw's plateau and reads a proportionally lower, curve-shaped rate,
  not a wrong measurement. Use ~1700 counts for yaw to land on its actual plateau.
- **A station/structure drifting into an AC instance's view can contaminate star-tracking** for both
  the simple hold-capture method and the 360°-sustained-hold method — not just busy starfields.
  Verify you're in genuinely empty space before trusting a capture, especially after spending time
  near a station for roll work (its lights/structure can persist in frame for subsequent pitch/yaw
  captures taken from the same spot).

## Practical notes (carried over, still true)

- Confirm full power to engines (visually, power management panel) before every capture — verified
  via screenshot multiple times this session, including after an unplanned mid-session relogin.
- Every capture script's `focus_and_click`/`focus_no_click` pops a confirmation dialog first —
  expect it, click OK, then the usual foreground+reset happens.
- Once a category is recaptured, update its `MEASUREMENTS.md` row's Status from SUSPECT to CONFIRMED
  (or update the value if it moved) — don't leave stale SUSPECT rows once they're actually resolved.
