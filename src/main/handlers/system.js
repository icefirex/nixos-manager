const { ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCmd } = require('../utils');
const { NIX_SYSTEM_PROFILE, NIX_CURRENT_SYSTEM } = require('../constants');

/**
 * Register system info IPC handlers
 */
function register() {
  // Basic system info for header
  ipcMain.handle('get-system-info', async () => {
    const hostname = os.hostname();
    const username = os.userInfo().username;

    // Get NixOS version
    let nixosVersion = 'unknown';
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const match = osRelease.match(/VERSION_ID="?([^"\n]+)"?/);
      if (match) nixosVersion = match[1];
    } catch (e) {}

    // Get kernel version
    let kernelVersion = os.release().split('-')[0];

    // Get generation
    let generation = 1;
    try {
      const link = fs.readlinkSync(NIX_SYSTEM_PROFILE);
      const match = link.match(/system-(\d+)-link/);
      if (match) generation = parseInt(match[1]);
    } catch (e) {}

    // Get last build time
    let lastBuild = 'unknown';
    try {
      const stats = fs.lstatSync(NIX_SYSTEM_PROFILE);
      const hours = Math.floor((Date.now() - stats.mtimeMs) / 3600000);
      if (hours < 1) lastBuild = 'just now';
      else if (hours < 24) lastBuild = `${hours}h ago`;
      else lastBuild = `${Math.floor(hours / 24)}d ago`;
    } catch (e) {}

    return {
      profile: username,
      hostname,
      nixosVersion,
      kernelVersion,
      generation,
      lastBuild,
      healthy: fs.existsSync(NIX_CURRENT_SYSTEM)
    };
  });

  // Detailed system info for modal
  ipcMain.handle('get-detailed-system-info', async () => {
    const info = {};

    // Basic info
    info.hostname = os.hostname();
    info.username = os.userInfo().username;
    info.platform = os.platform();
    info.arch = os.arch();

    // OS info
    try {
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      const versionMatch = osRelease.match(/VERSION_ID="?([^"\n]+)"?/);
      const nameMatch = osRelease.match(/PRETTY_NAME="?([^"\n]+)"?/);
      info.nixosVersion = versionMatch ? versionMatch[1] : 'unknown';
      info.osName = nameMatch ? nameMatch[1].replace(/"/g, '') : 'NixOS';
    } catch (e) {
      info.nixosVersion = 'unknown';
      info.osName = 'NixOS';
    }

    // Kernel
    info.kernel = os.release();

    // Uptime
    const uptimeSeconds = os.uptime();
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    info.uptime = days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m`;

    // Memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    info.memory = {
      total: (totalMem / 1073741824).toFixed(1) + ' GB',
      used: (usedMem / 1073741824).toFixed(1) + ' GB',
      free: (freeMem / 1073741824).toFixed(1) + ' GB',
      percentage: Math.round((usedMem / totalMem) * 100)
    };

    // CPU
    const cpus = os.cpus();
    info.cpu = {
      model: cpus[0]?.model || 'Unknown',
      cores: cpus.length,
      speed: cpus[0]?.speed ? `${cpus[0].speed} MHz` : 'Unknown'
    };

    // Generation info
    try {
      const link = fs.readlinkSync(NIX_SYSTEM_PROFILE);
      const match = link.match(/system-(\d+)-link/);
      info.generation = match ? parseInt(match[1]) : 1;
    } catch (e) {
      info.generation = 1;
    }

    // System switch time
    try {
      const stats = fs.lstatSync(NIX_SYSTEM_PROFILE);
      info.buildTime = stats.mtime.toLocaleString();
    } catch (e) {
      info.buildTime = 'unknown';
    }

    // Run disk, store, and package queries in parallel (async)
    const [dfOutput, storeCount, packageCount] = await Promise.all([
      runCmd('df -h / | tail -1'),
      runCmd('ls /nix/store 2>/dev/null | wc -l'),
      runCmd(`ls ${NIX_CURRENT_SYSTEM}/sw/bin 2>/dev/null | wc -l`)
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
      const currentPath = fs.realpathSync(NIX_CURRENT_SYSTEM);
      const basePath = fs.realpathSync(NIX_SYSTEM_PROFILE);
      if (currentPath === basePath) {
        info.specialization = 'base';
      } else {
        const specDir = `${NIX_SYSTEM_PROFILE}/specialisation`;
        if (fs.existsSync(specDir)) {
          const entries = fs.readdirSync(specDir);
          for (const entry of entries) {
            const specPath = path.join(specDir, entry);
            const resolvedSpecPath = fs.realpathSync(specPath);
            if (currentPath === resolvedSpecPath) {
              info.specialization = entry;
              break;
            }
          }
        }
        if (!info.specialization) info.specialization = 'unknown';
      }
    } catch (e) {
      info.specialization = 'unknown';
    }

    return info;
  });
}

module.exports = { register };
