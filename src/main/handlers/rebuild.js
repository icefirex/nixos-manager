const { ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const { findFlakeDir, updateBuildStatus, getSpawnEnv } = require('../utils');
const { getMainWindow } = require('../window');

/**
 * Check if a command exists on PATH within the given environment.
 */
function commandExists(cmd, env) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe', env, shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve which rebuild command to use.
 *
 * Priority:
 *   1. NIXOS_REBUILD_COMMAND env var  — fully custom, user-supplied command
 *   2. nixos-rebuild-wrapper          — enhanced wrapper (if present on PATH)
 *   3. nixos-manager-rebuild          — generic fallback bundled with this app
 *
 * Returns an array [cmd, ...baseArgs] ready to spread into spawn().
 */
function resolveRebuildCommand(spawnEnv) {
  if (process.env.NIXOS_REBUILD_COMMAND) {
    return process.env.NIXOS_REBUILD_COMMAND.trim().split(/\s+/);
  }
  if (commandExists('nixos-rebuild-wrapper', spawnEnv)) {
    return ['nixos-rebuild-wrapper'];
  }
  return ['nixos-manager-rebuild'];
}

/**
 * Resolve which eval command to use.
 *
 * Priority:
 *   1. NIXOS_EVAL_COMMAND env var  — fully custom, user-supplied command
 *   2. nix-eval-flake               — enhanced evaluator (if present on PATH)
 *   3. nixos-manager-eval           — generic fallback bundled with this app
 */
function resolveEvalCommand(spawnEnv) {
  if (process.env.NIXOS_EVAL_COMMAND) {
    return process.env.NIXOS_EVAL_COMMAND.trim().split(/\s+/);
  }
  if (commandExists('nix-eval-flake', spawnEnv)) {
    return ['nix-eval-flake'];
  }
  return ['nixos-manager-eval'];
}

/**
 * Register NixOS rebuild IPC handlers
 */
function register() {
  ipcMain.handle('nixos-rebuild', async (event, { action, updateInputs }) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error('Could not find flake directory');
    }

    const mainWindow = getMainWindow();
    const spawnEnv = getSpawnEnv();

    // For evaluate (dry-build), use eval command
    if (action === 'dry-build') {
      const [evalCmd, ...evalArgs] = resolveEvalCommand(spawnEnv);
      mainWindow?.webContents.send('terminal-show', { title: 'Evaluating Configuration' });
      return new Promise((resolve, reject) => {
        const proc = spawn(evalCmd, evalArgs, {
          env: spawnEnv,
          cwd: flakeDir
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
          mainWindow?.webContents.send('build-complete', { success: code === 0 });
          if (code === 0) {
            updateBuildStatus(true, 'Evaluation successful');
            resolve({ success: true, output });
          } else {
            updateBuildStatus(false, 'Evaluation failed');
            reject(new Error(`Evaluation failed with code ${code}`));
          }
        });

        proc.on('error', (err) => {
          mainWindow?.webContents.send('build-complete', { success: false });
          updateBuildStatus(false, err.message);
          reject(err);
        });
      });
    }

    // For switch / boot / test, use rebuild command
    const [rebuildCmd, ...baseArgs] = resolveRebuildCommand(spawnEnv);
    const args = [...baseArgs, action, '.'];

    if (updateInputs) {
      args.push('--update');
    }

    const actionTitles = {
      'switch': 'Switching Configuration',
      'boot': 'Building for Next Boot',
      'test': 'Testing Configuration'
    };
    mainWindow?.webContents.send('terminal-show', { title: actionTitles[action] || 'Building' });

    return new Promise((resolve, reject) => {
      const proc = spawn(rebuildCmd, args, {
        env: spawnEnv,
        cwd: flakeDir
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
        mainWindow?.webContents.send('build-complete', { success: code === 0 });
        if (code === 0) {
          updateBuildStatus(true, `${action} completed successfully`);
          resolve(output);
        } else {
          updateBuildStatus(false, `${action} failed with code ${code}`);
          reject(new Error(`Build failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        mainWindow?.webContents.send('build-complete', { success: false });
        updateBuildStatus(false, err.message);
        reject(err);
      });
    });
  });
}

module.exports = { register };
