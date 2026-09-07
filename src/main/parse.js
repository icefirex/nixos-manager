/**
 * Extract package names from nix expression content, matching pkgs.xxx patterns
 */
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

/**
 * Extract bare package names from a block (used with `with pkgs;` patterns).
 * Matches standalone names on their own line.
 */
function extractBareNames(block) {
  const names = [];
  const bareMatches = block.match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*$/gm);
  if (bareMatches) {
    for (const name of bareMatches) {
      const trimmed = name.trim();
      if (trimmed && !trimmed.includes('.')) {
        names.push(trimmed);
      }
    }
  }
  return names;
}

/**
 * Parse a block of nix code for environment.systemPackages
 */
function parseSystemPackages(content) {
  const packages = [];
  const match = content.match(/environment\.systemPackages\s*=\s*(?:with\s+pkgs;\s*)?\[([^\]]*)\]/s);
  if (match) {
    const block = match[1];
    const extracted = extractPackages(block);
    packages.push(...extracted);
    const bare = extractBareNames(block);
    for (const name of bare) {
      if (!extracted.includes(name)) {
        packages.push(name);
      }
    }
  }
  return packages;
}

/**
 * Parse a block of nix code for home.packages
 */
function parseHomePackages(content) {
  const packages = [];
  const match = content.match(/home\.packages\s*=\s*(?:with\s+pkgs;\s*)?\[([^\]]*)\]/s);
  if (match) {
    const block = match[1];
    const extracted = extractPackages(block);
    packages.push(...extracted);
    const bare = extractBareNames(block);
    for (const name of bare) {
      if (!extracted.includes(name)) {
        packages.push(name);
      }
    }
  }
  return packages;
}

/**
 * Parse a block of nix code for users.users.<name>.packages
 */
function parseUserPackages(content) {
  const packages = [];
  const matches = content.matchAll(/users\.users\.[^.]+\.packages\s*=\s*(?:with\s+pkgs;\s*)?\[([^\]]*)\]/gs);
  for (const match of matches) {
    const block = match[1];
    const extracted = extractPackages(block);
    packages.push(...extracted);
    const bare = extractBareNames(block);
    for (const name of bare) {
      if (!extracted.includes(name)) {
        packages.push(name);
      }
    }
  }
  return packages;
}

/**
 * Parse NixOS option assignments from content.
 * Returns array of { category, path, value, line } objects.
 */
function parseOptions(content, relativePath) {
  const options = [];
  const lines = content.split('\n');
  const optionRegex = /^\s*(services|programs|hardware|networking|boot|system|virtualisation|security|users|fonts|environment|nixpkgs|nix|home)\.([a-zA-Z0-9._-]+)\s*=\s*(.+?);?\s*$/;

  lines.forEach((line, idx) => {
    const match = line.match(optionRegex);
    if (match) {
      const category = match[1];
      const optionPath = `${category}.${match[2]}`;
      let value = match[3].trim().replace(/;$/, '');
      options.push({
        category,
        path: optionPath,
        value,
        file: relativePath || null,
        line: idx + 1,
      });
    }
  });

  return options;
}

module.exports = {
  extractPackages,
  extractBareNames,
  parseSystemPackages,
  parseHomePackages,
  parseUserPackages,
  parseOptions,
};
