// @ts-check

import electron from 'electron';
const { contextBridge, ipcRenderer } = electron as any;

/** @type {import('./src/types/ipc').ElectronAPI} */
const electronAPI = {
  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  setTheme: (theme: string) => ipcRenderer.invoke('settings-set-theme', theme),

  // NixOS operations
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getDetailedSystemInfo: () => ipcRenderer.invoke('get-detailed-system-info'),
  getNotifications: () => ipcRenderer.invoke('get-notifications'),
  nixosRebuild: (options: any) => ipcRenderer.invoke('nixos-rebuild', options),
  cancelRebuild: () => ipcRenderer.invoke('cancel-rebuild'),
  switchSpecialization: (name: any) => ipcRenderer.invoke('switch-specialization', name),
  updateFlakeInputs: () => ipcRenderer.invoke('update-flake-inputs'),
  updateFlakeInput: (name: any) => ipcRenderer.invoke('update-flake-input', name),
  checkFlakeInputUpdates: () => ipcRenderer.invoke('check-flake-input-updates'),
  getSpecializations: () => ipcRenderer.invoke('get-specializations'),
  getFlakeInputs: () => ipcRenderer.invoke('get-flake-inputs'),
  getFlakeInfo: () => ipcRenderer.invoke('get-flake-info'),
  getPackages: () => ipcRenderer.invoke('get-packages'),
  getLivePackages: () => ipcRenderer.invoke('get-live-packages'),
  getPackageInfo: (name: any) => ipcRenderer.invoke('get-package-info', name),
  packagesGetDuplicates: () => ipcRenderer.invoke('packages-get-duplicates'),
  getPendingChanges: () => ipcRenderer.invoke('get-pending-changes'),

  // Options
  getOptions: () => ipcRenderer.invoke('get-options'),
  getLiveOptions: () => ipcRenderer.invoke('get-live-options'),
  getOptionInfo: (optionPath: any) => ipcRenderer.invoke('get-option-info', optionPath),
  setOptionValue: (payload: any) => ipcRenderer.invoke('set-option-value', payload),
  revertOptionFromGit: (payload: any) => ipcRenderer.invoke('revert-option-from-git', payload),
  optionsListFiles: () => ipcRenderer.invoke('options-list-files'),
  searchOptionsCatalog: (query: any, opts = {}) => ipcRenderer.invoke('search-options-catalog', query, opts),

  // Generations
  getGenerations: () => ipcRenderer.invoke('get-generations'),
  getGenerationInfo: (num: any) => ipcRenderer.invoke('get-generation-info', num),
  getGenerationDiff: (from: any, to: any) => ipcRenderer.invoke('get-generation-diff', from, to),
  switchGeneration: (num: any) => ipcRenderer.invoke('switch-generation', num),
  bootGeneration: (num: any) => ipcRenderer.invoke('boot-generation', num),
  deleteGeneration: (num: any) => ipcRenderer.invoke('delete-generation', num),

  // Git operations
  getGitInfo: () => ipcRenderer.invoke('get-git-info'),
  getCommitDetails: (hash: any) => ipcRenderer.invoke('get-commit-details', hash),
  gitSwitchBranch: (branch: any) => ipcRenderer.invoke('git-switch-branch', branch),
  gitPull: () => ipcRenderer.invoke('git-pull'),
  gitFetch: () => ipcRenderer.invoke('git-fetch'),

  // Discover (AppStream)
  discoverInit: () => ipcRenderer.invoke('discover-init'),
  discoverGetCategories: () => ipcRenderer.invoke('discover-get-categories'),
  discoverSearch: (query: any, options: any) => ipcRenderer.invoke('discover-search', query, options),
  discoverByCategory: (category: any, limit: any) => ipcRenderer.invoke('discover-by-category', category, limit),
  discoverFeatured: (limit: any) => ipcRenderer.invoke('discover-featured', limit),
  discoverGetIcon: (iconName: any) => ipcRenderer.invoke('discover-get-icon', iconName),
  discoverGetDetails: (pkgname: any) => ipcRenderer.invoke('discover-get-details', pkgname),
  discoverRefresh: () => ipcRenderer.invoke('discover-refresh'),
  discoverSearchNixpkgs: (query: any) => ipcRenderer.invoke('discover-search-nixpkgs', query),
  discoverTryPackage: (pkgname: any) => ipcRenderer.invoke('discover-try-package', pkgname),
  discoverIsTrying: () => ipcRenderer.invoke('discover-is-trying'),
  discoverKillTry: () => ipcRenderer.invoke('discover-kill-try'),
  discoverFindPackage: (pkgname: any) => ipcRenderer.invoke('discover-find-package', pkgname),
  discoverGetConfigFiles: () => ipcRenderer.invoke('discover-get-config-files'),
  discoverCheckNixpkgsPackage: (pkgname: any) => ipcRenderer.invoke('discover-check-nixpkgs-package', pkgname),
  discoverAddPackage: (options: any) => ipcRenderer.invoke('discover-add-package', options),
  discoverGetConfigured: () => ipcRenderer.invoke('discover-get-configured'),
  discoverRemovePackage: (options: any) => ipcRenderer.invoke('discover-remove-package', options),

  // History (persistent audit log)
  historyGet: () => ipcRenderer.invoke('history-get'),
  historyAdd: (entry: any) => ipcRenderer.invoke('history-add', entry),
  historyAddOption: (entry: any) => ipcRenderer.invoke('history-add-option', entry),

  // Build output listener — returns a cleanup function to remove the listener
  onBuildOutput: (callback: any) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('build-output', handler);
    return () => ipcRenderer.removeListener('build-output', handler);
  },

  // Build complete listener — returns a cleanup function
  onBuildComplete: (callback: any) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('build-complete', handler);
    return () => ipcRenderer.removeListener('build-complete', handler);
  },

  // Terminal show listener — returns a cleanup function
  onTerminalShow: (callback: any) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('terminal-show', handler);
    return () => ipcRenderer.removeListener('terminal-show', handler);
  },

  // Try process ended listener — returns a cleanup function
  onTryProcessEnded: (callback: any) => {
    const handler = () => callback();
    ipcRenderer.on('try-process-ended', handler);
    return () => ipcRenderer.removeListener('try-process-ended', handler);
  },

  // Show updates listener — returns a cleanup function
  onShowUpdates: (callback: any) => {
    const handler = () => callback();
    ipcRenderer.on('show-updates', handler);
    return () => ipcRenderer.removeListener('show-updates', handler);
  },

  // Flake update check completed — returns a cleanup function
  onFlakeUpdateCheckComplete: (callback: any) => {
    const handler = (_event: any, status: any) => callback(status);
    ipcRenderer.on('flake-update-check-complete', handler);
    return () => ipcRenderer.removeListener('flake-update-check-complete', handler);
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export {};
