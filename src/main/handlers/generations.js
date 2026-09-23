const { ipcMain } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { NIX_PROFILES_DIR, NIX_SYSTEM_PROFILE } = require('../constants');

/**
 * Parse the current generation number from a profile symlink target.
 * Pure: no fs access.
 */
function parseCurrentGenerationLink(link) {
  const match = (link || '').match(/system-(\d+)-link/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Map profile directory entries into generation records.
 * Pure: date extraction is delegated to the injected getMtimeIso callback.
 */
function parseGenerationEntries(entries, currentGeneration, profileDir, getMtimeIso = null) {
  const generations = [];
  for (const entry of entries) {
    const match = entry.match(/^system-(\d+)-link$/);
    if (!match) continue;
    const genNumber = parseInt(match[1], 10);
    const genPath = path.join(profileDir, entry);

    let dateStr = '';
    if (getMtimeIso) {
      try {
        dateStr = getMtimeIso(genPath);
      } catch (e) {}
    }

    generations.push({
      number: genNumber,
      date: dateStr,
      current: genNumber === currentGeneration,
      path: genPath
    });
  }
  return generations;
}

/**
 * Parse `nix store diff-closures` output (ANSI stripped) into
 * added/removed/changed buckets. Pure.
 */
function parseClosureDiff(stdout) {
  const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*m/g, '');
  const cleanOutput = stripAnsi(stdout || '');

  const diff = {
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

  return diff;
}

/**
 * Create generation handlers with dependency injection support.
 */
function createGenerationsHandlers(deps = {}) {
  const depsFs = deps.fs || fs;
  const depsExec = deps.exec || exec;
  const profileDir = deps.profileDir || NIX_PROFILES_DIR;
  const profilePath = deps.profilePath || NIX_SYSTEM_PROFILE;

  const genPathFor = (genNumber) => `${profilePath}-${genNumber}-link`;

  return {
    getGenerations: async () => {
      // Determine current generation by following the symlink
      let currentGeneration = null;
      try {
        const profileLink = depsFs.readlinkSync(profilePath);
        currentGeneration = parseCurrentGenerationLink(profileLink);
      } catch (e) {
        console.error('Failed to determine current generation:', e);
      }

      let generations = [];
      try {
        const entries = depsFs.readdirSync(profileDir);
        generations = parseGenerationEntries(
          entries,
          currentGeneration,
          profileDir,
          (p) => depsFs.lstatSync(p).mtime.toISOString()
        );
      } catch (e) {
        throw new Error(`Failed to read generations: ${e.message}`);
      }

      // Sort by generation number descending (newest first)
      generations.sort((a, b) => b.number - a.number);
      return generations;
    },

    getGenerationInfo: async (genNumber) => {
      const genPath = genPathFor(genNumber);

      // Check if generation exists
      if (!depsFs.existsSync(genPath)) {
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
        if (depsFs.existsSync(versionPath)) {
          info.nixosVersion = depsFs.readFileSync(versionPath, 'utf8').trim();
        }
      } catch (e) {}

      // Get kernel version
      try {
        const kernelPath = path.join(genPath, 'kernel');
        if (depsFs.existsSync(kernelPath)) {
          const kernelLink = depsFs.realpathSync(kernelPath);
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
        if (depsFs.existsSync(revPath)) {
          info.configurationRevision = depsFs.readFileSync(revPath, 'utf8').trim();
        }
      } catch (e) {}

      // Get closure size
      await new Promise((resolve) => {
        depsExec(`nix path-info -Sh ${genPath} 2>/dev/null`, (error, stdout) => {
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
    },

    getGenerationDiff: async (fromGen, toGen) => {
      const fromPath = genPathFor(fromGen);
      const toPath = genPathFor(toGen);

      if (!depsFs.existsSync(fromPath) || !depsFs.existsSync(toPath)) {
        throw new Error('One or both generations not found');
      }

      return new Promise((resolve) => {
        depsExec(`nix store diff-closures ${fromPath} ${toPath} 2>/dev/null`, (error, stdout) => {
          if (error) {
            // nix store diff-closures might not be available on older systems
            resolve({ available: false, error: 'Diff not available' });
            return;
          }
          resolve({ available: true, ...parseClosureDiff(stdout) });
        });
      });
    },

    switchGeneration: async (genNumber) => {
      const genPath = genPathFor(genNumber);

      if (!depsFs.existsSync(genPath)) {
        throw new Error(`Generation ${genNumber} not found`);
      }

      return new Promise((resolve, reject) => {
        // First switch the profile, then activate the configuration
        // Use env to set SHELL explicitly to avoid pkexec SHELL validation issues on NixOS
        const cmd = `pkexec env SHELL=/bin/sh /bin/sh -c "nix-env --switch-generation ${genNumber} --profile ${profilePath} && ${genPath}/bin/switch-to-configuration switch"`;

        depsExec(cmd, { timeout: 120000, env: { ...process.env, SHELL: '/bin/sh' } }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(`Switched to generation ${genNumber}`);
          }
        });
      });
    },

    bootGeneration: async (genNumber) => {
      const genPath = genPathFor(genNumber);

      if (!depsFs.existsSync(genPath)) {
        throw new Error(`Generation ${genNumber} not found`);
      }

      return new Promise((resolve, reject) => {
        const cmd = `pkexec env SHELL=/bin/sh nix-env --switch-generation ${genNumber} --profile ${profilePath}`;

        depsExec(cmd, { env: { ...process.env, SHELL: '/bin/sh' } }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(`Generation ${genNumber} will be active on next boot`);
          }
        });
      });
    },

    deleteGeneration: async (genNumber) => {
      return new Promise((resolve, reject) => {
        const cmd = `pkexec env SHELL=/bin/sh nix-env --delete-generations ${genNumber} --profile ${profilePath}`;

        depsExec(cmd, { env: { ...process.env, SHELL: '/bin/sh' } }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(`Generation ${genNumber} deleted`);
          }
        });
      });
    }
  };
}

/**
 * Register generation IPC handlers
 */
function register(deps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createGenerationsHandlers(deps);

  depsIpcMain.handle('get-generations', async () => {
    return handlers.getGenerations();
  });

  depsIpcMain.handle('get-generation-info', async (_event, genNumber) => {
    return handlers.getGenerationInfo(genNumber);
  });

  depsIpcMain.handle('get-generation-diff', async (_event, fromGen, toGen) => {
    return handlers.getGenerationDiff(fromGen, toGen);
  });

  depsIpcMain.handle('switch-generation', async (_event, genNumber) => {
    return handlers.switchGeneration(genNumber);
  });

  depsIpcMain.handle('boot-generation', async (_event, genNumber) => {
    return handlers.bootGeneration(genNumber);
  });

  depsIpcMain.handle('delete-generation', async (_event, genNumber) => {
    return handlers.deleteGeneration(genNumber);
  });
}

module.exports = {
  register,
  createGenerationsHandlers,
  parseCurrentGenerationLink,
  parseGenerationEntries,
  parseClosureDiff,
};
