import type {
  HistoryEntry,
  NixosRebuildRequest,
  OptionHistoryEntry,
  OptionMutationResult,
  OptionRevertPayload,
  OptionSetPayload,
} from './ipc';

interface ElectronAPI {
  nixosRebuild: (options: NixosRebuildRequest) => Promise<unknown>;
  setOptionValue: (payload: OptionSetPayload) => Promise<OptionMutationResult>;
  revertOptionFromGit: (payload: OptionRevertPayload) => Promise<OptionMutationResult>;
  historyAdd: (entry: HistoryEntry) => Promise<{ success: boolean; error?: string }>;
  historyAddOption: (entry: OptionHistoryEntry) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
