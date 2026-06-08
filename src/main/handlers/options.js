const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { findFlakeDir, runCmd } = require('../utils');

/**
 * Register options management IPC handlers
 */
function register() {
  // Get options from flake configuration files
  ipcMain.handle('get-options', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error('Could not find flake directory');
    }

    const options = {
      services: [],
      programs: [],
      hardware: [],
      networking: [],
      boot: [],
      system: [],
      other: []
    };

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

    // Helper to extract multi-line block/list from source
    function extractMultilineValue(lines, startIdx, startValue) {
      // Count initial brackets
      let braceCount = 0;
      let bracketCount = 0;
      for (const char of startValue) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;
      }

      // If already balanced, return as-is
      if (braceCount === 0 && bracketCount === 0) {
        return startValue;
      }

      // Extract lines until balanced
      let result = [startValue];
      let i = startIdx;
      const maxLines = 50;

      while (i < lines.length && (braceCount > 0 || bracketCount > 0) && result.length < maxLines) {
        const line = lines[i];
        result.push(line);

        for (const char of line) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (char === '[') bracketCount++;
          if (char === ']') bracketCount--;
        }
        i++;
      }

      // Format the result
      let formatted = result.join('\n');

      // If we hit the limit, add truncation indicator
      if (result.length >= maxLines && (braceCount > 0 || bracketCount > 0)) {
        formatted += '\n  # ...';
      }

      return formatted;
    }

    for (const nixFile of nixFiles) {
      try {
        const content = fs.readFileSync(nixFile, 'utf8');
        const lines = content.split('\n');
        const relativePath = path.relative(flakeDir, nixFile);

        // Parse each line for option assignments
        lines.forEach((line, idx) => {
          const lineNum = idx + 1;

          // Match patterns like: services.foo.enable = true;
          // Also match: programs.git.enable = true;
          // Also match: hardware.opengl.enable = true;
          const optionMatch = line.match(/^\s*(services|programs|hardware|networking|boot|system|virtualisation|security|users|fonts|environment|nixpkgs|nix|home)\.([a-zA-Z0-9._-]+)\s*=\s*(.+?);?\s*$/);

          if (optionMatch) {
            const category = optionMatch[1];
            const optionPath = `${category}.${optionMatch[2]}`;
            let value = optionMatch[3].trim().replace(/;$/, '');

            // If value contains unbalanced brackets, extract multi-line content
            if (value.includes('{') || value.includes('[')) {
              const extracted = extractMultilineValue(lines, idx + 1, value);
              if (extracted !== value) {
                value = extracted;
              }
            }

            const optionEntry = {
              path: optionPath,
              value: value,
              file: relativePath,
              line: lineNum
            };

            // Categorize the option
            if (category === 'services') {
              if (!options.services.find(o => o.path === optionPath && o.file === relativePath)) {
                options.services.push(optionEntry);
              }
            } else if (category === 'programs') {
              if (!options.programs.find(o => o.path === optionPath && o.file === relativePath)) {
                options.programs.push(optionEntry);
              }
            } else if (category === 'hardware') {
              if (!options.hardware.find(o => o.path === optionPath && o.file === relativePath)) {
                options.hardware.push(optionEntry);
              }
            } else if (category === 'networking') {
              if (!options.networking.find(o => o.path === optionPath && o.file === relativePath)) {
                options.networking.push(optionEntry);
              }
            } else if (category === 'boot') {
              if (!options.boot.find(o => o.path === optionPath && o.file === relativePath)) {
                options.boot.push(optionEntry);
              }
            } else if (category === 'system') {
              if (!options.system.find(o => o.path === optionPath && o.file === relativePath)) {
                options.system.push(optionEntry);
              }
            } else {
              if (!options.other.find(o => o.path === optionPath && o.file === relativePath)) {
                options.other.push(optionEntry);
              }
            }
          }
        });
      } catch (e) {
        console.error(`Failed to parse ${nixFile}:`, e.message);
      }
    }

    // Sort all lists by option path
    for (const category of Object.keys(options)) {
      options[category].sort((a, b) => a.path.localeCompare(b.path));
    }

    return options;
  });

  // Get option info from NixOS options
  ipcMain.handle('get-option-info', async (event, optionPath) => {
    const flakeDir = findFlakeDir();

    const info = {
      path: optionPath,
      description: null,
      type: null,
      default: null,
      example: null,
      declared: null,
      configLocations: []
    };

    // Try to get option info from nixos-option
    try {
      const optionJson = await runCmd(
        `nixos-option --json ${optionPath} 2>/dev/null || echo "{}"`,
        15000
      );

      if (optionJson && optionJson.trim() !== '{}') {
        const parsed = JSON.parse(optionJson);
        info.description = parsed.description || null;
        info.type = parsed.type || null;
        info.default = parsed.default !== undefined ? JSON.stringify(parsed.default) : null;
        info.example = parsed.example !== undefined ? JSON.stringify(parsed.example) : null;

        if (parsed.declarations && parsed.declarations.length > 0) {
          info.declared = parsed.declarations[0];
        }
      }
    } catch (e) {
      console.error(`Failed to get nixos-option info for ${optionPath}:`, e.message);
    }

    // Find where option is set in config
    if (flakeDir) {
      // Escape dots for grep regex
      const escapedPath = optionPath.replace(/\./g, '\\.');
      const grepResult = await runCmd(
        `grep -rn --include="*.nix" "${escapedPath}\\s*=" "${flakeDir}" 2>/dev/null | head -10`,
        10000
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

  // Get live system options (enabled services, programs, etc.)
  ipcMain.handle('get-live-options', async () => {
    const options = {
      services: [],
      programs: [],
      hardware: [],
      networking: [],
      boot: [],
      system: [],
      other: []
    };

    // Get enabled systemd services
    try {
      const servicesOutput = await runCmd(
        `systemctl list-unit-files --type=service --state=enabled --no-pager --no-legend 2>/dev/null | head -100`,
        15000
      );

      if (servicesOutput) {
        const lines = servicesOutput.split('\n').filter(Boolean);
        for (const line of lines) {
          const match = line.match(/^([^\s]+)\.service/);
          if (match) {
            const serviceName = match[1];
            // Skip internal systemd services
            if (!serviceName.startsWith('systemd-') &&
                !serviceName.startsWith('dbus') &&
                !serviceName.startsWith('getty') &&
                !serviceName.startsWith('user@')) {
              options.services.push({
                path: `services.${serviceName}`,
                value: 'enabled',
                source: 'systemd'
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to get enabled services:', e.message);
    }

    // Get some key system info
    try {
      // Check if some common programs are available
      const programs = ['git', 'vim', 'nvim', 'zsh', 'bash', 'fish', 'tmux', 'htop', 'firefox', 'chromium'];
      for (const prog of programs) {
        const exists = await runCmd(`which ${prog} 2>/dev/null`);
        if (exists && exists.trim()) {
          options.programs.push({
            path: `programs.${prog}`,
            value: exists.trim(),
            source: 'which'
          });
        }
      }
    } catch (e) {
      console.error('Failed to check programs:', e.message);
    }

    // Get networking info
    try {
      const hostname = await runCmd('hostname 2>/dev/null');
      if (hostname) {
        options.networking.push({
          path: 'networking.hostName',
          value: hostname.trim(),
          source: 'hostname'
        });
      }

      const fwStatus = await runCmd('systemctl is-active firewall.service 2>/dev/null || echo "inactive"');
      options.networking.push({
        path: 'networking.firewall',
        value: fwStatus.trim() === 'active' ? 'enabled' : 'disabled',
        source: 'systemd'
      });
    } catch (e) {
      console.error('Failed to get networking info:', e.message);
    }

    // Get boot info
    try {
      const kernelVersion = await runCmd('uname -r 2>/dev/null');
      if (kernelVersion) {
        options.boot.push({
          path: 'boot.kernelPackages',
          value: kernelVersion.trim(),
          source: 'uname'
        });
      }
    } catch (e) {
      console.error('Failed to get boot info:', e.message);
    }

    // Sort all lists
    for (const category of Object.keys(options)) {
      options[category].sort((a, b) => a.path.localeCompare(b.path));
    }

    return options;
  });
}

module.exports = { register };
