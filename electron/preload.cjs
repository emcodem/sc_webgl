// No privileged APIs are exposed to the renderer — the app only uses standard web APIs
// (pointer lock, fullscreen, gamepad, <input type="file">), all of which work unchanged
// under Electron. Kept as a seam for later Electron-only features via contextBridge.
