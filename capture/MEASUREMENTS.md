# Measurements — confirmed values

Table of measured values only. For **how to measure** anything here (tool usage, capture recipes,
setup steps, known pitfalls), see `BLUEPRINT.md`. For the full narrative reasoning/derivation behind
any row (why a method was chosen, what was tried and discarded, session-by-session detail), see
`MEASUREMENTS_ARCHIVE.md` — every row below links back to the archive section it came from.

**Status column:**
- **CONFIRMED** — reproducible, current best value, no known open confound.
- **SUSPECT** — needs re-verification. As of 2026-07-26, this applies to essentially every
  rotation/thrust-dependent number below (see the box directly under this line) — check the Notes
  column before trusting a SUSPECT row for anything beyond a rough ballpark.

---

## ⚠ Standing confound: engine power-triangle allocation (since 2026-07-26)

Power-triangle allocation (how much power is routed to engines vs weapons/shields) was **never
tracked or controlled in any capture session before 2026-07-26**, and turns out to materially change
thrust/rotation output: a boosted-pitch 360°-sustained-hold test read ~73.7°/s at whatever power
allocation was the session default, vs **81.98°/s** (matching the coded 82°/s almost exactly) once
engines were confirmed at full power — not explainable as ordinary rep-to-rep noise (see the Pitch
table below). Every rate/thrust/accel/decay-time value in this file predates that fix and should be
treated as **suspect, possibly reading low**, not settled — pure input-mapping findings (curve
shape, deadzone %, clamps, cosmetic settings) don't depend on thrust output and are unaffected.
`settings_checklist.md` now mandates confirming full engine power before every capture.

**Recapture progress (2026-07-26/27):** Pitch UP and DOWN boosted steady-state rate are now CONFIRMED
at full power (~81.7-82.0°/s both directions, cross-validated across 2-3 independent methods each —
see the Pitch table). The 2nd-order spool-up shape (ωₙ/ζ) at full power also now has a first
converged reading for both directions (ωₙ ~9.5-10.3 rad/s, notably above the non-full-power ~8.0-8.6
band — see the spool-up table), though single-rep and noisier than ideal. **Priority 2 (afterburner
ratios, all 3 rotational axes) is now fully done**: roll (1.199×), pitch (1.190×), and yaw (1.188×,
recaptured 2026-07-27 with a shortened dwell — see Yaw table) are all CONFIRMED and land almost
exactly on the coded 1.2×. All three ratios close substantially versus their non-full-power values
(1.18×/1.06×/1.057×) — full power was masking a real, uniform ~1.2× afterburner effect across every
rotational axis. **Priority 4 (all linear thrust/speed rows) is now fully done** (2026-07-27, see the
Linear table) — every axis/direction (fwd/back/lateral/up/down accel+coast, boosted lateral/vert-up,
boosted forward/retro top speed + release decay) reconfirmed at full power. Unlike boosted rotation,
**linear thrust/speed turns out to be largely power-triangle-INsensitive** — every full-power value
lands within ~2-5% of its old unconfirmed-power reading, not the ~11% jump boosted pitch showed.
Still open: non-boosted rotational baselines for roll/yaw (pitch's is now done, handoff.md's old
Priority 3).

---

## Rotational rates — Roll (Gladius, keyboard Q/E via bound vJoy device)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Non-boosted, steady rate | ±202°/s (Q +201.6/+194.8, E −202.5/−209.4) | `roll_hold_capture.py` + `track_orientation.py`, 3s holds | 4 | 2026-07-19 | SUSPECT | Matches coded 199.96°/s to <2%. [Archive §"Gladius ROLL"](MEASUREMENTS_ARCHIVE.md) |
| Boosted, steady rate | +234.7 / −237.1°/s | same, boost held | 1 seq | 2026-07-19 | SUSPECT | Matches coded 240°/s to ~2%. |
| Afterburner ratio | 1.18× | derived | — | 2026-07-19/23 | SUSPECT | Closest of 3 rotational axes to coded 1.2×. |
| **Non-boosted, steady rate, full power** | **199.6°/s** (Q 199.88/200.16, E −198.28/−200.11) | `roll_hold_capture.py` + new `track_roll_twopoint.py` (bearing between 2 tracked landing-pad landmarks — see method note below), 3s holds | 2 | 2026-07-26 | CONFIRMED | Matches coded 199.96°/s almost exactly. Both directions, both reps tightly agree (std ≤11°/s per window). |
| **Boosted, steady rate, full power** | **239.4°/s** (Q 239.61/239.09, E −239.40/−239.51) | same | 2 | 2026-07-26 | CONFIRMED | Matches coded 240°/s almost exactly. Very tight rep-to-rep agreement. |
| **Afterburner ratio, full power** | **1.199×** | derived | 2×2 dir | 2026-07-26 | CONFIRMED | Essentially exact match to the coded 1.2× — the gap in the non-full-power row above closes almost completely once power is controlled. |
| Decoupled vs Coupled | same hard-stop ~0.6s release either mode | same | 1 | 2026-07-19 | CONFIRMED | Structural: decoupled only drops the linear auto-brake, not rotational behavior. |
| Spool-up τ (drag-like fit) | τ≈0.20s | fit vs governor-ramp alt | few | 2026-07-19 | SUSPECT | Below coded 0.28s — real vs tracker bias unresolved. Gated (flightModel.ts ported-verbatim). |
| Release/coast-down | hard stop ~0.5s, ~40° roll-out | same | few | 2026-07-19 | SUSPECT | Less than exponential-drag's predicted 56° — open question. |
| Reversal fit (device-path) | thrust=7.35-7.44, drag pinned at 0.00 | `fit_model.py` | 4 of 5 | 2026-07-18 | SUSPECT | One trial excluded, root cause never diagnosed. |
| 360°-check shortfall (device-path) | mean −0.76° (−0.91/−0.78/−0.58°) | before/after screenshot | 3 | 2026-07-18 | SUSPECT | All 3 same sign — possible tiny real undershoot or timing bias. |
| **Partial-input steady rate, full power** | 3%→~0.75°/s; 5%→~4.9°/s; 10%→~15.3°/s; 20%→~49°/s (peak); 25%→~61°/s (peak); 50%→~121°/s (peak); 100%→~178°/s (peak) | new `roll_vjoy_capture.py` (analog vJoy axis Z, not Q/E) + `track_landmark.py`/`angle_convert.py --axis roll`, single off-center star/moon landmark, bounded alternating-sign sequence (each magnitude held then immediately counter-held, to keep cumulative rotation from sweeping the landmark behind the cockpit frame — see Gotcha note below) | 1 sweep | 2026-08-02 | SUSPECT | 20-100% holds were short (0.5-0.7s, ~80-90% settled) to stay within the safe rotation budget — peaks read slightly low vs true steady-state. **Strongly non-linear vs raw input**: 3%/5%/10% read only ~12%/49%/77% of the ported model's pure-linear prediction (`ω=u·maxAngVel.roll`), i.e. a real deadzone/expo-like suppression at low throw; 20-50% read ~20-40% ABOVE the linear prediction; 100% converges back to the already-CONFIRMED 199.6°/s row. `flightModel.ts` currently applies rollInput linearly with no curve — this contradicts that. Gated (curve shape not yet fit to `gladius.ts`). |
| **Release/coast at partial input, full power** | 3/5/10%: unmeasurably fast, roll-out <0.2° (noise floor). 20%: 49→0°/s in 0.23s, **5.4° roll-out**. 25%: 61→0°/s in 0.28s, **7.4° roll-out**. 50%: 121→0°/s in 0.38s, **15.9° roll-out**. 100%: 178→0°/s in 0.52s, **35.8° roll-out** | same, per-frame resolution (corrected — an initial pass at 0.1s sampling wrongly read 20-100% as instant too; only 3-10% actually are) | 1 sweep (7 magnitudes) | 2026-08-02 | CONFIRMED | **Contradicts the coded constant-decel model at partial input.** `rollReleaseDecel=8.7234 rad/s²` (500°/s², fit from a single full-rate measurement — "~40° roll-out from 200°/s") predicts roll-out=v²/1000: 2.4°/3.7°/14.6°/31.5° for 20/25/50/100%. Real roll-out is ~2.3×/2.0× the prediction at 20%/25%, converging to ~1.1× (close) by 50-100%. **The governor's fixed decel rate only matches real SC near full deflection — at partial roll input, real SC coasts out noticeably farther than the ported model currently allows**, which is the visible "slight roll-out on release" the user reports seeing in-game and the sim currently doesn't reproduce at partial stick. Not yet applied to `gladius.ts` (single-sweep data, no reversal-decel model fit yet — needs a rate-dependent decel curve, not a bigger constant, to fix both ends of the range at once). |
| **Reversal-leg peak vs fresh-start peak (same duration)** | 50%L→50%R: leg2 ~54°/s vs fresh-start-50% ~121°/s (~45%); 50%L→100%R: leg2 ~114°/s vs fresh-start-100% ~178-200°/s (~57-64%); 100%L→50%R: leg2 ~50-58°/s (noisier capture, partial lock loss) | `roll_vjoy_capture.py`, short (0.4-0.7s) opposite-sign hold pairs, single off-center landmark | 3 transitions, 1 rep each | 2026-08-02 | SUSPECT | Directionally consistent with the EXISTING first-order roll ODE (`flightModel.ts`) run with no code change: a reversal's exponential relaxation starts from the opposite-sign rate, so part of the hold cancels the old spin before net progress in the new direction — this alone predicts a lower same-duration peak than a fresh start, matching what was measured. Roll needs no special reversal branch the way pitch/yaw do. Not yet checked for exact quantitative fit; one clip (100%L→50%R) lost tracking lock partway through the fast leg, reducing confidence. |
| **Gotcha: tracked landmark can cross behind the cockpit frame** | Corrupts the reading once cumulative rotation from a screen-fixed start exceeds roughly ~90° | observed directly (magnitude-sweep first attempt, all-same-sign, and the direction-change clips' initial attempt) | — | 2026-08-02 | CONFIRMED | Same class of gotcha `roll_reversal.json` already documented for the elongated-landmark method — now confirmed for single-point tracking too. A same-direction run of holds (no counter-rotation) swept a tracked star behind the screen-fixed canopy strut, after which the tracker locked onto the fixed strut/HUD instead and read near-zero garbage for everything after. Fix: alternate sign (or keep individual holds short) so cumulative rotation stays bounded near the start attitude. |

## Rotational rates — Pitch (Gladius, mouse vjoy)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| DOWN, non-boosted | 64.80°/s (64.86/64.73) | `mouse_hold_capture.py`, 1080 counts | 2 | 2026-07-23 | SUSPECT | <0.2% apart. |
| DOWN, boosted (short-hold) | 68.92°/s (71.11/66.72) | same | 2 | 2026-07-23 | SUSPECT | ~6.4% apart. |
| UP, non-boosted | 66.88°/s (66.78/66.97) | same | 2 | 2026-07-23 | SUSPECT | <0.3% apart — ~3.2% faster than DOWN, flagged as a possibly-real small asymmetry. |
| UP, boosted (360-test) | ~77-89°/s (79.38/84.54, 75.25/88.67) | full-360 before/after | 2 | 2026-07-23 | SUSPECT | Supersedes an earlier short-hold reading (66.98/62.49) that under-read badly. |
| **UP, boosted, full engine power confirmed** | **81.98°/s** (residual 0.166°) | 360-sustained-hold, 2 laps, `centroid_in_window` | 1 | 2026-07-26 | CONFIRMED* | *Single rep — matches coded/API 82°/s almost exactly. The reference point that surfaced the power-triangle confound; treat as most-trusted current boosted-pitch value but repeat before fully final. |
| UP, boosted, full power — 2nd corroboration | 81.67°/s (model-free peak) | `mouse_hold_capture.py` 1080 counts + `fit_spool_response.py`'s pre-fit peak-rate read | 1 | 2026-07-26 | CONFIRMED | Independent capture/method, same session — corroborates the 360-test row above to <0.4%. 2nd-order curve fit on this same clip did NOT converge (see spool-up table note below); only the model-free peak rate is trustworthy from this trial. |
| UP, boosted, full power — 360 repeat, margined | ~80.4°/s (range 79.8-81.1 depending on T0-fit precision) | 360-sustained-hold, 2 laps + 2s extra dwell, crossing-time method (exact video-time the sun re-crosses its starting pixel row, vs. a fixed-T residual read) | 1 | 2026-07-27 | CONFIRMED | Redone with 2s extra dwell margin so the sun's return is comfortably mid-clip instead of in the last 1-2 frames (the marginal 2026-07-26 repeat below). Within ~2% of the 81.98°/s reference — confirms it, doesn't contradict. |
| UP, boosted, full power — 360 repeat (marginal, superseded) | ~80.9-83.1°/s (residual ~9.8°, sign ambiguous) | 360-sustained-hold, 2 laps | 1 | 2026-07-26 | SUSPECT | Dwell (8.78s = exactly 2 laps at nominal 82°/s) cut it too close — the sun only re-enters frame in the recording's last 1-2 frames. Superseded by the margined repeat above. |
| **DOWN, boosted, full engine power confirmed** | **80.47°/s** (model-free peak) | `mouse_hold_capture.py` 1080 counts + `fit_spool_response.py`'s pre-fit peak-rate read | 1 | 2026-07-26 | CONFIRMED* | *Single rep, first full-power DOWN measurement (previously untested) — matches UP's full-power reads (81.67-81.98°/s) and the coded 82°/s closely. 2nd-order curve fit on this clip did NOT converge (see spool-up table note below). |
| DOWN, boosted, full power — 360 attempt (invalidated, superseded) | inconclusive | 360-sustained-hold, 2 laps + buffer | 1 | 2026-07-26 | — | Invalidated: a station/structure visible in this AC instance sits near the expected return position and its lights contaminated the landmark search. Superseded by the relocated redo below. |
| **DOWN, boosted, full power — 360 redo** | **~81.1°/s** (range 80.6-81.6) | 360-sustained-hold, 2 laps + 2s dwell margin, relocated to empty space, crossing-time method (same as the UP margined repeat) | 1 | 2026-07-27 | CONFIRMED | Sun re-crosses its exact starting pixel row at video t≈10.298s; T0=1.42s (corr=0.944). Matches the established 80.47-81.98°/s full-power cluster (UP and DOWN) closely — resolves the prior station-contamination invalidation. |
| Afterburner ratio, DOWN | 1.064× | derived | 2+2 | 2026-07-23 | SUSPECT | |
| Afterburner ratio, UP | inconclusive, "probably 1.0-1.1" | derived | 2 | 2026-07-23 | SUSPECT | Not pinned down even setting the power confound aside. |
| **UP, non-boosted, full power** | **68.75°/s** (69.01/68.49) | `mouse_hold_capture.py`, 1080 counts, seeded near top of frame — see gotcha below | 2 | 2026-07-26 | CONFIRMED | Tight agreement (<1% apart). Close to the non-full-power UP row (66.88°/s) — non-boosted pitch looks much less power-sensitive than boosted. |
| **Afterburner ratio, UP, full power** | **1.190×** | derived (68.75 vs 81.7-82.0 boosted-UP average) | 2 (non-boost) | 2026-07-26 | CONFIRMED | Much closer to the coded 1.2× than the non-full-power reading — resolves the "inconclusive" row above. |
| Radar-cone HUD gotcha (pitch specifically) | tracker false-locks once the landmark nears screen y≈1470-1490 (the radar/scan-cone graphic's screen position), well before any real physical limit | discovered while redoing this row | — | 2026-07-26 | — | Matches `BLUEPRINT.md`'s own documented warning ("seed well above center, ~25% margin from top") — a centered seed doesn't leave enough clean travel room for non-boosted pitch (slower to settle) before hitting it. Cost 3 redone captures before catching. |
| Full-deflection point | ~1080 counts | live bisection (1000-1085 probes) | several | 2026-07-22 | CONFIRMED | This IS the accumulator hard-clamp (half of 2160 capture height) — resolution-dependent, re-derive at other resolutions. |
| Input-curve exponent | NOT confirmed (fit pinned to bound, RMS 2.11°/s) | least-squares vs yaw's model | single-rep 100-1080 | 2026-07-23 | — | Not applied to code. Needs repeat reps at 900/1000/1050/400/500 before any number is usable. |

## Rotational rates — Yaw (Gladius, mouse vjoy)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Non-boosted plateau | 50.4-51.27°/s (flat 1500-1920) | dense sweep + repeat probes | many | 2026-07-22/23 | SUSPECT | Curve monotonic-to-flat from deadzone through 1500; earlier apparent "peak then decline" was a measurement artifact, resolved. |
| Boosted (at 1920 clamp) | 53.26°/s (53.29/53.22) | `mouse_hold_capture.py --boost` | 2 | 2026-07-23 | SUSPECT | Tight agreement. |
| Afterburner ratio | 1.057× | derived | 2 | 2026-07-23 | SUSPECT | Not cross-checked against API reference. |
| **Non-boosted, full power** | **50.95°/s** (51.10/50.79) | `mouse_hold_capture.py`, 1700 counts (at the established plateau, unlike the 1080-count undershoot tried first — see note below) | 2 | 2026-07-26 | CONFIRMED | Matches the non-full-power plateau (50.4-51.27°/s) closely — yaw's non-boosted rate looks power-insensitive. |
| **Boosted, full power** | **60.52°/s** (61.68/58.61/61.26, std 1.36) | same, 1700 counts, `--boost`, 0.7s dwell | 3 | 2026-07-27 | CONFIRMED | Root cause of the old noisy/fragmented reads found: NOT a focus-interruption problem — the star was genuinely running off the right edge of frame mid-hold (yaw is fast enough that a 1.5s dwell drove it past the 58° half-FOV boundary). A shortened 0.7s dwell keeps it in-frame the whole hold; all 3 reps tracked cleanly (corr 0.85-0.97, zero LOST flags). |
| **Afterburner ratio, full power** | **1.188×** | derived | 3 boost / 2 non-boost | 2026-07-27 | CONFIRMED | Matches roll (1.199×) and pitch (1.190×) closely — confirms the near-uniform ~1.2× afterburner multiplier across all 3 rotational axes at full power. |
| 1080-count undershoot (method note) | at 1080 counts (below yaw's ~1500 full-deflection point) non-boosted yaw reads only ~36-37°/s | `mouse_hold_capture.py`, discovered while starting this row | 2 | 2026-07-26 | — | Not a bug — 1080 is comfortably past pitch's own clamp but well short of yaw's own ~1500-count plateau, so a proportionally lower, curve-shaped rate is expected. Redone at 1700 counts for a fair comparison (rows above). |
| Input-curve exponent | **1.011** (RMS 0.46°/s), full_range=1490.8 | least-squares, 15-pt clamp-cleaned dataset | 15 pts | 2026-07-23 | CONFIRMED | Applied: `axisCurve.ts` DEFAULT_EXPONENT 1.04→1.01. Supersedes an earlier ≈1.48 (mostly deadzone-rescaling artifact). |
| Deadzone threshold | ≈300 counts at dz=20 (≈67 at default dz=4.45) | dz reappearance sweep | — | 2026-07-19 | CONFIRMED | Confirms `VJoyCombinedDeadZone` is a % of full stick range. |
| Full-deflection point | ~1500 counts | plateau + curve fit | — | 2026-07-22/23 | CONFIRMED | Distinct from the 1920 accumulator clamp below — two different concepts, don't conflate. |
| Accumulator clamp | 1920 counts = half of 3840 capture width | rate-consistency check | 1 | 2026-07-23 | CONFIRMED | Resolution-dependent, re-derive at other resolutions. |
| Reversal wobble | ~1-1.5s settling ringing, ±0.5-1°/s | fast/slow ramp reversal + static control | 1 each | 2026-07-22 | SUSPECT | Confirmed real vs tracking noise, but explicitly "should be repeated." |
| Reversal fit (device-path, Coupled) | thrust=7.02-7.55, drag_normal=8.20-9.24, drag_reversal=0.00 pinned | `fit_model.py` | 3 | 2026-07-18 | SUSPECT | An earlier Decoupled-mode dataset was fully invalidated and discarded (wrong flight mode). |
| **Reversal fit — coded 2nd-order model (device-path, Coupled)** | `second_order` (rate_ss=0.77 rad/s≈44°/s, wn=11.1, zeta pinned at 0.999) RMS 9.50°/s; `second_order_fixed_rate` (rate_ss pinned at coded 0.91 rad/s, wn=10.2, zeta pinned at 0.999) RMS 10.53°/s — **both worse** than the row-above asymmetric drag=0 fit's RMS 9.00°/s, and both pin zeta at the near-critical-damping bound, unlike the genuinely-underdamped (zeta 0.56-0.73) spool-up-from-rest fits for this same axis | `fit_model.py`'s new `second_order`/`second_order_fixed_rate` models (added 2026-07-27), reusing the existing `data/Gladius/yaw_reversal/20260718-{212039,212121}` trials — no new capture | 2 (same trials as the row above) | 2026-07-27 | SUSPECT | Directly tests [GitHub issue #12](https://github.com/emcodem/sc_webgl/issues/12)'s question: does `flightModel.ts`'s coded 2nd-order model (the one actually driving pitch/yaw in-game) already explain a reversal as "spool-up with a flipped target"? **No** — it fits this real reversal trace worse than the already-flagged simple asymmetric/drag=0 model, and only gets that close by collapsing toward zero oscillation (zeta->0.999), contradicting the same-axis spool-up fit's genuine underdamped shape (zeta 0.56-0.73). Suggests real reversal needs distinctly different (more damped, non-oscillatory) dynamics than spool-up, not just a negated target — consistent with, and sharper than, the drag_reversal=0 finding above. Single joint fit of the same 2 pre-existing trials; needs more reps plus an equivalent PITCH capture (`feeder/maneuvers/pitch_reversal.json` already exists, never actually run) before this changes any code. |
| Dedicated spool-up (device-path) | u=1.0 → ~49-55°/s; u=0.5 → ~32.5-33.3°/s (ratio 0.65, not 0.5) | raw plateau read | 2 clean each | 2026-07-18/19 | SUSPECT | Confirms nonlinear default device-vjoy curve (separate from the mouse-curve findings above). |
| 360°-check shortfall (device-path) | mean −0.73° | before/after | 3 | 2026-07-18 | SUSPECT | Confirms sustained yaw ≈52°/s spec; not a valid τ measurement (confounds noted). |

## Spool-up transient — 2nd-order underdamped fit (rate_ss / ωₙ / ζ)

Model: `rate(t) = rate_ss·(1 − e^(−ζωₙt)·(cos(ω_d t) + (ζωₙ/ω_d)·sin(ω_d t)))`, ω_d = ωₙ√(1−ζ²).
See `BLUEPRINT.md` for the fitting-method gotcha (short windows without a full overshoot+undershoot
cycle give unreliable ωₙ/ζ regardless of which domain you fit in).

| Ship/axis | Condition | rate_ss | ωₙ (rad/s) | ζ | RMS (2nd vs 1st order) | Date | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| Pitch | non-boosted | 66.41°/s | 8.633 | 0.807 | 1.54 vs 3.73° | 2026-07-23 | SUSPECT | Not re-verified at a matching longer dwell. |
| Pitch | boosted (short window) | 75.75°/s | 8.009 | 0.916 | 1.16 vs 3.07° | 2026-07-23 | SUSPECT | Fitting method later found unreliable on short windows generally (see BLUEPRINT.md); the longer-dwell DOWN redo landed within ~7%/3%/10%, so likely sound on those terms — but still under the power-triangle confound. |
| Pitch UP | boosted, longer-dwell (full cycle) | 76.69°/s | 8.135 | 0.714 | 0.138 vs 0.506° | 2026-07-26 | SUSPECT | Power-triangle NOT confirmed for this capture. |
| Pitch DOWN | boosted, longer-dwell (full cycle) | 70.15°/s | 8.283 | 0.820 | 0.131 vs 0.527° | 2026-07-26 | SUSPECT | ωₙ agrees with UP within ~2%; rate_ss ~9% lower (echoes non-boosted UP/DOWN asymmetry). Power-triangle NOT confirmed. |
| **Pitch UP** | **boosted, full engine power** | **75.56°/s** | **9.521** | **0.709** | 0.758 vs 0.941° | 2026-07-26 | SUSPECT* | *Converged (not pinned) — see full-power method note below. ωₙ ~17% above the non-full-power band. Single rep, noisier than historical fits (RMS ~5-6× higher) since it uses data right up against the dashboard-occlusion cutoff. |
| **Pitch DOWN** | **boosted, full engine power** | **77.01°/s** | **10.319** | **0.786** | 0.788 vs 0.913° | 2026-07-26 | SUSPECT* | *Converged (not pinned) — see full-power method note below. ωₙ ~24% above the non-full-power band, ~8% above UP's full-power ωₙ. Single rep, uses data right up against the top-frame-edge cutoff. |
| Yaw | non-boosted | 50.57°/s | 8.027 | 0.729 | 1.66 vs 4.42° | 2026-07-23 | SUSPECT | Not re-verified at a matching longer dwell. |
| Yaw | boosted | 48.81°/s | 8.186 | 0.560 | 1.00 vs 4.69° | 2026-07-23 | SUSPECT | Does NOT push toward coded `boostMaxAngVel.yaw` (62°/s) — stays near non-boosted rate; window may include release-tail contamination. |

**Cross-condition note (still likely real):** ωₙ lands in a tight 8.0-8.6 rad/s band across every
condition above regardless of axis/boost — a shared underlying natural frequency, not per-axis
tuning. This qualitative shape finding (real overshoot-and-settle, 2nd order beats 1st by 2-4×) is
independent of the power-triangle confound; the exact rate_ss numbers are what's suspect.

**Full-power re-attempt (2026-07-26): initial fit didn't converge; a wider tracking window fixed it.**
Re-ran both Pitch UP and Pitch DOWN boosted spool-up captures at confirmed full engine power (same
1.1s dwell/0.05s ramp recipe as the longer-dwell rows above). At `fit_spool_response.py`'s default
`--window 40`, both trials' 2nd-order fit pinned ζ near the degenerate 0.999 bound across the whole
usable `--trim-end` range — the "flat, near-critically-damped" failure signature the tool's own
docstring warns about. Diagnosis: the tracker was losing lock to a false bright object (a HUD
element for UP, near the top-of-frame edge for DOWN) well before the landmark's TRUE physical exit
point (confirmed by extracting and visually inspecting frames — for UP, the sun visibly disappears
behind the cockpit dashboard right where the narrow window lost it; for DOWN, it reaches the true
top FOV edge). **Widening the window to `--window 80` let the tracker follow the real landmark all
the way to its genuine physical exit** (dashboard occlusion for UP, frame edge for DOWN) instead of
losing it early to the false-lock artifact, recovering an extra ~0.15-0.25s of real clean data with
no new capture needed — same two video files, just re-analyzed. Sweeping `--trim-end` on the wider-
window data showed the same rate_ss/RMS staying stable while ζ stayed pinned through most of the
range, then genuinely unpinning into stable, non-boundary values right before the final contamination
collapse (UP: unpins at trim-end 0.84-0.86, collapses at 0.88; DOWN: unpins at 0.905-0.915, collapses
at 0.92) — the two converged rows in the table above are read from those unpinned plateaus. Both are
single-rep and lean on data right at the edge of what's physically visible (RMS 0.76-0.79°, notably
noisier than the ~0.13-0.14° seen on the non-full-power fits with more travel room), so treat as a
first read, not final — but they're genuinely converged, not degenerate. **The model-free peak rate
from these same trials remains the most solid number**: 81.67°/s (UP) and 80.47°/s (DOWN), both in
the Pitch table above. A repeat with the landmark seeded even closer to the top frame edge (more
travel room before hitting the dash/edge) would tighten these further.

## Reversal stop-time — felt-threshold method (2026-07-27/28)

Directly probes [GitHub issue #12](https://github.com/emcodem/sc_webgl/issues/12) (real SC's
"brake first" reversal sluggishness vs. sc_webgl's more immediate one) via a new tool,
`capture/reversal_feel_test.py`: drive full/partial mouse deflection to `mag1` for `dur1` (reaches
steady state), hard-flip to `mag2` for `dur2`, release. No OBS/frame-tracking — `dur2` is the
**felt** threshold where the hold exactly cancels the ship's velocity without it visibly starting
to turn the other way, found by manual binary search (retry with `dur2` raised/lowered). **All
values below are SUSPECT by construction** (human perceptual threshold, not a frame-tracked
zero-crossing) — treat as a strong qualitative signal and a candidate model shape, not
capture-grade numbers. Coupled vs. Decoupled was checked directly and found to make no difference
(consistent with the existing structural finding above that decoupled only removes linear damping).

### mag1 sweep, mag2 = full opposite deflection (dur1 = 1.0s each)

| Axis | mag1 | dur2_stop | Notes |
|---|---|---|---|
| Yaw (mag2=-1700) | 1700 | 0.20s | Retested — an initial 0.30s reading was a measurement mistake. |
| Yaw (mag2=-1700) | 850 | ~0.078s | Refined from a looser 0.085/0.080 lower bound. |
| Yaw (mag2=-1700) | 550 | ~0.020s | Hard to judge at this speed; refined down from an initial 0.012-0.028 spread. |
| Yaw (mag2=-1700) | 350 | ≤0.0008s | Below one frame at 120fps (8.3ms) — effectively "instant," not a precise value. |
| Pitch (mag2=-1080) | 1080 | 0.300s | Original anchor point, repeatedly confirmed. |
| Pitch (mag2=-1080) | 950 | 0.245s | Predicted by the linear fit below, then independently confirmed. |
| Pitch (mag2=-1080) | 850 | 0.209s | Predicted, then confirmed. |
| Pitch (mag2=-1080) | 700 | 0.155s | Predicted, then confirmed. |
| Pitch (mag2=-1080) | 540 | 0.095s | Refined via bisection (initial lower bound was 0.07-0.09). |
| Pitch (mag2=-1080) | 310 | 0.0155s | Refined via bisection. |
| Pitch (mag2=-1080) | 200 | ≤0.001s | Below one frame at 120fps — at the resolution floor, same caveat as yaw's 350-count row. |

**Pitch fits a clean line**: `dur2_stop = 3.589e-4 × (mag1 − 267.0)` (log-RMS 0.024 on the 3
bisected calibration points 1080/540/310) — then **independently predicted 950/850/700 almost
exactly**, which were confirmed afterward. That's real validation of a linear (not power-law)
relationship for pitch, not just a curve-fit artifact.

Yaw's equivalent fit is far less settled: successive refits (as looser lower-bound values got
bisected tighter) swung from an exponent of 1.54 to 0.78 — still an exact 3-point interpolation
each time (3 free params, 3 points), never independently validated against held-out points the way
pitch's line was. **Yaw's curve shape should be treated as unresolved**, not linear-confirmed.

### Cross-axis pattern: fitted "effective deadzone" is ~5-6× the real one

Both axes' fits imply a deadzone-like offset well past the actual configured
`VJoyCombinedDeadZone` (confirmed via `attributes.xml`: `4.45` → the *default* setting):

| Axis | Fitted offset | Real deadzone estimate (4.45% of that axis's own max) | Ratio |
|---|---|---|---|
| Pitch (linear fit, 6 pts) | 267.0 | 48.1 (4.45% of 1080) | 5.6× |
| Yaw (best available fit) | 486.3 | 85.4 (4.45% of 1920, the true accumulator clamp) | 5.7× |

This ratio held up across multiple refits on both axes even as the exponent estimate for yaw moved
around a lot — more likely a real effect than a fitting artifact. Not yet explained; candidate
causes include the reversal governor's own response having a much wider "dead" region than the
input curve's deadzone, or the constant-decel model itself being an oversimplification.

### mag2 (counter-thrust magnitude) saturates well before full deflection

One exploratory test, pitch, mag1=1000: predicted `dur2_stop` at mag2=FULL(-1080) from the linear
fit is 0.263s. Observed `dur2_stop` at **mag2=-500 (well under half deflection)** was **~0.25-0.28s
— essentially the same**. Halving the counter-command barely changed the stop time. This
contradicts the naive assumption that braking authority scales down with mag2 the same way the
initial spin-up target scales with mag1 (that assumption predicted ~0.92-1.0s, roughly 3-4× too
long). Braking looks closer to a **saturating/threshold response** — a moderate counter-command
already produces close to full braking effect — than a smoothly proportional one. Where that
saturation actually breaks down (how low mag2 can go before stop-time starts rising) is not yet
tested; a follow-up sweep (mag2 = -300/-150/-80 at mag1=1000) was proposed but results not yet in
as of this entry.

## Throttle input ramp — keyboard analog emulation (Gladius, W/S)

Real SC's keyboard throttle input isn't instantaneous like a digital on/off — pressing/releasing
ramps the commanded throttle over a measurable time, distinct from `mainSpoolDelay`/`retroSpoolDelay`
(which gate when thrust *catches* once throttle is already fully commanded — see `flightModel.ts`).
Measured by frame-tracking the HUD speed gauge's own throttle-position marker (a small cyan square +
line, distinct from the fill/track) at 120fps/4K OBS capture — a new ad hoc method (Python + OpenCV
connected-component pixel tracking of the marker's y-position), not yet part of the `capture/` tool
suite.

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Forward (W) — activate ramp, 0→100% | ~0.20s (24 frames @ 120fps) | HUD gauge marker pixel-tracking | 2 | 2026-08-01 | CONFIRMED | Two independent captures: 0.203s and 0.201s. Clean linear (constant-rate) ramp, no overshoot/settling wobble. |
| Forward (W) — release ramp, 100%→0 | ~0.20s (24 frames @ 120fps) | same | 1 | 2026-08-01 | CONFIRMED | 0.201s — same linear shape/rate as activate. |
| Backward (S) — activate ramp, 0→100% | ~0.20s (24 frames @ 120fps), SAME rate as forward | same | 2 | 2026-08-01 | CONFIRMED | Supersedes the "instant, no ramp" reading below — per user, that was a HUD display bug/glitch, not real behavior; other observations clearly show the identical ramp shape as forward. Backward's bar simply doesn't rise as far as forward's (lower peak height), because backward thrust is weaker overall (a magnitude/cap difference, not a ramp-timing one) — consistent with the existing back-thrust-weaker-than-forward asymmetry already in `shipTypes.ts` (retro thrust 63 vs main 201). |
| ~~Backward (S) — activate ramp, "instant"~~ (superseded) | ~~instant, ≤1 frame (≤8.3ms)~~ | same | 2 | 2026-08-01 | SUPERSEDED | Both captures showing an instant jump are now believed to be a display bug in SC's HUD marker rendering, not a real ramp-timing difference — see the row above. |
| Backward (S) — release ramp, 100%→0 | ~0.20s (24 frames @ 120fps) | same | 1 | 2026-08-01 | CONFIRMED | 0.201s — matches forward's ramp rate almost exactly. |
| **Boosted** forward (W) — activate ramp, 0→100% | ~0.20s (24 frames @ 120fps), SAME duration as unboosted | same | 1 | 2026-08-01 | CONFIRMED | 0.1998s (23.98 frames) — travels ~182px vs unboosted's ~81px (2.25× further) in the SAME time, i.e. a ~2.25× faster px/frame slope, not a faster ramp. Confirms boost raises the ramp's amplitude/target (higher max thrust), not its rate. |
| **Boosted** backward (S) — activate ramp, 0→100% | ~0.20s (24 frames @ 120fps), SAME duration as unboosted | same | 1 | 2026-08-01 | CONFIRMED | 0.1992s (23.91 frames), ~181px travel — matches boosted-forward's ratio and duration closely. |
| Boosted release (both directions) | unclear — NOT yet confirmed | same | 1 each | 2026-08-01 | — | Backward-boost release reads as a genuine single-frame instant snap straight to rest (no ramp at all). Forward-boost release shows a noisier multi-stage transition (drops partway to an intermediate value, holds, then an instant final snap to rest) rather than one clean ramp. Given the earlier false "instant" reading for unboosted backward activation turned out to be a display bug, this is NOT treated as confirmed either way — needs the user to review the raw footage before drawing a conclusion, unlike the activate rows above which are unambiguous in the pixel data. |

**Cross-condition note:** all four UNBOOSTED transitions (forward activate/release, backward
activate/release) AND both BOOSTED activate transitions converge on the same ~24-frame/0.20s
duration — one shared ramp-rate CONSTANT-TIME (not constant-speed) governs every throttle
activation regardless of direction or boost state; boost only changes how far the ramp travels
(the commanded target amplitude), not how long it takes to get there. Boosted release timing is the
one open question in this section (see row above). Not cross-checked against the engine-power-
triangle confound noted at the top of this file, but this is a UI/input-timing measurement (how
fast the keyboard axis ramps), not a thrust-output magnitude — by the same reasoning as the power-
triangle-independent "Input curve / deadzone" section further down, it's expected to be unaffected
by it.

## Throttle indicator bar-height amplitude (Gladius)

How far up the HUD speed gauge's throttle marker rises at 100% commanded throttle — independent of
the ramp-timing section above. Two different reference/calibration methods were tried, giving two
different answers; the bar-anchored one is what's wired into `hud.ts` as of 2026-08-02 (per user
go-ahead), superseding the forward-anchored one it started as.

| Condition | Value (forward-anchored calibration, superseded) | Value (bar-anchored calibration — WIRED) | Status | Notes |
|---|---|---|---|---|
| Forward (W), unboosted | ~~50%~~ (given/assumed, not independently measured) | **45%** | CONFIRMED (per user go-ahead) | The 50% figure was never actually measured against the gauge's own physical track — it's the user's verbal recollection. Measuring against the track's own static border (top bracket to marker's own rest position) gives ~42-45%, rounded to 45% and wired in. |
| Backward (S), unboosted | ~~65%~~ (64.2% measured, rounded, relative to forward's assumed 50%) | **55%** | CONFIRMED (per user go-ahead) | Measured as the marker's own held pixel position (185.5, steady the whole time S is held), against the track's actual top border rather than against forward's own (possibly-wrong) percentage. Either calibration agrees backward's unboosted amplitude is LARGER than forward's, not smaller as first assumed — see the resolved confusion below. |
| Boosted, either direction | 100% | **100%** | CONFIRMED (per user) | Per user statement, boost brings the bar to 100% in both directions. Bar-anchored measurement lands a few % short of literal 100% (108/107 px vs a measured track-top of ~99px) — most likely anti-aliasing/edge-detection slop in locating the track's exact top pixel, not a real sub-100% cap; still wired as a clean 100%. |

**What's wired into `hud.ts` today:** the bar-anchored column (45% / 55% / 100% / 100%) —
`throttleMaxPct` in `updateGauges`'s throttle-indicator block. The forward-anchored column (50% /
65%) was the first thing wired in, then replaced once the bar-anchored measurement was available
and the user chose it over both the original 50/65 and a floated symmetric-45/45 alternative.

**Resolved confusion (2026-08-02):** an earlier read of `backward.mp4` mistook a SEPARATE
mode-reference event for "backward ramping further than forward" — after releasing S, the marker
does NOT ramp back toward rest; it snaps to the reverse-mode's own 0% (top) position immediately
(matches "instant, no ramp" from the ramp-timing section above). The ~24-frame drift from ~185.5 to
~105.5 that was previously fit as a "release ramp" (0.201s, in the ramp-timing section above) is
this mode-revert transition, not a throttle magnitude changing — 105.5 is NOT backward's
full-throttle position (185.5 is).

**Superseded mode mechanism (2026-08-02):** the mode-revert was initially modeled as a fixed
~200ms hold timer keyed off recent throttle input (`REVERSE_MODE_HOLD_MS` in `hud.ts`), based on
the drift observed above. Per direct user clarification this is wrong: the indicator's mode is
actually just the SPEED BAR's own indicated direction (`forwardSpeed`'s sign, shared with the fill
above), not a release timer at all — and while the speed bar reads one direction, throttle input in
the OPPOSITE direction reads as zero (gated), not a partial/negative value. The timer mechanism was
removed; `hud.ts` now gates directly on `forwardSpeed < 0` plus a same-direction-as-throttle check,
matching the ship's very first (pre-capture) throttle-indicator implementation.

## Linear thrust / speed (Gladius)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Forward accel / coast decel | 134 / 42 m/s² | `linear_hold_capture.py` + `montage_speed.py` | 1 | 2026-07-19 | SUSPECT | Matches coded main 201/1.5, retro 63/1.5. |
| Back accel / coast decel | 42 / 134 m/s² | same | 1 | 2026-07-19 | SUSPECT | |
| Lateral accel / coast decel | 98 / 98 m/s² | same | 1 | 2026-07-19 | SUSPECT | Matches strafe 145/1.5=96.7. |
| Up accel / coast decel | 98 / 49 m/s² | same | 1 | 2026-07-19 | SUSPECT | |
| Down accel / coast decel | 49 / 98 m/s² | same | 1 | 2026-07-19 | SUSPECT | |
| Max lateral/vertical speed | 225 m/s | same | — | 2026-07-19 | SUSPECT | Coded 226 (SCM cap). |
| Coast-decel model | per-(axis,direction) = opposing thruster/mass, not one scalar `coastDecel=40` | derived from all above | — | 2026-07-19 | SUSPECT | **Gated** — touches ported flightModel.ts, not yet applied. |
| Decoupled linear | release = pure drift, counter-thrust decel unchanged (96-100 m/s²), SCM cap unchanged | counter-movement runs | 1 each mode | 2026-07-19 | CONFIRMED | Structural: decoupled removes only the linear auto-brake. |
| Boosted lateral | accel ≈127 m/s², max ≈391 m/s, coast ≈127 m/s² | same | 1 | 2026-07-19 | SUSPECT | Coded-model gap: `boostLinearThrust` had no strafe/vertical entries at all (since patched, see BOOST_FINDINGS.md). |
| Boosted vertical-up | accel ≈126 m/s², max ≈383 m/s, coast ≈66 m/s² | same | 1 | 2026-07-19 | SUSPECT | Shared ~385 boosted maneuvering cap w/ lateral, distinct from boosted-forward 520. |
| Boosted forward top speed | ~519-520 m/s | `linear_hold_capture.py --boost` | 1 | 2026-07-25 | SUSPECT | Matches coded boostMaxSpeed 520. |
| Boosted retro top speed | ~267 m/s | same | 1 | 2026-07-25 | SUSPECT | Matches coded boostSpeedBack 268. |
| Boost-release decay, forward | settled ~55-60 m/s², 8.5s to zero (520→0), crosses SCM(226) at ~4.1s | continuous OBS clip through release | 1 | 2026-07-25 | SUSPECT | Brakes continuously through SCM cap to a full stop — no plateau at SCM. Not yet acted on in code beyond the narrower fix in BOOST_FINDINGS.md §8. |
| Boost-release decay, retro | settled ~200-210 m/s², 2.0s to zero (267→0) | same | 1 | 2026-07-25 | SUSPECT | Retro brakes ~3.5× faster than forward. |
| **Forward accel / coast decel, full power** | **~130 / ~40 m/s²** | `linear_hold_capture.py` (`W:5,_:8`) + `montage_speed.py`, region `1560,1140,140,90` | 1 | 2026-07-27 | CONFIRMED | Matches coded 134/40 within ~3%; essentially unchanged from the unconfirmed-power row above — linear thrust looks far less power-sensitive than boosted rotation was. Max 225 m/s (SCM 226). |
| **Back accel / coast decel, full power** | **~40 / ~130 m/s²** | same (`S:5,_:8`) | 1 | 2026-07-27 | CONFIRMED | Coast decel matches this same session's forward-accel reading (~130) almost exactly — direct confirmation of the opposing-thruster coast model at full power. 5s hold only reached 202 m/s (accel too shallow to hit the 225 cap in the time given), consistent with ~40 m/s² needing ~5.6s. |
| **Lateral accel / coast decel, full power** | **~95 / ~95 m/s²** | same (`D:5,_:8`) | 1 | 2026-07-27 | CONFIRMED | Symmetric both ways, matches coded strafe 96.7 and the unconfirmed-power row closely. Max 225 m/s. |
| **Up accel / coast decel, full power** | **~98 / ~46 m/s²** | same (`UP:4,_:8`) | 1 | 2026-07-27 | CONFIRMED | Matches unconfirmed-power row (98/49) closely. Max 225 m/s. Screen tints red (redout) only on the low-speed coast tail, same documented pattern as before — no accel/cap reading affected. |
| **Down accel / coast decel, full power** | **~46 / ~95 m/s²** | same (`DN:2.5,_:8`, kept short — GLOC risk) | 1 | 2026-07-27 | CONFIRMED | Matches unconfirmed-power row (49/98) closely; coast decel matches this session's up-accel reading (~98), confirming the opposing-thruster model. Short 2.5s hold only reached 121 m/s by design (never intended to hit cap). |
| **Boosted lateral, full power** | **accel ≈125 m/s², max ≈390 m/s, coast ≈125 m/s²** | same (`D:5,_:8 --boost`) | 1 | 2026-07-27 | CONFIRMED | Matches the unconfirmed-power row (127/391/127) closely. |
| **Boosted vertical-up, full power** | **accel ≈123 m/s², max ≈379 m/s, coast ≈65 m/s²** | same (`UP:4,_:8 --boost`) | 1 | 2026-07-27 | CONFIRMED | Matches the unconfirmed-power row (126/383/66) closely. Pilot fully blacked out (solid black frames, not just redout tint) for the last ~2s of the coast tail from accumulated -G — expected given the ~13G peak deceleration on this axis; accel/max/most of coast decel were already captured before the blackout, per the established "no reading taken during a blackout" method note. |
| **Boosted forward top speed + release decay, full power** | **max ≈519 m/s; release: initial ~110-145 m/s² for ~0.3-0.4s, settling ~55-60 m/s², ~8.5s to zero (519→0)** | same (`W:12,_:15 --boost`) | 1 | 2026-07-27 | CONFIRMED | Matches the unconfirmed-power rows (519-520 max; 55-60 settled, 8.5s to zero) almost exactly. This clip's own operator accidentally hit Esc + clicked "Exit to Menu" at t≈24.3s (real mouse/keyboard collision, not a tooling bug) — harmless here since the ship had already coasted to 0 m/s by t≈21.9s, well before the interruption. |
| **Boosted retro top speed + release decay, full power** | **max ≈267 m/s; accel ≈55 m/s² (new); release: settled ≈200 m/s², ~2.0s to zero (267→0)** | same (`S:12,_:15 --boost`) | 1 | 2026-07-27 | CONFIRMED | Matches the unconfirmed-power rows (267 max; 200-210 settled, 2.0s to zero) almost exactly. The accel figure (≈55 m/s²) wasn't previously reported. |
| **Boosted retro decel from an existing unboosted-forward cruise, full power** | **flat ≈55-56 m/s², no decay, across the ENTIRE 222→2 m/s range; 226 m/s cruise → full stop in ≈4.0s (onset t=9.29s, min-reading t=13.30-13.33s before climbing back up)** | manual capture (no script), `montage_speed.py`, region `1560,1140,220,110`, 3840×2160@120fps | 1 | 2026-08-02 | CONFIRMED | Unboosted 226 m/s cruise, then S+boost held together to a full stop; boost confirmed actively held via AB meter (100%→92% over 1.8s, matching coded 4.95%/s drain). Rate is FLAT the entire way down — same governor-not-drag character as every other measured linear axis, NOT the exponential/drag-compounded curve the current coded model (`boostLinearThrust.retro`=216.5 + `boostLinearDrag`=0.38 applied against opposing thrust) would produce (predicts ~1.2s, not ~4.0s). Converges almost exactly with the existing "Boosted retro top speed, full power" row's independently-measured ≈55 m/s² accel-FROM-REST (2026-07-27) despite testing the opposite scenario (decelerating an existing forward velocity vs. accelerating from a stop) — two independent captures agreeing. Showed `boostLinearThrust.retro` (itself never independently measured, only inferred from main's own ratio — see gladius.ts) was ~2.6× too high, and that drag must not apply at all in this role — a flat rate all the way to a stop is inconsistent with any proportional drag term. **APPLIED 2026-08-02** as the COUNTERING half of the two-regime split (see the note below the table); in-app measured stop is now 4.62s vs the old ~1.3s. |
| **Boosted left (strafe) accel from rest, full curve, full power** | **fit: thrust≈191 m/s² @v=0, drag≈0.45, asymptote≈426; measured peak 394 m/s** | manual capture (no script), `montage_speed.py`, region `1560,1140,220,110`, 3840×2160@120fps, `dv/dt=thrust/mass-drag·v` grid-search fit | 1 | 2026-08-02 | CONFIRMED | `left_boost.mp4`. Real, visibly decaying acceleration approaching a smooth asymptote — the SAME shape as boosted main's own dense-trace fit, NOT retro's flat/no-decay curve. Peak 394 matches coded `boostManeuveringSpeedCap` exactly. Some frames (~t=3.85-6.35) show a blur/ghosting artifact on the digits during the fastest-changing part of the readout (looks like a stylistic UI effect on rapid value change, not real motion blur — settings checklist's motion-blur-off was honored); excluded from the fit, endpoints on either side are clean. Fit RMS 8.9 (good) — right/right-strafe not independently captured (user: same as left by symmetry). |
| **Boosted up (vertical) accel from rest, full curve, full power** | **fit: thrust≈204 m/s² @v=0, drag≈0.48, asymptote≈427; measured peak 394 m/s** | same method | 1 | 2026-08-02 | CONFIRMED | `up_boost.mp4`. Same real-drag shape as left/strafe — clusters closely with it (both ~190-205 accel, ~0.45-0.48 drag), plausibly the same true value. Peak 394 matches `boostManeuveringSpeedCap`. Clean capture, no blur. Fit has a shallower minimum than left's (RMS 13.5, t0/thrust/drag trade off against each other) — treat exact numbers as ballpark. |
| **Boosted down (vertical) accel from rest, full curve, full power** | **fit: thrust≈112 m/s² @v=0, drag≈0.26, asymptote≈434; measured peak 387 m/s** | same method, captured in 2 segments (accel to ~230, brief hold to avoid redout, accel to max) spliced into one continuous curve by removing the hold duration before fitting | 1 | 2026-08-02 | CONFIRMED | `down_boost.mp4`. Real-drag shape like left/up, but genuinely WEAKER — raw early-frame accel (~60-65 m/s², visible directly before any fitting) is roughly half of up's (~120-125 m/s²), far too large a gap to be reading error. Contradicts `gladius.ts`'s current `verticalDown`=`verticalUp` assumption (that note explicitly says "no data existed" for asymmetry — there now is, pointing the same direction as the unboosted verticalDown=verticalUp/2 ratio, though not exactly half here). Peak 387 vs up's 394 (~1.8% lower) — plausibly noise, not a strong claim. Redout tint visible on-screen through the phase-1 hold but did not obscure readings (unlike a prior blackout-affected vertical-up capture). Fit RMS 12.3, shallow minimum like up's — treat exact numbers as ballpark. |
| **Boosted strafe decel from an existing unboosted-left cruise (countering), full power** | **flat 123.7 m/s² (linear-fit RMS 0.90), 225 m/s cruise → full stop in ≈1.85s** | manual capture (no script), `montage_speed.py`, region `1560,1140,220,110`, 3840×2160@120fps | 1 | 2026-08-02 | CONFIRMED | `225_left_boost_right_to_stop.mp4`. Unboosted left cruise, then boosted right-thrust held to a full stop — same "countering" method as the retro decel row above. Rate is FLAT (linear regression fits far better than any curved model), unlike this axis's OWN accel-from-rest curve (fitted ~191 m/s² @v=0, real drag — see the "Boosted left (strafe) accel from rest" row above). Countering rate is ~65% of the aligned rate. See `RETRO.md` §5 for the cross-axis pattern this reveals. |
| **Boosted up-thrust decel from an existing unboosted-down cruise (countering), full power** | **flat 123.1 m/s² (linear-fit RMS 0.57), 220 m/s cruise → full stop in ≈1.9s** | same method | 1 | 2026-08-02 | CONFIRMED | `220_down_boost_up_to_stop.mp4`. Unboosted down cruise, then boosted up-thrust held to a full stop. Flat, no drag — vs. this axis's own aligned accel-from-rest fit (~204 m/s² @v=0, real drag). Countering rate is ~60% of the aligned rate. No redout/blackout on this direction (accelerating a downward-moving pilot upward doesn't trigger it the way the reverse does). |
| **Boosted down-thrust decel from an existing unboosted-up cruise (countering), full power** | **flat 64.4 m/s² (linear-fit RMS 0.31), 225 m/s cruise → full stop in ≈3.6s** | same method; heavy redout tint over the stop-point frames, recovered by per-channel contrast-stretching each crop (confirmed true min 4 m/s at t≈5.30, not a display freeze) | 1 | 2026-08-02 | CONFIRMED | `225_up_boost_down_to_stop.mp4`. Unboosted up cruise, then boosted down-thrust held to a full stop. Flat, no drag — vs. this axis's own aligned accel-from-rest fit (~112 m/s² @v=0, real drag). Countering rate is ~58% of the aligned rate — third axis independently landing in the same ~58-65% band as strafe/up. The post-stop "flat 19 m/s" tail is real drift (pilot overshot zero slightly, then released input), not a settled cruise — same convention as the other two rows' "flat 33/34" tails; doesn't affect the stop-point reading, which is always the pre-overshoot minimum. |
| **Boosted retro accel from rest, full curve, full power (RE-CAPTURED, supersedes the 2026-07-27 "≈55 m/s²" single-average reading)** | **fit: thrust≈131.3 (accel≈87.6 m/s² @v=0), drag≈0.235, asymptote≈373; measured peak 267 m/s; governor ratio ≈1.39 (close to main's 1.417)** | manual capture (no script), `montage_speed.py`, region `1560,1140,220,110`, 3840×2160@120fps, `dv/dt=thrust/mass-drag·v` grid-search fit | 1 | 2026-08-02 | CONFIRMED | `reverse_boost.mp4`. Footage starts with a small +9 m/s pre-existing drift, canceled in ~0.3s before the real climb begins from true rest. Real, visibly curving acceleration approaching a smooth asymptote above the 268 cap — the SAME shape as main/strafe/up/down's aligned fits, NOT the flat line the old 2026-07-27 reading implied. RMS 9.97, comparable fit quality to the other axes. Ratio vs. this axis's own countering rate (55.5, flat, see the "Boosted retro decel..." row above): 55.5/87.6 = 0.634 — squarely inside the 0.575-0.648 band strafe/up/down independently established. **Resolves the retro-outlier question**: the old "≈55" reading wasn't wrong, it was a simple total-average over a curve that starts at 87.6 and tapers toward the cap, which happens to average out close to the (structurally unrelated) countering rate. See `RETRO.md` §7-8. |

**APPLIED to code 2026-08-02** (all nine boosted-linear rows above). The six new captures plus the two
pre-existing main rows resolved into one model: every boosted linear axis has an **ALIGNED** regime
(2.09× the unboosted thruster, with real drag, curving to an asymptote above its cap) and a separate
**COUNTERING** regime (1.30× the unboosted *opposing* thruster, dead flat, no drag) at ~58-65% of the
aligned rate on all four independently measured axes. Forcing those two unified multipliers costs
almost nothing against the individual curves (mean fit RMS 10.68 free → 10.88 unified), so the per-axis
spread was noise.

Nothing boosted-linear is authored any more — `boostLinearThrust`, `boostCounterThrust` and
`boostLinearDrag` are all derived in `physics/ships/linearInvariant.ts` from `linearThrust`, `mass`, the
speed caps and three ratios (`boostThrustMultiplier` 2.09, `boostCounterMultiplier` 1.30,
`boostGovernorOvershoot` 1.417). Deliberate design call so a new ship needs only measurable quantities
rather than a re-fitted drag coefficient; it also makes "boost is governor-limited, not drag-limited"
structural (asymptote == overshoot × cap by construction, and `buildShipType` rejects overshoot ≤ 1).

Two prior conclusions were overturned in the process: boosted `verticalDown` is **not** equal to
boosted `verticalUp` (the half ratio is real for boost too — the 2026-07-28 note's premise that no
boosted-downstrafe capture was obtainable proved beatable), and retro is **not** a drag-free outlier
(its old "≈55 m/s²" aligned figure was a total-average over a curve, not a rate). Verified in-app: the
226 m/s reverse+boost stop now measures **4.62s** against the old ~1.3s.

## Boosted lateral/vertical authority vs. current forward speed (2026-08-04)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Boosted up-strafe initial accel, forward held, full power NOT confirmed | ~1/4 of the from-rest aligned model's prediction at v_forward≈516 | TVI-marker pixel tracking (`analysis/track_tvi_speedsweep.py`) vs. HUD speed montage, converted via the pinhole model (f≈1200px) | 1 (3 axes: up/down/left) | 2026-08-03 | DISCARDED | Full engine power not confirmed for this capture — superseded by the two rows below per user instruction. Kept only as the observation that first surfaced the effect. |
| Boosted up-strafe accel vs. forward speed, forward released, full power NOT confirmed | ~100 m/s² at v_forward≈512 decaying to ~50 m/s² by v_forward≈451 (vs. from-rest model 204.8) | same method, forward thrust released before strafing (rules out input-competition as the cause) | 1 continuous 2s pulse | 2026-08-03 | DISCARDED | Same power caveat as above — superseded, but the forward-not-held design is what ruled out the shared-input-budget hypothesis the user had floated and then retracted. |
| Boosted up-strafe initial accel at several forward speeds, full power confirmed | ~13-16 m/s² @v_forward≈378; ~26-90 m/s² @v_forward≈220-241 (noisy, 3x spread between reps at similar speed) | same method, repeated up-strafe pulses across one long boost-then-coast clip | 1 clip, 4 pulses | 2026-08-04 | SUSPECT | Confirms the effect is real and speed-dependent with forward never held (ruling out input-competition), but manual single-tap captures are too noisy (human key-press variability) to fit a precise curve — same-speed reps disagreed 3x. |

**APPLIED 2026-08-04, ROUGH ESTIMATE per user go-ahead** (`physics/flightModel.ts`'s
`lateralSpeedAuthority`): user chose to ship a simple, easily-revisited model rather than chase a
cleaner capture. ALIGNED lateral/vertical thrust (strafe, verticalUp, verticalDown) is scaled by a
quadratic taper, shaped differently depending on boost state:
- **Boosted**: `(1 - clamp(forwardSpeed, 0, boostSpeedForward) / boostSpeedForward)^2` — tapers across
  the WHOLE 0..boostSpeedForward range, full at a dead stop, ~0 at the ship's own boosted top speed.
  Roughly matches the SUSPECT boosted data above (predicts ~0.33 at 220 m/s, ~0.07 at 380 m/s, against
  measured ranges of 0.13-0.44 and ~0.07 respectively).
- **Unboosted**: `(1 - clamp(forwardSpeed - scmSpeed, 0, scmSpeed) / scmSpeed)^2` — full authority
  at/under scmSpeed (matching an earlier, separate capture of unboosted strafe near 226 m/s cruise
  reading close to full strength), tapering only once COASTING ABOVE scmSpeed toward ~0 by 2×scmSpeed.
  A genuinely different shape, not the boosted curve with a swapped reference — a follow-up capture
  (2026-08-04, `analysis/track_tvi_speedsweep.py` against `2026-08-04_00-28-06.mp4`: boost to >400,
  release both boost AND forward, tap left/right repeatedly while coasting down) found near-ZERO
  horizontal TVI movement from ~500 down to ~290 m/s, then a response that builds back toward normal
  by ~225 — i.e. unboosted strafe is fine at its own cruise speed and only breaks while overspeed
  relative to ITS OWN cap, unlike boosted (already suppressed well under boostSpeedForward).
Both reuse existing fields (`boostSpeedForward`, `scmSpeed`) rather than adding new authored constants.
Neither is a fitted curve — revisit with cleaner (longer-hold or multi-rep, averaged) captures if this
ever needs to be more than a feel-match. The countering role is unmeasured and left untouched in both
modes.

## Boost meter (drain / recharge, % per second)

| Quantity | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Drain rate | 4.95%/s (100→25%: 4.93; 25→0%: 5.0, no kink) | `boost_meter_capture.py` + `montage_speed.py`, frame-accurate | 2 | 2026-07-25 | CONFIRMED** | **Not thrust-output-dependent (a resource-meter drain, not a rotation/accel measurement) — but never specifically checked against power-triangle either. Applied to `gladius.ts`. |
| Recharge rate | 2.51%/s (0→25%: 2.54; 25→100%: 2.46, no kink) | same | 1 | 2026-07-25 | CONFIRMED** | Same caveat as above. Applied. |
| Recharge delay | observed ~0.5-1s vs coded 0.3s | same | 1 | 2026-07-25 | CONFIRMED** | Close enough, not corrected. |
| Structural finding | the "two-rate red zone" model (fast below, slow above threshold) isn't real — single constant rate end-to-end for both drain and recharge | derived | — | 2026-07-25 | CONFIRMED | Applied alongside the rates above. |

## Input curve / deadzone / cosmetic settings (mouse vjoy) — power-triangle independent

| Quantity | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| `VJoyAnglePilots` flight effect | NONE — purely cosmetic (indicator size only) | `mouse_hold_capture.py` + `hold_rate.py`, multiple magnitudes, 2 ships | multiple | 2026-07-19 | CONFIRMED | |
| `VJoyAnglePilots` → indicator pixel travel | px = f·tan(degrees), f≈1222px (theoretical pinhole f≈1200px, ~2% match) | 2-point manual measurement | 2 | 2026-07-21 | CONFIRMED | Applied to `hud.ts`'s indicator radius calc. |
| `VJoyCombinedDeadZone` flight effect | REAL, confirmed % of full stick range (default 4.45%, dz=20→~300 counts) | dz reappearance sweep | — | 2026-07-19 | CONFIRMED | Rescale-vs-hard-cut model still open — needs a Taurus near-full-deflection test. |
| Mouse full-deflection point | yaw ~1500 counts, pitch ~1080 counts — NOT shared across axes | curve fits + live bisection | — | 2026-07-22 | CONFIRMED | Load-bearing: don't reuse one axis's curve for the other. |
| Cross-ship input gain | mouse→deflection curve is ship-independent; deflection→rate gain scales with ship agility (Taurus 7.02°/s vs Gladius 19.00°/s at same ±600 offset, ~2.7×) | same-offset comparison | 1 each | 2026-07-19 | SUSPECT | The rate comparison itself is thrust-dependent even though the qualitative conclusion (curve is shared, gain isn't) likely still holds structurally. |

## Structural / cross-cutting findings (not single numeric values)

- **Reversal-specific drag pins to exactly 0** for yaw and roll (device-path fits, many trials) — no rotational drag while actively countering an existing spin, only counter-thrust decelerates you. Pitch's drag_reversal converges to an interior, non-pinned value (1.43) — genuinely unclear if that's a real smaller effect or noise. All gated (equation-family change to flightModel.ts). SUSPECT (thrust-fit dependent).
- **Cross-ship mass scaling is unanswerable from Gladius alone** — mass only sets the time constant (mass/drag), not steady-state rate (thrust/drag, mass cancels). Needs Taurus/Arrow data (neither captured yet).
- **Sign convention is per-axis, not universal** — pitch didn't need `--sign -1` in fits, yaw and roll did. Methodology note, carried into `BLUEPRINT.md`.

---

## Not yet captured

Taurus (not yet in `shipTypes.ts`), Arrow (placeholder stats, exact Gladius clone, not yet captured).
