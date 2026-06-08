const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findFlakeDir, getSpawnEnv } = require('../utils');
const { getMainWindow } = require('../window');

/**
 * Register flake management IPC handlers
 */
function register() {
  // Update all flake inputs
  ipcMain.handle('update-flake-inputs', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error('Could not find flake directory');
    }

    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('terminal-show', { title: 'Updating All Flake Inputs' });

    return new Promise((resolve, reject) => {
      const proc = spawn('nix', ['flake', 'update'], {
        cwd: flakeDir,
        env: getSpawnEnv()
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
        mainWindow?.webContents.send('build-output', data.toString());
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
        mainWindow?.webContents.send('build-output', data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve('Flake inputs updated');
        } else {
          reject(new Error(`Update failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  });

  // Update a single flake input
  ipcMain.handle('update-flake-input', async (event, inputName) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error('Could not find flake directory');
    }

    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('terminal-show', { title: `Updating ${inputName}` });

    return new Promise((resolve, reject) => {
      const proc = spawn('nix', ['flake', 'update', inputName], {
        cwd: flakeDir,
        env: getSpawnEnv()
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
        mainWindow?.webContents.send('build-output', data.toString());
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
        mainWindow?.webContents.send('build-output', data.toString());
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(`Flake input "${inputName}" updated`);
        } else {
          reject(new Error(`Update failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  });

  // Get flake inputs from flake.lock
  ipcMain.handle('get-flake-inputs', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return [];
    }

    const lockPath = path.join(flakeDir, 'flake.lock');
    if (!fs.existsSync(lockPath)) {
      return [];
    }

    try {
      const lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      const inputs = [];
      const nodes = lockContent.nodes || {};
      const rootInputs = nodes.root?.inputs || {};

      for (const [name, nodeRef] of Object.entries(rootInputs)) {
        const node = nodes[nodeRef];
        if (node && node.locked) {
          const lastModified = node.locked.lastModified;
          let age = 'unknown';
          let status = 'fresh';

          if (lastModified) {
            const ageMs = Date.now() - (lastModified * 1000);
            const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

            if (ageDays === 0) {
              age = 'today';
            } else if (ageDays === 1) {
              age = '1 day';
            } else {
              age = `${ageDays} days`;
            }

            if (ageDays > 7) {
              status = 'stale';
            }
          }

          inputs.push({ name, status, age });
        }
      }

      return inputs;
    } catch (e) {
      console.error('Failed to parse flake.lock:', e);
      return [];
    }
  });
}

module.exports = { register };
