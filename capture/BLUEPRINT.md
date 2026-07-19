# Blueprint: capturing real flight-tuning data, per ship

A reusable procedure for turning "fly the ship in a private Arena Commander instance" into fitted
`shipTypes.ts` candidate constants, plus a running log of what's been captured so far. Written after
the first full pass (Gladius, yaw axis, reversal maneuver) so the same steps can be repeated for
**Taurus next, then Arrow** without re-deriving the method each time.

Read `README.md` and `settings_checklist.md` first — this file assumes that toolchain and only adds
the per-ship workflow and gotchas layered on top of it.

> **⚠️ For a FAST full-ship capture (roll/pitch/yaw/linear steady-state), use `PLAYBOOK.md`, NOT the
> "Per-ship procedure" below.** That section documents the older `orchestrate.py`/`fit_model.py`
> vJoy-*device* path, which only ever did yaw-reversal and never produced a complete ship spec. The
> Gladius was fully characterized (2026-07-19) with the **hold-capture** tools
> (`roll_hold_capture.py` / `mouse_hold_capture.py` / `linear_hold_capture.py` + `track_orientation` /
> `track_landmark`+`angle_convert` / `montage_speed`) — `PLAYBOOK.md` is the runnable recipe for
> repeating that on the next ship. The device path here stays relevant for the reversal-transient /
> drag-vs-governor research in the Findings log, not for a quick steady-state spec.

## Open items / next steps (as of 2026-07-19 — read this first when resuming)

Written deliberately for a fresh session with no prior context — read the relevant Findings log
entry (below) before acting on any of these, not just this summary.

> **NOTE — a second, parallel workstream started 2026-07-19: the MOUSE virtual-joystick + vjoy-settings
> investigation lives in `MEASUREMENTS.md` (read its "STATUS / RESUME HERE" section first).** It drives
> the **mouse** (not the vJoy device) to measure what SC's `VJoyAnglePilots`/`VJoyCombinedDeadZone`
> etc. do, for recreating mouse-flight feel in `sc_webgl`. **Gladius ROLL (keys Q/E) is now captured**
> — see the new "Roll capture — orientation-tracking" section below and MEASUREMENTS.md "Gladius ROLL"
> (±202 °/s, confirms the coded 200). New tools: `roll_hold_capture.py`, `analysis/track_orientation.py`.
> The mouse-path tools (`mouse_hold_capture.py`, `mouse_sweep_capture.py`, `feeder/mouse_feeder.py`,
> `feeder/win_focus.py`, `pointer_accel.py`, `analysis/track_vjoy_indicator.py`, `analysis/hold_rate.py`)
> are separate from the device-capture tools below. ✔ Pointer acceleration RESTORED 2026-07-19.

**Not started at all:**
- **Strafe axes (lateral/vertical/longitudinal linear thrust)** — genuinely untouched by this
  toolchain so far. Different methodology needed: strafe is pure translation, doesn't move a visual
  landmark's bearing at all, so it can't use `track_landmark.py`. Read the HUD's numeric `m/s`
  speed indicator instead (visible in every screenshot this session, e.g. near the throttle bar).
  No OCR engine is installed (`pytesseract` the Python wrapper was pip-installed, but the actual
  Tesseract binary needs a separate system-level installer, not done — see the CPLD-detection
  section's reasoning for preferring template-matching over installing new system dependencies).
  A digit-template-matching approach (same technique as `analysis/hud_checks.py`'s CPLD glyph
  match, extended to 0-9 digit glyphs) is the likely path, OR manual screenshot-reading at a few
  timestamps if that's not worth building yet. Note `shipTypes.ts`'s own measurement notes already
  have dense hand-transcribed forward/retro/strafe traces (thrust~145 for strafe, drag~0, a
  "governor not drag" character) — this would be cross-validating/refining those, not a first
  measurement from nothing.
- **Boost** — **boosted ROLL now captured** (±235 °/s, confirms coded 240 — MEASUREMENTS.md "Gladius
  ROLL"): `roll_hold_capture.py --boost` holds the boost input (RMB by default, or `--boost-scan` for
  a key) across a keyboard Q/E roll sequence. Still uncaptured: **boosted PITCH/YAW** (coded 82/62 °/s)
  and **boosted linear** (top speed 520/268 m/s). Pitch/yaw are mouse-analog, so they need the same
  boost-hold wrapped around the MOUSE method (`mouse_hold_capture.py` + point-landmark bearing), not
  this keyboard/orientation path. NB `feeder/vjoy_feeder.py` (the device path) still has no
  keyboard/button-press capability, if boost is ever wanted alongside a vJoy-device maneuver.
- **Decoupled mode** — only encountered so far as an accidental confound (it silently invalidated
  the first yaw dataset). Never deliberately/properly captured to characterize its OWN dynamics,
  which may need a different model entirely (e.g. no RCS damping at all, closer to free rotation)
  rather than being a variant of the coupled-flight model this whole toolchain has been fitting.
- **Taurus, Arrow** — not started. See their own placeholder sections far below. Taurus isn't even
  in `src/physics/shipTypes.ts` yet.

**Partially open / would benefit from more data:**
- **vJoy response-curve shape** — confirmed nonlinear for yaw at one point (u=0.5 gives ~65% of
  u=1.0's rate, not 50%), but only ONE partial-deflection point has been tested. Testing u=0.25 and
  u=0.75 (and checking whether pitch/roll show the same curve or a different one) would be needed
  before attempting any curve-correction in `fit_model.py`'s `u_fn`.
- **Roll's drag-vs-governor character** — still genuinely ambiguous, but there is NEW keyboard-roll
  evidence (2026-07-19, MEASUREMENTS.md "Gladius ROLL"): with clean 3 s holds, **spool-up looks
  drag-like** (exponential approach, τ≈0.20 s) while **release-decel looks governor-like** (linear,
  hard stop in ~0.5 s, ~40° roll-out — *less* than exponential drag's 200·τ=56° and no asymptote).
  That points at spool-up vs coast-down having DIFFERENT character (the "spin-up vs coast-down
  conflation" item below), not at a single answer. Two caveats: the measured τ≈0.20 s is below the
  coded 0.28 s (real, or a moment-tracker/smoothing bias — unresolved), and the reversal slice hit an
  unwrap glitch. NOT acted on (flightModel is ported-verbatim). Earlier device-capture context: fitted
  drag pinned at exactly 0 across 4 trials; the sustained-rate 360°-check confirmed roll's STEADY
  state matches spec but doesn't probe the TRANSIENT shape.
  Also unfixed: roll trial `223005` was excluded as an outlier without individually diagnosing why
  (no frozen-trajectory or sync-offset signature was specifically checked for it) — worth a look if
  ever revisited.
- **Pitch's reversal-drag reduction is noisier than yaw/roll's** — converges to a real interior
  value (1.43) rather than pinning at a bound, but the fit's RMS is a much larger fraction of the
  signal than yaw/roll's. Genuinely unclear whether pitch has a smaller real effect or the same
  effect obscured by more measurement noise. More pitch reversal reps would help distinguish these.
- **Spin-up vs. coast-down drag conflation, still open even after the no-motion-trial correction.**
  `yaw_spool_up.json`'s maneuver includes both a held phase AND a released-neutral coast phase in
  one clip; a plain symmetric fit across the whole thing can't distinguish "drag during spin-up" from
  "drag while coasting after release" — this was flagged as a hypothesis for why the (since-retracted,
  noise-contaminated) original fit looked low, and remains untested with the corrected clean data
  too. Would need a maneuver that isolates the two phases (e.g. a much longer held-then-released
  single-direction hold) to actually check.

**Decision pending, not yet acted on:**
- **Whether/how to implement the reversal-specific asymmetric drag in `flightModel.ts`.** Evidence
  is solid for yaw and roll (drag pins to 0 in every independent fit), weaker for pitch. This is an
  equation change (an "is input opposing the current spin" branch), not a constant tweak — `CLAUDE.md`
  flags this file as deliberately hands-off/ported-verbatim, so this needs an explicit go-ahead, not
  something to fold into further data collection. The vJoy curve nonlinearity (above) is a reason for
  a bit more caution here too: worth being sure the reversal-drag finding isn't itself somehow an
  artifact of the input curve before committing it to code.
- **Cross-ship mass-scaling** (harald's idea) — mass only sets the time constant, not the steady-state
  rate (which is thrust/drag, mass-independent) — so this needs Taurus's (and ideally Arrow's) fitted
  triplets alongside Gladius's before it's even checkable, not answerable from Gladius alone. See the
  dedicated section below.

## Roll capture — orientation-tracking of an elongated landmark (Kareah) — added 2026-07-19

A better method for **ROLL** than the point-landmark procedure below, built in the keyboard/mouse
workstream (tools live in `capture/` alongside MEASUREMENTS.md's, not `orchestrate.py`). Full
results: MEASUREMENTS.md "Gladius ROLL" (±202 °/s steady, confirms the coded 200; plus transient
evidence on the drag-vs-governor question).

**Core idea — track ORIENTATION, not position.** Roll rotates the whole image about screen center. A
POINT landmark only reveals roll via its polar angle about center, so it must sit OFF-center (radius
< half the frame's short side — see point 3 below) and it ORBITS during the roll, swinging behind the
cockpit bars / off-frame on a near-full rotation. A LONG landmark instead reveals roll through its
**long-axis angle**, which is *independent of screen position* — so you:
- keep it **CENTERED** (it then stays framed through a full 360°, never orbits into an occluder), and
- read its major-axis angle each frame (intensity-weighted 2nd moments = PCA of the lit structure).

This is the **opposite** of the point-landmark off-center rule — a long landmark *wants* to be dead
center.

**Landmark: Security Post Kareah (PU).** A long lit "post" giving a clean elongated axis. An empty
Arena Commander starfield has **no usable roll landmark** (too dim, no bright compact/elongated
feature) — which is why roll capture moved to the persistent universe. Setup: Kareah **centered +
vertical**, ship **0 m/s, Coupled**, **~7 km** standoff (post ≈ 280 px tall at 4K; closer/bigger
survives blur better, but 7 km with blur off is fine), **motion blur OFF** (critical — see gotchas),
OBS **50 Mbps H.264** (the 6 Mbps default smears the thin post).

**Tools** (roll is keyboard Q/E, not a vJoy axis):
- `roll_hold_capture.py --sequence "Q:3.0,_:3.0,E:3.0,..."` — scripted Q/E holds/releases (`_` =
  coast) via scan-code SendInput (Q=0x10, E=0x12). Focuses SC **click-free and BEFORE OBS starts**
  (`win_focus.focus_no_click`) so nothing fires into the station and no pause-menu/flicker lands in
  the clip; logs each key event + segment schedule for time-alignment.
- `analysis/track_orientation.py <video> --seed-x --seed-y --window --floor-pct --mask-below <y>` —
  long-axis angle per frame; `--mask-below` zeros a screen-fixed occluder (the cockpit **radar dish**
  hides the centered post's lower end). Mod-180 unwrap (via angle-doubling — a rod is symmetric) then
  savgol-differentiate → roll rate. Logs **elongation** per frame as the lock-quality signal (drops
  toward 1 = lost the post; healthy run stayed 2.3–4.3, zero lost frames).

**Gotchas (each cost a run):**
- **SC must be the foreground window** or Q/E SendInput goes nowhere — a whole clip once read flat
  zero. `focus_no_click` fixes it; keyboard input needs foreground, not the cursor-capturing click.
- **Motion blur smears the thin post** at ~200 °/s → elongation collapses and the tracker grabs HUD.
  Turn it OFF in SC graphics. This was the single biggest fix.
- **Esc-reset opens the pause menu into the clip** — OFF by default for roll (keyboard roll has no
  mouse-stick deflection to reset). Only the mouse/yaw work needs the Esc×2 reset.
- **Radar dish / boost bars / velocity vector** are screen-fixed and out-shine the post's lower half
  when it's centered → `--mask-below` past them (used 1200 with the post centered at y≈1018, window
  150, floor-pct 88).
- Because it's centered it **never orbits**, so a big/close post is safe (no off-frame risk) — the
  point-landmark radius limit does not apply.

## Per-ship procedure

1. **Lock in-game settings** per `settings_checklist.md` (FOV, motion blur off, camera shake off,
   frame cap, vJoy profile active — `python profiles/switch_profile.py status` must report `vjoy`).
2. **Confirm the ship** (F3/loadout — matters because the fit constants are per-ship; the ship's name
   goes into every trial via `--ship`, see below).
3. **Pick and seed a landmark** per README's "Choosing a landmark to track": bright, high-contrast,
   off-reticle. A single-frame screenshot (`ffmpeg -f gdigrab -video_size <WxH> -i desktop -frames:v 1
   -update 1 seed_check.png`) plus a few iterations of `track_landmark.centroid_in_window` on that
   still frame gives an exact converged seed — don't eyeball it (see README point 4). Re-take this
   screenshot any time the game restarts/reconnects; ship attitude relative to the landmark can drift.
   **Match `--window` to the landmark's actual pixel size** (crop around the converged seed and
   threshold-count bright pixels to measure it) — a small bright target (e.g. a moon at a few % of
   screen width) wants something close to the 40px default; a large marking (e.g. a 10-15%-of-screen
   station pad) needs 150+.
   **For roll specifically, the landmark's radius from frame CENTER must stay within half the
   frame's SHORTER dimension** (height, in landscape — e.g. `< ~1080px` at 3840x2160), not just "off
   center" — see Gotchas below for why a too-large radius sends the landmark off-screen partway
   through the rotation.
4. **Run the trial**: `python orchestrate.py feeder/maneuvers/<maneuver>.json --ship <Name> --axis
   {x,y,roll} --flight-mode {coupled,decoupled} --fov <deg> --resolution <WxH> --seed-x <x>
   --seed-y <y> [--window <px>] [--backend obs]`. Writes to `data/<Name>/<maneuver>/<timestamp>/`.
   **Prefer `--backend obs`** once OBS is configured per the "OBS backend setup" section below — its
   frame timing measured dramatically cleaner than ffmpeg's `gdigrab` (exact 60fps vs. 0-83ms
   jitter) and fixed both a false early sync trigger and a noisy baseline in practice.
5. **QA each trial before trusting it** — peak-brightness lock is necessary but NOT sufficient:
   - Check `orchestrate.py`'s own lost-lock warning (peak brightness < half the clip's max).
   - **Also eyeball the raw `trajectory.csv` pixel positions** for the segment(s) that should be at
     steady state (a plateau just before a scripted reversal/stop). A real steady state moves a
     roughly constant number of pixels per frame; a trial where that motion decays toward ~0 while
     the maneuver's input segment is still fully held is NOT the ship settling — the model predicts
     the opposite (rise-then-hold, never spontaneous decay under constant input) — treat it as a bad
     trial (tracking hiccup, an in-game interruption, or an actual control/binding problem) and
     exclude it, noting why, rather than silently averaging it in. (See "Gotchas" below — this
     happened on Gladius yaw trial 3.)
6. **Repeat 2-3+ times** per maneuver/axis for a joint fit (more reps tighten the fit and let you spot
   an outlier trial by comparing per-trial RMS, not just eyeballing one clip).
7. **Determine the sign convention once per axis/setup**, before trusting `mass_only`: run
   `fit_model.py`'s `symmetric` model first; if it fits a *negative* thrust, the tracked pixel axis
   runs opposite the vJoy command's positive direction (e.g. "nose right" slides a background
   landmark left) — rerun everything, `mass_only` included, with `--sign -1`. `asymmetric`/`symmetric`
   don't strictly need this (they can absorb the flip into thrust's sign, magnitudes still compare
   directly to `shipTypes.ts`), but `mass_only`'s thrust/drag are fixed positive and will silently
   produce garbage (a huge, meaningless mass) if the sign is wrong — see "Gotchas".
8. **Joint-fit the reps**: `python analysis/fit_model.py feeder/maneuvers/<maneuver>.json
   data/<Name>/<maneuver>/<t1> data/<Name>/<maneuver>/<t2> ... --mass <shipTypes mass> --thrust0
   <angularThrust[axis]> --drag0 <angularDrag[axis]> [--sign -1]`. Compares three models
   (`symmetric`, `asymmetric`, `mass_only` — see the script's docstring for what each tests) with
   physically-bounded (non-negative) parameters.
9. **Record the outcome** in this file's findings log below (numbers + interpretation), regardless of
   whether it confirms or contradicts the current `shipTypes.ts` constants — a clean null result
   ("existing model already fits") is as useful to log as a surprising one.

## Automated checks (replacing manual screenshot-eyeballing)

Raised directly by harald: a lot of this session was spent manually screenshotting and eyeballing
"are we still in the cockpit" / "is Coupled actually on" — both are now automated, non-ML, cheap
checks in `analysis/hud_checks.py`, wired into `orchestrate.py` (`check_flight_mode`, runs before
every OBS-backend trial and raises rather than warns on a mismatch).

- **Flight-mode + in-cockpit detection**: the HUD shows a "CPLD" label directly under "ESP" in the
  left cluster only when Coupled is on. `analysis/hud_checks.py` template-matches a reference crop
  (`analysis/cpld_template.png`) against a generous search window, giving a match score cleanly
  separated into three bands (validated against every screenshot from this session, 100% correct):
  `< 0.5` = not even in the cockpit (menu/crash/loading screen), `0.70-0.75` = Decoupled, `0.82-1.0`
  = Coupled. **A first version of this check counted bright pixels in a fixed region instead of
  template-matching** — raised as a concern (correctly): ESP's own box can shift/bleed brightness
  into the region independent of whether CPLD is actually present. Confirmed happening in practice:
  that version reported Decoupled once when Coupled was actually on, right around a game restart.
  Template-matching the actual glyph shape is far more specific and doesn't have this failure mode.
- **Still worth a real explanation, not fully resolved**: even the pixel-count version's single
  false read is unexplained — a fresh screenshot moments later (same method) correctly showed
  Coupled. Possibly a real momentary state around a restart that got corrected before anyone
  noticed, possibly a staleness/caching quirk in `get_source_screenshot`. Not reproduced since
  switching to template matching, but flagging in case it recurs.

**Auto-centering / repositioning the landmark without a human flying the ship** — raised as a
question, not yet built, recommendation below rather than an implementation:
- For the actual "where to seed" precision, no ML is needed — `track_landmark`'s brightness
  centroid is already exact, and a **closed-loop visual-servo** (read the landmark's current pixel
  offset from the desired screen position, convert to a small corrective yaw/pitch command, drive
  it via `vjoy_feeder`, iterate until converged) is a fully classical-CV approach that would work
  for the common case (target already visible somewhere in frame after a maneuver, just not
  perfectly placed) — no need for SigLIP2/CLIP-style models for this part specifically.
- Where a vision-language model plausibly WOULD help: (1) the "target is not visible in frame at
  all, and I don't know which way to turn" cold-search case, if brightness-threshold blob detection
  (find the largest sufficiently-bright connected component in the full frame) isn't discriminating
  enough once other bright objects are in scene; (2) more valuably, **automating exactly the
  in-cockpit/crash/menu classification this session did by hand** — a zero-shot "does this frame
  look like an in-flight cockpit view" classifier as a fallback/cross-check alongside the
  CPLD-template method above, useful if the cockpit layout changes (different ship, different HUD
  customization) and the template needs re-deriving anyway.
- Net recommendation: build the classical visual-servo loop first (cheap, precise, no new
  dependencies) if/when auto-centering is worth the engineering time; treat a vision-language model
  as a fallback for the cold-search and scene-classification cases specifically, not a replacement
  for the centroid tracker.

## OBS backend setup (preferred over ffmpeg -- much cleaner frame timing)

`ffmpeg`'s `gdigrab` (used for every capture up through the first Gladius yaw dataset) has real,
measured frame-timing jitter (0-83ms gaps at 4K -- see README's "Capture backend performance").
Switching to the OBS backend (`--backend obs`), once actually configured correctly, gave frame
gaps of **16.665-16.667ms, essentially exact 60fps**, measured via
`ffprobe -show_entries frame=best_effort_timestamp_time`. This directly fixed two things at once:
a false "motion onset at frame 0" (the sync fallback was mis-triggering on jitter-driven noise
during the pre-maneuver quiet hold) and a very noisy quiet-hold baseline (omega swinging ±20-100
deg/s before switching, under ±1 deg/s after). **If you're fighting noisy-looking data or bogus
early sync, try the OBS backend before assuming it's a real ship-behavior anomaly.**

Getting `--backend obs` actually working took real setup, none of it obvious from `recorder/obs_capture.py`
alone (which only wraps start/stop, not scene configuration):

1. **OBS must have a scene with an actual capture source** — a fresh/default OBS scene has ZERO
   source items (confirmed via `get_scene_item_list` returning an empty list) and records a blank
   video otherwise. Add a `monitor_capture` input (`client.create_input(scene, name, 'monitor_capture', {}, True)`),
   not `window_capture`/`game_capture` (untested here, monitor_capture is what was validated).
2. **Get the exact monitor device path from the input's own property list, don't hand-type it.**
   `client.get_input_properties_list_property_items(input_name, 'monitor_id')` returns each
   monitor's exact `itemValue` (a Windows device path like `\\?\DISPLAY#...`). Passing that value
   through Python `print()`/dict-repr and retyping it back as a string literal is a real trap — the
   repr doubles backslashes, and re-typing it as a raw string double-escapes it AGAIN, so
   round-tripping through a printed value produces a corrupted path (hit this exact bug: cost a
   blank-white capture before realizing it). Always pass the value straight from the same
   API-returned variable, never retype it from printed output.
3. **The `monitor_id` property list's monitor resolutions are the PHYSICAL pixel dimensions** (e.g.
   correctly showed `3840x2160`), unlike `get_monitor_list()`'s `monitorWidth`/`monitorHeight`
   fields, which reported the DPI-scaled *logical* resolution (`2560x1440` at 150% scaling) --
   another instance of the DPI-scaling trap already noted in README's landmark-selection section,
   now confirmed to also apply to obs-websocket's own monitor enumeration, not just .NET/PowerShell
   APIs.
4. **`monitor_capture`'s default `method` ("Automatic") silently produced a blank white image** —
   confirmed via `get_source_screenshot` (mean pixel value ~255, zero variance) even though the
   source was configured correctly (right monitor, right resolution). Explicitly setting
   `method: 1` (DXGI Desktop Duplication) or `2` (Windows 10 WGC) both fixed it immediately (mean
   ~20, real variance, visibly the game). Root cause not confirmed, but Star Citizen (like many
   anti-cheat-protected games) plausibly blocks whatever capture path "Automatic" picked by default
   while allowing DXGI/WGC directly — if a `monitor_capture` source in some future OBS version
   picks a different default, check for the same blank-white symptom.
5. **Set canvas (base) AND output resolution to the monitor's physical resolution, and FPS
   explicitly** — `client.set_video_settings(60, 1, 3840, 2160, 3840, 2160)`. A fresh OBS profile
   defaulted to base 1920x1080/output 1280x720/30fps, none of which match this project's capture
   assumptions.
6. **Force the scene item's transform to exact 1:1** (`positionX/Y: 0`, `scaleX/Y: 1.0`) via
   `set_scene_item_transform` — don't trust whatever auto-fit scaling OBS applied when the source
   was created against a mismatched canvas size.
7. **`recorder/obs_capture.py`'s `stop()` needed a longer settle delay than its original 0.5s
   default (now 2.0s)** — hit a real 0-byte `raw.mp4` in a trial dir because `orchestrate.py`'s
   `shutil.copy` ran before OBS finished finalizing the file's `moov` atom; the source file in
   OBS's own recording directory (`get_record_directory()`, NOT this repo's `data/`) had real
   content and just needed more time.

None of this is exposed as a repeatable script yet — if this becomes the default backend, worth
writing a small `recorder/obs_setup.py` that does steps 1-6 idempotently instead of hand-running
snippets each session.

## Data layout

`data/<Ship>/<maneuver>/<timestamp>/` — `raw.mp4`, `input_log.csv`, `trajectory.csv`, `omega.csv`,
`meta.json` (now includes `"ship"`). Partitioned by ship specifically so Taurus/Arrow captures never
collide with Gladius's, and so `fit_model.py` runs can glob a whole ship's reps at once later.

**Exception: the before/after 360°-checks don't follow this layout** — they need no trajectory, so
they're stored as loose top-level CSV logs under `data/<Ship>/` (`yaw_360_check_input_log*.csv`,
`pitch_360_check_log*.csv`, `roll_360_check_log*.csv`), one per rep, with no per-timestamp trial dir.

**Legacy trials**: the four trials under `data/yaw_reversal/<timestamp>/` (before this blueprint)
predate the `--ship` tag and the landing-pad-vs-moon landmark switch — they're *probably* Gladius
(matches the checklist's ship requirement) but that isn't recorded, so treat them as unlabeled/legacy;
don't fold them into a ship-specific joint fit without checking their footage first.

## vJoy / Star Citizen input configuration (how to recreate it)

What's actually wired up, read directly from the live profile rather than assumed:

- **Device**: vJoy device #1, 8 axes enabled (X/Y/Z/RX/RY/RZ + 2 sliders), per README's
  Prerequisites. In this profile it enumerates as joystick **instance 3**
  (`Product="vJoy Device ..."` in `actionmaps.xml`'s `<options type="joystick" instance="3">` —
  instance number is enumeration-order-dependent, always confirm against your own file rather than
  assuming "3").
- **Bindings** (`actionmaps.xml`'s `spaceship_movement` actionmap): `v_yaw`→`js3_x`,
  `v_pitch`→`js3_y`, `v_roll`→`js3_z`, `v_strafe_lateral`→`js3_rotx`,
  `v_strafe_vertical`→`js3_roty`, `v_strafe_longitudinal`→`js3_rotz` — matches `feeder/vjoy_feeder.py`'s
  `AXIS_MAP` exactly (`yaw`→X, `pitch`→Y, `roll`→Z, `strafe_lateral`→RX, `strafe_vertical`→RY,
  `strafe_longitudinal`→RZ). This is what `profiles/switch_profile.py activate vjoy` installs.
- **No explicit curve/deadzone/invert override on the vJoy device's rotation axes.** The vJoy
  device's `<options type="joystick" instance="3" .../>` block in `actionmaps.xml` is empty — no
  child elements at all. Compare to the *real* HOTAS (instance 1), which has an explicit
  `<flight_move_strafe_vertical invert="1"/>`, and the T-rudder's separate `<deviceoptions>` block
  with per-axis `saturation`/`deadzone` values. This means v_yaw/v_pitch/v_roll on the vJoy device run
  whatever Star Citizen's factory-default response curve is for those actions — **not confirmed to be
  linear**, just not overridden. `fit_model.py`'s `u_fn` assumes a clean step to ±1.0 with no curve
  in between; if that default curve isn't linear, every fitted thrust/drag value here is biased by
  it. To check/fix: Options > Keybindings > Advanced Controls Customization has a per-axis curve
  graph for Pitch/Yaw/Roll — inspect it and flatten to linear if you want the cleanest possible fit,
  then re-save (a real override should then appear explicitly in `actionmaps.xml`, which is worth
  confirming happened).
- **`attributes.xml`** (`USER\Client\0\Profiles\default\attributes.xml`, same directory as
  `actionmaps.xml`, NOT copied/tracked by `profiles/switch_profile.py`) carries settings actionmaps
  doesn't: `VJoyCombinedDeadZone="4.45"` — a combined-axis deadzone of ~4.45% on joystick input.
  Since every maneuver here commands a hard step straight to ±1.0 (never dwelling near center except
  momentarily at rest before t=0), this deadzone likely doesn't bias the *reversal* maneuvers'
  fits, but it would matter for anything analog/ramped (partial-input maneuvers) — account for it
  explicitly if any get added. `VJoyMgvCombinedDeadZone="0"` is a separate (zero) deadzone for
  whatever SC internally scopes as "Mgv" input.
- **`IFCS_Setting_CoupledEnabled` (also in `attributes.xml`) — confirmed the hard way to matter a
  lot.** See Gotchas below; this is the important one.

## Mouse virtual-joystick + measuring SC's "vjoy" settings (2026-07-19)

Separate workstream from the vJoy-*device* flight-tuning capture above: characterize what Star
Citizen's **mouse virtual-joystick** ("vjoy") settings do, to recreate them in `sc_webgl`'s own vjoy
input mapping (the F4 range/deadzone controls). Driven by the **mouse**, not the bound vJoy device —
see below for why. Tooling: `feeder/mouse_feeder.py` (relative-mouse injection),
`mouse_sweep_capture.py` (OBS-recorded known mouse sweep), `analysis/` indicator detection (WIP).

**Findings that shaped the approach:**
- **`VJoyAnglePilots` (in `attributes.xml`) is the setting under study** — the value the in-game
  vjoy slider writes (observed changing 4 → 25). NOT in `actionmaps.xml` (that stayed byte-identical).
- **Live XML edits are futile while SC runs.** SC reads config at launch and *overwrites*
  `attributes.xml` from memory on change/exit — an edit to `VJoyAnglePilots` (25→10) was neither
  picked up on opening the settings menu (menu still showed 25) nor left intact (file reverted to 25).
  Applying a setting therefore needs either an SC **restart** (edit-while-closed) or driving the
  **in-game slider** (UI automation). Backups: `data/attributes_backups/`.
- **The on-screen vjoy indicator responds to the MOUSE, not the bound vJoy device** (device-axis
  sweeps left it dead still). So these settings must be measured by driving the mouse.
- **Mouse injection**: Win32 `SendInput` + `MOUSEEVENTF_MOVE` (relative). SC's virtual joystick
  **accumulates** relative deltas into an absolute stick position (confirmed — a velocity-sine
  injection drove it rightward-only because Σsin = 1−cos ≥ 0). Drive *target position* and inject the
  per-tick delta (see `mouse_feeder.oscillate`). Windows pointer accel/"Enhance pointer precision"
  was ON (~0.8× scaling seen) — pin to 6/11 + disabled before any *calibrated* run.
- **Rough sensitivity** (with accel on): ~1200 counts ≈ 50% deflection → **full ≈ ~2400 counts**.
- **Fast oscillation isolates the indicator**: a full-range swing at ~1 Hz keeps the ship nearly
  still (yaw rate reverses before angle builds) while the indicator still swings fully — a 1 Hz
  lock-in on the recording then rejects slow scene/object drift.

**Indicator constants (manually measured by harald, at 3840×2160 capture res):**
- **Shape**: the indicator's end is a **triangle (3 lines)**; pointing left it is ~**20 px tall ×
  ~10 px wide**. At full deflection 3 tiny white dots appear at the triangle's edges — too small to
  rely on.
- **Color ramp**: ≈ **`#1C2332`** at rest / near-zero movement (against fully dark background),
  **intensifying with deflection** up to ≈ **`#8C8AE9`** at full movement. (So brighter/more-lavender
  ⇒ more deflection — a secondary readout alongside position.)
- **Horizontal travel** (screen-x): does **not** go further **left than ~1264 px** nor further
  **right than ~2550 px** — i.e. it lives in a band roughly centered on screen center (~1907 px).
- **Detection — what works** (`analysis/track_vjoy_indicator.py`): temporal, not color/spatial. The
  indicator is faint and small and flanked by BRIGHT static cockpit struts at the strip edges;
  "brightest/farthest bluish pixel" and bg-subtracted-centroid trackers both lock onto the struts and
  report fake full deflection (a sampled "full-deflection tip" came back near-black — it was empty
  space by a strut). What works: a thin band at screen-center y, then a **per-pixel lock-in at the
  sweep frequency f0** to build a mask of the indicator's own track — static struts (no f0 energy)
  and drifting scene (incoherent with f0) are excluded by construction — then the f0-masked motion
  centroid. Validated at 0.98 Hz on a 1 Hz sweep. Needs f0 and a FAST sweep (see next).
- **The indicator has heavy display SMOOTHING** — the load-bearing constraint. A *fast* sweep is
  required so the ship stays still (else the scene moves at f0 and defeats the mask), but at fast
  rates the indicator is heavily attenuated: a ±1500-count, 1 Hz sweep deflected it only **±110 px of
  its ±643 travel**. So fast-sweep indicator tracking gives a clean but SMALL signal; reaching full
  deflection needs slow/sustained input, which makes the scene move at f0 too. This tension is why
  the **ship yaw rate** (big signal, proven `track_landmark`→`omega` pipeline, immune to all of the
  above) is the better *primary* observable for "what does the setting do to flight"; the indicator
  is a secondary/cross-check readout of the input mapping.
- **`feeder/win_focus.py` focus+click is REQUIRED before every sweep** — injected mouse motion only
  reaches flight if SC is the foreground window; two baseline captures were invalidated by the game
  not being focused. Wired into `mouse_sweep_capture.py`/`mouse_hold_capture.py`. It also presses
  **Esc twice** (opens+closes the menu) to reset the virtual joystick to neutral — a residual mouse
  deflection once pitched the ship down mid-sweep and lost the landmark behind the cockpit bars. The
  click lands on the reticle (fires a shot if armed). Also **pin pointer accel first**
  (`pointer_accel.py pin`) so injected counts map 1:1 to SC (accel was on, ~0.8×); `restore` after.

### RESULT — VJoyAnglePilots does NOT affect flight (2026-07-19)

Measured via `mouse_hold_capture.py` (held mouse offset → sustained yaw) + `analysis/hold_rate.py`
/ a simple by-direction median of the star-tracked yaw rate (the robust ship-rate observable, not the
fragile indicator). Taurus, Coupled, pointer accel pinned 1:1, landmark = a landing-pad light ring.

| mouse offset | VJoyAnglePilots = 4 | VJoyAnglePilots = 25 |
|---|---|---|
| ±600 counts  | 4.61 °/s | 4.53 °/s |
| ±1400 counts | 10.88 °/s | 11.16 °/s |

**Changing VJoyAnglePilots 6× left the mouse-offset→yaw-rate mapping unchanged at both small and
large deflection.** So `VJoyAnglePilots` is a **visual/indicator-only setting** (it changes the
on-screen vjoy indicator's travel/appearance — which is why the indicator responds to it — but NOT
the actual input→ship response). It is therefore **irrelevant to recreating SC's flight feel** in
`sc_webgl`. The measured mapping itself is **linear ~0.0078 °/s per mouse count** (with accel pinned
1:1), no saturation up to ±1400, symmetric — that linear gain, not VJoyAnglePilots, is what governs
mouse-flight sensitivity. Next candidates if pursuing further: `VJoyCombinedDeadZone` (near-center
deadzone), and whether any setting scales that gain at all vs it being fixed.

## Gotchas hit so far (keep this section growing)

- **Game can silently drop to the title/splash screen mid-session** (crash/disconnect) without
  `orchestrate.py` itself erroring at capture time — it only surfaces later as `detect_motion_onset`
  raising "no sustained motion onset detected." If that fires, check a frame of `raw.mp4` before
  assuming a tracking bug; it may just mean there was no ship on screen at all.
- **A bright HUD element near the landmark can bias the tracker** even while peak-brightness stays
  high throughout (so the built-in lost-lock warning won't catch it) — this is *suspected* (not
  confirmed) as the cause of Gladius yaw trial 3's anomaly below. Prefer a landmark seed that isn't
  adjacent to a HUD bracket/marker if one is available.
- **An off-center roll landmark's circular path can cross the cockpit's own HUD/MFD panels partway
  through the rotation, and the tracker will silently snap onto one of THOSE instead of losing lock
  cleanly.** First attempt (radius ~1344px, 3840x2160 frame, half-height 1080px) went off the
  top/bottom edge entirely past ~53 deg of rotation — an aspect-ratio problem, not an angle-model
  one (see the note in step 3 above). Reducing the radius to ~998, then ~665px, still reproduced the
  identical symptom (angle changes briefly then goes completely flat, as if the ship stopped
  rotating, despite the commanded input still being held) even though the frame-edge math said it
  should be safe. **Root cause, confirmed by extracting the actual video frame at the tracked pixel
  position during the "frozen" stretch: the tracker had locked onto the cockpit's right MFD panel
  ("READY TO SCAN" scanner display) — a bright, screen-fixed UI element the moon's rotation had
  swept near/behind — not the moon at all.** Ruled out first: not a sync/rebase bug (checked raw,
  un-rebased timestamps directly against the known fixed capture-settle offset, same flat pattern);
  not stale/dropped vJoy input (added continuous per-poll axis refresh to
  `feeder/vjoy_feeder.py::run()` — see below — made no difference). Both false leads are worth
  knowing about even though neither was the actual cause. Peak brightness staying high throughout
  (a screen-fixed bright panel is just as bright as the moon) is exactly why this doesn't trip the
  lost-lock warning the way a real tracking-into-empty-space failure would — **a flat trajectory
  with sustained high peak brightness is itself a red flag for exactly this failure mode**, worth
  checking a frame for before trusting any "suspiciously motionless" trial. Fix adopted: shortened
  `roll_reversal.json`'s hold durations so total rotation stays well under 360 deg (a full rotation
  at Gladius's ~200 deg/s roll rate will cross a side MFD somewhere almost regardless of radius),
  trading some settling margin for guaranteed panel clearance — see the maneuver file's own
  description for the specifics. `feeder/vjoy_feeder.py::run()` keeps its continuous-refresh change
  regardless (cheap, rules out one more variable even though it wasn't the cause here).
- **Pitch can sweep the landmark into the cockpit's own radar/scan cone graphic** (the HUD cone
  shape in the lower-center of the screen), a lower-screen analogue of roll's MFD-panel problem.
  Seeding pitch's landmark near dead-center risks the reversal segment's downward sweep dropping it
  right into that cone. Fix that worked: seed well ABOVE center (~25% margin from the top) so the
  whole up-then-down excursion stays in clear sky.
- **Seeding too close to the reticle/crosshair risks the tracker locking onto the crosshair graphic
  itself once the real target moves away** — a seed only ~30px from dead-center (well inside the
  crosshair's own visual extent) produced a trial where peak brightness stayed a perfect 254-255 the
  whole clip (i.e. no lost-lock warning at all) while the tracked position barely moved, even though
  the operator confirmed the real landmark had flown far off-screen. Always crop-check the converged
  seed visually (does it show the target filling the crop, or a HUD graphic?) before trusting it,
  especially for pitch/yaw where the reticle sits exactly where a "centered" seed would naturally be.
- **Pitch's focal length was computed from the wrong dimension, inflating every pitch rate by
  exactly the aspect ratio (1.778x) — caught only because the fitted peak (~110-120 deg/s) was
  suspiciously far above the coded spec (68.2 deg/s), and 110-120 / 1.778 lands almost exactly on
  it.** `angle_convert.py`'s pinhole model needs ONE focal length (in pixels), derived from the
  HORIZONTAL dimension/FOV (what `--fov` actually is) — reused as-is for the vertical/pitch axis,
  not re-derived from `height` with the same fov value (which implicitly treats the horizontal FOV
  as if it were vertical). Yaw/roll were never affected (`axis="x"` always used `width` correctly).
  Fixed in `angle_convert.py`; regenerate `omega.csv` for any pre-fix pitch trial before trusting it
  (see Findings log). **`selftest_synthetic.py` only exercised `axis="x"`, which is exactly why this
  didn't get caught by the self-test that exists specifically to catch this class of bug** — now
  extended to cover `axis="y"` too. If a future axis/ship addition needs yet another projection
  variant, extend the self-test's coverage at the same time, not after a suspicious result forces
  the question.
- **Sign convention**: see step 7. `mass_only` is diagnostic only after the sign is corrected.
- **Decoupled vs. Coupled flight mode is a full confound, not just noise.** `shipTypes.ts`/
  `flightModel.ts` model COUPLED flight specifically (see `shipTypes.ts`'s "no throttle/strafe input
  at all in coupled mode" note) — Decoupled mode's dynamics aren't the same model at all. All 3
  Gladius yaw trials below were captured with `IFCS_Setting_CoupledEnabled="0"` (Decoupled) active,
  confirmed after the fact by asking rather than something the capture pipeline itself checks or
  logs anywhere (`meta.json` doesn't record flight mode). This most likely explains BOTH the
  measured peak rate sitting above the coded `maxAngVel.yaw`, AND — very plausibly, if the mode
  flipped between trials for any reason — trial 3's stall anomaly. **The entire yaw dataset and its
  fit below is invalidated by this**; recapture in Coupled mode before drawing any conclusion from
  yaw data. Added to `settings_checklist.md` as a required check going forward; consider also
  having `orchestrate.py` prompt for/record it in `meta.json` since it isn't visible from footage the
  way FOV or resolution effectively are.
- **Unconstrained least-squares can fit a negative drag** (drag *adding* energy to the spin — not
  physical) when a model's transient window has few/noisy samples. `fit_model.py` now bounds every
  parameter to `[0, inf)`; a parameter landing exactly on that bound (as `drag_reversal` has, twice
  now) is a real result but should be treated as "this data wants ≤0, i.e. ~0" rather than a precisely
  converged value until more reps confirm it's not just being clipped.

## Findings log

### Gladius — yaw, reversal maneuver, ORIGINAL Decoupled-mode attempt (2026-07-18) — **INVALIDATED**

**Update:** confirmed after the fact that Decoupled flight mode was active for all 3 trials in this
section (see Gotchas' "Decoupled vs. Coupled" entry) — `shipTypes.ts` models Coupled flight, so none
of the numbers below are usable for retuning it. Kept here for the record (and because the
methodology/tooling built to get them is still valid) rather than deleted; superseded by the
Coupled-mode recapture below.

Landmark: a small bright moon (~1.6% of frame width, not the free-flight station's landing-pad
marking used in earlier legacy trials). FOV 116°, 3840x2160, `feeder/maneuvers/yaw_reversal.json`
(full yaw right 0.5s, hard flip to full yaw left 1.0s, neutral).

3 trials captured (`data/Gladius/yaw_reversal/20260718-{181157,183256,183319}`); trial `183319`
excluded from the fit as an outlier — its tracked pixel position went nearly stationary
(~3px/frame) in the last ~80ms of the held-yaw segment where trials `181157`/`183256` both still
show full-rate motion (~24-27px/frame) at the same point. Root cause not confirmed (see Gotchas).

Joint fit, `181157` + `183256` (368 samples total, `--sign -1`, bounds `[0,inf)`):

| model | RMS error (deg/s) | params |
|---|---|---|
| symmetric (current model shape) | 8.85 | thrust=5.59, drag=5.27 |
| asymmetric (drag differs while reversing) | **6.17** (best) | thrust=6.56, drag_normal=6.20, drag_reversal=**0.00** (pinned at bound) |
| mass_only (thrust/drag fixed at shipTypes.ts, only mass floats) | 9.52 (worst) | mass=3.91 (vs coded 1.5) |

**Reading against the user's mass hypothesis (superseded, see below):** tested directly via
`mass_only` — holding the *currently-coded* `angularThrust.yaw`/`angularDrag.yaw` fixed and only
letting mass float. It fit worse than even the baseline symmetric model, and by construction it
*can't* reproduce a steady-state peak rate different from `thrust0/drag0`'s ratio (mass cancels out
of that ratio) — and the measured peak (~59-65°/s across trials) is visibly above the coded
52.1°/s (`maxAngVel.yaw`). At the time this looked like real evidence against "mass alone explains
it," but this entire dataset is Decoupled-mode (see above) — treat this reading as superseded by
the Coupled-mode recapture's version of the same test, not as independent confirmation.

### Gladius — yaw, reversal maneuver, Coupled-mode recapture (2026-07-18)

Same landmark/setup as the original attempt (moon near boresight, ~1.6% of frame width), same
`feeder/maneuvers/yaw_reversal.json`, but this time via the **OBS backend** and with **Coupled mode
confirmed** before every trial. 3 trials (`data/Gladius/yaw_reversal/20260718-{212039,212121,212158}`);
trial `212158` excluded from the fit — its motion-onset sync landed ~0.1-0.15s later than the other
two (a small blip preceded the real ramp and likely tripped the threshold early relative to where
the smooth climb actually starts), inflating its own per-trial RMS (22-29 deg/s vs. ~7-13 for the
other two) without changing the fitted params much. Unlike the old Decoupled trial 3, this one's
underlying motion is NOT stalled/anomalous — just offset in time — so it's a timing-precision issue,
not a data-validity one; excluded anyway to keep the fit clean.

Joint fit, `212039` + `212121` (393 samples, `--sign -1`, bounds `[0,inf)`):

| model | RMS error (deg/s) | params |
|---|---|---|
| symmetric | 9.45 | thrust=6.53, drag=7.88 |
| asymmetric | **9.00** (best) | thrust=7.55, drag_normal=9.24, drag_reversal=**0.00** (pinned at bound — same as the invalidated run and as roll's result) |
| mass_only | 9.71 (worst) | mass=3.20 (vs coded 1.5) |

**This confirms, on valid Coupled-mode data, the same two findings the invalidated Decoupled run
had already suggested:** (1) `mass_only` fits worst — mass alone still doesn't explain the reversal
behavior; (2) `drag_reversal` pins at exactly 0 — same as roll's finding — reinforcing that "no
rotational drag while actively countering an existing spin, only the counter-thrust decelerates
you" looks like a real, reproducible pattern rather than a fluke of one axis or one (invalid)
dataset.

**Correction — do not over-attribute the steady-state-peak change to Coupled vs. Decoupled alone.**
This recapture changed TWO things at once versus the original attempt: flight mode (Decoupled ->
Coupled) AND capture backend (ffmpeg -> OBS, with its much cleaner frame timing). The steady-state
peak did drop from the invalid run's ~59-65 deg/s to this run's ~47.5 deg/s (thrust/drag = 0.829
rad/s), closer to but still *below* the coded `maxAngVel.yaw` (52.1 deg/s) — but with two variables
changed simultaneously, that drop can't be cleanly attributed to the flight-mode fix specifically;
ffmpeg's frame-timing jitter feeding into the derivative is at least as plausible a contributor, and
hasn't been ruled out. **A more interesting alternative, raised directly by harald and worth taking
seriously: the 52/68/200 deg/s specs in `shipTypes.ts` were measured via a SUSTAINED, multi-second
360-rotation stopwatch timing (see the file's own measurement notes) — not a short ~0.5s burst.**
If the real reversal-lag time constant is genuinely longer than currently modeled (which our own
fit already suggests — tau fit at ~0.16-0.19s here vs. the coded 0.097s), then a short reversal
maneuver's segment may simply not hold long enough to reach the SAME steady state the original
stopwatch measurement saw over several seconds, independent of any Coupled/Decoupled or backend
difference. This is directly testable (see the yaw section's follow-up work note below) and hasn't
been resolved yet — don't treat the ~47.5 deg/s figure above as "the" corrected steady-state rate,
just this maneuver's short-hold plateau.

**Follow-up: resolved, via a before/after full-360 check rather than continuous tracking.**
Two approaches were tried and ruled out first: (1) `feeder/maneuvers/standing_start_yaw.json`'s own
docs already warn not to run it through `track_landmark.py` — a boresight landmark exits frame well
before an 8s hold completes; (2) a longer single-direction hold
(`feeder/maneuvers/yaw_long_hold.json`, 1.3s) was tried with continuous tracking, but the tracked
landmark's PIXEL velocity accelerates nonlinearly (the pinhole model's `tan()` term) as it moves off
boresight, and the `--window` sized for the short reversal maneuvers lost lock partway through
(confirmed via a real pixel_y discontinuity mid-clip — see the trajectory data, a tell-tale sign
worth checking for in any future longer-hold attempt: watch for a sudden jump in the axis that
*shouldn't* be moving). A HUD "0° / 5.0km" scan-target readout was also tested directly (drove a
real, confirmed rotation via vJoy, screenshotted before/after) and stayed frozen at "0°" throughout —
ruled out as ship-relative/reticle-locked, not a heading readout.

**What worked, suggested by harald: skip continuous tracking, just time a full 360° and compare
landmark position before vs. after.** `feeder/maneuvers/yaw_360_check.json` holds full yaw for
exactly 360/52 = 6.9230769s (intended as the duration a full rotation should take at the coded
`maxAngVel.yaw` — but note that value is actually 52.14 deg/s / 0.91 rad/s, not 52; both this file
and `yaw_360_check.json` round it down, so the hold runs ~0.013s long and a perfectly-spec'd ship
would already *over*-rotate ~1°, which matters for reading the shortfall below) then releases; only two screenshots are needed (before starting, after it completes), converted to
angles via the same pinhole formula and differenced. 3 valid reps (one attempt lost to a mid-run
game crash, caught by checking the "after" screenshot was actually still in-cockpit before trusting
the number — worth doing every time): shortfall from a full 360° was **-0.82°, -0.80°, -0.58°**
(mean ≈ -0.73°, i.e. 99.8% of a full rotation completed in the exact time the spec predicts).

**This resolves the open question, and updates the yaw joint-fit's interpretation above:** sustained
yaw spin-up genuinely does reach ~52 deg/s very close to spec — the ~0.7° net shortfall is far too
small to support a meaningfully longer settling time (even the ORIGINAL modeled tau of 0.097s would
predict a ~5° shortfall from ramp-up alone, rate x tau; a real ~0.19s tau would predict ~10° — both
far above what's seen). So "sustained rate needs much longer to reach spec" is NOT the explanation
for the reversal maneuver's lower short-hold plateau or its `drag_reversal`-pins-at-zero finding.

**Don't read the ~0.7° as a precise time-constant measurement, though — it isn't one, for two
reasons.** (1) The hold was sized with a rounded 52 rather than the coded 52.14 deg/s (see the
maneuver note above), so a perfect ship already over-rotates ~1°; the net -0.73° therefore implies a
spin-up *deficit* nearer ~1.7° (tau ~0.03s) than 0.7°. (2) Depending on whether the "after"
screenshot is read at release or after the ship coasts to a stop, the spin-down coast partially
cancels the spin-up lag, shifting the number again. Both effects are small, but together they mean
this check confirms only the sustained *rate*, not the coded tau — if anything it points to a
spin-up *faster* than the coded 0.097s, not equal to it.

Put together, the coherent picture is: **spooling up from rest reaches the spec'd rate quickly (the
coded model's steady-state rate is right) — the real, distinct effect is specifically in the REVERSAL
transient** (decelerating an existing spin to flip it), where drag apparently drops out and thrust
alone does the work. That's a different, narrower claim than "yaw's time constant is universally ~2x longer than
modeled" — worth re-deriving the reversal fit's tau/drag numbers with this framing in mind (e.g. a
model where spin-up-from-rest uses the ORIGINAL tau/drag and only the actively-opposing case
changes) rather than one uniformly-different tau for the whole axis.

**Expanded dataset (2026-07-18, later the same session):** 2 more reps captured
(`data/Gladius/yaw_reversal/20260718-{215702,215807}`), same setup. `215807` excluded — its
motion-onset sync landed ~0.2s late (a real, if minor, timing-precision issue, not a stall), giving
it a visibly higher per-trial RMS (12-14 vs. 7-11 for the other three) without changing the fitted
params much. Joint fit, `212039`+`212121`+`215702` (590 samples, `--sign -1`, bounds `[0,inf)`):

| model | RMS error (deg/s) | params |
|---|---|---|
| symmetric | 9.15 | thrust=6.07, drag=7.02 |
| asymmetric | **8.28** (best) | thrust=7.02, drag_normal=8.20, drag_reversal=**0.00** (pinned at bound again — 3rd time now, see roll below too) |
| mass_only | 9.23 (worst) | mass=3.46 |

Same qualitative conclusions as the 2-trial version hold with the larger dataset: `mass_only` worst,
`drag_reversal` pinned at 0. Numbers shifted somewhat (thrust/drag both a bit lower than the 2-trial
fit) — expected, this is still a small sample; treat the specific values as approximate until more
reps accumulate rather than as converged constants.

### Gladius — yaw, dedicated spool-up (no reversal), 2026-07-18

Motivated by wanting a spin-up-only measurement independent of the reversal transient's asymmetric-
drag complexity, to check against the reversal fit's `drag_normal` component specifically.
`feeder/maneuvers/yaw_spool_up.json` (single 0.6s hold, then neutral, no reversal at all) — 3 trials
via OBS (`data/Gladius/yaw_spool_up/20260718-{223955,224102,224159}`), notably the **first trials
all session where the sync flash was actually detected** (`Sync flash at frame ~56-57`) instead of
falling back to motion-onset — OBS's DXGI capture apparently CAN see the flash overlay where
ffmpeg's GDI-based `gdigrab` couldn't all session; worth defaulting to expecting real flash sync
(not the motion-onset fallback) on OBS-backend trials going forward, and treating a fallback as
slightly suspicious rather than routine.

**Correction (found 2026-07-19, during the vJoy-curve investigation below): 2 of these 3 trials
(`224102`, `224159`) never actually moved.** Their full omega traces sit within ~0.2 deg of zero for
the ENTIRE clip despite perfect brightness lock (255) throughout and an identical vJoy command log
to the one good trial (`223955`) — the landmark had drifted out of the tracking window before the
maneuver ran (see the vJoy-curve section's writeup of this failure mode), so both were silently
tracking background noise. The joint fit originally reported here (thrust=1.61, drag=4.68, implying
a suspiciously low ~19.7 deg/s steady state) was mostly fitting that noise, not real spin-up
dynamics — **retract that reading entirely**, it doesn't reflect anything physical. The two
surviving clean full-deflection reps are reported as raw observed plateaus (~-49 to -55 deg/s) in
the vJoy-curve section immediately below, alongside the actual finding this correction was
discovered while chasing — but note that no replacement thrust/drag *fit* was re-derived from the
spool-up data (only two clean reps survived, used there for the linearity check, not a re-fit), so
the reversal-section joint fits remain the full-deflection thrust/drag source of record.

### Gladius — pitch, reversal maneuver, 2026-07-18

First pass on a third axis, checking whether the drag-drops-during-reversal pattern (found
independently on both yaw and roll) generalizes. `feeder/maneuvers/pitch_reversal.json` (axis `y`,
`angularThrust.pitch=12.2261`, `angularDrag.pitch=10.2740`, `maxAngVel.pitch=1.19 rad/s=68.2 deg/s`).
Landmark seeded ~25% margin from the top of frame (see Gotchas — dead-center seeding let the
pitch-down reversal sweep the moon into the cockpit's radar/scan cone graphic, corrupting two earlier
attempts). 3 clean trials via OBS (`data/Gladius/pitch_reversal/20260718-{230130,230304,230521}`).

**Sign convention differs from yaw/roll: no `--sign -1` needed here** — a plain symmetric fit
already gives positive thrust/drag without correction, unlike yaw and roll which both required it.
Worth remembering per-axis, not assuming universal.

**Major correction — the original peak reading (~110-120 deg/s vs. the coded 68.2 deg/s spec) was a
calibration bug, not a real finding.** `angle_convert.py::convert()` computed `focal_px` for the
pitch (`axis="y"`) case from `height` using the same (horizontal) `--fov` value passed at the CLI —
but focal length in pixels is one camera-intrinsic value that must always derive from the horizontal
dimension/FOV, then be reused as-is for the vertical axis too. Using `height` with the horizontal FOV
understates focal_px by exactly the aspect ratio (3840/2160 = 1.778), which overstates every pitch
angle/rate by that same factor. The tell: dividing the original peak (~110-120) by 1.778 gives
~62-67 deg/s — almost exactly the coded spec. **This means yaw and roll were never affected** (axis
`x` always correctly derived focal_px from `width`, the same dimension it uses for pixels) — this
was pitch-only. Fixed in `angle_convert.py` (focal_px now always derived from `width`); the pitch
trials' `omega.csv` files were regenerated with the fix before re-fitting below.

**Root cause of why this went undetected for a while: `selftest_synthetic.py` only ever validated
`axis="x"`.** Extended it to also generate and validate a synthetic `axis="y"` case (reusing pitch's
real constants and a shortened version of its reversal timing, since the real 0.8s hold's excursion
would have exceeded the test's own 90°-FOV frame) — both axes now pass, and this would have caught
the original bug had it existed when first written. Run `python analysis/selftest_synthetic.py`
after ANY change to `angle_convert.py` going forward; it now covers both axes.

Corrected joint fit, all 3 trials (626 samples, no sign flip, bounds `[0,inf)`):

| model | RMS error (deg/s) | params |
|---|---|---|
| symmetric | 20.04 | thrust=4.03, drag=4.37 |
| asymmetric | 20.01 (only marginally better) | thrust=4.31, drag_normal=4.73, drag_reversal=**1.43** (NOT pinned at the bound — an actual interior value, unlike yaw/roll) |
| mass_only | 20.63 (worst) | mass=4.93 |

Same qualitative shape as before the fix (RMS still ~29-31% of peak, still noisier than yaw/roll's
fits; `drag_reversal` still an interior value rather than pinned at 0, still barely better than
symmetric) — the correction rescaled the absolute numbers, not the fit-quality story. `mass_only`
still worst, so "mass alone doesn't explain it" still holds on this third axis.

**Cross-validated the corrected steady-state with a pitch equivalent of the yaw 360°-check.**
`feeder/maneuvers/pitch_360_check.json` (360/68 = 5.2941176s hold, matching `shipTypes.ts`'s own
"360/68 deg/s = 5.294s ideal" comment). 3 reps, before/after landmark position compared (screenshots
checked in-cockpit via the new `detect_flight_state` automated check each time, not manually):
shortfall from a full 360° was **+1.00°, -1.19°, -0.33°** (mean ≈ -0.17°, essentially noise centered
on zero) — sustained pitch reaches ~68 deg/s just as closely as yaw's ~52 deg/s did. Same conclusion
as yaw: the reversal maneuver's lower short-hold plateau and the reversal-specific drag reduction are
real, narrow effects around the reversal transient specifically, not evidence that sustained pitch is
slower than spec.

### Gladius — roll, reversal maneuver (2026-07-18)

Landmark: the same moon, always seeded well off frame-center for roll's polar-angle model (radii
used: ~848-880px against a 3840x2160 frame). FOV 116°, `feeder/maneuvers/roll_reversal.json`
(the shortened version — full roll right 0.5s, flip to full roll left 0.7s, neutral 0.3s; see the
maneuver file's own description and the Gotchas above for why it's this short). All 3 trials via
the OBS backend (`data/Gladius/roll_reversal/20260718-{210908,211132,211244}`), Coupled flight mode
confirmed. Two earlier attempts (ffmpeg backend, longer/original maneuver duration) failed
outright — one from seeding past the frame's aspect-ratio limit, one from the tracker hijacking
onto the cockpit's right MFD panel — see Gotchas; not part of this dataset.

Joint fit, all 3 trials (498 samples total, `--sign -1`, bounds `[0,inf)`):

| model | RMS error (deg/s) | params |
|---|---|---|
| symmetric | 25.51 | thrust=7.44, drag=**0.00** (pinned at bound) |
| asymmetric | 25.51 (identical — drag_normal/drag_reversal both pinned to the same 0.00, so there's no asymmetry left to distinguish) | thrust=7.44, drag_normal=0.00, drag_reversal=0.00 |
| mass_only | 40.00 (worst) | mass=4.81 (vs coded 1.5) |

Per-trial RMS is consistent (23.4-26.6°/s across all 3, same for symmetric/asymmetric) — reproducible,
not a one-off. `mass_only` again fits clearly worse, same conclusion as yaw's: adjusting mass alone
(holding the coded thrust/drag fixed) doesn't explain the data.

**Expanded dataset (later the same session):** 2 more reps attempted
(`data/Gladius/roll_reversal/20260718-{220441,223005}`). `223005` excluded — clearly the worst-fitting
trial of the 5 (per-trial RMS 48.2 vs. 23-33 for the others) when included in a joint fit; root cause
not individually diagnosed (unlike the earlier excluded trials, no obvious frozen-trajectory or
sync-offset signature was checked for this one specifically — worth a closer look if revisited).
Joint fit, the 4 good trials (664 samples, `--sign -1`, bounds `[0,inf)`):

| model | RMS error (deg/s) | params |
|---|---|---|
| symmetric | 26.98 | thrust=7.35, drag=**0.00** (pinned at bound) |
| mass_only | 40.07 (worst) | mass=4.75 |

(asymmetric identical to symmetric again, same reason as the 3-trial version.) Consistent with the
3-trial result — `drag` still pins at exactly 0 with a 4th independent trial added, strengthening
confidence this isn't a fluke, though it's still a bound rather than a converged interior value.

**The interesting/uncertain part: fitted drag pinned at exactly 0 for roll, both symmetric and
asymmetric, consistently across all 3 trials.** Two different readings, and this dataset can't
distinguish between them:
1. **Roll might genuinely have "governor, not drag" character**, the same character
   `shipTypes.ts`'s own measurement notes describe for the LINEAR thrust axes (forward/retro/strafe
   all fit `drag ~= 0`, an almost-unopposed-thrust-until-a-hard-cap model) — plausible since the
   original roll measurement (`shipTypes.ts` line 43-44) derived tau_roll from only two whole-360°
   timings, an indirect fit compared to the linear axes' dense per-frame traces; a first-order-lag
   model may have been the simplest available fit at the time rather than a confirmed mechanism.
2. **Or this maneuver is simply too short to tell** — deliberately shortened (see Gotchas) to avoid
   the MFD-panel tracking hijack, meaning segment 1 (0.5s ≈ 1.8x the assumed ~0.28s tau_roll, so
   only ~83% settled — approaching but not yet at the steady-state plateau), leaving limited data to distinguish "still
   rising toward a drag-limited plateau" from "unopposed thrust toward a hard governor cap" within
   the captured window.

Not resolved here — would need either a longer hold from a landmark position confirmed safe for a
FULL 360°+ sweep (harder geometrically, see Gotchas), or a differently-shaped maneuver (e.g. a
single long unreversed roll, checked frame-by-frame for whether the rate visibly plateaus).

**Resolved via the same before/after timed-360° method used for yaw/pitch.**
`feeder/maneuvers/roll_360_check.json` holds full roll for exactly 360/200 = 1.8s (matching
`shipTypes.ts`'s own "confirms the 200 deg/s spec" measurement note). Roll's angle model (polar
angle around frame center) is exact geometry with no FOV/focal-length dependency at all, so this
check can't be confounded by the same calibration-bug class the pitch check caught. 3 reps
(in-cockpit confirmed via `detect_flight_state` each time): shortfall from a full 360° was
**-0.91°, -0.78°, -0.58°** (mean ≈ -0.76°).

**One genuine difference from yaw/pitch worth flagging: all 3 reps came out the same sign**, unlike
yaw's and pitch's shortfalls which scattered both positive and negative around zero (noise-like).
A consistent small undershoot could mean sustained roll sits very slightly below the 200 deg/s spec
(~0.4 deg/s low, roughly 0.2% — at this magnitude, equally plausibly just a small consistent
timing bias, e.g. Python-loop overhead making the actual held duration a few ms shorter than the
programmed 1.8s every time, not necessarily a real ship-behavior difference). Either way it's a
small enough effect that the main conclusion holds: **sustained roll closely matches its spec, the
same as yaw and pitch did** — the reversal-specific drag-pinning-to-zero finding is (like yaw's and
pitch's) a real, narrow effect around the reversal transient, not evidence that sustained roll is
meaningfully slower than modeled.

### Gladius — yaw vJoy response-curve check, 2026-07-19

Raised by harald: the "no explicit curve override in `actionmaps.xml`" note (see vJoy config section
above) leaves it genuinely unknown whether SC's DEFAULT response for the vJoy yaw axis is linear.
Directly testable: if linear, half-deflection (`u=0.5`) should produce exactly half of full
deflection's (`u=1.0`) steady-state rate. `feeder/maneuvers/yaw_spool_up_half.json` (identical to
`yaw_spool_up.json` but `yaw=0.5` instead of `1.0`) plus fresh `u=1.0` reps for a same-session
comparison baseline.

**Along the way, found and explained a recurring "no real motion despite perfect tracking lock"
failure** that had already silently corrupted 2 of the original 3 `yaw_spool_up` trials (their
joint fit's oddly-low thrust/drag numbers, reported earlier this session, were mostly fitting noise
from those two) — confirmed by re-examining their full omega traces (angle stays within ~0.2 deg of
zero for the entire clip, not just briefly). Root cause: the landmark can drift out of the tracking
window between grabbing the "seed" screenshot and the trial actually running, especially back-to-back
with minimal gap (residual ship rotation settling from the PREVIOUS trial's neutral phase). Neither
`orchestrate.py`'s lost-lock warning nor peak-brightness fires, because the tracker is just following
whatever's actually in that fixed pixel window (background stars/noise) the whole time — same
underlying class of issue as the earlier "tracker locks onto something that isn't the real target"
gotchas, just with an ambiguous-until-checked signature. **Mitigation: grab the seed screenshot
immediately before launching each trial, not reused from an earlier check; always eyeball the omega
curve's actual shape (does it rise to a real plateau?) rather than trusting brightness lock alone.**

Two clean full-deflection reps (`223955` plus one fresh rep, `235512` — a third full-deflection
attempt, `235625`, collapsed mid-hold with the exact drift failure described above, its omega
swinging +20 -> -55 -> +5 deg/s and only ~12.6 deg total rotation vs. ~31 deg for the two clean
reps, and was excluded) and two clean half-deflection reps (`234345`, `000420` — a third
half-deflection attempt hit the exact drift issue above and was excluded):

| condition | raw plateau (deg/s, directly observed) |
|---|---|
| full (u=1.0) | ~-49 to -55 (two reps) |
| half (u=0.5) | ~-32.5 to -33.3 (two reps, tightly consistent with each other) |

Ratio ≈ 32.9 / 51 ≈ **0.65** — clearly above the 0.5 a linear response would predict, and consistent
across both reps of each condition (not a one-off). **SC's default vJoy yaw response is measurably
nonlinear** — roughly two-thirds of full deflection's steady-state rate is already reached at half
physical stick deflection, i.e. the curve is front-loaded toward center rather than a flat 1:1
mapping.

**What this does and doesn't affect**: every maneuver captured this whole session (reversals,
spool-ups, 360°-checks) commanded FULL deflection (`u=±1.0`) exclusively, so the existing fitted
thrust/drag numbers are still self-consistent measurements of full-deflection behavior — this
doesn't retroactively invalidate them. It DOES mean `fit_model.py`'s linear-in-`u` assumption
can't be trusted to predict behavior at any OTHER (partial) input level without characterizing the
curve properly first — one data point (u=0.5) is enough to detect a nonlinearity exists, not enough
to fit its actual shape (would want u=0.25/0.75 too, and to check whether the curve differs by axis,
before trying to correct for it in `fit_model.py`'s `u_fn`).

### Cross-ship mass scaling — forward-looking research note, not yet answerable

Raised by harald: once 1-2 ships have real fitted `(mass, thrust, drag)` triplets per axis, hope is
to predict OTHER ships' behavior from their mass alone, rather than re-running this whole capture
procedure per ship. Worth being precise about what mass actually does and doesn't determine in the
current model, since that's exactly what the eventual scaling law would need to account for:

- **Mass only sets the TIME CONSTANT** (`tau = mass/drag`), not the steady-state rate
  (`thrust/drag`, where mass cancels out entirely). This was directly demonstrated this session:
  `mass_only` fits (freezing thrust/drag at shipTypes.ts's current values, only letting mass float)
  consistently fit worse than models letting thrust/drag themselves vary — across yaw, roll, AND
  pitch. So mass alone, holding a ship's *existing* thrust/drag fixed, does not predict a
  *different* ship's behavior; the thrust and drag values themselves must also be known or
  predicted per ship.
- **What a real scaling law would need**: with 2+ ships' fitted triplets in hand, the actual
  checkable question becomes whether `thrust` and `drag` themselves correlate with mass (or with
  something else — hull size, thruster count/class, `massKg` vs. the unitless `mass` field, etc.)
  in a predictable way. That's an empirical question this project can't answer with one ship's
  data no matter how well-fit — it needs at least Taurus's numbers alongside Gladius's to even
  check for a pattern, and probably Arrow's too (a third point) before trusting any fitted line
  over just two.
- **Practical implication for Taurus/Arrow captures below**: worth fitting thrust/drag/mass all
  as free parameters per ship (as done for Gladius) rather than assuming a mass-scaled version of
  Gladius's constants going in — the scaling relationship is exactly what's unknown and being
  tested for, not something to assume as a shortcut yet.

### Taurus — not yet captured

Not yet in `src/physics/shipTypes.ts` at all (only `GLADIUS` and `ARROW`, the latter an exact clone
of Gladius's stats pending real data — see `shipTypes.ts` around the `ARROW` definition). Capturing
Taurus will be this project's first real multi-ship data point; expect to add a new `ShipType` entry
once fitted rather than overwrite an existing one. No `--mass`/`--thrust0`/`--drag0` baseline exists
yet to seed the optimizer with — use the Taurus loadout's in-game stats or a reasonable guess (e.g.
scaled by known mass ratio) as the initial guess; the fit doesn't require a correct starting point,
just a not-wildly-off one.

### Arrow — not yet captured

Currently a placeholder: `ARROW: ShipType = { ...GLADIUS, name: 'Arrow', model: 'arrow' }` (see
`shipTypes.ts`). A real Arrow capture is what would let this stop being a Gladius clone — seed the
optimizer with the current (Gladius-derived) constants as `--thrust0`/`--drag0`/`--mass` since
that's the only baseline on record, same procedure as Gladius/Taurus otherwise.
