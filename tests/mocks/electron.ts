const _handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

export const ipcMain = {
  handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
    _handlers.set(channel, fn);
  },
  on: () => {},
  __getHandler: (channel: string) => _handlers.get(channel),
  __resetHandlers: () => _handlers.clear(),
};

export class BrowserWindow {}

export const app = {
  getPath: () => '/tmp',
  getName: () => 'test',
  setName: () => {},
  on: () => {},
};

export const shell = {
  openPath: () => Promise.resolve(''),
  openExternal: () => Promise.resolve(),
};

export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true }),
};

export const contextBridge = {
  exposeInMainWorld: () => {},
};
