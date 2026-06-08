const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { findFlakeDir, getLastBuildStatus, runCmd } = require('../utils');

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
        await runCmd('git fetch --quiet 2>/dev/null || true', 5000);

        const [behindCount, aheadCount, status] = await Promise.all([
          runCmd('git rev-list --count HEAD..@{u} 2>/dev/null || echo 0'),
          runCmd('git rev-list --count @{u}..HEAD 2>/dev/null || echo 0'),
          runCmd('git status --porcelain 2>/dev/null')
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
          const lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          const nodes = lockContent.nodes || {};
          const rootInputs = nodes.root?.inputs || {};

          let staleInputs = [];
          for (const [name, nodeRef] of Object.entries(rootInputs)) {
            const node = nodes[nodeRef];
            if (node && node.locked && node.locked.lastModified) {
              const ageMs = Date.now() - (node.locked.lastModified * 1000);
              const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
              if (ageDays > 14) {
                staleInputs.push({ name, days: ageDays });
              }
            }
          }

          if (staleInputs.length > 0) {
            const oldest = staleInputs.sort((a, b) => b.days - a.days)[0];
            notifications.push({
              id: 'flake-stale',
              type: 'warning',
              title: 'Flake inputs outdated',
              message: `${staleInputs.length} input(s) older than 14 days (${oldest.name}: ${oldest.days}d)`,
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

      if (percentage > 90) {
        notifications.push({
          id: 'disk-critical',
          type: 'error',
          title: 'Disk space critical',
          message: `Root partition ${percentage}% full`,
          action: 'nix-collect-garbage -d'
        });
      } else if (percentage > 80) {
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
      const profiles = fs.readdirSync('/nix/var/nix/profiles')
        .filter(f => f.startsWith('system-') && f.endsWith('-link'));
      const genCount = profiles.length;

      if (genCount > 20) {
        notifications.push({
          id: 'generations-many',
          type: 'info',
          title: 'Many generations',
          message: `${genCount} system generations stored`,
          action: 'nix-collect-garbage --delete-older-than 14d'
        });
      }
    } catch (e) {}

    // 5. Last build status
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
