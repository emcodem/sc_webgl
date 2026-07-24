# Yaw / VJoy capture plan

Plan for pinning down the remaining mouse-vjoy mismatch between `sc_webgl` and real Star Citizen,
found via live side-by-side testing (remote-mouse tool, `input/remoteMouseInput.ts` +
`scripts/mouse-capture.py`) with real SC. Written so a fresh session can pick this up without
re-deriving the reasoning below. Companion to `capture/MEASUREMENTS.md` (real, fixed measured
values only — nothing here is a measurement yet, this is the plan to get one) and `SESSION_NOTES.md`.

## Where this came from

Live-tuning the F4 mouse-look sliders against real SC side by side surfaced several findings, in
the order they were found:

1. **The "release doesn't return to center" symptom is NOT display smoothing.** Early hypothesis was
   that SC's on-screen vjoy indicator has its own display-only lag (independent evidence for this
   existed: `BLUEPRINT.md`'s 1Hz-sweep finding, indicator showing only ±110px of its true ±643px
   travel at speed). **Ruled out**: when SC's indicator reads exactly zero, SC's ship has *also*
   fully stopped yawing at that same instant — the indicator is an accurate readout of the real,
   flight-relevant stick value, not a separately-smoothed display. Same on our side (no smoothing
   anywhere in our own code — verified by reading `mouseLook.ts`/`remoteMouseInput.ts`/
   `mouse-capture.py`/`mouse-capture-server.mjs`/`hud.ts` line by line).
2. **So the mismatch is positional/gain, not time-domain.** The same offset gap shows up whether
   releasing slow or fast (slow: SC lags behind reaching center; fast: we overshoot past center
   before SC arrives) — consistent with a *fixed* discrepancy between the two games' accumulated
   stick position for the same raw mouse motion, not a lag that would scale with release speed.
3. **Deadzone and gain are coupled, not independent knobs.** `axisCurve.ts`'s `shapeAxis` applies
   the deadzone as `dz_fraction × fullDeflectionCounts` — so the deadzone's *absolute* raw-count
   threshold moves whenever the gain constant is changed, even if the displayed percentage doesn't.
   Live-tuning gain from 1500 to ~1700 (chasing a full-deflection *indicator* visual match) broke
   the deadzone match at the old 4.45%; recomputing a compensating ~3.93% restored it — because both
   percentages, against their respective denominators, land on the same real ~66.8-count threshold.
4. **But the indicator's own "100%" may not share the flight model's "100%" reference at all** —
   the same way `VJoyAnglePilots` is already confirmed to affect indicator size with *zero* effect
   on yaw rate (`MEASUREMENTS.md`). Direct evidence: after tuning gain to ~1700 to make the
   *indicators* line up, yaw rate at a given vjoy offset was measurably faster in SC than in
   `sc_webgl` — i.e. matching the indicators may have detuned the actual flight-relevant gain away
   from the originally, properly-measured 1500 (fit directly from real yaw-rate data, not
   indicator-watching).

None of the numbers above (1700, ~3.93%) are trustworthy measurements — they were live-tuned/eyeballed,
not fit from synchronized data. Current F4 defaults remain the original measured values
(`fullDeflectionCounts=1500`, mouse deadzone 4.45%, exponent 1.04) pending the real measurement below.

## What needs measuring — two separate things

The open question splits into two independent mappings that together make up the whole input
pipeline, and conflating them is exactly what caused point 4 above:

- **A. Raw mouse count → stick position (gain).** Does `fullDeflectionCounts` (and the deadzone
  computed against it) correctly reproduce SC's real stick position for a given amount of raw mouse
  motion? Tested via the **vjoy indicator**, since it's a direct, accurate readout of the real stick
  value (per finding 1 above) — no yaw-rate/flight-model involvement needed to test this half.
- **B. Stick position → yaw rate (response curve).** Given a known, held stick position, does the
  ship actually rotate at the same rate in both games? This is the original, already-validated
  measurement method (`MEASUREMENTS.md`'s dense 150-2100 count sweep, sun-tracked) — re-run/spot-checked
  here as a cross-check, independent of whatever A finds.

## Tooling built for A (2026-07-21 session)

Chose **video, not screenshots** — a held-offset screenshot staircase only gives a handful of manual
points; a continuous recording gives a dense curve in one pass, and if the recording is driven by a
repeatable scripted waveform there's no need to catch a "good moment" by hand at all.

Chose **two independent recordings + existing sync-onset alignment, not one dual-window video** —
reuses more already-validated tooling (SC's indicator tracking is exactly `track_vjoy_indicator.py`
+ `mouse_feeder.py oscillate`, unmodified) and gets EXACT ground truth on our own side (no optical
tracking needed for our own indicator at all, since it's our own code).

- **`src/debug/vjoyRecorder.ts`** + `window.__vjoyLog.start()`/`.stop()` console hook (wired into
  `main.ts`, sampled every frame). Records raw `offsetX`/`offsetY` over time, downloads a CSV
  (`t,offsetX,offsetY`) on stop. Dev-only, not a player-facing feature.
- **`capture/analysis/compare_vjoy_curve.py`** (new). Reads our CSV + SC's `indicator.csv` (from the
  existing `track_vjoy_indicator.py`), aligns the two independently-clocked recordings via
  `sync_detect.py`'s `detect_motion_onset` (reused, not duplicated — found each side's own onset,
  no simultaneous-capture requirement), converts SC's tracked pixels to a normalized stick ratio via
  the already-validated pinhole/FOV formula (`f = (width/2)/tan(FOV_h/2)`, `ratio = arctan(pos/f) /
  radians(vja)`), then fits `sc_webgl`'s true full-deflection raw-count gain by least squares.
- **Validated against synthetic ground-truth data before trusting it on anything real** (see the
  script's own docstring/CLI help): a fabricated pair of recordings with a known true gain (1650),
  independent clocks, different frame rates, and realistic noise. First pass caught a real bug —
  `sync_detect.py`'s default `hold_frames=3` false-triggered on noise alone, desyncing the traces
  and producing a garbage fit (1409.8 vs the true 1650). Raising to `hold_frames=8` (now a tunable
  `compare_vjoy_curve.py` CLI flag, default 8, documented with this finding) recovered the fit
  essentially exactly: 1649.5 vs true 1650.0, RMS 8.1 counts.
- Documented in `capture/README.md`'s pipeline listing under "VJoy indicator gain cross-check".

## Procedure to run A for real

1. Set SC's `VJoyAnglePilots` to a known value (e.g. 10, matching recent testing) and note SC's
   actual capture resolution/FOV.
2. Browser console: `__remoteMouseInput(true)`, then `__vjoyLog.start()`.
3. Start recording SC's screen (OBS/ffmpeg, as in every other capture in this project).
4. `python capture/feeder/mouse_feeder.py oscillate yaw --period 8 --amplitude 1800` (or similar —
   slow enough to sweep past full deflection and back over a few cycles).
5. Stop the feeder, stop SC's recording, `__vjoyLog.stop()` in the browser (downloads the CSV).
6. `python capture/analysis/track_vjoy_indicator.py <sc_video> --f0 0.125` (= 1/period) → `indicator.csv`.
7. `python capture/analysis/compare_vjoy_curve.py --ours <vjoy-log.csv> --sc indicator.csv --axis x --vja 10 --fov 116 --width <capture width>`.

Output is a real, reproducible `full_range` number — worth writing into `MEASUREMENTS.md` once
obtained (not before; live-tuned guesses don't belong there, only this kind of fitted result).

## Procedure to run B (cross-check, reuses existing method)

Same as `MEASUREMENTS.md`'s original dense-sweep method (`mouse_hold_capture.py`/
`curve_sweep_capture.py` + sun-tracked `hold_rate.py`) — hold a fixed raw-count offset, read SC's
steady-state yaw rate off the tracked landmark, and compare directly against `sc_webgl`'s own
computed yaw rate at that same held offset (read directly from the running app/HUD, no tracking
needed on our side). Re-run at whatever `full_range` A comes back with, to confirm the two halves
of the pipeline (gain and response curve) agree end to end.

## Decision point once both are measured

- If A confirms 1500 was already correct, and B still shows a yaw-rate mismatch → the indicator
  visual difference is cosmetic-only (like `VJoyAnglePilots` already is), nothing to change.
- If A gives a different `full_range` → update `fullDeflectionCounts`'s default in `mouseLook.ts`
  (and re-derive the deadzone default alongside it, since they're coupled — see point 3 above),
  backed by the fitted number, documented in `MEASUREMENTS.md`.
- If A and B disagree with each other → the two mappings (gain, response curve) don't compose the
  way assumed, and needs a fresh look before touching either constant.

## RETRACTED (2026-07-23): the "A" indicator-gain cross-check's result is unreliable — do not use or re-quote it

This section previously reported a specific fitted full-range count from `compare_vjoy_curve.py` and
explained it away as a real-but-separate "indicator-only" scale, unrelated to the flight-relevant B
side. That explanation is now considered unsound: 2026-07-23 found that SC's mouse-vjoy accumulator
hard-caps at **half the capture resolution in pixels, per axis** (see `MEASUREMENTS.md`'s top-of-file
CRITICAL note), and a capture like "A" — sweeping the mouse through a wide oscillating range to fit the
indicator's own gain — has no guard against driving past that clamp. Once past it, the same
overshoot/desync mechanism documented for pitch applies, and a least-squares fit against a desynced
trace can produce a large, plausible-looking but meaningless number. Since the specific run behind A's
old result can't be re-verified against the clamp after the fact, **the number is retracted rather than
corrected** — treat the indicator's true full-scale gain as **unmeasured**, not as some large distinct
constant. If this cross-check is ever redone, keep every driven amplitude under the resolution-derived
clamp (half-width for yaw, half-height for pitch, at whatever resolution is actually captured) and
re-validate against the synthetic ground-truth test first, same as before.

B (real yaw rate, sun-tracked, no indicator involved) is unaffected by this retraction and remains the
only side that matters for `fullDeflectionCounts`/the input curve — it was extended far beyond the
original ask into a dense 25-2200 count sweep — see `MEASUREMENTS.md`'s "Gladius mouse yaw — dense
deadzone-to-saturation sweep — 2026-07-22" and the reversal-transient section right after it for the
full data (though note per the clamp finding, B's own 2000/2200 rows also sit past yaw's ~1920 clamp
and aren't independent points beyond it — see `handoff.md`).

### Conclusion: keep the current approach, but its calibration is confirmed wrong and only partially refit

The current model (`mouseLook.ts` + `axisCurve.ts` + `flightModel.ts`) is: an accumulating raw-count
stick position, clamped at `fullDeflectionCounts`, a rescaled deadzone, a power-law expo curve
(`sign(v)*|v|^exponent`), scaling a per-ship `maxAngVel`, approached via a first-order-lag (exponential
drag) integrator. Point by point, against today's data:

- **Deadzone + rescale structure: confirmed right.** 25 and 50 counts read exactly 0 in real SC; 100
  and above don't — a clean threshold between 50-100, matching the existing `4.45% of ~1500 ≈ 66.75`
  model almost exactly. No reason to change this piece.
- **`fullDeflectionCounts ≈ 1500`: still a reasonable anchor, not disproven.** 1500's measured rate
  (50.8°/s) is the highest of any point sampled, consistent with it being at or very near the real
  saturation point.
- **The expo curve's exponent (currently 1.04, i.e. near-linear): CONFIRMED WRONG.** Today's dense
  100-1500 sweep shows per-count sensitivity rising 6.5× across that range — clearly convex, not the
  near-linear shape the 2026-07-21 fit concluded (that fit only had dense data at 1200+, already near
  the top of the curve, and extrapolated the shape backward incorrectly). A higher exponent (or a
  different curve family entirely) is needed, but **no refit has been done yet against the new data.**
- **Whether a single monotonic curve is even the right SHAPE is now in question.** 1800 and 2200 came
  in slightly *below* 1500 (49.0 and 45.5 vs 1500's 50.8) rather than climbing further or plateauing
  flat. A power-law or Kumaraswamy curve — the two shapes already tried — can only ever increase
  monotonically to a flat ceiling; neither can produce a peak-then-slight-decline. If this holds up,
  the model FAMILY (not just its parameters) may need to change for the top end of the range — but
  this rests on single, unrepeated readings at 1800/2200, explicitly flagged preliminary.
- **The first-order-lag transient (spool/reversal shape): open question, not yet contradicted or
  confirmed.** Both a fast and a slow reversal showed a ~1-1.5s settling wobble (~±0.5-1°/s ringing)
  after reaching the new steady rate. A simple exponential-drag approach (what's coded) can't produce
  that kind of ringing on its own — but this is a single run each, could plausibly be a
  landmark-tracking artifact rather than real ship behavior, and hasn't been checked against a static
  control clip. Not acted on.

**Bottom line: don't dump the current architecture.** Its basic shape (accumulator → deadzone →
power-curve → per-ship max rate → lag) is still the right kind of model, and the deadzone piece and
the ~1500 anchor both hold up. What's confirmed broken is the **exponent value**, and what's *open* is
whether the curve needs a fundamentally different (non-monotonic, or piecewise) shape past ~1500, and
whether the angular response needs a higher-order (not first-order) transient model. Neither open
question should be resolved by guessing — both need more data first (see below) before any code change
beyond, eventually, the exponent.

### What more data is needed before making any code change

1. **Repeat 1500/1800/2200** (plus maybe 1300/1600/2000 to fill in) with multiple reps each — currently
   1-2 samples per point, not enough to trust a peak-then-decline over measurement noise.
2. **Validate the reversal-transient wobble against a static (non-rotating) control clip** — same
   tracking method, ship held still — to rule out a tracking-method artifact before treating the
   ringing as real ship behavior.
3. **A pitch sweep**, at least a few points, to check whether the OLD assumption ("same curve shape,
   different per-axis max rate") still holds once the yaw curve itself is refit — that assumption was
   built on the now-superseded near-linear shape.
4. Only then: a proper curve fit (of whatever shape the confirmed data actually supports) against the
   full dataset, THEN update `axisCurve.ts`'s `DEFAULT_EXPONENT` (and reconsider whether a single expo
   curve can represent the fitted shape at all) — `fullDeflectionCounts` itself does not need to change.

### Working theory going into the next session (2026-07-22, unconfirmed — harald's hunch)

The 1500→1800→2200 peak-then-decline is suspected to be a **measurement artifact from the rushed,
very-short-dwell isolated probes** (0.3-0.35s dwell, tight skip windows), not real ship behavior —
i.e. probably just a normal monotonic curve up top after all, and repeat #1 above will likely show it
flattens rather than declines. Separate hunch, also unconfirmed: the convexity seen at the LOW end
(deadzone edge to ~500) might not be an artifact at all but **intentional** — SC may shape the curve
there specifically to make fine, granular small-movement aiming possible near center, which would argue
for treating the low-end shape and the high-end shape as two different regions rather than expecting
one exponent to fit the whole thing. Both ideas are theories to test against the repeat data, not
conclusions — continuing measurement next session.

## Item 1 DONE (2026-07-22): repeat of 1300/1500/1600/1800/2000/2200 — no peak-then-decline

2 reps each, isolated single-direction probes with a scripted re-center between trials (stop the
stick, wait for the ship's angular velocity to actually decay, then drive the inverse offset — see
`MEASUREMENTS.md`'s "Repeat of 1300-2200 with multiple reps" for the full table and method notes).
**Confirms harald's hunch: the peak-then-decline was a rushed-probe artifact.** 1600-2200 all read
~50-51 °/s, same as 1500 within noise — the curve plateaus flat past ~1500, it does not decline.

## Item 2 DONE (2026-07-22): reversal wobble vs. static control clip — it's real, not a tracking artifact

Captured a static (non-rotating) control clip with the same sun-tracking pipeline and compared its
noise floor (a ~4s-period, ±0.15-0.2°/s idle-camera sway, plus rare isolated <2-frame glitch spikes)
against a corrected re-analysis of the original fast/slow reversal clips (the first re-analysis attempt
skipped `hold_rate.py`'s sync-alignment step and produced nonsense — see `MEASUREMENTS.md`'s "Reversal-
transient wobble vs. a static control clip" for the full writeup and the fix). With proper alignment,
both reversals show a real, multi-cycle, ~1-2°/s, ~1-2s-duration ringing — the fast case is a textbook
underdamped 2nd-order step response (overshoot/undershoot/overshoot/settle). Amplitude and duration are
both well above the static baseline's noise floor, so **this is a genuine flight-model transient, not
measurement noise** — worth eventually modeling as a higher-order response rather than the current
simple first-order exponential-lag, though that's a `flightModel.ts` equation-family change needing an
explicit go-ahead, not a data task. Still only one rep each (fast/slow) and only tested at 300 counts —
a repeat + a check at larger magnitudes would firm up the exact shape.

## Item 3 DONE (2026-07-22): pitch sweep — "same curve shape, different max" does NOT hold, and pitch's real full-deflection point is ~1080, not ~1500

A real, sun-tracked pitch sweep (100 through 1050 counts) shows the pitch/yaw ratio at matching offsets
starts at **6.27×** (100 counts) and falls to ~1.76× by 1000 — still well above the established
max-rate ratio (**1.19×**) — see `MEASUREMENTS.md`'s "SUPERSEDED" note under the original pitch
conclusion for the full table. The two axes share the same basic structure (deadzone → convex rise →
plateau) but pitch rises far more steeply relative to its own ceiling over most of the range — **not a
simple rescale of yaw's curve.** This overturns the original 2026-07-19 conclusion ("no pitch-specific
tuning needed"), which only ever compared the two axes' plateau, never the shape.

**Bonus finding, resolves the side-finding below too: pitch's actual full-deflection point is ~1080
counts, noticeably lower than yaw's ~1500 — a second way the axes differ, not just curve shape.** Found
by live-observed bisection (single trials at 1000/1050/1060/1070/1075/1079/1080/1085, watched in-game,
not analyzed from footage): held offsets at or below ~1080 release back to 0 cleanly; above that, the
release visibly overshoots into a brief reverse rotation. Mechanism (harald's read): past true full
deflection, extra mouse movement no longer changes flight rate, but the raw stick position keeps
moving anyway, so reversing "by the same commanded amount" overshoots true center by however far past
saturation the drive went. This also fully explains the side-finding previously logged here as
unresolved — it wasn't a fast-ramp/input-injection artifact, it was simply driving past saturation.
**Practical takeaway: don't probe pitch above ~1080 counts** — readings at 1100/1200/1500 (kept in
`MEASUREMENTS.md` but marked discarded) are contaminated by exactly this overshoot and taught nothing
about the real curve.

Data quality caveats: the 100-900 rows are single reps (no repeats yet, unlike yaw's item-1 redo). A
repeat with more reps would firm up the exact shape, but the core conclusions — pitch needs its own
curve, not yaw's rescaled, and its full-deflection point is ~1080 not ~1500 — are solid.

Item 4 (the actual curve refit + `DEFAULT_EXPONENT` update) can now proceed for **yaw**, since both the
top-end shape (item 1) and the transient-reality question (item 2) are resolved for that axis — only
the low-end (deadzone-to-1500) convexity shape remains to be fit. **Pitch is a separate, still-open
fitting task**, now scoped to its own ~1080-count saturation point rather than yaw's ~1500.

## Item 4 DONE for yaw (2026-07-23) — pitch attempted, inconclusive

Least-squares fit of the current model (rescaled deadzone + power-law exponent) against the full
clamp-cleaned yaw dataset (dense 100-1500 sweep + 1300-1800 repeats + the 1920 clamp-boundary check)
gives exponent **1.011**, `full_range` 1491 (RMS 0.46 °/s) — confirms the model shape, no different
curve family needed, and resolves the "6.5× per-count sensitivity rise" as mostly a deadzone-rescaling
effect rather than real convexity. `axisCurve.ts`'s `DEFAULT_EXPONENT` updated 1.04 → 1.01.

The same fit attempted on pitch's dataset (100-1080 counts, from "PITCH curve shape" above) does NOT
converge cleanly — noisy single-rep readings at 900/1050 counts dip below their neighbors in a way no
monotonic curve can reproduce, and the fitted `full_range` wants to exceed the independently-confirmed
~1080 saturation point. **Pitch needs repeat reps (900/1000/1050 at minimum) before a pitch-specific
exponent can be committed to code** — see `MEASUREMENTS.md`'s "Pitch input-curve exponent" section for
the full writeup. This is the one remaining piece of the original YAWCAPTURE.md plan still open.
