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
  title: string;
}

export type FlakeUpdateStatus = Record<string, boolean>;

export interface ElectronAPI {
  minimize: () => Promise<void>;
  maximize: () => Promise<boolean>;
  close: () => Promise<void>;
  getVersion: () => Promise<string>;
  setTheme: (theme: string) => Promise<{ success: boolean; error?: string }>;

  nixosRebuild: (options: NixosRebuildRequest) => Promise<unknown>;
  cancelRebuild: () => Promise<boolean>;

  getPendingChanges: () => Promise<PendingChangesResult>;

  setOptionValue: (payload: OptionSetPayload) => Promise<OptionMutationResult>;
  revertOptionFromGit: (payload: OptionRevertPayload) => Promise<OptionMutationResult>;
  optionsListFiles: () => Promise<OptionFileListResult>;
  searchOptionsCatalog: (query: string, opts?: { channel?: string; limit?: number }) => Promise<OptionCatalogSearchResult>;

  historyGet: () => Promise<HistoryGetResult>;
  historyAdd: (entry: HistoryEntry) => Promise<{ success: boolean; error?: string }>;
  historyAddOption: (entry: OptionHistoryEntry) => Promise<{ success: boolean; error?: string }>;

  discoverGetConfigured: () => Promise<{ success: boolean; packages?: string[]; error?: string }>;

  onBuildOutput: (callback: (data: string) => void) => () => void;
  onBuildComplete: (callback: (data: BuildCompletePayload) => void) => () => void;
  onTerminalShow: (callback: (data: TerminalShowPayload) => void) => () => void;
  onTryProcessEnded: (callback: () => void) => () => void;
  onShowUpdates: (callback: () => void) => () => void;
  onFlakeUpdateCheckComplete: (callback: (status: FlakeUpdateStatus) => void) => () => void;

  [key: string]: unknown;
}
