# PLAYBOOK — capture a new ship's flight spec, the way the Gladius was done

The **fast, runnable per-ship recipe** for a full flight characterization (roll, pitch, yaw, every
linear axis/direction) using the **hold-capture** toolchain — the method that produced the complete
Gladius spec on 2026-07-19.

**Optimized for minimum human effort: capture ALL clips first (two short live sessions), then
analyze everything offline.** The only human-in-the-loop cost is driving the game — venue setup,
foreground focus, a couple of mode toggles. Analysis touches no game at all: it runs off each clip's
`raw.mp4`, and even the tracker seeds come from the clips themselves (frame 0). So the whole capture
phase is front-loaded and batched to minimize venue changes and toggles; the analysis phase is a
handful of offline loops you can run any time after.

**Read this, not BLUEPRINT's numbered "Per-ship procedure"** — that documents the older
`orchestrate.py`/`fit_model.py` vJoy-*device* path, which never produced a full-ship spec. Reference
material: `BLUEPRINT.md` ("Choosing and seeding a landmark", "Gotchas", "OBS backend setup") for
method depth; `MEASUREMENTS.md` + `data/MANIFEST.md` for the Gladius numbers to compare against.
**`MEASUREMENTS.md` is the Gladius-only record — don't edit it** (new-ship results → a new
`<SHIP>.md`). Note (2026-07-26): `MEASUREMENTS.md` is now a values table with a CONFIRMED/SUSPECT
status column, not a narrative log — see its own header and the "power triangle allocation" CRITICAL
note before treating any pre-2026-07-26 row as settled. Full narrative/derivation detail for any row
moved to `MEASUREMENTS_ARCHIVE.md`.

---

## What you capture per ship — and what you DON'T

Per ship (scales with agility/mass): **rotational** (roll incl. boosted + a decoupled check; pitch;
yaw; afterburner mult), **linear** (forward/back, lateral, vertical — accel, SCM cap, coast decel
per direction; decoupled drift; boosted strafe/vertical accel+cap), and **boost meter** (drain rate,
recharge rate — see A2b below; check for a real red-zone rate asymmetry every time, don't assume the
Gladius "no kink" finding generalizes).

**Do NOT re-capture the mouse virtual-joystick settings** (`VJoyAnglePilots`, `VJoyCombinedDeadZone`,
the expo input curve ≈1.48, full-range ≈1500 counts). They're the **ship-independent input mapping**,
already cross-validated Taurus-vs-Gladius. A new ship needs only its per-axis **rates**.

---

## Effort model — why the order below

Two things are expensive to set up and worth grouping around:

1. **Venue.** Roll needs the **PU (Security Post Kareah)** — an AC starfield has no roll landmark.
   Pitch/yaw **and** all linear share **private AC free-flight**. → **Two venues, two sessions**, and
   everything that shares a venue is captured back-to-back without leaving.
2. **Mode/state toggles.** Pointer-accel pin (mouse only), Coupled↔Decoupled (C), boost (per-run
   `--boost` flag, no toggle). → Batch all mouse runs together, batch all decoupled runs together.

Motion blur stays **OFF globally** (required for roll; harmless everywhere else — the linear montage
reads the compact cockpit number regardless). Set it once. FOV **116**, **3840×2160 @ 120fps**
(moved up from 60fps on 2026-07-27 — monitor confirmed 120Hz-capable; remember to also raise the
in-game frame rate cap to 120 to match, per `settings_checklist.md`), OBS backend, ship at **0 m/s**,
Coupled by default.

---

## Data layout (the tools don't partition by ship — you must)

The three capture scripts have **no `--ship` flag**; redirect every run with `--out data/<ship>/<group>`
(`roll` / `angular` / `linear`) + a descriptive `--tag`, so a new ship never intermixes with Gladius.

---

# PHASE 1 — CAPTURE (two live sessions, ~30 min total)

Work top-to-bottom; each line is one recorded clip. Note nothing by hand — the `--out`/`--tag`
partitions everything. (`$S` = ship slug, e.g. `taurus`.)

## Session A — Private AC (pitch/yaw + all linear), one sitting

```
python pointer_accel.py pin            # mouse block needs 1:1; harmless for the linear block after
```

**A1 · Mouse block — pitch/yaw** (sun centered; **re-center on the sun between runs**):
```
python mouse_hold_capture.py --axis yaw   --offsets "0,2500,-2500,2500,-2500" --out data/$S/angular --tag yaw-max
python mouse_hold_capture.py --axis yaw   --offsets "0,2500,-2500,2500,-2500" --boost --out data/$S/angular --tag yaw-boost
python mouse_hold_capture.py --axis pitch --offsets "0,2500,-2500,2500,-2500" --out data/$S/angular --tag pitch-max
python mouse_hold_capture.py --axis pitch --offsets "0,2500,-2500,2500,-2500" --boost --out data/$S/angular --tag pitch-boost
```

**A2 · Linear block — Coupled** (keyboard; accel-pin irrelevant here):
```
python linear_hold_capture.py --sequence "D:5,_:8"          --out data/$S/linear --tag strafe-right
python linear_hold_capture.py --sequence "W:5,_:8"          --out data/$S/linear --tag forward
python linear_hold_capture.py --sequence "S:5,_:8"          --out data/$S/linear --tag back
python linear_hold_capture.py --sequence "UP:4,_:8"         --out data/$S/linear --tag vert-up
python linear_hold_capture.py --sequence "DN:2.5,_:8"       --out data/$S/linear --tag vert-down   # SHORT — redout blackout
python linear_hold_capture.py --sequence "D:5,_:8"  --boost --out data/$S/linear --tag boost-lateral
python linear_hold_capture.py --sequence "UP:4,_:8" --boost --out data/$S/linear --tag boost-vert-up
```

**A2b · Boost meter — drain + recharge, ONE continuous clip** (keyboard/mouse-button only, no vJoy;
meter should start full — check the HUD before running):
```
python boost_meter_capture.py --drain 25 --recharge-watch 120 --tag boost-meter-cycle --out data/$S/linear
```
`--drain`/`--recharge-watch` are margins, not measurements — start generous (drain long enough to be
confident it bottoms out at 0% well before the timer ends; recharge-watch long enough to reach 100%)
and re-run wider if the montage below shows the meter still moving at the clip's end. Don't assume
Gladius's found durations (~22s drain, ~65s to full recharge) transfer to a different ship's
`boostCapacity`/mass — check this ship's own clip.

**A3 · Linear block — Decoupled** (toggle **C** once, verify CPLD unchecked, then capture; toggle back after):
```
python linear_hold_capture.py --sequence "D:3,_:3,A:5,_:4" --decoupled --out data/$S/linear --tag counter-decoup
```
```
python pointer_accel.py restore        # done with mouse for good
```

## Session B — PU / Security Post Kareah (roll only)

Frame the post **centered + vertical**, ~7 km, 0 m/s, Coupled, OBS **50 Mbps** (thin post). Toggle
**C** for the last (decoupled) run only.
```
python roll_hold_capture.py --sequence "Q:3.0,_:3.0,E:3.0,_:3.0,Q:2.5,E:2.5,_:3.0" --out data/$S/roll --tag long
python roll_hold_capture.py --sequence "Q:3.0,_:2.5,E:3.0,_:2.5" --boost           --out data/$S/roll --tag boost
python roll_hold_capture.py --sequence "Q:1.0,_:3.0,E:2.0,_:3.0" --out data/$S/roll --tag decoup   # decoupled ON
```

**~18 clips, 2 venues, 1 accel pin/restore, 2 C-toggles.** Everything needed is now on disk. The game
can be closed for good.

---

# PHASE 2 — ANALYZE (offline, no game, any time later)

Seeds are read **from the clips themselves** — one seed per venue works because landmarks are
re-centered (sun ≈ frame center; Kareah post centered; the m/s readout is HUD-fixed). Crop-check one
clip's frame 0 per group to fix the seed, then loop the whole group.

## Roll → steady °/s + afterburner mult

```
foreach ($d in Get-ChildItem data/$S/roll -Directory) {
  python analysis/track_orientation.py "$($d.FullName)/raw.mp4" --seed-x 1935 --seed-y 1010 `
      --window 150 --floor-pct 88 --mask-below 1200
}
```
Read the steady plateau per hold; `boost / long` ratio = afterburner rotational mult. **Lock quality
= elongation** (logged): healthy ~2.3–4.3, a drop toward 1 = lost the post. Adjust `--seed-x/-y` if
the post isn't at ~(1935,1010).

## Pitch/yaw → °/s (yaw = axis x, pitch = axis y)

```
foreach ($d in Get-ChildItem data/$S/angular -Directory) {
  $axis = if ($d.Name -like "pitch*") { "y" } else { "x" }
  python analysis/track_landmark.py "$($d.FullName)/raw.mp4" --seed-x 1920 --seed-y 1080 --window 40 --out "$($d.FullName)/traj.csv"
  python analysis/angle_convert.py "$($d.FullName)/traj.csv" --axis $axis --fov 116 --resolution 3840x2160
}
```
**Filter tracked frames by `peak_brightness`** before reading — when the sun exits frame it *bounces*
and those stationary frames wreck the slope. Trust the **boost/non-boost ratios**; absolutes read
~5–13% low (projection systematic) so cross-check them against coded/API, not raw.

## Linear → accel / SCM cap / coast decel

```
foreach ($d in Get-ChildItem data/$S/linear -Directory) {
  python analysis/montage_speed.py "$($d.FullName)/raw.mp4" --region <x,y,w,h> --step 8
}
```
`--region` = the compact cockpit m/s number's bounding box (crop-check one frame; HUD-fixed, so one
region serves all linear clips — the Gladius region likely carries over). Read **accel** (Δspeed/Δt on
the ramp), **max** (plateau = SCM cap), **coast decel** (Δspeed/Δt after release). Expected model
(confirmed on Gladius): accel = commanded-dir thrust/mass; coast decel = **opposing**-dir thrust/mass;
W/S are momentary throttle (release → coast to 0). Verify per-frame brightness that each accel ran at
full brightness (a GLOC would sag the curve — vert-down is the one at risk, hence the short hold).

## Boost meter → drain rate + recharge rate

```
python analysis/montage_speed.py "data/$S/linear/boost-meter-cycle-*/raw.mp4" --region <x,y,w,h> --step 20 --cols 8 --scale 3 --out data/$S/linear/boost_montage_part1.png --end-frame <drain_end_frame>
python analysis/montage_speed.py "data/$S/linear/boost-meter-cycle-*/raw.mp4" --region <x,y,w,h> --step 30 --cols 10 --scale 3 --out data/$S/linear/boost_montage_part2.png --start-frame <drain_end_frame>
```
`--region` = the "AB %" HUD readout's bounding box (crop-check one frame; on Gladius at 3840x2160 it
was `2150,1130,180,100` — re-check per ship/resolution, the boost gauge may sit elsewhere on a
different ship's cockpit). It's a plain number, no OCR needed — **read the montage tiles by eye**
(that's what the script's docstring means by "or hand it to a vision model"), noting each tile's
burned-in `t=` timestamp against its %. One montage call easily covers 20-30s of clip before tiles
get too numerous to read at a glance; split the full clip into 2+ calls via `--start-frame`/
`--end-frame` (find the drain→recharge boundary — the meter bottoms at 0% and holds briefly before
climbing again — from part 1's last few tiles).

Compute rate = Δ% / Δt across the **whole 100%→0%** (drain) and **0%→100%** (recharge) ranges, then
check specifically for a slope change at `boostRedZonePct` (25 on Gladius) — average the rate above
and below it separately and compare. **On Gladius, neither drain nor recharge showed any such kink —
both were single uniform rates end to end** (see `BOOST_FINDINGS.md` item 1 /
`MEASUREMENTS.md`'s "Boost meter drain + recharge — frame-accurate capture") — but don't assume that
generalizes; check every new ship's own data before deciding whether its two-rate fields should be
equal or genuinely different. Also note the dwell at 0% before recharge visibly begins
(`boostRechargeDelaySec`) and whether `boostReactivatePct` blocks a new burn as expected near the
red-zone floor.

---

## Cross-check every number three ways

Trusted when measured ≈ coded ≈ API: (1) measured above; (2) coded `src/physics/shipTypes.ts` (add a
new `ShipType` if absent — Taurus isn't in there; Arrow is a Gladius clone); (3) API
`reference/ships/<code>.json` (`scripts/fetch-ship-ref.mjs` to fetch if uncached). Linear + roll
absolutes should match ~2%; pitch/yaw trust the ratios.

## Recording results (keep MEASUREMENTS.md as the Gladius-only record)

- Catalog clips in `data/MANIFEST.md` (KEEPER / TEST / VOID / SUPERSEDED), Gladius-section style.
- Write the fitted spec into a **new `<SHIP>.md`** mirroring MEASUREMENTS.md's "Results" — do **not**
  append to `MEASUREMENTS.md`.
- Flag any coded/API gaps (as Gladius did: per-axis `coastDecel`, decoupled-drop-linear-brake, missing
  boosted strafe/vertical). Those touch ported-verbatim `flightModel.ts`/`shipTypes.ts` →
  **decisions needing explicit go-ahead, not data-task edits.**

## Ship notes

- **Taurus** — best *next* ship: ~2.7× lower rotational gain keeps landmarks on-screen at large
  offsets (easier pitch/yaw; also the ship to settle the deadzone rescale-vs-hard-cut question). Not
  yet in `shipTypes.ts`.
- **Arrow** — currently `{ ...GLADIUS, name:'Arrow' }`; a real capture stops it being a clone.

---

## Redoing a single clip

If one clip is bad (lost lock, server hiccup), you don't re-run the whole phase — re-capture just that
`--tag` in its venue and re-run only its analysis line. Mark the bad one VOID in `MANIFEST.md`.
