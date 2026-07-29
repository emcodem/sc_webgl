// Electron shell around the same static build served at C:\dev\sc_webgl\index.html — see
// CLAUDE.md. Kept as a thin wrapper: no gameplay code lives here, this only owns the native
// window. `.cjs` so it loads as CommonJS regardless of the root package.json's "type": "module".
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

// Set by the `electron:dev` script to point at the Vite dev server instead of dist/.
const devServerUrl = process.env.ELECTRON_START_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#05070a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // The game has its own F3 menu; the OS-native menu bar just adds an Alt-key trap over game
  // input, so drop it instead of theming it.
  Menu.setApplicationMenu(null);

  // The F3 menu's Source Code / Send Feedback links are plain <a target="_blank"> — without
  // this they'd otherwise open inside a second chromeless BrowserWindow.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
