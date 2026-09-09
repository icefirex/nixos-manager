const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { findFlakeDir, runCmd, flakeDirNotFoundMsg } = require('../utils');
const { addOptionHistoryEntry } = require('./history');
const { stripStrings } = require('../nix-packages');

const ELASTIC_USER = 'aWVSALXpZv';
const ELASTIC_PASS = 'X8gPHnzL52wFEekuxsfQ9cSh';
const ELASTIC_HOST = 'nixos-search-7-1733963800.us-east-1.bonsaisearch.net';
const ELASTIC_PATH_PREFIX = '/latest-*-nixos-';
const OPTION_ABSOLUTE_ROOTS = new Set([
  'services', 'programs', 'hardware', 'networking', 'boot', 'system',
  'virtualisation', 'security', 'users', 'fonts', 'environment', 'nixpkgs', 'nix', 'home', 'xdg'
]);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function normalizeOptionValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/;$/, '').trim();
}

function resolveScopePath(paths) {
  let full = '';
  for (const p of paths) {
    if (!p) continue;
    const root = p.split('.')[0];
    const isAbsolute = OPTION_ABSOLUTE_ROOTS.has(root);
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

function buildScopedAssignments(content) {
  const lines = content.split('\n');
  const stack = [];
  let depth = 0;
  const entries = [];

  function countChar(str, ch) {
    let count = 0;
    for (const c of str) if (c === ch) count++;
    return count;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const code = line.replace(/#.*$/, '');
    const scopeMatch = code.match(/^\s*([a-zA-Z0-9._-]+)\s*=\s*.*\{\s*$/);
    if (scopeMatch) {
      stack.push({ path: scopeMatch[1], depth });
    }

    const assignMatch = line.match(/^(\s*)([a-zA-Z0-9._-]+)\s*=\s*(.*?)\s*;\s*(#.*)?$/);
    if (assignMatch) {
      const lhs = assignMatch[2];
      const root = lhs.split('.')[0];
      const looksAbsolute = OPTION_ABSOLUTE_ROOTS.has(root);
      const scopePath = resolveScopePath(stack.map(s => s.path));
      const fullPath = looksAbsolute ? lhs : (scopePath ? `${scopePath}.${lhs}` : lhs);
      entries.push({
        lineIndex: i,
        lhs,
        fullPath,
        indent: assignMatch[1] || '',
        value: normalizeOptionValue(assignMatch[3]),
        comment: assignMatch[4] ? ` ${assignMatch[4].trim()}` : ''
      });
    }

    depth += countChar(code, '{');
    depth -= countChar(code, '}');
    while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
      stack.pop();
    }
  }

  return entries;
}

function chooseOptionFile(flakeDir, preferredFile = null) {
  const files = findNixFiles(flakeDir);
  if (files.length === 0) return null;
  if (preferredFile) {
    const abs = path.isAbsolute(preferredFile) ? preferredFile : path.join(flakeDir, preferredFile);
    if (fs.existsSync(abs)) return abs;
  }
  const cfg = files.find(f => f.endsWith('/configuration.nix') || f.endsWith('configuration.nix'));
  return cfg || files[0];
}

function resolveTargetFilePath(flakeDir, filePath) {
  if (!filePath) return null;
  const candidates = [];

  if (path.isAbsolute(filePath)) {
    candidates.push(filePath);
  } else {
    candidates.push(path.join(flakeDir, filePath));
    candidates.push(path.resolve(filePath));

    const flakeBase = path.basename(flakeDir);
    const normalized = String(filePath).replace(/\\/g, '/');
    const marker = `${flakeBase}/`;
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const trimmed = normalized.slice(idx + marker.length);
      candidates.push(path.join(flakeDir, trimmed));
    }
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function resolveGitContext(targetFile, flakeDir) {
  const dirs = [path.dirname(targetFile), flakeDir].filter(Boolean);
  for (const dir of dirs) {
    const root = await runCmd(`git -C "${dir}" rev-parse --show-toplevel`);
    if (!root) continue;
    const rel = path.relative(root.trim(), targetFile);
    if (!rel.startsWith('..')) {
      return { root: root.trim(), relPath: rel };
    }
  }
  return null;
}

function updateOptionInFile(filePath, optionPath, newValueRaw, allowCreate = true) {
  const escapedPath = escapeRegExp(optionPath);
  const assignRegex = new RegExp(`^(\\s*)${escapedPath}\\s*=\\s*(.*?)\\s*;\\s*(#.*)?$`);
  const prefixRegex = new RegExp(`^(\\s*)${escapedPath}\\s*=`);

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const newValue = normalizeOptionValue(newValueRaw);

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const assignMatch = line.match(assignRegex);
    if (assignMatch) {
      const oldValue = normalizeOptionValue(assignMatch[2]);
      const indent = assignMatch[1] || '';
      const comment = assignMatch[3] ? ` ${assignMatch[3].trim()}` : '';
      lines[i] = `${indent}${optionPath} = ${newValue};${comment}`;
      fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
      return { action: 'set', oldValue, newValue };
    }
    if (prefixRegex.test(line)) {
      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';

      const statementStart = offset;
      const tail = content.slice(statementStart);
      const stripped = stripStrings(tail);

      let parenDepth = 0;
      let braceDepth = 0;
      let bracketDepth = 0;
      let statementEndRel = -1;

      for (let j = 0; j < stripped.length; j++) {
        const ch = stripped[j];
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
        else if (ch === '{') braceDepth++;
        else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
        else if (ch === '[') bracketDepth++;
        else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
        else if (ch === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
          statementEndRel = j;
          break;
        }
      }

      if (statementEndRel === -1) {
        throw new Error('Unable to locate end of option assignment');
      }

      const statementEnd = statementStart + statementEndRel + 1;
      const oldRaw = content.slice(statementStart, statementEnd);
      const oldValueMatch = oldRaw.match(/^[\s\S]*?=\s*([\s\S]*);\s*$/);
      const oldValue = oldValueMatch ? oldValueMatch[1].trim() : '(multiline)';

      const replacement = `${indent}${optionPath} = ${newValue};`;
      const newContent = content.slice(0, statementStart) + replacement + content.slice(statementEnd);
      fs.writeFileSync(filePath, newContent, 'utf8');
      return { action: 'set', oldValue, newValue };
    }
    offset += line.length + 1;
  }

  // Fallback: option may be declared in nested attrset style, e.g.
  // xdg.portal = { enable = false; };
  const pathParts = optionPath.split('.');
  for (let split = pathParts.length - 1; split >= 1; split--) {
    const scopePath = pathParts.slice(0, split).join('.');
    const leafPath = pathParts.slice(split).join('.');
    const escapedScope = escapeRegExp(scopePath);
    const scopeRegex = new RegExp(`^(\\s*)${escapedScope}\\s*=\\s*.*\\{\\s*(#.*)?$`);

    let scopeLineStart = -1;
    let scopeOffset = 0;
    for (const line of lines) {
      if (scopeRegex.test(line)) {
        scopeLineStart = scopeOffset;
        break;
      }
      scopeOffset += line.length + 1;
    }
    if (scopeLineStart === -1) continue;

    const tail = content.slice(scopeLineStart);
    const stripped = stripStrings(tail);
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let scopeEndRel = -1;
    for (let j = 0; j < stripped.length; j++) {
      const ch = stripped[j];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        scopeEndRel = j;
        break;
      }
    }
    if (scopeEndRel === -1) continue;

    const scopeEnd = scopeLineStart + scopeEndRel + 1;
    const scopeText = content.slice(scopeLineStart, scopeEnd);
    const escapedLeaf = escapeRegExp(leafPath);
    const leafRegex = new RegExp(`^(\\s*)${escapedLeaf}\\s*=\\s*(.*?)\\s*;\\s*(#.*)?$`, 'm');
    const leafMatch = scopeText.match(leafRegex);
    if (!leafMatch) continue;

    const oldValue = normalizeOptionValue(leafMatch[2]);
    const indent = leafMatch[1] || '  ';
    const comment = leafMatch[3] ? ` ${leafMatch[3].trim()}` : '';
    const newScopeText = scopeText.replace(leafRegex, `${indent}${leafPath} = ${newValue};${comment}`);
    const newContent = content.slice(0, scopeLineStart) + newScopeText + content.slice(scopeEnd);
    fs.writeFileSync(filePath, newContent, 'utf8');
    return { action: 'set', oldValue, newValue };
  }

  // Fallback: derive full paths from nested scopes and edit matched assignment line
  const scopedAssignments = buildScopedAssignments(content);
  const scopedMatch = scopedAssignments.find(e => e.fullPath === optionPath);
  if (scopedMatch) {
    lines[scopedMatch.lineIndex] = `${scopedMatch.indent}${scopedMatch.lhs} = ${newValue};${scopedMatch.comment}`;
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return { action: 'set', oldValue: scopedMatch.value, newValue };
  }

  if (!allowCreate) {
    throw new Error(`Option '${optionPath}' was not found in target file`);
  }

  const insertLine = `  ${optionPath} = ${newValue};`;
  const closeIdx = lines.map((l, i) => ({ l, i })).reverse().find(x => /^\s*}\s*;?\s*$/.test(x.l));
  if (closeIdx) {
    lines.splice(closeIdx.i, 0, insertLine);
  } else {
    lines.push(insertLine);
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return { action: 'added', oldValue: null, newValue };
}

function extractOptionValueFromContent(content, optionPath) {
  const lines = content.split('\n');
  const escapedPath = escapeRegExp(optionPath);
  const assignRegex = new RegExp(`^(\\s*)${escapedPath}\\s*=\\s*(.*?)\\s*;\\s*(#.*)?$`);

  for (const line of lines) {
    const m = line.match(assignRegex);
    if (m) return normalizeOptionValue(m[2]);
  }

  const pathParts = optionPath.split('.');
  for (let split = pathParts.length - 1; split >= 1; split--) {
    const scopePath = pathParts.slice(0, split).join('.');
    const leafPath = pathParts.slice(split).join('.');
    const escapedScope = escapeRegExp(scopePath);
    const scopeRegex = new RegExp(`^(\\s*)${escapedScope}\\s*=\\s*.*\\{\\s*(#.*)?$`);

    let scopeLineStart = -1;
    let scopeOffset = 0;
    for (const line of lines) {
      if (scopeRegex.test(line)) {
        scopeLineStart = scopeOffset;
        break;
      }
      scopeOffset += line.length + 1;
    }
    if (scopeLineStart === -1) continue;

    const tail = content.slice(scopeLineStart);
    const stripped = stripStrings(tail);
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let scopeEndRel = -1;
    for (let j = 0; j < stripped.length; j++) {
      const ch = stripped[j];
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
      else if (ch === ';' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        scopeEndRel = j;
        break;
      }
    }
    if (scopeEndRel === -1) continue;

    const scopeEnd = scopeLineStart + scopeEndRel + 1;
    const scopeText = content.slice(scopeLineStart, scopeEnd);
    const escapedLeaf = escapeRegExp(leafPath);
    const leafRegex = new RegExp(`^(\\s*)${escapedLeaf}\\s*=\\s*(.*?)\\s*;\\s*(#.*)?$`, 'm');
    const leafMatch = scopeText.match(leafRegex);
    if (leafMatch) return normalizeOptionValue(leafMatch[2]);
  }

  const scopedAssignments = buildScopedAssignments(content);
  const scoped = scopedAssignments.find(e => e.fullPath === optionPath);
  if (scoped) return scoped.value;

  return null;
}

function searchOptionCatalog(query, channel = 'unstable', limit = 20) {
  const payload = JSON.stringify({
    from: 0,
    size: Math.max(1, Math.min(limit, 100)),
    sort: [
      { _score: 'desc' },
      { option_name: 'asc' }
    ],
    query: {
      bool: {
        must: [
          { match: { type: 'option' } },
          {
            query_string: {
              query,
              default_field: 'option_name'
            }
          }
        ]
      }
    }
  });

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${ELASTIC_USER}:${ELASTIC_PASS}`).toString('base64');
    const req = https.request({
      hostname: ELASTIC_HOST,
      port: 443,
      method: 'POST',
      path: `${ELASTIC_PATH_PREFIX}${encodeURIComponent(channel)}/_search`,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(json?.error?.reason || `Option search failed (${res.statusCode})`));
            return;
          }
          const hits = json?.hits?.hits || [];
          const out = [];
          const seen = new Set();
          for (const hit of hits) {
            const src = hit?._source || {};
            if (!src.option_name || seen.has(src.option_name)) continue;
            seen.add(src.option_name);
            out.push({
              path: src.option_name,
              description: src.option_description || null,
              type: src.option_type || null,
              default: src.option_default != null ? String(src.option_default) : null,
              example: src.option_example != null ? String(src.option_example) : null,
              declared: src.option_source || null
            });
          }
          resolve(out);
        } catch (e) {
          reject(new Error(`Failed to parse option search response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Register options management IPC handlers
 */
function register() {
  // Get options from flake configuration files
  ipcMain.handle('get-options', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      throw new Error(flakeDirNotFoundMsg());
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

  ipcMain.handle('options-list-files', async () => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { success: false, error: flakeDirNotFoundMsg() };
    }
    const files = findNixFiles(flakeDir).map(filePath => ({
      path: filePath,
      relativePath: path.relative(flakeDir, filePath)
    }));
    return { success: true, files };
  });

  ipcMain.handle('set-option-value', async (event, payload) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { success: false, error: flakeDirNotFoundMsg() };
    }
    const optionPath = payload?.optionPath;
    if (!optionPath || typeof optionPath !== 'string') {
      return { success: false, error: 'optionPath is required' };
    }
    const newValue = payload?.newValue;
    if (typeof newValue !== 'string' || !newValue.trim()) {
      return { success: false, error: 'newValue is required' };
    }

    let targetFile = null;
    if (payload?.filePath) {
      targetFile = resolveTargetFilePath(flakeDir, payload.filePath);
      if (!targetFile) {
        return { success: false, error: `File not found: ${payload.filePath}` };
      }
    } else {
      targetFile = chooseOptionFile(flakeDir, payload?.preferredFile || null);
    }

    if (!targetFile) {
      return { success: false, error: 'No .nix file found to store this option' };
    }

    try {
      const result = updateOptionInFile(targetFile, optionPath, newValue, payload?.allowCreate !== false);
      const relPath = path.relative(flakeDir, targetFile);
      let diff = '';
      try {
        diff = await runCmd(`git -C "${flakeDir}" diff "${relPath}"`);
      } catch (e) {}
      addOptionHistoryEntry({
        optionPath,
        action: result.action,
        oldValue: result.oldValue,
        newValue: result.newValue,
        file: targetFile
      });
      return {
        success: true,
        action: result.action,
        file: targetFile,
        relativePath: relPath,
        oldValue: result.oldValue,
        newValue: result.newValue,
        diff: diff || null
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('revert-option-from-git', async (event, payload) => {
    const flakeDir = findFlakeDir();
    if (!flakeDir) {
      return { success: false, error: flakeDirNotFoundMsg() };
    }

    const optionPath = payload?.optionPath;
    if (!optionPath || typeof optionPath !== 'string') {
      return { success: false, error: 'optionPath is required' };
    }

    const targetFile = resolveTargetFilePath(flakeDir, payload?.filePath);
    if (!targetFile) {
      return { success: false, error: `File not found: ${payload?.filePath || '(missing)'}` };
    }

    const gitCtx = await resolveGitContext(targetFile, flakeDir);
    if (!gitCtx) {
      return { success: false, error: `Could not locate git repository for ${payload?.filePath || targetFile}` };
    }

    const relPath = gitCtx.relPath;
    const gitBlob = await runCmd(`git -C "${gitCtx.root}" show "HEAD:${relPath}"`);
    if (!gitBlob || !gitBlob.trim()) {
      return { success: false, error: `Could not read committed version of ${relPath}` };
    }

    let committedValue = extractOptionValueFromContent(gitBlob, optionPath);
    if (committedValue == null && typeof payload?.fallbackValue === 'string' && payload.fallbackValue.trim()) {
      committedValue = normalizeOptionValue(payload.fallbackValue);
    }
    if (committedValue == null) {
      return { success: false, error: `Option '${optionPath}' not found in committed file` };
    }

    try {
      const result = updateOptionInFile(targetFile, optionPath, committedValue, false);
      addOptionHistoryEntry({
        optionPath,
        action: 'reverted',
        oldValue: result.oldValue,
        newValue: committedValue,
        file: targetFile
      });

      let diff = '';
      try {
        diff = await runCmd(`git -C "${gitCtx.root}" diff "${relPath}"`);
      } catch (e) {}

      return {
        success: true,
        action: 'reverted',
        file: targetFile,
        relativePath: relPath,
        oldValue: result.oldValue,
        newValue: committedValue,
        diff: diff || null
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('search-options-catalog', async (event, query, opts = {}) => {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { success: true, results: [] };
    }
    try {
      const results = await searchOptionCatalog(query.trim(), opts.channel || 'unstable', opts.limit || 20);
      return { success: true, results };
    } catch (e) {
      return { success: false, error: e.message };
    }
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

module.exports = {
  register,
  normalizeOptionValue,
  resolveScopePath,
  buildScopedAssignments,
  resolveTargetFilePath,
  updateOptionInFile,
  extractOptionValueFromContent,
};
