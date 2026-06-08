const { ipcMain } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Register specialization IPC handlers
 */
function register() {
  // Switch specialization
  ipcMain.handle('switch-specialization', async (event, name) => {
    let specPath;

    if (name === 'base') {
      specPath = '/nix/var/nix/profiles/system/bin/switch-to-configuration';
    } else {
      specPath = `/nix/var/nix/profiles/system/specialisation/${name}/bin/switch-to-configuration`;
    }

    if (!fs.existsSync(specPath)) {
      throw new Error(`Specialization '${name}' not found`);
    }

    return new Promise((resolve, reject) => {
      exec(`pkexec ${specPath} switch`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(`Switched to specialization: ${name}`);
        }
      });
    });
  });

  // Get available specializations
  ipcMain.handle('get-specializations', async () => {
    const baseSystem = '/nix/var/nix/profiles/system';
    const specDir = `${baseSystem}/specialisation`;
    const currentSystem = '/run/current-system';
    const specializations = [];

    let currentPath = null;
    let basePath = null;
    try {
      currentPath = fs.realpathSync(currentSystem);
      basePath = fs.realpathSync(baseSystem);
    } catch (e) {
      console.error('Failed to resolve system paths:', e);
    }

    // Determine active specialization
    let activeSpec = null;
    if (currentPath && basePath) {
      if (currentPath === basePath) {
        activeSpec = 'base';
      } else if (fs.existsSync(specDir)) {
        const entries = fs.readdirSync(specDir);
        for (const entry of entries) {
          const specPath = path.join(specDir, entry);
          try {
            const resolvedSpecPath = fs.realpathSync(specPath);
            if (currentPath === resolvedSpecPath) {
              activeSpec = entry;
              break;
            }
          } catch (e) {}
        }
      }
    }

    // Always add "base" first
    specializations.push({
      name: 'base',
      active: activeSpec === 'base'
    });

    // Add other specializations
    try {
      if (fs.existsSync(specDir)) {
        const entries = fs.readdirSync(specDir);
        for (const entry of entries) {
          const fullPath = path.join(specDir, entry);
          if (fs.statSync(fullPath).isDirectory()) {
            specializations.push({
              name: entry,
              active: activeSpec === entry
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to read specializations:', e);
    }

    return specializations;
  });
}

module.exports = { register };
