// @ts-check
import electron from 'electron';
const { ipcMain } = electron as any;
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { NIX_SYSTEM_PROFILE, NIX_CURRENT_SYSTEM } from '../constants.ts';

// Valid specialization names: alphanumeric, hyphens, underscores only
const VALID_SPEC_NAME = /^[a-zA-Z0-9_-]+$/;

/**
 * Build the switch-to-configuration path for a specialization.
 * Pure: no fs access.
 */
function buildSpecSwitchPath(name, profilePath) {
  if (name === 'base') {
    return `${profilePath}/bin/switch-to-configuration`;
  }
  return `${profilePath}/specialisation/${name}/bin/switch-to-configuration`;
}

/**
 * Determine the active specialization name from resolved system paths.
 * Pure (realpath is injected). Returns 'base', the entry name, or null.
 */
function determineActiveSpec(currentPath, basePath, specEntries, realpath) {
  if (!currentPath || !basePath) return null;
  if (currentPath === basePath) return 'base';
  for (const entry of specEntries) {
    try {
      if (currentPath === realpath(entry)) return entry;
    } catch (e: any) {}
  }
  return null;
}

/**
 * Build the specialization list: "base" first, then directory entries.
 * Pure (isDirectory is injected).
 */
function buildSpecializationList(activeSpec, specEntries, isDirectory) {
  const specializations = [{ name: 'base', active: activeSpec === 'base' }];
  for (const entry of specEntries) {
    if (isDirectory(entry)) {
      specializations.push({ name: entry, active: activeSpec === entry });
    }
  }
  return specializations;
}

type SpecializationsDeps = {
  fs?: typeof import('fs');
  execFile?: typeof import('child_process').execFile;
  profilePath?: string;
  currentSystem?: string;
  ipcMain?: import('electron').IpcMain;
};

/**
 * Create specialization handlers with dependency injection support.
 * @param {SpecializationsDeps} [deps]
 */
function createSpecializationsHandlers(deps: SpecializationsDeps = {}) {
  const depsFs = deps.fs || fs;
  const depsExecFile = deps.execFile || execFile;
  const profilePath = deps.profilePath || NIX_SYSTEM_PROFILE;
  const currentSystem = deps.currentSystem || NIX_CURRENT_SYSTEM;
  const specDir = `${profilePath}/specialisation`;

  return {
    switchSpecialization: async (name) => {
      // SEC-05: validate name before constructing any path
      if (!name || !VALID_SPEC_NAME.test(name)) {
        throw new Error(`Invalid specialization name: "${name}"`);
      }

      const specPath = buildSpecSwitchPath(name, profilePath);

      if (!depsFs.existsSync(specPath)) {
        throw new Error(`Specialization '${name}' not found`);
      }

      return new Promise<any>((resolve, reject) => {
        // Use execFile — passes args as array, not through /bin/sh
        depsExecFile('pkexec', [specPath, 'switch'], (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
          } else {
            resolve(`Switched to specialization: ${name}`);
          }
        });
      });
    },

    getSpecializations: async () => {
      let currentPath: any = null;
      let basePath: any = null;
      try {
        currentPath = depsFs.realpathSync(currentSystem);
        basePath = depsFs.realpathSync(profilePath);
      } catch (e: any) {
        console.error('Failed to resolve system paths:', e);
      }

      let specEntries: any[] = [];
      if (depsFs.existsSync(specDir)) {
        try {
          specEntries = depsFs.readdirSync(specDir);
        } catch (e: any) {
          console.error('Failed to read specializations:', e);
        }
      }

      const activeSpec = determineActiveSpec(
        currentPath,
        basePath,
        specEntries,
        (entry) => depsFs.realpathSync(path.join(specDir, entry))
      );

      return buildSpecializationList(activeSpec, specEntries, (entry) => {
        try {
          return depsFs.statSync(path.join(specDir, entry)).isDirectory();
        } catch (e: any) {
          return false;
        }
      });
    }
  };
}

/**
 * Register specialization IPC handlers
 * @param {SpecializationsDeps} [deps]
 */
function register(deps: SpecializationsDeps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createSpecializationsHandlers(deps);

  depsIpcMain.handle('switch-specialization', async (_event, name) => {
    return handlers.switchSpecialization(name);
  });

  depsIpcMain.handle('get-specializations', async () => {
    return handlers.getSpecializations();
  });
}

export { register, createSpecializationsHandlers, VALID_SPEC_NAME, buildSpecSwitchPath, determineActiveSpec, buildSpecializationList };

export {};
