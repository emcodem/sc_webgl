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
| `yaw-max-boost-20260719-162507` | boosted yaw 61.1 (ratio 1.24) | KEEPER |
| `pitch-max-20260719-162736` | non-boosted pitch 61.3 (offset 2500 already saturates) | KEEPER |
| `pitch-max6k-20260719-163402` | pitch at offset 6000 — same 61, confirms 2500 saturates | REDUNDANT |
| `pitch-max-boost-20260719-163705` | boosted pitch 70.8 (ratio 1.15) | KEEPER |

## Notes for sorting / consolidation
- The **KEEPER** rows are the numbers in `MEASUREMENTS.md`. TEST/VOID/SUPERSEDED/REDUNDANT can be
  pruned if disk matters, but they document the method's failure modes (kept intentionally).
- Absolute pitch/yaw read ~5–13% low (projection systematic); trust the coded values for those and
  the measured **ratios** (afterburner ×1.2). Linear + roll absolutes matched coded within ~2%.
- Cross-source: `../../reference/ships/aegs-gladius.json` (`agility`/`speed`/`afterburner`) agrees.
- Three refinement flags (per-axis coastDecel, decoupled-drift, boosted-strafe) are gated on
  `src/physics/flightModel.ts` / `shipTypes.ts` being ported-verbatim — decisions, not edits.
