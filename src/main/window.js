const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

/**
 * Check if we're in development mode
 */
function isDev() {
  const { app } = require('electron');
  return process.env.ELECTRON_IS_DEV === '1' ||
    (process.env.ELECTRON_IS_DEV !== '0' && !app.isPackaged);
}

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1200,
    minHeight: 800,
    frame: false,
    transparent: false,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', '..', 'preload.js')
    }
  });

  // Remove menu bar entirely
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setMenu(null);

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // Enable DevTools shortcut in production too
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  return mainWindow;
}

/**
 * Get the main window instance
 */
function getMainWindow() {
  return mainWindow;
}

/**
 * Register window control IPC handlers
 */
function registerWindowHandlers() {
  ipcMain.handle('window-minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('window-close', () => {
    // Hide window first to avoid compositor freeze on KDE
    mainWindow?.hide();
    // Small delay then destroy to ensure clean shutdown
    setTimeout(() => {
      mainWindow?.destroy();
    }, 50);
  });

  ipcMain.handle('get-app-version', () => {
    try {
      // Read version from package.json relative to main.js location
      const packagePath = path.join(__dirname, '..', '..', 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return packageJson.version;
    } catch (e) {
      console.error('Failed to read package.json version:', e);
      return app.getVersion() || '?';
    }
  });
}

module.exports = {
  createWindow,
  getMainWindow,
  registerWindowHandlers,
  isDev
};
