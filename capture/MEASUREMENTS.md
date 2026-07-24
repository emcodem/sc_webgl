# Vjoy / mouse-flight settings — measurement methods & results

Durable record of **how to measure what a Star Citizen input setting does to flight**, and the
**measured values** per setting. The method is reusable for any setting; the results accumulate below.
Companion to `BLUEPRINT.md` (which covers the vJoy-*device* flight-tuning capture — a different
workstream). This file is specifically the **mouse virtual-joystick** settings investigation.

Everything here is measured against the **real game** driving the **mouse** (SC's on-screen "vjoy"
indicator responds to the mouse, not to a bound vJoy device — see BLUEPRINT.md), because these
settings (`VJoyAnglePilots`, `VJoyCombinedDeadZone`, …) govern the mouse virtual joystick.

---

## STATUS / RESUME HERE (read first) — as of 2026-07-23

**🛑 CRITICAL — the mouse-vjoy accumulator HARD-CAPS at half the capture resolution, in pixels, per
axis. Do not drive raw mouse counts past it.** Clamped at **half the screen resolution in the relevant
dimension**: half the capture **width** for yaw, half the capture **height** for pitch. Confirmed for
**pitch** at 3840×2160: **1080 counts** (live overshoot-bisection test — releases above this value
overshoot true center on the way back to 0). Confirmed for **yaw** at 3840×2160: **1920 counts** — a
clean capture driven exactly at 1920 read 51.27°/s, consistent with the established ~50.8-51°/s
plateau (rate-consistency check; the overshoot-bisection test hasn't separately been run for yaw).
**The clamp is resolution-dependent** — re-derive it (half the relevant dimension) for whatever
capture resolution is actually in use; don't assume 1080/1920 apply at other resolutions. Past the
clamp, a "move back by the same amount" release/reversal overshoots true center, contaminating both
the held reading and anything captured after it.

**The Gladius is fully characterized** across flight axes and regimes (every raw clip catalogued in
`data/MANIFEST.md`):
- **Rotational:** roll ±202 (boosted ±235, decoupled==coupled, spool/decel/reversal transients);
  pitch DOWN **64.80°/s unboosted / 68.92°/s boosted (short-hold; possibly itself under-reading, see
  below) at 1080 counts**; pitch UP (opposite sign) **66.88°/s unboosted** (2 tight reps) **/ ~77-89°/s
  boosted** (360-test, matches the API reference's 82 — supersedes the short-hold reps' 66.98/62.49,
  which under-read due to insufficient spool time in a short dwell); yaw **50.4°/s unboosted /
  53.26°/s boosted at 1920 counts** (ratio 1.057, 2 reps, NOT cross-checked against the API reference
  — worth doing if yaw's API value is known). **Afterburner ratio picture is now more nuanced than "all
  three below coded 1.2":** roll 1.18 (closest to coded, long-hold method already), pitch UP now
  ~1.1-1.3 (77-89 / 66.88, roughly bracketing the coded 1.2), yaw 1.057 (2 short-hold reps, NOT yet
  cross-checked with a long hold — may be under-reading too, per the same spool-time concern). **Key
  methodology lesson: short-hold reps for a BOOSTED condition may under-read if the dwell doesn't
  clear the true (still-unmeasured) spool time constant — trust a long-hold/360 cross-check over a
  short-hold average when they disagree.** See "UP-boosted, redone properly" in Results.
- **Linear (every axis+direction):** fwd 134/coast 42, back 42/134, lateral 98/98, up 98/49,
  down 49/98, max 225–226; **coast decel = opposing-thruster/mass per direction**; decoupled drops
  the linear auto-brake (drift); boosted lateral/vertical ≈ 127 accel / ~385 cap.
- **Mouse vjoy settings:** `VJoyAnglePilots` visual-only for flight, but IS a literal FOV angle for
  the on-screen indicator's pixel travel (`f*tan(degrees)` pinhole projection); `VJoyCombinedDeadZone`
  = D% deadzone; full-deflection point is **~1500 counts for yaw, ~1080 for pitch** — the two axes do
  NOT share one curve (see Results); input-curve exponent still unconfirmed (below).
- **Cross-validation:** all matches coded `shipTypes.ts` (±2% for absolutes) AND the star-citizen.wiki
  API dump in `reference/ships/aegs-gladius.json`.

**MAJOR (2026-07-23): the rotational spool-up transient is a 2nd-order underdamped step response, NOT
the coded 1st-order exponential lag — measured directly (not inferred) for all 4 of pitch/yaw ×
non-boosted/boosted, fits 2-4× better than 1st-order in every case, with a strikingly consistent ωₙ
(~8.0-8.6 rad/s) across all four. This was the actual point of this whole capture effort (steady-state
rates are already known ground truth; spool-up time was the unmeasured piece) — see "Spool-up
transient is a 2nd-order underdamped step response" in Results for the full fit table and a
`flightModel.ts` implication (gated, not yet acted on).**

**Mouse input-curve exponent — YAW DONE, PITCH still open.** Least-squares fit against the full
clamp-cleaned yaw dataset (deadzone edge through the 1920 clamp) confirms the current model shape
(rescaled deadzone + power law) with exponent **1.011** (RMS 0.46 °/s) — the "6.5× per-count
sensitivity rise" noted from the raw sweep turns out to be almost entirely the deadzone rescaling,
not real curve convexity; yaw's true shape is within noise of linear. `axisCurve.ts`'s
`DEFAULT_EXPONENT` updated 1.04 → **1.01** accordingly. The same fit attempted on pitch's dataset
(100-1080 counts) does NOT converge cleanly — noisy single-rep data around 900-1050 fights any
monotonic curve, and the least-squares `full_range` wants to exceed the confirmed ~1080 saturation
point. **Pitch needs repeat reps (900/1000/1050 at minimum) before a pitch-specific exponent can be
committed** — see "Pitch input-curve exponent" in Results for the attempted fit and why it's
inconclusive.

**NEXT — SORT / CONSOLIDATE the collected data** into a clean per-ship picture: (a) a single Gladius
spec table (measured vs coded vs API per axis/regime), (b) a candidate `shipTypes.ts` diff / a
"matches / refine / gap" verdict per constant, (c) act on the **three gated refinement flags** —
per-axis `coastDecel`, decoupled = drop-the-linear-auto-brake, missing boosted strafe/vertical in
`boostLinearThrust` (all three touch ported-verbatim `flightModel.ts`/`shipTypes.ts` — need an
explicit go-ahead, not a data task). Start from `data/MANIFEST.md` (KEEPER rows) + Results below.

**Session settings:** Gladius; roll work was in the **PU at Kareah**, linear/pitch/yaw in **private AC
free-flight**. `VJoyCombinedDeadZone` left at **20** (default 4.45); `VJoyAnglePilots` at 25 (doesn't
matter for flight).

**Optional captures still on the menu:** NAV/cruise mode (max 1193 + SCM↔NAV transition), the G-safe
(GSAF) regime, **Taurus/Arrow** (2nd/3rd ship → cross-ship mass-scaling + the deadzone
rescale-vs-hard-cut question), the roll drag-vs-governor transient settle, repeat reps for the
pitch/yaw afterburner ratios (currently single-rep).

**Method gotchas:** pointer accel pinned for MOUSE work only (`pointer_accel.py pin`/`restore`) · SC
must be foreground — `focus_and_click()` for mouse-driven captures/counter-maneuvers (a click-free
`focus_no_click()` silently sends injected motion to the OS cursor instead of the ship) — or
click-free `focus_no_click()` only for pure-keyboard captures (roll) · motion blur can't be disabled
(read the compact cockpit number, not the OSD) · keep negative-G-axis maneuvers SHORT (blackout) ·
filter tracked frames by peak_brightness (lost-lock bounce wrecks fits) · re-center the landmark
between runs via a mirror-image counter-maneuver matching the original's boost state · analysis uses
**arctan** projection (f=1200 @ FOV116) · never probe past half the capture resolution's relevant
dimension (the clamp above).

---

---

## The measurement method (reproducible)

**Principle:** drive the mouse to a **known held offset**, let the ship reach a **steady yaw rate**,
and read that rate off a tracked landmark. Steady yaw rate is a large, robust, monotonic function of
effective stick deflection — far more reliable than tracking the faint on-screen indicator (which is
small, strut-flanked, and heavily smoothed; see BLUEPRINT.md). To find what a setting does, measure
the **yaw-rate-vs-offset curve at two or more values of that setting** and see how it changes.

### Tools (all in `capture/`)
- `pointer_accel.py pin` / `restore` — pin Windows pointer speed 6/11 + acceleration OFF so injected
  mouse counts map **1:1** to what SC receives (accel was on, ~0.8× nonlinear). **Pin before any run;
  restore when done.**
- `mouse_hold_capture.py --offsets <list> --dwell <s> --tag <name>` — focuses SC (+Esc×2 reset +
  click), then drives a staircase of held mouse offsets (counts) while OBS records; logs commanded
  offset per tick + a `segments.json` of each hold's window. Output under `data/indicator/<tag>-<ts>/`.
- `analysis/track_landmark.py` — brightness-centroid landmark tracker (the pad ring / a star).
- Simple by-direction analysis (inline) or `analysis/hold_rate.py` — pixel motion → deg/s via FOV.

### Environment / setup
- **Ship:** Taurus (any ship fine for input-mapping; it's the same mouse→stick layer). **Coupled.**
  **Private** Arena Commander / free-flight. Ship **stationary (~0 m/s)** so landmark motion is pure
  yaw, not translation parallax.
- **Capture:** OBS (never ddagrab — too few frames), 3840×2160, 60 fps. FOV recorded (used 116).
- **Landmark:** a compact high-contrast feature near screen center — a **landing-pad light ring**
  worked well (bright, symmetric); a bright star also works. Seed the tracker at its pixel position
  (pad ring was ~(1920, 1100)).
- **Pointer accel pinned 1:1** (above).

### Per-setting run
1. Set the setting's in-game slider to the target value (live XML edits don't work — SC reads config
   at launch and overwrites it; see BLUEPRINT.md). Manual slider drag is simplest/reliable.
2. Re-aim so the landmark is back near screen center (Esc×2 in the focus step clears residual stick
   deflection, but heading already drifted from the prior run).
3. Run a probe. **Two robust shapes:**
   - **Single-magnitude probe** (no time-alignment needed — preferred for one number):
     `--offsets 0,M,-M,M,-M` → analyze as the median |yaw rate| while moving, split by direction.
     This gave clean, repeatable, symmetric numbers (e.g. ±600 → ±4.6 °/s).
   - **Staircase** (`0,±M1,±M2,…`) for a full curve in one run — but multi-hold time-alignment to
     the video is fragile (correlation won't lock reliably); prefer several single-magnitude probes
     when precision matters, especially where early holds may be silent (e.g. inside a deadzone).
4. Keep magnitudes in the **tracking-clean zone**: too-large offsets swing the landmark behind the
   cockpit bars / off-frame and the tracker loses it (bogus reading). ~≤±700 with 2 s dwell was safe;
   use shorter dwell for larger offsets.

### Analysis
- Track landmark → `pixel_x(t)`. Convert pixels to angle with the **correct projection** (NOT a
  linear `FOV/width` factor — that is ~37% too small even near center and badly wrong at large
  excursion). Pinhole model: `f = (width/2) / tan(FOV_h/2)` px (for FOV_h=116°, width=3840 → f=1200
  px; center density 0.0478 °/px vs the crude 0.0302). Then `angle = degrees(arctan((pixel_x −
  cx)/f))`, smooth, `rate = d(angle)/dt` = yaw °/s. Keep landmark excursion modest anyway (large
  swings amplify any residual distortion and risk losing lock behind cockpit bars).
- Single-magnitude probe: median of `rate` where `rate > +thr` and where `rate < −thr`, over the
  moving portion → the two directions (should be symmetric). Confirm the landmark kept lock
  (`peak_brightness` stayed high) and didn't hit the frame edge.
- Curve fit: `rate = gain × (|offset| − D)`; the **x-intercept D = deadzone threshold in counts**;
  `gain` = sensitivity (°/s per count).

### Gotchas (each cost real time — see BLUEPRINT.md)
- SC must be the **foreground window** or injected motion goes nowhere (invalidated 2 runs). Handled
  by `win_focus.focus_and_click`, which also **Esc×2** to reset residual stick deflection.
- SC's virtual joystick **accumulates** relative mouse deltas into an absolute position (drive target
  position, inject the per-tick delta). It **holds** a deflection when injection stops (so a held
  offset = sustained yaw).
- **Pin pointer acceleration** or injected counts ≠ SC counts.

---

## Results

### `VJoyAnglePilots` — NO flight effect (visual/indicator only) — 2026-07-19

Taurus, ±600-count probe (proper arctan projection):

| VJoyAnglePilots = 4 | VJoyAnglePilots = 25 |
|---|---|
| 7.12 °/s | 7.02 °/s |

Changing it 6× left the mouse-offset→yaw-rate mapping **identical**. `VJoyAnglePilots` changes the
on-screen indicator's visual travel/angle **but not the input→ship response** — **irrelevant to
recreating flight feel.** (A ±1400 check was also consistent under a cruder metric, but those clips
had large-excursion tracking trouble so ±600 is the trustworthy comparison.)

### `VJoyAnglePilots` — indicator pixel travel IS a literal FOV angle — 2026-07-21

Above confirms zero *flight* effect, but sc_webgl's own cosmetic indicator-size slider (F4 panel)
still needs to visually match SC's, and until now that mapping was an unverified guess (a fixed
150px radius linearly scaled by value/25). Two real measurements (harald, full yaw-right deflection,
FOV 116, UHD/3840px-wide monitor) close that gap:

| VJoyAnglePilots | indicator length |
|---|---|
| 25 | 570 px |
| 10 | 222 px |

Fit as `px = f * tan(degrees)` (the same pinhole projection `analysis/angle_convert.py` already uses
for landmark tracking): `f = 570 / tan(25°) ≈ 1222px`, which predicts VJA=10 → `1222 * tan(10°) ≈
215px` (measured 222px, ~3% off). That fitted focal length independently matches the *theoretical*
pinhole focal length for FOV_h=116°/width=3840 — `f = (width/2)/tan(FOV_h/2) = 1920/tan(58°) ≈
1200px` — within ~2%, without having been fit to these two points at all. That agreement (not just
a 2-point curve-fit) confirms **"degrees" is a literal horizontal FOV angle**: SC renders the vjoy
indicator's tip as if it were a fixed 3D point that many degrees off boresight, then projects it
onto the 2D screen through the same camera-perspective math used for everything else it renders.

**Applied:** `sc_webgl`'s indicator radius (`hud.ts`) now computes `f = (window.innerWidth/2) /
tan(116°/2)`, `radius = f * tan(vjoyRangeDegrees)`, replacing the old fixed-150px linear guess —
scales correctly to any window width, not just the 3840px reference capture.

### Gladius mouse yaw — dense deadzone-to-saturation sweep — 2026-07-22

Real SC, Gladius, Coupled, 0 m/s, `VJoyCombinedDeadZone` at default 4.45, sun-tracked (private
free-flight, clean starfield location, no occluding scenery). `mouse_hold_capture.py` staircases +
isolated single-magnitude probes (large offsets needed isolated single-shot clips with very short
dwell — a continuous multi-segment staircase above ~1500 counts rotates the ship fast enough to swing
the sun off-frame and permanently lose tracker lock partway through, contaminating later segments in
the same clip). `analysis/hold_rate.py`, arctan projection, FOV 116, 3840×2160@60fps.

| offset (counts) | yaw rate (°/s) | °/s per count |
|---|---|---|
| 25, 50 | 0 (within deadzone) | — |
| 100 | 0.52 | 0.0052 |
| 150 | 2.4 | 0.0159 |
| 200 | 4.2 | 0.0211 |
| 300 | 7.9 | 0.0265 |
| 400 | 11.6 | 0.0290 |
| 500 | 15.3 | 0.0307 |
| 600 | 18.7–19.0 | 0.0312 |
| 800 | 26.2 | 0.0328 |
| 1000 | 33.3 | 0.0333 |
| 1200 | 40.4 | 0.0337 |
| 1500 | 50.8 | 0.0339 |
| 1800 | 48.4, 49.6 (both directions, isolated probes) | — |

(A 2200 row from this sweep was dropped — it sat past yaw's ~1920 clamp, so it wasn't an independent
reading; see the clamp-boundary check below.)

Correlations 0.84–0.95 on the 100-1500 staircases; 0.92–0.95 on the isolated 1800 probes (each
direction shot as its own clip with a fresh sun-recenter, since a shared clip loses lock as above).
25/50 read exactly 0, consistent with the ~66.75-count deadzone threshold (4.45% of ~1500) landing
between 50 and 100.

**Shape:** per-count sensitivity climbs steeply and monotonically from the deadzone edge up to ~1500
(0.0052 → 0.0339, a 6.5× rise) — clearly convex, NOT the near-linear ramp the 2026-07-21 fit above
concluded (that fit only had dense data at 1200+, where the curve is already flattening, and
extrapolated the shape backward incorrectly). Then 1800 comes in slightly BELOW 1500's 50.8 (49.0
average of 48.4/49.6) rather than continuing to climb — both directions agree tightly (within ~1.2°/s),
so this looks like a possible slight peak-then-settle rather than measurement noise, but is worth a
repeat run to confirm before treating it as fact.

**Not yet done:** a proper curve fit against this full dataset (no fit attempted yet — the old
exponent/Kumaraswamy fit above is superseded, not replaced). Whatever formula is fit needs to explain
both the steep 100-1500 convexity AND the apparent 1500-2200 peak/settle, which a simple power-law or
Kumaraswamy saturating curve may not capture on its own.

### Repeat of 1300-2200 with multiple reps — 2026-07-22 (resolves the peak-then-decline question)

Same setup (Gladius, Coupled, 0 m/s, `VJoyCombinedDeadZone` confirmed 4.45, sun-tracked, FOV 116,
3840x2160@60fps), but isolated single-direction probes (`mouse_hold_capture.py --offsets 0,<M>`,
dwell 0.6s, ramp 0.15s) with **2 reps each**, re-centering the sun between every trial (a scripted
counter-rotation: return the stick to 0, wait ~2s for the ship's angular velocity to actually decay
— not just the stick input — then drive the inverse offset for the same dwell/ramp before the next
trial; confirmed via screenshot that this keeps drift bounded trial-to-trial). `hold_rate.py --skip
0.15` (default `--skip 0.7` silently produced an empty result table against this short 0.6s dwell —
the steady-state window `[hold_start+skip, hold_end]` was empty; not a tracking failure).

| offset | rep1 | rep2 | avg |
|---|---|---|---|
| 1300 | 43.83 | 42.17 | ~43.0 |
| 1500 | 50.55 | 50.07 | ~50.3 |
| 1600 | 50.36 | 50.94 | ~50.65 |
| 1800 | 49.75 | 50.42 | ~50.09 |

(2000 and 2200 rows from this repeat were dropped — both sit past yaw's ~1920 clamp, so they're
re-reads of the clamped ~1920 position, not independent data points; see the clamp-boundary check
below.)

**Resolved: the earlier apparent 1500-2200 peak-then-decline was a measurement artifact, not real ship
behavior.** With repeats, 1600/1800 read statistically indistinguishable from 1500 (~50-51 °/s
throughout), not declining — confirming harald's hunch in `YAWCAPTURE.md` that the single-shot
1800 reading (49.0) was noise from a rushed, very-short-dwell isolated probe. **The curve is
monotonic-to-flat: rises through the deadzone-to-1500 convex region, then plateaus flat from ~1500
through at least 1920** (independently confirmed at the clamp boundary itself — see below), consistent
with `fullDeflectionCounts ≈ 1500` as the real saturation point. No peak/decline shape needed in any
future curve fit.

**1800 confirmed with 3 more reps — 2026-07-23** (`mouse_hold_capture.py --axis yaw --offsets 0,1800`,
dwell 0.6s, ramp 0.15s, sun-tracked, counter-maneuver re-centering between every trial): **49.22,
43.04, 48.85 °/s** (align corr 0.967 / 0.941 / 0.955). Combined with the original pair (49.75, 50.42),
4 of 5 reps cluster tightly at **48.85-50.42 °/s** (mean ≈49.6) — the 43.04 outlier has the weakest
align correlation of the five (0.941 vs 0.955-0.975 for the rest) and a manual frame check of its hold
window showed the sun sweeping smoothly across frame with no visible lost-lock/occlusion, so it reads
as a `hold_rate.py` alignment artifact (a slightly-off `T0`) rather than genuine ship behavior. Treat
1800 ≈ **49.6 °/s** (the 4-rep cluster), consistent with 1500/1920's plateau; the 43.04 reading is
excluded from that average.

**Clamp-boundary check at 1920 counts — 2026-07-23 (confirms this data isn't clamp-contaminated).**
Per the top-of-file CRITICAL note, yaw's mouse-vjoy accumulator is predicted to clamp at ~1920 counts
(half the 3840px capture width) — the 2000/2200 rows above sit just past that and aren't independent
points. Redone at exactly 1920 (the predicted boundary itself), sun centered, `mouse_hold_capture.py
--axis yaw --offsets 0,1920 --dwell 0.8 --ramp 0.2`: **51.27°/s** (corr 0.975, clean, no lost-lock).
Matches the established ~50.8-51°/s plateau — confirms the plateau conclusion holds right up to the
clamp boundary, no contamination artifact the way pitch's old ~2000-count reading had (pitch's own
clamp is much lower, ~1080, so 2000 was far past it; yaw's clamp is ~1920, much closer to where the
existing 1500-2200 data was already gathered).

### Yaw input-curve exponent — fit against the full clamp-cleaned dataset — 2026-07-23 (item 4 for yaw: DONE)

Least-squares fit of the current `sc_webgl` model (rescaled deadzone + power-law exponent,
`axisCurve.ts`'s `shapeAxis`) against every clean yaw point above (dense 100-1500 sweep, the
1300-1800 repeats, and the 1920 clamp-boundary check — 15 points, deadzone edge through the clamp,
all contaminated >1920 rows excluded), `dz_frac = 0.0445`:

| model | full_range | exponent (a, b for Kumaraswamy) | max_rate | RMS |
|---|---|---|---|---|
| power law (current model) | 1490.8 | 1.011 | 50.51 °/s | 0.455 °/s |
| Kumaraswamy (saturating superset) | 1516.6 | a=1.048, b=1.077 | 50.53 °/s | 0.410 °/s |

Both models land on essentially the same answer (RMS differ by only 0.045 °/s across a 0-51 °/s
range) and both come out **within noise of exponent≈1 (linear)** — the Kumaraswamy fit's a/b are
also both ≈1, which reduces it to the same near-linear power law. **No saturating/non-power-law
shape is needed**, and `full_range` (1491/1517) independently confirms the already-used 1500.

**Resolves the "6.5× per-count sensitivity rise" question from the dense-sweep section above**: that
rise is almost entirely the deadzone *rescaling* (dividing by `full_range − dz` pushes low counts
into a small fraction of stick range near the deadzone edge), not curve convexity — once the model
already accounts for that (as `shapeAxis` does), the residual shape is close to flat/linear.

**Applied:** `axisCurve.ts`'s `DEFAULT_EXPONENT` updated from the previously-*unconfirmed* 1.04 to
the now-fitted **1.011** (rounded to 1.01) — a small change in practice, but now backed by an actual
least-squares fit against the full deadzone-to-clamp dataset rather than an earlier guess.

**Pitch is explicitly NOT covered by this fit** — see next section; it needs its own separate fit
and dataset, and isn't ready to commit to code yet.

### Pitch input-curve exponent — attempted fit, inconclusive — 2026-07-23

Same fit method applied to the pitch sweep (100-1080 counts, from "PITCH curve shape" above) does
**not** cleanly converge: unconstrained, the fit wants `full_range≈1568` — well past the
independently-confirmed ~1080 bisection saturation point — because the 900/1050-count readings
(50.12, 55.52) dip below neighboring points (1000 → 58.53) in a way no monotonic curve can
reproduce; this is very likely single-rep measurement noise (flagged as such in "PITCH curve shape"
above), not real ship behavior. Re-run with `full_range` pinned to 1060-1120 (respecting the
bisection-confirmed saturation point): fit pushes to the bound (1120), exponent≈0.90, RMS 2.11 °/s —
roughly 4-5× worse than yaw's fit (relative to pitch's larger ~65 °/s range) and still visibly
fighting the 900/1050 dip.

**Conclusion: pitch's own exponent is NOT confirmed.** The shape trends concave-ish (exponent
<1, opposite of yaw's ~linear) rather than the originally-expected convex/expo shape, which is
consistent with the earlier "PITCH curve shape" finding that pitch rises much faster than yaw
relative to its own ceiling at low counts — but the fit quality isn't good enough to commit a
number to `axisCurve.ts`. **Before touching any pitch-specific curve code:** repeat 900/1000/1050
(and ideally fill in 400/500 too) with multiple reps each, the same way yaw's item-1 redo resolved
its own single-rep noise. No pitch exponent has been applied to code pending that.

### Full-360° sustained-hold validation — 2026-07-23

Independent cross-check of the established plateau rates, orthogonal to the short-hold tracking
method: drive a continuous yaw hold at a fixed offset for `T = 360 / rate_established` seconds, then
compare the sun's screen position before vs. after. A fixed background point should return to the
exact same apparent screen position after one true 360° revolution — no continuous tracking needed
(the sun is out of view for most of the turn), just a before/after angle comparison via the same
arctan projection. 2 reps per offset, sun re-centered between reps via the standard counter-maneuver.

| offset | rep1 implied rate | rep2 implied rate | avg implied | established (short-hold) | gap |
|---|---|---|---|---|---|
| 1500 | 49.86 | 50.07 | 49.97 | 50.8 | ~1.6% |
| 1800 | 47.50 | 47.50 | **47.50** | 49.6 | ~4.2% |
| 1920 | 50.86 | 50.77 | 50.82 | 51.27 | ~0.9% |

1500 and 1920 both land consistently ~1-1.6% under their established short-hold rate across both
reps — small, plausibly just a mild systematic bias in this sustained-hold test method itself (e.g.
`SendInput` scheduling drift accumulated over a continuous ~7s hold), not necessarily a real
rate difference. **1800 doesn't fit that trend** — a much larger gap (4.2%) than its neighbors, but
perfectly reproduced both times (47.50°/s exactly twice) — not noise, but also not part of a smooth
pattern across offsets. Given 1800's own short-hold dataset was already the noisiest of the three (5
reps ranging 43.04-50.42, one discarded as an outlier before this test — see "1800 confirmed with 3
more reps" above), the established 49.6°/s value is judged the less trustworthy number here, not
1800 itself being physically anomalous.

**Decision: don't reproduce 1800's odd short-hold reading in `sc_webgl`.** For the yaw plateau,
use the 1500/1920-anchored value (roughly 1° per second more than the raw short-hold numbers, per
the small consistent gap both showed) rather than chasing the 1800 discrepancy.

**Speculative, NOT measured, no further capture planned:** one theory is that the gap relates to
spool-up time rather than hold duration — every 360°-test here starts from rest, so each includes a
spool-up transient; if the ship were already at full rotational speed before the timed window began,
retries might read more consistent constants. Not going to be investigated further. If any more data
collection happens on this axis, it should prioritize additional points at the LOWER end of the curve
(deadzone-to-1500 convexity — the actual open item for the curve refit) rather than this high-end
discrepancy.

**Not yet done:** the pitch sweep — see `YAWCAPTURE.md`'s remaining open items. (The reversal-transient
wobble vs. a static control clip is done — see below.)

### Reversal-transient wobble vs. a static control clip — 2026-07-22 (item 2: is it a tracking artifact?)

Captured a STATIC control clip (ship held perfectly still, mouse offset 0 for 8s, same sun-tracking
pipeline, `mouse_hold_capture.py --offsets 0 --dwell 8`) to establish the tracker's own noise floor
before trusting the fast/slow reversal's reported "~1-1.5s post-transition settling wobble (~±0.5-1°/s
ringing)" (see "fast vs slow reversal transient" above) as real ship behavior rather than a tracking
artifact.

**Static baseline noise floor** (sun-tracked, `track_landmark.py` + `angle_convert.py`, no commanded
motion at all): two components, neither matching the reversal wobble's character —
- A smooth, low-amplitude **idle sway**: period ~3.8-4s, amplitude ~±0.15-0.2°/s. Repeatable across 3
  cycles in one clip, so a real (likely intentional) cockpit-camera idle animation, not random noise.
- Rare **single/double-frame tracking glitches**, up to >1°/s, non-periodic, isolated (one seen in an
  11s clip, lasting ~2 frames).
RMS over the whole clip: 0.28°/s; range −3.3 to +3.3°/s (the one glitch spike).

**Re-examined the original fast/slow reversal clips properly** (`data/indicator/gladius-reversal-
fast-20260722-011559`, `-slow-20260722-011755`) — a first attempt at this re-check mapped `segments.json`
times directly onto video-frame times and got nonsense (an apparent decay-to-zero mid-hold that isn't
physically possible under a constant commanded offset). Cause: skipped the sync-alignment step
`hold_rate.py` normally does (cross-correlating the tracked speed envelope against the commanded
`|offset|` envelope to find T0, since the video's own t=0 doesn't line up with script time — OBS
start/settle latency). Redone via `hold_rate.py`'s own `analyze()` (imported directly to get T0): T0≈
3.22s (fast), 3.24s (slow), both corr >0.96.

With correct alignment:
- **Fast (0.05s ramp):** crosses zero ~8.35s (real video time), overshoots to +9.77 (steady is
  ~+8.08, so ~20% overshoot) by ~8.87s, undershoots to ~+7.0 by ~9.3s, a smaller second overshoot to
  +9.5 by ~9.67s, settles to steady ~+8.0-8.2 by ~9.8-10.0s. A clean two-cycle damped oscillation —
  the textbook shape of an underdamped second-order step response.
- **Slow (2.0s ramp):** the ramp itself crosses zero smoothly (~13.1-13.4s, matching the previously-
  documented flat-through-deadzone shape), then a longer, noisier ringing from ~14.3s to ~16.6s (over
  2s), oscillating roughly ±1-1.5°/s around the ~8°/s steady value before the hold segment ends.

**Conclusion: the reversal wobble is real, not a tracking-method artifact.** Its amplitude (~1-2°/s
peak deviation) and duration (~1-2s, multiple correlated cycles) are well above the static clip's
demonstrated noise floor (±0.15-0.2°/s slow idle sway, or an isolated <2-frame glitch spike) — a
fundamentally different signal character, not explainable by either static-baseline noise mode.
**Confirms a genuine flight-model transient** (a higher-order/underdamped response), not the simple
first-order exponential-lag `flightModel.ts` currently codes — worth modeling eventually, not
dismissing as measurement noise.

**Still open:** this is still one rep each (fast/slow) — the fast case looks like a fairly clean 2nd-
order underdamped step (a candidate for a damped-oscillator fit); the slow case's ringing is noisier/
less clean, unclear if that's a real effect of the slower ramp or just more tracking noise on that
particular take. Only tested at 300-count magnitude (matching the original clips) — unknown whether
the ringing's amplitude/shape scales with offset magnitude or ramp duration; not yet checked at the
1500+ magnitudes from the sweep above. Not acted on in code (`flightModel.ts` is ported-verbatim — an
equation-family change needs an explicit go-ahead, per the roll transient's same gating in the ROLL
section below).

**Method note:** for any large-offset (1500+) probe, use an ISOLATED single-magnitude clip
(`mouse_hold_capture.py --offsets 0,<value>`) with a short dwell (~0.3-0.4s) and re-center the sun
in-game before each one — a multi-segment staircase at these magnitudes reliably loses landmark lock
partway through and silently produces bogus near-zero or contaminated readings for later segments
(confirmed: a combined ±1800/±2200 staircase clip lost lock after the first large excursion and
produced a garbage near-zero reading for the next segment, with no automatic flag catching it).

### Gladius mouse yaw — fast vs slow reversal transient — 2026-07-22 (preliminary, needs repeat)

Real SC, Gladius, same setup as above. Held +300, then reversed to -300 via `mouse_hold_capture.py`'s
`--ramp`, once near-instant (0.05s) and once slow (2.0s), sun-tracked at fine time resolution through
the transition (not just the per-hold steady-state median `hold_rate.py` normally reports).

**Method gotcha (cost real time, worth flagging):** `segments.json`'s `t_start` marks when the ramp
**completes** and the hold begins, NOT when the ramp starts — using it directly as the reversal
instant makes a slow ramp look like it lags far more than it really does. Correct reference point is
`t_start - ramp_duration`.

With that corrected: **both fast and slow reversals track the commanded input smoothly and
monotonically through the crossing itself** — no dramatic overshoot right at zero in either case.
- Fast (0.05s ramp): rate crosses zero within ~0.03-0.05s of the flip, reaches the new ~8°/s steady
  value within ~0.4s.
- Slow (2.0s ramp): rate decays smoothly from -8 toward 0 as the stick ramps through the deadzone
  (~0 by ~0.8s into the ramp), sits flat near zero through the deadzone crossing (~0.8-1.2s), then
  rises smoothly back to ~8°/s by ~2.3s (close to when the 2s ramp itself finishes).

**Common to both:** a **~1-1.5s post-transition settling wobble** (roughly ±0.5-1°/s ringing around
the new steady value) before fully locking in — present in both the fast and slow case, so it doesn't
look like a reversal-speed-dependent effect. Could be a genuine flight-model characteristic or a
tracking-method artifact (worth checking against a completely static comparison clip before trusting
it as real ship behavior).

**⚠ Preliminary — only one run each of fast/slow, should be repeated to confirm before relying on
these numbers or the wobble finding for any model change.**

### Input-curve shape — CONVEX / expo — 2026-07-19 (confirmed)

Gladius, steady-plateau yaw rate, proper arctan projection, deadzone at default 4.45:

| mouse offset | yaw °/s | °/s **per count** |
|---|---|---|
| ±150 | 2.47 | 0.0164 |
| ±300 | 7.92 | 0.0264 |
| ±450 | 13.48 | 0.0300 |
| ±600 | 19.00 | 0.0317 |

- **The mouse input curve is CONVEX (expo), not linear.** Per-count sensitivity nearly doubles from
  ±150 to ±600; the trend holds across the small low-excursion points (150/300/450 at only −5/−16/−29°
  off-axis), so it is not a projection artifact. **Power-law fit exponent ≈ 1.48** (1.0 = linear).
  Since the flight model's steady rate is linear in deflection, the convexity lives in the
  mouse→deflection mapping — SC applies an expo curve to mouse virtual-joystick input. Echoes the
  vJoy-*device* nonlinearity in BLUEPRINT.md (½ deflection ≈ ⅔ rate). **This is the shape to
  reproduce in `sc_webgl`'s mouse mode.**

  **⚠ This fit alone overshoots badly when extrapolated to full deflection (see "OPEN, ACTIVE
  (2026-07-21)" in STATUS above) — a single exponent isn't the whole story; treat the 1.48 value as
  descriptive of the 150-600 range only, not yet as the value to hardcode.** Also, this dataset was
  read with `analysis/hold_rate.py`'s old crude linear pixel→angle conversion (now fixed) — the
  absolute numbers above weren't recomputed with the arctan fix, only the extrapolation check was.

### Cross-ship gain — 2026-07-19

Same mouse offset, different ships (±600, proper projection): **Taurus 7.02 °/s vs Gladius 19.00 °/s
(~2.7×).** The mouse→deflection **input** mapping (incl. the expo curve above) is ship-independent;
the ship's **deflection→rate** gain scales with agility (light fighter ≫ heavy freighter). To recreate
per ship: same expo input curve, ship-specific gain.

**Crude-factor caveat:** absolute °/s reported in this session *before* the arctan fix were ~1.58×
too low (linear `FOV/width`); same-excursion comparisons/conclusions are unaffected.

### `VJoyCombinedDeadZone` — REAL flight setting (near-center dead region) — 2026-07-19

Attributes.xml default `VJoyCombinedDeadZone="4.45"`. **Confirmed it affects flight** (Gladius, ±300
counts, proper projection):

| deadzone | yaw at ±300 | pad moved |
|---|---|---|
| 4.45 | 7.76 °/s | 359 px |
| **20** | **0.04 °/s (dead)** | **3 px** |

At deadzone 20, ±300 counts is **inside the dead region** — zero yaw. At 4.45 the same offset gives
full response. So unlike `VJoyAnglePilots`, this one is a genuine input setting and **must be
reproduced**.

**What "20" almost certainly means:** a **percentage of full stick range** — the innermost 20% of
deflection is dead. (Default `4.45` is a precise percentage-looking decimal; fits the evidence.) If
so, reproduction needs **no counts→units conversion** — the % maps straight onto our normalized
−1..1 input:

```
// rescaled deadzone, dz = value/100 (e.g. 0.20)
deadzoned(i) = (|i| <= dz) ? 0 : sign(i) * (|i| - dz) / (1 - dz)
```

**CONFIRMED it's a percentage** (Gladius, dz=20 reappearance sweep):

| offset | dz = 4.45 | dz = 20 |
|---|---|---|
| ±300 | 7.92 °/s | 0.04 (dead) |
| ±450 | 13.48 °/s | 2.80 |
| ±600 | 19.00 °/s | 9.47 |

At dz=20 yaw reappears between ±300 and ±450 → **threshold ≈ 300 counts**. Threshold ratio
`300 / ~67 ≈ 4.48` matches the setting ratio `20 / 4.45 = 4.49` — so the dead region scales **linearly
with the setting value**, i.e. it is a **percentage of full stick range**. This also pins **full
mouse range ≈ 1500 counts** (300 = 20% of 1500; 4.45% × 1500 ≈ 67, consistent with yaw already
present at ±150 on the default). ⟵ supersedes the earlier ~2585 guess.

**Reproduction:** `VJoyCombinedDeadZone = D` → apply a **D% deadzone** to normalized −1..1 input
(the `deadzoned(i)` formula above with `dz = D/100`). Directly usable; no counts needed.

**Still open — rescale vs hard-cut:** whether SC rescales `[dz,1]→[0,1]` (formula above) or hard-cuts
(`max(0,|i|−dz)`). The dz=20 vs 4.45 ratios at ±450/±600 fall between the two predictions (model
uncertainty in full-range + expo exponent), so it's not resolved. Distinguishing needs
**near-full-deflection** rate at both deadzones — best on the **Taurus** (3× lower gain keeps large
offsets on-screen; Gladius swings the landmark off-frame). Practically the difference is small near
center; use the rescaled form unless the Taurus test says otherwise.

_(Esc-reset in `win_focus` was silently failing until 2026-07-19 — `SendInput` rejected the keyboard
event because the INPUT struct was 32 B instead of 40 B on 64-bit; fixed. Residual-deflection drift
before that fix may have biased some early holds.)_

### Gladius ROLL — keyboard Q/E, confirms coded spec — 2026-07-19

**First clean keyboard-roll capture.** Method differs from the mouse/yaw work above: roll is
keyboard-only (Q=left, E=right), and the landmark is tracked by **ORIENTATION not position** — see
"Method" note below. Captured in the **PU at Security Post Kareah** (an empty AC starfield has no
usable landmark; Kareah is a long lit post that reads a clean long-axis angle). Gladius, Coupled,
0 m/s, motion blur OFF, OBS 50 Mbps H.264 4K60.

Full sequence `Q:1.0,_:1.5,E:1.0,_:1.5,Q:1.0,E:1.0,_:1.5` (spool→steady, release→roll-end, then
direct Q→E reversal). Auto-detected settle offset 1.52 s; elongation stayed 2.7–4.3 (never lost
lock). Data: `data/roll/kareah-full-20260719-142536/`.

| Phase | Measured |
|---|---|
| Max steady roll rate (Q, left) | **+192, +196 °/s** (two reps) |
| Max steady roll rate (E, right) | **−191 °/s** — symmetric |
| Spool-up | press → ~192 °/s in **~0.5 s** |
| Roll-end (release → stop) | 192 → 0 in **~0.5 s**, then flat at 0 |
| Reversal (Q→E, no coast) | keeps old direction ~0.5 s, crosses zero, reached only −96 °/s in the 1 s E-hold |

**Validates the ported spec — no retune needed.** Coded `maxAngVel.roll = 3.49 rad/s = 199.96 °/s`,
`tau_roll ≈ 0.28 s` (`shipTypes.ts:184`, `:43-44`). A 1.0 s hold with that τ should reach
`200·(1−e^(−1/0.28)) = 194 °/s` — measured 192–196. Near-exact; this independently confirms the
Gladius roll tuning ported from the original. Boost roll (`boostMaxAngVel.roll = 240 °/s`) was NOT
what we measured — "AB 100%" is the afterburner-fuel readout, not an active boost hold; the ~192
matches the non-boosted 200 spec.

**Longer-hold refinement — 3 s holds** (`data/roll/kareah-long-20260719-143343/`, seq
`Q:3.0,_:3.0,E:3.0,_:3.0,Q:2.5,E:2.5,_:3.0`, zero lost-lock frames): the plateau reaches
**±202 °/s** (Q +201.6/+194.8, E −202.5/−209.4) — lands dead on the coded 199.96 °/s. The 1 s holds
undershot to 192–196 exactly because τ hadn't elapsed, as expected. **Steady roll rate = coded spec,
confirmed to <2%.**

**Boosted roll — confirms the boost spec — 2026-07-19.** Holding boost (bound to **right mouse** here;
`roll_hold_capture.py --boost`, default RMB) for the whole sequence
(`Q:3.0,_:2.5,E:3.0,_:2.5`, `data/roll/kareah-boost-20260719-144719/`): steady **+234.7 / −237.1 °/s**
vs the ±202 non-boosted. Coded `boostMaxAngVel.roll = 4.189 rad/s = 240 °/s`; 235–237 is within ~2%
(3 s hold ≈ 98% of the 240 asymptote). **So current SC does raise angular authority under boost —
the coded 240 is correct, not stale.** (18/775 frames lost lock to slight boost-induced drift; the
steady medians are unaffected, the ~350 °/s peaks are those spurious frames only.)

**Decoupled roll == coupled roll — 2026-07-19.** Same setup, decoupled mode ON (verified via the HUD
`CPLD` checkbox unchecked; `data/roll/gladius-decoup-roll-20260719-145516/`, seq
`Q:1.0,_:3.0,E:2.0,_:3.0`): after each release the roll **still hard-stops in ~0.6 s** (flat plateau,
no continued spin) and the Q→E switch is unchanged. **SC's decoupled mode does NOT remove rotational
(RCS) damping — it decouples LINEAR velocity only.** Scoping consequence for `sc_webgl`: decoupled
needs to change only the translation model (keep drifting); the angular model (roll/pitch/yaw rates,
spool, auto-stop) is shared between coupled and decoupled. Also settles the earlier ambiguity by
elimination — the coupled roll-stop is an always-on damping/assist, present with flight-assist
nominally "off", i.e. it's baked into the rotational flight model, not a coupled-only governor.

**Transient shape — mixed drag/governor (BLUEPRINT "spin-up vs coast-down conflation", still open).**
Fits on the raw (non-savgol) unwrapped angle:
- **Spool-up** (0→200): exponential-approach (drag) fits better than a const-accel-to-clamp
  (governor) ramp — **τ ≈ 0.20 s** (RMS 1.9° vs 2.7°).
- **Release decel** (200→0): the opposite — **linear/governor fits as well or better** (E1 clearly
  0.52° vs 1.26° RMS; Q1 a toss-up), stops **hard in ~0.5 s** with only **~40 ° roll-out**, *less*
  than the coded exponential-drag tail (200·τ = 56 °) and with a real stop rather than an asymptote.
- **Reversal** (Q→E, no coast): completes — crosses zero and reaches near-full −190 °/s ≈ 0.9 s after
  the E press; E2 plateau −209 °/s.

So spool-up looks drag-like, coast-down looks governor-like — consistent with the two having
**different transient character**, which is exactly the open question. Two caveats before anyone acts
on this: (1) the fitted **τ ≈ 0.20 s is below the coded 0.28 s** (from the vJoy-device 360° times) —
real or a moment-tracker/aliasing bias, unresolved; (2) `flightModel.ts` is flagged **ported-verbatim**
in CLAUDE.md — a drag→governor change is an equation change needing explicit go-ahead (BLUEPRINT
"Not doing without a decision"), NOT a data-collection follow-up. **Recommendation: leave the model
as-is; the steady spec is confirmed and the transient asymmetry is a flag for a future dedicated
pass** (lighter smoothing, more reps, clean reversal alignment — the current reversal extraction hit
an unwrap glitch at the Q→E boundary that needs a cleaner slice).

**Method — orientation tracking (new):** `roll_hold_capture.py` drives a scripted Q/E schedule by
scan-code `SendInput` (Q=0x10, E=0x12), focuses SC **without** the reticle-click (`focus_no_click`,
so nothing fires into the station) and **before** OBS starts (no menu/flicker in-clip; the Esc-reset
is off for roll — it opens the pause menu into the clip and keyboard roll needs no reset).
`analysis/track_orientation.py` reads the post's **long-axis angle** each frame (intensity-weighted
principal axis / 2nd moments), `--mask-below <y>` zeroes the screen-fixed radar dish that occludes
the post's lower end, then mod-180 unwrap (via angle-doubling) + savgol-differentiate → roll rate.
Orientation is position-independent, so the post is kept CENTERED (stays framed for a full rotation,
never orbits behind the cockpit) — the opposite of the off-center rule that a POINT landmark needs.
Run used: `--seed-x 1935 --seed-y 1010 --window 150 --floor-pct 88 --mask-below 1200`.

### Gladius PITCH/YAW (mouse) + afterburner ×1.2 on all rotational axes — 2026-07-19

Measured via the MOUSE virtual joystick (pitch/yaw have no keyboard bind): full-deflection held mouse
offset (`mouse_hold_capture.py --axis {yaw,pitch} [--boost]`, boost = RMB), tracking the **sun**
(centered bright point in the AC map) as it sweeps across screen → `track_landmark` → `angle_convert
--axis x|y` (arctan projection, FOV 116). Data in `data/angular/`. Pointer accel re-pinned for 1:1.

| axis | non-boosted | boosted | ratio | coded (nb / boost / mult) |
|---|---|---|---|---|
| yaw | 49.2 °/s | 61.1 °/s | 1.24 | 52 / 62.4 / 1.2 |
| pitch | 61.3 °/s | 70.8 °/s | 1.15 | 68 / 81.6 / 1.2 |

Absolutes read ~5–13% below coded — a consistent **projection systematic** (the sun swings to large
off-axis bearings, ~-50°, where small tracking error amplifies; ratios cancel it). The two boost
**ratios bracket the coded 1.2**, and with roll (200→235 ≈ ×1.18) this **confirms the afterburner
applies a ~1.2× multiplier to ALL THREE rotational axes** (= `afterburner.*_boost_multiplier` 1.2 in
the star-citizen.wiki API; matches coded boostMaxAngVel). Gotchas: **(1)** mouse offset ≥ ~2000 fully
saturates BOTH pitch and yaw (an early "pitch needs more deflection" read was wrong — it was
lost-lock contamination, not undersaturation); **(2)** filter tracked frames by `peak_brightness`
before fitting — when the sun exits frame it BOUNCES and those stationary bogus frames wreck a naive
slope fit; **(3)** yaw/pitch rotate the ship off the landmark, so re-center on the sun between runs.

**⚠ PITCH row superseded (2026-07-23) — the ~2000-count drive was past pitch's real ~1080 clamp.**
Per the top-of-file CRITICAL note, pitch's mouse-vjoy accumulator saturates at ~1080 counts (half the
3840×2160 capture's height); the original 61.3/70.8 pitch readings above were driven at ~2000,
overshooting that clamp, so their absolute values are contaminated (yaw's row is unaffected — 2000 is
much closer to yaw's own ~1920 clamp with less relative contamination). Redone clean at 1080 counts
(`mouse_hold_capture.py --axis pitch --offsets 0,1080`, sun-tracked, FOV 116, 3840×2160, Gladius,
0 m/s): landmark seeded off-center (not screen-center — the reticle itself sits there) with margin
biased in the direction of travel (sun placed ~33% up from the bottom of frame before the hold, since
this pitch direction sweeps the landmark upward), dwell shortened (1.0s unboosted / 0.7s boosted) so
the hold completes before the landmark exits frame — pitch's high rate-per-count sweeps a sun
placed even with generous margin off-frame within ~1.5s (unboosted) or sooner (boosted). Ship's
attitude re-nulled between runs via a mirror-image counter-maneuver (opposite offset, same
dwell/ramp, **and same boost state** — a non-boosted counter under-corrects a boosted hold's larger
rotation, confirmed directly: left a ~90px residual landmark offset until redone with boost held to
match).

| condition | offset (counts) | rate (°/s) | align corr |
|---|---|---|---|
| non-boosted | 1080 | **64.86** | 0.920 |
| boosted (RMB) | 1080 | **71.11** | 0.970 |

Ratio 71.11/64.86 = **1.096×** — notably lower than both the old contaminated reading's ratio (1.155)
and the coded `boostMaxAngVel` ratio (1.2). Both rows are clean single-rep reads (`hold_rate.py` flagged
both holds `ok`, no lost-lock/excursion) but not yet repeated — treat the absolute values as solid, the
1.096 ratio as provisional pending a repeat rep before revising the coded 1.2 afterburner multiplier.

**⚠ YAW row above also superseded (2026-07-23) — the original 61.1°/s boosted reading was driven at
~2000 counts, past yaw's own ~1920 clamp.** Same issue as pitch's original row: contaminated by the
overshoot/desync mechanism, so its 1.24 ratio isn't trustworthy either. See next section for the clean
redo.

### Yaw afterburner ratio — clean redo at the 1920 clamp boundary — 2026-07-23

Real SC, Gladius, Coupled, 0 m/s, sun-tracked, `mouse_hold_capture.py --axis yaw --offsets 0,1920
--boost --dwell 0.8 --ramp 0.2`, `hold_rate.py --skip 0.2`, same seed/FOV/resolution as the
non-boosted 1920 clamp-boundary check above. Recentered via a **boosted** mirror-image counter
(`--offsets 0,-1920 --boost`, same dwell/ramp) after every hold, confirmed via screenshot each time —
matches the established rule that a counter-maneuver must replicate the original's boost state or it
under/over-corrects.

| rep | rate (°/s) | align corr |
|---|---|---|
| 1 | 53.29 | 0.975 |
| 2 | 53.22 | 0.972 |

Both reps agree tightly (53.22–53.29, avg **53.26 °/s**). Compared against the non-boosted 1920
reading reproduced with the identical method/skip (**50.41 °/s** — a hair under the originally-quoted
51.27 because that number likely used a different `hold_rate.py --skip`; both are within the method's
known ~1-2% noise band, see the 360°-validation section below): **ratio = 53.26 / 50.41 ≈ 1.057×.**

**This now gives a real per-axis afterburner picture, all measured at clamp-safe offsets:** roll
1.18×, pitch 1.096× (single rep), yaw 1.057× (2 reps) — **all three measurably BELOW the coded uniform
1.2× `boostMaxAngVel` multiplier**, not just pitch. The earlier "confirms ~1.2× applies to all three
axes" conclusion (from the original, now-superseded pitch/yaw rows above) no longer holds now that
both rows have been redone clean of clamp contamination. Roll's 1.18 is closest to coded; yaw and pitch
both run visibly lower. **Not yet acted on in code** (`shipTypes.ts`'s `boostMaxAngVel` is ported-
verbatim, needs an explicit go-ahead) — flagging as a real, multi-axis pattern rather than a single-axis
anomaly, and worth a repeat rep on pitch (still single-rep) before treating the exact 1.057/1.096/1.18
spread as final.

### Pitch afterburner ratio — repeat reps, 2026-07-23 (resolves the "still single-rep" flag above)

Same setup as the original pitch-1080 captures (real SC, Gladius, Coupled, 0 m/s, sun-tracked, FOV
116, 3840×2160). Non-boosted repeated at the original dwell/ramp (1.0s/0.2s couldn't be reused as-is
from a re-centered/dead-center starting position — see method note below — so the boosted-short
timing, 0.7s/0.15s, was used for the clean non-boosted repeat too):

| condition | rep | rate (°/s) | align corr |
|---|---|---|---|
| non-boosted | original | 64.86 | 0.920 |
| non-boosted | repeat | 64.73 | 0.949 |
| boosted | original | 71.11 | 0.970 |
| boosted | repeat | 66.72 | 0.977 |

Non-boosted reps agree tightly (64.73 vs 64.86, <0.2% apart) — a clean confirmation. **Boosted reps
disagree more than expected (66.72 vs 71.11, ~6.2% apart) despite both having excellent align
correlation (0.97-0.98) and both frame-checked clean (no visible landmark clipping through the hold
window)** — this looks like genuine rep-to-rep measurement noise on this specific hold rather than a
tracking artifact, consistent with the spread already seen elsewhere in this dataset (e.g. yaw's 1800-
count reps ranged 43.0-50.4, a wider spread than this). Averaging both clean boosted reps (71.11,
66.72) → **68.92 °/s**, vs the two non-boosted reps averaged (64.86, 64.73) → **64.80 °/s**: **ratio ≈
1.064×** — now landing very close to yaw's freshly-measured 1.057×, both well below roll's 1.18× and
the coded 1.2×.

**Updated per-axis afterburner picture:** roll 1.18 (2+ reps), yaw 1.057 (2 reps), pitch ~1.064
(2 clean reps, averaged) — **yaw and pitch now agree closely with each other (~1.06) and both sit
clearly below roll**, which itself sits closest to the coded 1.2. Still not acted on in code (gated).
A third pitch-boost rep would help resolve whether 71.11 or 66.72 is the closer-to-true value, but
isn't essential — the averaged ratio already lines up with the independently-measured yaw ratio, which
is a good cross-check in itself.

**Method note — dwell must be shorter than the original session's when starting from a re-centered
(vs. originally biased-off-center) position.** The original pitch-1080 captures benefited from
whatever attitude the ship happened to be at from prior maneuvers in that same session (effectively
giving the landmark extra margin before the hold). Starting fresh from dead-center with the
original's dwell/ramp (1.0s/0.2s non-boosted, 0.7s/0.15s boosted) let the sun clip the canopy frame
right at the tail of the hold window on the first attempt in each case — confirmed by pulling frames
across the hold window and watching the landmark visibly approach/clip the cockpit structure exactly
when the contaminated reading came from. Shortening dwell further (0.7s/0.15s non-boosted, 0.55s/
0.12s boosted, both starting from dead-center) kept the landmark clear through the whole window
(confirmed by the same frame-by-frame check) and reproduced the original non-boosted number almost
exactly. **Takeaway for future pitch captures starting from a neutral/centered attitude: use a
shorter dwell than whatever a similar prior session used, and verify by pulling frames across the
computed hold window before trusting a reading**, especially for boosted holds (faster sweep needs
even more margin) — `hold_rate.py`'s `ok` flag and a good align `corr` do NOT reliably catch this kind
of tail-of-window edge-clipping on their own (both contaminated reads in this session still reported
`ok`; only manual frame inspection caught it, once by a very large discrepancy in the resulting rate
and once because the same short dwell that worked once didn't automatically guarantee margin at a
faster boosted rate).

### Pitch UP direction (opposite sign) — non-boosted matches DOWN closely; boosted ratio inconclusive — 2026-07-23

Every pitch-1080 capture up to this point drove the same offset sign ("pitch down" by this project's
convention — the direction that sweeps the sun UP-screen). To check directional symmetry, captured the
opposite sign ("pitch up" — sweeps the sun DOWN-screen), sun manually positioned near the top of frame
first (seed ~(1920,192), giving the sun room to travel down) so the same short-dwell method applies
without needing a calculated reposition.

| condition | rep | rate (°/s) | align corr |
|---|---|---|---|
| non-boosted, UP | 1 | 66.78 | 0.969 |
| non-boosted, UP | 2 | 66.97 | 0.918 (frame-checked clean; corr alone was borderline) |
| boosted, UP | 1 | 66.98 | 0.952 (frame-checked clean) |
| boosted, UP | 2 | 62.49 | 0.949 |

**Non-boosted UP reps are tight (66.78/66.97, <0.3% apart) and both frame-verified clean** — a solid
reading. Compared against non-boosted DOWN's own tight pair (64.86/64.73, avg 64.80): **UP runs ~3.2%
faster than DOWN** (66.88 vs 64.80 avg). Since each direction's own reps agree far more tightly (<0.3%)
than the 3.2% gap between directions, **this looks like a real small pitch UP/DOWN rate asymmetry**,
not noise — plausibly the same kind of per-direction thruster asymmetry already confirmed for the
LINEAR axes (see "Vertical up" and forward/back sections below: accel/decel differ by commanded vs.
opposing thruster authority per direction). Not yet explained mechanistically for a rotational axis,
and only 2 reps per direction — worth a 3rd rep before treating 3.2% as a precise number, but the
direction of the effect (UP > DOWN) looks real.

**Boosted UP is NOT a clean read — the two reps straddle the non-boosted rate** (66.98 above, 62.49
below the ~66.88 non-boosted average), both individually frame-checked clean with decent align corr
(0.95-ish). Averaging gives boosted UP ≈ 64.74, i.e. **numerically BELOW non-boosted UP** — physically
implausible for boost to reduce rate, so this is read as 2-rep noise dominating the average, not a real
sub-1.0 ratio. The ~6-7% spread between these two boosted-UP reps matches the spread already seen in
boosted-DOWN's 2 reps (71.11 vs 66.72, ~6.4% apart) — **boosted-pitch measurements carry roughly ±6-7%
rep-to-rep noise in general**, not a direction-specific issue. DOWN's 2 reps happened to both land above
non-boosted (giving a clean-looking 1.064 ratio); UP's 2 reps happened to straddle it. **Conclusion: the
data available now cannot distinguish whether pitch's true afterburner ratio differs by direction** —
both directions' true ratio is probably in the same rough 1.0-1.1 range as yaw (1.057) and pitch-DOWN's
average (1.064), but pinning it tighter than that needs 3+ reps per direction, not 2.

**Practical takeaway:** don't read too much into either boosted average as a precise number yet. The
qualitative conclusion (roll's ~1.18 is the outlier; pitch and yaw both sit close to ~1.0-1.1, well
below the coded 1.2) still holds and is now checked in both pitch directions, not just one.

### Spool-up transient is a 2nd-order underdamped step response, not the coded 1st-order lag — 2026-07-23

The actual point of all this capture work (per harald's framing): the coded/API steady-state rates
are ground truth for a ship that's *already spun up* — what's actually unmeasured is the **spool-up
time**, i.e. how the rate rises from 0 to that steady value when input is first applied. Captured this
directly (not inferred from a single steady-state snapshot): held a fixed full-deflection offset with
a fast ramp (0.05s, approximating a step input) and read the full **rate-vs-time rise curve** via
`track_landmark.py` + `angle_convert.py`'s differentiation, for all 4 conditions (pitch/yaw ×
non-boosted/boosted).

**Every condition's rise curve shows a real, visible overshoot-and-settle wobble** — not a clean
monotonic approach to steady state. This matches (and generalizes) the reversal-transient wobble
already found on yaw (see "fast vs slow reversal transient" and its static-control-clip confirmation
below) — turns out it's not reversal-specific, it shows up on a plain forward spool-up too. Fit both
the currently-coded model (1st-order exponential lag, `rate_ss·(1−e^(−t/τ))`) and a 2nd-order
underdamped step response (`rate_ss·(1 − e^(−ζωₙt)·(cos(ω_d t) + (ζωₙ/ω_d)·sin(ω_d t)))`, ω_d =
ωₙ√(1−ζ²)) to each curve via least-squares:

| condition | rate_ss (fit) | ωₙ (rad/s) | ζ | envelope τ = 1/(ζωₙ) (s) | RMS: 1st-order | RMS: 2nd-order |
|---|---|---|---|---|---|---|
| pitch, non-boosted | 66.41 °/s | 8.633 | 0.807 | 0.1435 | 3.73 °/s | **1.54 °/s** |
| pitch, boosted | 75.75 °/s | 8.009 | 0.916 | 0.1363 | 3.07 °/s | **1.16 °/s** |
| yaw, non-boosted | 50.57 °/s | 8.027 | 0.729 | 0.1709 | 4.42 °/s | **1.66 °/s** |
| yaw, boosted | 48.81 °/s | 8.186 | 0.560 | 0.2180 | 4.69 °/s | **1.00 °/s** |

**The 2nd-order model fits 2-4× better than the coded 1st-order lag in all four conditions** — this is
a real, structural finding, not noise: real SC's rotational spool-up is an underdamped 2nd-order
response (mass-spring-damper-like), not a simple exponential-drag approach to a clamp.

**Striking cross-axis consistency: ωₙ is ~8.0-8.6 rad/s in ALL FOUR conditions**, regardless of axis
or boost state — suggesting a single shared underlying natural frequency in whatever governs SC's
rotational assist/authority ramp-up, not a per-axis-tuned value. Damping (ζ) does vary and moves in
*opposite* directions under boost: pitch gets MORE damped when boosted (0.807→0.916, less overshoot),
yaw gets LESS damped (0.729→0.560, more overshoot) — an asymmetry with no obvious explanation yet, just
flagged as real and measured.

**This resolves the earlier "boosted pitch under-reads by ~20%" finding properly:** fitting the WHOLE
rise curve for boosted pitch recovers rate_ss=75.75°/s — matching the API's 82°/s much better than
either the raw short-hold snapshot (66.98/62.49) or even the full-360 test's wider brackets
(77-89). The root cause wasn't really "need a longer dwell" (the fix suggested earlier) — it's "need to
fit the actual transient curve, not read a single late/short window and assume it's steady state."
**For boosted YAW, the 2nd-order fit does NOT push the rate up toward the coded `boostMaxAngVel.yaw`
(1.082 rad/s = 62°/s)** — it stays at ~48.8°/s, close to the short-hold method's own 53.26 and the
non-boost rate's 50.57 (ratio ~0.96-1.07, i.e. close to 1.0). This reinforces the suspicion that yaw's
coded boosted value is an *assumed* uniform ×1.2 scaling (1.082/0.91 ≈ 1.19) rather than an
independently measured one, and the real boosted-yaw rate is close to non-boosted — a much smaller
afterburner effect on yaw than pitch or roll. (This specific fit's window may include a little early
release-tail contamination given the short 0.65s boosted dwell — worth a repeat with more margin before
fully committing to 48.8 over the short-hold's 53.26, but both agree on "not 62".)

**Practical implication:** `flightModel.ts`'s current model (accumulator → deadzone → expo curve →
per-ship max rate → **first-order exponential-lag integrator**) has real, quantified evidence that the
integrator stage should be a 2nd-order underdamped response instead, with the ωₙ/ζ values above as a
starting point. This is a `flightModel.ts` equation-family change — gated, needs an explicit go-ahead,
not something to change off the back of this data collection alone. Not yet attempted: fitting a
similar curve for roll (the original project's roll-spool data used a 1st-order/governor comparison,
never this 2nd-order model) or checking whether the SAME ωₙ shows up there too.

### Pitch full-360° sustained-hold cross-check — all 4 conditions — 2026-07-23

Same independent method already used for yaw (see "Full-360° sustained-hold validation" below): drive
a continuous pitch hold for `T = 360 / rate_estimate` seconds, then compare the sun's screen position
before vs. after via the pinhole/arctan projection — no continuous tracking through the sweep needed,
since the point should return to (near) its starting screen position after one true revolution. Method
note: the continuous frame-by-frame tracker (`track_landmark.py`) reliably lost lock partway through
every one of these clips (expected — the sun is out of view for most of a 360°) and in two cases
appears to have re-latched onto a *different* nearby star rather than reacquiring the true target;
each before/after position pair was therefore verified by directly viewing the extracted video frames
(not trusting the tracker's late-clip CSV output), which is the same lesson the original yaw 360 test
implicitly required.

| condition | rate estimate used | T (s) | angular residual | candidate rates (undershoot / overshoot) | established short-hold rate | agreement |
|---|---|---|---|---|---|---|
| DOWN, non-boosted | 64.80 | 5.556 | 6.38° | 63.63 / 65.93 | 64.80 | both candidates within ~1.8% |
| DOWN, boosted | 68.92 | 5.225 | 5.55° | 67.82 / 69.94 | 68.92 | both candidates within ~1.6% |
| UP, non-boosted | 66.88 | 5.383 | 2.71° | 66.35 / 67.36 | 66.88 | both candidates within ~0.8% — tightest of the four |
| UP, boosted | ~66.8 (rough) | 5.386 | — | **inconclusive** | ~64.7 (noisy, see above) | not usable |

**3 of 4 conditions independently confirm the short-hold-derived rates**, each within ~2% via a
completely different method (single before/after position comparison instead of continuous tracked
median) — good cross-validation that the short-hold numbers aren't a method artifact. As with yaw's
own 360 test, each condition has an inherent overshoot/undershoot ambiguity (a residual angle of a few
degrees could mean the ship rotated slightly less OR slightly more than exactly 360° in the chosen T) —
this test confirms the right ballpark, not sub-percent precision, and both candidate values in every
resolved case bracket the established rate.

**UP-boosted, first attempt: NOT usable.** The clip's starfield had multiple similarly-bright points
near the expected sweep path; direct frame inspection around the calculated end-time showed what
looked like inconsistent, non-monotonic jumps in the sun's apparent position across nearby timestamps
(e.g. ~826px change over 0.5s, then ~1056px over the next 0.15s) — physically implausible for one
continuously-moving point, indicating the "sun" being read at different timestamps was sometimes
actually a different star. No reliable before/after pair could be established with the time available.

### UP-boosted, redone properly — resolves a major discrepancy with the API reference — 2026-07-23

This project's own star-citizen.wiki API reference (`reference/ships/aegs-gladius.json`) states
Gladius pitch = **68°/s unboosted, 82°/s boosted** (`pitch_boost_multiplier` 1.2, matching the coded
1.2 used elsewhere) — a fixed target to check against, not something to re-derive. The short-hold
reps for boosted pitch-UP (66.98, 62.49 — see "Pitch UP direction" above) sit **~18-24% below this**,
a gap far too large to be measurement noise. Investigated via the full-360 method, targeting `T =
360/82 = 4.390s`.

**Key methodology fix: always read the "before" position from the capture's OWN recorded video frame
0, never from a screenshot taken before the capture command.** A live desktop screenshot taken right
before launching `mouse_hold_capture.py` can be stale by several hundred pixels' worth of drift by the
time the capture actually starts (focus/click + OBS's 1s settle both take real time, during which the
ship can still be settling from whatever came before) — this caused one botched attempt where the
angle came out an impossible ~7°/s. Once the true frame-0 position was used instead, both reps below
came out clean and self-consistent.

Also found (and worth remembering): the busy view for this ship orientation has a **fixed, non-moving
bright object at screen position ≈(1920, 1945)** roughly the same size/brightness as the sun — almost
certainly a static HUD/scene element, not a star. An automated "biggest bright blob" search can
mislatch onto it when the true sun is dim/small/occluded at that instant; caught by noticing the
"before" and "after" readings were suspiciously identical to each other and to prior unrelated frames
in the same clip. Always sanity-check that a discovered blob makes sense as part of a continuous
trajectory, not just "biggest thing found."

| rep | before (x,y) | after (x,y) | angular residual | undershoot rate | overshoot rate |
|---|---|---|---|---|---|
| 1 | (1990.86, 1307.85) | (1928.74, 1075.78) | 11.32° | 79.38 | 84.54 |
| 2 | (1946.10, 1082.39) | (1950.86, 404.80) | 29.47° | 75.25 | 88.67 |

**Both reps bracket the API's 82°/s closely** — rep 1 within ~3%, rep 2's same-sign candidates
(75.25/88.67, ~4-8% off) still far closer to 82 than the short-hold reps ever got. The
undershoot-paired average (79.38, 75.25 → ~77.3) and overshoot-paired average (84.54, 88.67 → ~86.6)
both land near 82; which sign is actually correct isn't resolved, but **both are decisively closer to
82 than to the short-hold method's ~64.7 average.**

**Conclusion: the short-hold method under-reads the boosted pitch-UP rate, most likely because a
0.45-0.55s dwell doesn't give boosted pitch enough time to finish spooling up before the steady-state
window is sampled** — the 360 test's much longer hold (4.4s) comfortably clears any plausible spool
time constant, so it should be trusted over the short-hold numbers for this specific condition.
**Revised boosted pitch-UP estimate: ~77-89°/s, consistent with the API's 82°/s** — supersedes the
66.98/62.49 short-hold reps above for this condition. This also raises a broader flag: if boosted
pitch's spool time constant is long enough to bias a 0.45-0.55s hold this much, the boosted-DOWN
short-hold reps (which used similarly short dwells) may be under-reading too, even though their own
360 cross-check happened to land close (see "DOWN, boosted" in the table above, 68.92 vs 360-test
67.82-69.94) — that agreement might be coincidental rather than proof the down-direction dwell was
long enough. Worth a skeptical re-check if boosted-pitch-DOWN precision matters later.

**Also worth recording: a repositioning-pulse attempt during this session overshot badly.** Tried to
pre-bias the landmark's starting position downward (to buy more margin before a hold) by calculating
a pulse duration from the first-order-lag equation ([[feedback_calculate_dont_iterate_repositioning]]),
using an assumed pitch spool time constant (τ≈0.2s, borrowed from roll's independently-fitted τ since
pitch's own hasn't been measured). The sun left the frame entirely — the assumed τ was evidently
wrong enough (or the direction-sign assumption was backwards) to badly miss the target angle.
Recovered by applying the exact inverse pulse (same magnitude/duration, reversed offset), which
brought the landmark back to within a few pixels of its original position — worth remembering as a
reliable recovery move when a calculated reposition misses, even without knowing exactly why it
missed. **Pitch's actual spool τ is still unmeasured** — this failed attempt is a data point that it's
probably NOT ≈0.2s like roll's, but isn't itself a measurement of what it actually is.

### Gladius PITCH curve shape — pitch needs its own fit, not yaw's rescaled — 2026-07-22

Sun-tracked (not the Kareah mast — avoids landmark-in-structure lost-lock), single reps,
`mouse_hold_capture.py --axis pitch`, arctan projection, FOV 116, 3840×2160:

| offset | pitch °/s | yaw °/s (established) | pitch/yaw ratio |
|---|---|---|---|
| 100 | 3.26 | 0.52 | 6.27 |
| 300 | 16.52 | 7.9 | 2.09 |
| 600 | 35.72 | 18.85 | 1.90 |
| 700 | 41.78 | — | — |
| 800 | 47.85 | — | — |
| 900 | 50.12 | — | — |
| 1000 | 58.53 | 33.3 | ~1.76 |
| 1050 | 55.52 | — | — |

The ratio varies from 6.27× (100 counts) to ~1.76× (1000 counts), not a constant — **pitch and yaw do
NOT share one curve shape rescaled by max rate**; each axis needs its own fit. Confirmed by a live
in-game bisection (single trials at 1000/1050/1060/1070/1075/1079/1080/1085, watching for a clean
stop vs. an overshoot-into-reverse-rotation on release): **pitch's full-deflection point is ~1080
counts**, distinctly lower than yaw's ~1500. Readings past 1080 (1100, 1200, 1500) are contaminated
by exactly this overshoot and are excluded from any future curve fit. Data-quality note: the 100-900
rows are single reps, not yet repeated.

**Also fixed this session: `mouseLook.ts`'s gain.** `range` was previously a FOV/viewport-derived
"degrees of visual angle for full deflection" — a resolution-dependent model real SC doesn't have at
all (SC's mouse vjoy accumulates raw, resolution-independent counts). That model needed only
~136-272px of physical mouse travel for full deflection (resolution-dependent) vs. the ~1500 counts
measured for yaw — a 5-18× gain mismatch, independent of curve shape. `range` is now a direct raw-count
constant (default 1500), with the F4 "VJoy Range" slider rebounded 300-3000 counts to match.

### Gladius LINEAR — lateral strafe (D), + a per-axis coastDecel flag — 2026-07-19

**First linear-thrust capture.** Strafe is pure translation — no landmark to track — so speed is read
off the HUD `m/s` number. New tools: `linear_hold_capture.py` (holds a strafe/throttle scan code
`accel` s then coasts `coast` s) + `analysis/montage_speed.py` (tiles the m/s readout every N frames
into one labelled image, read by eye — no OCR). Private AC free-flight (the PU dropped the session
mid-capture), Gladius, Coupled, 0 m/s. **Motion blur could NOT be disabled** — it smears the OSD
telemetry line into unreadable streaks, but the compact cockpit `NNN m/s` number stays legible, so
that's what the montage reads. Data: `data/linear/strafe-right-20260719-151925/`, D held 5 s + 8 s coast.

Read curve (key-down video t≈1.5, release t≈6.5): 0 → **225 m/s** max (reached ~2.7 s after press,
then flat-topped) → coast → 0 by t≈9.0.

| Quantity | Measured | Coded (`shipTypes.ts`) | |
|---|---|---|---|
| Strafe accel | ~98 m/s² (constant) | `linearThrust.strafe 145 / mass 1.5` = 96.7 | ✅ |
| Max lateral speed | 225 m/s | `scmSpeed` 226 (governor cap) | ✅ |
| Coast decel | **~98 m/s² (flat)** | `coastDecel` 40 | ❌ 2.4× |

Accel and cap confirm the ported tuning. **The coast decel is the finding:** measured ~98 m/s² (flat,
constant 96–102 across 217→21, tapering only in the last ~20 m/s — the `min(brakeGain·v, capacity)`
crossover), NOT 40. And 98 ≈ the strafe thrust authority (145/1.5); the coded `coastDecel = 40`
equals the **retro** authority (63/1.5 = 42), i.e. it's the *forward*-axis braking rate. So in reality
**each axis brakes at its own thruster authority** (lateral 96.7, forward/retro 42, vertical-up 98,
down 49) — the ship uses the same thrusters to brake as to accelerate that axis — but the model uses a
single scalar `coastDecel = 40` for all axes, **under-braking lateral/vertical strafe by ~2.4×**.
Candidate refinement: make coastDecel (and the brake-saturation in `flightModel.ts`) **per-axis** =
that axis's `linearThrust/mass`. Touches ported `flightModel.ts` → a flag needing a decision, not an
edit. Still to capture (confirms the per-axis pattern): forward/back (W/S) and vertical (Space/Ctrl).

**Counter movement + decoupled (lateral) — 2026-07-19 — resolves the coastDecel question.** Two runs,
accel-right-then-command-left (`linear_hold_capture.py`, montage-read):
- **Coupled** (`D:4,A:5,_:4`, `data/linear/counter-coupled-20260719-154355/`): counter-decel (A while
  moving right) ≈ **100 m/s²**, release-coast ≈ **98**, both = accel ≈ 98 = strafe authority. The
  flight-computer auto-brake already applies FULL opposing-thruster authority, so commanding the
  opposite is no faster than releasing.
- **Decoupled** (`D:3,_:3,A:5,_:4` with `--decoupled` C-toggle, `data/linear/counter-decoupled-20260719-154557/`):
  **release = DRIFT** — speed holds flat at **225–226** through the whole release phase, ZERO decel
  (vs coupled's ~98 brake); confirmed decoupled by this behaviour alone. Counter-A decel ≈ **96–100
  m/s²** (pure strafe thruster). Accel and the **225 SCM cap are UNCHANGED** from coupled.

**Decisive:** decoupled removes the linear auto-brake (release→drift) but keeps thruster authority
(counter ≈98, same) AND the SCM governor cap (225). Since the coupled release-brake (~98) EQUALS the
directly-measured decoupled thruster authority (~98 = strafe 145/1.5), **the coupled "coast decel" IS
the flight computer firing full opposing-axis thrusters — a per-axis quantity, not the single scalar
`coastDecel = 40`.** Nails the per-axis refinement above (lateral brakes at 96.7, not 40).

**sc_webgl decoupled model (linear):** same thrust, same SCM cap governor, but the coupled
zero-velocity auto-brake (coastDecel path in `flightModel.ts`) is DISABLED — the ship keeps its
velocity with no input. Mirrors the roll finding ([[decoupled roll == coupled]]): decoupled only
drops the velocity-nulling assist — rotation shares it (roll still auto-stops), linear loses it here.

**Vertical up (Space) — confirms the asymmetric per-direction model — 2026-07-19.** `UP:4,_:8`
coupled (`data/linear/vert-up-20260719-154935/`): **accel ≈ 98 m/s²** (= `verticalUp` 147/1.5),
**coast decel ≈ 49 m/s²** (flat 49–50, 223→174→124→74) = exactly HALF the accel = `verticalDown`
73.5/1.5. Max 225 (SCM cap). So braking upward motion fires the weaker DOWN thrusters — clean
confirmation that **accel = commanded-direction thrust / mass, and coast decel = OPPOSING-direction
thrust / mass**, per axis AND per direction:

| axis+dir | accel (thrust/mass) | coast decel (opposing/mass) |
|---|---|---|
| forward (W) | main 201/1.5 = 134 ✓meas 134 | retro 63/1.5 = 42 ✓meas 42 (= coded coastDecel 40) |
| back (S) | retro 63/1.5 = 42 ✓meas 42 | main 201/1.5 = 134 ✓meas 134 |
| lateral (A/D) | strafe 145/1.5 = 96.7 ✓meas 98 | strafe 145/1.5 = 96.7 ✓meas 98 (symmetric) |
| up (Space) | vertUp 147/1.5 = 98 ✓meas 98 | vertDown 73.5/1.5 = 49 ✓meas 49 |
| down (LCtrl) | vertDown 73.5/1.5 = 49 ✓meas 49 | vertUp 147/1.5 = 98 ✓meas 98 |

**Now confirmed by measurement on EVERY axis and direction** (forward/back `data/linear/forward-…`,
`back-…`; vertical `vert-up-…`, `vert-down-short-…`; lateral above). The single coded
`coastDecel = 40` only matches forward-coast (retro-braked); every other direction differs.
**Refinement: coastDecel → per-(axis,direction) = opposing thruster / mass** (forward brakes retro
42, back brakes main 134, lateral 98 both ways, up brakes down 49, down brakes up 98). Gated
(`flightModel.ts` ported-verbatim). NB **W/S turned out to be a MOMENTARY throttle** (release → the
ship coasts to 0, no throttle-zero key needed) — not a persistent setpoint; forward accel 134 to SCM
226, back accel 42 to scmSpeedBack 225.

**Boosted lateral (RMB boost held) — a coded-model GAP — 2026-07-19.** `D:5,_:8 --boost`
(`data/linear/boost-lateral-20260719-155201/`): accel ≈ **127 m/s²** (42→169 in 1 s; ×1.3 over the
98 unboosted), max ≈ **391 m/s** (plateau 390–391; ×1.74 over the 225 SCM cap — boost lifts the
lateral cap well above SCM), coast decel ≈ **127 m/s²** (boost still held → boosted brake authority).
**The coded `boostLinearThrust` has only `{main: 420, retro: 216.5}` — no strafe/vertical boost at
all — but the game clearly boosts them (accel ×1.3, cap ×1.74).** So `sc_webgl` under-models boosted
lateral/vertical speed and accel. New data not in `shipTypes.ts`; needs `boostLinearThrust.strafe`
(≈ 127×1.5 ≈ 190) + a boosted lateral/vertical speed cap (≈ 385), and the boosted-cap governor to
apply to strafe axes. Gated.

**Boosted vertical-up** (`UP:4,_:8 --boost`, `data/linear/boost-vert-up-20260719-161007/`) confirms
the pattern is common to the maneuvering axes: accel ≈ **126 m/s²** (= boosted lateral's 127; up from
98 unboosted, ×1.3), max ≈ **383 m/s** (= boosted lateral's 391 — a shared **~385 boosted maneuvering
cap**), coast ≈ **66 m/s²** (boost held; up from 49 unboosted, ×1.35 = boosted opposing/down thrust).
So boost lifts BOTH strafe and vertical to ~385 m/s at ~127 m/s² accel — model needs boosted thrust +
a boosted cap on ALL maneuvering axes, not just main/retro. Note the ~385 cap is well below the
boosted-forward 520, so boost caps maneuvering lower than forward.

**G-force / blackout — a capture caveat, not a data problem.** These are ~10 G maneuvers, so the
pilot GLOCs (screen darkens/reddens). Verified via per-frame brightness that every accel-to-plateau
ran at FULL brightness (conscious/controlled) and the blackout only hit the low-speed COAST TAIL —
so no accel/cap reading was taken during a blackout, and every accel was constant right up to a known
cap (a GLOC would cut thrust and sag the curve — none did). Cross-checked: measured = coded
`shipTypes.ts` = star-citizen.wiki API. **Direction matters for the blackout:** downward/negative-G
axes (vert-down accel = redout) GLOC MUCH sooner (~3–5 G) than positive-G (up accel tolerated the
full ramp) — the long `DN:5` redded out mid-accel and hid the coast entirely; a short `DN:2.5` (lower
peak, less accumulated neg-G) stayed readable through the coast. **Method note: keep negative-G-axis
maneuvers short.** (GSAF/G-safe state was not pinned; irrelevant to validity since values match code
+ API, but a G-limited regime could be captured separately.)
