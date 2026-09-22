describe('history handler', () => {
  it('exports register function', () => {
    const mod = require('./history');
    expect(mod.register).toBeInstanceOf(Function);
  });

  it('registers all expected IPC channels via register(deps)', () => {
    const { ipcMain } = require('../../../tests/mocks/electron');
    ipcMain.__resetHandlers();
    const mod = require('./history');

    mod.register({ ipcMain });

    for (const channel of ['history-get', 'history-add', 'history-add-option']) {
      expect(typeof ipcMain.__getHandler(channel)).toBe('function');
    }
  });

  it('register(deps) forwards injected deps so channels use the factory', async () => {
    const { ipcMain } = require('../../../tests/mocks/electron');
    ipcMain.__resetHandlers();
    const mod = require('./history');

    const rows = [{ timestamp: 1, subject: 'git', action: 'added' }];
    const fakeDb = { prepare: () => ({ all: () => rows }) };
    mod.register({ ipcMain, getDb: () => fakeDb });

    const handler = ipcMain.__getHandler('history-get');
    const result = await handler();
    expect(result).toEqual({ success: true, entries: rows });
  });

  it('migrates option_history schema to include reverted action', () => {
    const mod = require('./history');
    const execSpy = vi.fn();
    const db = {
      prepare: vi.fn(() => ({
        get: () => ({
          sql: "CREATE TABLE option_history (action TEXT CHECK(action IN ('set', 'added', 'removed')))"
        })
      })),
      exec: execSpy
    };

    mod.ensureOptionHistorySchema(db);

    expect(execSpy).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS option_history_v2'));
    expect(execSpy).toHaveBeenCalledWith('ALTER TABLE option_history_v2 RENAME TO option_history');
  });

  it('does not migrate when reverted is already present', () => {
    const mod = require('./history');
    const execSpy = vi.fn();
    const db = {
      prepare: vi.fn(() => ({
        get: () => ({
          sql: "CREATE TABLE option_history (action TEXT CHECK(action IN ('set', 'added', 'removed', 'reverted')))"
        })
      })),
      exec: execSpy
    };

    mod.ensureOptionHistorySchema(db);

    expect(execSpy).not.toHaveBeenCalled();
  });

  it('supports DI-lite createHistoryHandlers for history-add', async () => {
    const mod = require('./history');
    const runSpy = vi.fn();
    const fakeDb = {
      prepare: vi.fn(() => ({ run: runSpy }))
    };
    const handlers = mod.createHistoryHandlers({
      getDb: () => fakeDb,
      now: () => 1234567890
    });

    const result = await handlers.historyAdd({
      pkgname: 'hello',
      action: 'added',
      file: 'configuration.nix',
      type: 'systemPackages',
      userName: 'ice'
    });

    expect(result).toEqual({ success: true });
    expect(fakeDb.prepare).toHaveBeenCalledWith(
      'INSERT INTO history (timestamp, pkgname, action, file, type, user_name) VALUES (?, ?, ?, ?, ?, ?)'
    );
    expect(runSpy).toHaveBeenCalledWith(1234567890, 'hello', 'added', 'configuration.nix', 'systemPackages', 'ice');
  });

  it('supports DI-lite createHistoryHandlers for history-add-option', async () => {
    const mod = require('./history');
    const addOptionSpy = vi.fn();
    const handlers = mod.createHistoryHandlers({ addOptionHistoryEntry: addOptionSpy });

    const entry = {
      optionPath: 'services.demo.enable',
      action: 'set',
      oldValue: 'false',
      newValue: 'true',
      file: 'configuration.nix'
    };
    const result = await handlers.historyAddOption(entry);

    expect(result).toEqual({ success: true });
    expect(addOptionSpy).toHaveBeenCalledWith(entry);
  });

  it('supports DI-lite createHistoryHandlers for history-get', async () => {
    const mod = require('./history');
    const rows = [{ timestamp: 1, entry_type: 'package', subject: 'git', action: 'added' }];
    const fakeDb = {
      prepare: vi.fn(() => ({ all: () => rows }))
    };
    const handlers = mod.createHistoryHandlers({ getDb: () => fakeDb });

    const result = await handlers.historyGet();

    expect(result).toEqual({ success: true, entries: rows });
    expect(fakeDb.prepare).toHaveBeenCalled();
  });
});

export {};
