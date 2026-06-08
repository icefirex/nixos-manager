const { ipcMain } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Register generation IPC handlers
 */
function register() {
  // Get all generations
  ipcMain.handle('get-generations', async () => {
    const profileDir = '/nix/var/nix/profiles';
    const profilePath = `${profileDir}/system`;

    const generations = [];

    // Determine current generation by following the symlink
    let currentGeneration = null;
    try {
      const profileLink = fs.readlinkSync(profilePath);
      const match = profileLink.match(/system-(\d+)-link/);
      if (match) {
        currentGeneration = parseInt(match[1], 10);
      }
    } catch (e) {
      console.error('Failed to determine current generation:', e);
    }

    // Read profile directory and find all system-*-link entries
    try {
      const entries = fs.readdirSync(profileDir);

      for (const entry of entries) {
        const match = entry.match(/^system-(\d+)-link$/);
        if (match) {
          const genNumber = parseInt(match[1], 10);
          const genPath = path.join(profileDir, entry);

          // Get the creation/modification time of the symlink
          let dateStr = '';
          try {
            const stats = fs.lstatSync(genPath);
            dateStr = stats.mtime.toISOString();
          } catch (e) {}

          generations.push({
            number: genNumber,
            date: dateStr,
            current: genNumber === currentGeneration,
            path: genPath
          });
        }
      }
    } catch (e) {
      throw new Error(`Failed to read generations: ${e.message}`);
    }

    // Sort by generation number descending (newest first)
    generations.sort((a, b) => b.number - a.number);
    return generations;
  });

  // Get generation details
  ipcMain.handle('get-generation-info', async (event, genNumber) => {
    const profilePath = '/nix/var/nix/profiles/system';
    const genPath = `${profilePath}-${genNumber}-link`;

    // Check if generation exists
    if (!fs.existsSync(genPath)) {
      throw new Error(`Generation ${genNumber} not found`);
    }

    const info = {
      number: genNumber,
      path: genPath,
      nixosVersion: null,
      kernelVersion: null,
      configurationRevision: null,
      systemPackages: [],
      closureSize: null
    };

    // Get NixOS version
    try {
      const versionPath = path.join(genPath, 'nixos-version');
      if (fs.existsSync(versionPath)) {
        info.nixosVersion = fs.readFileSync(versionPath, 'utf8').trim();
      }
    } catch (e) {}

    // Get kernel version
    try {
      const kernelPath = path.join(genPath, 'kernel');
      if (fs.existsSync(kernelPath)) {
        const kernelLink = fs.realpathSync(kernelPath);
        // Extract version from path like /nix/store/xxx-linux-6.6.1/bzImage
        const match = kernelLink.match(/linux-(\d+\.\d+(?:\.\d+)?)/);
        if (match) {
          info.kernelVersion = match[1];
        }
      }
    } catch (e) {}

    // Get configuration revision (git commit)
    try {
      const revPath = path.join(genPath, 'configuration-revision');
      if (fs.existsSync(revPath)) {
        info.configurationRevision = fs.readFileSync(revPath, 'utf8').trim();
      }
    } catch (e) {}

    // Get closure size
    await new Promise((resolve) => {
      exec(`nix path-info -Sh ${genPath} 2>/dev/null`, (error, stdout) => {
        if (!error && stdout) {
          const parts = stdout.trim().split(/\s+/);
          if (parts.length >= 2) {
            info.closureSize = parts[1];
          }
        }
        resolve();
      });
    });

    return info;
  });

  // Get diff between two generations
  ipcMain.handle('get-generation-diff', async (event, fromGen, toGen) => {
    const profilePath = '/nix/var/nix/profiles/system';
    const fromPath = `${profilePath}-${fromGen}-link`;
    const toPath = `${profilePath}-${toGen}-link`;

    if (!fs.existsSync(fromPath) || !fs.existsSync(toPath)) {
      throw new Error('One or both generations not found');
    }

    return new Promise((resolve, reject) => {
      exec(`nix store diff-closures ${fromPath} ${toPath} 2>/dev/null`, (error, stdout, stderr) => {
        if (error) {
          // nix store diff-closures might not be available on older systems
          resolve({ available: false, error: 'Diff not available' });
          return;
        }

        // Strip ANSI color codes from output
        const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');
        const cleanOutput = stripAnsi(stdout);

        const diff = {
          available: true,
          added: [],
          removed: [],
          changed: [],
          raw: cleanOutput
        };

        const lines = cleanOutput.split('\n').filter(line => line.trim());
        for (const line of lines) {
          // Parse lines like: "package: 1.0 → 2.0, +10.0 MiB" or "package: ∅ → 1.0" or "package: 1.0 → ∅"
          const match = line.match(/^([^:]+):\s*(.+)$/);
          if (match) {
            const pkg = match[1].trim();
            const change = match[2].trim();

            if (change.includes('∅ →')) {
              diff.added.push({ name: pkg, change });
            } else if (change.includes('→ ∅')) {
              diff.removed.push({ name: pkg, change });
            } else if (change.includes('→')) {
              diff.changed.push({ name: pkg, change });
            }
          }
        }

        resolve(diff);
      });
    });
  });

  // Switch to a specific generation
  ipcMain.handle('switch-generation', async (event, genNumber) => {
    const profilePath = '/nix/var/nix/profiles/system';
    const genPath = `${profilePath}-${genNumber}-link`;

    if (!fs.existsSync(genPath)) {
      throw new Error(`Generation ${genNumber} not found`);
    }

    return new Promise((resolve, reject) => {
      // First switch the profile, then activate the configuration
      // Use env to set SHELL explicitly to avoid pkexec SHELL validation issues on NixOS
      const cmd = `pkexec env SHELL=/bin/sh /bin/sh -c "nix-env --switch-generation ${genNumber} --profile ${profilePath} && ${genPath}/bin/switch-to-configuration switch"`;

      exec(cmd, { timeout: 120000, env: { ...process.env, SHELL: '/bin/sh' } }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(`Switched to generation ${genNumber}`);
        }
      });
    });
  });

  // Set a generation for next boot
  ipcMain.handle('boot-generation', async (event, genNumber) => {
    const profilePath = '/nix/var/nix/profiles/system';
    const genPath = `${profilePath}-${genNumber}-link`;

    if (!fs.existsSync(genPath)) {
      throw new Error(`Generation ${genNumber} not found`);
    }

    return new Promise((resolve, reject) => {
      const cmd = `pkexec env SHELL=/bin/sh nix-env --switch-generation ${genNumber} --profile ${profilePath}`;

      exec(cmd, { env: { ...process.env, SHELL: '/bin/sh' } }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(`Generation ${genNumber} will be active on next boot`);
        }
      });
    });
  });

  // Delete a generation
  ipcMain.handle('delete-generation', async (event, genNumber) => {
    const profilePath = '/nix/var/nix/profiles/system';

    return new Promise((resolve, reject) => {
      const cmd = `pkexec env SHELL=/bin/sh nix-env --delete-generations ${genNumber} --profile ${profilePath}`;

      exec(cmd, { env: { ...process.env, SHELL: '/bin/sh' } }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(`Generation ${genNumber} deleted`);
        }
      });
    });
  });
}

module.exports = { register };
