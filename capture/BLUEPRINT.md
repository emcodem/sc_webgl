# Blueprint: how to capture real flight-tuning data

A reusable **how-to-measure** guide for turning "fly the ship in a private Arena Commander instance"
into a trustworthy measured value. This file is pure methodology — no dated findings, no per-result
narrative. Measured values live in `MEASUREMENTS.md` (a table); the reasoning/derivation behind any
of them is in `MEASUREMENTS_ARCHIVE.md`; this file's own prior narrative is in `BLUEPRINT_ARCHIVE.md`.

Read `README.md` and `settings_checklist.md` first — **especially the "Power triangle — full power
to engines" item, mandatory before every single capture** (a 2026-07-26 finding: unconfirmed power
allocation silently produces meaningfully-slower rotation/thrust readings — see `MEASUREMENTS.md`'s
CRITICAL note). This file assumes that toolchain and layers the per-ship workflow and gotchas on top.

Two capture families exist, for different axes:
- **Hold-capture tools** (`roll_hold_capture.py` / `mouse_hold_capture.py` / `linear_hold_capture.py`
  + `track_orientation.py` / `track_landmark.py`+`angle_convert.py` / `montage_speed.py`) — the
  fast, current path for roll/pitch/yaw/linear steady-state. `PLAYBOOK.md` is the runnable recipe.
- **Device-path tools** (`orchestrate.py` + `fit_model.py`, driving the bound vJoy device via
  `feeder/vjoy_feeder.py`) — older, slower, still relevant for the reversal-transient / drag-vs-
  governor research line (fitting thrust/drag/mass from a scripted reversal maneuver). The
  "Per-ship procedure" section below documents this path specifically.

---

## Choosing and seeding a landmark

- **Point landmark** (star, light ring, etc.) for yaw/pitch: bright, high-contrast, off-reticle.
  Take a single-frame screenshot, converge `track_landmark.centroid_in_window` on it a few
  iterations to get an exact seed — don't eyeball it. Re-take the screenshot any time the game
  restarts/reconnects; ship attitude relative to the landmark can drift between sessions.
  Match `--window` to the landmark's actual pixel size (crop around the converged seed and
  threshold-count bright pixels) — a small target wants close to the 40px default; a large marking
  (e.g. a 10-15%-of-screen station pad) needs 150+.
- **Elongated landmark** (a station structure, a "post") for **roll** specifically: track
  ORIENTATION (long-axis angle via intensity-weighted 2nd moments / PCA), not position — this is
  independent of screen position, so keep it **CENTERED** (opposite of the point-landmark rule) so
  it stays framed through a full 360° instead of orbiting into an occluder. An empty Arena Commander
  starfield has no usable roll landmark (too dim) — use a lit persistent-universe structure (e.g.
  Security Post Kareah) at a standoff that keeps it a few hundred px tall. Mod-180 unwrap (via
  angle-doubling — a rod is symmetric) then savgol-differentiate → roll rate. `elongation` (from
  `track_orientation.py`) is the lock-quality signal — healthy readings stay well above 1; a drop
  toward 1 means the post was lost. Mask out any screen-fixed occluder in the post's path
  (`--mask-below`) — e.g. a radar dish overlapping the post's lower end.
- **Point landmark radius limit (roll only, if using the older off-center method)**: must stay
  within half the frame's SHORTER dimension or it swings off-screen mid-rotation — this does NOT
  apply to the centered elongated-landmark method above, which never orbits.
- **Never seed near the reticle/crosshair** — the tracker can lock onto the crosshair graphic
  itself once the real target moves away, and peak brightness can stay a perfect 254-255 the whole
  clip (no lost-lock warning at all) while position barely moves. Always crop-check the converged
  seed visually before trusting it.
- **Watch for HUD elements in the sweep's path**: pitch can sweep a landmark into the radar/scan
  cone graphic (seed well above center, ~25% margin from the top, so the whole excursion stays in
  clear sky); roll's circular path can cross MFD panels partway through rotation (shorten hold
  durations to keep total rotation well under 360°, since a full rotation at ~200°/s will cross a
  side panel somewhere almost regardless of radius). A **flat trajectory with sustained high peak
  brightness is itself a red flag** for exactly this failure mode (a screen-fixed bright panel is
  just as bright as the real landmark) — extract and eyeball a frame at the "frozen" timestamp
  before trusting a suspiciously motionless trial.
- **Busy starfields can have multiple similarly-bright points** — a before/after landmark
  comparison (see the 360°-test method below) can silently track the wrong star. Verify the
  discovered blob makes sense as part of one continuous trajectory, not just "biggest thing found."

## Mouse virtual-joystick mechanics (for yaw/pitch — no keyboard bind)

SC's on-screen "vjoy" indicator and actual flight response are driven by the **mouse**, not the
bound vJoy device (a device-axis sweep leaves the indicator dead still) — so mouse-vjoy settings
must be measured by driving the mouse (`feeder/mouse_feeder.py`, `MOUSEEVENTF_MOVE` relative deltas).

- **The mouse virtual joystick ACCUMULATES relative deltas into an absolute stick position** — drive
  a *target position* and inject each tick's discrete derivative, never a raw velocity waveform (a
  velocity-sine injection drifted rightward-only because ∫sin ≥ 0 — its running sum never went
  negative).
- **Windows pointer acceleration must be pinned 1:1** (speed 6/11, "Enhance pointer precision" off)
  before any calibrated run — accel-on gives real nonlinear scaling (~0.8× seen). `pointer_accel.py
  pin` / `restore`.
- **`feeder/win_focus.py`'s focus is REQUIRED before every capture** — injected input only reaches
  flight if SC is the foreground window; this is not optional and not a one-time setup step, do it
  immediately before every single capture command, not just at session start. `focus_and_click()`
  also presses Esc twice (opens+closes the menu) to reset the virtual joystick to neutral — a
  residual mouse deflection can otherwise pitch the ship mid-sweep and lose the landmark. The click
  lands on the reticle (fires a shot if armed) — use click-free `focus_no_click()` for keyboard-only
  captures (roll) or near objects where a stray shot matters, since Esc-reset opens the pause menu
  into the clip (fine for mouse work, NOT fine for roll's keyboard capture — leave Esc-reset off there).
- **Mouse-vjoy accumulator hard-clamps at half the capture resolution in the relevant dimension**
  (pitch: half height, e.g. 1080 @ 2160px; yaw: half width, e.g. 1920 @ 3840px) — resolution-
  dependent, re-derive for whatever capture resolution is actually in use. Never drive raw counts
  past it; a "move back by the same amount" release/reversal overshoots true center once past this
  boundary, contaminating both the held reading and anything captured after it. Large offsets
  (≥~1500 counts at 4K) reliably lose tracking lock partway through a multi-segment staircase —
  prefer isolated single-magnitude probes with a short dwell instead.
- **Full-deflection point is NOT shared across axes** — pitch and yaw each need their own
  measured full-deflection count and curve fit; don't reuse one axis's curve/gain for the other.
  Full-deflection (curve saturation) and the accumulator clamp (hard overflow) are two DIFFERENT
  concepts that can have different values — don't conflate them.
- **`mouse_hold_capture.py --offsets a,b,c --dwell T` holds EVERY offset in the list for the full
  `T`, not just the last one.** Fine for short captures (a sub-second leading `0,` prefix is
  harmless), but for a multi-second hold (e.g. a 360°-test) it wastes real time and boost-meter
  charge holding a pointless zero-input segment first. Pass a single offset with no leading `0,`
  to ramp once from the ship's current attitude and hold once.
- **XML settings can't be live-edited while SC runs** — SC overwrites `attributes.xml` from memory
  at launch/exit, so an edit made while the game is running is neither picked up live nor persisted.
  Apply a setting via an SC restart (edit-while-closed) or by driving the in-game slider/UI directly.

## The 360°-sustained-hold method (rate cross-check independent of continuous tracking)

Drive a continuous hold for `T = n_laps × 360 / rate_estimate` seconds, then compare the landmark's
screen position **before vs. after** directly — no continuous tracking through the sweep needed,
since a correct rate estimate returns the landmark to (near) its starting screen position.

- **Continuous frame-by-frame tracking reliably loses lock partway through a real 360°** (the
  landmark is out of view for a large fraction of the rotation) and can re-latch onto a different,
  wrong star without any brightness-based warning firing — don't trust the tracker's own
  interpolated late-clip position. Read the "before" and "after" positions directly instead: from
  the capture's own recorded frame 0 (never a pre-capture screenshot, which can be stale by the time
  OBS settle + focus/click actually finish) and from a frame near the predicted hold-end (found by
  scanning the EARLY, still-reliable portion of the trace for where sustained motion actually
  begins, then adding the intended hold duration — not by trusting a correlation-based alignment
  search over the WHOLE clip, which gets measurably less reliable on a long/noisy 360° trace).
  `analysis.track_landmark.centroid_in_window` run on a single static frame (not a continuous trace)
  is a precise, low-risk way to measure both endpoints once you already know which frame to check —
  or read the live screen directly if the session is still running.
- **A given residual is ambiguous between undershoot and overshoot** (short of 360° by X°, or past
  it by X°) — report both candidate rates, or use independent context (a coded/API reference value)
  to pick the more plausible one, same as any other over/undershoot bracket.
- **Doubling the hold duration (2 laps instead of 1) is a strong diagnostic**: if the residual
  roughly stays the same, the gap was a one-time spool-up transient; if it roughly doubles, the
  steady-state rate itself is off by a real, compounding amount. This can also surface confounds
  unrelated to the rate itself — e.g. a session-to-session change in engine power-triangle
  allocation produced a completely different residual between an unconfirmed-power 1-lap rep and a
  full-power 2-lap rep, which is what surfaced the power-triangle confound in the first place (see
  `MEASUREMENTS.md`'s CRITICAL note) — a doubling test only cleanly isolates spool-up-vs-steady-state
  if nothing else changed between reps.

## Fitting a spool-up rise curve (rate_ss / ωₙ / ζ, 2nd-order underdamped model)

`fit_spool_response.py` fits `rate(t) = rate_ss·(1 − e^(−ζωₙt)·(cos(ω_d t) + (ζωₙ/ω_d)·sin(ω_d t)))`
(ω_d = ωₙ√(1−ζ²)) against a fast-ramped (`--ramp 0.05`, approximating a step) held deflection.

- **Capture enough dwell to see the rate visibly turn back down (or up) after its first overshoot**
  before trusting ωₙ/ζ — a fit that only sees a single rise-and-peak is unreliable no matter how low
  its own reported RMS looks. This isn't a fitting-domain problem (rate-domain vs. integrated-angle-
  domain): a short window degenerates in BOTH domains (rate-domain: numerically unstable, pins ζ near
  the 0.999 bound; angle-domain: numerically stable but blind to the exact overshoot/undershoot shape
  that distinguishes 1st- from 2nd-order dynamics, since the missing undershoot's area deficit nearly
  cancels the overshoot's extra area). Fitting the integrated angle curve (rather than differencing
  against the already-differentiated, noise-amplified rate curve directly) is still the right general
  approach — it's just not sufficient on its own if the window is too short.
- **A longer dwell risks the landmark exiting frame, or a real (not tracking-artifact) rate collapse
  near extreme deflection** — watch `peak_brightness` for an abrupt, erratic swing away from its
  otherwise-steady baseline as the tell for lock loss; a real kinematic collapse (ship crossing some
  other governor/limit) can also occur while brightness stays clean, so a sharp RMS jump in a
  `--trim-end` sweep is itself informative even without a brightness signature. Use `--trim-end` to
  cut the analysis window before contamination starts, and `--t0` to override the auto-alignment
  when its correlation score (`align_corr`) comes back low (well under the ~0.95+ seen on short,
  clean captures) — read the true step onset by eye off a printed rate trace where it visibly
  departs from ~0.
- **Sweep `--trim-end` across a range rather than picking one cutoff** — ωₙ tends to stay stable
  across the genuinely clean range regardless of exactly where it ends, while ζ and rate_ss can
  still be drifting; a sharp jump in RMS marks the real contamination boundary.

## Per-ship procedure (device-path: `orchestrate.py` + `fit_model.py`)

1. Lock in-game settings per `settings_checklist.md` (FOV, motion blur off, camera shake off, frame
   cap, full engine power, vJoy profile active — `python profiles/switch_profile.py status` must
   report `vjoy`).
2. Confirm the ship (matters because fit constants are per-ship; tag every trial with `--ship`).
3. Pick and seed a landmark (see above).
4. Run the trial: `python orchestrate.py feeder/maneuvers/<maneuver>.json --ship <Name> --axis
   {x,y,roll} --flight-mode {coupled,decoupled} --fov <deg> --resolution <WxH> --seed-x <x>
   --seed-y <y> [--window <px>] [--backend obs]`. Writes to `data/<Name>/<maneuver>/<timestamp>/`.
   Prefer `--backend obs` (see below) — its frame timing is dramatically cleaner than ffmpeg's
   `gdigrab`.
5. QA each trial before trusting it: check `orchestrate.py`'s own lost-lock warning (peak
   brightness < half the clip's max), AND eyeball the raw `trajectory.csv` pixel positions for the
   segment(s) that should be at steady state. A real steady state moves a roughly constant number
   of pixels per frame; motion decaying toward ~0 while the maneuver's input segment is still fully
   held is NOT the ship settling (the model predicts rise-then-hold, never spontaneous decay under
   constant input) — exclude that trial and note why, don't average it in silently.
6. Repeat 2-3+ times per maneuver/axis for a joint fit (more reps tighten the fit and let you spot
   an outlier by comparing per-trial RMS).
7. Determine the sign convention once per axis/setup, before trusting `mass_only`: run `fit_model.py`'s
   `symmetric` model first; if it fits a negative thrust, the tracked pixel axis runs opposite the
   command's positive direction (e.g. "nose right" slides a background landmark left) — rerun
   everything, `mass_only` included, with `--sign -1`. `symmetric`/`asymmetric` can absorb a sign
   flip into thrust's sign without this, but `mass_only`'s thrust/drag are fixed positive and
   silently produce a meaningless huge mass if the sign is wrong.
8. Joint-fit the reps: `python analysis/fit_model.py feeder/maneuvers/<maneuver>.json
   data/<Name>/<maneuver>/<t1> data/<Name>/<maneuver>/<t2> ... --mass <shipTypes mass> --thrust0
   <angularThrust[axis]> --drag0 <angularDrag[axis]> [--sign -1]`. Compares `symmetric`,
   `asymmetric`, and `mass_only` models (see the script's own docstring) with physically-bounded
   (non-negative) parameters — an unbounded fit can otherwise converge to a negative (energy-adding)
   drag on sparse/noisy data. A parameter landing exactly on its `[0, inf)` bound is a real result
   ("this data wants ≤0") but shouldn't be over-read as precisely converged until more reps confirm
   it's not just being clipped.
9. Record the outcome as a row in `MEASUREMENTS.md`, regardless of whether it confirms or
   contradicts the current `shipTypes.ts` constants — a clean null result ("existing model already
   fits") is as useful to log as a surprising one.

## Automated in-game state checks (replacing manual screenshot-eyeballing)

- **Flight-mode + in-cockpit detection**: `analysis/hud_checks.py` template-matches the "CPLD" HUD
  label (shown under "ESP" only when Coupled is on) against a reference crop, giving a match score
  cleanly separated into three bands: `<0.5` = not even in the cockpit (menu/crash/loading), `0.70-
  0.75` = Decoupled, `0.82-1.0` = Coupled. Wired into `orchestrate.py` (`check_flight_mode`, runs
  before every OBS-backend trial and raises on a mismatch rather than warning). Prefer this
  template-matching approach over counting bright pixels in a fixed region — a nearby element (e.g.
  ESP's own box) can bleed brightness into a fixed region independent of whether the target glyph
  is actually present.
- **Auto-centering the landmark without a human flying the ship** (not yet built, but the
  recommended approach if it's worth the engineering time): a classical closed-loop visual-servo —
  read the landmark's current pixel offset from the desired screen position, convert to a small
  corrective command, drive it, iterate until converged (see `recenter.py` for the pitch/yaw mouse
  version of this — note its own known bug below). No ML needed for this part; `track_landmark`'s
  brightness centroid is already exact. A vision-language model would plausibly help for two
  different sub-problems instead: the cold-search case (target not visible anywhere in frame, don't
  know which way to turn) if simple brightest-blob detection isn't discriminating enough, and
  automating the in-cockpit/crash/menu classification above as a fallback if the cockpit layout
  changes and the CPLD template needs re-deriving.
- **Known bug, unresolved**: `recenter.py` (closed-loop pitch/yaw recentering via corrective mouse
  pulses) reliably moves yaw but not pitch — repeated attempts showed yaw error converging cleanly
  while pitch error stayed essentially unchanged across dozens of iterations, even with the game
  properly focused beforehand. Root cause not diagnosed; manual repositioning is the current
  workaround for pitch.

## OBS backend setup (preferred over ffmpeg — much cleaner frame timing)

`ffmpeg`'s `gdigrab` has real, measured frame-timing jitter (0-83ms gaps at 4K). The OBS backend
(`--backend obs` / any tool with `recorder/obs_capture.py`), once configured correctly, gives frame
gaps of 16.665-16.667ms — essentially exact 60fps (verify via `ffprobe -show_entries
frame=best_effort_timestamp_time`). This directly fixes two failure modes: a false "motion onset at
frame 0" (jitter-driven noise during the pre-maneuver quiet hold mistriggering sync) and a noisy
quiet-hold baseline. **If data looks noisy or sync triggers early, try the OBS backend before
assuming a real ship-behavior anomaly.**

Getting `--backend obs` actually working takes real one-time setup, none of it obvious from
`recorder/obs_capture.py` alone (which only wraps start/stop, not scene configuration):

1. **OBS needs a scene with an actual capture source** — a fresh/default scene has zero source
   items and records a blank video otherwise. Add a `monitor_capture` input (`client.create_input`),
   not `window_capture`/`game_capture` (untested here).
2. **Get the exact monitor device path from the input's own property list, don't hand-type it.**
   `get_input_properties_list_property_items(input_name, 'monitor_id')` returns each monitor's exact
   Windows device path. Never round-trip this through a printed Python repr and retype it as a
   string literal — the repr doubles backslashes, and retyping as a raw string double-escapes it
   again, corrupting the path. Always pass the API-returned variable directly.
3. **The `monitor_id` property list reports PHYSICAL pixel dimensions** — unlike `get_monitor_list()`'s
   `monitorWidth`/`monitorHeight`, which report DPI-scaled logical resolution (e.g. 2560x1440 at
   150% scaling when the physical panel is 3840x2160). This DPI-scaling trap applies broadly —
   `GetWindowRect`-style Win32 calls can similarly return logical rather than physical coordinates
   depending on the calling process's own DPI-awareness setting; don't assume a coordinate read from
   any Windows API is already in physical pixels.
4. **`monitor_capture`'s default "Automatic" method can silently produce a blank white capture**
   (confirmed via `get_source_screenshot` showing ~255 mean, zero variance) even with the source
   otherwise configured correctly — plausibly an anti-cheat block on whatever capture path
   "Automatic" picks. Explicitly set `method: 1` (DXGI Desktop Duplication) or `2` (Windows 10 WGC).
5. **Set canvas AND output resolution to the monitor's physical resolution, and FPS, explicitly**
   (`set_video_settings(60, 1, W, H, W, H)`) — a fresh OBS profile defaults to 1920x1080/1280x720/30fps.
6. **Force the scene item's transform to exact 1:1** (`positionX/Y: 0`, `scaleX/Y: 1.0`) via
   `set_scene_item_transform` — don't trust OBS's auto-fit scaling if the source was created against
   a mismatched canvas size.
7. **`stop()` needs a longer settle delay than a naive default** (2.0s, not 0.5s) or the copied file
   can be 0 bytes — the source file in OBS's own recording directory needs time to finalize its
   `moov` atom before copying it out.

## Data layout

`data/<Ship>/<maneuver>/<timestamp>/` — `raw.mp4`, `input_log.csv`, `trajectory.csv`, `omega.csv`,
`meta.json` (includes `"ship"`). Partitioned by ship so different ships' captures never collide and
`fit_model.py` runs can glob a whole ship's reps at once.

Exception: before/after 360°-checks need no trajectory, so they're stored as loose top-level CSV
logs under `data/<Ship>/` (one per rep), not per-timestamp trial dirs.

## vJoy / Star Citizen input configuration (device path)

- **Device**: vJoy device #1, 8 axes enabled (X/Y/Z/RX/RY/RZ + 2 sliders). Its joystick instance
  number is enumeration-order-dependent — always confirm against your own `actionmaps.xml` rather
  than assuming a fixed instance number.
- **Bindings** (`actionmaps.xml`'s `spaceship_movement` actionmap): `v_yaw`/`v_pitch`/`v_roll`/
  `v_strafe_lateral`/`v_strafe_vertical`/`v_strafe_longitudinal` map to the vJoy device's X/Y/Z/RX/
  RY/RZ axes respectively — must match `feeder/vjoy_feeder.py`'s own `AXIS_MAP` exactly.
  `profiles/switch_profile.py activate vjoy` installs this.
- **Check for an unconfirmed default response curve on the vJoy device's rotation axes** — an empty
  `<options>` block in `actionmaps.xml` (no child elements) means SC's factory-default curve is in
  effect, not necessarily linear. `fit_model.py`'s `u_fn` assumes a clean step to ±1.0 with no curve
  in between; if the real default curve isn't linear, every fitted thrust/drag value is biased by
  it. Options > Keybindings > Advanced Controls Customization has a per-axis curve graph — inspect
  and flatten to linear if the cleanest possible fit matters, and confirm a real override then
  appears explicitly in `actionmaps.xml`.
- **`attributes.xml`** (same directory as `actionmaps.xml`, NOT tracked by `profiles/switch_profile.py`)
  carries settings actionmaps doesn't, e.g. `VJoyCombinedDeadZone` (a combined-axis deadzone as a %
  of full stick range) and `IFCS_Setting_CoupledEnabled`. A hard step-to-±1.0 reversal maneuver is
  largely insensitive to the deadzone (it doesn't dwell near center), but any analog/ramped maneuver
  needs to account for it explicitly.

## Gotchas (keep this list growing)

**Mouse/vjoy accumulator & input mechanics**
- Accumulator hard-clamps at half the capture resolution in the relevant dimension — see "Mouse
  virtual-joystick mechanics" above.
- The mouse vjoy accumulates relative deltas — drive a target position, not a velocity waveform.
- Windows pointer acceleration must be pinned 1:1 before any calibrated run.
- Settings XML can't be live-edited while SC runs — restart SC or drive the in-game slider instead.

**Focus / input delivery**
- SC must be the foreground window or injected input goes nowhere — silently invalidates whole clips.
- `focus_and_click`'s click can fire a shot (armed weapons) — use `focus_no_click()` when that
  matters or for keyboard-only captures.
- Esc×2 reset (clears residual stick deflection) must be OFF for roll's keyboard capture (it would
  open the pause menu into the clip) but is needed for mouse work.
- Watch for 32-bit-vs-40-byte struct-packing bugs in raw `SendInput` wrappers — a mismatched `INPUT`
  union size can silently make an injected event a no-op.

**Projection / tracking math**
- Use arctan/pinhole projection (`f = (width/2)/tan(FOV_h/2)`), not linear FOV/width — linear
  undercounts substantially, worse off-axis.
- Focal length must always derive from the HORIZONTAL dimension/FOV and be reused as-is for the
  vertical (pitch) axis — deriving it from `height` with the horizontal FOV inflates every pitch
  rate by exactly the aspect ratio. Extend self-tests to cover every axis added, not just the one
  that happens to get exercised first.
- `peak_brightness` staying high is NOT sufficient proof of correct lock — a screen-fixed bright UI
  element can be just as bright as the real landmark. A flat/frozen trajectory with sustained high
  peak brightness is itself a red flag for exactly this failure mode.
- Off-center POINT landmarks for roll must stay within half the frame's shorter dimension; ELONGATED
  landmarks tracked by axis-angle should instead be kept CENTERED (opposite rule) — see "Choosing
  and seeding a landmark" above.

**Capture/analysis tooling**
- `hold_rate.py`'s default `--skip 0.7` can silently return an EMPTY result table against a short
  dwell (the steady-state window is empty) — not a tracking failure; shorten `--skip`.
- `mouse_hold_capture.py --offsets 0,<target> --dwell T` holds every offset for the full dwell — see
  "Mouse virtual-joystick mechanics" above.
- `segments.json`'s `t_start` marks when a ramp COMPLETES, not when it starts — the true step/
  reversal onset is `t_start − ramp_duration`.
- Counter-maneuvers to re-center a landmark must replicate the original hold's boost state, or they
  under/over-correct.
- Always read a 360-test's "before" position from the capture's own recorded frame 0, never a
  pre-capture screenshot (can be stale by the time focus/click + OBS settle actually finish).
- A short hold/dwell may not clear a BOOSTED spool-up time and will under-read the true steady
  rate — trust a long-hold/360 cross-check over a short-hold average when they disagree.

**Flight-mode / fitting**
- Decoupled vs. Coupled is a full confound, not noise — `shipTypes.ts`/`flightModel.ts` model
  Coupled flight only. Always confirm/log flight mode per trial; it isn't visible from footage or
  `meta.json` by default without an explicit check.
- Sign convention is per-axis, not universal — determine it via a first `symmetric`-model fit
  before trusting `mass_only` (see "Per-ship procedure" step 7).
- Keep negative-G-axis (downward/retro) maneuvers short — G-force blackout/redout hits much sooner
  (~3-5G) than positive-G axes; verify via per-frame brightness that the accel-to-plateau portion
  happened at full consciousness/brightness.
