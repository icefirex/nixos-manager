describe('history handler', () => {
  it('exports register function', () => {
    const mod = require('./history');
    expect(mod.register).toBeInstanceOf(Function);
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
});
