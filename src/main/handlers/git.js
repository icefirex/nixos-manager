const { ipcMain } = require('electron');
const { findFlakeDir, runCmd, flakeDirNotFoundMsg } = require('../utils');
const path = require('path');
const { CMD_TIMEOUT_FAST, CMD_TIMEOUT_NETWORK } = require('../constants');

/**
 * Register git IPC handlers
 */
function register() {
  // Get comprehensive git info
  ipcMain.handle('get-git-info', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }

    const info = {
      user: null,
      email: null,
      repo: null,
      remoteUrl: null,
      branch: null,
      branches: [],
      status: {
        staged: [],
        modified: [],
        untracked: [],
        ahead: 0,
        behind: 0
      },
      recentCommits: []
    };

    try {
      // Get git user info
      const userName = await runCmd(`git -C "${flakeDir}" config user.name 2>/dev/null`);
      info.user = userName?.trim() || null;

      const userEmail = await runCmd(`git -C "${flakeDir}" config user.email 2>/dev/null`);
      info.email = userEmail?.trim() || null;

      // Get remote URL and extract repo name
      const remoteUrl = await runCmd(`git -C "${flakeDir}" remote get-url origin 2>/dev/null`);
      info.remoteUrl = remoteUrl?.trim() || null;
      if (info.remoteUrl) {
        // Extract repo name from URL (handles both HTTPS and SSH)
        const match = info.remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        info.repo = match ? match[1] : info.remoteUrl;
      }

      // Get current branch
      const branch = await runCmd(`git -C "${flakeDir}" branch --show-current 2>/dev/null`);
      info.branch = branch?.trim() || 'HEAD detached';

      // Get all branches (local and remote)
      const branchesOutput = await runCmd(`git -C "${flakeDir}" branch -a --format='%(refname:short)|%(upstream:short)|%(upstream:track)' 2>/dev/null`);
      if (branchesOutput) {
        const lines = branchesOutput.split('\n').filter(Boolean);
        for (const line of lines) {
          const [name, upstream, track] = line.split('|');
          if (name && !name.startsWith('origin/HEAD')) {
            const isRemote = name.startsWith('origin/');
            const isCurrent = name === info.branch;
            info.branches.push({
              name: isRemote ? name.replace('origin/', '') : name,
              isRemote,
              isCurrent,
              upstream: upstream || null,
              track: track || null
            });
          }
        }
        // Dedupe and sort
        const seen = new Set();
        info.branches = info.branches.filter(b => {
          const key = b.name + (b.isRemote ? '-remote' : '-local');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).sort((a, b) => {
          if (a.isCurrent) return -1;
          if (b.isCurrent) return 1;
          if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
          return a.name.localeCompare(b.name);
        });
      }

      // Get ahead/behind counts
      const aheadBehind = await runCmd(`git -C "${flakeDir}" rev-list --left-right --count HEAD...@{upstream} 2>/dev/null`);
      if (aheadBehind) {
        const [ahead, behind] = aheadBehind.trim().split(/\s+/);
        info.status.ahead = parseInt(ahead) || 0;
        info.status.behind = parseInt(behind) || 0;
      }

      // Get working tree status
      const statusOutput = await runCmd(`git -C "${flakeDir}" status --porcelain 2>/dev/null`);
      if (statusOutput) {
        const lines = statusOutput.split('\n').filter(Boolean);
        for (const line of lines) {
          // Parse porcelain format: "XY filename"
          const indexStatus = line[0];
          const workStatus = line[1];
          const file = line.substring(3);
          if (indexStatus !== ' ' && indexStatus !== '?') {
            info.status.staged.push({ file, status: indexStatus });
          }
          if (workStatus === 'M' || workStatus === 'D') {
            info.status.modified.push({ file, status: workStatus });
          }
          if (indexStatus === '?' && workStatus === '?') {
            info.status.untracked.push(file);
          }
        }
      }

      // Get recent commits
      const logOutput = await runCmd(
        `git -C "${flakeDir}" log --oneline --format='%H|%h|%s|%an|%ar' -20 2>/dev/null`
      );
      if (logOutput) {
        const lines = logOutput.split('\n').filter(Boolean);
        for (const line of lines) {
          const [hash, shortHash, subject, author, timeAgo] = line.split('|');
          info.recentCommits.push({ hash, shortHash, subject, author, timeAgo });
        }
      }
    } catch (e) {
      console.error('Failed to get git info:', e.message);
    }

    return info;
  });

  // Get commit details
  ipcMain.handle('get-commit-details', async (event, hash) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }

    const details = {
      hash,
      fullMessage: null,
      author: null,
      authorEmail: null,
      date: null,
      files: [],
      diff: null
    };

    try {
      // Get commit info
      const commitInfo = await runCmd(
        `git -C "${flakeDir}" show --format='%H%n%s%n%b%n---AUTHOR---%n%an%n%ae%n%ai' --name-status ${hash} 2>/dev/null`
      );

      if (commitInfo) {
        const parts = commitInfo.split('---AUTHOR---');
        if (parts.length >= 2) {
          const [hashLine, ...messageParts] = parts[0].trim().split('\n');
          details.fullMessage = messageParts.join('\n').trim();

          const authorParts = parts[1].trim().split('\n');
          details.author = authorParts[0];
          details.authorEmail = authorParts[1];
          details.date = authorParts[2];

          // Parse file changes
          for (let i = 3; i < authorParts.length; i++) {
            const line = authorParts[i];
            if (line) {
              const [status, ...fileParts] = line.split('\t');
              const file = fileParts.join('\t');
              if (file) {
                details.files.push({ status, file });
              }
            }
          }
        }
      }

      // Get diff (limited)
      const diff = await runCmd(
        `git -C "${flakeDir}" show --format='' --stat ${hash} 2>/dev/null | head -50`
      );
      details.diff = diff?.trim() || null;

    } catch (e) {
      console.error('Failed to get commit details:', e.message);
    }

    return details;
  });

  // Switch branch
  ipcMain.handle('git-switch-branch', async (event, branchName) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }

    try {
      const result = await runCmd(`git -C "${flakeDir}" checkout "${branchName}" 2>&1`, CMD_TIMEOUT_FAST);
      return { success: true, message: result?.trim() || 'Switched branch' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  // Git pull
  ipcMain.handle('git-pull', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }

    try {
      const result = await runCmd(`git -C "${flakeDir}" pull 2>&1`, CMD_TIMEOUT_NETWORK);
      return { success: true, message: result?.trim() || 'Pulled successfully' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });

  // Git fetch
  ipcMain.handle('git-fetch', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }

    try {
      const result = await runCmd(`git -C "${flakeDir}" fetch --all 2>&1`, CMD_TIMEOUT_NETWORK);
      return { success: true, message: result?.trim() || 'Fetched successfully' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  });
}

module.exports = { register };
