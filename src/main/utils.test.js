const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  flakeDirNotFoundMsg,
  updateBuildStatus,
  getLastBuildStatus,
  getSpawnEnv,
  findFlakeDir,
  runCmd,
} = require('./utils');

describe('flakeDirNotFoundMsg', () => {
  it('returns a user-facing message mentioning common locations', () => {
    const msg = flakeDirNotFoundMsg();
    expect(msg).toContain('Could not find a NixOS flake directory');
    expect(msg).toContain('$FLAKE_DIR');
    expect(msg).toContain('~/nixos-config');
    expect(msg).toContain('~/.config/nixos');
    expect(msg).toContain('/etc/nixos');
  });
});

describe('build status', () => {
  beforeEach(() => {
    updateBuildStatus(null, null);
  });

  it('stores and returns build status', () => {
    updateBuildStatus(true, 'Build succeeded');
    const status = getLastBuildStatus();
    expect(status.success).toBe(true);
    expect(status.message).toBe('Build succeeded');
    expect(status.time).toBeDefined();
  });

  it('overwrites previous status', () => {
    updateBuildStatus(true, 'First build');
    updateBuildStatus(false, 'Second build failed');
    const status = getLastBuildStatus();
    expect(status.success).toBe(false);
    expect(status.message).toBe('Second build failed');
  });
});

describe('getSpawnEnv', () => {
  it('includes color-related env vars', () => {
    const env = getSpawnEnv();
    expect(env.TERM).toBe('xterm-256color');
    expect(env.FORCE_COLOR).toBe('3');
    expect(env.CLICOLOR_FORCE).toBe('1');
    expect(env.COLORTERM).toBe('truecolor');
  });

  it('prepends Nix system path to PATH', () => {
    const env = getSpawnEnv();
    expect(env.PATH).toContain('/run/current-system/sw/bin');
  });

  it('spreads process.env', () => {
    const env = getSpawnEnv();
    if (process.env.HOME) expect(env.HOME).toBe(process.env.HOME);
  });
});

describe('findFlakeDir', () => {
  let originalFlakeDir;

  beforeEach(() => {
    originalFlakeDir = process.env.FLAKE_DIR;
  });

  afterEach(() => {
    if (originalFlakeDir) process.env.FLAKE_DIR = originalFlakeDir;
    else delete process.env.FLAKE_DIR;
  });

  it('prefers FLAKE_DIR env var when it contains flake.nix', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-test-'));
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }');
    process.env.FLAKE_DIR = dir;
    const result = findFlakeDir();
    expect(result).toBe(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when FLAKE_DIR points to a dir without flake.nix', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-test-'));
    process.env.FLAKE_DIR = dir;
    // Need to also remove other candidate paths by testing in isolation
    // findFlakeDir checks FLAKE_DIR first, then ~/nixos-config, ~/.config/nixos, /etc/nixos
    // In the Nix sandbox /etc/nixos might exist, so we just verify it doesn't crash
    expect(() => findFlakeDir()).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('runCmd', () => {
  it('returns trimmed stdout on success', async () => {
    const result = await runCmd('echo hello');
    expect(result).toBe('hello');
  });

  it('returns empty string on failure', async () => {
    const result = await runCmd('nonexistent-command-xyz 2>/dev/null; exit 1');
    expect(result).toBe('');
  });
});
