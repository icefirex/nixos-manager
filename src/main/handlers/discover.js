const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const https = require('https');
const { promisify } = require('util');
const { execFileSync, spawn } = require('child_process');
const { getMainWindow } = require('../window');
const { findFlakeDir, getSpawnEnv, flakeDirNotFoundMsg, runCmd } = require('../utils');
const { NIX_FLAKE_REGISTRY } = require('../constants');

const gunzip = promisify(zlib.gunzip);

// Cache directory for AppStream data
const CACHE_DIR = path.join(os.homedir(), '.cache', 'nixos-manager', 'appstream');
const APPSTREAM_BASE_URL = 'https://raw.githubusercontent.com/snowfallorg/nixos-appstream-data/main/appstream/nixos-unstable';

// In-memory cache
let componentsCache = null;
let componentsByPkgname = null;
let categories = null;
let lastCacheTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Track running try-package process
let runningTryProcess = null;
let runningTryPackage = null;

// TTY error patterns that indicate a TUI app failed without a terminal
const TTY_ERROR_PATTERNS = [
  /no such device or address/i,
  /not a tty/i,
  /inappropriate ioctl/i,
  /failed to initialize terminal/i,
  /couldn't get terminal/i,
  /error opening terminal/i,
  /cannot open terminal/i,
  /tcgetattr/i,
  /ENOTTY/,
];

/**
 * Check if a command is available on PATH without using a shell.
 */
function isCommandAvailable(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore', env: getSpawnEnv() });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Run `nix eval --raw nixpkgs#<attrPath>` safely (no shell injection).
 * Returns the stdout trimmed, or '' on any error.
 */
function nixEvalRaw(attrPath) {
  return new Promise((resolve) => {
    let stdout = '';
    const proc = spawn('nix', ['eval', '--raw', `${NIX_FLAKE_REGISTRY}#${attrPath}`], {
      env: getSpawnEnv(),
    });
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', () => resolve(stdout.trim()));
    proc.on('error', () => resolve(''));
  });
}

/**
 * Run `nix eval --json nixpkgs#<attrPath>` safely (no shell injection).
 * Returns parsed JSON or null on any error.
 */
function nixEvalJson(attrPath) {
  return new Promise((resolve) => {
    let stdout = '';
    const proc = spawn('nix', ['eval', '--json', `${NIX_FLAKE_REGISTRY}#${attrPath}`], {
      env: getSpawnEnv(),
    });
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', () => {
      try { resolve(JSON.parse(stdout.trim())); } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
  });
}

/**
 * Check if stderr output indicates a TTY/terminal error
 */
function isTTYError(stderr) {
  return TTY_ERROR_PATTERNS.some(pattern => pattern.test(stderr));
}

/**
 * Detect an available terminal emulator on the system.
 * Uses execFileSync (no shell) to avoid injection via $TERMINAL.
 */
function detectTerminal() {
  const terminals = [
    { cmd: 'foot', buildArgs: (args) => args },
    { cmd: 'kitty', buildArgs: (args) => ['--', ...args] },
    { cmd: 'alacritty', buildArgs: (args) => ['-e', ...args] },
    { cmd: 'gnome-terminal', buildArgs: (args) => ['--wait', '--', ...args] },
    { cmd: 'konsole', buildArgs: (args) => ['-e', ...args] },
    { cmd: 'xterm', buildArgs: (args) => ['-e', ...args] },
  ];

  // Check $TERMINAL env var first — only accept simple command names (no metacharacters)
  if (process.env.TERMINAL) {
    const termCmd = process.env.TERMINAL.trim();
    if (/^[a-zA-Z0-9_-]+$/.test(termCmd) && isCommandAvailable(termCmd)) {
      const known = terminals.find(t => t.cmd === termCmd);
      return known || { cmd: termCmd, buildArgs: (args) => ['-e', ...args] };
    }
  }

  for (const term of terminals) {
    if (isCommandAvailable(term.cmd)) {
      return term;
    }
  }

  return null;
}

/**
 * Launch a package in an external terminal emulator
 */
function launchInTerminal(terminal, pkgname, mainProgram, mainWindow) {
  const shellCmd = `NIXPKGS_ALLOW_UNFREE=1 nix-shell -p ${pkgname} --run ${mainProgram}`;
  const termArgs = terminal.buildArgs(['bash', '-c', shellCmd]);

  const termProc = spawn(terminal.cmd, termArgs, {
    env: getSpawnEnv(),
    detached: true,
    stdio: 'ignore'
  });

  termProc.unref();

  runningTryProcess = termProc;
  runningTryPackage = mainProgram;

  termProc.on('close', (code) => {
    runningTryProcess = null;
    runningTryPackage = null;

    if (code === 0 || code === null) {
      mainWindow?.webContents.send('build-output',
        `\r\n\x1b[1;32m>>> ${mainProgram} (terminal) exited\x1b[0m\r\n`);
    } else {
      mainWindow?.webContents.send('build-output',
        `\r\n\x1b[1;31m>>> ${mainProgram} (terminal) exited with code ${code}\x1b[0m\r\n`);
    }

    mainWindow?.webContents.send('try-process-ended');
  });

  termProc.on('error', (err) => {
    runningTryProcess = null;
    runningTryPackage = null;
    mainWindow?.webContents.send('build-output',
      `\r\n\x1b[1;31m>>> Failed to open terminal: ${err.message}\x1b[0m\r\n`);
    mainWindow?.webContents.send('try-process-ended');
  });
}

/**
 * Download a file from URL to local path
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect — check final status before piping
        https.get(response.headers.location, (res) => {
          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(destPath, () => {});
            reject(new Error(`HTTP ${res.statusCode} after redirect`));
            return;
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else {
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    }).on('error', reject);
  });
}

/**
 * Ensure cache directory exists
 */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Check if cache is valid
 */
function isCacheValid() {
  const xmlPath = path.join(CACHE_DIR, 'Components-x86_64-linux.xml');
  if (!fs.existsSync(xmlPath)) return false;

  const stats = fs.statSync(xmlPath);
  const age = Date.now() - stats.mtimeMs;
  return age < CACHE_TTL;
}

/**
 * Download AppStream data if needed
 */
async function ensureAppStreamData() {
  ensureCacheDir();

  if (isCacheValid() && componentsCache) {
    return true;
  }

  const xmlGzPath = path.join(CACHE_DIR, 'Components-x86_64-linux.xml.gz');
  const xmlPath = path.join(CACHE_DIR, 'Components-x86_64-linux.xml');
  const iconsPath = path.join(CACHE_DIR, 'icons-64x64.tar.gz');
  const iconsDir = path.join(CACHE_DIR, 'icons');

  // Download XML if missing or expired
  if (!isCacheValid()) {
    console.log('Downloading AppStream data...');

    try {
      // Download components XML
      await downloadFile(`${APPSTREAM_BASE_URL}/Components-x86_64-linux.xml.gz`, xmlGzPath);

      // Decompress
      const compressed = fs.readFileSync(xmlGzPath);
      const decompressed = await gunzip(compressed);
      fs.writeFileSync(xmlPath, decompressed);

      console.log('AppStream XML downloaded and extracted');
    } catch (e) {
      console.error('Failed to download AppStream XML:', e.message);
      throw e;
    }

    // Download icons if missing or empty
    const iconsExist = fs.existsSync(iconsDir) && fs.readdirSync(iconsDir).length > 0;
    if (!iconsExist) {
      try {
        console.log('Downloading icons...');
        await downloadFile(`${APPSTREAM_BASE_URL}/icons-64x64.tar.gz`, iconsPath);

        // Extract icons — use execFileSync with arg array (no shell, protects against path traversal)
        fs.mkdirSync(iconsDir, { recursive: true });
        execFileSync('tar', ['-xzf', iconsPath, '-C', iconsDir, '--no-overwrite-dir'], {
          stdio: 'pipe'
        });

        console.log(`Icons extracted: ${fs.readdirSync(iconsDir).length} files`);
      } catch (e) {
        console.error('Failed to download icons:', e.message);
        // Non-fatal, continue without icons
      }
    }
  }

  return true;
}

/**
 * Parse AppStream XML into components
 */
function parseAppStreamXML(xmlContent) {
  const components = [];

  // Simple regex-based XML parsing (good enough for this structure)
  const componentRegex = /<component[^>]*>([\s\S]*?)<\/component>/g;
  let match;

  while ((match = componentRegex.exec(xmlContent)) !== null) {
    const componentXml = match[1];

    const component = {
      id: extractTag(componentXml, 'id'),
      pkgname: extractTag(componentXml, 'pkgname'),
      name: extractTag(componentXml, 'name'),
      summary: extractTag(componentXml, 'summary'),
      description: extractDescription(componentXml),
      categories: extractCategories(componentXml),
      icon: extractIcon(componentXml),
      homepage: extractUrl(componentXml, 'homepage'),
      bugtracker: extractUrl(componentXml, 'bugtracker'),
      screenshots: extractScreenshots(componentXml)
    };

    if (component.pkgname && component.name) {
      components.push(component);
    }
  }

  return components;
}

function extractTag(xml, tagName) {
  // First try to find tag without xml:lang (English default)
  const defaultRegex = new RegExp(`<${tagName}(?![^>]*xml:lang)[^>]*>([^<]*)</${tagName}>`);
  const defaultMatch = xml.match(defaultRegex);
  if (defaultMatch) {
    return decodeXmlEntities(defaultMatch[1].trim());
  }

  // Fallback to any tag (but prefer first one which is usually English)
  const regex = new RegExp(`<${tagName}[^>]*>([^<]*)</${tagName}>`);
  const match = xml.match(regex);
  return match ? decodeXmlEntities(match[1].trim()) : null;
}

function extractDescription(xml) {
  // Try to find description without xml:lang (English default)
  let match = xml.match(/<description(?![^>]*xml:lang)[^>]*>([\s\S]*?)<\/description>/);
  if (!match) {
    // Fallback to first description
    match = xml.match(/<description[^>]*>([\s\S]*?)<\/description>/);
  }
  if (!match) return null;

  // Extract first paragraph without xml:lang
  let pMatch = match[1].match(/<p(?![^>]*xml:lang)[^>]*>([^<]*)<\/p>/);
  if (!pMatch) {
    pMatch = match[1].match(/<p>([^<]*)<\/p>/);
  }
  return pMatch ? decodeXmlEntities(pMatch[1].trim()) : null;
}

function extractCategories(xml) {
  const categories = [];
  const catRegex = /<category>([^<]*)<\/category>/g;
  let match;
  while ((match = catRegex.exec(xml)) !== null) {
    categories.push(match[1].trim());
  }
  return categories;
}

function extractIcon(xml) {
  // Look for cached icon (preferred)
  const cachedMatch = xml.match(/<icon[^>]*type="cached"[^>]*>([^<]*)<\/icon>/);
  if (cachedMatch) {
    return { type: 'cached', name: cachedMatch[1].trim() };
  }

  // Fallback to stock icon
  const stockMatch = xml.match(/<icon[^>]*type="stock"[^>]*>([^<]*)<\/icon>/);
  if (stockMatch) {
    return { type: 'stock', name: stockMatch[1].trim() };
  }

  return null;
}

function extractUrl(xml, type) {
  const regex = new RegExp(`<url[^>]*type="${type}"[^>]*>([^<]*)</url>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractScreenshots(xml) {
  const screenshots = [];
  const imgRegex = /<image[^>]*>([^<]*)<\/image>/g;
  let match;
  while ((match = imgRegex.exec(xml)) !== null) {
    screenshots.push(match[1].trim());
  }
  return screenshots.slice(0, 5); // Limit to 5
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Load and cache components
 */
async function loadComponents() {
  if (componentsCache && (Date.now() - lastCacheTime) < CACHE_TTL) {
    return componentsCache;
  }

  await ensureAppStreamData();

  const xmlPath = path.join(CACHE_DIR, 'Components-x86_64-linux.xml');
  if (!fs.existsSync(xmlPath)) {
    throw new Error('AppStream data not available');
  }

  const xmlContent = fs.readFileSync(xmlPath, 'utf8');
  const parsed = parseAppStreamXML(xmlContent);

  if (parsed.length === 0) {
    // Don't cache an empty result — data may be corrupt or truncated; allow retry
    throw new Error('AppStream data parsed empty — file may be corrupt. Try refreshing.');
  }

  componentsCache = parsed;
  lastCacheTime = Date.now();

  // Build pkgname lookup
  componentsByPkgname = new Map();
  for (const comp of componentsCache) {
    componentsByPkgname.set(comp.pkgname, comp);
  }

  // Build category list
  const catSet = new Set();
  for (const comp of componentsCache) {
    for (const cat of comp.categories) {
      catSet.add(cat);
    }
  }
  categories = Array.from(catSet).sort();

  console.log(`Loaded ${componentsCache.length} components with ${categories.length} categories`);

  return componentsCache;
}

/**
 * Register IPC handlers for discover functionality
 */
function register() {
  // Initialize AppStream data
  ipcMain.handle('discover-init', async () => {
    try {
      await loadComponents();
      return {
        success: true,
        stats: {
          totalApps: componentsCache.length,
          categories: categories.length
        }
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Get all categories
  ipcMain.handle('discover-get-categories', async () => {
    await loadComponents();
    return categories || [];
  });

  // Search packages
  ipcMain.handle('discover-search', async (event, query, options = {}) => {
    await loadComponents();

    const { category, limit = 50 } = options;
    const q = query.toLowerCase();

    let results = componentsCache.filter(comp => {
      // Category filter
      if (category && !comp.categories.includes(category)) {
        return false;
      }

      // Search in name, summary, pkgname
      if (q) {
        const searchable = `${comp.name} ${comp.summary} ${comp.pkgname}`.toLowerCase();
        return searchable.includes(q);
      }

      return true;
    });

    // Sort by relevance (exact name match first, then alphabetical)
    results.sort((a, b) => {
      if (q) {
        const aExact = a.name.toLowerCase() === q || a.pkgname === q;
        const bExact = b.name.toLowerCase() === q || b.pkgname === q;
        if (aExact && !bExact) return -1;
        if (bExact && !aExact) return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return results.slice(0, limit);
  });

  // Get packages by category
  ipcMain.handle('discover-by-category', async (event, category, limit = 50) => {
    await loadComponents();

    const results = componentsCache
      .filter(comp => comp.categories.includes(category))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);

    return results;
  });

  // Get featured/random packages
  ipcMain.handle('discover-featured', async (event, limit = 12) => {
    await loadComponents();

    // Return a curated selection of well-known apps
    const featured = [
      'firefox', 'chromium', 'vlc', 'gimp', 'inkscape', 'blender',
      'libreoffice', 'thunderbird', 'kdenlive', 'obs-studio', 'audacity',
      'krita', 'darktable', 'handbrake', 'mpv', 'transmission-gtk'
    ];

    const results = [];
    for (const pkgname of featured) {
      const comp = componentsByPkgname?.get(pkgname);
      if (comp) results.push(comp);
      if (results.length >= limit) break;
    }

    // Fill with random if not enough
    if (results.length < limit) {
      const shuffled = [...componentsCache]
        .filter(c => !results.includes(c))
        .sort(() => Math.random() - 0.5);

      for (const comp of shuffled) {
        if (!results.includes(comp)) {
          results.push(comp);
          if (results.length >= limit) break;
        }
      }
    }

    return results;
  });

  // Get icon path for a package
  ipcMain.handle('discover-get-icon', async (event, iconName) => {
    const iconsDir = path.join(CACHE_DIR, 'icons');
    const iconPath = path.join(iconsDir, iconName);

    // Guard against path traversal (e.g. iconName = '../../etc/passwd')
    if (!path.resolve(iconPath).startsWith(path.resolve(iconsDir) + path.sep)) {
      return null;
    }

    if (fs.existsSync(iconPath)) {
      const iconData = fs.readFileSync(iconPath);
      const ext = path.extname(iconName).slice(1) || 'png';
      const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext}`;
      return `data:${mimeType};base64,${iconData.toString('base64')}`;
    }

    return null;
  });

  // Get detailed info for a package (combines AppStream + nix eval)
  ipcMain.handle('discover-get-details', async (event, pkgname) => {
    await loadComponents();

    const component = componentsByPkgname?.get(pkgname);

    // Get additional info from nix — using spawn-based helpers (no shell injection)
    let nixMeta = {};
    try {
      nixMeta = (await nixEvalJson(`${pkgname}.meta`)) || {};
    } catch (e) {
      // Ignore errors
    }

    let version = null;
    try {
      version = (await nixEvalRaw(`${pkgname}.version`)) || null;
    } catch (e) {}

    return {
      appstream: component || null,
      nix: {
        version,
        license: nixMeta.license?.spdxId || nixMeta.license?.shortName || null,
        homepage: nixMeta.homepage || null,
        description: nixMeta.description || null,
        platforms: nixMeta.platforms?.slice(0, 5) || [],
        maintainers: nixMeta.maintainers?.map(m => m.name || m).slice(0, 3) || []
      }
    };
  });

  // Search full nixpkgs (not just AppStream packages)
  ipcMain.handle('discover-search-nixpkgs', async (event, query) => {
    if (!query || typeof query !== 'string' || !query.trim()) return [];

    return new Promise((resolve) => {
      let stdout = '';
      console.log(`Searching nixpkgs for: "${query}"`);

      // Use spawn with arg array — no shell, no injection possible
      const proc = spawn('nix', ['search', NIX_FLAKE_REGISTRY, query, '--json'], {
        env: getSpawnEnv(),
        timeout: 60000
      });

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', () => {}); // suppress stderr noise

      proc.on('close', () => {
        console.log(`Nixpkgs search result length: ${stdout?.length || 0}`);
        if (!stdout || stdout.trim() === '{}' || stdout.trim() === '') {
          resolve([]);
          return;
        }
        try {
          const packages = JSON.parse(stdout);
          const results = [];
          for (const [attrPath, pkg] of Object.entries(packages)) {
            const parts = attrPath.split('.');
            const pkgname = parts.slice(2).join('.');
            results.push({
              id: attrPath,
              pkgname,
              name: pkg.pname || pkgname.split('.').pop(),
              summary: pkg.description || '',
              version: pkg.version || null,
              categories: [],
              icon: null,
              isNixpkgsResult: true
            });
          }
          results.sort((a, b) => a.name.localeCompare(b.name));
          resolve(results.slice(0, 100));
        } catch (e) {
          console.error('Failed to parse nixpkgs search result:', e.message);
          resolve([]);
        }
      });

      proc.on('error', (err) => {
        console.error('Failed to search nixpkgs:', err.message);
        resolve([]);
      });
    });
  });

  // Force refresh cache
  ipcMain.handle('discover-refresh', async () => {
    componentsCache = null;
    componentsByPkgname = null;
    categories = null;
    lastCacheTime = 0;

    // Remove cached files
    const xmlPath = path.join(CACHE_DIR, 'Components-x86_64-linux.xml');
    if (fs.existsSync(xmlPath)) {
      fs.unlinkSync(xmlPath);
    }

    return ensureAppStreamData();
  });

  // Check if a try-package process is running
  ipcMain.handle('discover-is-trying', async () => {
    return {
      running: runningTryProcess !== null,
      package: runningTryPackage
    };
  });

  // Kill the running try-package process
  ipcMain.handle('discover-kill-try', async () => {
    if (runningTryProcess) {
      const mainWindow = getMainWindow();
      try {
        // Kill the process group (negative PID kills the group)
        process.kill(-runningTryProcess.pid, 'SIGTERM');
      } catch (e) {
        // Process may already be dead
        try {
          runningTryProcess.kill('SIGTERM');
        } catch (e2) {
          // Ignore
        }
      }
      mainWindow?.webContents.send('build-output', `\r\n\x1b[1;33m>>> Process killed by user\x1b[0m\r\n`);
      runningTryProcess = null;
      runningTryPackage = null;
      return { success: true };
    }
    return { success: false, error: 'No process running' };
  });

  // Try/run a package in nix-shell
  ipcMain.handle('discover-try-package', async (event, pkgname) => {
    const mainWindow = getMainWindow();

    // Get the main program name (binary) — use spawn-based helper (no shell injection)
    let mainProgram = pkgname.split('.').pop(); // Default: last part of package name
    try {
      const result = await nixEvalRaw(`${pkgname}.meta.mainProgram`);
      if (result && result.trim()) {
        mainProgram = result.trim();
      }
    } catch (e) {
      // Fall back to package name's last segment
    }

    return new Promise((resolve, reject) => {
      // Signal to show terminal (mark as try process)
      mainWindow?.webContents.send('terminal-show', { title: `Trying ${mainProgram}`, isTry: true });

      // Send initial message
      mainWindow?.webContents.send('build-output', `\r\n\x1b[1;36m>>> Trying package: ${pkgname}\x1b[0m\r\n`);
      mainWindow?.webContents.send('build-output', `\x1b[90mRunning: NIXPKGS_ALLOW_UNFREE=1 nix-shell -p ${pkgname} --run ${mainProgram}\x1b[0m\r\n\r\n`);

      const proc = spawn('nix-shell', ['-p', pkgname, '--run', mainProgram], {
        env: { ...getSpawnEnv(), NIXPKGS_ALLOW_UNFREE: '1' },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Track the running process
      runningTryProcess = proc;
      runningTryPackage = mainProgram;

      // Collect stderr for TTY error detection
      let stderrBuffer = '';

      // Stream output to terminal
      proc.stdout.on('data', (data) => {
        mainWindow?.webContents.send('build-output', data.toString());
      });

      proc.stderr.on('data', (data) => {
        const str = data.toString();
        mainWindow?.webContents.send('build-output', str);
        // Keep last 4KB for TTY error detection
        stderrBuffer += str;
        if (stderrBuffer.length > 4096) {
          stderrBuffer = stderrBuffer.slice(-4096);
        }
      });

      proc.on('close', (code) => {
        // Check if this was a TUI app that failed without a terminal
        if (code !== 0 && code !== null && isTTYError(stderrBuffer)) {
          const terminal = detectTerminal();
          if (terminal) {
            mainWindow?.webContents.send('build-output',
              `\r\n\x1b[1;33m>>> TUI app detected, reopening in ${terminal.cmd}...\x1b[0m\r\n`);
            launchInTerminal(terminal, pkgname, mainProgram, mainWindow);
            return;
          }
        }

        // Clear tracking
        runningTryProcess = null;
        runningTryPackage = null;

        if (code === 0) {
          mainWindow?.webContents.send('build-output', `\r\n\x1b[1;32m>>> ${mainProgram} exited successfully\x1b[0m\r\n`);
        } else if (code === null) {
          // Process was killed
          mainWindow?.webContents.send('build-output', `\r\n\x1b[1;33m>>> ${mainProgram} was terminated\x1b[0m\r\n`);
        } else {
          mainWindow?.webContents.send('build-output', `\r\n\x1b[1;31m>>> ${mainProgram} exited with code ${code}\x1b[0m\r\n`);
        }

        // Notify renderer that process ended
        mainWindow?.webContents.send('try-process-ended');
      });

      proc.on('error', (err) => {
        runningTryProcess = null;
        runningTryPackage = null;
        mainWindow?.webContents.send('build-output', `\r\n\x1b[1;31m>>> Error: ${err.message}\x1b[0m\r\n`);
        mainWindow?.webContents.send('try-process-ended');
        reject(err);
      });

      // Resolve immediately after spawning
      setTimeout(() => resolve({ success: true, spawned: true, mainProgram }), 100);
    });
  });

  // Get config files from flake directory for "add to configuration"
  ipcMain.handle('discover-get-config-files', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { success: false, error: flakeDirNotFoundMsg() };
    }

    const nixFiles = [];
    function scanDir(dir) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.nix')) {
          let content;
          try {
            content = fs.readFileSync(fullPath, 'utf8');
          } catch {
            continue;
          }
          const sections = [];
          const users = [];
          if (/environment\.systemPackages/.test(content)) sections.push('system');
          if (/home\.packages/.test(content)) sections.push('homeManager');
          const userMatches = content.matchAll(/users\.users\.([^.]+)\.packages/g);
          for (const m of userMatches) {
            const name = m[1];
            if (!users.includes(name)) users.push(name);
            if (!sections.includes('user')) sections.push('user');
          }
          nixFiles.push({
            path: fullPath,
            relativePath: path.relative(flakeDir, fullPath),
            sections,
            users
          });
        }
      }
    }
    scanDir(flakeDir);

    return { success: true, files: nixFiles };
  });

  // Check if a package name exists in nixpkgs (home-manager validation)
  ipcMain.handle('discover-check-nixpkgs-package', async (event, pkgname) => {
    try {
      const result = await nixEvalRaw(`${pkgname}.meta.description`);
      return { exists: !!result };
    } catch {
      return { exists: false };
    }
  });

  // Find which config files contain a specific package
  ipcMain.handle('discover-find-package', async (event, pkgname) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { success: false, error: flakeDirNotFoundMsg() };
    }

    const { findPackage } = require('../nix-packages');
    const results = findPackage(pkgname).map(f => ({
      path: f.file,
      relativePath: f.relativePath,
      sections: f.sections
    }));
    return { success: true, files: results };
  });

  // Get a flat list of all configured packages across all nix files
  ipcMain.handle('discover-get-configured', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { success: false, error: flakeDirNotFoundMsg() };
    }

    const { getAllPackages } = require('../nix-packages');
    const scoped = getAllPackages();
    const allPackages = [...new Set([
      ...(scoped.system || []),
      ...(scoped.user || []),
      ...(scoped.homeManager || [])
    ])].sort((a, b) => a.localeCompare(b));

    return { success: true, packages: allPackages };
  });

  // Remove a package from a nix config file
  ipcMain.handle('discover-remove-package', async (event, options) => {
    const { pkgname, filePath } = options;
    const pkgRef = `pkgs.${pkgname}`;

    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'Target file does not exist' };
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return { success: false, error: `Failed to read file: ${e.message}` };
    }

    const escapedRef = pkgRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedName = pkgname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lineRegex = new RegExp(`(\\n\\s*)${escapedRef}(\\s*#[^\\n]*)?\\s*\\n`, 'g');

    let newContent;
    if (lineRegex.test(content)) {
      newContent = content.replace(lineRegex, '\n');
    } else {
      const bareRegex = new RegExp(`(\\n\\s*)${escapedName}(\\s*#[^\\n]*)?\\s*\\n`, 'g');
      if (!bareRegex.test(content)) {
        return { success: false, error: `Package '${pkgname}' not found in file` };
      }
      newContent = content.replace(bareRegex, '\n');
    }

    newContent = newContent.replace(/\n{3,}/g, '\n\n');

    try {
      fs.writeFileSync(filePath, newContent, 'utf8');
    } catch (e) {
      return { success: false, error: `Failed to write file: ${e.message}` };
    }

    let diff = '';
    const flakeDir = findFlakeDir();
    if (flakeDir) {
      try {
        const relPath = path.relative(flakeDir, filePath);
        diff = await runCmd(`git -C "${flakeDir}" diff "${relPath}"`);
      } catch (e) {}
    }

    return {
      success: true,
      message: `Removed ${pkgname} from configuration`,
      diff: diff || null
    };
  });

  // Add a package to a nix config file
  ipcMain.handle('discover-add-package', async (event, options) => {
    const { pkgname, filePath, packageType, userName } = options;
    const pkgRef = `pkgs.${pkgname}`;

    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'Target file does not exist' };
    }

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return { success: false, error: `Failed to read file: ${e.message}` };
    }

    let sectionPrefix;
    switch (packageType) {
      case 'system':
        sectionPrefix = 'environment.systemPackages';
        break;
      case 'homeManager':
        sectionPrefix = 'home.packages';
        break;
      case 'user': {
        if (!userName) {
          return { success: false, error: 'User name is required for user packages' };
        }
        sectionPrefix = `users.users.${userName}.packages`;
        break;
      }
      default:
        return { success: false, error: `Unknown package type: ${packageType}` };
    }

    // Find the opening bracket of the section and insert before the closing ]
    const escapedPrefix = sectionPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerRegex = new RegExp(`${escapedPrefix}\\s*=\\s*(?:with\\s+pkgs;\\s*)?\\[`);
    const headerMatch = content.match(headerRegex);
    if (headerMatch) {
      const listStart = headerMatch.index + headerMatch[0].length;
      const afterOpen = content.slice(listStart);

      // Find the first ] after the opening bracket
      const closeIdx = afterOpen.indexOf(']');
      if (closeIdx === -1) {
        return { success: false, error: 'Could not find closing bracket for the section' };
      }

      const innerContent = afterOpen.slice(0, closeIdx);

      if (innerContent.includes(pkgRef) || innerContent.includes(`\n${pkgname}\n`)) {
        return { success: false, error: `Package '${pkgname}' is already in ${sectionPrefix}` };
      }

      // Detect indentation from existing list items
      const indentMatch = innerContent.match(/\n(\s+)\S/);
      const itemIndent = indentMatch ? indentMatch[1] : '  ';

      // Trim trailing whitespace before ], then insert the new line there.
      // This avoids disrupting the ] line's indentation or position.
      const trimmedEnd = innerContent.replace(/\s+$/, '');
      const insertPoint = listStart + trimmedEnd.length;
      content = content.slice(0, insertPoint) + `\n${itemIndent}${pkgRef}` + content.slice(insertPoint);
    } else {
      // Section doesn't exist — detect file indentation and add at end
      const fileIndent = content.match(/^(\s+)/m);
      const baseIndent = fileIndent ? fileIndent[1] : '';
      const newSection = `\n${baseIndent}${sectionPrefix} = with pkgs; [\n${baseIndent}  ${pkgRef}\n${baseIndent}];\n`;
      const trimmed = content.trimEnd();
      if (trimmed.endsWith('}')) {
        content = trimmed.replace(/\}(\s*)$/, `${newSection}}$1`);
      } else {
        content += newSection;
      }
    }

    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (e) {
      return { success: false, error: `Failed to write file: ${e.message}` };
    }

    // Get git diff of the change
    let diff = '';
    const flakeDir = findFlakeDir();
    if (flakeDir) {
      try {
        const relPath = path.relative(flakeDir, filePath);
        diff = await runCmd(`git -C "${flakeDir}" diff "${relPath}"`);
      } catch (e) {
        // diff not available
      }
    }

    return {
      success: true,
      message: `Added ${pkgname} to ${sectionPrefix} in ${path.basename(filePath)}`,
      diff: diff || null
    };
  });
}

// Cleanup function to kill running process on app exit
function cleanup() {
  if (runningTryProcess) {
    try {
      process.kill(-runningTryProcess.pid, 'SIGTERM');
    } catch (e) {
      try {
        runningTryProcess.kill('SIGTERM');
      } catch (e2) {
        // Ignore
      }
    }
    runningTryProcess = null;
    runningTryPackage = null;
  }
}

module.exports = {
  register,
  cleanup,
  isTTYError,
  parseAppStreamXML,
  extractTag,
  extractDescription,
  extractCategories,
  extractIcon,
  extractUrl,
  extractScreenshots,
  decodeXmlEntities,
};
