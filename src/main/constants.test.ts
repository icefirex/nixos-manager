const {
  NIX_PROFILES_DIR,
  NIX_SYSTEM_PROFILE,
  NIX_CURRENT_SYSTEM,
  NIX_FLAKE_REGISTRY,
  CMD_TIMEOUT_DEFAULT,
  CMD_TIMEOUT_FAST,
  CMD_TIMEOUT_NETWORK,
  FLAKE_STALE_DAYS,
  FLAKE_WARN_DAYS,
  DISK_CRITICAL_PCT,
  DISK_WARN_PCT,
  MAX_GENERATIONS_WARN,
} = require('./constants');

describe('constants', () => {
  it('exports Nix system paths', () => {
    expect(NIX_PROFILES_DIR).toBe('/nix/var/nix/profiles');
    expect(NIX_SYSTEM_PROFILE).toBe('/nix/var/nix/profiles/system');
    expect(NIX_CURRENT_SYSTEM).toBe('/run/current-system');
    expect(NIX_FLAKE_REGISTRY).toBe('nixpkgs');
  });

  it('exports command timeouts in descending order', () => {
    expect(CMD_TIMEOUT_FAST).toBeLessThan(CMD_TIMEOUT_DEFAULT);
    expect(CMD_TIMEOUT_DEFAULT).toBeLessThan(CMD_TIMEOUT_NETWORK);
    expect(CMD_TIMEOUT_FAST).toBe(10000);
    expect(CMD_TIMEOUT_DEFAULT).toBe(15000);
    expect(CMD_TIMEOUT_NETWORK).toBe(30000);
  });

  it('exports notification thresholds', () => {
    expect(FLAKE_STALE_DAYS).toBe(14);
    expect(FLAKE_WARN_DAYS).toBe(7);
    expect(DISK_CRITICAL_PCT).toBe(90);
    expect(DISK_WARN_PCT).toBe(80);
    expect(MAX_GENERATIONS_WARN).toBe(20);
  });
});
