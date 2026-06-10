// CQ-09: Centralised constants — avoids scattered magic strings/numbers

// ----- Nix system paths -----
const NIX_PROFILES_DIR    = '/nix/var/nix/profiles';
const NIX_SYSTEM_PROFILE  = '/nix/var/nix/profiles/system';
const NIX_CURRENT_SYSTEM  = '/run/current-system';

// Default flake registry prefix used in nix eval / nix search invocations
const NIX_FLAKE_REGISTRY  = 'nixpkgs';

// ----- Command timeouts (milliseconds) -----
const CMD_TIMEOUT_DEFAULT  = 15000;  // generic local commands
const CMD_TIMEOUT_FAST     = 10000;  // quick grep / git log
const CMD_TIMEOUT_NETWORK  = 30000;  // git pull / nix-store queries

// ----- Notification / staleness thresholds -----
const FLAKE_STALE_DAYS       = 14;  // input age that triggers a "stale" notification
const FLAKE_WARN_DAYS        = 7;   // input age that sets status → 'stale' in the UI
const DISK_CRITICAL_PCT      = 90;  // disk usage % for critical warning
const DISK_WARN_PCT          = 80;  // disk usage % for low-space warning
const MAX_GENERATIONS_WARN   = 20;  // generation count before cleanup suggestion

module.exports = {
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
};
