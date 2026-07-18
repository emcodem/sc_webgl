import type { Vec3 } from '../core/types';
import { add, clamp, cross, normalize, scale, sub } from '../math/vec';
import * as Input from '../input/input';

// ============================================================================================
// A freely-positioned "noclip" spectator camera for reviewing flight replays from any angle —
// entirely separate from the ship-follow cockpit camera (render/renderer.ts's cameraView() picks
// between them). Only ever active while a replay is loaded (see ui/replayPanel's transport bar
// toggle); main.ts steps it in place of stepPilot/stepFoot, which don't run during replay anyway.
//
// Plain yaw/pitch (no roll) around a fixed world up, unlike the ship's quaternion/body-frame
// attitude — this is a camera-only concern with no physics or collision, so there's no need to
// route it through the ship's -Y-up body-frame convention (math/quaternion.ts's computeAxes);
// cameraView() just needs a plain {eye, forward, up}, not a quaternion.
//
// Controls: mouse look (pointer-lock, same click-to-capture as flight), WASD to fly along the
// current look direction, Space/Ctrl for straight up/down along world up (not the tilted camera
// up, so vertical movement stays predictable while looking around), Shift to move faster.
// ============================================================================================

const BASE_SPEED = 200; // m/s — roughly SCM-speed order of magnitude, fast enough to keep pace with ships
const BOOST_MULT = 5;
const LOOK_SENSITIVITY = 0.0022; // rad/pixel — matches control/foot.ts's BASE_LOOK_SENS for a consistent feel
const PITCH_LIMIT = Math.PI / 2 - 0.01; // stop just short of straight up/down (gimbal-lock adjacent)
const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };

interface FreeCameraState {
  pos: Vec3;
  yaw: number;
  pitch: number;
}

let active = false;
let state: FreeCameraState = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };

export function isActive(): boolean {
  return active;
}

// `startPos` seeds the camera near wherever the player was looking from (typically just behind/
// above the followed ship, not its exact origin — that's the cockpit position, and starting there
// would put the camera inside the hull looking at engine geometry). `lookAt`, if given, points the
// initial yaw/pitch at that world position (typically the ship itself) so the very first frame
// already frames the subject instead of facing an arbitrary default direction.
export function enable(startPos: Vec3, lookAt?: Vec3): void {
  active = true;
  let yaw = 0, pitch = 0;
  if (lookAt) {
    const d = normalize(sub(lookAt, startPos));
    pitch = clamp(Math.asin(clamp(d.y, -1, 1)), -PITCH_LIMIT, PITCH_LIMIT);
    yaw = Math.atan2(d.x, d.z);
  }
  state = { pos: { x: startPos.x, y: startPos.y, z: startPos.z }, yaw, pitch };
  Input.resetMouseDeltas();
}

export function disable(): void {
  active = false;
}

function basis(): { forward: Vec3; right: Vec3; up: Vec3 } {
  const cosPitch = Math.cos(state.pitch);
  const forward: Vec3 = {
    x: cosPitch * Math.sin(state.yaw),
    y: Math.sin(state.pitch),
    z: cosPitch * Math.cos(state.yaw)
  };
  const right = normalize(cross(forward, WORLD_UP));
  const up = cross(right, forward);
  return { forward, right, up };
}

export function step(dt: number): void {
  if (!active) return;

  if (Input.isCaptured()) {
    const mouse = Input.consumeMouse();
    state.yaw -= mouse.dx * LOOK_SENSITIVITY;
    state.pitch = clamp(state.pitch - mouse.dy * LOOK_SENSITIVITY, -PITCH_LIMIT, PITCH_LIMIT);
  }

  const { forward, right } = basis();
  const boosted = Input.isDown('ShiftLeft') || Input.isDown('ShiftRight');
  const speed = BASE_SPEED * (boosted ? BOOST_MULT : 1);

  let move: Vec3 = { x: 0, y: 0, z: 0 };
  if (Input.isDown('KeyW')) move = add(move, forward);
  if (Input.isDown('KeyS')) move = add(move, scale(forward, -1));
  if (Input.isDown('KeyD')) move = add(move, right);
  if (Input.isDown('KeyA')) move = add(move, scale(right, -1));
  if (Input.isDown('Space')) move = add(move, WORLD_UP);
  if (Input.isDown('ControlLeft') || Input.isDown('KeyC')) move = add(move, scale(WORLD_UP, -1));

  const moveLen = Math.hypot(move.x, move.y, move.z);
  if (moveLen > 1e-6) {
    state.pos = add(state.pos, scale(move, (speed * dt) / moveLen));
  }
}

export function getView(): { eye: Vec3; forward: Vec3; up: Vec3 } {
  const { forward, up } = basis();
  return { eye: state.pos, forward, up };
}
