export type BuildAction = 'switch' | 'boot' | 'test' | 'dry-build';

export interface NixosRebuildRequest {
  action: BuildAction;
  updateInputs?: boolean;
}

export interface OptionSetPayload {
  optionPath: string;
  newValue: string;
  filePath?: string;
  preferredFile?: string;
  allowCreate?: boolean;
}

export interface OptionRevertPayload {
  optionPath: string;
  filePath: string;
  fallbackValue?: string;
}

export interface OptionMutationResult {
  success: boolean;
  action?: 'set' | 'added' | 'removed' | 'reverted';
  file?: string;
  relativePath?: string;
  oldValue?: string | null;
  newValue?: string | null;
  diff?: string | null;
  error?: string;
}

export interface OptionFileEntry {
  path: string;
  relativePath: string;
}

export interface OptionFileListResult {
  success: boolean;
  files?: OptionFileEntry[];
  error?: string;
}

export interface OptionCatalogEntry {
  path: string;
  description: string | null;
  type: string | null;
  default: string | null;
  example: string | null;
  declared: string | null;
}

export interface OptionCatalogSearchResult {
  success: boolean;
  results?: OptionCatalogEntry[];
  error?: string;
}

export interface OptionChange {
  optionPath: string;
  action: 'set' | 'added' | 'removed' | 'reverted';
  oldValue: string | null;
  newValue: string | null;
  file: string;
  edits: number;
  source?: 'sqlite' | 'git';
}

export interface OptionDiffDelta {
  optionPath: string;
  file: string;
  from?: string;
  to?: string;
}

export interface OptionDiffSummary {
  added: OptionDiffDelta[];
  removed: OptionDiffDelta[];
  changed: OptionDiffDelta[];
}

export interface PendingChangesResult {
  hasDrift: boolean;
  pendingInstall: string[];
  pendingRemove: string[];
  optionChanges: OptionChange[];
  changedFiles: string[];
  optionDiffSummary?: OptionDiffSummary;
  lastRebuild: string | null;
  lastConfigChange: string | null;
}

export interface HistoryEntry {
  pkgname: string;
  action: 'added' | 'removed';
  file: string;
  type?: string | null;
  userName?: string | null;
}

export interface OptionHistoryEntry {
  optionPath: string;
  action: 'set' | 'added' | 'removed' | 'reverted';
  oldValue?: string | null;
  newValue?: string | null;
  file: string;
}

export interface HistoryTimelineEntry {
  timestamp: number;
  entry_type: 'package' | 'option';
  subject: string;
  action: 'added' | 'removed' | 'set' | 'reverted';
  file: string;
  type: string | null;
  user_name: string | null;
  old_value: string | null;
  new_value: string | null;
}

export interface HistoryGetResult {
  success: boolean;
  entries?: HistoryTimelineEntry[];
  error?: string;
}

export interface BuildCompletePayload {
  success: boolean;
}

export interface TerminalShowPayload {
  isTry?: boolean;
  title: string;
}

export type FlakeUpdateStatus = Record<string, boolean>;

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<boolean>;
  close: () => Promise<void>;
  getVersion: () => Promise<string>;
  setTheme: (theme: string) => Promise<{ success: boolean; error?: string }>;
  getSystemInfo: () => Promise<any>;
  getDetailedSystemInfo: () => Promise<any>;
  getNotifications: () => Promise<any>;
  nixosRebuild: (options: any) => Promise<any>;
  cancelRebuild: () => Promise<any>;
  switchSpecialization: (name: any) => Promise<any>;
  updateFlakeInputs: () => Promise<any>;
  updateFlakeInput: (name: any) => Promise<any>;
  checkFlakeInputUpdates: () => Promise<any>;
  getSpecializations: () => Promise<any>;
  getFlakeInputs: () => Promise<any>;
  getFlakeInfo: () => Promise<any>;
  getPackages: () => Promise<any>;
  getLivePackages: () => Promise<any>;
  getPackageInfo: (name: any) => Promise<any>;
  packagesGetDuplicates: () => Promise<any>;
  getPendingChanges: () => Promise<any>;
  getOptions: () => Promise<any>;
  getLiveOptions: () => Promise<any>;
  getOptionInfo: (optionPath: any) => Promise<any>;
  setOptionValue: (payload: any) => Promise<any>;
  revertOptionFromGit: (payload: any) => Promise<any>;
  optionsListFiles: () => Promise<any>;
  searchOptionsCatalog: (query: any, opts?: any) => Promise<any>;
  getGenerations: () => Promise<any>;
  getGenerationInfo: (num: any) => Promise<any>;
  getGenerationDiff: (from: any, to: any) => Promise<any>;
  switchGeneration: (num: any) => Promise<any>;
  bootGeneration: (num: any) => Promise<any>;
  deleteGeneration: (num: any) => Promise<any>;
  getGitInfo: () => Promise<any>;
  getCommitDetails: (hash: any) => Promise<any>;
  gitSwitchBranch: (branch: any) => Promise<any>;
  gitPull: () => Promise<any>;
  gitFetch: () => Promise<any>;
  discoverInit: () => Promise<any>;
  discoverGetCategories: () => Promise<any>;
  discoverSearch: (query: any, options: any) => Promise<any>;
  discoverByCategory: (category: any, limit: any) => Promise<any>;
  discoverFeatured: (limit: any) => Promise<any>;
  discoverGetIcon: (iconName: any) => Promise<any>;
  discoverGetDetails: (pkgname: any) => Promise<any>;
  discoverRefresh: () => Promise<any>;
  discoverSearchNixpkgs: (query: any) => Promise<any>;
  discoverTryPackage: (pkgname: any) => Promise<any>;
  discoverIsTrying: () => Promise<any>;
  discoverKillTry: () => Promise<any>;
  discoverFindPackage: (pkgname: any) => Promise<any>;
  discoverGetConfigFiles: () => Promise<any>;
  discoverCheckNixpkgsPackage: (pkgname: any) => Promise<any>;
  discoverAddPackage: (options: any) => Promise<any>;
  discoverGetConfigured: () => Promise<any>;
  discoverRemovePackage: (options: any) => Promise<any>;
  historyGet: () => Promise<any>;
  historyAdd: (entry: any) => Promise<any>;
  historyAddOption: (entry: any) => Promise<any>;
  onBuildOutput: (callback: (data: string) => void) => () => void;
  onBuildComplete: (callback: (data: BuildCompletePayload) => void) => () => void;
  onTerminalShow: (callback: (data: TerminalShowPayload) => void) => () => void;
  onTryProcessEnded: (callback: () => void) => () => void;
  onShowUpdates: (callback: () => void) => () => void;
  onFlakeUpdateCheckComplete: (callback: (status: FlakeUpdateStatus) => void) => () => void;
}
