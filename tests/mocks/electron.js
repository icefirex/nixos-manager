const _handlers = new Map();

const ipcMain = {
  handle: (channel, fn) => {
    _handlers.set(channel, fn);
  },
  on: () => {},
  __getHandler: (channel) => _handlers.get(channel),
  __resetHandlers: () => _handlers.clear(),
};

module.exports = {
  ipcMain,
  BrowserWindow: class {},
  app: {
    getPath: () => '/tmp',
    getName: () => 'test',
    setName: () => {},
    on: () => {},
  },
  shell: {
    openPath: () => Promise.resolve(''),
    openExternal: () => Promise.resolve(),
  },
  dialog: {
    showOpenDialog: () => Promise.resolve({ canceled: true }),
  },
  contextBridge: {
    exposeInMainWorld: () => {},
  },
};
