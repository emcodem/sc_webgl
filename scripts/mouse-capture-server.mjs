#!/usr/bin/env node
/**
 * Standalone mouse capture server — polls global mouse movement continuously
 * and streams deltas via WebSocket to connected clients (the WebGL game).
 * The game applies these deltas only when pointer-lock is active.
 *
 * Uses a persistent PowerShell process to access Windows API (no compilation).
 *
 * Usage:
 *   npm run capture
 * or
 *   node scripts/mouse-capture-server.mjs [port]
 *
 * Then in the game console:
 *   __remoteMouseInput(true)
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from 'child_process';

const port = parseInt(process.argv[2] || '8765');
const POLL_INTERVAL = 16; // ~60fps

let lastX = 0;
let lastY = 0;
let clients = new Set();

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Mouse Capture Server\nConnected clients: ' + clients.size);
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  console.log(`[WS] Client connected (total: ${clients.size + 1})`);
  clients.add(ws);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (total: ${clients.size})`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  let sent = 0;
  clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
      sent++;
    }
  });
  return sent;
}

// Persistent PowerShell process that outputs mouse position every frame
let ps = null;
let posBuffer = '';
let lastProcessedPos = '';

function initPowerShellPoller() {
  // Script: infinite loop outputting mouse X,Y on each iteration with a marker
  const psScript = `
    while ($true) {
      $pos = [System.Windows.Forms.Cursor]::Position;
      Write-Host "$($pos.X),$($pos.Y)|";
      Start-Sleep -Milliseconds ${POLL_INTERVAL};
    }
  `;

  ps = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', psScript], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });

  ps.stdout.on('data', (data) => {
    posBuffer += data.toString();

    // Process complete position records (delimited by |)
    const records = posBuffer.split('|');
    posBuffer = records.pop(); // keep incomplete record in buffer

    records.forEach((record) => {
      const line = record.trim();
      if (!line) return;

      try {
        const [xStr, yStr] = line.split(',');
        const x = parseInt(xStr, 10);
        const y = parseInt(yStr, 10);

        if (!isNaN(x) && !isNaN(y) && clients.size > 0) {
          const dx = x - lastX;
          const dy = y - lastY;

          if (dx !== 0 || dy !== 0) {
            broadcast({ dx, dy });
          }

          lastX = x;
          lastY = y;
        }
      } catch (err) {
        // ignore parse errors
      }
    });
  });

  ps.on('error', (err) => {
    console.error('[PS] Process error:', err.message);
  });

  ps.on('close', (code) => {
    console.log(`[PS] Process closed (code ${code})`);
    ps = null;
    // Try to restart after a delay
    setTimeout(initPowerShellPoller, 1000);
  });
}

httpServer.listen(port, () => {
  initPowerShellPoller();
  console.log(`[SERVER] Mouse capture listening on ws://localhost:${port}`);
  console.log(`[SERVER] In-game: __remoteMouseInput(true) to enable replay`);
  console.log(`[SERVER] Ctrl+C to stop`);
});

process.on('SIGINT', () => {
  console.log(`\n[SERVER] Shutting down...`);
  if (ps) ps.kill();
  wss.close();
  httpServer.close();
  process.exit(0);
});
