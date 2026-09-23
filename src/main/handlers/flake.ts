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
function relativeTime(ms) {
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

/**
 * Build the flake input list from a parsed flake.lock.
 * Pure: no fs/network access.
 * @param {any} lockContent
 * @param {Record<string, boolean>} [updateStatus]
 * @returns {Array<{name: string, status: string, age: string, hasUpdate: boolean}>}
 */
function parseFlakeInputs(lockContent, updateStatus = {}) {
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
function parseFlakeLockInfo(lock) {
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
async function runUpdateChecks(flakeDir) {
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

/**
 * Register flake management IPC handlers
 */
function register() {
  // Update all flake inputs
  ipcMain.handle('update-flake-inputs', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }

    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('terminal-show', { title: 'Updating All Flake Inputs' });

    const lockPath = path.join(flakeDir, 'flake.lock');
    const lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;

    return new Promise<any>((resolve, reject) => {
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
          // Clear all cached update statuses — every input was just updated
          inputUpdateStatus = {};
          const lockAfter = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;
          const changed = lockBefore !== lockAfter;
          const summary = changed
            ? '\n✓ All flake inputs updated successfully.'
            : '\n• All flake inputs are already up to date.';
          mainWindow?.webContents.send('build-output', summary);
        }
        mainWindow?.webContents.send('build-complete', { success: code === 0 });
        if (code === 0) {
          resolve('Flake inputs updated');
        } else {
          reject(new Error(`Update failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        mainWindow?.webContents.send('build-complete', { success: false });
        reject(err);
      });
    });
  });

  // Update a single flake input
  ipcMain.handle('update-flake-input', async (event, inputName) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }

    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('terminal-show', { title: `Updating ${inputName}` });

    const lockPath = path.join(flakeDir, 'flake.lock');
    const lockBefore = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;

    return new Promise<any>((resolve, reject) => {
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
          const lockAfter = fs.existsSync(lockPath) ? fs.readFileSync(lockPath, 'utf8') : null;
          const changed = lockBefore !== lockAfter;
          const summary = changed
            ? `\n✓ ${inputName} updated successfully.`
            : `\n• ${inputName} is already up to date.`;
          mainWindow?.webContents.send('build-output', summary);
          // Clear cached update status for this input — badge disappears immediately
          inputUpdateStatus[inputName] = false;
        }
        mainWindow?.webContents.send('build-complete', { success: code === 0 });
        if (code === 0) {
          resolve(`Flake input "${inputName}" updated`);
        } else {
          reject(new Error(`Update failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        mainWindow?.webContents.send('build-complete', { success: false });
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
      return parseFlakeInputs(lockContent, inputUpdateStatus);
    } catch (e: any) {
      console.error('Failed to parse flake.lock:', e);
      return [];
    }
  });
  // Background check: detect available upstream updates for all GitHub-type inputs
  ipcMain.handle('check-flake-input-updates', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) return {};

    await runUpdateChecks(flakeDir);

    const mainWindow = getMainWindow();
    mainWindow?.webContents.send('flake-update-check-complete', inputUpdateStatus);

    return inputUpdateStatus;
  });

  // Flake info for the info modal
  ipcMain.handle('get-flake-info', async () => {
    const flakeDir = findFlakeDir();
    const info: any = { flakeDir: flakeDir || null };
    if (!flakeDir) return info;

    // Description from flake.nix
    try {
      const flakeNix = fs.readFileSync(path.join(flakeDir, 'flake.nix'), 'utf8');
      const m = flakeNix.match(/description\s*=\s*"([^"]+)"/);
      info.description = m ? m[1] : null;
    } catch { info.description = null; }

    // flake.lock — input list + nixpkgs pin info
    const lockPath = path.join(flakeDir, 'flake.lock');
    if (fs.existsSync(lockPath)) {
      try {
        const stats = fs.lstatSync(lockPath);
        info.lockUpdated = stats.mtime.toLocaleString();
        info.lockUpdatedRelative = relativeTime(stats.mtimeMs);
      } catch {}

      try {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        Object.assign(info, parseFlakeLockInfo(lock));
      } catch {}
    }

    // Git info (local only — no network call)
    try {
      const [branch, shortRev, lastLog, statusOut] = await Promise.all([
        runCmd(`git -C "${flakeDir}" branch --show-current 2>/dev/null`,    CMD_TIMEOUT_FAST),
        runCmd(`git -C "${flakeDir}" rev-parse --short HEAD 2>/dev/null`,   CMD_TIMEOUT_FAST),
        runCmd(`git -C "${flakeDir}" log -1 --format="%s|%cr" 2>/dev/null`, CMD_TIMEOUT_FAST),
        runCmd(`git -C "${flakeDir}" status --porcelain 2>/dev/null`,        CMD_TIMEOUT_FAST),
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

    // Current system profile (generation + last switch time)
    try {
      const link  = fs.readlinkSync(NIX_SYSTEM_PROFILE);
      const m     = link.match(/system-(\d+)-link/);
      info.generation        = m ? parseInt(m[1]) : null;
      const stats            = fs.lstatSync(NIX_SYSTEM_PROFILE);
      info.lastSwitch        = stats.mtime.toLocaleString();
      info.lastSwitchRelative = relativeTime(stats.mtimeMs);
    } catch {}

    // NixOS version
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const m = osRelease.match(/VERSION_ID="?([^"\n]+)"?/);
      info.nixosVersion = m ? m[1] : null;
    } catch {}

    // Nix version (strip to just the semver number)
    try {
      const raw = await runCmd('nix --version 2>/dev/null', CMD_TIMEOUT_FAST);
      const m = raw?.match(/\(Nix\)\s*([\d.]+)/);
      info.nixVersion = m ? m[1] : (raw?.trim() || null);
    } catch {}

    return info;
  });
}

export { register, getInputUpdateStatus, relativeTime, runUpdateChecks, parseFlakeInputs, parseFlakeLockInfo };

export {};
