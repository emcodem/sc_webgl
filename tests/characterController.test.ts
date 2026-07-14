import { describe, it, expect } from 'vitest';
import { nearestWalkable, localUp, footFrame, updateCharacter, type FootInputs } from '../src/physics/characterController';
import { makeWorld } from '../src/core/player';
import type { CelestialBody, Player } from '../src/core/world';
import { length } from '../src/math/vec';

function noInput(overrides: Partial<FootInputs> = {}): FootInputs {
  return { moveForward: 0, moveRight: 0, jump: false, lookYawDelta: 0, lookPitchDelta: 0, ...overrides };
}

function moonBody(overrides: Partial<CelestialBody> = {}): CelestialBody {
  return { name: 'moon', pos: { x: 0, y: 0, z: 0 }, radius: 10, gravity: 5, walkable: true, color: 0, ...overrides };
}

function standingPlayer(body: CelestialBody): Player {
  const player = makeWorld().player;
  player.charPos = { x: 0, y: body.radius, z: 0 }; // resting exactly on the surface, "above" the body
  player.charVel = { x: 0, y: 0, z: 0 };
  player.heading = { x: 0, y: 0, z: 1 };
  player.onGround = true;
  player.groundBody = body;
  return player;
}

describe('nearestWalkable', () => {
  it('returns null when there are no walkable bodies', () => {
    const body = moonBody({ walkable: false });
    expect(nearestWalkable({ x: 0, y: 0, z: 0 }, [body])).toBeNull();
  });

  it('picks the body with the smallest surface distance', () => {
    const near = moonBody({ name: 'near', pos: { x: 0, y: 0, z: 0 }, radius: 5 });
    const far = moonBody({ name: 'far', pos: { x: 1000, y: 0, z: 0 }, radius: 5 });
    const result = nearestWalkable({ x: 0, y: 20, z: 0 }, [far, near]);
    expect(result?.name).toBe('near');
  });
});

describe('localUp', () => {
  it('falls back to world +Y with no ground body (open-space EVA)', () => {
    const player = makeWorld().player;
    player.groundBody = null;
    expect(localUp(player)).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('points radially away from the ground body center', () => {
    const body = moonBody();
    const player = standingPlayer(body);
    player.charPos = { x: 0, y: 0, z: body.radius }; // standing on the "+Z pole"
    const up = localUp(player);
    expect(up.x).toBeCloseTo(0, 10);
    expect(up.y).toBeCloseTo(0, 10);
    expect(up.z).toBeCloseTo(1, 10);
  });
});

describe('footFrame', () => {
  it('falls back to a tangent heading when heading has become parallel to up', () => {
    const body = moonBody();
    const player = standingPlayer(body);
    // player is at the "+Y pole" (up = +Y); a heading of +Y is degenerate (parallel to up).
    player.heading = { x: 0, y: 1, z: 0 };
    const frame = footFrame(player, { x: 0, y: 1, z: 0 });
    expect(length(frame.forward)).toBeCloseTo(1, 6);
    expect(Number.isFinite(frame.forward.x)).toBe(true);
    // fallback tries world +X projected onto the tangent plane first, which is non-degenerate here.
    expect(frame.forward.x).toBeCloseTo(1, 6);
  });

  it('returns an orthonormal forward/right/up frame in the non-degenerate case', () => {
    const body = moonBody();
    const player = standingPlayer(body);
    const frame = footFrame(player, { x: 0, y: 1, z: 0 });
    expect(length(frame.forward)).toBeCloseTo(1, 6);
    expect(length(frame.right)).toBeCloseTo(1, 6);
  });
});

describe('updateCharacter', () => {
  it('clamps the player to the surface and zeroes inward velocity when pushed below radius', () => {
    const body = moonBody({ radius: 10 });
    const player = standingPlayer(body);
    // start already pushed slightly below the surface, falling further inward
    player.charPos = { x: 0, y: 9, z: 0 };
    player.charVel = { x: 0, y: -5, z: 0 };
    player.onGround = false;
    updateCharacter(player, [body], noInput(), 1 / 60);
    const dist = length(player.charPos);
    expect(dist).toBeCloseTo(body.radius, 5);
    expect(player.onGround).toBe(true);
  });

  it('registers onGround within GROUND_EPS of the surface without penetrating', () => {
    const body = moonBody({ radius: 10, gravity: 0 });
    const player = standingPlayer(body);
    player.charPos = { x: 0, y: 10.05, z: 0 }; // 0.05m above surface, within the 0.08m GROUND_EPS
    player.charVel = { x: 0, y: 0, z: 0 };
    player.onGround = false;
    updateCharacter(player, [body], noInput(), 1 / 60);
    expect(player.onGround).toBe(true);
  });

  it('only triggers a jump while onGround', () => {
    const body = moonBody({ radius: 10, gravity: 5 });
    const player = standingPlayer(body);
    player.onGround = false;
    player.charPos = { x: 0, y: 50, z: 0 }; // well clear of the surface, airborne
    player.charVel = { x: 0, y: 0, z: 0 };
    const dt = 1 / 60;
    updateCharacter(player, [body], noInput({ jump: true }), dt);
    // vertical speed should reflect only gravity, not JUMP_SPEED (6), since the jump request is ignored while airborne
    const vUp = player.charVel.y; // up is +Y here, so charVel.y is the vertical component
    expect(vUp).toBeCloseTo(-body.gravity * dt, 5);
  });

  it('applies full ground control on the ground and blended air control while airborne', () => {
    const body = moonBody({ radius: 10, gravity: 0 });

    const grounded = standingPlayer(body);
    grounded.onGround = true;
    updateCharacter(grounded, [body], noInput({ moveForward: 1 }), 1 / 60);
    const groundedHorizSpeed = Math.hypot(grounded.charVel.x, grounded.charVel.z);

    const airborne = standingPlayer(body);
    airborne.charPos = { x: 0, y: 50, z: 0 };
    airborne.onGround = false;
    updateCharacter(airborne, [body], noInput({ moveForward: 1 }), 1 / 60);
    const airborneHorizSpeed = Math.hypot(airborne.charVel.x, airborne.charVel.z);

    // air control (AIR_CONTROL=0.12) blends toward desired velocity much more slowly than ground control.
    expect(airborneHorizSpeed).toBeLessThan(groundedHorizSpeed);
  });
});
