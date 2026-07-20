/**
 * Remote mouse input — receives captured mouse deltas from SC via WebSocket.
 * Minimal: just connect/disconnect/get deltas. No processing.
 */

const WS_URL = 'ws://localhost:8765';

let ws: WebSocket | null = null;
let connected = false;
// Accumulate deltas across ALL messages received since the last frame consumed them. Messages
// arrive async and faster than we sample (the capture side already batches at ~60fps, but never
// assume 1:1) — summing rather than latching the last value guarantees no motion is dropped, which
// matters because the vjoy is integrative: a lost delta desyncs us from SC's stick permanently.
let accumDx = 0;
let accumDy = 0;

const listeners: Array<(connected: boolean) => void> = [];

export function connect(): void {
  if (connected || ws) return;

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      connected = true;
      console.log('[RemoteMouseInput] Connected');
      listeners.forEach(fn => fn(true));
    };

    ws.onmessage = (evt) => {
      try {
        const { dx, dy } = JSON.parse(evt.data);
        if (typeof dx === 'number' && typeof dy === 'number') {
          accumDx += dx;
          accumDy += dy;
        }
      } catch (err) {
        console.error('[RemoteMouseInput] Parse error:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[RemoteMouseInput] Error:', err);
    };

    ws.onclose = () => {
      connected = false;
      ws = null;
      console.log('[RemoteMouseInput] Disconnected');
      listeners.forEach(fn => fn(false));
    };
  } catch (err) {
    console.error('[RemoteMouseInput] Failed to connect:', err);
  }
}

export function disconnect(): void {
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  listeners.forEach(fn => fn(false));
}

export function isConnected(): boolean {
  return connected;
}

// Returns the summed delta since the previous call and resets the accumulator. Call once per
// frame and feed the result to MouseLook.injectDelta.
export function consumeDelta(): { dx: number; dy: number } {
  const d = { dx: accumDx, dy: accumDy };
  accumDx = 0;
  accumDy = 0;
  return d;
}

export function onChange(fn: (connected: boolean) => void): void {
  listeners.push(fn);
}
