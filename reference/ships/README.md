# Ship reference data (star-citizen.wiki API)

Raw per-ship JSON dumps from the **star-citizen.wiki** API
(`https://api.star-citizen.wiki/api/vehicles/<slug>`), one file per ship, pretty-printed and
committed so changes are diffable across game patches. Docs: https://docs.star-citizen.wiki/

This data is **derived from the game files** and tagged with the patch it came from
(`data.version`, e.g. `4.9.0-LIVE.12232306`, and `data.updated_at`).

## ⚠ This is REFERENCE, not the flight source of truth

**`src/physics/shipTypes.ts` is the authoritative flight model** — hand-measured, frame-counted
against the real game, and ported verbatim (see `CLAUDE.md` and `capture/BLUEPRINT.md`). Nothing
here auto-populates or overrides it. Use these files for:

- **Cross-validation** of the measured tuning. The API's `agility` / `speed` / `afterburner` blocks
  agree with our captures and the coded constants — e.g. for the Gladius:
  `agility.roll = 200`, `agility.roll_boosted = 240` (= `agility.roll × afterburner.roll_boost_multiplier 1.2`),
  `speed.scm = 226`, `speed.boost_forward = 520`, `mass = 48552` — all match `shipTypes.ts` and the
  `capture/MEASUREMENTS.md` roll/strafe results. (Where the API and a *measurement* disagree, the
  measurement wins — the API is a spec sheet, not a frame-counted trace; note e.g. per-axis coast
  decel, which the API doesn't break out.)
- **Non-flight metadata** the universe layer will need later: `dimension`, `ports`/hardpoints,
  `crew`/`seating`, `propulsion.thrusters`, `manufacturer`, `game_description`, `images`, etc.

If/when this is consumed at runtime, add a loader in `src/` that reads the specific fields it needs —
do **not** wire the flight fields into the sim. Keep the boundary explicit.

## Files

| File | Ship | API slug |
|---|---|---|
| `aegs-gladius.json` | Aegis Gladius | `aegs-gladius` |

## Refreshing / adding a ship

```
node scripts/fetch-ship-ref.mjs aegs-gladius        # refresh the Gladius
node scripts/fetch-ship-ref.mjs anvl-arrow          # add the Arrow, etc.
```

Find a ship's slug from its API URL (`.../api/vehicles/<slug>`). Commit the resulting JSON so the
patch-to-patch diff is visible.
