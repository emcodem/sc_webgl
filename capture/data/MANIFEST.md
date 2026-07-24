# Capture data manifest — Gladius, 2026-07-19

Catalog of every raw clip captured this session, what it measured, and whether it's a **KEEPER**
(the trusted result behind a `MEASUREMENTS.md` number) or **TEST/VOID** (superseded, failed, or a
throwaway). Each clip dir holds `raw.mp4` + its analysis outputs (`orient.csv` / `omega.csv` /
`speed_montage.png`, `events.json`, `segments.json`, `meta.json`). Results & interpretation:
`../MEASUREMENTS.md` (sections "Gladius ROLL", "Gladius PITCH/YAW", "Gladius LINEAR").

## ROLL — keyboard Q/E, orientation-tracked (Kareah, PU)

| Clip (`data/roll/`) | Measured | Status |
|---|---|---|
| `rolltest-20260719-135858` | AC test — validated Q/E scan-code path rolls the ship | TEST |
| `kareah-test-20260719-140952` | Kareah, `--no-focus` → SC not foreground, **didn't roll** | VOID |
| `kareah-test2-20260719-141319` | Kareah, focus ok but Esc pause-menu in-clip | TEST |
| `kareah-full-20260719-141804` | full seq but recorded during a server error, 6 Mbps | VOID |
| `kareah-full-20260719-142536` | full seq, 1 s holds → roll 192–196 (τ-undershoot), reversal | KEEPER |
| **`kareah-long-20260719-143343`** | **3 s holds → steady ±202, spool/decel/reversal transients** | **KEEPER (primary)** |
| `kareah-boost-20260719-144719` | boosted roll ±235 (RMB held) | KEEPER |
| `gladius-decoup-roll-20260719-145516` | decoupled roll == coupled (still auto-stops) | KEEPER |

## LINEAR — keyboard W/S/A/D/Space/Ctrl, HUD-m/s montage (private AC)

| Clip (`data/linear/`) | Measured | Status |
|---|---|---|
| `strafe-right-20260719-150703` | disconnected to main menu mid-run | VOID |
| `strafe-right-20260719-151320` | lateral, motion blur on (still readable) | SUPERSEDED |
| `strafe-right-20260719-151925` | lateral D: accel 98 / max 225 / coast 98 | KEEPER |
| `counter-coupled-20260719-154355` | coupled counter (A while moving) ≈ coast ≈ 98 | KEEPER |
| `counter-decoupled-20260719-154557` | decoupled: release=drift, counter=98 (pure thrust) | KEEPER |
| `vert-up-20260719-154935` | up: accel 98 / coast 49 | KEEPER |
| `vert-down-20260719-160614` | down accel 49 (coast lost to redout blackout) | PARTIAL |
| `vert-down-short-20260719-160752` | down: accel 49 / coast 98 (short accel, stayed conscious) | KEEPER |
| `forward-20260719-161220` | fwd W: accel 134 / max 226 / coast 42 (W = momentary throttle) | KEEPER |
| `back-20260719-161411` | back S: accel 42 / max 225 / coast 134 | KEEPER |
| `boost-lateral-20260719-155201` | boosted lateral: accel 127 / cap 391 | KEEPER |
| `boost-vert-up-20260719-161007` | boosted up: accel 126 / cap 383 / coast 66 | KEEPER |

## PITCH/YAW — mouse virtual joystick, sun-tracked (private AC)

| Clip (`data/angular/`) | Measured | Status |
|---|---|---|
| `yaw-max-20260719-162250` | non-boosted yaw 49.2 | KEEPER |
| `yaw-max-boost-20260719-162507` | boosted yaw 61.1 (ratio 1.24) — driven ~2000, past the ~1920 clamp | SUPERSEDED |
| `pitch-max-20260719-162736` | non-boosted pitch 61.3 (offset 2500 already saturates) | KEEPER |
| `pitch-max6k-20260719-163402` | pitch at offset 6000 — same 61, confirms 2500 saturates | REDUNDANT |
| `pitch-max-boost-20260719-163705` | boosted pitch 70.8 (ratio 1.15) — driven ~2000, past the ~1920 clamp | SUPERSEDED |
| `yaw-1920-20260723-013437` | non-boosted yaw at clamp boundary, 51.27 (see `data/angular/`) | KEEPER |
| `yaw-1920-boost-20260723-204432` (`data/indicator/`) | OBS recorded solid black throughout (bad capture-source hook) — no usable data | VOID |
| `yaw-1920-boost-counter-20260723-204444` (`data/indicator/`) | counter for the above; also black | VOID |
| `yaw-1920-boost-v2-20260723-205926` (`data/indicator/`) | boosted yaw rep1 @ 1920, 53.29 (OBS fixed) | KEEPER |
| `yaw-1920-boost-counter-v2-20260723-205950` (`data/indicator/`) | boosted counter for rep1, recenter confirmed via screenshot | KEEPER |
| `yaw-1920-boost-rep2-20260723-210214` (`data/indicator/`) | boosted yaw rep2 @ 1920, 53.22 | KEEPER |
| `yaw-1920-boost-rep2-counter-20260723-210226` (`data/indicator/`) | boosted counter for rep2, recenter confirmed via screenshot | KEEPER |
| `pitch-reposition-for-1080-20260723-210634` (`data/indicator/`) | calculated reposition pulse, overshot badly (see method note) | VOID |
| `pitch-reposition-undo-20260723-210719` (`data/indicator/`) | exact-inverse recovery pulse, restored position | KEEPER (utility, not data) |
| `pitch-1080-rep2-20260723-210807` (`data/indicator/`) | non-boosted pitch rep2 @ 1080, dwell 1.0s from center — contaminated (corr 0.789, edge-clip) | VOID |
| `pitch-1080-rep2-counter-20260723-210844` (`data/indicator/`) | counter for the above | KEEPER (utility) |
| `pitch-1080-rep2b-20260723-210928` (`data/indicator/`) | non-boosted pitch rep2b @ 1080, dwell 0.7s — clean, 64.73 (corr 0.949) | KEEPER |
| `pitch-1080-rep2b-counter-20260723-210953` (`data/indicator/`) | counter for rep2b | KEEPER |
| `pitch-1080-boost-rep2-20260723-211006` (`data/indicator/`) | boosted pitch rep2 @ 1080, dwell 0.7s from center — contaminated (65.60, frame-edge clip confirmed) | VOID |
| `pitch-1080-boost-rep2-counter-20260723-211018` (`data/indicator/`) | counter for the above | KEEPER (utility) |
| `pitch-1080-boost-rep2b-counter-20260723-211509` (`data/indicator/`) | boosted counter, recenter (view drifted out of frame after this) | TEST |
| `pitch-1080-boost-rep2c-20260723-211744` (`data/indicator/`) | boosted pitch rep2c @ 1080, dwell 0.55s — clean, 66.72 (corr 0.977, frame-checked) | KEEPER |
| `pitch-1080-boost-rep2c-counter-20260723-211856` (`data/indicator/`) | boosted counter for rep2c, recenter confirmed via screenshot | KEEPER |
| `pitch-1080-up-nonboost-20260723-212633` (`data/indicator/`) | pitch UP dir, non-boosted, dwell 1.0s — 66.97, corr 0.918 (borderline, but frame-checked clean) | KEEPER |
| `pitch-1080-up-nonboost-counter-20260723-212820` (`data/indicator/`) | counter for the above | KEEPER |
| `pitch-1080-up-nonboost-v2-20260723-212902` (`data/indicator/`) | pitch UP dir, non-boosted, dwell 0.6s — clean, 66.78 (corr 0.969) | KEEPER |
| `pitch-1080-up-nonboost-v2-counter-20260723-212932` (`data/indicator/`) | counter for v2 | KEEPER |
| `pitch-1080-up-boost-20260723-213029` (`data/indicator/`) | pitch UP dir, boosted, dwell 0.45s — clean, 66.98 (corr 0.952, frame-checked) | KEEPER |
| `pitch-1080-up-boost-counter-20260723-213136` (`data/indicator/`) | boosted counter for the above | KEEPER |
| `pitch-1080-up-boost-rep2-20260723-213152` (`data/indicator/`) | pitch UP dir, boosted rep2 — clean, 62.49 (corr 0.949, frame-checked; noisy vs rep1) | KEEPER |
| `pitch-1080-up-boost-rep2-counter-20260723-213322` (`data/indicator/`) | boosted counter for rep2, recenter confirmed via screenshot | KEEPER |
| `pitch-360-down-nonboost-20260723-214751` (`data/indicator/`) | full-360 cross-check, down non-boosted, T=5.556s — candidates 63.63/65.93 vs established 64.80 | KEEPER |
| `pitch-360-down-boost-20260723-220612` (`data/indicator/`) | full-360 cross-check, down boosted, T=5.225s — candidates 67.82/69.94 vs established 68.92 | KEEPER |
| `pitch-360-up-nonboost-20260723-220830` (`data/indicator/`) | full-360 cross-check, up non-boosted, T=5.383s — candidates 66.35/67.36 vs established 66.88 | KEEPER |
| `pitch-360-up-boost-20260723-221037` (`data/indicator/`) | full-360 cross-check, up boosted, T=5.386s — INCONCLUSIVE, busy starfield made before/after landmark identification unreliable | VOID |
| `pitch-360-up-boost-v2-20260723-223210` (`data/indicator/`) | up-boosted 360 attempt with T=5.4545s (short-hold-based rate) — wide 22.86° residual, weakly resolved; superseded by the ref-anchored reps below | SUPERSEDED |
| `pitch-360-up-boost-ref-20260723-225752` (`data/indicator/`) | up-boosted 360, T=4.390s (API-reference-anchored, 82°/s) — rep1, 11.32° residual, candidates 79.38/84.54 | KEEPER |
| `pitch-360-up-boost-ref-rep2-20260723-230629` (`data/indicator/`) | up-boosted 360, T=4.390s — rep2, 29.47° residual, candidates 75.25/88.67 | KEEPER |
| `pitch-360-recenter-nudge-20260723-230813` (`data/indicator/`) | small corrective nudge after rep2, not a data point | KEEPER (utility) |
| `pitch-spoolup-nonboost-20260723-232044` (`data/indicator/`) | pitch spool-up rise curve, non-boosted — 2nd-order fit: rate_ss=66.41, ωₙ=8.633, ζ=0.807 | KEEPER |
| `pitch-spoolup-nonboost-counter-20260723-232338` (`data/indicator/`) | counter for the above | KEEPER |
| `pitch-spoolup-boost-20260723-232357` (`data/indicator/`) | pitch spool-up rise curve, boosted — 2nd-order fit: rate_ss=75.75, ωₙ=8.009, ζ=0.916 | KEEPER |
| `pitch-spoolup-boost-counter-20260723-232537` (`data/indicator/`) | counter for the above | KEEPER |
| `yaw-spoolup-nonboost-20260723-232618` (`data/indicator/`) | yaw spool-up rise curve, non-boosted — 2nd-order fit: rate_ss=50.57, ωₙ=8.027, ζ=0.729 | KEEPER |
| `yaw-spoolup-nonboost-counter-20260723-232756` (`data/indicator/`) | counter for the above | KEEPER |
| `yaw-recenter-before-boost-spool-20260723-232921` (`data/indicator/`) | corrective pulse, guessed wrong direction, made drift worse | VOID |
| `yaw-recenter-before-boost-spool-v2-20260723-233007` (`data/indicator/`) | corrective pulse, correct direction, recentered | KEEPER (utility) |
| `yaw-spoolup-boost-20260723-232815` (`data/indicator/`) | yaw spool-up boosted attempt from far-off-center position | VOID (superseded by v2) |
| `yaw-spoolup-boost-v2-20260723-233054` (`data/indicator/`) | yaw spool-up rise curve, boosted — 2nd-order fit: rate_ss=48.81, ωₙ=8.186, ζ=0.560 | KEEPER |
| `yaw-spoolup-boost-v2-counter-20260723-233242` (`data/indicator/`) | counter for the above | KEEPER |

## Notes for sorting / consolidation
- The **KEEPER** rows are the numbers in `MEASUREMENTS.md`. TEST/VOID/SUPERSEDED/REDUNDANT can be
  pruned if disk matters, but they document the method's failure modes (kept intentionally).
- Absolute pitch/yaw read ~5–13% low (projection systematic); trust the coded values for those and
  the measured **ratios** (afterburner ×1.2). Linear + roll absolutes matched coded within ~2%.
- Cross-source: `../../reference/ships/aegs-gladius.json` (`agility`/`speed`/`afterburner`) agrees.
- Three refinement flags (per-axis coastDecel, decoupled-drift, boosted-strafe) are gated on
  `src/physics/flightModel.ts` / `shipTypes.ts` being ported-verbatim — decisions, not edits.
