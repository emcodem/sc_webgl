import type { ReplayClip, ReplayEntitySnapshot, ReplayEvent, ReplayFrame, ReplayInputs } from './types';
import { REPLAY_SCHEMA_VERSION } from './types';

// ============================================================================================
// File export/import. The in-memory ReplayClip (replay/types.ts) stays full-precision, named-
// object shaped — recorder.ts and player.ts never see any of this. Only the SERIALIZED file
// format is compact: measured against a real recorded clip (11 enemies, ~5KB/frame verbose JSON),
// rounding precision + hoisting each entity's static shipTypeId into a one-time manifest + gzip
// got the same data down to ~5.8% of its original size with no meaningful accuracy loss (2
// decimals on position is cm precision; 4 on a unit quaternion is a fraction of a degree — both
// far below anything visually or physically meaningful here). Mirrors input/presetStore.ts's
// Blob+anchor download / FileReader pattern otherwise.
// ============================================================================================

const POS_DECIMALS = 2;
const QUAT_DECIMALS = 4;
const VEL_DECIMALS = 2;
const ANGVEL_DECIMALS = 3;
const FRAC_DECIMALS = 3;
const INPUT_DECIMALS = 3;
const TIME_DECIMALS = 3;

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

type InputsTuple = [number, number, number, number, number, number, 0 | 1, 0 | 1];
// [shipTypeIndex, pos.x/y/z, quat.x/y/z/w, vel.x/y/z, angVel.pitch/yaw/roll, healthFrac, boosting, inputs]
type EntityTuple = [
  number,
  number, number, number,
  number, number, number, number,
  number, number, number,
  number, number, number,
  number, 0 | 1,
  InputsTuple | null
];
type WireFrame = [number, EntityTuple, (EntityTuple | null)[]];

// [kindCode(0=fire), simTime, endSimTime, ownerCode(0=player,1=enemy), pos.x/y/z, vel.x/y/z]
type WireFireEvent = [0, number, number, 0 | 1, number, number, number, number, number, number];
// [kindCode(1=impact,2=explosion), simTime, pos.x/y/z, normal.x/y/z|null]
type WireEffectEvent = [1 | 2, number, number, number, number, number | null, number | null, number | null];
type WireEvent = WireFireEvent | WireEffectEvent;

interface WireClip {
  schemaVersion: number;
  recordedAt: string;
  sampleHz: number;
  shipTypeIds: string[];
  frames: WireFrame[];
  events: WireEvent[];
}

function encodeInputs(inputs: ReplayInputs | null): InputsTuple | null {
  if (!inputs) return null;
  return [
    round(inputs.throttle, INPUT_DECIMALS), round(inputs.pitch, INPUT_DECIMALS),
    round(inputs.yaw, INPUT_DECIMALS), round(inputs.roll, INPUT_DECIMALS),
    round(inputs.strafeX, INPUT_DECIMALS), round(inputs.strafeY, INPUT_DECIMALS),
    inputs.brake ? 1 : 0, inputs.decoupled ? 1 : 0
  ];
}
function decodeInputs(t: InputsTuple | null): ReplayInputs | null {
  if (!t) return null;
  return { throttle: t[0], pitch: t[1], yaw: t[2], roll: t[3], strafeX: t[4], strafeY: t[5], brake: t[6] === 1, decoupled: t[7] === 1 };
}

function encodeEntity(e: ReplayEntitySnapshot, typeIndex: (id: string) => number): EntityTuple {
  return [
    typeIndex(e.shipTypeId),
    round(e.pos.x, POS_DECIMALS), round(e.pos.y, POS_DECIMALS), round(e.pos.z, POS_DECIMALS),
    round(e.quat.x, QUAT_DECIMALS), round(e.quat.y, QUAT_DECIMALS), round(e.quat.z, QUAT_DECIMALS), round(e.quat.w, QUAT_DECIMALS),
    round(e.vel.x, VEL_DECIMALS), round(e.vel.y, VEL_DECIMALS), round(e.vel.z, VEL_DECIMALS),
    round(e.angVel.pitch, ANGVEL_DECIMALS), round(e.angVel.yaw, ANGVEL_DECIMALS), round(e.angVel.roll, ANGVEL_DECIMALS),
    round(e.healthFrac, FRAC_DECIMALS),
    e.boosting ? 1 : 0,
    encodeInputs(e.inputs)
  ];
}
function decodeEntity(t: EntityTuple, shipTypeIds: string[]): ReplayEntitySnapshot {
  return {
    shipTypeId: shipTypeIds[t[0]] ?? shipTypeIds[0],
    pos: { x: t[1], y: t[2], z: t[3] },
    quat: { x: t[4], y: t[5], z: t[6], w: t[7] },
    vel: { x: t[8], y: t[9], z: t[10] },
    angVel: { pitch: t[11], yaw: t[12], roll: t[13] },
    healthFrac: t[14],
    boosting: t[15] === 1,
    inputs: decodeInputs(t[16])
  };
}

function encodeEvent(ev: ReplayEvent): WireEvent {
  if (ev.kind === 'fire') {
    return [
      0, round(ev.simTime, TIME_DECIMALS), round(ev.endSimTime, TIME_DECIMALS), ev.owner === 'player' ? 0 : 1,
      round(ev.pos.x, POS_DECIMALS), round(ev.pos.y, POS_DECIMALS), round(ev.pos.z, POS_DECIMALS),
      round(ev.vel.x, VEL_DECIMALS), round(ev.vel.y, VEL_DECIMALS), round(ev.vel.z, VEL_DECIMALS)
    ];
  }
  return [
    ev.kind === 'impact' ? 1 : 2, round(ev.simTime, TIME_DECIMALS),
    round(ev.pos.x, POS_DECIMALS), round(ev.pos.y, POS_DECIMALS), round(ev.pos.z, POS_DECIMALS),
    ev.normal ? round(ev.normal.x, QUAT_DECIMALS) : null,
    ev.normal ? round(ev.normal.y, QUAT_DECIMALS) : null,
    ev.normal ? round(ev.normal.z, QUAT_DECIMALS) : null
  ];
}
function decodeEvent(t: WireEvent): ReplayEvent {
  if (t[0] === 0) {
    return {
      kind: 'fire', simTime: t[1], endSimTime: t[2], owner: t[3] === 0 ? 'player' : 'enemy',
      pos: { x: t[4], y: t[5], z: t[6] }, vel: { x: t[7], y: t[8], z: t[9] }
    };
  }
  const hasNormal = t[5] !== null;
  return {
    kind: t[0] === 1 ? 'impact' : 'explosion', simTime: t[1], pos: { x: t[2], y: t[3], z: t[4] },
    normal: hasNormal ? { x: t[5] as number, y: t[6] as number, z: t[7] as number } : undefined
  };
}

function encodeWireClip(clip: ReplayClip): WireClip {
  const shipTypeIds: string[] = [];
  const typeIndex = (id: string): number => {
    let i = shipTypeIds.indexOf(id);
    if (i === -1) { i = shipTypeIds.length; shipTypeIds.push(id); }
    return i;
  };
  const frames: WireFrame[] = clip.frames.map(f => [
    round(f.simTime, TIME_DECIMALS),
    encodeEntity(f.player, typeIndex),
    f.enemies.map(e => e ? encodeEntity(e, typeIndex) : null)
  ]);
  const events = clip.events.map(encodeEvent);
  return { schemaVersion: REPLAY_SCHEMA_VERSION, recordedAt: clip.recordedAt, sampleHz: clip.sampleHz, shipTypeIds, frames, events };
}

function decodeWireClip(wire: WireClip): ReplayClip {
  const frames: ReplayFrame[] = wire.frames.map(([simTime, player, enemies]) => ({
    simTime,
    player: decodeEntity(player, wire.shipTypeIds),
    enemies: enemies.map(e => e ? decodeEntity(e, wire.shipTypeIds) : null)
  }));
  const events = wire.events.map(decodeEvent);
  return { schemaVersion: wire.schemaVersion, recordedAt: wire.recordedAt, sampleHz: wire.sampleHz, frames, events };
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

// CompressionStream/DecompressionStream are standard in every current browser, but degrade
// gracefully to plain (uncompressed) text if either is ever unavailable — export falls back to
// writing plain JSON, and import detects which one it's looking at via gzip's magic bytes rather
// than assuming.
async function toBlob(jsonText: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([jsonText], { type: 'application/octet-stream' });
  const stream = new Blob([jsonText]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).blob();
}
async function toText(buf: Uint8Array<ArrayBuffer>): Promise<string> {
  const isGzip = buf.length > 2 && buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1;
  if (isGzip && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(buf);
}

export async function exportClip(clip: ReplayClip): Promise<void> {
  const blob = await toBlob(JSON.stringify(encodeWireClip(clip)));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `replay-${clip.recordedAt.replace(/[:.]/g, '-')}.vreplay`;
  a.click();
  URL.revokeObjectURL(url);
}

function isWireClip(v: unknown): v is WireClip {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return c.schemaVersion === REPLAY_SCHEMA_VERSION && Array.isArray(c.shipTypeIds) && Array.isArray(c.frames) && Array.isArray(c.events);
}

export async function importClipFromFile(file: File): Promise<ReplayClip> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = await toText(buf);
  } catch {
    throw new Error('Could not read file.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not a valid replay file (invalid JSON).');
  }
  if (!isWireClip(parsed)) {
    throw new Error('Not a valid replay file, or recorded with an incompatible version.');
  }
  return decodeWireClip(parsed);
}
