// @ts-check
import electron from 'electron';
const { ipcMain } = electron as any;
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runCmd } from '../utils.ts';
import { NIX_SYSTEM_PROFILE, NIX_CURRENT_SYSTEM } from '../constants.ts';

/**
 * Parse VERSION_ID and PRETTY_NAME from os-release content.
 * Pure.
 */
function parseOsRelease(content: any) {
  const versionMatch = (content || '').match(/VERSION_ID="?([^"\n]+)"?/);
  const nameMatch = (content || '').match(/PRETTY_NAME="?([^"\n]+)"?/);
  return {
    version: versionMatch ? versionMatch[1] : null,
    name: nameMatch ? nameMatch[1].replace(/"/g, '') : null
  };
}

/**
 * Format an uptime in seconds as 'Xd Xh Xm' or 'Xh Xm'.
 * Pure.
 */
function formatUptime(uptimeSeconds: any) {
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
}

/**
 * Build memory info from total/free bytes.
 * Pure.
 */
function buildMemoryInfo(totalMem: any, freeMem: any) {
  const usedMem = totalMem - freeMem;
  return {
    total: (totalMem / 1073741824).toFixed(1) + ' GB',
    used: (usedMem / 1073741824).toFixed(1) + ' GB',
    free: (freeMem / 1073741824).toFixed(1) + ' GB',
    percentage: Math.round((usedMem / totalMem) * 100)
  };
}

/**
 * Format the time since the last system switch.
 * Pure.
 */
function formatLastBuildTime(mtimeMs: any, nowMs: any) {
  const hours = Math.floor((nowMs - mtimeMs) / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Resolve the active specialization name.
 * Pure (realpath is injected). Returns 'base', the entry name, or 'unknown'.
 */
function resolveSpecialization(currentPath: any, basePath: any, specEntries: any, realpath: any) {
  if (currentPath === basePath) return 'base';
  for (const entry of specEntries) {
    try {
      if (currentPath === realpath(entry)) return entry;
    } catch (e: any) {}
  }
  return 'unknown';
}

type SystemDeps = {
  os?: typeof import('os');
  fs?: typeof import('fs');
  runCmd?: (cmd: string, timeout?: number) => Promise<string>;
  profilePath?: string;
  currentSystem?: string;
  ipcMain?: import('electron').IpcMain;
};

/**
 * Create system info handlers with dependency injection support.
 * @param {SystemDeps} [deps]
 */
function createSystemHandlers(deps: SystemDeps = {}) {
  const depsOs = deps.os || os;
  const depsFs = deps.fs || fs;
  const depsRunCmd = deps.runCmd || runCmd;
  const profilePath = deps.profilePath || NIX_SYSTEM_PROFILE;
  const currentSystem = deps.currentSystem || NIX_CURRENT_SYSTEM;

  return {
    // Basic system info for header
    getSystemInfo: async () => {
      const hostname = depsOs.hostname();
      const username = depsOs.userInfo().username;

      // Get NixOS version
      let nixosVersion = 'unknown';
      try {
        const osRelease = depsFs.readFileSync('/etc/os-release', 'utf8');
        const { version } = parseOsRelease(osRelease);
        if (version) nixosVersion = version;
      } catch (e: any) {}

      // Get kernel version
      let kernelVersion = depsOs.release().split('-')[0];

      // Get generation
      let generation = 1;
      try {
        const link = depsFs.readlinkSync(profilePath);
        const match = link.match(/system-(\d+)-link/);
        if (match) generation = parseInt(match[1]);
      } catch (e: any) {}

      // Get last build time
      let lastBuild = 'unknown';
      try {
        const stats = depsFs.lstatSync(profilePath);
        lastBuild = formatLastBuildTime(stats.mtimeMs, Date.now());
      } catch (e: any) {}

      return {
        profile: username,
        hostname,
        nixosVersion,
        kernelVersion,
        generation,
        lastBuild,
        healthy: depsFs.existsSync(currentSystem)
      };
    },

    // Detailed system info for modal
    getDetailedSystemInfo: async () => {
      const info: any = {};

      // Basic info
      info.hostname = depsOs.hostname();
      info.username = depsOs.userInfo().username;
      info.platform = depsOs.platform();
      info.arch = depsOs.arch();

      // OS info
      try {
        const osRelease = depsFs.readFileSync('/etc/os-release', 'utf8');
        const { version, name } = parseOsRelease(osRelease);
        info.nixosVersion = version || 'unknown';
        info.osName = name || 'NixOS';
      } catch (e: any) {
        info.nixosVersion = 'unknown';
        info.osName = 'NixOS';
      }

      // Kernel
      info.kernel = depsOs.release();

      // Uptime
      info.uptime = formatUptime(depsOs.uptime());

      // Memory
      info.memory = buildMemoryInfo(depsOs.totalmem(), depsOs.freemem());

      // CPU
      const cpus = depsOs.cpus();
      info.cpu = {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
        speed: cpus[0]?.speed ? `${cpus[0].speed} MHz` : 'Unknown'
      };

      // Generation info
      try {
        const link = depsFs.readlinkSync(profilePath);
        const match = link.match(/system-(\d+)-link/);
        info.generation = match ? parseInt(match[1]) : 1;
      } catch (e: any) {
        info.generation = 1;
      }

      // System switch time
      try {
        const stats = depsFs.lstatSync(profilePath);
        info.buildTime = stats.mtime.toLocaleString();
      } catch (e: any) {
        info.buildTime = 'unknown';
      }

      // Run disk, store, and package queries in parallel (async)
      const [dfOutput, storeCount, packageCount] = await Promise.all([
        depsRunCmd('df -h / | tail -1'),
        depsRunCmd('ls /nix/store 2>/dev/null | wc -l'),
        depsRunCmd(`ls ${currentSystem}/sw/bin 2>/dev/null | wc -l`)
      ]);

      // Disk usage
      if (dfOutput) {
        const parts = dfOutput.split(/\s+/);
        info.disk = {
          total: parts[1] || 'unknown',
          used: parts[2] || 'unknown',
          available: parts[3] || 'unknown',
          percentage: parseInt(parts[4]) || 0
        };
      } else {
        info.disk = { total: 'unknown', used: 'unknown', available: 'unknown', percentage: 0 };
      }

      // Nix store paths count
      info.nixStorePaths = storeCount || 'unknown';

      // Package count
      info.packageCount = packageCount || 'unknown';

      // Current specialization
      try {
        const currentReal = depsFs.realpathSync(currentSystem);
        const baseReal = depsFs.realpathSync(profilePath);
        let specEntries: any[] = [];
        const specDir = `${profilePath}/specialisation`;
        if (depsFs.existsSync(specDir)) {
          specEntries = depsFs.readdirSync(specDir);
        }
        info.specialization = resolveSpecialization(currentReal, baseReal, specEntries, (p: any) => depsFs.realpathSync(path.join(specDir, p)));
      } catch (e: any) {
        info.specialization = 'unknown';
      }

      return info;
    }
  };
}

/**
 * Register system info IPC handlers
 * @param {SystemDeps} [deps]
 */
function register(deps: SystemDeps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createSystemHandlers(deps);

  depsIpcMain.handle('get-system-info', async () => {
    return handlers.getSystemInfo();
  });

  depsIpcMain.handle('get-detailed-system-info', async () => {
    return handlers.getDetailedSystemInfo();
  });
}

export { register, createSystemHandlers, parseOsRelease, formatUptime, buildMemoryInfo, formatLastBuildTime, resolveSpecialization };

export {};
