// @ts-check
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import util from 'util';
import { CMD_TIMEOUT_DEFAULT, NIX_CURRENT_SYSTEM } from './constants.ts';

const execAsync = util.promisify(exec);

export type BuildStatus = {
  success: boolean;
  message: string;
  time: string;
};

/** @type {BuildStatus | null} */
let lastBuildStatus: BuildStatus | null = null;

/**
 * Find the flake directory by checking common locations
 * @returns {string | null}
 */
function findFlakeDir() {
  const candidates = [
    process.env.FLAKE_DIR,
    path.join(os.homedir(), 'nixos-config'),
    path.join(os.homedir(), '.config/nixos'),
    '/etc/nixos'
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'flake.nix'))) {
      return dir;
    }
  }
  return null;
}

/**
 * Run a shell command asynchronously with timeout
 * @param {string} cmd
 * @param {number} [timeout]
 * @returns {Promise<string>}
 */
async function runCmd(cmd: any, timeout = CMD_TIMEOUT_DEFAULT) {
  try {
    const { stdout } = await execAsync(cmd, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 1024 * 1024
    });
    return stdout.trimEnd();
  } catch (e: any) {
    // Log failures so they're visible in dev tools / stderr; return '' to preserve caller compatibility
    const err = e as any;
    const reason = err.code === 'ETIMEDOUT' ? 'timeout' : (err.code || err.message || 'error');
    console.error(`[runCmd] failed (${reason}):`, cmd.slice(0, 120));
    return '';
  }
}

/**
 * Update build status (called after rebuilds)
 * @param {boolean} success
 * @param {string} message
 * @returns {void}
 */
function updateBuildStatus(success: any, message: any) {
  lastBuildStatus = {
    success,
    message,
    time: new Date().toLocaleString()
  };
}

/**
 * Get last build status
 * @returns {BuildStatus | null}
 */
function getLastBuildStatus() {
  return lastBuildStatus;
}

/**
 * Get spawn environment with color support
 * @returns {NodeJS.ProcessEnv}
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
 * @returns {string}
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

export { findFlakeDir, runCmd, execAsync, updateBuildStatus, getLastBuildStatus, getSpawnEnv, flakeDirNotFoundMsg };

export {};
