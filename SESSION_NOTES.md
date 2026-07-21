# Session notes — mouse/vjoy input-curve matching

Running dev journal for the "make sc_webgl's mouse-flight feel match real SC" investigation. Written
for a fresh session with no prior context — read this first, then `capture/MEASUREMENTS.md`'s
"STATUS / RESUME HERE" for the underlying measurement details.

## 2026-07-21

**Starting point:** harald reported the mouse input curve doesn't reproduce real SC's flying
behavior — small mouse inputs moved the ship much more than in real SC.

**What we did:**
1. Reviewed the existing `capture/` toolchain (built for exactly this: OBS + scripted mouse/vJoy
   input against real SC). Found `analysis/hold_rate.py` was still using a crude linear pixel→angle
   conversion instead of the arctan projection `angle_convert.py` already had — fixed.
2. Built `curve_sweep_capture.py` (denser magnitude sweep, one-directional probes for the high end)
   and `analysis/fit_curve.py` (fits both the old power-law shape and a saturating Kumaraswamy shape).
3. Ran a real capture session at Security Post Kareah (yaw + pitch, 1200-2100 mouse counts,
   2 reps each). Yaw data came back clean (corr 0.96-0.98). **Pitch data was contaminated** — the
   landmark (a beacon on the station's own mast) got dragged through the mast structure when swept
   vertically, causing a real lost-lock artifact (confirmed frame-by-frame: brightness drop + tracked
   position reversing direction exactly when the fast motion started). Not real ship behavior.
4. **Key finding:** combining this session's clean yaw data (1200-2100) with the older 150-600 sweep,
   the real input curve **saturates by ~1500 mouse counts at ~51.4 °/s** — nowhere near the ~168 °/s
   the old sparse fit (150-600 only, no saturation anchor) extrapolated to. Fitted shape is close to
   **linear** (`exponent ≈ 1.04`, not the old 1.48) with a hard ceiling at `full_range ≈ 1500` counts.
   The old 1.48 was an artifact of fitting a rising curve with no ceiling in the data.
5. **Pitch was extrapolated, not re-shot** — harald's call, and it checked out: yaw's shape rescaled
   by pitch's own known max (61.3 °/s unboosted) predicts the plateau at 1500 counts ≈ 61.4 °/s,
   matching the independently-measured value almost exactly. Same input curve, different per-axis
   max rate (already handled by `flightModel.ts`/`shipTypes.ts`) — no pitch-specific tuning needed.
6. **Bigger bug found along the way:** `mouseLook.ts`'s `range` was modeled as "degrees of screen
   visual angle for full deflection" (FOV/viewport-derived) — a resolution-dependent concept real SC
   doesn't have at all (its mouse vjoy accumulates raw, resolution-independent mouse counts directly).
   That model needed only ~136-272px of physical mouse travel for full deflection vs. the measured
   ~1500 counts — a 5-18× gain mismatch, independent of curve shape, and likely the dominant cause of
   "small input moves too much."
7. **Naming correction (harald caught this):** don't call the raw-count gain constant "VJoy Range" —
   that name is reserved for SC's own `VJoyAnglePilots` setting, which is confirmed **cosmetic-only**
   (changes the on-screen indicator's travel, zero flight effect). Renamed the gain constant to
   `fullDeflectionCounts`; added a *separate*, genuinely cosmetic `indicatorSizePercent` (mirrors SC's
   VJoy Range units) so the on-screen indicator can be dialed to visually match SC's for side-by-side
   comparison, decoupled from the actual flight-relevant gain.
8. **HUD bug found and fixed:** the vjoy reticle was drawn at the *raw* pixel offset instead of a
   normalized ratio — harmless under the old small FOV-derived range, but sent the marker off-screen
   once `range` could be in the thousands. Now scales `offset/max` to a fixed cosmetic radius.

**Code changes this session:**
- `src/input/axisCurve.ts` — `DEFAULT_EXPONENT` 1.48 → 1.04
- `src/input/mouseLook.ts` — `range` (degrees) → `fullDeflectionCounts` (raw mouse counts, default
  1500), FOV/viewport dependency removed; added `indicatorSizePercent` (cosmetic, default 100)
- `src/hud/hud.ts` — vjoy reticle now normalizes by `max` before scaling to a fixed on-screen radius
  (`indicatorSizePercent`-controlled), instead of drawing raw pixel offsets
- `src/ui/controlsPanel/mouseSettingsUI.ts`, `index.html` — F4 slider relabeled/rebounded (300-3000
  counts) for the gain; new slider added for the cosmetic indicator size (0-100%)
- `tests/axisCurve.test.ts` — updated default-exponent assertion to 1.04
- `capture/analysis/hold_rate.py` — arctan projection fix (was using the crude linear one)
- `capture/curve_sweep_capture.py`, `capture/analysis/fit_curve.py` — new tools (see their docstrings)
- `capture/MEASUREMENTS.md`, `capture/README.md` — updated with the fitted numbers and the gain finding

`npm test` (180/180) and `tsc --noEmit` clean throughout.

**Where we are (end of day):** Tested live in the browser via the remote-mouse comparison tool
(same physical mouse driving real SC directly + relayed into sc_webgl's vjoy simultaneously).
Full-deflection yaw/pitch now *feels* roughly the same between the two. Using the same tool, harald
measured the two games' inputs as "relatively close, about 80%" — not yet re-verified whether that
80% was confounded by the indicator-size mismatch (now fixed) or reflects a real gain gap; needs a
fresh read tomorrow with matched indicator sizes before acting on it.

**Latest insight, not yet investigated — the important one to start with tomorrow:** harald noticed
that while full yaw/pitch deflection feels the same, **the transition when releasing the stick from
full deflection back to zero does NOT match between SC and sc_webgl.** This matters beyond just that
one transition: *it makes it impossible to currently judge whether "slow flying" (small-input) feel
matches*, since any observed mismatch at low input could be this release-transient behaving
differently rather than a real curve/deadzone problem near center. Need to pin this down BEFORE
trusting any further small-input comparison.

Open questions to start with:
- Is "returning the vjoy to zero" here about the *input* layer (does our stick's offsetX/Y decay back
  to 0 the same way SC's does for the same released mouse motion — e.g. is there any smoothing/lag we
  apply that SC doesn't, or vice versa), or about the *flight model's* response to a fast release
  (recall the roll transient findings in `capture/BLUEPRINT.md`: spool-up looked drag-like but
  release-decel looked governor-like/hard-stop — an analogous asymmetry might apply to yaw/pitch)?
- Does `recenter()` (the V-key hard reset) factor into what harald was testing, or was this purely
  "let go of the mouse, watch it walk back to center via reverse mouse motion"? SC's own vjoy holds a
  deflection with no input (confirmed, `MEASUREMENTS.md`) — so "returning to zero" implies the mouse
  was actively moved back, not a passive decay. Worth clarifying instead of guessing which of the two
  it is.

**Not yet acted on:** a full-360°-yaw-turn feels slightly slower in sc_webgl than SC — parked,
lower priority than the release-transient question above.
