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
 * Register notifications IPC handlers
 */
function register() {
  ipcMain.handle('get-notifications', async () => {
    const notifications = [];
    const flakeDir = findFlakeDir();

    // 1. Check git sync status (async)
    if (flakeDir) {
      try {
        await runCmd(`git -C "${flakeDir}" fetch --quiet 2>/dev/null || true`, 5000);

        const [behindCount, aheadCount, status] = await Promise.all([
          runCmd(`git -C "${flakeDir}" rev-list --count HEAD..@{u} 2>/dev/null || echo 0`),
          runCmd(`git -C "${flakeDir}" rev-list --count @{u}..HEAD 2>/dev/null || echo 0`),
          runCmd(`git -C "${flakeDir}" status --porcelain 2>/dev/null`)
        ]);

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
      } catch (e) {}
    }

    // 2. Check flake inputs age
    if (flakeDir) {
      try {
        const lockPath = path.join(flakeDir, 'flake.lock');
        if (fs.existsSync(lockPath)) {
          const lockContent = JSON.parse(await fs.promises.readFile(lockPath, 'utf8'));
          const nodes = lockContent.nodes || {};
          const rootInputs = nodes.root?.inputs || {};

          let staleInputs = [];
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

          if (staleInputs.length > 0) {
            staleInputs.sort((a, b) => b.days - a.days);
            // UX-05: list all stale input names; truncate beyond 3
            let nameList;
            if (staleInputs.length <= 3) {
              nameList = staleInputs.map(i => `${i.name} (${i.days}d)`).join(', ');
            } else {
              nameList = staleInputs.slice(0, 2).map(i => `${i.name} (${i.days}d)`).join(', ')
                + ` +${staleInputs.length - 2} more`;
            }
            notifications.push({
              id: 'flake-stale',
              type: 'warning',
              title: 'Flake inputs outdated',
              message: `${staleInputs.length} input(s) older than ${FLAKE_STALE_DAYS} days: ${nameList}`,
              action: 'nix flake update'
            });
          }
        }
      } catch (e) {}
    }

    // 3. Check disk space (async)
    try {
      const dfOutput = await runCmd('df -h / | tail -1');
      const parts = dfOutput.split(/\s+/);
      const percentage = parseInt(parts[4]) || 0;

      if (percentage > DISK_CRITICAL_PCT) {
        notifications.push({
          id: 'disk-critical',
          type: 'error',
          title: 'Disk space critical',
          message: `Root partition ${percentage}% full`,
          action: 'nix-collect-garbage -d'
        });
      } else if (percentage > DISK_WARN_PCT) {
        notifications.push({
          id: 'disk-warning',
          type: 'warning',
          title: 'Disk space low',
          message: `Root partition ${percentage}% full`,
          action: 'nix-collect-garbage -d'
        });
      }
    } catch (e) {}

    // 4. Check generation count
    try {
      const profiles = fs.readdirSync(NIX_PROFILES_DIR)
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
      const updateStatus = getInputUpdateStatus();
      const updatable = Object.entries(updateStatus)
        .filter(([, hasUpdate]) => hasUpdate)
        .map(([name]) => name);

      if (updatable.length > 0) {
        const preview = updatable.slice(0, 3).join(', ') +
          (updatable.length > 3 ? ` +${updatable.length - 3} more` : '');
        notifications.push({
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
        });
      }
    } catch (e) {}

    // 6. Last build status
    const lastBuildStatus = getLastBuildStatus();
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
  });
}

module.exports = { register };
