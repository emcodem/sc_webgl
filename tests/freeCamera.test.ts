import { describe, it, expect } from 'vitest';
import * as FreeCamera from '../src/control/freeCamera';

// control/freeCamera.ts's WASD/mouse-look reactive paths need real DOM pointer-lock/keyboard
// events (via input/input.ts's initInput), which aren't available in this project's plain-node
// vitest environment — so this only covers what's exercisable without a DOM: the enable/disable
// lifecycle and the yaw/pitch basis math itself (Input.isDown()/isCaptured() safely default to
// false without initInput() ever running, so step() is a legitimate no-op-for-input here, not a
// workaround).

describe('free camera', () => {
  it('is inactive until enabled, active after, inactive again once disabled', () => {
    expect(FreeCamera.isActive()).toBe(false);
    FreeCamera.enable({ x: 0, y: 0, z: 0 });
    expect(FreeCamera.isActive()).toBe(true);
    FreeCamera.disable();
    expect(FreeCamera.isActive()).toBe(false);
  });

  it('seeds the eye at the given start position with a level, forward-facing basis', () => {
    FreeCamera.enable({ x: 10, y: 20, z: 30 });
    const view = FreeCamera.getView();
    expect(view.eye).toEqual({ x: 10, y: 20, z: 30 });
    expect(view.forward.x).toBeCloseTo(0, 5);
    expect(view.forward.y).toBeCloseTo(0, 5);
    expect(view.forward.z).toBeCloseTo(1, 5);
    expect(view.up.x).toBeCloseTo(0, 5);
    expect(view.up.y).toBeCloseTo(1, 5);
    expect(view.up.z).toBeCloseTo(0, 5);
  });

  it('forward/up stay unit-length and orthogonal', () => {
    FreeCamera.enable({ x: 0, y: 0, z: 0 });
    const { forward, up } = FreeCamera.getView();
    const lenF = Math.hypot(forward.x, forward.y, forward.z);
    const lenU = Math.hypot(up.x, up.y, up.z);
    const dot = forward.x * up.x + forward.y * up.y + forward.z * up.z;
    expect(lenF).toBeCloseTo(1, 5);
    expect(lenU).toBeCloseTo(1, 5);
    expect(dot).toBeCloseTo(0, 5);
  });

  it('does not drift with no keys held (movement vector correctly stays zero, not NaN)', () => {
    FreeCamera.enable({ x: 5, y: 5, z: 5 });
    FreeCamera.step(0.1);
    const view = FreeCamera.getView();
    expect(view.eye).toEqual({ x: 5, y: 5, z: 5 });
  });
});
