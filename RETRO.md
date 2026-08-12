# Boosted linear thrust — forward/back findings & what's still open

**Date:** 2026-08-02
**Scope:** `src/physics/ships/gladius.ts` (`boostLinearThrust`, `boostLinearDrag`), `src/physics/flightModel.ts`
(the coast/drag block and the pre-thrust speed-cap clip), `tests/shipTuning.test.ts` (the
governor-vs-drag-limited invariant).
**Status:** forward (main) is solid and untouched. Every OTHER boosted linear axis (retro, strafe,
up, down) turns out to share the same two-regime structure: a curved, real-drag "aligned" rate
(extending further in your current direction, main-like shape) and a separate, flat, no-drag
"countering" rate (braking/reversing an existing opposite velocity) at a consistent ~58-65% of the
aligned rate. **Retro's aligned rate was recaptured rigorously 2026-08-02 and confirms the pattern
exactly (see §7)** — it is NOT an outlier, its old "≈55 m/s²" reading was just a misleading average.
None of this applied to code yet.

---

## 1. Where `boostLinearDrag = 0.38` actually comes from

Fit 2026-07-15 against a real, dense (40ms-interval) **boosted-forward (main)** acceleration trace,
standing start to ~519 m/s: `0, 5, 10, 20, 29, 40, 50, 62, 74, 86, 100, 113, 128, ... 208 (@1.2s), 293
(@1.6s), 412 (@2.32s)`, then a long creep to ~519 by ~5.5s. That creeping tail (not a hard snap to the
cap) is what implies a real proportional drag term, unlike every other measured Gladius linear axis
(which show flat, "governor not drag" acceleration). Grid-searching `(thrust, drag)` against
`dv/dt = thrust/mass - drag·v` (plus the hard governor clamp) landed on **thrust ≈ 420, drag ≈ 0.38**,
reproducing the whole climb to within ~10 m/s RMS.

**This fit is specific to main.** `boostLinearDrag` was then reused as a single ship-wide constant for
retro/strafe/vertical too, without independent verification for any of them — `gladius.ts`'s own
comment admits as much for retro ("Reverse boost was NOT re-traced ... pending its own measurement").

---

## 2. Retro (back) — confirmed mismatch, two independent captures agree

**Coded today:** `boostLinearThrust.retro = 216.5` → implies 144.3 m/s² acceleration at `v=0` (where
drag contributes nothing). This number was never independently measured — it was scaled from main's
own thrust-drop factor between an earlier candidate and its 2026-07-15 re-measurement, to preserve a
"governor ratio" (`thrust / (cap × drag × mass) ≈ 1.417`) that main happens to satisfy.

**Capture A (2026-07-27, `MEASUREMENTS.md` "Boosted retro top speed + release decay, full power"):**
accelerating from rest under boost, reached max ≈267 m/s (matches coded `boostSpeedBack` 268) at
**accel ≈55 m/s²**.

**Capture B (2026-08-02, this session, manual capture, `unboosted_forward_stop_with_boost.mp4`):**
unboosted 226 m/s forward cruise, then reverse+boost held together to a full stop. Read frame-by-frame
via `montage_speed.py` (region `1560,1140,220,110`, 3840×2160@120fps):

- Deceleration onset: t≈9.29s. Full stop (min reading 2 m/s, held t=13.30-13.33 before climbing back
  up): t≈13.32s. **Total: ~4.0s**, matching the original real-SC recollection that started this
  investigation almost exactly.
- Rate is **flat at ~55-56 m/s² across the ENTIRE 222→2 m/s range** — no exponential/drag decay
  anywhere in the curve. Boost confirmed actively held via the AB meter (100%→92% over 1.8s, matching
  the coded 4.95%/s drain rate as a bonus cross-check).

**Both captures converge on ~55-56 m/s², despite testing opposite scenarios** (accelerating from rest
vs. decelerating an existing opposing velocity) — strong, independent agreement. The coded 216.5
(→144.3 m/s²) is **~2.6× too high**.

**Why this needs more than a constant edit:** `boostLinearDrag` is a single scalar shared by every
boosted linear axis (`core/types.ts`). If retro genuinely has ~negligible drag (which the perfectly
flat capture-B curve implies — any real drag term would visibly bend it), then simply lowering
`boostLinearThrust.retro` to ~84 (56 × mass 1.5) while retro still shares main's `boostLinearDrag=0.38`
would make it drag-limited at just ~147 m/s (`84/(0.38×1.5)`) — contradicting capture A, which shows it
reaching all the way to 267. **Both captures are only simultaneously explainable if retro has its own,
near-zero drag, decoupled from main's real 0.38.**

**Fix, not yet applied (pending go-ahead):**
1. `gladius.ts`: `boostLinearThrust.retro` 216.5 → **~84**.
2. `core/types.ts` + `physics/ships/{rawShipType,buildShipType}.ts`: split `boostLinearDrag` so retro
   gets its own (near-zero, ~0.001, matching the "negligible" convention already used for unboosted
   `linearDrag`) while main/strafe/vertical keep 0.38 — untouched, since main's own dense trace
   validates it.
3. `physics/flightModel.ts`: the coast/drag block currently picks one shared `boostLinearDrag`
   regardless of which thruster is firing — needs to become axis-aware.
4. `tests/shipTuning.test.ts`: the governor-vs-drag-limited assertion for retro becomes trivially true
   once its drag is near-zero (same as the unboosted axes never needing that assertion at all).

---

## 3. Strafe/vertical — CONFIRMED to have real drag (main-like), NOT retro's flat character; down ≠ up

**Batch 1 done, 2026-08-02** (`left_boost.mp4`, `up_boost.mp4`, `down_boost.mp4` — manual captures,
accelerating from rest to top speed under boost, full curve read via `montage_speed.py`,
`1560,1140,220,110`, 3840×2160@120fps). `down_boost` was captured in two segments (accel to ~230, hold
briefly to avoid redout, accel to max) — spliced into one continuous curve by removing the hold
duration before fitting.

Unlike retro, **all three show a real, decaying acceleration rate approaching a smooth asymptote** —
the same `dv/dt = thrust/mass - drag·v` shape main was fit to, not retro's flat line. Fit results:

| Axis | Fitted accel @ v=0 | Fitted drag | Asymptote | Measured peak | Fit confidence |
|---|---|---|---|---|---|
| left (strafe) | ~191 m/s² | ~0.45 | ~426 | 394 | good (RMS 8.9, clean capture) |
| up (vertical) | ~204 m/s² | ~0.48 | ~427 | 394 | fair (RMS 13.5, shallower minimum) |
| down (vertical) | ~112 m/s² | ~0.26 | ~434 | 387 | fair (RMS 12.3, shallower minimum) |

**Left/strafe and up cluster together** (~191-204 accel, ~0.45-0.48 drag) — plausibly the same real
value, consistent with the user's left=right assumption possibly extending to up too.

**Down is genuinely weaker — confirmed, not assumed.** Down's raw early-frame acceleration (~60-65
m/s², visible directly in the clean data before any curve-fitting) is roughly half of up's (~120-125
m/s²) — far too large a gap to be reading error. This directly contradicts `gladius.ts`'s current
`boostLinearDrag`/`boostLinearThrust` setup (`verticalDown` coded equal to `verticalUp`, on the
explicit assumption "no data existed" to support asymmetry — there now is, pointing the same direction
as the unboosted verticalDown=verticalUp/2 ratio, though not exactly half here).

Peak speeds: left/up both hit 394 (matches coded `boostManeuveringSpeedCap` exactly). Down topped out
at 387, ~1.8% lower — small enough to plausibly be noise, worth a second look but not a strong claim.

**Versus current code** (`boostLinearThrust.strafe=verticalUp=verticalDown=318.3` all identical, one
shared `boostLinearDrag=0.38`): left/up's fitted thrust (~290-306) is only ~4-9% off 318.3 — much
closer than retro's 2.6× miss — but fitted drag (~0.45-0.48) runs ~20-25% higher than 0.38. Down's
coded thrust is over 2× too high relative to what the data shows.

**Caveat:** up/down's fits have a shallow minimum (t0/thrust/drag trade off against each other) —
treat the exact numbers as ballpark, not frame-accurate the way retro's flat line was. The qualitative
finding (down ≠ up; both have real drag unlike retro) is solid regardless.

---

## 4. Batch 2 (2026-08-02) — cruise, then boosted counter-thrust to a stop

Same method as retro's capture B, now done for strafe/up/down too: get to an unboosted cruise, then
counter with boosted opposite-thrust, read the full stop curve via `montage_speed.py`
(`1560,1140,220,110`, 3840×2160@120fps). All three fit a pure flat line (linear regression) far better
than batch 1's curved fits did:

| Scenario | File | Countering rate (flat) | Fit RMS | Total decel time |
|---|---|---|---|---|
| strafe (225 left cruise → boost right) | `225_left_boost_right_to_stop.mp4` | **123.7 m/s²** | 0.90 | ~1.85s |
| up-thrust (220 down cruise → boost up) | `220_down_boost_up_to_stop.mp4` | **123.1 m/s²** | 0.57 | ~1.9s |
| down-thrust (225 up cruise → boost down) | `225_up_boost_down_to_stop.mp4` | **64.4 m/s²** | 0.31 | ~3.6s |

Note on the down-thrust capture: heavy redout tint made the frames near the stop point visually
unreadable in the raw montage — per-channel contrast-stretching each crop recovered every digit
cleanly (true min 4 m/s at t≈5.30, not a display freeze; the "flat 19" afterward is real too — the
pilot can't release input at exactly zero, so a small overshoot into the opposite direction happens,
then input releases and the ship just drifts at whatever residual speed that left it at, same as the
"flat 33/34" tails on the other two clips. None of this affects the stop-point reading, which is
always the pre-overshoot minimum, same convention as retro's capture B).

See §5 for what this means when compared against batch 1's aligned-rate fits.

## 5. The bigger finding: "aligned" vs. "countering" are genuinely different rates, ~0.58-0.65× apart

| Axis | Countering rate (flat, batch 2) | Aligned rate @v=0 (curved) | Ratio |
|---|---|---|---|
| strafe | 123.7 | ~191 (batch 1) | 0.648 |
| up | 123.1 | ~204 (batch 1) | 0.603 |
| down | 64.4 | ~112 (batch 1) | 0.575 |
| retro | ~55.5 | ~87.6 (§7, recaptured rigorously) | 0.634 |

**All four axes now land in a tight 0.575-0.648 band.** Every boosted linear axis has two genuinely
different characteristics depending on the role thrust is playing:

- **"Aligned"** (extending further in your current direction of travel, from rest toward a cruise) —
  real drag, a curved approach to an asymptote above the cap (governor-limited, like main).
- **"Countering"** (canceling an existing opposite-direction velocity — braking/reversing) — flat,
  constant deceleration, no drag at all, consistently ~58-65% of the aligned rate.

**What this means for the model:** this isn't "retro has near-zero drag, unique among axes" (§2's
original framing, now superseded) — it's that **every axis has two distinct thrust/drag
characteristics depending on the role**: a real-drag "aligned" pair (extending further in your
current direction, main's own dense trace is exactly this) and a separate, lower, flat "countering"
rate (braking an existing opposite velocity, no drag). The current `flightModel.ts`/`ShipType`
structure has no concept of this distinction at all — one `boostLinearThrust`/`boostLinearDrag` per
axis, used identically regardless of whether thrust is extending or countering. Modeling this
properly needs each boosted linear axis to carry both an aligned (thrust, drag) pair AND a separate
countering rate — a bigger structural change than the per-axis-drag split §2 originally proposed, but
now confirmed necessary by four independent axes, not a guess.

## 6. Right-side strafe not captured

User: same as left by symmetry (low priority — left's fit was already the cleanest of the batch).

**Caveats carried over from batch 2 for any future re-captures:**
- Down-axis captures should stay as short as safely possible — real G-force blackout/redout risk
  (`capture/BLUEPRINT.md`). The redout in this session's down-thrust-countering clip didn't cost any
  data (contrast-stretching recovered it), but don't rely on that trick working every time.
- Keep the same HUD region/method and confirm boost via the AB meter, as established.

## 7. Retro's aligned rate — recaptured rigorously 2026-08-02, confirms the pattern exactly

`reverse_boost.mp4`: standing start (after a brief ~0.3s cancellation of a small +9 m/s pre-existing
drift), holding S+boost, climbing to 267 m/s. Read via `montage_speed.py` and fit the same way as
batch 1:

**Fitted: thrust ≈ 131.3 (accel@0 ≈ 87.6 m/s²), drag ≈ 0.235, asymptote ≈ 373 m/s** (RMS 9.97, fit
quality comparable to the other axes). Asymptote sits above the 268 cap — governor-limited, ratio
131.3/(268×0.235×1.5) ≈ **1.39**, remarkably close to main's own 1.417 design ratio.

Ratio vs. the countering rate: 55.5/87.6 = **0.634** — squarely inside the 0.575-0.648 band the other
three axes established. **Retro is not an outlier.** Its old "≈55 m/s²" reading (2026-07-27) wasn't
bad data, just a misleading simple average: the true curve starts at 87.6 and tapers toward ~0 near
the cap, and averaging total-Δv/total-Δt over that whole climb happens to land around 50-57 —
coincidentally close to the (structurally unrelated) countering rate, which is why the two looked like
they agreed when they don't.

**Status: all four axes' two-regime numbers are now confirmed.** What's left is entirely a code-side
decision — see §8.

## 8. APPLIED to code 2026-08-02

**Done.** Final shape as implemented (it changed in one important way from the sketch below: drag ended
up DERIVED rather than authored per-axis, per user direction that a fitted drag coefficient is the wrong
authoring surface — swapping ships should mean entering mass/thrust/top-speeds, nothing fitted):

- `core/types.ts` — `boostLinearDrag` scalar → per-axis; new `boostCounterThrust` (thrust units); the
  three ratios carried on the compiled type so the derivations can be asserted structurally.
- `physics/ships/linearInvariant.ts` (new, mirrors `angularInvariant.ts`) — `scaleLinearThrust` and
  `boostDragFromCaps`. All three boosted-linear fields derive from `linearThrust`, `mass`, the speed caps
  and the three ratios; `rawShipType.ts` no longer authors any of them.
- `physics/ships/gladius.ts` — authors only `boostThrustMultiplier: 2.09`,
  `boostCounterMultiplier: 1.30`, `boostGovernorOvershoot: 1.417`. Four stale provenance notes rewritten.
- `physics/flightModel.ts` — per-axis role detection (`COUNTER_VEL_EPSILON`); countering axes contribute
  nothing to `accel` and are applied in **velocity space** after integration, clamped so the axis lands
  exactly on zero at any `dt`; drag became per-axis and applies only to aligned, actively-thrusting axes.
- `tests/shipTuning.test.ts` — 267 tests pass (up from 250). Governor invariant now asserted
  structurally for every ship; the `boosted verticalDown == verticalUp` assertion inverted to the half
  ratio; new suite covering the headline stop time, flatness, exact-zero landing at `dt=1/20`,
  decoupled/brake, and the zero-crossing flip back to aligned.

Two properties worth remembering: the aligned asymptote is `boostGovernorOvershoot × cap`, independent
of mass and thrust (so retuning mass rescales acceleration without disturbing top speeds), and
"governor-limited, not drag-limited" is now true by construction rather than checked — `buildShipType`
rejects an overshoot ≤ 1, so the pre-2026-07-28 drag-limited bug is unreachable, for future ships too.

Verified: `tsc --noEmit` clean, 267/267 tests, all six captures reproduced by driving `integrateFlight`
directly (countering flat on every axis; main and retro aligned land essentially exactly on measurement),
and in the live app the 226 m/s reverse+boost stop now measures **4.62s** against the old ~1.3s.

### Original sketch (kept for provenance — superseded on the drag question)

The shape as understood before the derived-drag decision:

1. `core/types.ts` / `physics/ships/{rawShipType,buildShipType}.ts`: each boosted linear axis needs
   BOTH an aligned `(thrust, drag)` pair (real drag, governor-limited near its cap) AND a separate
   flat `counteringDecel` rate (no drag) — not just one shared `boostLinearThrust`/`boostLinearDrag`
   pair reused for both roles.
2. `physics/flightModel.ts`: needs to detect which role thrust is playing each tick — aligned (thrust
   direction matches current velocity direction, or starting from rest) vs. countering (thrust opposes
   an existing nonzero velocity component on that axis) — and pick the matching rate/drag pair. This
   is a real behavioral branch, not just new constants.
3. `gladius.ts` values, pending final rounding: main is untouched throughout (it was always only ever
   measured/used in the aligned role — braking an overspeed main-direction cruise isn't a normal
   maneuver the way countering retro/strafe/vertical is).
   - retro: aligned thrust ≈131 (drag ≈0.235), countering decel ≈55.5 (flat)
   - strafe: aligned thrust ≈287-290 (drag ≈0.45), countering decel ≈123.7 (flat)
   - up: aligned thrust ≈290-306 (drag ≈0.48), countering decel ≈123.1 (flat)
   - down: aligned thrust ≈130-170 (drag ≈0.26), countering decel ≈64.4 (flat)
4. `tests/shipTuning.test.ts`: the governor-vs-drag-limited invariant only applies to each axis's
   ALIGNED pair now (countering has no drag to be limited by, same as the unboosted axes never needing
   this check at all).

This is a bigger change than either of the two narrower proposals in §2 — worth confirming the
scope/design before writing code, not mid-implementation.
