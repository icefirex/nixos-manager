const { app, BrowserWindow } = require('electron');

// Import window management
const { createWindow, registerWindowHandlers } = require('./src/main/window');

// Import IPC handlers
const systemHandlers = require('./src/main/handlers/system');
const notificationsHandlers = require('./src/main/handlers/notifications');
const rebuildHandlers = require('./src/main/handlers/rebuild');
const specializationsHandlers = require('./src/main/handlers/specializations');
const flakeHandlers = require('./src/main/handlers/flake');
const packagesHandlers = require('./src/main/handlers/packages');
const optionsHandlers = require('./src/main/handlers/options');
const generationsHandlers = require('./src/main/handlers/generations');
const gitHandlers = require('./src/main/handlers/git');
const discoverHandlers = require('./src/main/handlers/discover');

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
}

// App lifecycle
app.whenReady().then(() => {
  registerAllHandlers();
  const win = createWindow();

  // If launched with --show-updates, tell renderer to open git modal
  if (process.argv.includes('--show-updates')) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('show-updates');
    });
  }
});

app.on('window-all-closed', () => {
  // Cleanup running processes before exit
  discoverHandlers.cleanup();

  if (process.platform !== 'darwin') {
    // Use exit() for faster termination, avoids GPU cleanup delays
    app.exit(0);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
