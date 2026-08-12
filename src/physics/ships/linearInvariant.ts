import type { ShipType } from '../../core/types';

// Shared per-axis LINEAR helpers — the counterpart of angularInvariant.ts, kept in ONE place for the
// same reason: so buildShipType.ts (raw → ShipType) can't drift from anything else that needs to know
// how the boosted-linear values come off their primitives. These ARE the mechanism that keeps the
// load-bearing boost invariants true by construction (see buildShipType.ts, tests/shipTuning.test.ts):
//
//   boostLinearThrust  == linearThrust * boostThrustMultiplier          (ALIGNED role — has drag)
//   boostCounterThrust == linearThrust * boostCounterMultiplier         (COUNTERING role — flat)
//   boostLinearDrag    == boostLinearThrust / (mass * boostGovernorOvershoot * that axis's cap)
//
// The point of deriving all three (rather than authoring them, as this project did until 2026-08-02)
// is that a new ship should only need quantities you can actually look up or measure — mass, thruster
// strength, top speeds — not a fitted drag coefficient with no independent meaning. Two properties
// fall out of the drag derivation specifically:
//
//   - The natural asymptote is `boostGovernorOvershoot * cap`, INDEPENDENT of mass and thrust
//     (thrust/(drag*mass) cancels both). So retuning mass rescales acceleration without disturbing any
//     top-speed behaviour, and entering a new cap is enough to make that cap real.
//   - "Boost is governor-limited, not drag-limited" becomes structural instead of a checked
//     coincidence: the asymptote always clears the cap as long as the overshoot ratio is > 1. That
//     invariant was silently violated once already — before 2026-07-28 the authored strafe/vertical
//     numbers settled at ~334 m/s against a 394 cap, making the cap decorative. It cannot recur here.
export type LinearAxes = ShipType['linearThrust'];

export function scaleLinearThrust(linearThrust: LinearAxes, scale: number): LinearAxes {
  return {
    main: linearThrust.main * scale,
    retro: linearThrust.retro * scale,
    strafe: linearThrust.strafe * scale,
    verticalUp: linearThrust.verticalUp * scale,
    verticalDown: linearThrust.verticalDown * scale
  };
}

// Per-axis proportional drag that puts each axis's thrust/drag equilibrium exactly `overshoot` times
// its OWN speed cap. Each axis is paired with the cap that actually governs it in flightModel.ts:
// main → boostSpeedForward, retro → boostSpeedBack, strafe/vertical → boostManeuveringSpeedCap (the
// lateral+vertical component has its own separate, lower governor — see that file's second governor
// block). Using per-axis caps is what lets main's asymptote clear its 520 while the maneuvering axes
// settle near 440, from one shared ratio.
export function boostDragFromCaps(
  boostLinearThrust: LinearAxes,
  mass: number,
  overshoot: number,
  caps: { boostSpeedForward: number; boostSpeedBack: number; boostManeuveringSpeedCap: number }
): LinearAxes {
  const drag = (thrust: number, cap: number) => thrust / (mass * overshoot * cap);
  return {
    main: drag(boostLinearThrust.main, caps.boostSpeedForward),
    retro: drag(boostLinearThrust.retro, caps.boostSpeedBack),
    strafe: drag(boostLinearThrust.strafe, caps.boostManeuveringSpeedCap),
    verticalUp: drag(boostLinearThrust.verticalUp, caps.boostManeuveringSpeedCap),
    verticalDown: drag(boostLinearThrust.verticalDown, caps.boostManeuveringSpeedCap)
  };
}
