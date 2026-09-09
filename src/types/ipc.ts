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
