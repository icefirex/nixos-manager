// @ts-check
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { findFlakeDir, getLastBuildStatus, runCmd } = require('../utils');
const { getInputUpdateStatus } = require('./flake');
const {
  NIX_PROFILES_DIR,
  FLAKE_STALE_DAYS,
  DISK_CRITICAL_PCT,
  DISK_WARN_PCT,
  MAX_GENERATIONS_WARN,
} = require('../constants');

/**
 * @typedef {Object} NotificationsDeps
 * @property {import('electron').IpcMain} [ipcMain]
 * @property {() => string | null} [findFlakeDir]
 * @property {(cmd: string, timeout?: number) => Promise<string>} [runCmd]
 * @property {typeof import('fs')} [fs]
 * @property {() => Record<string, boolean>} [getInputUpdateStatus]
 * @property {() => import('../utils').BuildStatus | null} [getLastBuildStatus]
 */

/**
 * Build git sync notifications from ahead/behind counts and porcelain status.
 * Pure.
 * @param {string} behindCount
 * @param {string} aheadCount
 * @param {string | null} status
 * @returns {Array<{id: string, type: string, title: string, message: string, action: string | null}>}
 */
function buildGitSyncNotifications(behindCount, aheadCount, status) {
  const notifications = [];

  if (parseInt(behindCount) > 0) {
    notifications.push({
      id: 'git-behind',
      type: 'warning',
      title: 'Repository out of sync',
      message: `Local is ${behindCount} commit(s) behind remote`,
      action: 'git pull'
    });
  }
  if (parseInt(aheadCount) > 0) {
    notifications.push({
      id: 'git-ahead',
      type: 'info',
      title: 'Unpushed changes',
      message: `${aheadCount} local commit(s) not pushed`,
      action: 'git push'
    });
  }

  if (status) {
    const lines = status.split('\n').filter(l => l).length;
    notifications.push({
      id: 'git-dirty',
      type: 'info',
      title: 'Uncommitted changes',
      message: `${lines} file(s) with uncommitted changes`,
      action: null
    });
  }

  return notifications;
}

/**
 * Collect stale flake inputs (older than FLAKE_STALE_DAYS) from a parsed lock.
 * Pure. Returns [{ name, days }] sorted by age descending.
 * @param {any} lockContent
 * @returns {Array<{name: string, days: number}>}
 */
function collectStaleInputs(lockContent) {
  const nodes = lockContent?.nodes || {};
  const rootInputs = nodes.root?.inputs || {};

  const staleInputs = [];
  for (const [name, nodeRef] of Object.entries(rootInputs)) {
    const node = nodes[nodeRef];
    if (node && node.locked && node.locked.lastModified) {
      const ageMs = Date.now() - (node.locked.lastModified * 1000);
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
      if (ageDays > FLAKE_STALE_DAYS) {
        staleInputs.push({ name, days: ageDays });
      }
    }
  }

  staleInputs.sort((a, b) => b.days - a.days);
  return staleInputs;
}

/**
 * Build the stale-inputs notification from collected inputs.
 * Pure. Returns null when nothing is stale.
 * @param {Array<{name: string, days: number}> | null} staleInputs
 * @returns {{id: string, type: string, title: string, message: string, action: string} | null}
 */
function buildStaleInputsNotification(staleInputs) {
  if (!staleInputs || staleInputs.length === 0) return null;

  // UX-05: list all stale input names; truncate beyond 3
  let nameList;
  if (staleInputs.length <= 3) {
    nameList = staleInputs.map(i => `${i.name} (${i.days}d)`).join(', ');
  } else {
    nameList = staleInputs.slice(0, 2).map(i => `${i.name} (${i.days}d)`).join(', ')
      + ` +${staleInputs.length - 2} more`;
  }

  return {
    id: 'flake-stale',
    type: 'warning',
    title: 'Flake inputs outdated',
    message: `${staleInputs.length} input(s) older than ${FLAKE_STALE_DAYS} days: ${nameList}`,
    action: 'nix flake update'
  };
}

/**
 * Build a disk space notification from a usage percentage.
 * Pure. Returns null below the warning threshold.
 * @param {number} percentage
 * @returns {{id: string, type: string, title: string, message: string, action: string} | null}
 */
function buildDiskNotification(percentage) {
  if (percentage > DISK_CRITICAL_PCT) {
    return {
      id: 'disk-critical',
      type: 'error',
      title: 'Disk space critical',
      message: `Root partition ${percentage}% full`,
      action: 'nix-collect-garbage -d'
    };
  }
  if (percentage > DISK_WARN_PCT) {
    return {
      id: 'disk-warning',
      type: 'warning',
      title: 'Disk space low',
      message: `Root partition ${percentage}% full`,
      action: 'nix-collect-garbage -d'
    };
  }
  return null;
}

/**
 * Build the flake-updates-available notification from cached update status.
 * Pure. Returns null when nothing is updatable.
 * @param {Record<string, boolean> | undefined} updateStatus
 * @returns {{id: string, type: string, title: string, message: string, action: string} | null}
 */
function buildFlakeUpdatesNotification(updateStatus) {
  const updatable = Object.entries(updateStatus || {})
    .filter(([, hasUpdate]) => hasUpdate)
    .map(([name]) => name);

  if (updatable.length === 0) return null;

  const preview = updatable.slice(0, 3).join(', ') +
    (updatable.length > 3 ? ` +${updatable.length - 3} more` : '');

  return {
    id: 'flake-updates-available',
    type: 'info',
    title: updatable.length === 1
      ? 'Flake update available'
      : `${updatable.length} flake updates available`,
    message: updatable.length === 1
      ? `${updatable[0]} has a newer version available`
      : preview,
    action: updatable.length === 1
      ? `nix flake update ${updatable[0]}`
      : 'nix flake update'
  };
}

/**
 * Create notifications handlers with dependency injection support.
 * @param {NotificationsDeps} [deps]
 */
function createNotificationsHandlers(deps = {}) {
  const depsFindFlakeDir = deps.findFlakeDir || findFlakeDir;
  const depsRunCmd = deps.runCmd || runCmd;
  const depsFs = deps.fs || fs;
  const depsGetInputUpdateStatus = deps.getInputUpdateStatus || getInputUpdateStatus;
  const depsGetLastBuildStatus = deps.getLastBuildStatus || getLastBuildStatus;

  return {
    getNotifications: async () => {
      const notifications = [];
      const flakeDir = depsFindFlakeDir();

      // 1. Check git sync status (async)
      if (flakeDir) {
        try {
          await depsRunCmd(`git -C "${flakeDir}" fetch --quiet 2>/dev/null || true`, 5000);

          const [behindCount, aheadCount, status] = await Promise.all([
            depsRunCmd(`git -C "${flakeDir}" rev-list --count HEAD..@{u} 2>/dev/null || echo 0`),
            depsRunCmd(`git -C "${flakeDir}" rev-list --count @{u}..HEAD 2>/dev/null || echo 0`),
            depsRunCmd(`git -C "${flakeDir}" status --porcelain 2>/dev/null`)
          ]);

          notifications.push(...buildGitSyncNotifications(behindCount, aheadCount, status));
        } catch (e) {}
      }

      // 2. Check flake inputs age
      if (flakeDir) {
        try {
          const lockPath = path.join(flakeDir, 'flake.lock');
          if (depsFs.existsSync(lockPath)) {
            const lockContent = JSON.parse(await depsFs.promises.readFile(lockPath, 'utf8'));
            const staleNotification = buildStaleInputsNotification(collectStaleInputs(lockContent));
            if (staleNotification) {
              notifications.push(staleNotification);
            }
          }
        } catch (e) {}
      }

      // 3. Check disk space (async)
      try {
        const dfOutput = await depsRunCmd('df -h / | tail -1');
        const parts = dfOutput.split(/\s+/);
        const percentage = parseInt(parts[4]) || 0;
        const diskNotification = buildDiskNotification(percentage);
        if (diskNotification) {
          notifications.push(diskNotification);
        }
      } catch (e) {}

      // 4. Check generation count
      try {
        const profiles = depsFs.readdirSync(NIX_PROFILES_DIR)
          .filter(f => f.startsWith('system-') && f.endsWith('-link'));
        const genCount = profiles.length;

        if (genCount > MAX_GENERATIONS_WARN) {
          notifications.push({
            id: 'generations-many',
            type: 'info',
            title: 'Many generations',
            message: `${genCount} system generations stored`,
            action: 'nix-collect-garbage --delete-older-than 14d'
          });
        }
      } catch (e) {}

      // 5. Flake input updates available (from background check cache)
      try {
        const updatesNotification = buildFlakeUpdatesNotification(depsGetInputUpdateStatus());
        if (updatesNotification) {
          notifications.push(updatesNotification);
        }
      } catch (e) {}

      // 6. Last build status
      const lastBuildStatus = depsGetLastBuildStatus();
      if (lastBuildStatus) {
        notifications.push({
          id: 'last-build',
          type: lastBuildStatus.success ? 'success' : 'error',
          title: lastBuildStatus.success ? 'Last build succeeded' : 'Last build failed',
          message: lastBuildStatus.message,
          action: null,
          time: lastBuildStatus.time
        });
      }

      return notifications;
    }
  };
}

/**
 * Register notifications IPC handlers
 * @param {NotificationsDeps} [deps]
 */
function register(deps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createNotificationsHandlers(deps);

  depsIpcMain.handle('get-notifications', async () => {
    return handlers.getNotifications();
  });
}

module.exports = {
  register,
  createNotificationsHandlers,
  buildGitSyncNotifications,
  collectStaleInputs,
  buildStaleInputsNotification,
  buildDiskNotification,
  buildFlakeUpdatesNotification,
};
