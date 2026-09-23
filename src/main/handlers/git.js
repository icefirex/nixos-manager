const { ipcMain } = require('electron');
const { findFlakeDir, runCmd, flakeDirNotFoundMsg } = require('../utils');
const path = require('path');
const { CMD_TIMEOUT_FAST, CMD_TIMEOUT_NETWORK } = require('../constants');

/**
 * Extract "owner/repo" from a git remote URL (HTTPS or SSH).
 */
function extractRepoName(remoteUrl) {
  if (!remoteUrl) return null;
  const match = remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : remoteUrl;
}

/**
 * Parse `git branch -a --format=...` output into branch entries,
 * deduped and sorted (current first, local before remote, then by name).
 */
function parseBranchList(output, currentBranch) {
  if (!output) return [];
  const branches = [];
  const lines = output.split('\n').filter(Boolean);
  for (const line of lines) {
    const [name, upstream, track] = line.split('|');
    if (name && !name.startsWith('origin/HEAD')) {
      const isRemote = name.startsWith('origin/');
      branches.push({
        name: isRemote ? name.replace('origin/', '') : name,
        isRemote,
        isCurrent: name === currentBranch,
        upstream: upstream || null,
        track: track || null
      });
    }
  }
  const seen = new Set();
  return branches.filter(b => {
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

/**
 * Parse `git status --porcelain` output into staged/modified/untracked lists.
 */
function parsePorcelainStatus(output) {
  const status = { staged: [], modified: [], untracked: [] };
  if (!output) return status;
  for (const line of output.split('\n').filter(Boolean)) {
    // Parse porcelain format: "XY filename"
    const indexStatus = line[0];
    const workStatus = line[1];
    const file = line.substring(3);
    if (indexStatus !== ' ' && indexStatus !== '?') {
      status.staged.push({ file, status: indexStatus });
    }
    if (workStatus === 'M' || workStatus === 'D') {
      status.modified.push({ file, status: workStatus });
    }
    if (indexStatus === '?' && workStatus === '?') {
      status.untracked.push(file);
    }
  }
  return status;
}

/**
 * Parse `git log --format='%H|%h|%s|%an|%ar'` output into commit entries.
 */
function parseRecentCommits(logOutput) {
  if (!logOutput) return [];
  const commits = [];
  for (const line of logOutput.split('\n').filter(Boolean)) {
    const [hash, shortHash, subject, author, timeAgo] = line.split('|');
    commits.push({ hash, shortHash, subject, author, timeAgo });
  }
  return commits;
}

/**
 * Parse `git show --format='%H%n%s%n%b%n---AUTHOR---...'` output
 * into commit details (message, author, file changes).
 */
function parseCommitInfo(commitInfo) {
  const details = { fullMessage: null, author: null, authorEmail: null, date: null, files: [] };
  if (!commitInfo) return details;

  const parts = commitInfo.split('---AUTHOR---');
  if (parts.length < 2) return details;

  const [hashLine, ...messageParts] = parts[0].trim().split('\n');
  details.fullMessage = messageParts.join('\n').trim();

  const authorParts = parts[1].trim().split('\n');
  details.author = authorParts[0];
  details.authorEmail = authorParts[1];
  details.date = authorParts[2];

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

  return details;
}

/**
 * Create git handlers with dependency injection support.
 */
function createGitHandlers(deps = {}) {
  const depsFindFlakeDir = deps.findFlakeDir || findFlakeDir;
  const depsRunCmd = deps.runCmd || runCmd;
  const depsFlakeDirNotFoundMsg = deps.flakeDirNotFoundMsg || flakeDirNotFoundMsg;

  const requireFlakeDir = () => {
    const flakeDir = depsFindFlakeDir();
    if (!flakeDir) {
      throw new Error(depsFlakeDirNotFoundMsg());
    }
    return flakeDir;
  };

  return {
    getGitInfo: async () => {
      const flakeDir = requireFlakeDir();
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
        const userName = await depsRunCmd(`git -C "${flakeDir}" config user.name 2>/dev/null`);
        info.user = userName?.trim() || null;

        const userEmail = await depsRunCmd(`git -C "${flakeDir}" config user.email 2>/dev/null`);
        info.email = userEmail?.trim() || null;

        // Get remote URL and extract repo name
        const remoteUrl = await depsRunCmd(`git -C "${flakeDir}" remote get-url origin 2>/dev/null`);
        info.remoteUrl = remoteUrl?.trim() || null;
        if (info.remoteUrl) {
          info.repo = extractRepoName(info.remoteUrl);
        }

        // Get current branch
        const branch = await depsRunCmd(`git -C "${flakeDir}" branch --show-current 2>/dev/null`);
        info.branch = branch?.trim() || 'HEAD detached';

        // Get all branches (local and remote)
        const branchesOutput = await depsRunCmd(`git -C "${flakeDir}" branch -a --format='%(refname:short)|%(upstream:short)|%(upstream:track)' 2>/dev/null`);
        info.branches = parseBranchList(branchesOutput, info.branch);

        // Get ahead/behind counts
        const aheadBehind = await depsRunCmd(`git -C "${flakeDir}" rev-list --left-right --count HEAD...@{upstream} 2>/dev/null`);
        if (aheadBehind) {
          const [ahead, behind] = aheadBehind.trim().split(/\s+/);
          info.status.ahead = parseInt(ahead) || 0;
          info.status.behind = parseInt(behind) || 0;
        }

        // Get working tree status
        const statusOutput = await depsRunCmd(`git -C "${flakeDir}" status --porcelain 2>/dev/null`);
        Object.assign(info.status, parsePorcelainStatus(statusOutput));

        // Get recent commits
        const logOutput = await depsRunCmd(
          `git -C "${flakeDir}" log --oneline --format='%H|%h|%s|%an|%ar' -20 2>/dev/null`
        );
        info.recentCommits = parseRecentCommits(logOutput);
      } catch (e) {
        console.error('Failed to get git info:', e.message);
      }

      return info;
    },

    getCommitDetails: async (hash) => {
      const flakeDir = requireFlakeDir();

      const details = {
        hash,
        ...parseCommitInfo(null),
        diff: null
      };

      try {
        // Get commit info
        const commitInfo = await depsRunCmd(
          `git -C "${flakeDir}" show --format='%H%n%s%n%b%n---AUTHOR---%n%an%n%ae%n%ai' --name-status ${hash} 2>/dev/null`
        );
        Object.assign(details, parseCommitInfo(commitInfo));

        // Get diff (limited)
        const diff = await depsRunCmd(
          `git -C "${flakeDir}" show --format='' --stat ${hash} 2>/dev/null | head -50`
        );
        details.diff = diff?.trim() || null;
      } catch (e) {
        console.error('Failed to get commit details:', e.message);
      }

      return details;
    },

    switchBranch: async (branchName) => {
      const flakeDir = requireFlakeDir();

      try {
        const result = await depsRunCmd(`git -C "${flakeDir}" checkout "${branchName}" 2>&1`, CMD_TIMEOUT_FAST);
        return { success: true, message: result?.trim() || 'Switched branch' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    pull: async () => {
      const flakeDir = requireFlakeDir();

      try {
        const result = await depsRunCmd(`git -C "${flakeDir}" pull 2>&1`, CMD_TIMEOUT_NETWORK);
        return { success: true, message: result?.trim() || 'Pulled successfully' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    },

    fetch: async () => {
      const flakeDir = requireFlakeDir();

      try {
        const result = await depsRunCmd(`git -C "${flakeDir}" fetch --all 2>&1`, CMD_TIMEOUT_NETWORK);
        return { success: true, message: result?.trim() || 'Fetched successfully' };
      } catch (e) {
        return { success: false, message: e.message };
      }
    }
  };
}

/**
 * Register git IPC handlers
 */
function register(deps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createGitHandlers(deps);

  depsIpcMain.handle('get-git-info', async () => {
    return handlers.getGitInfo();
  });

  depsIpcMain.handle('get-commit-details', async (_event, hash) => {
    return handlers.getCommitDetails(hash);
  });

  depsIpcMain.handle('git-switch-branch', async (_event, branchName) => {
    return handlers.switchBranch(branchName);
  });

  depsIpcMain.handle('git-pull', async () => {
    return handlers.pull();
  });

  depsIpcMain.handle('git-fetch', async () => {
    return handlers.fetch();
  });
}

module.exports = {
  register,
  createGitHandlers,
  extractRepoName,
  parseBranchList,
  parsePorcelainStatus,
  parseRecentCommits,
  parseCommitInfo,
};
