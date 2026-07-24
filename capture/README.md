# capture/ — automated real-Star-Citizen flight-data capture

Standalone toolchain for recording and analyzing real Star Citizen flight behavior (currently:
yaw/pitch/roll rotation and strafe axes, including direction-reversal maneuvers), so `sc_webgl`'s
ported flight model (`../src/physics/flightModel.ts`, `../src/physics/shipTypes.ts`) can be re-tuned
against real frame-accurate data instead of hand-stopwatched footage.

**Self-contained.** This folder is plain Python, unrelated to the TypeScript/Vite app one level up
— it drives a separate process (the real game), not the sim in this repo. Nothing here is imported
by or imports from `../src`.

## Why this exists

See the project's flight-model tuning notes: the existing angular constants in `shipTypes.ts` were
captured by a human watching recorded footage and hand-transcribing numbers (stopwatch time for one
360° rotation). That method has no data at all on *reversal* behavior (flip input while already
spinning) — the actual gap this toolchain is built to close — and is inherently noisy (the shipTypes
comments call out specific transcription-error outliers that had to be excluded by eye).

This toolchain removes both problems: a **vJoy virtual joystick** drives the game with an exact,
scripted control-input waveform (no human reaction time or analog-stick ramp), a synchronized
**recording** captures the result, and an **OpenCV pipeline** tracks a fixed landmark frame-by-frame
to reconstruct the actual angular-rate curve — replacing "a human reads numbers off a video" with
automatic pixel tracking.

## Prerequisites (manual, one-time — not automatable from here)

These touch system drivers and external GUI apps; install/configure them yourself before running
anything in this folder:

1. **vJoy driver** — <https://sourceforge.net/projects/vjoystick/>. The GitHub source
   (`shauleiz/vJoy`) is stale (last release 2018, targets up to Windows 10 1803) and its own README
   points newer-Windows users at a fork, `jshafer817/vJoy` (2019, also old) — in practice the
   SourceForge installer is what most people actually run; try the fork's release only if the
   SourceForge installer fails to load on your Windows build (secure boot / driver signing can
   reject old test-signed drivers). Once installed, use the vJoy Configure app (or just accept
   defaults) to enable device #1 with 8 axes (X/Y/Z/RX/RY/RZ + 2 sliders) — all 8 were confirmed
   present/settable on a real device in this project's testing.
2. **Star Citizen control bindings** — bind ship axes to the vJoy device. See "Binding vJoy axes in
   Star Citizen" below — this needs a specific procedure, not just Options > Keybindings by hand.
3. **Capture backend** — either:
   - **ffmpeg** on PATH (`recorder/ffmpeg_capture.py`) — no extra app to run, but see "Capture
     backend performance" below for a real caveat at 4K.
   - **OBS Studio** (<https://obsproject.com/>) with the built-in websocket server enabled
     (Tools > obs-websocket Settings > Enable) — note the port/password for `recorder/obs_capture.py`
     (confirmed working here with no password, port 4455). Slightly more setup, gives an exact
     returned output path and can host a burned-in overlay if you ever need one.
4. **In-game settings locked in** — see `settings_checklist.md`. FOV in particular must be recorded
   exactly; the pixel→angle conversion depends on it. Borderless windowed mode is required, not
   exclusive fullscreen (needed for anything to render on top of the game — see "Sync mechanism").
5. Python 3.10+, then `pip install -r requirements.txt` (a project-local `.venv/` is expected; none
   of this is installed system-wide).

## Binding vJoy axes in Star Citizen

You can't just alt-tab to a terminal and wiggle an axis by hand while SC's keybinding "listening"
capture is armed — switching window focus to run a script cancels the capture before the input
arrives. Use `feeder/bind_helper.py` instead: it oscillates one vJoy axis continuously in the
background *before* you ever switch to the game, so by the time you alt-tab in and arm the
keybinding capture, the axis is already moving and gets picked up automatically, no further input
needed from you.

```
.venv\Scripts\python.exe feeder\bind_helper.py yaw
```

(axis choices: `yaw`, `pitch`, `roll`, `strafe_lateral`, `strafe_vertical`, `strafe_longitudinal` —
see `AXIS_MAP` in `feeder/vjoy_feeder.py`. In SC's `actionmaps.xml` these correspond to
`v_yaw`/`v_pitch`/`v_roll`/`v_strafe_lateral`/`v_strafe_vertical`/`v_strafe_longitudinal`, and vJoy
shows up as e.g. `js3_x`/`js3_y`/`js3_z`/`js3_rotx`/`js3_roty`/`js3_rotz` once bound — the joystick
instance number (`js3` here) depends on enumeration order among your connected devices, check
`actionmaps.xml`'s `<options type="joystick" ...>` block to confirm which instance is
`Product="vJoy Device ..."`.)

Procedure per axis: run `bind_helper.py <axis>`, confirm the "Oscillating..." message (proves the
device was acquired), alt-tab into SC, Options > Keybindings, click into the target field to arm
capture, Ctrl+C the script once it's bound (centers the axis on exit), repeat for the next axis.

**vJoy device "busy" / can't acquire:** vJoy only lets one feeder own a device at a time
(`GetVJDStatus` returns 2/busy if something else already has it). Common causes seen in practice:
the vJoy SDK's own demo app (`vJoyFeeder.exe`) left running, a `vJoyConf.exe` window open, or a
previous script instance that was killed via a hard timeout (`SIGTERM`) rather than `Ctrl+C` (which
skips the cleanup that centers/releases the axis). Check with:
```
.venv\Scripts\python.exe -c "from pyvjoy import _sdk; print(_sdk.GetVJDStatus(1))"
```
(1 = free, 2 = busy). If busy, check `tasklist` for `vjoy`/`python` processes and close them.
Star Citizen itself does **not** hold the device exclusively — confirmed by closing our own script
while SC kept running and watching status return to free — so ordering (start the script before or
after launching SC) doesn't matter for acquisition, only for *this* specific busy-process case.

**Bindings don't save immediately.** SC keeps control-map edits in memory and only writes
`actionmaps.xml` to disk on an explicit save/apply action in the control settings UI (or on exiting
the menu/game) — confirmed by diffing the live file before and after an in-game rebind that visibly
worked, with zero byte difference until an explicit save. Don't fully quit the game before saving, or
the rebind is lost. There's also a separate "Export" feature that writes a `layout_<name>_exported.xml`
snapshot under `...\Controls\Mappings\` — that's a shareable export, not the live profile; the file
that actually matters is `...\Profiles\<profile>\actionmaps.xml`.

## Switching control profiles

`profiles/switch_profile.py` swaps Star Citizen's live control profile between your normal setup and
the vJoy-bound one, since SC has no external "select profile" mechanism — it just always loads
whatever's at a fixed path (`LIVE_ACTIONMAPS_PATH` in the script; as of this writing:
`C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\USER\Client\0\Profiles\default\actionmaps.xml`).

```
python profiles/switch_profile.py activate vjoy       # switch to the vJoy-bound profile
python profiles/switch_profile.py activate original   # switch back to your normal profile
python profiles/switch_profile.py status              # which one is currently live (by content hash)
```

Every `activate` call archives whatever's currently live to a fresh timestamped copy in
`data/actionmaps_backups/` *before* overwriting it, regardless of which profile was active — so
calling it repeatedly, in any order, never loses a state. `profiles/vjoy_actionmaps.xml` and
`profiles/original_actionmaps.xml` are the two known named profiles (add more to
`KNOWN_PROFILES` in the script if needed). **Requires a Star Citizen restart** (or in-game
profile reload) after switching — it only reads the file at launch/profile-load time, not
continuously; confirmed the currently-running session did NOT pick up a profile-file change made
while it was already running.

## Capture backend performance

Real numbers from testing at 3840×2160 on this project's dev machine (RTX 5090):

| Backend | Achieved fps (of 60 requested) |
|---|---|
| `ffmpeg -f gdigrab` + libx264 | ~16-19fps |
| `ffmpeg -f gdigrab` + h264_nvenc | ~16-19fps (no improvement — confirms gdigrab's own GDI `BitBlt` capture step, not encoding, was the bottleneck) |
| `ffmpeg` `ddagrab` (DXGI Desktop Duplication) + h264_nvenc | ~30-55fps |

`recorder/ffmpeg_capture.py` uses `ddagrab` + `h264_nvenc` (with `dup_frames=false` so gaps aren't
padded with repeated frames, and `-fps_mode passthrough` so the container keeps each frame's real
timestamp rather than retiming to a nominal rate). Even so, actual frame spacing is **not perfectly
uniform** (measured gaps ranging ~0-83ms in one clip) — this is why `analysis/track_landmark.py`
reads each frame's own `CAP_PROP_POS_MSEC` timestamp instead of assuming `frame_idx / fps`; assuming
uniform spacing here would silently distort the derived angular rate. A duplicate/non-advancing
timestamp between two frames is also possible (a rounding collision) and is filtered out before
differentiating (`analysis/angle_convert.py::drop_non_advancing_timestamps`) since a zero time delta
would otherwise divide-by-zero in the gradient.

~30-55fps is still coarse relative to Gladius's ~0.1-0.15s time constants (only a few samples per
tau) — good enough to validate the pipeline mechanism end-to-end, but for a serious Gladius fit,
try the OBS backend (`--backend obs`, Windows Graphics Capture-based) and compare, or consider
capturing a smaller/cropped region to reduce per-frame cost further.

## Choosing a landmark to track

Learned the hard way, in this order:
1. **Don't seed on exact screen center.** The default tracking seed is frame-center, but that's
   also exactly where the HUD reticle/crosshair sits (boresight, by definition, is screen-fixed) —
   a naive "aim the target dead-center" setup means the brightness-weighted tracker locks onto the
   **fixed reticle graphic**, not your moving target, and shows zero motion no matter how much the
   ship actually rotates.
2. **Don't use a dim/dark target.** A planet or moon silhouette is mostly dark against space and
   doesn't give the brightness-weighted centroid tracker (`analysis/track_landmark.py`) a clean
   thing to lock onto.
3. **What works well:** a bright, high-contrast, ideally large in-universe marking — e.g. the
   numbered landing pads at a space station (Security Post Kareah's free-flying pads, in testing).
   Aim slightly *off* the reticle (e.g. crosshair just above the marking, not dead-center on it, if
   the cockpit frame/bezel would otherwise occlude it at true center) and pass the real seed
   coordinates explicitly via `--seed-x`/`--seed-y` — don't rely on the frame-center default.
   Because the maneuvers here are pure rotation (no significant translation over ~2s), distance to
   the landmark doesn't matter for parallax — a nearby station target works exactly like a distant
   star for this purpose.
4. **Get the seed from an actual captured frame, not by eyeballing in-game.** Aim/parallax can shift
   between "looks centered in-game" and the actual recorded pixel position. Capture (or grab a quick
   single-frame screenshot — `ffmpeg -f gdigrab ... -frames:v 1 -update 1 out.png`) first, then read
   the image to find exact pixel coordinates, then pass those to `orchestrate.py --seed-x --seed-y`.
5. **Match `--window` (tracking search half-width, default 40px) to the target's actual size.** A
   large marking (e.g. ~10% of screen dimensions) needs a much wider window (150+) to hold onto the
   whole shape as it moves; too small a window can lose lock or only track a sliver of the target.
6. **Watch for display DPI scaling when computing pixel coordinates by hand.** `.NET`/PowerShell
   APIs like `Screen.PrimaryScreen.Bounds` can report *logical* (DPI-scaled) resolution rather than
   the physical pixels ffmpeg actually captures (seen here: reported 2560×1440 on displays that are
   physically 3840×2160 at 150% scaling) — use a DPI-aware query
   (`[DPI]::SetProcessDPIAware()` before `Screen.AllScreens`) or just trust the resolution you
   explicitly pass to the capture backend.

## Sync mechanism

`orchestrate.py` originally drew a full-white flash in the screen's top-left corner (via a topmost
tkinter window) at the exact moment it starts the vJoy maneuver, so `analysis/sync_detect.py` could
find frame-accurate t=0 from the recording. **This does not work against Star Citizen** — confirmed
by inspecting captured frames directly: the flash never appears at all, even though the window was
created successfully. Likely cause: SC's borderless-windowed swapchain (a "flip model" presentation
path some games use even outside exclusive fullscreen) can bypass normal desktop-compositor z-order,
painting over "always on top" windows regardless.

The fix in place: `sync_detect.detect_motion_onset` finds sync by detecting when the tracked
landmark **itself starts moving** — valid because every maneuver in `feeder/maneuvers/` begins
driving its axis immediately at t=0 (segments start at `"start": 0.0` with a non-zero value), and
the ship is expected to be holding a steady attitude right up to that instant. `orchestrate.py` tries
the flash first and falls back to motion-onset automatically if no flash is found. One related
subtlety already handled: `track_landmark.track()` converges the tracker onto frame 0's true local
centroid *before* recording anything (a human-eyeballed `--seed-x`/`--seed-y` needs a frame or two to
snap onto the real target center, which otherwise reads as several pixels of spurious "motion" right
at frame 0 and fools onset detection into firing immediately).

## Pipeline

```
feeder/vjoy_feeder.py <maneuver.json>       # drives vJoy through a scripted axis waveform
feeder/bind_helper.py <axis>                # oscillates one axis continuously, for in-game binding
profiles/switch_profile.py activate <name>  # swap the live actionmaps.xml (see above)
recorder/obs_capture.py record start/stop   # wraps recording start/stop (or ffmpeg_capture.py)
orchestrate.py <maneuver.json> --axis {x,y} --fov <deg> --resolution <WxH>
    [--backend {ffmpeg,obs}] [--seed-x --seed-y] [--window <px>] [--dry-run]
analysis/track_landmark.py <video>          # pixel trajectory of a tracked landmark, per frame
analysis/angle_convert.py <trajectory.csv> --fov <deg> --resolution <WxH>   # -> angle(t), omega(t)
analysis/fit_model.py <omega.csv> <meta.json> <maneuver.json> --mass --thrust0 --drag0
```

**Mouse-curve pipeline (separate from the above — see MEASUREMENTS.md):**
```
mouse_hold_capture.py --offsets <list> --axis {yaw,pitch}   # one clip, a staircase of held offsets
curve_sweep_capture.py --axes yaw,pitch --magnitudes <list> --repeats N   # many single-magnitude
    clips in one run, for a denser offset->rate curve (fills the gaps mouse_hold_capture leaves)
analysis/hold_rate.py <trial_dir> --axis {x,y} --fov <deg> --resolution <WxH>   # -> per-hold rate
analysis/fit_curve.py {yaw,pitch} --trials <glob> --seed-x --seed-y --anchor OFFSET:RATE
    # aggregates hold_rate results across trials, fits current power-law model vs a saturating
    # (Kumaraswamy) model side by side
```

**VJoy indicator gain cross-check (sc_webgl vs real SC, independent recordings):**
```
feeder/mouse_feeder.py oscillate yaw --period <s> --amplitude <counts>   # drives BOTH SC (if
    focused) and sc_webgl (via mouse-capture.py's relay) with the identical scripted motion
analysis/track_vjoy_indicator.py <sc_video> --f0 <1/period>              # SC's indicator, as usual
window.__vjoyLog.start() / .stop()   (sc_webgl browser console)          # sc_webgl's own raw
    offsetX/offsetY over time -- exact, no tracking needed (see src/debug/vjoyRecorder.ts);
    downloads a CSV
analysis/compare_vjoy_curve.py --ours <vjoy-log.csv> --sc <indicator.csv> --axis {x,y} \
    --vja <VJoyAnglePilots value used> --fov <deg> --width <px>
    # aligns the two independently-clocked recordings via detect_motion_onset (reused from
    # sync_detect.py, no simultaneous capture required), converts SC's pixel trace to a normalized
    # stick ratio via the pinhole projection, and fits sc_webgl's true full-deflection raw-count
    # gain by least squares -- validated against synthetic ground-truth data (see this script's own
    # docstring) before trusting it on a real capture.
```

`orchestrate.py` is the normal entry point for a single trial (settles capture, fires the sync
flash, runs the maneuver, stops capture, analyzes automatically); the individual scripts are exposed
separately so each stage can be re-run/debugged on its own (e.g. re-analyzing an existing clip with
a corrected seed, without re-flying it). `--dry-run` arms real capture and runs the full pipeline
without touching vJoy — useful for testing everything except the actual in-game maneuver.

**Maneuver coverage:** only yaw and pitch have maneuver JSONs so far (`feeder/maneuvers/`:
`yaw_reversal(_early)`, `yaw_spool_up`, `standing_start_yaw`, and the pitch equivalents minus an
"early" variant). Roll and the three strafe axes are bound in-game and feedable via
`vjoy_feeder.py`/`bind_helper.py` (they're in `AXIS_MAP`), but no maneuver files exist for them yet
— write new ones following the existing JSON files' segment format when needed.

## Data flow / output

Each trial run by `orchestrate.py` writes to `data/<maneuver-name>/<timestamp>/`:
- `raw.mp4` — the recording
- `input_log.csv` — the feeder's own ground-truth log of when each axis value actually changed
- `trajectory.csv` — `frame,t,pixel_x,pixel_y,peak_brightness` from the landmark tracker
- `omega.csv` — `t,angle_deg,omega_deg_s` after angle conversion + differentiation
- `meta.json` — maneuver name, axis, fov, resolution, backend, seed

`data/` (including `data/actionmaps_backups/`) is gitignored (large/regenerable); only the scripts
and named profiles here are checked in.

## Validating the pipeline without the game

`analysis/selftest_synthetic.py` generates a synthetic clip with a *known* ground-truth ω(t) profile
(a dot moving across a plain background per Gladius yaw's actual measured constants, integrated with
the same first-order lag `flightModel.ts` uses), runs it through the same tracker + angle-conversion
+ sync-detection code real footage would use, and checks the recovered curve matches ground truth.
Run this after any change to the tracking/conversion/sync math, and before trusting a real-footage
result, since it's the only way to catch a wrong FOV/focal-length formula, a differentiation/
smoothing bug, or a sync-detection regression independent of noisy real video:

```
python analysis/selftest_synthetic.py
```

Passing bar: RMS omega error well under the ground truth's peak rate (currently ~1.3°/s RMS against
a ~52°/s peak), and both the sync-flash and motion-onset detectors finding the correct frame.

## Risk / ToS note

The feeder drives the game through a **virtual joystick device** — mechanically the same category
as any HOTAS or macro-capable input hardware, not a memory read/write or injection technique. This
toolchain deliberately stops at that boundary: it does **not** read Star Citizen's process memory
for ground-truth telemetry (which would be more precise but risks the account under RSI's EULA).
Run captures in a private Arena Commander / free-flight instance, not the shared live PU.
