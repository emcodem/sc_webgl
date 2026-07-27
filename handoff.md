# Handoff — full-engine-power recapture plan (2026-07-27)

Written for a fresh session with no prior context. Read `capture/MEASUREMENTS.md`'s "⚠ Standing
confound: engine power-triangle allocation" section first for the full story; this file is just the
action list. Priorities 1, 2, and 4 (pitch spool-up, afterburner ratios for all 3 rotational axes,
and all linear thrust/speed rows) are complete and CONFIRMED — see `MEASUREMENTS.md`'s
Roll/Pitch/Yaw/Linear tables.

## Not yet started

- **Pitch/yaw reversal transient — [GitHub issue #12](https://github.com/emcodem/sc_webgl/issues/12) —
  IMPLEMENTED 2026-07-28, per user go-ahead, but on SUSPECT data.** Real SC's "brake first"
  sluggishness on a hard pitch/yaw reversal is now modeled: `flightModel.ts` gained a
  `stepPitchYawAxis` reversal branch (constant deceleration when the commanded target opposes current
  spin, distinct from the spring-damper spool-up/release model) driven by a new per-ship field,
  `ShipType.pitchYawReversalDecel` (`core/types.ts` → `rawShipType.ts` → `buildShipType.ts` →
  `gladius.ts`: pitch 3.9667 rad/s², yaw 4.5500 rad/s²). 3 new tests in
  `tests/shipTuning.test.ts` ("pitch/yaw reversal governor" describe block); `npm test` (196/196) and
  `npm run build` both pass.
  - **The data behind this is felt-threshold, not frame-tracked** — see `MEASUREMENTS.md`'s "Reversal
    stop-time — felt-threshold method (2026-07-27/28)" section: a new interactive tool,
    `capture/reversal_feel_test.py`, drives a scripted mag1→mag2 hard flip while a human judges by
    eye whether the ship visibly starts turning the new way. Pitch's mag1-only curve (mag2=full) is
    well-validated (linear fit correctly predicted 3 held-out points before they were measured); yaw's
    curve shape was never independently validated the same way and should be treated as rougher.
  - **Known gaps, explicitly NOT covered by this implementation** (see the code comments on
    `pitchYawReversalDecel` in both `core/types.ts` and `gladius.ts`): no boosted-reversal data at all
    (boost reuses the non-boosted constant); no confirmed model for how the decel rate depends on the
    *counter*-input's own magnitude (mag2) — one exploratory data point suggests it saturates near
    full effect well before full counter-deflection, so the code applies full decel whenever the
    target opposes current spin at all, not scaled by mag2. A proposed mag2-saturation follow-up
    sweep (mag1=1000, mag2 = -300/-150/-80) was never run.
  - Also still open from the original device-path investigation: `feeder/maneuvers/pitch_reversal.json`
    exists (mirrors `yaw_reversal.json`) but has never been captured via the OLDER `orchestrate.py` +
    `fit_model.py` device-path (frame-tracked, not felt-threshold) — would be a good independent check
    on the numbers above, since a frame-tracked ground truth for this hasn't happened yet. Issue #12
    also still flags pitch's input-curve exponent as unconfirmed and `recenter.py`'s pitch-axis bug as
    unresolved.
- **Non-boosted rotational baselines for roll and yaw at full power** (pitch's is already done).
  Roll/Yaw tables in `MEASUREMENTS.md` still carry the pre-power-triangle-fix SUSPECT rows for this.

## Practical notes

- Confirm full power to engines (visually, power management panel) before every capture — don't
  assume a prior session's setting persists, especially after any relogin.
- Every capture script's `ready_and_reset()` (in `feeder/win_focus.py`) pops a confirmation dialog
  first — expect it, click OK, then the usual foreground+reset happens, and OBS only starts recording
  after that's done (so the recorded clip doesn't include the wait).
- Once a category is recaptured, update its `MEASUREMENTS.md` row's Status from SUSPECT to CONFIRMED
  (or update the value if it moved) — don't leave stale SUSPECT rows once they're actually resolved.
- A script-driven capture can still collide with real operator input mid-run even with the
  pre-recording confirmation dialog, since that dialog only guards the start — check the resulting
  clip's tail before assuming a mid-run interruption invalidated it (it may have landed after the
  data you needed was already captured).
