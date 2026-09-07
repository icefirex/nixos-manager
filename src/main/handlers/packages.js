const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { findFlakeDir, runCmd, flakeDirNotFoundMsg } = require('../utils');
const { NIX_CURRENT_SYSTEM, NIX_FLAKE_REGISTRY, CMD_TIMEOUT_FAST, CMD_TIMEOUT_NETWORK } = require('../constants');
const { getAllPackages, findDuplicates } = require('../nix-packages');

/**
 * Register package management IPC handlers
 */
function register() {
  // Get packages from flake configuration
  ipcMain.handle('get-packages', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
    }
    return getAllPackages();
  });

  // Get package metadata from nixpkgs
  ipcMain.handle('get-package-info', async (event, packageName) => {
    const flakeDir = findFlakeDir();

    const info = {
      name: packageName,
      version: null,
      description: null,
      homepage: null,
      license: null,
      platforms: [],
      mainProgram: null,
      programs: [],
      position: null,
      configLocations: []
    };

    // Run meta and version queries in parallel
    const [metaJson, version] = await Promise.all([
      runCmd(`nix eval --json ${NIX_FLAKE_REGISTRY}#${packageName}.meta 2>/dev/null || echo "{}"`),
      runCmd(`nix eval --raw ${NIX_FLAKE_REGISTRY}#${packageName}.version 2>/dev/null || echo ""`)
    ]);

    // Parse meta info
    try {
      const meta = JSON.parse(metaJson || '{}');
      info.description = meta.description || null;
      info.homepage = meta.homepage || null;
      info.mainProgram = meta.mainProgram || null;
      info.position = meta.position || null;

      if (meta.license) {
        if (typeof meta.license === 'string') {
          info.license = meta.license;
        } else if (Array.isArray(meta.license)) {
          info.license = meta.license.map(l => l.spdxId || l.shortName || l.fullName || l).join(', ');
        } else if (meta.license.spdxId || meta.license.shortName) {
          info.license = meta.license.spdxId || meta.license.shortName || meta.license.fullName;
        }
      }

      if (meta.platforms && Array.isArray(meta.platforms)) {
        info.platforms = meta.platforms.slice(0, 10);
      }
    } catch (e) {
      console.error(`Failed to parse meta for ${packageName}:`, e.message);
    }

    if (version) info.version = version;

    // Try to get pname if version failed
    if (!info.version) {
      const pname = await runCmd(`nix eval --raw ${NIX_FLAKE_REGISTRY}#${packageName}.pname 2>/dev/null || echo ""`);
      if (pname && pname !== packageName) info.pname = pname;
    }

    // Try to list programs provided
    try {
      const drvPath = await runCmd(`nix eval --raw ${NIX_FLAKE_REGISTRY}#${packageName}.outPath 2>/dev/null`);

      if (drvPath && fs.existsSync(path.join(drvPath, 'bin'))) {
        const bins = fs.readdirSync(path.join(drvPath, 'bin')).filter(f => {
          const fullPath = path.join(drvPath, 'bin', f);
          try {
            const stat = fs.statSync(fullPath);
            return stat.isFile();
          } catch { return false; }
        });
        info.programs = bins.slice(0, 20);
      }
    } catch (e) {}

    // Find where package is defined in config (actual package list declarations only)
    if (flakeDir) {
      const { findPackage } = require('../nix-packages');
      const results = findPackage(packageName);
      for (const r of results) {
        for (const line of r.lines) {
          const loc = `${r.relativePath}:${line}`;
          if (!info.configLocations.includes(loc)) {
            info.configLocations.push(loc);
          }
        }
      }
    }

    return info;
  });

  // Get packages from live system state
  ipcMain.handle('get-live-packages', async () => {
    const username = os.userInfo().username;

    const packages = {
      system: [],
      user: [],
      homeManager: []
    };

    function extractPackageName(storePath) {
      const basename = path.basename(storePath);
      const withoutHash = basename.substring(33);
      const match = withoutHash.match(/^(.+?)-\d/);
      return match ? match[1] : withoutHash;
    }

    function parseRefs(output) {
      return output ? output.split('\n').filter(Boolean) : [];
    }

    // Build queries based on what paths exist
    const userProfilePath = `/etc/profiles/per-user/${username}`;

    // Run all queries in parallel (async)
    const [systemOutput, hmRawOutput] = await Promise.all([
      runCmd(`nix-store -q --references ${NIX_CURRENT_SYSTEM}/sw 2>/dev/null`, CMD_TIMEOUT_NETWORK),
      fs.existsSync(userProfilePath)
        ? runCmd(`nix-store -q --references ${userProfilePath} 2>/dev/null`, CMD_TIMEOUT_NETWORK)
        : Promise.resolve('')
    ]);

    // Home-manager: follow the home-manager-path reference
    let hmOutput = '';
    if (hmRawOutput) {
      const hmPathLine = hmRawOutput.split('\n').find(l => l.includes('home-manager-path'));
      if (hmPathLine) {
        hmOutput = await runCmd(`nix-store -q --references ${hmPathLine.trim()} 2>/dev/null`, CMD_TIMEOUT_NETWORK);
      } else {
        hmOutput = hmRawOutput;
      }
    }

    // Process system packages
    for (const ref of parseRefs(systemOutput)) {
      const name = extractPackageName(ref);
      if (name && !packages.system.includes(name)) {
        packages.system.push(name);
      }
    }

    // Process home-manager packages
    for (const ref of parseRefs(hmOutput)) {
      const name = extractPackageName(ref);
      if (name && !packages.homeManager.includes(name)) {
        packages.homeManager.push(name);
      }
    }

    // Sort all lists
    packages.system.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    packages.user.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    packages.homeManager.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return packages;
  });

  // Find packages defined in multiple files within the same scope
  ipcMain.handle('packages-get-duplicates', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { success: false, error: 'Flake directory not found' };
    }
    const duplicates = findDuplicates();
    return { success: true, duplicates };
  });

  ipcMain.handle('get-pending-changes', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { hasDrift: false, pendingInstall: [], pendingRemove: [], lastRebuild: null, lastConfigChange: null };
    }

    // Get last rebuild time (from system profile symlink modification time)
    let lastRebuild = null;
    try {
      const sysProfile = '/nix/var/nix/profiles/system';
      if (fs.existsSync(sysProfile)) {
        const lstat = fs.lstatSync(sysProfile);
        if (lstat) lastRebuild = lstat.mtime.toISOString();
      }
    } catch (e) {}

    // Get last config file modification time
    let lastConfigChange = null;
    try {
      function findNewestNix(dir) {
        let newest = null;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            const sub = findNewestNix(fullPath);
            if (sub && (!newest || sub > newest)) newest = sub;
          } else if (entry.isFile() && entry.name.endsWith('.nix')) {
            try {
              const mtime = fs.statSync(fullPath).mtime.getTime();
              if (!newest || mtime > newest) newest = mtime;
            } catch {}
          }
        }
        return newest;
      }
      const newestMs = findNewestNix(flakeDir);
      if (newestMs) lastConfigChange = new Date(newestMs).toISOString();
    } catch (e) {}

    const hasDrift = !!(lastRebuild && lastConfigChange && new Date(lastConfigChange) > new Date(lastRebuild));

    // If drift, check history for app-initiated changes since last rebuild
    let pendingInstall = [];
    let pendingRemove = [];
    if (hasDrift && lastRebuild) {
      try {
        const { getDb } = require('./history');
        const db = getDb();
        const rebuildMs = new Date(lastRebuild).getTime();
        const rows = db.prepare(
          "SELECT pkgname, action FROM history WHERE timestamp > ? ORDER BY timestamp ASC"
        ).all(rebuildMs);
        const added = new Set();
        const removed = new Set();
        for (const row of rows) {
          if (row.action === 'added') {
            added.add(row.pkgname);
            removed.delete(row.pkgname);
          } else if (row.action === 'removed') {
            removed.add(row.pkgname);
            added.delete(row.pkgname);
          }
        }
        pendingInstall = [...added].sort();
        // Verify removes: exclude packages still present in any config file
        const flakeDir = findFlakeDir();
        if (flakeDir) {
          const { findPackage } = require('../nix-packages');
          pendingRemove = [...removed].filter(pkg => {
            const locs = findPackage(pkg, flakeDir);
            return locs.length === 0;
          });
        } else {
          pendingRemove = [...removed];
        }

        // Verify against live system: exclude packages that are no longer installed
        if (pendingRemove.length > 0) {
          const liveBins = new Set();
          try { for (const n of fs.readdirSync('/nix/var/nix/profiles/system/sw/bin')) liveBins.add(n); } catch (e) {}
          const username = os.userInfo().username;
          const hmDir = path.join('/etc/profiles/per-user', username, 'bin');
          if (fs.existsSync(hmDir)) {
            try { for (const n of fs.readdirSync(hmDir)) liveBins.add(n); } catch (e) {}
          }
          pendingRemove = pendingRemove.filter(pkg => {
            if (liveBins.has(pkg)) return true;
            if (pkg.endsWith('-bin') && liveBins.has(pkg.slice(0, -4))) return true;
            return false;
          });
        }
        pendingRemove = pendingRemove.sort();
      } catch (e) {}
    }

    return { hasDrift, pendingInstall, pendingRemove, lastRebuild, lastConfigChange };
  });
}

module.exports = { register };
