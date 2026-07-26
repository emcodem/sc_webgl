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

---

## Rotational rates — Roll (Gladius, keyboard Q/E via bound vJoy device)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Non-boosted, steady rate | ±202°/s (Q +201.6/+194.8, E −202.5/−209.4) | `roll_hold_capture.py` + `track_orientation.py`, 3s holds | 4 | 2026-07-19 | SUSPECT | Matches coded 199.96°/s to <2%. [Archive §"Gladius ROLL"](MEASUREMENTS_ARCHIVE.md) |
| Boosted, steady rate | +234.7 / −237.1°/s | same, boost held | 1 seq | 2026-07-19 | SUSPECT | Matches coded 240°/s to ~2%. |
| Afterburner ratio | 1.18× | derived | — | 2026-07-19/23 | SUSPECT | Closest of 3 rotational axes to coded 1.2×. |
| Decoupled vs Coupled | same hard-stop ~0.6s release either mode | same | 1 | 2026-07-19 | CONFIRMED | Structural: decoupled only drops the linear auto-brake, not rotational behavior. |
| Spool-up τ (drag-like fit) | τ≈0.20s | fit vs governor-ramp alt | few | 2026-07-19 | SUSPECT | Below coded 0.28s — real vs tracker bias unresolved. Gated (flightModel.ts ported-verbatim). |
| Release/coast-down | hard stop ~0.5s, ~40° roll-out | same | few | 2026-07-19 | SUSPECT | Less than exponential-drag's predicted 56° — open question. |
| Reversal fit (device-path) | thrust=7.35-7.44, drag pinned at 0.00 | `fit_model.py` | 4 of 5 | 2026-07-18 | SUSPECT | One trial excluded, root cause never diagnosed. |
| 360°-check shortfall (device-path) | mean −0.76° (−0.91/−0.78/−0.58°) | before/after screenshot | 3 | 2026-07-18 | SUSPECT | All 3 same sign — possible tiny real undershoot or timing bias. |

## Rotational rates — Pitch (Gladius, mouse vjoy)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| DOWN, non-boosted | 64.80°/s (64.86/64.73) | `mouse_hold_capture.py`, 1080 counts | 2 | 2026-07-23 | SUSPECT | <0.2% apart. |
| DOWN, boosted (short-hold) | 68.92°/s (71.11/66.72) | same | 2 | 2026-07-23 | SUSPECT | ~6.4% apart. |
| UP, non-boosted | 66.88°/s (66.78/66.97) | same | 2 | 2026-07-23 | SUSPECT | <0.3% apart — ~3.2% faster than DOWN, flagged as a possibly-real small asymmetry. |
| UP, boosted (360-test) | ~77-89°/s (79.38/84.54, 75.25/88.67) | full-360 before/after | 2 | 2026-07-23 | SUSPECT | Supersedes an earlier short-hold reading (66.98/62.49) that under-read badly. |
| **UP, boosted, full engine power confirmed** | **81.98°/s** (residual 0.166°) | 360-sustained-hold, 2 laps, `centroid_in_window` | 1 | 2026-07-26 | CONFIRMED* | *Single rep — matches coded/API 82°/s almost exactly. The reference point that surfaced the power-triangle confound; treat as most-trusted current boosted-pitch value but repeat before fully final. |
| Afterburner ratio, DOWN | 1.064× | derived | 2+2 | 2026-07-23 | SUSPECT | |
| Afterburner ratio, UP | inconclusive, "probably 1.0-1.1" | derived | 2 | 2026-07-23 | SUSPECT | Not pinned down even setting the power confound aside. |
| Full-deflection point | ~1080 counts | live bisection (1000-1085 probes) | several | 2026-07-22 | CONFIRMED | This IS the accumulator hard-clamp (half of 2160 capture height) — resolution-dependent, re-derive at other resolutions. |
| Input-curve exponent | NOT confirmed (fit pinned to bound, RMS 2.11°/s) | least-squares vs yaw's model | single-rep 100-1080 | 2026-07-23 | — | Not applied to code. Needs repeat reps at 900/1000/1050/400/500 before any number is usable. |

## Rotational rates — Yaw (Gladius, mouse vjoy)

| Condition | Value | Method | Reps | Date | Status | Notes |
|---|---|---|---|---|---|---|
| Non-boosted plateau | 50.4-51.27°/s (flat 1500-1920) | dense sweep + repeat probes | many | 2026-07-22/23 | SUSPECT | Curve monotonic-to-flat from deadzone through 1500; earlier apparent "peak then decline" was a measurement artifact, resolved. |
| Boosted (at 1920 clamp) | 53.26°/s (53.29/53.22) | `mouse_hold_capture.py --boost` | 2 | 2026-07-23 | SUSPECT | Tight agreement. |
| Afterburner ratio | 1.057× | derived | 2 | 2026-07-23 | SUSPECT | Not cross-checked against API reference. |
| Input-curve exponent | **1.011** (RMS 0.46°/s), full_range=1490.8 | least-squares, 15-pt clamp-cleaned dataset | 15 pts | 2026-07-23 | CONFIRMED | Applied: `axisCurve.ts` DEFAULT_EXPONENT 1.04→1.01. Supersedes an earlier ≈1.48 (mostly deadzone-rescaling artifact). |
| Deadzone threshold | ≈300 counts at dz=20 (≈67 at default dz=4.45) | dz reappearance sweep | — | 2026-07-19 | CONFIRMED | Confirms `VJoyCombinedDeadZone` is a % of full stick range. |
| Full-deflection point | ~1500 counts | plateau + curve fit | — | 2026-07-22/23 | CONFIRMED | Distinct from the 1920 accumulator clamp below — two different concepts, don't conflate. |
| Accumulator clamp | 1920 counts = half of 3840 capture width | rate-consistency check | 1 | 2026-07-23 | CONFIRMED | Resolution-dependent, re-derive at other resolutions. |
| Reversal wobble | ~1-1.5s settling ringing, ±0.5-1°/s | fast/slow ramp reversal + static control | 1 each | 2026-07-22 | SUSPECT | Confirmed real vs tracking noise, but explicitly "should be repeated." |
| Reversal fit (device-path, Coupled) | thrust=7.02-7.55, drag_normal=8.20-9.24, drag_reversal=0.00 pinned | `fit_model.py` | 3 | 2026-07-18 | SUSPECT | An earlier Decoupled-mode dataset was fully invalidated and discarded (wrong flight mode). |
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
| Yaw | non-boosted | 50.57°/s | 8.027 | 0.729 | 1.66 vs 4.42° | 2026-07-23 | SUSPECT | Not re-verified at a matching longer dwell. |
| Yaw | boosted | 48.81°/s | 8.186 | 0.560 | 1.00 vs 4.69° | 2026-07-23 | SUSPECT | Does NOT push toward coded `boostMaxAngVel.yaw` (62°/s) — stays near non-boosted rate; window may include release-tail contamination. |

**Cross-condition note (still likely real):** ωₙ lands in a tight 8.0-8.6 rad/s band across every
condition above regardless of axis/boost — a shared underlying natural frequency, not per-axis
tuning. This qualitative shape finding (real overshoot-and-settle, 2nd order beats 1st by 2-4×) is
independent of the power-triangle confound; the exact rate_ss numbers are what's suspect.

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
