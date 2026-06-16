const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const { CMD_TIMEOUT_DEFAULT, NIX_CURRENT_SYSTEM } = require('./constants');

const execAsync = util.promisify(exec);

// Track last build status in memory
let lastBuildStatus = null;

/**
 * Find the flake directory by checking common locations
 */
function findFlakeDir() {
  const candidates = [
    process.env.FLAKE_DIR,
    path.join(os.homedir(), 'nixos-config'),
    path.join(os.homedir(), '.config/nixos'),
    '/etc/nixos'
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'flake.nix'))) {
      return dir;
    }
  }
  return null;
}

/**
 * Run a shell command asynchronously with timeout
 */
async function runCmd(cmd, timeout = CMD_TIMEOUT_DEFAULT) {
  try {
    const { stdout } = await execAsync(cmd, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 1024 * 1024
    });
    return stdout.trimEnd();
  } catch (e) {
    // Log failures so they're visible in dev tools / stderr; return '' to preserve caller compatibility
    const reason = e.code === 'ETIMEDOUT' ? 'timeout' : (e.code || e.message || 'error');
    console.error(`[runCmd] failed (${reason}):`, cmd.slice(0, 120));
    return '';
  }
}

/**
 * Update build status (called after rebuilds)
 */
function updateBuildStatus(success, message) {
  lastBuildStatus = {
    success,
    message,
    time: new Date().toLocaleString()
  };
}

/**
 * Get last build status
 */
function getLastBuildStatus() {
  return lastBuildStatus;
}

/**
 * Get spawn environment with color support
 */
function getSpawnEnv() {
  return {
    ...process.env,
    PATH: `${NIX_CURRENT_SYSTEM}/sw/bin:${process.env.PATH || ''}`,
    TERM: 'xterm-256color',
    FORCE_COLOR: '3',
    CLICOLOR_FORCE: '1',
    COLORTERM: 'truecolor',
  };
}

/**
 * Get a user-friendly error message when no flake directory is found
 */
function flakeDirNotFoundMsg() {
  const candidates = [
    '$FLAKE_DIR (environment variable)',
    '~/nixos-config',
    '~/.config/nixos',
    '/etc/nixos'
  ];
  return [
    'Could not find a NixOS flake directory.',
    '',
    'The app looked in:',
    ...candidates.map(c => `  • ${c}`),
    '',
    'To fix this, either:',
    '  • Set the FLAKE_DIR environment variable to point to your flake configuration, e.g.',
    '      export FLAKE_DIR=/home/me/my-nixos-config',
    '  • Place your flake.nix in one of the default locations above',
    '  • Symlink your config to one of the default locations',
  ].join('\n');
}

module.exports = {
  findFlakeDir,
  runCmd,
  execAsync,
  updateBuildStatus,
  getLastBuildStatus,
  getSpawnEnv,
  flakeDirNotFoundMsg
};
