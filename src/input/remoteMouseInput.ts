/**
 * Remote mouse input — connects to the capture server's WebSocket and injects
 * mouse deltas into the virtual stick (via mouseLook's offsetX/offsetY).
 * Only used when explicitly enabled (e.g., for testing/replaying SC footage).
 */

const WS_URL = 'ws://localhost:8765';

let ws: WebSocket | null = null;
let connected = false;
const listeners: Array<(connected: boolean) => void> = [];

function notify(): void {
  listeners.forEach(fn => fn(connected));
}

export function connect(onDelta: (dx: number, dy: number) => void): void {
  if (connected || ws) return;

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      connected = true;
      console.log('[RemoteMouseInput] Connected to capture server');
      notify();
    };

    ws.onmessage = (evt) => {
      try {
        const { dx, dy } = JSON.parse(evt.data);
        if (typeof dx === 'number' && typeof dy === 'number') {
          onDelta(dx, dy);
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
      notify();
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
  notify();
}

export function isConnected(): boolean {
  return connected;
}

export function onChange(fn: (connected: boolean) => void): void {
  listeners.push(fn);
}
