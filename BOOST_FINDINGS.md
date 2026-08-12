# Boost behaviour — findings & mitigation plan

**Date:** 2026-07-25
**Scope:** `src/physics/flightModel.ts` speed governor, `src/physics/ships/gladius.ts` boost constants.
**Status of everything below:** diagnosis complete and reproduced. **UPDATE 2026-07-25 (1):** §6 gaps
#2/#3 (boosted strafe/vertical thrust + boosted maneuvering cap) applied, per user go-ahead — see
§6/§7 for what changed. **UPDATE 2026-07-25 (2):** the §1/§3a/§3b overspeed-decay bug — user confirmed
it was STILL live (releasing boost while still holding throttle froze speed instead of decaying) —
is now also fixed, per explicit user direction: decay to scmSpeed always, regardless of held input,
unless boost is reactivated. This is a narrower, simpler fix than §0's real-SC-capture-driven
redesign (brake-continuously-to-zero at asymmetric per-direction rates) — it targets scmSpeed as the
floor using the existing naturalBleedRate formula, not the captured (single-rep, unrepeated) real
decay rates. See §8 for the fix and the boundary-condition bug it took two tries to get right. Gap #1
(pitch boost rate) remains unapplied — still needs a fresh capture. **UPDATE 2026-07-25 (3):** §9's
boost-meter rates — item 1's remaining three (`boostDrainRate`, `boostDrainRateRedZone`,
`boostRechargeRate`) — got a real frame-timestamped capture (see §9 below / `capture/MEASUREMENTS.md`
"Boost meter drain + recharge — frame-accurate capture") and applied. Headline: the whole two-rate
"red zone" premise looks fictional — drain and recharge each measure as a single uniform rate with no
kink at the red-zone boundary, so `gladius.ts` now sets each pair equal (~4.95%/s drain, ~2.51%/s
recharge), also superseding the stopwatched 1.923 red-zone-recharge correction from earlier today.

---

## 0. UPDATE 2026-07-25 — the real-SC decay was captured, and it overturns §3-5's framing

Live capture (INS Jericho AC map, Gladius, Coupled — see `capture/MEASUREMENTS.md` "Boosted
forward/retro linear thrust + boost-release decay"): **a full release does NOT decay down to
`scmSpeed` and coast there.** It brakes continuously straight through the SCM cap with no kink or
plateau anywhere near it, all the way to a dead stop at 0 m/s. That's Coupled flight-assist actively
canceling velocity on zero input — a different mechanism than an overspeed-specific governor. The
SCM cap turns out to be irrelevant to what happens on a full release; §1's original symptom #2
(thrust along the movement vector doing nothing while overspeed) is a **separate, still-untested**
case (held throttle while overspeed, not a full release) and may still be valid — this update only
overturns the *release* half of the story.

Measured decay is close to constant-rate (not drag/proportional-to-speed) after a brief faster
transient right at release, but the constant differs sharply by direction: **~55-60 m/s² forward**
(520→0 in ~8.5s, crossing 226 at ~4.1s) vs **~200-210 m/s² retro** (267→0 in ~2.0s) — retro brakes
~3.5x faster. Top speeds both confirmed close to coded (~520 fwd, ~267 back).

**§3's root-cause analysis of the sim's own bug (governor-cancels-thrust, coast/governor
double-count) still stands on its own terms** — those are real bugs in `integrateFlight` regardless
of what real SC does. But **§4's proposed fix aimed at the wrong target** (a governor that holds at
`scmSpeed`) — it needs rethinking against "Coupled brakes continuously to zero, direction-dependent
rate" before touching `flightModel.ts`. Single reps each direction so far, not yet repeated.

---

## 1. The reported symptom

Side-by-side-by-feel comparison against real SC surfaced two related complaints, both in the
**overspeed regime** (flying faster than `scmSpeed` while *not* boosting — i.e. immediately after
boost release):

1. Real SC "breaks the current movement vector" from boost speed down to normal speed on release.
   We had no measurement of how long that takes.
2. In real SC, applying thrust **along the current movement vector** while overspeed does
   **nothing** — the flight computer refuses it. In sc_webgl it does something.

Both turned out to be the same root cause, plus a second independent bug found alongside it.

---

## 2. Reproduction

Harness: drive `integrateFlight` directly with a pre-spooled Gladius at 520 m/s (boost top speed)
along `+z`, `boosting: false`, `dt = 1/120`, and measure time to reach the 226 m/s SCM cap.

| input | 520 → 226 | effective decel |
|---|---|---|
| coasting (`throttle = 0`) | **3.50 s** | ~84 m/s² |
| full forward (`throttle = 1`) | **never** — 513.8 m/s still at 12 s | ~0.5 m/s² |
| half forward (`throttle = 0.5`) | **identical trace to full forward** | ~0.5 m/s² |

The throttle 0.5 / 1.0 traces being byte-identical is the tell — see below.

---

## 3. Root causes

### 3a. The governor *cancels* thrust instead of overriding it

```ts
const naturalBleedRate = (forwardSpeed >= 0 ? t.linearThrust.retro : t.linearThrust.main) / t.mass;
const decelRate = Math.max(naturalBleedRate, accelAlongVel);
```

The intent (documented in the existing comment) was that the bleed must be "at least as strong as
whatever thrust is actively still feeding the overspeed," so thrust can't outrun the governor and
blow through the cap. It succeeds at that — but by construction it lands on *exactly* the thrust
magnitude, so the two terms annihilate: thrust adds `accelAlongVel * dt` to speed, the governor
removes `accelAlongVel * dt`, net ≈ 0.

Consequences:

- Speed **freezes** at the overspeed value for as long as any nonzero throttle is held.
- The freeze is **independent of throttle magnitude** (hence the identical traces) — any nonzero
  input is perfectly cancelled.
- The only thing still bleeding speed is `linearDrag = 0.001`, which is documented as negligible by
  design. Time to SCM becomes ~2 minutes.

This is the direct inverse of real SC: there, speed-increasing thrust is *ignored* and the decay
proceeds regardless. Here, thrust *suppresses* the decay.

### 3b. Coast and governor double-count while overspeed

With `throttle == 0`, the per-axis coast block sheds `retro / mass = 42 m/s²` from the longitudinal
component, and then — on the same tick, further down the function — the governor sheds another
42 m/s² from total speed. They stack to ~84 m/s², so coasting decays **2× too fast**.

Net effect of 3a + 3b together: the decay rate is wrong in *both* directions depending on throttle
(2× too fast coasting, ~0 under thrust), and there is no throttle position that produces the single
consistent rate the real game shows.

---

## 4. Proposed fix

Two changes, both inside `integrateFlight`. The principle: **the flight computer refuses
speed-increasing thrust while over cap, and exactly one authority owns the decay.**

**Step 1 — hoist the `speedCap` computation** above the thrust-integration line (it currently lives
in the governor block at the bottom; it depends only on `forward`, `body.boosting` and the ship
type, so it can move up freely).

**Step 2 — clip speed-increasing thrust before integrating velocity:**

```ts
// after `accel` is assembled, BEFORE body.vel += accel*dt
const spNow = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
if (spNow > speedCap) {
  const u = { x: body.vel.x / spNow, y: body.vel.y / spNow, z: body.vel.z / spNow };
  const along = accel.x * u.x + accel.y * u.y + accel.z * u.z;
  if (along > 0) {                 // flight computer refuses thrust that pushes further over cap
    accel.x -= u.x * along;
    accel.y -= u.y * along;
    accel.z -= u.z * along;
  }
}
```

Note this clips only the **component along velocity**. Off-axis thrust survives, so the pilot can
still steer and strafe during the bleed — which is what SC permits, and what makes the regime feel
alive rather than locked out.

**Step 3 — make the governor the sole decay authority:**

- In the governor, drop the `Math.max`: `const decelRate = naturalBleedRate;`
- Gate the drag / coast block on `speed <= speedCap` so it cannot stack with the governor.

Expected result: one consistent decay rate regardless of throttle, no freeze, no double-count.

---

## 5. The open measurement — RESOLVED 2026-07-25, see §0

**Captured** (`capture/MEASUREMENTS.md` "Boosted forward/retro linear thrust + boost-release decay").
Summary, see §0 above for the full reframing this causes:

- Forward: ~55-60 m/s² settled rate, 520→0 in ~8.5s, crosses 226 (SCM) at ~4.1s.
- Retro: ~200-210 m/s² settled rate, 267→0 in ~2.0s — ~3.5x faster than forward.
- **Decay does not stop/plateau at the SCM cap** — continues at the same rate straight through it to
  a full stop. This is the headline finding, not the exact numbers above.
- Not yet re-tested: whether holding throttle (not a full release) changes anything — that's the
  case §1's original symptom #2 was actually about, and is still open.

Single reps each direction — worth a repeat before treating the rate constants as final, though the
shape finding (no SCM-plateau) is unambiguous from the data already in hand (no kink anywhere near
226/225 in either trace).

---

## 6. Other boost gaps found (independent of the above)

Surfaced while auditing; each is separate from the overspeed bug.

> **Superseded numbers (2026-08-02):** the specific `boostLinearThrust`/`boostLinearDrag` values quoted
> in gap #2/#3 and §7 step 4 below no longer exist. Boosted linear thrust and drag are now DERIVED from
> three ratios, and every axis has two regimes (aligned vs countering) rather than one thrust value —
> see `RETRO.md` §8 and `physics/ships/linearInvariant.ts`. The *findings* recorded here still stand
> (boosted strafe/vertical needed implementing; the 394 maneuvering cap is real); only the constants
> they produced were replaced.

| # | Gap | Evidence | Severity |
|---|---|---|---|
| 1 | ~~`boostMaxAngVel.pitch = 1.431` rad/s (82 °/s) is a leftover uniform ×1.2, should drop to ratio 1.064 (≈68.92 °/s)~~ — **retracted, see note below.** | `MEASUREMENTS.md` "Pitch afterburner ratio — repeat reps" | **Unresolved** — needs re-measurement, not a known mismatch |
| 2 | ~~Boosted strafe/vertical not implemented.~~ **APPLIED 2026-07-25** (per user go-ahead). `flightModel.ts` now reads `t.boostLinearThrust.strafe`/`verticalUp`/`verticalDown` while `body.boosting`. | `physics/ships/gladius.ts` `boostLinearThrust`; `tests/shipTuning.test.ts` | Resolved |
| 3 | ~~The measured ~385 m/s boosted maneuvering cap doesn't exist in the model.~~ **APPLIED 2026-07-25.** New `ShipType.boostManeuveringSpeedCap` (385) governs the lateral+vertical (non-longitudinal) velocity component independently — the existing forward/back governor still only bounds the longitudinal component (520/268). Same bounded-bleed-rate shape, added as its own block in `flightModel.ts` right after the existing governor. | `physics/flightModel.ts`'s new maneuvering-cap block; `tests/shipTuning.test.ts`'s `boostManeuveringSpeedCap` tests | Resolved |
| 4 | Boost bypasses thruster spool entirely (`spooledUp = body.boosting \|\| ...`, same for vertical). The code comment admits no data supports this. A standing-start boost reaches full thrust in one tick. | `flightModel.ts` spool block | Low — unverified assumption, not a known mismatch |
| 5 | ~~Lateral/vertical thrust used its full rate regardless of current forward speed — strafing while flying fast gave far more strafe than real SC, both boosted (near top speed) and, less obviously, unboosted (only reachable by coasting above scmSpeed on residual boost momentum).~~ **APPLIED 2026-08-04** (rough estimate, per user go-ahead) — two DIFFERENT taper shapes, not one formula with a swapped reference: boosted tapers across its whole 0..boostSpeedForward range, unboosted stays full up to scmSpeed and only tapers once coasting above it. See `MEASUREMENTS.md`'s "Boosted lateral/vertical authority vs. current forward speed" section and `flightModel.ts`'s `lateralSpeedAuthority`. | `physics/flightModel.ts`'s `lateralSpeedAuthority`; `tests/shipTuning.test.ts`'s "lateral/vertical thrust authority tapers with forward speed" | Resolved (rough fit — flagged for re-derivation against cleaner captures) |

**Retraction note on gap #1 (added 2026-07-25):** the 68.92 °/s / 1.064 ratio is the boosted
**pitch-DOWN** short-hold reading (0.7s/0.15s dwell/ramp) — not a full 360° turn. The same
`MEASUREMENTS.md` session found that the analogous **pitch-UP** short-hold reps (66.98/62.49 °/s)
badly under-read: a proper 4.4s full-360 test (long enough to clear any plausible spool time)
recovered ~77-89 °/s, consistent with the coded 82 °/s (1.2×), directly contradicting the
short-hold number for that direction. The DOWN direction's own 360 cross-check does land close to
68.92 (67.82-69.94) — but the doc explicitly calls that agreement **possibly coincidental, not
proof the dwell was long enough**, and flags it as needing a skeptical re-check. So the one
direction that *was* properly validated (UP) supports the coded 1.2×, not the correction gap #1
proposed.

**Fuller picture, found 2026-07-25 in the same `MEASUREMENTS.md` (missed on first pass, dated
2026-07-23 — pre-dates this session but wasn't surfaced by the initial grep):** a more rigorous
method than either short-hold or 360-test already exists and already ran on pitch-boosted — fitting
the WHOLE spool-up rise curve to a 2nd-order underdamped step response (found to fit 2-4x better
than the coded 1st-order lag, across pitch/yaw/boosted/non-boosted alike) recovers **rate_ss =
75.75°/s** for boosted pitch — much closer to the coded 82°/s than either the short-hold snapshot
(66.98/62.49) or the raw 360-test's wider bracket (77-89), and the doc treats this as resolving the
question for that direction. Not clear from the text which direction (UP/DOWN) that fit used —
likely DOWN, matching this whole dataset's default convention.

**UPDATE 2026-07-25 (later same day): the missing UP-direction capture is done, and it built a
reusable fit tool (`analysis/fit_spool_response.py`) — but that tool surfaced a real problem with
the 2nd-order fitting method itself, not just a missing data point.** Re-running the new tool against
the SAME already-recorded DOWN-boosted clip that produced the rate_ss=75.75/ωₙ=8.009/ζ=0.916 numbers
above does NOT reproduce them: fitting the raw rate curve degenerates to a near-critically-damped,
poor-RMS solution, and an angle-domain fit (numerically stable) goes blind to the very overshoot that
would distinguish 1st- from 2nd-order dynamics. Neither approach reliably recovers ωₙ/ζ on this short
a window. What IS solid (model-free, directly observed peak rate within the rise window): **DOWN
69.94°/s at t=0.305s, UP 76.23°/s at t=0.405s** — UP's peak sits closer to the API's 82°/s than DOWN's
does, consistent with (though not an independent re-confirmation of) the existing conclusion that
boosted-UP's short-hold reps under-read. See `MEASUREMENTS.md`'s "Pitch UP boosted spool-up rise
curve" section for the full writeup, including the now-disputed status of the original four-condition
ωₙ/ζ table. **Practical effect on gap #1: still unresolved, and now more clearly so** — the rate_ss
values in play (69.94-76.23 depending on direction/method) remain below the coded uniform ×1.2
(82°/s), same qualitative conclusion as before, but a trustworthy ωₙ/ζ characterization needs a
better fitting method (most likely a longer dwell capturing a full oscillation) before any
`flightModel.ts` change is warranted.

**UPDATE 2026-07-26: the "better fitting method" from the line above turned out to be exactly that —
a longer dwell, not a different fitting approach.** Re-captured pitch UP boosted at `--dwell 1.1`
(vs the original 0.55), long enough to show a full overshoot-THEN-undershoot cycle before the
landmark exits frame. Fit against the pre-contamination window: **rate_ss=76.69°/s, ωₙ=8.135 rad/s,
ζ=0.714, RMS 0.138° (2nd-order) vs 0.506° (1st-order)** — ωₙ lands right inside the original
four-condition table's ~8.0-8.6 rad/s range and the RMS ratio (~3.7×) matches its "2-4× better"
claim. This is fairly strong evidence the *original* 2026-07-23 fits (rate_ss=75.75 for DOWN
included) were sound, and this session's earlier short-window failures were the real anomaly, not a
flaw in the original method. `fit_spool_response.py` gained two options to support this:
`--trim-end` (cut the window before frame-edge/lost-lock contamination sets in — watch
`peak_brightness` for an abrupt swing away from its steady baseline) and `--t0` (manual override
when the auto-alignment's correlation search gets unreliable on a longer, noisier trace — its
`align_corr` visibly drops from the ~0.95+ seen on short clean captures).

**UPDATE 2026-07-26 (later same day): DOWN redone at the same matching longer dwell.** Result:
**rate_ss=70.15°/s, ωₙ=8.283 rad/s, ζ=0.820, RMS 0.131° (2nd-order) vs 0.527° (1st-order, ~4.0×)** —
found via a `--trim-end` sweep (0.55→0.98s) that showed ωₙ staying stable (8.2-8.6 rad/s) across the
whole clean range while ζ climbs out of the same degenerate 0.999-pinned boundary UP's short-window
attempts hit, only escaping it once trim_end exceeds ~0.75s; RMS jumps sharply past trim_end=0.90-0.92,
marking where a real (not tracking-artifact — `peak_brightness` stays clean throughout) rate collapse
starts. **UP vs DOWN, both via the identical method: ωₙ agrees within ~2% (8.14 vs 8.28, both inside
the original ~8.0-8.6 range) — good cross-validation of the shared-natural-frequency claim. rate_ss
is ~9% higher for UP (76.69 vs 70.15), same direction as the already-documented small UP-faster-than-
DOWN asymmetry. ζ is meaningfully higher for DOWN (0.82 vs 0.71) — DOWN is more damped — a new
finding, single rep each direction.** **Gap #1 status: BOTH pitch directions now resolved to the same
standard. Yaw and non-boosted-pitch rows still haven't been re-captured at a matching longer dwell** —
treat those as *plausible given this cross-check, not independently re-confirmed* until someone does.

**⚠ UPDATE 2026-07-26 (later same night): a bigger, previously-untracked confound found — engine
power allocation.** A 360°-sustained-hold test (independent of the spool-up fit method above) found
that boosted pitch reads almost exactly the coded 82°/s (0.166° residual after 2 full laps) **only
when the power triangle is set to full power to engines** — the same test at whatever power
allocation was the session default read ~7-9°/s slower. Power allocation was never controlled for or
recorded in ANY capture session before this, including both rate_ss fits above (76.69 UP, 70.15
DOWN). **This means gap #1 is open again, in a different way than before: the UP/DOWN rate_ss values
above may simply reflect non-full engine power, not a real sub-coded afterburner effect.** See
`capture/MEASUREMENTS.md`'s new "⚠ CRITICAL: power triangle allocation" section and "Pitch UP
boosted, full engine power" for the full data. `capture/settings_checklist.md` now mandates
confirming full engine power before every capture, the same way Coupled mode already was. Next real
step for gap #1: re-run the spool-up rise-curve captures (both directions) with engine power
confirmed full, since the existing rate_ss=70-77°/s numbers can no longer be trusted at face value.

---

## 7. Plan, in order

1. ~~Go/no-go on §4~~ — **superseded, see §0.** §4's fix targeted the wrong mechanism (an
   SCM-cap governor); real data shows Coupled brakes continuously to zero regardless of the cap, at
   a direction-dependent constant rate. Needs a redesigned fix proposal before any go/no-go is
   meaningful — likely: model this as Coupled auto-brake-to-zero-relative-velocity with per-direction
   rates, decoupled entirely from the SCM-cap logic, plus separately re-test whether *held* overspeed
   thrust still misbehaves (§1's symptom #2, untested by this capture).
2. ~~Capture the boost-release decay~~ — **done, see §0/§5.** A repeat rep each direction would
   still help before the rate constants are treated as final.
3. ~~Apply gap #1 (pitch boost rate)~~ — **retracted (see §6 note); not a data edit anymore.**
   Needs a full-360 capture in both pitch directions (mirroring the UP-direction fix method)
   before any conclusion, let alone a code change, is warranted.
4. ~~Apply gaps #2 and #3 together~~ — **done, 2026-07-25.** Boosted strafe/vertical thrust
   (`boostLinearThrust.strafe`/`verticalUp`/`verticalDown`, converting the measured ~127 m/s²
   accel to thrust units, `verticalDown` kept at half `verticalUp` per the unboosted ratio) plus the
   new `boostManeuveringSpeedCap` (385) governing the lateral+vertical velocity component
   independently of the existing forward/back governor. Guarded by new tests in
   `tests/shipTuning.test.ts`; full suite (189 tests) and `tsc --noEmit` both pass.
5. **Gap #4** — leave alone until there's data. Note it as an explicit assumption rather than fixing
   it blind.

### Suggested sequencing note

Step 3 no longer offers an independent quick win — it's now a capture task like step 2, not a data
edit. Step 4's boosted cap interacts with step 1's governor rewrite (both touch the same block), so
do them in that order, not in parallel.

---

## 8. Overspeed-decay fix (2026-07-25) — narrower than §0's redesign, per explicit user direction

User confirmed the original bug was still live in the running app: releasing boost while still
holding throttle kept speed frozen at the overspeed value instead of decaying. Rather than chase
§0's real-SC-capture-driven model (Coupled brakes continuously to zero at asymmetric per-direction
rates — still only a single, unrepeated rep each direction), the user specified the desired behavior
directly: **speed must always decay back to scmSpeed once boost is released, regardless of what
input is held, unless boost is reactivated.** That's a well-specified, self-contained fix, so it was
applied without waiting on further capture.

Three changes to `physics/flightModel.ts`, all guarded by new tests in `tests/shipTuning.test.ts`:

1. **Clip speed-increasing thrust before integrating velocity** (§4 Step 2, as originally proposed):
   right after `accel` is assembled, if current speed is at/above the cap, remove only the component
   of `accel` along the current velocity direction. Off-axis (steering/strafing) thrust is untouched,
   so the pilot isn't locked out of maneuvering during the bleed.
2. **Governor is now the sole decay authority** (§4 Step 3): dropped the old
   `Math.max(naturalBleedRate, accelAlongVel)` — since thrust along velocity is already clipped to a
   no-op, `decelRate` is always just `naturalBleedRate`. This directly fixes 3a (thrust no longer
   cancels its own bleed).
3. **Coast/drag gated off above cap**, fixing the double-count in 3b — but gated on **strict `<`**,
   not `<=`. This mattered: an early version used `<=` and produced an infinite oscillation (traced
   with a throwaway debug test) — at velocity sitting *exactly* on the cap, the clip's `>=` trigger
   and the gate's `<=` trigger both fired the same tick, so coast/drag's full boosted drag rate still
   yanked speed down even though thrust was already clipped, then full unclipped thrust shot back over
   the cap next tick, forever cycling between the cap and a few m/s above it instead of settling. The
   fix: coast/drag must stay off at the exact boundary too (`<`), so that sitting precisely on the cap
   leaves velocity untouched by all three mechanisms (clip, coast/drag, governor) — a genuine stable
   equilibrium, not a limit cycle.

Deliberately NOT applying §0's asymmetric real-SC decay rates (~57 m/s² fwd / ~205 m/s² retro,
brake-to-zero past the cap) — this fix keeps the existing `naturalBleedRate` formula (unboosted
retro/main thrust ÷ mass) and targets `scmSpeed` as the floor, which is simpler, already
partially-tested, and matches what the user actually asked for. If real-SC fidelity to the exact decay
shape/rate ever matters, that's still open per §0/§5 and would need repeat capture reps first.

---

## 9. Boost-meter drain/recharge rates — RESOLVED 2026-07-25 with a frame-timestamped capture

**Resolution, see full data in `capture/MEASUREMENTS.md`'s "Boost meter drain + recharge —
frame-accurate capture":** a proper capture (`capture/boost_meter_capture.py`, a continuous
drain-then-recharge OBS clip, read via `analysis/montage_speed.py` against the "AB %" HUD number)
found the two-rate "red zone" model doesn't hold for either drain or recharge — both trace a single
uniform rate end to end, no kink at `boostRedZonePct`. Applied to `gladius.ts`:
`boostDrainRate = boostDrainRateRedZone ≈ 4.95 %/s`, `boostRechargeRate = boostRechargeRateRedZone ≈
2.51 %/s`. This also supersedes the stopwatched 1.923 %/s red-zone-recharge correction below (§9's
original finding) — that stopwatch reading is now believed to have been ordinary reaction-time error
on the same true ~2.51%/s rate, not a real asymmetry. `boostReactivatePct` and
`boostRechargeDelaySec` are unaffected (still real, separate mechanics). Rep counts: drain 2 (close
agreement), recharge 1 (dense-sampled, clean) — the original text below is kept for provenance.

### 9a. Original finding (2026-07-25, superseded by the above) — provenance now DISPUTED, re-measurement pending

User separately reported the boost meter's red-zone recovery (`boostRechargeRateRedZone` / 62.5 %/s
— climbs 0%→25% in ~0.4s) as feeling wrong in play: from 10%, just holding boost continuously climbs
back above the 26% reactivation floor and re-engages boost in well under half a second. Traced this
directly against `resolveBoost` (a throwaway debug test) and confirmed the live behavior does exactly
match the coded constant — so this isn't an implementation bug, it's the ORIGINAL measurement itself
that's now in question.

That number was ported from the original project's `shipTypes.ts` (a hand-stopwatched/frame-counted
reading against the boost gauge, predating this repo's `capture/` toolchain entirely). User's
explanation: **that capture only achieved a few real frames per second, and this went unnoticed at
the time** — i.e., the frame count used to derive "10 frames = 0.4s" likely assumed a nominal frame
rate the capture never actually achieved, the same class of error this project's `capture/` toolchain
was built to eliminate (see `capture/README.md`'s "Capture backend performance" table: some backends
only achieve ~16-19fps against a 60fps request). **Needs a fresh, frame-timestamp-verified capture
before `boostRechargeRateRedZone` (or `boostDrainRateRedZone`, `boostRechargeRate`, `boostDrainRate` —
none of the boost-meter two-rate model has been re-verified with this project's own tooling) can be
trusted or corrected.**

While investigating, found and fixed a live instance of the SAME class of bug in this repo's own
toolchain: `capture/analysis/montage_speed.py` (used to read HUD numbers like speed off a montage of
sampled frames) was burning in `t = idx / fps` — an ASSUMED uniform frame rate — while the other three
analysis scripts (`track_landmark.py`, `track_orientation.py`, `track_vjoy_indicator.py`) all
correctly read each frame's REAL `CAP_PROP_POS_MSEC` timestamp, exactly because this project's capture
backends can drop/duplicate frames non-uniformly. Fixed to match (2026-07-25) — so a future
boost-meter recapture using this tool (pointed at the boost gauge instead of the speed readout) won't
silently repeat the same mistake that's now in question for the original number.

**UPDATE 2026-07-25:** user re-timed it — real SC takes **~13 seconds** for 0%→25% (stopwatched, single
approximate rep, not yet frame-verified with this project's own tooling). `boostRechargeRateRedZone`
corrected from 62.5 to 25/13 ≈ **1.923 %/s** (`gladius.ts`, `tests/shipTuning.test.ts`,
`capture/MEASUREMENTS.md`). This is ~32x slower than the superseded value and now makes red-zone
recharge SLOWER than the still-unverified above-red-zone `boostRechargeRate` (2.8846) — the opposite
of the two-rate model's original "red zone is faster" premise. Not yet resolved whether that's a real
asymmetry in real SC or `boostRechargeRate` is *also* wrong from the same flawed parent-project
capture. `boostDrainRate`, `boostDrainRateRedZone`, and `boostRechargeRate` remain unverified — only
the red-zone recharge rate has a real-world re-check so far.
