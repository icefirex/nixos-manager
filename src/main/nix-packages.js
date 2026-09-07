const fs = require('fs');
const path = require('path');
const { findFlakeDir } = require('./utils');

function extractFromList(content) {
  const found = new Set();
  const pkgsPattern = /(?:pkgs|pkgs-stable|pkgs-unstable|pkgs-[a-z0-9]+)\.([a-zA-Z0-9_-]+)/g;
  let m;
  while ((m = pkgsPattern.exec(content)) !== null) {
    found.add(m[1]);
  }
  const lines = content.split('\n');
  for (const line of lines) {
    const t = line.replace(/#.*$/, '').trim().replace(/[,;]\s*$/, '');
    if (t.length > 0 && !t.startsWith('#') && !t.startsWith('pkgs') &&
      !t.includes('=') && !t.includes('{') && !t.includes('}') &&
      !t.startsWith('[') && !t.startsWith(']') && !t.startsWith('(') &&
      /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(t)) {
      found.add(t);
    }
  }
  return [...found];
}

function stripStrings(content) {
  let result = '';
  let i = 0;
  while (i < content.length) {
    if (content[i] === "'" && content[i + 1] === "'") {
      let j = i + 2;
      while (j < content.length) {
        if (content[j] === "'" && content[j + 1] === "'") {
          const after = content.slice(j + 2, j + 10);
          const firstNonSpace = after.replace(/^\s/, '');
          const isTerminator = firstNonSpace.startsWith(')') ||
            firstNonSpace.startsWith(',') ||
            firstNonSpace.startsWith(';') ||
            firstNonSpace.startsWith('+') ||
            firstNonSpace.startsWith('{') ||
            firstNonSpace.startsWith('}') ||
            firstNonSpace.startsWith(']') ||
            firstNonSpace === '' ||
            after.startsWith('\n');
          if (isTerminator) {
            j += 2;
            break;
          } else {
            j += 2;
          }
        } else {
          j++;
        }
      }
      result += '\x00'.repeat(j - i);
      i = j;
    } else if (content[i] === '"') {
      let j = i + 1;
      while (j < content.length && content[j] !== '"') {
        if (content[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, content.length);
      result += '\x00'.repeat(j - i);
      i = j;
    } else {
      result += content[i];
      i++;
    }
  }
  return result;
}

function extractListBlock(content, pattern) {
  const match = content.match(pattern);
  if (!match) return null;
  const stripped = stripStrings(content);
  const openBracket = stripped.indexOf('[', match.index + match[0].length - 1);
  if (openBracket === -1) return null;
  let depth = 0;
  for (let i = openBracket; i < stripped.length; i++) {
    if (stripped[i] === '[') depth++;
    else if (stripped[i] === ']') {
      depth--;
      if (depth === 0) return stripped.slice(openBracket + 1, i);
    }
  }
  return null;
}

function extractListBlockAt(content, startIndex) {
  const stripped = stripStrings(content);
  const openBracket = stripped.indexOf('[', startIndex);
  if (openBracket === -1) return null;
  let depth = 0;
  for (let i = openBracket; i < stripped.length; i++) {
    if (stripped[i] === '[') depth++;
    else if (stripped[i] === ']') {
      depth--;
      if (depth === 0) return stripped.slice(openBracket + 1, i);
    }
  }
  return null;
}

/**
 * Scan all .nix files under a directory and extract package definitions.
 * Returns: [{ file, relativePath, system: string[], homeManager: string[], users: { [name]: string[] } }]
 */
function scanNixPackages(flakeDir) {
  const results = [];

  function processFile(fullPath) {
      let content;
      try { content = fs.readFileSync(fullPath, 'utf8'); } catch { return; }

      const entry = {
        file: fullPath,
        relativePath: path.relative(flakeDir, fullPath),
        system: [],
        homeManager: [],
        users: {}
      };

      const sysBlock = extractListBlock(content, /environment\.systemPackages\s*(?:\+=|=)\s*(?:with\s+pkgs;\s*)?/);
      if (sysBlock) entry.system = extractFromList(sysBlock);

      const hmBlock = extractListBlock(content, /home\.packages\s*(?:\+=|=)\s*(?:with\s+pkgs;\s*)?/);
      if (hmBlock) entry.homeManager = extractFromList(hmBlock);

      const userPattern = /users\.users\.([^.]+)\.packages\s*(?:\+=|=)\s*(?:with\s+pkgs;\s*)?/g;
      let um;
      while ((um = userPattern.exec(content)) !== null) {
        const block = extractListBlockAt(content, um.index + um[0].length);
        if (block) entry.users[um[1]] = extractFromList(block);
      }

      if (entry.system.length || entry.homeManager.length || Object.keys(entry.users).length > 0) {
        results.push(entry);
      }
    }

  function scanDir(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.nix')) {
        processFile(fullPath);
      }
    }
  }

  scanDir(flakeDir);
  return results;
}

/**
 * Get all packages as flat lists per scope.
 * Returns: { system: string[], user: string[], homeManager: string[] }
 */
function getAllPackages() {
  const flakeDir = findFlakeDir();
  if (!flakeDir) return { system: [], user: [], homeManager: [] };

  const files = scanNixPackages(flakeDir);
  const sysSet = new Set();
  const userSet = new Set();
  const hmSet = new Set();

  for (const f of files) {
    for (const p of f.system) sysSet.add(p);
    for (const p of f.homeManager) hmSet.add(p);
    for (const pkgs of Object.values(f.users)) {
      for (const p of pkgs) userSet.add(p);
    }
  }

  return {
    system: [...sysSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    user: [...userSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
    homeManager: [...hmSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  };
}

/**
 * Find which files contain a specific package.
 * Returns: [{ file, relativePath, sections: string[], lines: number[] }]
 */
function findPackage(pkgname) {
  const flakeDir = findFlakeDir();
  if (!flakeDir) return [];

  const files = scanNixPackages(flakeDir);
  const results = [];

  for (const f of files) {
    const sections = [];
    if (f.system.includes(pkgname)) sections.push('system');
    if (f.homeManager.includes(pkgname)) sections.push('homeManager');
    for (const [username, pkgs] of Object.entries(f.users)) {
      if (pkgs.includes(pkgname)) sections.push(`user:${username}`);
    }
    if (sections.length > 0) {
      const lines = findPackageLines(f.file, pkgname);
      results.push({ file: f.file, relativePath: f.relativePath, sections, lines });
    }
  }

  return results;
}

function findPackageLines(filePath, pkgname) {
  const lines = [];
  const pkgRef = `pkgs.${pkgname}`;
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return lines; }

  function stripNixStrings(str) {
    let result = '';
    let i = 0;
    while (i < str.length) {
      if (str[i] === "'" && str[i + 1] === "'") {
        let j = i + 2;
        while (j < str.length) {
          if (str[j] === "'" && str[j + 1] === "'") {
            if (str[j + 2] === "'") { j += 3; } else { j += 2; break; }
          } else { j++; }
        }
        result += '\x00'.repeat(j - i);
        i = j;
      } else if (str[i] === '"') {
        let j = i + 1;
        while (j < str.length && str[j] !== '"') {
          if (str[j] === '\\') j++;
          j++;
        }
        j = Math.min(j + 1, str.length);
        result += '\x00'.repeat(j - i);
        i = j;
      } else {
        result += str[i];
        i++;
      }
    }
    return result;
  }

  const stripped = stripNixStrings(content);
  const allLines = content.split('\n');

  function getBlockRange(startIndex) {
    const openBracket = stripped.indexOf('[', startIndex);
    if (openBracket === -1) return null;
    let depth = 0;
    for (let i = openBracket; i < stripped.length; i++) {
      if (stripped[i] === '[') depth++;
      else if (stripped[i] === ']') {
        depth--;
        if (depth === 0) return { start: openBracket, end: i };
      }
    }
    return null;
  }

  const sectionPatterns = [
    /environment\.systemPackages\s*(?:\+=|=)\s*(?:with\s+pkgs;\s*)?/,
    /home\.packages\s*(?:\+=|=)\s*(?:with\s+pkgs;\s*)?/,
    /users\.users\.[^.]+\.packages\s*(?:\+=|=)\s*(?:with\s+pkgs;\s*)?/g
  ];

  for (const pattern of sectionPatterns) {
    if (pattern.global) {
      let m;
      while ((m = pattern.exec(content)) !== null) {
        const range = getBlockRange(m.index + m[0].length);
        if (!range) continue;
        const startLine = content.slice(0, range.start).split('\n').length;
        const endLine = content.slice(0, range.end).split('\n').length;
        for (let i = startLine; i < Math.min(endLine, allLines.length); i++) {
          const t = allLines[i].replace(/#.*$/, '').trim().replace(/[,;]\s*$/, '');
          if (allLines[i].includes(pkgRef) || t === pkgname) {
            if (!lines.includes(i + 1)) lines.push(i + 1);
          }
        }
      }
    } else {
      const m = content.match(pattern);
      if (m) {
        const range = getBlockRange(m.index + m[0].length);
        if (!range) continue;
        const startLine = content.slice(0, range.start).split('\n').length;
        const endLine = content.slice(0, range.end).split('\n').length;
        for (let i = startLine; i < Math.min(endLine, allLines.length); i++) {
          const t = allLines[i].replace(/#.*$/, '').trim().replace(/[,;]\s*$/, '');
          if (allLines[i].includes(pkgRef) || t === pkgname) {
            if (!lines.includes(i + 1)) lines.push(i + 1);
          }
        }
      }
    }
  }

  lines.sort((a, b) => a - b);
  return lines;
}

/**
 * Find packages defined in more than one file within the same scope,
 * or the same package in multiple different user scopes.
 * Returns: [{ pkgname, scope, files: [{file, relativePath}], crossUser: boolean }]
 */
function findDuplicates() {
  const flakeDir = findFlakeDir();
  if (!flakeDir) return [];

  const files = scanNixPackages(flakeDir);

  // scope -> pkgname -> Set of files
  const scopeMap = {};
  function add(scope, pkg, file, relPath) {
    if (!scopeMap[scope]) scopeMap[scope] = {};
    if (!scopeMap[scope][pkg]) scopeMap[scope][pkg] = [];
    if (!scopeMap[scope][pkg].some(e => e.file === file)) {
      scopeMap[scope][pkg].push({ file, relativePath: relPath });
    }
  }

  for (const f of files) {
    for (const p of f.system) add('system', p, f.file, f.relativePath);
    for (const p of f.homeManager) add('homeManager', p, f.file, f.relativePath);
    for (const [username, pkgs] of Object.entries(f.users)) {
      for (const p of pkgs) add(`user:${username}`, p, f.file, f.relativePath);
    }
  }

  const duplicates = [];

  // Case 1: same scope, multiple files
  for (const [scope, pkgs] of Object.entries(scopeMap)) {
    for (const [pkgname, fileEntries] of Object.entries(pkgs)) {
      if (fileEntries.length > 1) {
        duplicates.push({ pkgname, scope, files: fileEntries, crossUser: false });
      }
    }
  }

  // Case 2: same package in multiple different user scopes
  const userScopes = Object.keys(scopeMap).filter(s => s.startsWith('user:'));
  const crossUserMap = {};
  for (const us of userScopes) {
    const user = us.replace('user:', '');
    for (const [pkg, fileEntries] of Object.entries(scopeMap[us] || {})) {
      if (!crossUserMap[pkg]) crossUserMap[pkg] = [];
      crossUserMap[pkg].push({ user, files: fileEntries, scope: us });
    }
  }
  for (const [pkgname, entries] of Object.entries(crossUserMap)) {
    if (entries.length > 1) {
      // Only flag if not already covered by case 1
      const alreadyFlagged = duplicates.some(d => d.pkgname === pkgname && d.crossUser);
      if (!alreadyFlagged) {
        duplicates.push({
          pkgname,
          scope: 'cross-user',
          files: entries.flatMap(e => e.files.map(f => ({ ...f, user: e.user }))),
          users: entries.map(e => e.user),
          crossUser: true
        });
      }
    }
  }

  duplicates.sort((a, b) => a.pkgname.localeCompare(b.pkgname));
  return duplicates;
}

module.exports = { scanNixPackages, getAllPackages, findPackage, findPackageLines, findDuplicates, stripStrings, extractFromList, extractListBlock, extractListBlockAt };
