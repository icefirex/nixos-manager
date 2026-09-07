module.exports = {
  ipcMain: {
    handle: (...args) => {},
    on: (...args) => {},
  },
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
