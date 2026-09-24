// @ts-check
import electron from 'electron';
const { app, BrowserWindow } = electron as any;

app.setName('nixos-manager');

// Import window management
import { createWindow, registerWindowHandlers } from './src/main/window.ts';

// Import IPC handlers
import * as systemHandlers from './src/main/handlers/system.ts';
import * as notificationsHandlers from './src/main/handlers/notifications.ts';
import * as rebuildHandlers from './src/main/handlers/rebuild.ts';
import * as specializationsHandlers from './src/main/handlers/specializations.ts';
import * as flakeHandlers from './src/main/handlers/flake.ts';
import * as packagesHandlers from './src/main/handlers/packages.ts';
import * as optionsHandlers from './src/main/handlers/options.ts';
import * as generationsHandlers from './src/main/handlers/generations.ts';
import * as gitHandlers from './src/main/handlers/git.ts';
import * as discoverHandlers from './src/main/handlers/discover.ts';
import * as historyHandlers from './src/main/handlers/history.ts';

// Register all IPC handlers
function registerAllHandlers() {
  registerWindowHandlers();
  systemHandlers.register();
  notificationsHandlers.register();
  rebuildHandlers.register();
  specializationsHandlers.register();
  flakeHandlers.register();
  packagesHandlers.register();
  optionsHandlers.register();
  generationsHandlers.register();
  gitHandlers.register();
  discoverHandlers.register();
  historyHandlers.register();
}

// App lifecycle
app.whenReady().then(() => {
  registerAllHandlers();
  const win = createWindow();

  // If launched with --show-updates, tell renderer to open git modal
  if (process.argv.includes('--show-updates')) {
    win?.webContents.on('did-finish-load', () => {
      win?.webContents.send('show-updates');
    });
  }
});

app.on('window-all-closed', () => {
  // Cleanup running processes before exit
  discoverHandlers.cleanup();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

export {};
