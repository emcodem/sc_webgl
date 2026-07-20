#!/usr/bin/env node
/**
 * Mouse delta relay server — receives mouse deltas from Python capture script
 * and broadcasts them to connected game clients.
 *
 * Game connects to: ws://localhost:8765/
 * Capture script connects to: ws://localhost:8765/client
 *
 * Usage:
 *   npm run capture          (starts this + mouse-capture.py together — see capture-all.mjs)
 * or, to run just this relay on its own:
 *   npm run capture:relay
 *   python scripts/mouse-capture.py   (in another terminal)
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const port = parseInt(process.argv[2] || '8765');
let gameClients = new Set();
let captureClient = null;

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Mouse Relay Server\nGame clients: ${gameClients.size}\nCapture: ${captureClient ? 'connected' : 'disconnected'}`);
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const url = req.url || '/';
  console.log(`[WS] New connection to path: "${url}"`);

  if (url === '/client') {
    // Capture process connection
    console.log(`[CAPTURE] Connected`);
    captureClient = ws;

    let msgCount = 0;
    ws.on('message', (data) => {
      msgCount++;
      const msg = data instanceof Buffer ? data.toString() : data;

      if (msgCount === 1) {
        console.log(`[RELAY] First message from capture: ${msg}`);
      }
      if (msgCount % 60 === 0) {
        console.log(`[RELAY] Forwarding to ${gameClients.size} game clients: ${msg}`);
      }

      // Relay to all game clients
      gameClients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(msg);
        }
      });
    });

    ws.on('close', () => {
      console.log(`[CAPTURE] Disconnected`);
      captureClient = null;
    });

    ws.on('error', (err) => {
      console.error('[CAPTURE] Error:', err.message);
    });
  } else {
    // Game client connection
    console.log(`[GAME] Connected (total: ${gameClients.size + 1})`);
    gameClients.add(ws);

    ws.on('close', () => {
      const wasRemoved = gameClients.delete(ws);
      console.log(`[GAME] Disconnected (total: ${gameClients.size}, was in set: ${wasRemoved})`);
    });

    ws.on('error', (err) => {
      console.error('[GAME] Error:', err.message);
    });
  }
});

httpServer.listen(port, () => {
  console.log(`[SERVER] Relay listening on ws://localhost:${port}`);
  console.log(`[SERVER]`);
  console.log(`[SERVER] Usage:`);
  console.log(`[SERVER]   1. npm run dev                (start game)`);
  console.log(`[SERVER]   2. __remoteMouseInput(true)   (in game console)`);
  console.log(`[SERVER]   3. mouse-capture.py — auto-started if this was launched via`);
  console.log(`[SERVER]      npm run capture; run it yourself in another terminal if`);
  console.log(`[SERVER]      this is npm run capture:relay instead.`);
  console.log(`[SERVER]`);
});

process.on('SIGINT', () => {
  console.log(`\n[SERVER] Shutting down...`);
  wss.close();
  httpServer.close();
  process.exit(0);
});
