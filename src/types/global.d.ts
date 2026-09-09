import type {
  ElectronAPI,
} from './ipc';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
