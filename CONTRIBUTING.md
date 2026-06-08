# Contributing to NixOS Manager

Thank you for your interest in contributing.

## Development Setup

```bash
git clone https://github.com/icefirex/nixos-manager.git
cd nixos-manager
npm install
npm run dev
```

This starts the Vite dev server and Electron simultaneously with hot reload.

Alternatively, use the provided `shell.nix`:

```bash
nix-shell
npm run dev
```

## Project Structure

- `src/` — Svelte frontend (renderer process)
- `src/main/handlers/` — IPC handlers (main process, one file per feature area)
- `scripts/` — Bundled shell scripts installed alongside the app
- `package.nix` — Nix derivation
- `nixos-module.nix` — NixOS module
- `flake.nix` — Flake definition for standalone use

## Making Changes

### Frontend (Svelte)
Edit files under `src/`. Hot reload is active in dev mode.

### IPC Handlers (Node.js)
Edit files under `src/main/handlers/`. Restart Electron (`Ctrl+R` in dev mode) to pick up changes.

### Bundled Scripts
Edit `scripts/nixos-manager-rebuild` or `scripts/nixos-manager-eval`. These are plain bash scripts — test them directly before submitting.

### Nix Packaging
If you change `package.json` or `package-lock.json`, update `npmDepsHash` in `package.nix`:

```bash
nix build . 2>&1 | grep 'got:' | awk '{print $2}'
```

## Code Style

- Svelte components use runes mode (`$state`, `$props`, `$effect`)
- IPC handler files follow the `{ register }` export pattern
- Shell scripts use `set -euo pipefail` and explicit variable quoting

## Pull Requests

1. Fork the repository and create a feature branch
2. Keep commits focused; one logical change per commit
3. Test your changes on a NixOS system with a flake configuration
4. Open a PR against `main` with a clear description

## Reporting Issues

Please include:
- NixOS version (`nixos-version`)
- App version (visible in the title bar)
- Steps to reproduce
- Relevant terminal output (enable DevTools with `ELECTRON_IS_DEV=1 nixos-manager`)
