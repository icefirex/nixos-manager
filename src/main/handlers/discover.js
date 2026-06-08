const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const https = require('https');
const { promisify } = require('util');
const { execSync, spawn } = require('child_process');
const { getMainWindow } = require('../window');
const { getSpawnEnv } = require('../utils');

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
 * Check if stderr output indicates a TTY/terminal error
 */
function isTTYError(stderr) {
  return TTY_ERROR_PATTERNS.some(pattern => pattern.test(stderr));
}

/**
 * Detect an available terminal emulator on the system
 */
function detectTerminal() {
  if (process.env.TERMINAL) {
    try {
      execSync(`command -v ${process.env.TERMINAL}`, { stdio: 'ignore' });
      // Default to -e for user-specified terminal
      return { cmd: process.env.TERMINAL, buildArgs: (args) => ['-e', ...args] };
    } catch (e) { /* not found */ }
  }

  const terminals = [
    { cmd: 'foot', buildArgs: (args) => args },
    { cmd: 'kitty', buildArgs: (args) => ['--', ...args] },
    { cmd: 'alacritty', buildArgs: (args) => ['-e', ...args] },
    { cmd: 'gnome-terminal', buildArgs: (args) => ['--wait', '--', ...args] },
    { cmd: 'konsole', buildArgs: (args) => ['-e', ...args] },
    { cmd: 'xterm', buildArgs: (args) => ['-e', ...args] },
  ];

  for (const term of terminals) {
    try {
      execSync(`command -v ${term.cmd}`, { stdio: 'ignore' });
      return term;
    } catch (e) { /* not found, try next */ }
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
        // Follow redirect
        https.get(response.headers.location, (res) => {
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

        // Extract icons using system tar (files are at root of tarball)
        fs.mkdirSync(iconsDir, { recursive: true });
        execSync(`tar -xzf "${iconsPath}" -C "${iconsDir}"`, {
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
  componentsCache = parseAppStreamXML(xmlContent);
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

    // Get additional info from nix
    const { runCmd } = require('../utils');
    let nixMeta = {};

    try {
      const metaJson = await runCmd(`nix eval --json nixpkgs#${pkgname}.meta 2>/dev/null || echo "{}"`);
      nixMeta = JSON.parse(metaJson || '{}');
    } catch (e) {
      // Ignore errors
    }

    let version = null;
    try {
      version = await runCmd(`nix eval --raw nixpkgs#${pkgname}.version 2>/dev/null`);
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
    const { runCmd } = require('../utils');

    try {
      // Use nix search to find packages (quote query for safety, longer timeout)
      const safeQuery = query.replace(/['"\\]/g, '');
      console.log(`Searching nixpkgs for: "${safeQuery}"`);
      const result = await runCmd(`nix search nixpkgs "${safeQuery}" --json 2>/dev/null`, 60000);
      console.log(`Nixpkgs search result length: ${result?.length || 0}`);
      if (!result || result.trim() === '{}') {
        return [];
      }

      const packages = JSON.parse(result);
      const results = [];

      for (const [attrPath, pkg] of Object.entries(packages)) {
        // attrPath is like "legacyPackages.x86_64-linux.firefox"
        const parts = attrPath.split('.');
        const pkgname = parts.slice(2).join('.'); // Remove legacyPackages.x86_64-linux

        results.push({
          id: attrPath,
          pkgname: pkgname,
          name: pkg.pname || pkgname.split('.').pop(),
          summary: pkg.description || '',
          version: pkg.version || null,
          categories: [],
          icon: null,
          isNixpkgsResult: true // Mark as coming from nix search
        });
      }

      // Sort by name
      results.sort((a, b) => a.name.localeCompare(b.name));

      return results.slice(0, 100); // Limit results
    } catch (e) {
      console.error('Failed to search nixpkgs:', e.message);
      return [];
    }
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
    const { runCmd } = require('../utils');

    // Get the main program name (binary) - may differ from package name
    let mainProgram = pkgname.split('.').pop(); // Default: last part of package name
    try {
      const result = await runCmd(`nix eval --raw nixpkgs#${pkgname}.meta.mainProgram 2>/dev/null`);
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

module.exports = { register, cleanup };
