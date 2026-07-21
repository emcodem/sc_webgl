# Vjoy / mouse-flight settings — measurement methods & results

Durable record of **how to measure what a Star Citizen input setting does to flight**, and the
**measured values** per setting. The method is reusable for any setting; the results accumulate below.
Companion to `BLUEPRINT.md` (which covers the vJoy-*device* flight-tuning capture — a different
workstream). This file is specifically the **mouse virtual-joystick** settings investigation.

Everything here is measured against the **real game** driving the **mouse** (SC's on-screen "vjoy"
indicator responds to the mouse, not to a bound vJoy device — see BLUEPRINT.md), because these
settings (`VJoyAnglePilots`, `VJoyCombinedDeadZone`, …) govern the mouse virtual joystick.

---

## STATUS / RESUME HERE (read first) — as of 2026-07-19

**The Gladius is now FULLY characterized** across flight axes and regimes (all in Results below;
every raw clip catalogued in `data/MANIFEST.md`):
- **Rotational:** roll ±202 (boosted ±235, decoupled==coupled, spool/decel/reversal transients);
  pitch 61, yaw 49 (mouse+sun-tracking); **afterburner = ~1.2× on all three rotational axes**.
- **Linear (every axis+direction):** fwd 134/coast 42, back 42/134, lateral 98/98, up 98/49,
  down 49/98, max 225–226; **coast decel = opposing-thruster/mass per direction**; decoupled drops
  the linear auto-brake (drift); boosted lateral/vertical ≈ 127 accel / ~385 cap.
- **Mouse vjoy settings:** `VJoyAnglePilots` visual-only for flight, but IS a literal FOV angle for
  the on-screen indicator's pixel travel (confirmed 2026-07-21, `f*tan(degrees)` pinhole projection —
  see "indicator pixel travel" below), `VJoyCombinedDeadZone` = D% deadzone, near-linear input curve
  (exponent ≈1.04, revised 2026-07-21 — see "RESOLVED" below, supersedes an earlier ≈1.48 estimate
  that lacked a saturation anchor), full mouse range ≈1500 counts (confirmed).
- **Cross-validation:** all matches coded `shipTypes.ts` (±2% for absolutes) AND the star-citizen.wiki
  API dump in `reference/ships/aegs-gladius.json`.

**NEXT TASK (new session) — SORT / CONSOLIDATE the collected data.** The Results below accumulated
chronologically; consolidate them into a clean per-ship picture. Suggested outputs: (a) a single
Gladius spec table (measured vs coded vs API, per axis/regime), (b) a candidate `shipTypes.ts` diff
or a "matches / refine / gap" verdict per constant, (c) act (or not) on the **three gated refinement
flags** — per-axis `coastDecel`, decoupled = drop-the-linear-auto-brake, and missing boosted
strafe/vertical in `boostLinearThrust`. All three edit ported-verbatim `flightModel.ts`/`shipTypes.ts`
→ need an explicit go-ahead, not a data task. Start from `data/MANIFEST.md` (KEEPER rows) + the
Results sections here.

**Session state:**
- **Pointer acceleration RESTORED** (`pointer_accel.py restore` run 2026-07-19 — normal mouse back).
- Gladius; roll work was in the **PU at Kareah**, linear + pitch/yaw in **private AC free-flight**.
- `VJoyCombinedDeadZone` left at **20** (default 4.45); `VJoyAnglePilots` at 25 (doesn't matter).

**Optional captures still on the menu:** NAV/cruise mode (max 1193 + SCM↔NAV transition), the G-safe
(GSAF) regime, **Taurus/Arrow** (2nd/3rd ship → unlocks cross-ship mass-scaling + the deadzone
rescale-vs-hard-cut question), and the roll drag-vs-governor transient settle.

**RESOLVED (2026-07-21): the input curve's real shape, fitted from a dense sweep.** Filling in
1200-2100 counts for yaw (`curve_sweep_capture.py`, one-directional probes, Kareah standoff, corrected
`hold_rate.py` arctan projection) showed the curve **saturates by ~1500 counts at ~51.4 °/s** —
nowhere near the 168 °/s a naive extrapolation of the old 150-600-only fit predicted (a 3.4× gap). The
old exponent (1.48) was an artifact of fitting a rising curve with no ceiling in the data: forcing a
steep exponent to explain the 150-600 rise while implicitly extrapolating a much higher ceiling than
the ship actually has. Joint fit across 150-2100 counts (`dz_frac=0.0445`, matching the session's live
`VJoyCombinedDeadZone`):

| model | full_range (counts) | shape params | max_rate | RMS (deg/s) |
|---|---|---|---|---|
| power (current model shape) | 1462 | exponent=1.04 | 51.1 | 0.14 |
| Kumaraswamy (saturating) | 1500 | a=1.07, b=1.09 | 51.1 | 0.08 |

Both fits are excellent and nearly identical in shape (a,b≈1 for Kumaraswamy is itself close to
linear) — **the real curve is close to a straight ramp from the deadzone edge to ~1500 counts, then
flat**, not the pronounced convex curve `axisCurve.ts` previously modeled. Applied:
`src/input/axisCurve.ts`'s `DEFAULT_EXPONENT` 1.48 → **1.04**.

**Pitch's own 1200-2100 sweep was contaminated and excluded, but pitch didn't need it anyway.** The
landmark (a beacon on Kareah's station mast) sits on the station's own structure — sweeping it
vertically (pitch) dragged it through the mast/truss instead of clean space the way sweeping it
horizontally (yaw) did, causing a real lost-lock bounce (peak brightness 255 → ~200 exactly when the
fast motion starts, tracked position reversing direction — a tracking-hijack artifact, not real ship
behavior; see `curve_sweep_capture.py`'s own module docstring for the landmark-choice fix needed for a
future re-shoot). Instead: since the mouse→deflection input mapping is already established as
ship/axis-independent (just a different per-axis max rate downstream in `flightModel.ts`), the yaw
shape rescaled by pitch's own known max (unboosted full-deflection 61.3 °/s, ratio 61.3/51.4=1.193)
predicts pitch's plateau at 1500 counts ≈ **61.4 °/s** — matching the independently-measured 61.3
almost exactly. That agreement is itself evidence for "same curve shape, different max," not just a
convenient assumption. **No pitch-specific tuning needed** — `axisCurve.ts`'s single shared
exponent/deadzone already applies to both axes; only the per-axis max rate (already handled by
`shipTypes.ts`/`flightModel.ts`) differs.

**Also fixed, same session: the gain, not just the curve shape.** `mouseLook.ts`'s `range` was
previously "degrees of screen visual angle for full deflection" (FOV/viewport-derived) — a
resolution-dependent model real SC doesn't have at all (its mouse vjoy accumulates raw, resolution
-independent mouse counts directly). That model needed only ~136-272px of physical mouse travel for
full deflection (depending on resolution) vs. the ~1500 counts measured here — a 5-18× gain mismatch,
independent of curve shape, meaning small mouse nudges always over-rotated the ship relative to real
SC regardless of how well the exponent was tuned. `mouseLook.ts`'s `range` is now a direct raw-count
constant (default 1500, matching the fit), with the F4 "VJoy Range" slider relabeled/rebounded
(300-3000 counts) to match.

**Method gotchas (see Gotchas + per-section notes):** pointer accel pinned for MOUSE work only ·
SC must be foreground · roll/linear focus is click-free & pre-OBS (no menu/fire) · motion blur can't
be disabled (read the compact cockpit number, not the OSD) · keep negative-G-axis maneuvers SHORT
(blackout) · filter tracked frames by peak_brightness (lost-lock bounce wrecks fits) · re-center on
the landmark between yaw/pitch runs · analysis uses **arctan** projection (f=1200 @ FOV116).

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
