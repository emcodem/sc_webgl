#!/usr/bin/env node
/**
 * Convenience wrapper: starts the Node relay server and the Python raw-input
 * capture script together (see mouse-capture-server.mjs / mouse-capture.py for
 * what each actually does), so `npm run capture` alone stands up the whole
 * SC -> vjoy pipeline instead of needing two terminals. Ctrl+C stops both.
 *
 * Usage: npm run capture
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const relay = spawn('node', [join(__dirname, 'mouse-capture-server.mjs')], {
  stdio: 'inherit',
  shell: true,
});

// Give the relay a moment to actually be listening before the Python side's
// first WebSocket connect attempt — it doesn't retry on a failed handshake.
const captureStart = setTimeout(() => {
  capture = spawn('python', [join(__dirname, 'mouse-capture.py')], {
    stdio: 'inherit',
    shell: true,
  });
  wireExit(capture, 'capture');
}, 500);

let capture = null;
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(captureStart);
  relay.kill();
  capture?.kill();
}

function wireExit(proc, label) {
  proc.on('exit', (code) => {
    if (shuttingDown) return;
    console.log(`[capture-all] ${label} exited (code ${code}) — stopping the other process too`);
    shutdown();
    process.exit(code ?? 0);
  });
  proc.on('error', (err) => {
    console.error(`[capture-all] failed to start ${label}:`, err.message);
    if (label === 'capture') {
      console.error('[capture-all] hint: is python on PATH? (pip install websocket-client)');
    }
    shutdown();
    process.exit(1);
  });
}

wireExit(relay, 'relay');

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
