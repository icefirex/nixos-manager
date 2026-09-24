// @ts-check
import electron from 'electron';
const { ipcMain } = electron as any;
import { spawn, execSync } from 'child_process';
import { findFlakeDir, updateBuildStatus, getSpawnEnv, flakeDirNotFoundMsg } from '../utils.ts';
import { getMainWindow } from '../window.ts';

type RebuildDeps = {
  ipcMain?: import('electron').IpcMain;
  findFlakeDir?: () => string | null;
  updateBuildStatus?: (success: boolean, message: string) => void;
  getSpawnEnv?: () => NodeJS.ProcessEnv;
  getMainWindow?: () => import('electron').BrowserWindow | null;
  flakeDirNotFoundMsg?: () => string;
  spawn?: typeof import('child_process').spawn;
  resolveRebuildCommand?: (spawnEnv: NodeJS.ProcessEnv) => string[];
  resolveEvalCommand?: (spawnEnv: NodeJS.ProcessEnv) => string[];
};

/**
 * Check if a command exists on PATH within the given environment.
 * @param {string} cmd
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
function commandExists(cmd: any, env: any) {
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
 * @param {NodeJS.ProcessEnv} spawnEnv
 * @returns {string[]}
 */
function resolveRebuildCommand(spawnEnv: any) {
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
 * @param {NodeJS.ProcessEnv} spawnEnv
 * @returns {string[]}
 */
function resolveEvalCommand(spawnEnv: any) {
  if (process.env.NIXOS_EVAL_COMMAND) {
    return process.env.NIXOS_EVAL_COMMAND.trim().split(/\s+/);
  }
  if (commandExists('nix-eval-flake', spawnEnv)) {
    return ['nix-eval-flake'];
  }
  return ['nixos-manager-eval'];
}

/**
 * Create rebuild handlers with dependency injection support.
 * @param {RebuildDeps} [deps]
 */
function createRebuildHandlers(deps: RebuildDeps = {}) {
  const depsFindFlakeDir = deps.findFlakeDir || findFlakeDir;
  const depsUpdateBuildStatus = deps.updateBuildStatus || updateBuildStatus;
  const depsGetSpawnEnv = deps.getSpawnEnv || getSpawnEnv;
  const depsGetMainWindow = deps.getMainWindow || getMainWindow;
  const depsFlakeDirNotFoundMsg = deps.flakeDirNotFoundMsg || flakeDirNotFoundMsg;
  const depsSpawn = deps.spawn || spawn;
  const depsResolveRebuildCommand = deps.resolveRebuildCommand || resolveRebuildCommand;
  const depsResolveEvalCommand = deps.resolveEvalCommand || resolveEvalCommand;

  /** @type {import('child_process').ChildProcess | null} */
  let runningRebuildProcess: any = null;

  return {
    nixosRebuild: async ({ action, updateInputs }: { action: string; updateInputs?: boolean }) => {
      const flakeDir = depsFindFlakeDir();
      if (!flakeDir) {
        throw new Error(depsFlakeDirNotFoundMsg());
      }

      const mainWindow = depsGetMainWindow();
      const spawnEnv = depsGetSpawnEnv();

      // For evaluate (dry-build), use eval command
      if (action === 'dry-build') {
        const [evalCmd, ...evalArgs] = depsResolveEvalCommand(spawnEnv);
        mainWindow?.webContents.send('terminal-show', { title: 'Evaluating Configuration' });
        return new Promise<any>((resolve, reject) => {
          const proc = depsSpawn(evalCmd, evalArgs, {
            env: spawnEnv,
            cwd: flakeDir
          });

          runningRebuildProcess = proc;

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
            if (runningRebuildProcess === proc) runningRebuildProcess = null;
            mainWindow?.webContents.send('build-complete', { success: code === 0 });
            if (code === 0) {
              depsUpdateBuildStatus(true, 'Evaluation successful');
              resolve({ success: true, output });
            } else {
              depsUpdateBuildStatus(false, 'Evaluation failed');
              reject(new Error(`Evaluation failed with code ${code}`));
            }
          });

          proc.on('error', (err) => {
            if (runningRebuildProcess === proc) runningRebuildProcess = null;
            mainWindow?.webContents.send('build-complete', { success: false });
            depsUpdateBuildStatus(false, err.message);
            reject(err);
          });
        });
      }

      // For switch / boot / test, use rebuild command
      const [rebuildCmd, ...baseArgs] = depsResolveRebuildCommand(spawnEnv);
      const args = [...baseArgs, action, '.'];

      if (updateInputs) {
        args.push('--update');
      }

      const actionTitles: Record<string, string> = {
        'switch': 'Switching Configuration',
        'boot': 'Building for Next Boot',
        'test': 'Testing Configuration'
      };
      mainWindow?.webContents.send('terminal-show', { title: actionTitles[action] || 'Building' });

      return new Promise<any>((resolve, reject) => {
        const proc = depsSpawn(rebuildCmd, args, {
          env: spawnEnv,
          cwd: flakeDir
        });

        runningRebuildProcess = proc;

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
          if (runningRebuildProcess === proc) runningRebuildProcess = null;
          mainWindow?.webContents.send('build-complete', { success: code === 0 });
          if (code === 0) {
            depsUpdateBuildStatus(true, `${action} completed successfully`);
            resolve(output);
          } else {
            depsUpdateBuildStatus(false, `${action} failed with code ${code}`);
            reject(new Error(`Build failed with code ${code}`));
          }
        });

        proc.on('error', (err) => {
          if (runningRebuildProcess === proc) runningRebuildProcess = null;
          mainWindow?.webContents.send('build-complete', { success: false });
          depsUpdateBuildStatus(false, err.message);
          reject(err);
        });
      });
    },

    cancelRebuild: () => {
      if (runningRebuildProcess) {
        runningRebuildProcess.kill('SIGTERM');
        runningRebuildProcess = null;
        return true;
      }
      return false;
    }
  };
}

/**
 * Register NixOS rebuild IPC handlers
 * @param {RebuildDeps} [deps]
 */
function register(deps: RebuildDeps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createRebuildHandlers(deps);

  depsIpcMain.handle('nixos-rebuild', async (_event: any, payload: any) => {
    return handlers.nixosRebuild(payload);
  });

  depsIpcMain.handle('cancel-rebuild', () => {
    return handlers.cancelRebuild();
  });
}

export { register, commandExists, resolveRebuildCommand, resolveEvalCommand, createRebuildHandlers };

export {};
