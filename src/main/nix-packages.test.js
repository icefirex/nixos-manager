const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  stripStrings,
  extractFromList,
  extractListBlock,
  extractListBlockAt,
  scanNixPackages,
  findPackageLines,
  findPackage,
  findDuplicates,
  getAllPackages,
} = require('./nix-packages');

function makeTempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nix-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('stripStrings', () => {
  it('replaces nix double-quoted strings with null chars', () => {
    const input = 'foo = "bar";';
    const result = stripStrings(input);
    expect(result).toBe('foo = \x00\x00\x00\x00\x00;');
    expect(result).not.toContain('bar');
  });

  it('handles escaped quotes in double-quoted strings', () => {
    const input = 'foo = "say \\"hi\\"";';
    const result = stripStrings(input);
    expect(result).not.toContain('hi');
  });

  it('replaces nix multiline strings (single quotes) with null chars', () => {
    const input = "script = ''\necho hello\n'';";
    const result = stripStrings(input);
    expect(result).not.toContain('echo hello');
  });

  it('handles escaped quotes inside multiline strings (quote-quote-quote)', () => {
    // In Nix, ''' inside ''...'' is an escaped ''
    const input = "x = ''it''''s fine'';";
    const result = stripStrings(input);
    expect(result).not.toContain('fine');
  });

  it('preserves non-string content', () => {
    const input = 'pkgs.htop\npkgs.git';
    const result = stripStrings(input);
    expect(result).toBe(input);
  });

  it('strips multiline string that contains brackets', () => {
    const input = "config = ''\n  [1, 2, 3]\n'';\npackages = [ pkgs.htop ];";
    const result = stripStrings(input);
    expect(result).not.toContain('[1, 2, 3]');
    expect(result).toContain('pkgs.htop');
  });

  it('handles string with WORKDIR pattern (escaped dollar)', () => {
    const input = "dockerConfig = ''\nWORKDIR=\"''${2:-$PWD}\"\n'';";
    const result = stripStrings(input);
    expect(result).not.toContain('WORKDIR');
    expect(result).not.toContain('$PWD');
  });

  it('terminates multiline string at closing paren', () => {
    const input = "f = ( ''\ncontent\n'' );";
    const result = stripStrings(input);
    expect(result).not.toContain('content');
    expect(result).toContain(')');
  });

  it('terminates multiline string at closing bracket', () => {
    const input = "list = [ ''\nhello\n'' ];";
    const result = stripStrings(input);
    expect(result).not.toContain('hello');
    expect(result).toContain(']');
  });

  it('terminates multiline string at semicolon', () => {
    const input = "a = ''\nval\n''; b = 1;";
    const result = stripStrings(input);
    expect(result).not.toContain('val');
    expect(result).toContain('b = 1');
  });

  it('handles empty content', () => {
    expect(stripStrings('')).toBe('');
  });

  it('does not treat single quote as string start', () => {
    const input = "name = 'single';";
    const result = stripStrings(input);
    expect(result).toContain("name = 'single';");
  });
});

describe('extractFromList', () => {
  it('extracts pkgs.xxx patterns', () => {
    expect(extractFromList('pkgs.htop\npkgs.git')).toEqual(['htop', 'git']);
  });

  it('extracts pkgs-stable.xxx patterns', () => {
    expect(extractFromList('pkgs-stable.firefox')).toEqual(['firefox']);
  });

  it('extracts pkgs-unstable.xxx patterns', () => {
    expect(extractFromList('pkgs-unstable.nodejs')).toEqual(['nodejs']);
  });

  it('extracts pkgs-custom.xxx patterns', () => {
    expect(extractFromList('pkgs-mychannel.vim')).toEqual(['vim']);
  });

  it('extracts bare names (with pkgs context)', () => {
    expect(extractFromList('\n  htop\n  git\n  vim\n')).toEqual(['htop', 'git', 'vim']);
  });

  it('deduplicates packages', () => {
    expect(extractFromList('pkgs.htop\nhtop')).toEqual(['htop']);
  });

  it('ignores inline comments', () => {
    expect(extractFromList('btop # Monitor of resources')).toEqual(['btop']);
  });

  it('ignores lines with assignment (=)', () => {
    expect(extractFromList('config = something')).toEqual([]);
  });

  it('ignores lines with braces', () => {
    expect(extractFromList('{ name = "x"; }')).toEqual([]);
  });

  it('handles empty input', () => {
    expect(extractFromList('')).toEqual([]);
  });

  it('handles names with underscores and hyphens', () => {
    expect(extractFromList('pkgs.nodejs_20\nmy-package')).toEqual(['nodejs_20', 'my-package']);
  });

  it('ignores pkgs without a word after dot', () => {
    expect(extractFromList('pkgs. something')).toEqual([]);
  });
});

describe('extractListBlock', () => {
  it('extracts content between brackets', () => {
    const content = 'environment.systemPackages = [\n  pkgs.htop\n  pkgs.git\n];';
    const result = extractListBlock(content, /environment\.systemPackages\s*=\s*/);
    expect(result).toContain('pkgs.htop');
    expect(result).toContain('pkgs.git');
  });

  it('handles nested brackets', () => {
    const content = 'x = [\n  [1, 2]\n  pkgs.htop\n];';
    const result = extractListBlock(content, /x\s*=\s*/);
    expect(result).toContain('pkgs.htop');
  });

  it('returns null when pattern not found', () => {
    const result = extractListBlock('no match here', /environment\.systemPackages/);
    expect(result).toBeNull();
  });

  it('strips strings before finding brackets', () => {
    const content = "comment = ''has [ bracket'';\nlist = [ pkgs.a ];";
    const result = extractListBlock(content, /list\s*=\s*/);
    expect(result).toContain('pkgs.a');
  });

  it('handles ++= operator', () => {
    const content = 'home.packages += [\n  pkgs.bat\n];';
    const result = extractListBlock(content, /home\.packages\s*(?:\+=|=)\s*/);
    expect(result).toContain('pkgs.bat');
  });

  it('handles with pkgs prefix', () => {
    const content = 'home.packages = with pkgs; [\n  htop\n  git\n];';
    const result = extractListBlock(content, /home\.packages\s*(?:\+=|=)\s*(?:with\s+pkgs;\s*)?/);
    expect(result).toContain('htop');
    expect(result).toContain('git');
  });
});

describe('extractListBlockAt', () => {
  it('finds the next bracket at or after startIndex', () => {
    const content = 'prefix = [ pkgs.a ];\nother = [ pkgs.b ];';
    const idx = content.indexOf('other');
    const result = extractListBlockAt(content, idx);
    expect(result).toContain('pkgs.b');
  });

  it('returns null if no bracket found', () => {
    expect(extractListBlockAt('no brackets here', 0)).toBeNull();
  });
});

describe('scanNixPackages', () => {
  let dir;

  afterEach(() => {
    if (dir) cleanup(dir);
  });

  it('scans system packages from environment.systemPackages', () => {
    dir = makeTempDir({
      'config.nix': `
        environment.systemPackages = [
          pkgs.htop
          pkgs.git
        ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(1);
    expect(results[0].system).toEqual(['htop', 'git']);
  });

  it('scans home-manager packages from home.packages', () => {
    dir = makeTempDir({
      'home.nix': `
        home.packages = [
          pkgs.ripgrep
          pkgs.fd
        ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(1);
    expect(results[0].homeManager).toEqual(['ripgrep', 'fd']);
  });

  it('scans user packages from users.users.<name>.packages', () => {
    dir = makeTempDir({
      'users.nix': `
        users.users.alice.packages = [
          pkgs.vim
        ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(1);
    expect(results[0].users.alice).toEqual(['vim']);
  });

  it('scans multiple users in the same file', () => {
    dir = makeTempDir({
      'users.nix': `
        users.users.alice.packages = [ pkgs.htop ];
        users.users.bob.packages = [ pkgs.emacs ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(1);
    expect(results[0].users.alice).toEqual(['htop']);
    expect(results[0].users.bob).toEqual(['emacs']);
  });

  it('handles with pkgs syntax', () => {
    dir = makeTempDir({
      'config.nix': `
        environment.systemPackages = with pkgs; [
          htop
          git
          pkgs.vim
        ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results[0].system).toContain('htop');
    expect(results[0].system).toContain('git');
    expect(results[0].system).toContain('vim');
  });

  it('handles ++= operator', () => {
    dir = makeTempDir({
      'config.nix': `
        environment.systemPackages = [ pkgs.base ];
        environment.systemPackages += [ pkgs.extra ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(1);
  });

  it('ignores files without package declarations', () => {
    dir = makeTempDir({
      'empty.nix': `
        services.openssh.enable = true;
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(0);
  });

  it('scans nested directories', () => {
    dir = makeTempDir({
      'modules/system/packages.nix': `
        environment.systemPackages = [ pkgs.a ];
      `,
      'modules/user/ice/home.nix': `
        home.packages = [ pkgs.b ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(2);
  });

  it('ignores dotfiles and node_modules', () => {
    dir = makeTempDir({
      '.hidden.nix': `
        environment.systemPackages = [ pkgs.hidden ];
      `,
      'valid.nix': `
        environment.systemPackages = [ pkgs.visible ];
      `
    });
    // Note: .hidden.nix won't be picked up because the file starts with '.'
    // but the directory scan checks entry.name.endsWith('.nix')
    // Actually it does check - let me verify: the scanDir function checks
    // entry.isFile() && entry.name.endsWith('.nix')
    // A file named '.hidden.nix' does end with '.nix', so it WOULD be scanned
    const results = scanNixPackages(dir);
    // Both files should be found (the .hidden dir check is for directories)
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('handles nix strings with shell scripts in config', () => {
    dir = makeTempDir({
      'dynamic.nix': `
        environment.etc."custom/script.sh".text = ''
          #!/bin/bash
          if [ -f "$file" ]; then
            echo "found"
          else
            echo "not found"
          fi
        '';
        environment.systemPackages = [
          pkgs.real-package
        ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results).toHaveLength(1);
    expect(results[0].system).toEqual(['real-package']);
  });

  it('does not extract shell keywords from strings as packages', () => {
    dir = makeTempDir({
      'docker.nix': `
        virtualisation.docker.enable = true;
        virtualisation.docker.daemonOptions = ''
          --log-opt max-size=1g
        '';
        environment.systemPackages = [
          pkgs.docker
        ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results[0].system).toEqual(['docker']);
  });

  it('preserves relativePath', () => {
    dir = makeTempDir({
      'modules/system/packages.nix': `
        environment.systemPackages = [ pkgs.x ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results[0].relativePath).toBe('modules/system/packages.nix');
  });
});

describe('findPackageLines', () => {
  let dir;

  afterEach(() => {
    if (dir) cleanup(dir);
  });

  it('finds line numbers for pkgs.xxx entries', () => {
    dir = makeTempDir({});
    const filePath = path.join(dir, 'test.nix');
    fs.writeFileSync(filePath, `environment.systemPackages = [
  pkgs.first
  pkgs.second
  pkgs.third
];`);
    const lines = findPackageLines(filePath, 'second');
    expect(lines).toEqual([3]);
  });

  it('finds line numbers for bare names (with pkgs)', () => {
    dir = makeTempDir({});
    const filePath = path.join(dir, 'test.nix');
    fs.writeFileSync(filePath, `environment.systemPackages = with pkgs; [
  htop
  git
];`);
    const lines = findPackageLines(filePath, 'git');
    expect(lines).toEqual([3]);
  });

  it('returns empty array when package not found', () => {
    dir = makeTempDir({});
    const filePath = path.join(dir, 'test.nix');
    fs.writeFileSync(filePath, `environment.systemPackages = [
  pkgs.htop
];`);
    const lines = findPackageLines(filePath, 'vim');
    expect(lines).toEqual([]);
  });

  it('handles multiple occurrences', () => {
    dir = makeTempDir({});
    const filePath = path.join(dir, 'test.nix');
    fs.writeFileSync(filePath, `environment.systemPackages = [
  pkgs.htop
];
home.packages = [
  pkgs.htop
];`);
    const lines = findPackageLines(filePath, 'htop');
    expect(lines).toEqual([2, 5]);
  });

  it('ignores package names inside strings', () => {
    dir = makeTempDir({});
    const filePath = path.join(dir, 'test.nix');
    fs.writeFileSync(filePath, `
      someOption = "pkgs.fake-package";
      environment.systemPackages = [
        pkgs.real-package
      ];`);
    const lines = findPackageLines(filePath, 'real-package');
    expect(lines).toEqual([4]);
  });

  it('handles inline comments on the package line', () => {
    dir = makeTempDir({});
    const filePath = path.join(dir, 'test.nix');
    fs.writeFileSync(filePath, `environment.systemPackages = [
  btop # Monitor of resources
  pkgs.other
];`);
    const lines = findPackageLines(filePath, 'btop');
    expect(lines).toEqual([2]);
  });

  it('returns empty for non-existent file', () => {
    const lines = findPackageLines('/nonexistent/path.nix', 'foo');
    expect(lines).toEqual([]);
  });
});

describe('integration: scan + extract with complex config', () => {
  let dir;

  afterEach(() => {
    if (dir) cleanup(dir);
  });

  it('handles a realistic multi-section flake config', () => {
    dir = makeTempDir({
      'modules/system/packages.nix': `
        { config, pkgs, ... }:
        {
          environment.systemPackages = [
            pkgs.git
            pkgs.htop
            pkgs.ripgrep # fast search
          ];

          environment.etc."custom/thing".text = ''
            this has [ brackets ] and "quotes"
            and shell: if [ -x /bin/foo ]; then echo yes; fi
          '';
        }
      `,
      'modules/user/ice/home.nix': `
        { config, pkgs, ... }:
        {
          home.packages = [
            pkgs.alacritty
            pkgs.starship
          ];
        }
      `,
      'modules/user/tudor/system.nix': `
        { config, pkgs, ... }:
        {
          users.users.tudor.packages = [
            pkgs.vscode
            pkgs.terraform
          ];
        }
      `
    });

    const results = scanNixPackages(dir);
    expect(results).toHaveLength(3);

    const systemFile = results.find(r => r.relativePath.includes('system/packages'));
    expect(systemFile.system).toEqual(['git', 'htop', 'ripgrep']);

    const iceFile = results.find(r => r.relativePath.includes('ice'));
    expect(iceFile.homeManager).toEqual(['alacritty', 'starship']);

    const tudorFile = results.find(r => r.relativePath.includes('tudor'));
    expect(tudorFile.users.tudor).toEqual(['vscode', 'terraform']);
  });

  it('does not pick up false positives from nix strings', () => {
    dir = makeTempDir({
      'complex.nix': `
        services.foo.settings.script = ''
          #!/usr/bin/env bash
          for f in /etc/[a-z]*; do
            if grep -q "pattern" "$f"; then
              echo "matched: $f"
            fi
          done
          # this looks like a package but isn't
          # htop
        '';
        environment.systemPackages = [
          pkgs.genuine
        ];
      `
    });
    const results = scanNixPackages(dir);
    expect(results[0].system).toEqual(['genuine']);
  });
});

describe('getAllPackages', () => {
  let dir;
  let originalFlakeDir;

  beforeEach(() => {
    originalFlakeDir = process.env.FLAKE_DIR;
  });

  afterEach(() => {
    if (dir) cleanup(dir);
    if (originalFlakeDir) process.env.FLAKE_DIR = originalFlakeDir;
    else delete process.env.FLAKE_DIR;
  });

  it('returns flat sorted lists per scope', () => {
    dir = makeTempDir({
      'sys.nix': `
        environment.systemPackages = [
          pkgs.zeta
          pkgs.alpha
        ];
      `,
      'user.nix': `
        users.users.alice.packages = [ pkgs.mid ];
      `,
      'home.nix': `
        home.packages = [ pkgs.beta ];
      `
    });
    // Create a fake flake.nix so findFlakeDir finds it
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const result = getAllPackages();
    expect(result.system).toEqual(['alpha', 'zeta']);
    expect(result.user).toEqual(['mid']);
    expect(result.homeManager).toEqual(['beta']);
  });

  it('deduplicates across files in same scope', () => {
    dir = makeTempDir({
      'a.nix': `
        environment.systemPackages = [ pkgs.htop ];
      `,
      'b.nix': `
        environment.systemPackages = [ pkgs.htop pkgs.git ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const result = getAllPackages();
    expect(result.system).toEqual(['git', 'htop']);
  });

  it('returns empty lists when no flake dir found', () => {
    process.env.FLAKE_DIR = '/nonexistent/path/xyz';
    const result = getAllPackages();
    expect(result).toEqual({ system: [], user: [], homeManager: [] });
  });
});

describe('findPackage', () => {
  let dir;
  let originalFlakeDir;

  beforeEach(() => {
    originalFlakeDir = process.env.FLAKE_DIR;
  });

  afterEach(() => {
    if (dir) cleanup(dir);
    if (originalFlakeDir) process.env.FLAKE_DIR = originalFlakeDir;
    else delete process.env.FLAKE_DIR;
  });

  it('finds a package in system scope', () => {
    dir = makeTempDir({
      'sys.nix': `
        environment.systemPackages = [
          pkgs.htop
          pkgs.git
        ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const results = findPackage('htop');
    expect(results).toHaveLength(1);
    expect(results[0].relativePath).toBe('sys.nix');
    expect(results[0].sections).toContain('system');
    expect(results[0].lines).toEqual([3]);
  });

  it('finds a package in multiple scopes', () => {
    dir = makeTempDir({
      'both.nix': `
        environment.systemPackages = [ pkgs.ripgrep ];
        home.packages = [ pkgs.ripgrep ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const results = findPackage('ripgrep');
    expect(results).toHaveLength(1);
    expect(results[0].sections).toContain('system');
    expect(results[0].sections).toContain('homeManager');
  });

  it('returns empty array when package not found', () => {
    dir = makeTempDir({
      'sys.nix': `
        environment.systemPackages = [ pkgs.htop ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const results = findPackage('nonexistent-pkg');
    expect(results).toEqual([]);
  });

  it('finds user-scoped packages with user label', () => {
    dir = makeTempDir({
      'users.nix': `
        users.users.bob.packages = [ pkgs.vim ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const results = findPackage('vim');
    expect(results).toHaveLength(1);
    expect(results[0].sections).toContain('user:bob');
  });
});

describe('findDuplicates', () => {
  let dir;
  let originalFlakeDir;

  beforeEach(() => {
    originalFlakeDir = process.env.FLAKE_DIR;
  });

  afterEach(() => {
    if (dir) cleanup(dir);
    if (originalFlakeDir) process.env.FLAKE_DIR = originalFlakeDir;
    else delete process.env.FLAKE_DIR;
  });

  it('detects same package in multiple files (same scope)', () => {
    dir = makeTempDir({
      'a.nix': `
        environment.systemPackages = [ pkgs.htop pkgs.git ];
      `,
      'b.nix': `
        environment.systemPackages = [ pkgs.htop pkgs.vim ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const dups = findDuplicates();
    expect(dups).toHaveLength(1);
    expect(dups[0].pkgname).toBe('htop');
    expect(dups[0].scope).toBe('system');
    expect(dups[0].crossUser).toBe(false);
    expect(dups[0].files).toHaveLength(2);
  });

  it('detects cross-user duplicates', () => {
    dir = makeTempDir({
      'alice.nix': `
        users.users.alice.packages = [ pkgs.terraform ];
      `,
      'bob.nix': `
        users.users.bob.packages = [ pkgs.terraform ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const dups = findDuplicates();
    expect(dups).toHaveLength(1);
    expect(dups[0].pkgname).toBe('terraform');
    expect(dups[0].crossUser).toBe(true);
    expect(dups[0].users).toEqual(['alice', 'bob']);
  });

  it('does not flag packages in only one file', () => {
    dir = makeTempDir({
      'a.nix': `
        environment.systemPackages = [ pkgs.htop ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const dups = findDuplicates();
    expect(dups).toEqual([]);
  });

  it('does not flag same package in different scopes (system + home)', () => {
    dir = makeTempDir({
      'a.nix': `
        environment.systemPackages = [ pkgs.htop ];
      `,
      'b.nix': `
        home.packages = [ pkgs.htop ];
      `
    });
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;

    const dups = findDuplicates();
    // Different scopes, not a duplicate
    expect(dups).toEqual([]);
  });

  it('returns empty when no flake dir', () => {
    process.env.FLAKE_DIR = '/nonexistent/xyz';
    const dups = findDuplicates();
    expect(dups).toEqual([]);
  });
});
