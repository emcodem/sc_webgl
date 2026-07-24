// ============================================================================================
// Dev-only tool: records the ship's computed angular rate (yaw/pitch, deg/s) over time, for
// comparing sc_webgl's mouse-offset -> yaw-rate response against real SC's at the same held raw
// mouse counts (capture/YAWCAPTURE.md procedure B). Console-driven (window.__yawLog.*), same
// convention as debug/vjoyRecorder.ts and main.ts's other __ debug hooks.
//
// Sampled every frame from main.ts's loop (not on a timer), same reasoning as vjoyRecorder.ts.
// ============================================================================================

interface Sample {
  t: number; // seconds since recording started
  yawRateDeg: number;
  pitchRateDeg: number;
}

let recording = false;
let startedAt = 0;
let samples: Sample[] = [];

export function start(): void {
  recording = true;
  startedAt = performance.now();
  samples = [];
  console.log('[YawRateRecorder] Recording started -- run the mouse maneuver now, then call __yawLog.stop()');
}

// Called once per rendered frame from main.ts -- a no-op unless start() was called first.
export function sample(angVel: { pitch: number; yaw: number }): void {
  if (!recording) return;
  samples.push({
    t: (performance.now() - startedAt) / 1000,
    yawRateDeg: angVel.yaw * (180 / Math.PI),
    pitchRateDeg: angVel.pitch * (180 / Math.PI),
  });
}

// Stops recording, triggers a CSV download (t,yawRateDeg,pitchRateDeg), and returns the row count so
// the console call itself confirms something was actually captured.
export function stop(): number {
  recording = false;
  const rows = samples.length;
  const csv = ['t,yawRateDeg,pitchRateDeg', ...samples.map(s => `${s.t.toFixed(6)},${s.yawRateDeg},${s.pitchRateDeg}`)].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yaw-rate-log-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  console.log(`[YawRateRecorder] Stopped, ${rows} samples, downloaded as ${a.download}`);
  return rows;
}
