import * as MouseLook from '../input/mouseLook';

// ============================================================================================
// Dev-only tool: records the raw vjoy accumulator (offsetX/offsetY, NOT the normalized/curved
// output) over time, for comparing sc_webgl's stick-position-vs-raw-mouse-count mapping against
// real SC's, captured on video and read via capture/analysis/track_vjoy_indicator.py. Console-driven
// (window.__vjoyLog.*), same convention as main.ts's other __ debug hooks -- not wired into any UI,
// since this is a one-off measurement tool, not a player-facing feature.
//
// Sampled every frame from main.ts's loop (not on a timer), so timestamps are real animation-frame
// times (performance.now()), matching how capture/analysis/sync_detect.py's detect_motion_onset
// expects a per-sample position trace -- no assumption about a fixed sample rate.
// ============================================================================================

interface Sample {
  t: number; // seconds since recording started
  offsetX: number;
  offsetY: number;
}

let recording = false;
let startedAt = 0;
let samples: Sample[] = [];

export function start(): void {
  recording = true;
  startedAt = performance.now();
  samples = [];
  console.log('[VjoyRecorder] Recording started -- run the mouse maneuver now, then call __vjoyLog.stop()');
}

// Called once per rendered frame from main.ts -- a no-op unless start() was called first.
export function sample(): void {
  if (!recording) return;
  const { x, y } = MouseLook.getOffset();
  samples.push({ t: (performance.now() - startedAt) / 1000, offsetX: x, offsetY: y });
}

// Stops recording, triggers a CSV download (t,offsetX,offsetY), and returns the row count so the
// console call itself confirms something was actually captured.
export function stop(): number {
  recording = false;
  const rows = samples.length;
  const csv = ['t,offsetX,offsetY', ...samples.map(s => `${s.t.toFixed(6)},${s.offsetX},${s.offsetY}`)].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vjoy-log-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  console.log(`[VjoyRecorder] Stopped, ${rows} samples, downloaded as ${a.download}`);
  return rows;
}
