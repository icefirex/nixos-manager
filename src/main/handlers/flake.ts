// @ts-check
import electron from 'electron';
const { ipcMain } = electron as any;
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { findFlakeDir, getSpawnEnv, execAsync, runCmd, flakeDirNotFoundMsg } from '../utils.ts';
import { getMainWindow } from '../window.ts';
import { FLAKE_WARN_DAYS, CMD_TIMEOUT_FAST, NIX_SYSTEM_PROFILE } from '../constants.ts';

/** @type {Record<string, boolean>} */
let inputUpdateStatus: Record<string, boolean> = {};

/**
 * Human-readable relative time from epoch ms
 * @param {number} ms
 * @returns {string}
 */
function relativeTime(ms: any) {
  const diff = Date.now() - ms;
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1)  return 'just now';
  if (h < 24) return `${h}h ago`;
  if (d === 1) return 'yesterday';
  if (d < 30)  return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function getInputUpdateStatus() {
  return inputUpdateStatus;
}

function resetInputUpdateStatus() {
  inputUpdateStatus = {};
}

/**
 * Build the flake input list from a parsed flake.lock.
 * Pure: no fs/network access.
 * @param {any} lockContent
 * @param {Record<string, boolean>} [updateStatus]
 * @returns {Array<{name: string, status: string, age: string, hasUpdate: boolean}>}
 */
function parseFlakeInputs(lockContent: any, updateStatus: Record<string, boolean> = {}) {
  const inputs: any[] = [];
  const nodes = lockContent?.nodes || {};
  const rootInputs: any = nodes.root?.inputs || {};

  for (const [name, nodeRef] of Object.entries(rootInputs) as [string, any][]) {
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

        if (ageDays > FLAKE_WARN_DAYS) {
          status = 'stale';
        }
      }

      inputs.push({ name, status, age, hasUpdate: updateStatus[name] === true });
    }
  }

  return inputs;
}

/**
 * Extract lock metadata for the flake info modal from a parsed flake.lock.
 * Pure: no fs/network access.
 * @param {any} lock
 * @returns {Record<string, any>}
 */
function parseFlakeLockInfo(lock: any) {
  const info: any = {};
  const nodes = lock?.nodes || {};
  const rootInputs: any = nodes.root?.inputs || {};
  const inputNames = Object.keys(rootInputs);
  info.inputCount = inputNames.length;
  info.inputNames = inputNames;

  // nixpkgs details (only when it's a direct string reference, not a follows path)
  const npRef = rootInputs['nixpkgs'];
  if (npRef && typeof npRef === 'string') {
    const npNode = nodes[npRef];
    if (npNode?.locked) {
      info.nixpkgsBranch = npNode.original?.ref || null;
      info.nixpkgsRev    = npNode.locked.rev?.slice(0, 12) || null;
      if (npNode.locked.lastModified) {
        const ms = npNode.locked.lastModified * 1000;
        info.nixpkgsDate     = new Date(ms).toLocaleDateString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric'
        });
        info.nixpkgsRelative = relativeTime(ms);
      }
    }
  }

  return info;
}

/**
 * Check each GitHub-type flake input for upstream changes using git ls-remote.
 * Writes results into inputUpdateStatus in-place.
 */
async function runUpdateChecks(flakeDir: any) {
  const lockPath = path.join(flakeDir, 'flake.lock');
  if (!fs.existsSync(lockPath)) return;

  let lockContent;
  try {
    lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return;
  }

  const nodes = lockContent.nodes || {};
  const rootInputs: any = nodes.root?.inputs || {};
  const env = getSpawnEnv();

  const checks = (Object.entries(rootInputs) as [string, any][]).map(async ([name, nodeRef]) => {
    const node = nodes[nodeRef];
    if (!node?.locked) return;

    const { type, owner, repo, rev } = node.locked;
    if (type !== 'github') return;
    // Skip inputs pinned to a specific commit — no rolling update to check
    if (node.original?.rev) return;

    const branch = node.original?.ref;
    const refSpec = branch ? `refs/heads/${branch}` : 'HEAD';

    try {
      const { stdout } = await execAsync(
        `git ls-remote "https://github.com/${owner}/${repo}.git" "${refSpec}"`,
        { timeout: 15000, env }
      );
      const latestRev = (stdout || '').trim().split(/\s+/)[0];
      inputUpdateStatus[name] = Boolean(latestRev && latestRev !== rev);
    } catch {
      // Network error, private repo, etc. — leave existing status or assume none
      if (!(name in inputUpdateStatus)) inputUpdateStatus[name] = false;
    }
  });

  await Promise.all(checks);
}



type FlakeDeps = {
  ipcMain?: any;
  findFlakeDir?: () => string | null;
  flakeDirNotFoundMsg?: () => string;
  getSpawnEnv?: () => NodeJS.ProcessEnv;
  spawn?: any;
  getMainWindow?: () => any;
  fs?: typeof import('fs');
  runCmd?: (cmd: string, timeout?: number) => Promise<string>;
  getInputUpdateStatus?: () => Record<string, boolean>;
  resetInputUpdateStatus?: () => void;
  runUpdateChecks?: (flakeDir: string) => Promise<void>;
};

/** Shared runner for `nix flake update [...]` spawn flows. */
function runFlakeUpdate(
  deps: FlakeDeps,
  flakeDir: string,
  args: string[],
  title: string,
  onZero: (lockBefore: string | null, lockAfter: string | null) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const mainWindow = deps.getMainWindow?.();
    mainWindow?.webContents.send('terminal-show', { title });

    const fsDep = deps.fs || fs;
    const lockPath = path.join(flakeDir, 'flake.lock');
    const lockBefore = fsDep.existsSync(lockPath) ? fsDep.readFileSync(lockPath, 'utf8') : null;

    const proc = (deps.spawn || spawn)('nix', args, {
      cwd: flakeDir,
      env: deps.getSpawnEnv ? deps.getSpawnEnv() : getSpawnEnv()
    });

    proc.stdout.on('data', (data: any) => {
      mainWindow?.webContents.send('build-output', data.toString());
    });

    proc.stderr.on('data', (data: any) => {
      mainWindow?.webContents.send('build-output', data.toString());
    });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        const lockAfter = fsDep.existsSync(lockPath) ? fsDep.readFileSync(lockPath, 'utf8') : null;
        onZero(lockBefore, lockAfter);
      }
      mainWindow?.webContents.send('build-complete', { success: code === 0 });
      if (code === 0) {
        resolve(args.length > 2 ? `Flake input "${args[2]}" updated` : `Flake inputs updated`);
      } else {
        reject(new Error(`Update failed with code ${code}`));
      }
    });

    proc.on('error', (err: Error) => {
      mainWindow?.webContents.send('build-complete', { success: false });
      reject(err);
    });
  });
}

/** Create flake handlers with dependency injection support. */
function createFlakeHandlers(deps: FlakeDeps = {}) {
  const depsFindFlakeDir = deps.findFlakeDir || findFlakeDir;
  const depsFlakeDirNotFoundMsg = deps.flakeDirNotFoundMsg || flakeDirNotFoundMsg;
  const depsGetInputStatus = deps.getInputUpdateStatus || getInputUpdateStatus;
  const depsResetStatus = deps.resetInputUpdateStatus || resetInputUpdateStatus;
  const depsRunUpdateChecks = deps.runUpdateChecks || runUpdateChecks;
  const depsGetMainWindow = deps.getMainWindow || getMainWindow;
  const depsFs = deps.fs || fs;
  const depsRunCmd = deps.runCmd || runCmd;

  return {
    updateFlakeInputs: async () => {
      const flakeDir = depsFindFlakeDir();
      if (!flakeDir) {
        throw new Error(depsFlakeDirNotFoundMsg());
      }

      return runFlakeUpdate(deps, flakeDir, ['flake', 'update'], 'Updating All Flake Inputs', (before, after) => {
        depsResetStatus();
        const changed = before !== after;
        const summary = changed
          ? '\n✓ All flake inputs updated successfully.'
          : '\n• All flake inputs are already up to date.';
        depsGetMainWindow()?.webContents.send('build-output', summary);
      });
    },

    updateFlakeInput: async (inputName: string) => {
      const flakeDir = depsFindFlakeDir();
      if (!flakeDir) {
        throw new Error(depsFlakeDirNotFoundMsg());
      }

      return runFlakeUpdate(deps, flakeDir, ['flake', 'update', inputName], `Updating ${inputName}`, (before, after) => {
        const changed = before !== after;
        const summary = changed
          ? `\n✓ ${inputName} updated successfully.`
          : `\n• ${inputName} is already up to date.`;
        depsGetMainWindow()?.webContents.send('build-output', summary);
        depsGetInputStatus()[inputName] = false;
      });
    },

    getFlakeInputs: async () => {
      const flakeDir = depsFindFlakeDir();
      if (!flakeDir) {
        return [];
      }

      const lockPath = path.join(flakeDir, 'flake.lock');
      if (!depsFs.existsSync(lockPath)) {
        return [];
      }

      try {
        const lockContent = JSON.parse(depsFs.readFileSync(lockPath, 'utf8'));
        return parseFlakeInputs(lockContent, depsGetInputStatus());
      } catch (e: any) {
        console.error('Failed to parse flake.lock:', e);
        return [];
      }
    },

    checkFlakeInputUpdates: async () => {
      const flakeDir = depsFindFlakeDir();
      if (!flakeDir) return {};

      await depsRunUpdateChecks(flakeDir);

      const status = depsGetInputStatus();
      depsGetMainWindow()?.webContents.send('flake-update-check-complete', status);
      return status;
    },

    getFlakeInfo: async () => {
      const flakeDir = depsFindFlakeDir();
      const info: any = { flakeDir: flakeDir || null };
      if (!flakeDir) return info;

      try {
        const flakeNix = depsFs.readFileSync(path.join(flakeDir, 'flake.nix'), 'utf8');
        const m = flakeNix.match(/description\s*=\s*"([^"]+)"/);
        info.description = m ? m[1] : null;
      } catch { info.description = null; }

      const lockPath = path.join(flakeDir, 'flake.lock');
      if (depsFs.existsSync(lockPath)) {
        try {
          const stats = depsFs.lstatSync(lockPath);
          info.lockUpdated = stats.mtime.toLocaleString();
          info.lockUpdatedRelative = relativeTime(stats.mtimeMs);
        } catch {}

        try {
          const lock = JSON.parse(depsFs.readFileSync(lockPath, 'utf8'));
          Object.assign(info, parseFlakeLockInfo(lock));
        } catch {}
      }

      try {
        const [branch, shortRev, lastLog, statusOut] = await Promise.all([
          depsRunCmd(`git -C "${flakeDir}" branch --show-current 2>/dev/null`,    CMD_TIMEOUT_FAST),
          depsRunCmd(`git -C "${flakeDir}" rev-parse --short HEAD 2>/dev/null`,   CMD_TIMEOUT_FAST),
          depsRunCmd(`git -C "${flakeDir}" log -1 --format="%s|%cr" 2>/dev/null`, CMD_TIMEOUT_FAST),
          depsRunCmd(`git -C "${flakeDir}" status --porcelain 2>/dev/null`,        CMD_TIMEOUT_FAST),
        ]);
        info.gitBranch = branch?.trim()    || null;
        info.gitRev    = shortRev?.trim()  || null;
        if (lastLog) {
          const [msg, when] = lastLog.trim().split('|');
          info.gitLastMsg  = msg?.trim()  || null;
          info.gitLastWhen = when?.trim() || null;
        }
        info.gitDirty = statusOut
          ? statusOut.trim().split('\n').filter(Boolean).length
          : 0;
      } catch {}

      try {
        const link  = depsFs.readlinkSync(NIX_SYSTEM_PROFILE);
        const m     = link.match(/system-(\d+)-link/);
        info.generation        = m ? parseInt(m[1]) : null;
        const stats            = depsFs.lstatSync(NIX_SYSTEM_PROFILE);
        info.lastSwitch        = stats.mtime.toLocaleString();
        info.lastSwitchRelative = relativeTime(stats.mtimeMs);
      } catch {}

      try {
        const osRelease = depsFs.readFileSync('/etc/os-release', 'utf8');
        const m = osRelease.match(/VERSION_ID="?([^"\n]+)"?/);
        info.nixosVersion = m ? m[1] : null;
      } catch {}

      try {
        const raw = await depsRunCmd('nix --version 2>/dev/null', CMD_TIMEOUT_FAST);
        const m = raw?.match(/\(Nix\)\s*([\d.]+)/);
        info.nixVersion = m ? m[1] : (raw?.trim() || null);
      } catch {}

      return info;
    }
  };
}

/** Register flake management IPC handlers */
function register(deps: FlakeDeps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createFlakeHandlers(deps);

  depsIpcMain.handle('update-flake-inputs', async () => {
    return handlers.updateFlakeInputs();
  });

  depsIpcMain.handle('update-flake-input', async (_event: unknown, inputName: string) => {
    return handlers.updateFlakeInput(inputName);
  });

  depsIpcMain.handle('get-flake-inputs', async () => {
    return handlers.getFlakeInputs();
  });

  depsIpcMain.handle('check-flake-input-updates', async () => {
    return handlers.checkFlakeInputUpdates();
  });

  depsIpcMain.handle('get-flake-info', async () => {
    return handlers.getFlakeInfo();
  });
}


export { register, createFlakeHandlers, getInputUpdateStatus, resetInputUpdateStatus, relativeTime, runUpdateChecks, parseFlakeInputs, parseFlakeLockInfo };

export {};
