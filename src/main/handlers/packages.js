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
      return {
        hasDrift: false,
        pendingInstall: [],
        pendingRemove: [],
        optionChanges: [],
        changedFiles: [],
        lastRebuild: null,
        lastConfigChange: null
      };
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

    const mtimeDrift = !!(lastRebuild && lastConfigChange && new Date(lastConfigChange) > new Date(lastRebuild));

    const normalizeFile = (filePath) => {
      if (!filePath) return '';
      if (path.isAbsolute(filePath)) {
        try {
          const rel = path.relative(flakeDir, filePath);
          if (!rel.startsWith('..')) return rel;
        } catch (e) {}
      }
      return filePath;
    };

    // Collect generic git working-tree signals (includes external/manual edits)
    let changedFiles = [];
    let optionDiffSummary = { added: [], removed: [], changed: [] };
    try {
      const fileOut = await runCmd(`git -C "${flakeDir}" diff --name-only`);
      changedFiles = (fileOut || '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .filter(name => name.endsWith('.nix'));
    } catch (e) {}

    try {
      const diffOut = await runCmd(`git -C "${flakeDir}" diff --unified=20 -- '*.nix'`);
      optionDiffSummary = parseOptionDiffSummary(diffOut, flakeDir);
    } catch (e) {}

    const hasDrift = mtimeDrift || changedFiles.length > 0;

    // If drift, check history for app-initiated changes since last rebuild
    let pendingInstall = [];
    let pendingRemove = [];
    let optionChanges = [];
    const optionChangesByKey = new Map();
    if (hasDrift && lastRebuild) {
      try {
        const { getDb } = require('./history');
        const db = getDb();
        const rebuildMs = new Date(lastRebuild).getTime();
        const rows = db.prepare(
          "SELECT pkgname, action, file FROM history WHERE timestamp > ? ORDER BY timestamp ASC"
        ).all(rebuildMs);
        const added = new Map();
        const removed = new Map();
        for (const row of rows) {
          const key = `${row.file || ''}::${row.pkgname}`;
          if (row.action === 'added') {
            added.set(key, row);
            removed.delete(key);
          } else if (row.action === 'removed') {
            removed.set(key, row);
            added.delete(key);
          }
        }
        // Verify installs: exclude packages no longer present in config files
        // (e.g. user manually reverted the add in an editor)
        pendingInstall = [];

        // Verify removes: exclude packages still present in any config file
        const flakeDir = findFlakeDir();
        if (flakeDir) {
          const { findPackage } = require('../nix-packages');
          pendingInstall = [...added.values()].filter(entry => {
            const pkg = entry.pkgname;
            const targetFile = entry.file;
            const locs = findPackage(pkg, flakeDir);
            return locs.some(loc => path.resolve(loc.file) === path.resolve(targetFile));
          });
          pendingRemove = [...removed.values()].filter(entry => {
            const locs = findPackage(entry.pkgname, flakeDir);
            return locs.length === 0;
          }).map(entry => entry.pkgname);
        } else {
          pendingInstall = [...added.values()];
          pendingRemove = [...removed.values()].map(entry => entry.pkgname);
        }
        pendingInstall = pendingInstall.map(entry => entry.pkgname);
        pendingInstall = pendingInstall.sort();

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

        // Aggregate option-level changes since last rebuild
        const optionRows = db.prepare(
          'SELECT option_path, action, old_value, new_value, file FROM option_history WHERE timestamp > ? ORDER BY timestamp ASC'
        ).all(rebuildMs);

        const byOption = new Map();
        for (const row of optionRows) {
          const key = `${row.option_path}::${row.file}`;
          const current = byOption.get(key);
          if (!current) {
            byOption.set(key, {
              optionPath: row.option_path,
              action: row.action,
              oldValue: row.old_value,
              newValue: row.new_value,
              file: row.file,
              edits: 1
            });
            continue;
          }

          current.edits += 1;
          current.action = row.action;
          if (current.oldValue == null) current.oldValue = row.old_value;
          current.newValue = row.new_value;
        }
        optionChanges = [...byOption.values()].sort((a, b) => a.optionPath.localeCompare(b.optionPath));
        for (const change of optionChanges) {
          const file = normalizeFile(change.file);
          const key = `${file}::${change.optionPath}`;
          optionChangesByKey.set(key, {
            ...change,
            file,
            source: 'sqlite'
          });
        }

      } catch (e) {}
    }

    // Merge git-derived option deltas (authoritative current file state) over sqlite tracking
    const gitPaths = new Set([
      ...optionDiffSummary.changed.map(c => c.optionPath),
      ...optionDiffSummary.added.map(c => c.optionPath),
      ...optionDiffSummary.removed.map(c => c.optionPath)
    ]);

    if (gitPaths.size > 0) {
      for (const [existingKey, existing] of optionChangesByKey.entries()) {
        const overlaps = [...gitPaths].some(gitPath => (
          existing.optionPath === gitPath ||
          existing.optionPath.startsWith(`${gitPath}.`) ||
          gitPath.startsWith(`${existing.optionPath}.`)
        ));
        if (overlaps) optionChangesByKey.delete(existingKey);
      }
    }

    function upsertGitOptionChange(action, change) {
      const file = normalizeFile(change.file);

      // Remove overlapping sqlite-style aggregate entries in same file
      for (const [existingKey, existing] of optionChangesByKey.entries()) {
        if (normalizeFile(existing.file) !== file) continue;
        if (
          existing.optionPath === change.optionPath ||
          existing.optionPath.startsWith(`${change.optionPath}.`) ||
          change.optionPath.startsWith(`${existing.optionPath}.`)
        ) {
          optionChangesByKey.delete(existingKey);
        }
      }

      const key = `${file}::${change.optionPath}`;
      optionChangesByKey.set(key, {
        optionPath: change.optionPath,
        action,
        oldValue: action === 'added' ? null : change.from,
        newValue: action === 'removed' ? null : change.to,
        file: file || '(unknown file)',
        edits: 1,
        source: 'git'
      });
    }

    for (const change of optionDiffSummary.changed) upsertGitOptionChange('set', change);
    for (const change of optionDiffSummary.added) upsertGitOptionChange('added', change);
    for (const change of optionDiffSummary.removed) upsertGitOptionChange('removed', change);

    // Remove stale sqlite-only entries that no longer exist in current git diff
    const changedFileSet = new Set(changedFiles.map(normalizeFile));
    const gitPathsByFile = new Map();
    for (const group of [optionDiffSummary.changed, optionDiffSummary.added, optionDiffSummary.removed]) {
      for (const c of group) {
        const f = normalizeFile(c.file);
        if (!gitPathsByFile.has(f)) gitPathsByFile.set(f, new Set());
        gitPathsByFile.get(f).add(c.optionPath);
      }
    }

    for (const [k, entry] of optionChangesByKey.entries()) {
      if (entry.source !== 'sqlite') continue;
      const file = normalizeFile(entry.file);

      // If file is no longer changed at all, drop sqlite pending entry
      if (!changedFileSet.has(file)) {
        optionChangesByKey.delete(k);
        continue;
      }

      // If git parsed option paths for this file, keep sqlite only when overlapping
      const gitPathsInFile = gitPathsByFile.get(file);
      if (gitPathsInFile && gitPathsInFile.size > 0) {
        const overlaps = [...gitPathsInFile].some(gitPath => (
          entry.optionPath === gitPath ||
          entry.optionPath.startsWith(`${gitPath}.`) ||
          gitPath.startsWith(`${entry.optionPath}.`)
        ));
        if (!overlaps) {
          optionChangesByKey.delete(k);
        }
      }
    }

    optionChanges = [...optionChangesByKey.values()].sort((a, b) => {
      const pathCmp = a.optionPath.localeCompare(b.optionPath);
      if (pathCmp !== 0) return pathCmp;
      return String(a.file || '').localeCompare(String(b.file || ''));
    });

    return {
      hasDrift,
      pendingInstall,
      pendingRemove,
      optionChanges,
      changedFiles,
      optionDiffSummary,
      lastRebuild,
      lastConfigChange
    };
  });
}

function parseOptionDiffSummary(diffOut, flakeDir, readFile = (p) => fs.readFileSync(p, 'utf8')) {
  const lineMap = new Map();
  let currentFile = null;
  let braceDepth = 0;
  const scopeStack = [];
  const assignment = /^([+-])\s*([a-zA-Z0-9._-]+)\s*=\s*(.*?);\s*(?:#.*)?$/;
  const absoluteRoots = new Set([
    'services', 'programs', 'hardware', 'networking', 'boot', 'system',
    'virtualisation', 'security', 'users', 'fonts', 'environment', 'nixpkgs', 'nix', 'home'
  ]);
  const fileScopedKeyCache = new Map();

  function countChar(str, ch) {
    let count = 0;
    for (const c of str) if (c === ch) count++;
    return count;
  }

  function resolveScopePath(paths) {
    let full = '';
    for (const p of paths) {
      if (!p) continue;
      const root = p.split('.')[0];
      const isAbsolute = absoluteRoots.has(root);
      if (isAbsolute) {
        full = p;
      } else if (full) {
        full = `${full}.${p}`;
      } else {
        full = p;
      }
    }
    return full;
  }

  function currentScopePath() {
    if (scopeStack.length === 0) return null;
    return resolveScopePath(scopeStack.map(s => s.path));
  }

  function getScopedKeyMap(relFile) {
    if (!relFile) return new Map();
    if (fileScopedKeyCache.has(relFile)) return fileScopedKeyCache.get(relFile);

    const result = new Map();
    const absFile = path.join(flakeDir, relFile);
    let content = '';
    try {
      content = readFile(absFile);
    } catch (e) {
      fileScopedKeyCache.set(relFile, result);
      return result;
    }

    const lines = content.split('\n');
    let depth = 0;
    const stack = [];

    for (const line of lines) {
      const code = line.replace(/#.*$/, '');
      const scopeMatch = code.match(/^\s*([a-zA-Z0-9._-]+)\s*=\s*.*\{\s*$/);
      if (scopeMatch) {
        stack.push({ path: scopeMatch[1], depth });
      }

      const assignMatch = code.match(/^\s*([a-zA-Z0-9._-]+)\s*=\s*/);
      if (assignMatch) {
        const lhs = assignMatch[1];
        const root = lhs.split('.')[0];
        const looksAbsolute = absoluteRoots.has(root);
        const scopePath = resolveScopePath(stack.map(s => s.path));
        if (!looksAbsolute && scopePath && !lhs.startsWith(`${scopePath}.`) && lhs !== scopePath) {
          result.set(lhs, `${scopePath}.${lhs}`);
        }
      }

      depth += countChar(code, '{');
      depth -= countChar(code, '}');
      while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
        stack.pop();
      }
    }

    fileScopedKeyCache.set(relFile, result);
    return result;
  }

  for (const line of (diffOut || '').split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6).trim();
      braceDepth = 0;
      scopeStack.length = 0;
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('@@')) continue;
    if (!line || line.startsWith('\\')) continue;

    const prefix = line[0];
    if (![' ', '+', '-'].includes(prefix)) continue;
    const raw = line.slice(1);

    const scopeMatch = raw.match(/^\s*([a-zA-Z0-9._-]+)\s*=\s*.*\{\s*(?:#.*)?$/);
    if (scopeMatch) {
      scopeStack.push({ path: scopeMatch[1], depth: braceDepth });
    }

    const opens = countChar(raw, '{');
    const closes = countChar(raw, '}');

    const m = line.match(assignment);
    if (m) {
      const sign = m[1];
      let optionPath = m[2];
      const value = m[3].trim();

      const scopePath = currentScopePath();
      const root = optionPath.split('.')[0];
      const looksAbsolute = absoluteRoots.has(root);
      if (scopePath && !looksAbsolute) {
        if (!optionPath.startsWith(`${scopePath}.`) && optionPath !== scopePath) {
          optionPath = `${scopePath}.${optionPath}`;
        }
      } else if (!looksAbsolute && currentFile) {
        const scopedMap = getScopedKeyMap(currentFile);
        const inferred = scopedMap.get(optionPath);
        if (inferred) optionPath = inferred;
      }

      const key = `${currentFile || ''}::${optionPath}`;
      if (!lineMap.has(key)) {
        lineMap.set(key, { optionPath, file: currentFile, added: null, removed: null });
      }
      const entry = lineMap.get(key);
      if (sign === '+') entry.added = value;
      if (sign === '-') entry.removed = value;
    }

    braceDepth += opens;
    braceDepth -= closes;
    while (scopeStack.length > 0 && braceDepth <= scopeStack[scopeStack.length - 1].depth) {
      scopeStack.pop();
    }
  }

  const optionDiffSummary = { added: [], removed: [], changed: [] };
  for (const [, delta] of lineMap.entries()) {
    if (delta.added != null && delta.removed != null) {
      optionDiffSummary.changed.push({ optionPath: delta.optionPath, file: delta.file, from: delta.removed, to: delta.added });
    } else if (delta.added != null) {
      optionDiffSummary.added.push({ optionPath: delta.optionPath, file: delta.file, to: delta.added });
    } else if (delta.removed != null) {
      optionDiffSummary.removed.push({ optionPath: delta.optionPath, file: delta.file, from: delta.removed });
    }
  }
  optionDiffSummary.added.sort((a, b) => a.optionPath.localeCompare(b.optionPath));
  optionDiffSummary.removed.sort((a, b) => a.optionPath.localeCompare(b.optionPath));
  optionDiffSummary.changed.sort((a, b) => a.optionPath.localeCompare(b.optionPath));
  return optionDiffSummary;
}

module.exports = {
  register,
  parseOptionDiffSummary,
};
