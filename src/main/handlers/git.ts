// @ts-check
import electron from 'electron';
const { ipcMain } = electron as any;
import { findFlakeDir, runCmd, flakeDirNotFoundMsg } from '../utils.ts';
import path from 'path';
import { CMD_TIMEOUT_FAST, CMD_TIMEOUT_NETWORK } from '../constants.ts';

type GitDeps = {
  findFlakeDir?: () => string | null;
  runCmd?: (cmd: string, timeout?: number) => Promise<string>;
  flakeDirNotFoundMsg?: () => string;
  ipcMain?: import('electron').IpcMain;
};

/**
 * Extract "owner/repo" from a git remote URL (HTTPS or SSH).
 * @param {string | null} remoteUrl
 * @returns {string | null}
 */
function extractRepoName(remoteUrl: any) {
  if (!remoteUrl) return null;
  const match = remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : remoteUrl;
}

/**
 * Parse `git branch -a --format=...` output into branch entries,
 * deduped and sorted (current first, local before remote, then by name).
 * @param {string | null} output
 * @param {string | null} currentBranch
 * @returns {Array<{name: string, isRemote: boolean, isCurrent: boolean, upstream: string | null, track: string | null}>}
 */
function parseBranchList(output: any, currentBranch: any) {
  if (!output) return [];
  const branches: any[] = [];
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
 * @param {string | null} output
 * @returns {{staged: Array<{file: string, status: string}>, modified: Array<{file: string, status: string}>, untracked: string[]}}
 */
function parsePorcelainStatus(output: any) {
  const status: any = { staged: [], modified: [], untracked: [] };
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
 * @param {string | null} logOutput
 * @returns {Array<{hash: string, shortHash: string, subject: string, author: string, timeAgo: string}>}
 */
function parseRecentCommits(logOutput: any) {
  if (!logOutput) return [];
  const commits: any[] = [];
  for (const line of logOutput.split('\n').filter(Boolean)) {
    const [hash, shortHash, subject, author, timeAgo] = line.split('|');
    commits.push({ hash, shortHash, subject, author, timeAgo });
  }
  return commits;
}

/**
 * Parse `git show --format='%H%n%s%n%b%n---AUTHOR---...'` output
 * into commit details (message, author, file changes).
 * @param {string | null} commitInfo
 * @returns {{fullMessage: string | null, author: string | null, authorEmail: string | null, date: string | null, files: Array<{status: string, file: string}>}}
 */
function parseCommitInfo(commitInfo: any) {
  const details: any = { fullMessage: null, author: null, authorEmail: null, date: null, files: [] };
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
 * @param {GitDeps} [deps]
 */
function createGitHandlers(deps: GitDeps = {}) {
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
      const info: any = {
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
      } catch (e: any) {
        console.error('Failed to get git info:', e.message);
      }

      return info;
    },

    getCommitDetails: async (hash: any) => {
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
      } catch (e: any) {
        console.error('Failed to get commit details:', e.message);
      }

      return details;
    },

    switchBranch: async (branchName: any) => {
      const flakeDir = requireFlakeDir();

      try {
        const result = await depsRunCmd(`git -C "${flakeDir}" checkout "${branchName}" 2>&1`, CMD_TIMEOUT_FAST);
        return { success: true, message: result?.trim() || 'Switched branch' };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    },

    pull: async () => {
      const flakeDir = requireFlakeDir();

      try {
        const result = await depsRunCmd(`git -C "${flakeDir}" pull 2>&1`, CMD_TIMEOUT_NETWORK);
        return { success: true, message: result?.trim() || 'Pulled successfully' };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    },

    fetch: async () => {
      const flakeDir = requireFlakeDir();

      try {
        const result = await depsRunCmd(`git -C "${flakeDir}" fetch --all 2>&1`, CMD_TIMEOUT_NETWORK);
        return { success: true, message: result?.trim() || 'Fetched successfully' };
      } catch (e: any) {
        return { success: false, message: e.message };
      }
    }
  };
}

/**
 * Register git IPC handlers
 * @param {GitDeps} [deps]
 */
function register(deps: GitDeps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createGitHandlers(deps);

  depsIpcMain.handle('get-git-info', async () => {
    return handlers.getGitInfo();
  });

  depsIpcMain.handle('get-commit-details', async (_event: any, hash: any) => {
    return handlers.getCommitDetails(hash);
  });

  depsIpcMain.handle('git-switch-branch', async (_event: any, branchName: any) => {
    return handlers.switchBranch(branchName);
  });

  depsIpcMain.handle('git-pull', async () => {
    return handlers.pull();
  });

  depsIpcMain.handle('git-fetch', async () => {
    return handlers.fetch();
  });
}

export { register, createGitHandlers, extractRepoName, parseBranchList, parsePorcelainStatus, parseRecentCommits, parseCommitInfo };

export {};
