const { ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { NIX_SYSTEM_PROFILE, NIX_CURRENT_SYSTEM } = require('../constants');

// Valid specialization names: alphanumeric, hyphens, underscores only
const VALID_SPEC_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Register specialization IPC handlers
 */
function register() {
  // Switch specialization
  ipcMain.handle('switch-specialization', async (event, name) => {
    // SEC-05: validate name before constructing any path
    if (!name || !VALID_SPEC_NAME.test(name)) {
      throw new Error(`Invalid specialization name: "${name}"`);
    }

    let specPath;
    if (name === 'base') {
      specPath = `${NIX_SYSTEM_PROFILE}/bin/switch-to-configuration`;
    } else {
      specPath = `${NIX_SYSTEM_PROFILE}/specialisation/${name}/bin/switch-to-configuration`;
    }

    if (!fs.existsSync(specPath)) {
      throw new Error(`Specialization '${name}' not found`);
    }

    return new Promise((resolve, reject) => {
      // Use execFile — passes args as array, not through /bin/sh
      execFile('pkexec', [specPath, 'switch'], (error, stdout, stderr) => {
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
    const baseSystem = NIX_SYSTEM_PROFILE;
    const specDir = `${baseSystem}/specialisation`;
    const currentSystem = NIX_CURRENT_SYSTEM;
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
