# Handoff — measurements to re-test in light of the resolution-dependent vjoy clamp (2026-07-23)

Context: found that Star Citizen's mouse-vjoy accumulator **hard-caps at half the capture resolution
in pixels, per axis** (half-width for yaw, half-height for pitch) — see the CRITICAL note at the top
of `capture/MEASUREMENTS.md`. Confirmed for pitch at 3840×2160 capture (clamp = 1080, found via live
bisection watching for clean-stop-vs-overshoot-on-release). Predicted but not yet independently
confirmed for yaw at the same resolution: clamp = 1920. Any past capture that drove a raw mouse count
past the relevant clamp risks being contaminated by this — not necessarily wrong, but worth checking.

**Re-derive the clamp for whatever resolution is actually in use before redoing anything below** — it's
half the capture width (yaw) or half the capture height (pitch) of THAT session's capture, not a fixed
1920/1080 across all future sessions.

## To re-test — high priority

- ~~**The foundational Gladius PITCH/YAW + afterburner measurement**~~ — **PITCH half DONE (2026-07-23)**:
  redone clean at 1080 counts (safely under the confirmed clamp), sun-tracked, same method otherwise —
  see `MEASUREMENTS.md`'s "PITCH row superseded" note under the original 2026-07-19 entry. Result:
  **64.86°/s unboosted, 71.11°/s boosted, ratio 1.096×** (both clean single-rep reads, `hold_rate.py`
  corr 0.92/0.97, no lost-lock). Notably: the ratio (1.096) is lower than both the old contaminated
  reading's ratio (1.155) and the coded 1.2 afterburner multiplier — worth a repeat rep before treating
  that as a real finding rather than single-rep noise. **Yaw's redo DONE too (2026-07-23)**: 1920 counts
  (the clamp boundary itself), sun centered, clean single rep — **51.27°/s** (corr 0.975), matching the
  established ~50.8-51°/s plateau. Confirms yaw's existing 1500-2200 data isn't clamp-contaminated the
  way pitch's old ~2000-count reading was. See `MEASUREMENTS.md`'s "Clamp-boundary check at 1920
  counts" note.

## Worth flagging, conclusions likely still hold but narrower than stated

- ~~Item 1's "repeat 1300-2200" data / dense sweep's 2200 reading~~ — **DONE (2026-07-23)**: the
  past-clamp rows (2000/2200 in the repeat table, 2200 in the dense sweep) have been deleted from
  `MEASUREMENTS.md` rather than just flagged, since they were re-reads of the clamped ~1920 position,
  not independent data. The "flat plateau" conclusion now reads through ~1800-1920 (the surviving
  data), backed independently by the clean 1920-count clamp-boundary capture (51.27°/s) — practical
  conclusion (`fullDeflectionCounts ≈ 1500`) unchanged.
- **The vjoy-*indicator* gain cross-check's old ~4000 result** — already retracted outright (not just
  flagged) in `YAWCAPTURE.md`'s "RETRACTED (2026-07-23)" section and removed from `MEASUREMENTS.md`;
  noted here only so it isn't accidentally re-added. If this cross-check is ever redone, keep every
  driven amplitude under the resolution-derived clamp.

## Unaffected — do not need re-testing

- Everything using ≤600-1000 counts: `VJoyAnglePilots` flight-effect test, `VJoyCombinedDeadZone`
  measurements, input-curve shape / cross-ship gain, the fast/slow reversal-transient captures. All
  comfortably under either clamp.
- All **roll** and **linear/strafe/vertical** data — keyboard-driven (Q/E, W/A/S/D, Space/Ctrl), not
  mouse, so the mouse-vjoy clamp doesn't apply at all.

## Also still open (unrelated to the clamp, carried over from `YAWCAPTURE.md`)

- ~~Item 4: the actual yaw curve refit~~ — **DONE (2026-07-23, no game/capture needed)**: least-squares
  fit against the full clamp-cleaned yaw dataset (deadzone edge through the 1920 clamp boundary)
  confirms the current model shape (rescaled deadzone + power law), exponent **1.011** (RMS 0.46 °/s),
  `full_range` 1491-1517 (matches the already-used 1500). `axisCurve.ts`'s `DEFAULT_EXPONENT` updated
  1.04 → 1.01. See `MEASUREMENTS.md`'s "Yaw input-curve exponent" section.
- **A separate pitch curve fit — attempted, inconclusive, still open.** Same method applied to
  pitch's 100-1080 dataset does not converge cleanly (noisy single-rep 900/1050 counts fight any
  monotonic curve; fitted `full_range` wants to exceed the confirmed ~1080 saturation point). Needs
  repeat reps at 900/1000/1050 (and ideally 400/500) before a pitch-specific exponent can be
  committed — see `MEASUREMENTS.md`'s "Pitch input-curve exponent" section. No pitch exponent has been
  applied to code.
- Repeat reps for the reversal-transient wobble (item 2) at more magnitudes.
- ~~Measure yaw's own boosted ratio at the corrected clamp-safe 1920 offset~~ — **DONE (2026-07-23)**:
  53.26°/s boosted vs 50.41°/s unboosted at 1920 counts (2 clean reps, corr 0.972-0.975) → ratio
  **1.057×**. Combined with roll (1.18) and pitch (1.096, still single-rep), **all three rotational
  axes now read below the coded uniform 1.2× afterburner multiplier** once measured clamp-clean — see
  `MEASUREMENTS.md`'s "Yaw afterburner ratio — clean redo at the 1920 clamp boundary". Not acted on in
  code (gated, `shipTypes.ts` ported-verbatim).
- ~~Repeat the pitch afterburner boost ratio~~ — **DONE (2026-07-23)**: 2 clean reps each now (non-
  boosted 64.86/64.73, boosted 71.11/66.72) → ratio ~1.064×, closely matching yaw's independently-
  measured 1.057×. See `MEASUREMENTS.md`'s "Pitch afterburner ratio — repeat reps" section, including
  a method note on why dwell needs to be shorter when starting from a re-centered vs. originally-
  biased position, and a cautionary note about a badly-overshot calculated repositioning pulse
  (pitch's own spool τ is still unmeasured — don't reuse roll's 0.2s assumption for it again).
- **Bonus (2026-07-23): full-360° sustained-hold cross-check, all 4 pitch conditions (down/up ×
  non-boosted/boosted).** Independent method (no continuous tracking needed — before/after screen
  position of the sun after ~one commanded revolution). down-nonboost, down-boost, up-nonboost all
  confirmed the short-hold numbers within ~2%.
- **IMPORTANT CORRECTION (2026-07-23): boosted pitch-UP short-hold reps (66.98/62.49) were WRONG —
  under-reading by ~20%.** This project's own API reference (`reference/ships/aegs-gladius.json`) says
  Gladius pitch = 68 unboosted / **82 boosted**. The short-hold reps sat ~18-24% below that — too big a
  gap for noise. Redone via the 360 method (after fixing two real bugs — see below): 2 reps gave
  candidate rates of 79.38/84.54 and 75.25/88.67, both decisively closer to 82 than to the short-hold
  average. **Root cause: a 0.45-0.55s short-hold dwell likely doesn't give boosted pitch enough time to
  finish spooling up before the steady-state window is sampled** — the 360 test's 4.4s hold clears any
  plausible spool constant easily. **Revised estimate: boosted pitch-UP ≈ 77-89°/s, consistent with the
  API's 82.** This raises a real question about whether the boosted pitch-DOWN short-hold reps (68.92)
  are ALSO under-reading — their own 360 cross-check happened to agree (67.82-69.94), but that could be
  coincidental rather than proof the dwell was long enough; worth a skeptical re-check later. Yaw's
  boosted short-hold reps (53.26 at 1920 counts) haven't been checked against a long-hold/360 cross-check
  at all yet, and yaw's own API reference value isn't confirmed in this doc — same concern could apply.
  **Two real methodology bugs found and fixed while chasing this:**
  1. The "before" position for a 360 test must come from the capture's OWN recorded video frame 0, never
     from a live screenshot taken before the capture command — a screenshot taken beforehand can be
     stale by hundreds of pixels by the time the capture actually starts (focus/click + OBS's 1s settle
     both take real wall-clock time). Using a stale seed produced one attempt reading an impossible ~7°/s.
  2. This ship-orientation's view has a **fixed, non-moving bright object at screen ≈(1920,1945)** —
     almost certainly a static HUD/scene element — that an automated "biggest bright blob" landmark
     finder can mislatch onto when the true sun is dim/occluded at that instant. Caught by noticing
     identical-looking blob positions recurring suspiciously across unrelated frames/timestamps.
  See `MEASUREMENTS.md`'s "UP-boosted, redone properly" section for the full writeup, and the two new
  memory entries this produced.
- **MAJOR (2026-07-23): captured the actual spool-up rate-vs-time curve directly for all 4 conditions
  (pitch/yaw × non-boosted/boosted) — the real point of this whole capture effort, per harald's own
  framing (steady-state rates are already known ground truth from the coded/API values; spool-up time
  was the actually-unmeasured piece).** Fit both the coded 1st-order exponential-lag model and a
  2nd-order underdamped step response to each curve. **The 2nd-order model wins by 2-4× in every single
  condition** — this is a real, structural finding: SC's rotational spool-up is underdamped-2nd-order,
  not a simple exponential approach to a clamp. Strikingly, the fitted natural frequency ωₙ is ~8.0-8.6
  rad/s in ALL FOUR conditions regardless of axis/boost — a shared underlying constant, not per-axis
  tuning. Damping (ζ) moves in opposite directions under boost per axis (pitch more damped, yaw less) —
  unexplained but measured. Fitting the FULL curve (not a late/short snapshot) also properly resolves
  boosted pitch (75.75°/s, matching the API's 82 well) and shows boosted yaw's true rate is NOT the
  coded ~62 (looks like an unverified ×1.2 assumption) but closer to ~48.8-53, i.e. yaw's afterburner
  effect on rotation is much smaller than pitch/roll's. See `MEASUREMENTS.md`'s "Spool-up transient is a
  2nd-order underdamped step response" section for the full fit table — this is the strongest
  candidate yet for an actual `flightModel.ts` change (gated, needs explicit go-ahead), since it comes
  with concrete ωₙ/ζ parameters per condition rather than just "something's off."
- **Bonus (2026-07-23): checked the opposite pitch direction ("UP") too.** Non-boosted UP is clean and
  tight (66.78/66.97, both frame-verified) and runs ~3.2% faster than non-boosted DOWN (64.80 avg) —
  each direction's own reps agree far more tightly than that gap, so it looks like a real small UP/DOWN
  rate asymmetry (possibly analogous to the already-confirmed per-direction thrust asymmetry on the
  LINEAR axes), not noise. **Boosted UP could NOT be pinned down** — its 2 reps (66.98, 62.49) straddle
  the non-boosted rate, whereas boosted DOWN's 2 reps both happened to land above it; the ~6-7%
  rep-to-rep spread is consistent between both directions, so this reads as boosted-pitch measurements
  generally carrying that much noise, not a real direction-dependent boost effect. **3+ reps per
  direction would be needed to pin the boosted-pitch ratio tighter than "somewhere around 1.0-1.1."**
  See `MEASUREMENTS.md`'s "Pitch UP direction" section.

**Live-session note:** OBS recorded solid black for the first boosted-yaw attempt this session (both
the +1920 hold and its counter) — confirmed by pulling frames directly from OBS's own output file, not
just the copied trial file. Fixed by the user checking/restarting the OBS capture source; a quick
no-input `obs_capture.py start`/`stop` verification (checking a pulled frame isn't black) before
trusting a real maneuver's recording is now worth doing at the start of any session, since
`mouse_hold_capture.py` doesn't itself detect a black recording.

## Requires the game running (not done this session — SC/OBS weren't up at session start)

- Reversal-wobble repeat reps and the pitch boost-ratio repeat are still open and need a live session
  (OBS is now confirmed working as of 2026-07-23's yaw boost capture). The yaw curve refit was pure
  data analysis against already-recorded video/tabulated results and needed no game session.
