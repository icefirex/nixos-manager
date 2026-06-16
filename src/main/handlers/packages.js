const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { findFlakeDir, runCmd, flakeDirNotFoundMsg } = require('../utils');
const { NIX_CURRENT_SYSTEM, NIX_FLAKE_REGISTRY, CMD_TIMEOUT_FAST, CMD_TIMEOUT_NETWORK } = require('../constants');

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

    const packages = {
      system: [],
      user: [],
      homeManager: []
    };

    // Helper to extract package names from nix expressions
    function extractPackages(content) {
      const pkgs = [];
      const pkgMatches = content.matchAll(/(?:pkgs|pkgs-stable|pkgs-[a-z]+)\.([a-zA-Z0-9_-]+)/g);
      for (const match of pkgMatches) {
        if (!pkgs.includes(match[1])) {
          pkgs.push(match[1]);
        }
      }
      return pkgs;
    }

    // Recursively find all .nix files
    function findNixFiles(dir, files = []) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            findNixFiles(fullPath, files);
          } else if (entry.isFile() && entry.name.endsWith('.nix')) {
            files.push(fullPath);
          }
        }
      } catch (e) {}
      return files;
    }

    const nixFiles = findNixFiles(flakeDir);

    for (const nixFile of nixFiles) {
      try {
        const content = fs.readFileSync(nixFile, 'utf8');

        // Extract environment.systemPackages
        const systemMatch = content.match(/environment\.systemPackages\s*=\s*(?:with\s+pkgs;\s*)?\[([^\]]*)\]/s);
        if (systemMatch) {
          const pkgBlock = systemMatch[1];
          const extracted = extractPackages(pkgBlock);

          const bareNames = pkgBlock.match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*$/gm);
          if (bareNames) {
            for (const name of bareNames) {
              const trimmed = name.trim();
              if (trimmed && !extracted.includes(trimmed) && !trimmed.includes('.')) {
                extracted.push(trimmed);
              }
            }
          }

          packages.system.push(...extracted.filter(p => !packages.system.includes(p)));
        }

        // Extract home.packages
        const homeMatch = content.match(/home\.packages\s*=\s*(?:with\s+pkgs;\s*)?\[([^\]]*)\]/s);
        if (homeMatch) {
          const pkgBlock = homeMatch[1];
          const extracted = extractPackages(pkgBlock);

          const bareNames = pkgBlock.match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*$/gm);
          if (bareNames) {
            for (const name of bareNames) {
              const trimmed = name.trim();
              if (trimmed && !extracted.includes(trimmed) && !trimmed.includes('.')) {
                extracted.push(trimmed);
              }
            }
          }

          packages.homeManager.push(...extracted.filter(p => !packages.homeManager.includes(p)));
        }

        // Extract users.users.*.packages
        const userPkgMatches = content.matchAll(/users\.users\.[^.]+\.packages\s*=\s*(?:with\s+pkgs;\s*)?\[([^\]]*)\]/gs);
        for (const match of userPkgMatches) {
          const pkgBlock = match[1];
          const extracted = extractPackages(pkgBlock);

          const bareNames = pkgBlock.match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*$/gm);
          if (bareNames) {
            for (const name of bareNames) {
              const trimmed = name.trim();
              if (trimmed && !extracted.includes(trimmed) && !trimmed.includes('.')) {
                extracted.push(trimmed);
              }
            }
          }

          packages.user.push(...extracted.filter(p => !packages.user.includes(p)));
        }
      } catch (e) {
        console.error(`Failed to parse ${nixFile}:`, e.message);
      }
    }

    // Sort all lists
    packages.system.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    packages.user.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    packages.homeManager.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return packages;
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

    // Find where package is defined in config
    if (flakeDir) {
      // Only match actual package references:
      // 1. pkgs.packageName (not followed by more identifier chars, so pkgs.zsh doesn't match pkgs.zsh-powerlevel10k)
      // 2. pkgs-stable.packageName or other pkgs-* variants
      // 3. Bare package name on its own line (for "with pkgs;" blocks)
      const grepResult = await runCmd(
        `grep -rn --include="*.nix" -E "(pkgs\\.${packageName}([^a-zA-Z0-9_-]|$)|pkgs-[a-z]+\\.${packageName}([^a-zA-Z0-9_-]|$)|^[[:space:]]*${packageName}[[:space:]]*(#.*)?$)" "${flakeDir}" 2>/dev/null | head -10`,
        CMD_TIMEOUT_FAST
      );

      if (grepResult) {
        const lines = grepResult.split('\n').filter(Boolean);
        for (const line of lines) {
          const match = line.match(/^([^:]+):(\d+):/);
          if (match) {
            const filePath = match[1];
            const lineNum = match[2];
            const relativePath = path.relative(flakeDir, filePath);
            const loc = `${relativePath}:${lineNum}`;
            if (!info.configLocations.includes(loc)) {
              info.configLocations.push(loc);
            }
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
    const hmProfilePath = `/home/${username}/.nix-profile`;
    const userProfilePath = `/etc/profiles/per-user/${username}`;

    // Run all queries in parallel (async)
    const [systemOutput, hmOutput, userOutput] = await Promise.all([
      runCmd(`nix-store -q --references ${NIX_CURRENT_SYSTEM}/sw 2>/dev/null`, CMD_TIMEOUT_NETWORK),
      fs.existsSync(hmProfilePath)
        ? runCmd(`nix-store -q --references ${hmProfilePath} 2>/dev/null`, CMD_TIMEOUT_NETWORK)
        : Promise.resolve(''),
      fs.existsSync(userProfilePath)
        ? runCmd(`nix-store -q --references ${userProfilePath} 2>/dev/null`, CMD_TIMEOUT_NETWORK)
        : Promise.resolve('')
    ]);

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

    // Process user packages
    for (const ref of parseRefs(userOutput)) {
      const name = extractPackageName(ref);
      if (name && !packages.user.includes(name)) {
        packages.user.push(name);
      }
    }

    // Sort all lists
    packages.system.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    packages.user.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    packages.homeManager.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return packages;
  });
}

module.exports = { register };
