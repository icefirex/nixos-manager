const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  getVersion: () => ipcRenderer.invoke('get-app-version'),

  // NixOS operations
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getDetailedSystemInfo: () => ipcRenderer.invoke('get-detailed-system-info'),
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  nixosRebuild: (options) => ipcRenderer.invoke('nixos-rebuild', options),
  switchSpecialization: (name) => ipcRenderer.invoke('switch-specialization', name),
  updateFlakeInputs: () => ipcRenderer.invoke('update-flake-inputs'),
  updateFlakeInput: (name) => ipcRenderer.invoke('update-flake-input', name),
  checkFlakeInputUpdates: () => ipcRenderer.invoke('check-flake-input-updates'),
  getSpecializations: () => ipcRenderer.invoke('get-specializations'),
  getFlakeInputs: () => ipcRenderer.invoke('get-flake-inputs'),
  getPackages: () => ipcRenderer.invoke('get-packages'),
  getLivePackages: () => ipcRenderer.invoke('get-live-packages'),
  getPackageInfo: (name) => ipcRenderer.invoke('get-package-info', name),

  // Options
  getOptions: () => ipcRenderer.invoke('get-options'),
  getLiveOptions: () => ipcRenderer.invoke('get-live-options'),
  getOptionInfo: (path) => ipcRenderer.invoke('get-option-info', path),

  // Generations
  getGenerations: () => ipcRenderer.invoke('get-generations'),
  getGenerationInfo: (num) => ipcRenderer.invoke('get-generation-info', num),
  getGenerationDiff: (from, to) => ipcRenderer.invoke('get-generation-diff', from, to),
  switchGeneration: (num) => ipcRenderer.invoke('switch-generation', num),
  bootGeneration: (num) => ipcRenderer.invoke('boot-generation', num),
  deleteGeneration: (num) => ipcRenderer.invoke('delete-generation', num),

  // Git operations
  getGitInfo: () => ipcRenderer.invoke('get-git-info'),
  getCommitDetails: (hash) => ipcRenderer.invoke('get-commit-details', hash),
  gitSwitchBranch: (branch) => ipcRenderer.invoke('git-switch-branch', branch),
  gitPull: () => ipcRenderer.invoke('git-pull'),
  gitFetch: () => ipcRenderer.invoke('git-fetch'),

  // Discover (AppStream)
  discoverInit: () => ipcRenderer.invoke('discover-init'),
  discoverGetCategories: () => ipcRenderer.invoke('discover-get-categories'),
  discoverSearch: (query, options) => ipcRenderer.invoke('discover-search', query, options),
  discoverByCategory: (category, limit) => ipcRenderer.invoke('discover-by-category', category, limit),
  discoverFeatured: (limit) => ipcRenderer.invoke('discover-featured', limit),
  discoverGetIcon: (iconName) => ipcRenderer.invoke('discover-get-icon', iconName),
  discoverGetDetails: (pkgname) => ipcRenderer.invoke('discover-get-details', pkgname),
  discoverRefresh: () => ipcRenderer.invoke('discover-refresh'),
  discoverSearchNixpkgs: (query) => ipcRenderer.invoke('discover-search-nixpkgs', query),
  discoverTryPackage: (pkgname) => ipcRenderer.invoke('discover-try-package', pkgname),
  discoverIsTrying: () => ipcRenderer.invoke('discover-is-trying'),
  discoverKillTry: () => ipcRenderer.invoke('discover-kill-try'),

  // Build output listener
  onBuildOutput: (callback) => {
    ipcRenderer.on('build-output', (event, data) => callback(data));
  },

  // Build complete listener
  onBuildComplete: (callback) => {
    ipcRenderer.on('build-complete', (event, data) => callback(data));
  },

  // Terminal show listener
  onTerminalShow: (callback) => {
    ipcRenderer.on('terminal-show', (event, data) => callback(data));
  },

  // Try process ended listener
  onTryProcessEnded: (callback) => {
    ipcRenderer.on('try-process-ended', () => callback());
  },

  // Show updates listener (triggered by --show-updates CLI flag)
  onShowUpdates: (callback) => {
    ipcRenderer.on('show-updates', () => callback());
  },

  // Flake update check completed (background check on launch)
  onFlakeUpdateCheckComplete: (callback) => {
    ipcRenderer.on('flake-update-check-complete', (event, status) => callback(status));
  }
});
