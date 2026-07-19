# In-game settings checklist

Lock these in before any capture session and record the actual values in each trial's `meta.json`
(the analysis pipeline needs the FOV/resolution to convert pixels to angles):

- [ ] **Field of view** — note the exact horizontal FOV in degrees (Options > Graphics). Do not
      change it between trials in the same dataset.
- [ ] **Display resolution + window mode** — borderless windowed recommended over exclusive
      fullscreen. Note: the sync-flash overlay `orchestrate.py` draws does NOT actually render over
      Star Citizen regardless of window mode (its swapchain paints over "always on top" windows) --
      `orchestrate.py` automatically falls back to motion-onset sync instead (see README's "Sync
      mechanism"). Borderless is still recommended generally (screenshots, alt-tab behavior).
- [ ] **Motion blur — off.** Blurs the tracked landmark and biases centroid tracking.
- [ ] **Camera shake / G-force shake — off.** Adds noise to the tracked landmark's pixel position
      that has nothing to do with the ship's actual rotation.
- [ ] **Frame rate cap / vsync** — set a fixed cap (match the recording's target fps) so `dt` per
      frame is consistent; avoid uncapped/variable frame rate.
- [ ] **HUD scale / elements** — keep whatever HUD element you're tracking (if using a heading/pitch
      ladder tick instead of a star) at a consistent scale and unobstructed.
- [ ] **Control bindings** — all 6 axes (yaw/pitch/roll/strafe_lateral/strafe_vertical/
      strafe_longitudinal) bound to vJoy via `feeder/bind_helper.py` (see README's "Binding vJoy
      axes in Star Citizen") — and the rebind actually **saved** (SC keeps edits in memory until an
      explicit save/apply, see README).
- [ ] **Control profile active** — `python profiles/switch_profile.py status` reports `vjoy`, not
      `original` or unknown/custom. Restart SC after switching if it hasn't picked up the change.
- [ ] **Landmark chosen** — see README's "Choosing a landmark to track" (avoid screen-center/reticle,
      avoid dark objects like planets/moons, prefer a bright high-contrast marking).
- [ ] **Location** — private Arena Commander / free-flight instance, not the shared live PU.
- [ ] **Ship** — Gladius, to match the existing measured data in `shipTypes.ts` (any ship is fine for
      just validating the pipeline mechanism itself, as done during this toolchain's development).
- [ ] **Coupled mode ON (flight assist), not Decoupled.** `shipTypes.ts`/`flightModel.ts` are a
      coupled-flight model (see `shipTypes.ts`'s "no throttle/strafe input at all in coupled mode"
      note) — Decoupled has fundamentally different dynamics and produces data that's not
      comparable at all, not just noisier. Confirmed the hard way: an entire yaw dataset had to be
      discarded because Decoupled was active throughout (see `BLUEPRINT.md`'s Gotchas). Verify in
      the in-game flight-mode indicator (or toggle and watch it) immediately before every session --
      don't trust `USER\Client\0\Profiles\default\attributes.xml`'s `IFCS_Setting_CoupledEnabled`
      for this, its write timing relative to a live in-flight toggle isn't confirmed reliable.
