// @ts-check
import electron from 'electron';
const { app, BrowserWindow, ipcMain } = electron as any;
import path from 'path';
import fs from 'fs';

let mainWindow: import('electron').BrowserWindow | null = null;
let cachedVersion: string | null = null; // CQ-08: read once, not on every IPC call

// Native window background per stored theme (avoids dark flash on light themes)
const WINDOW_BG: Record<string, string> = {
  mocha: '#1e1e2e',
  macchiato: '#24273a',
  latte: '#eff1f5',
  nord: '#2e3440',
};

function themeFilePath() {
  return path.join(app.getPath('userData'), 'window-theme.json');
}

function readStoredTheme(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(themeFilePath(), 'utf8'));
    return WINDOW_BG[parsed?.theme] ? parsed.theme : 'mocha';
  } catch {
    return 'mocha';
  }
}

/**
 * Check if we're in development mode
 */
function isDev() {
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
    backgroundColor: WINDOW_BG[readStoredTheme()] || WINDOW_BG.mocha,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', '..', 'preload.js')
    }
  });
  const win = mainWindow as import('electron').BrowserWindow;

  // Remove menu bar entirely
  win.setMenuBarVisibility(false);
  win.setMenu(null);

  if (isDev()) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  // DevTools keyboard shortcut — dev builds only (BUG-03)
  if (isDev()) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        mainWindow?.webContents.toggleDevTools();
      }
    });
  }

  return win;
}

/**
 * Get the main window instance
 * @returns {import('electron').BrowserWindow | null}
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
      return false; // BUG-08: return actual new state
    } else {
      mainWindow?.maximize();
      return true;
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

  ipcMain.handle('settings-set-theme', (_event: any, theme: any) => {
    const value = WINDOW_BG[theme] ? theme : 'mocha';
    try {
      fs.writeFileSync(themeFilePath(), JSON.stringify({ theme: value }), 'utf8');
      return { success: true };
    } catch (e: any) {
      console.error('Failed to persist theme:', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('get-app-version', () => {
    if (cachedVersion) return cachedVersion; // CQ-08: serve from cache
    try {
      const packagePath = path.join(app.getAppPath(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      cachedVersion = packageJson.version;
      return cachedVersion;
    } catch (e: any) {
      console.error('Failed to read package.json version:', e);
      return app.getVersion() || '?';
    }
  });
}

export { createWindow, getMainWindow, registerWindowHandlers, isDev };

export {};
