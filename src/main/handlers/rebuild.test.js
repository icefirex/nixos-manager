describe('rebuild handler', () => {
  afterEach(() => {
    delete process.env.NIXOS_REBUILD_COMMAND;
    delete process.env.NIXOS_EVAL_COMMAND;
    vi.restoreAllMocks();
  });

  it('exports register function', () => {
    const mod = require('./rebuild');
    expect(mod.register).toBeInstanceOf(Function);
  });

  it('prefers custom rebuild command when env var is set', () => {
    process.env.NIXOS_REBUILD_COMMAND = 'my-rebuild --fast';
    const mod = require('./rebuild');
    expect(mod.resolveRebuildCommand({})).toEqual(['my-rebuild', '--fast']);
  });

  it('falls back to nixos-manager-rebuild when wrapper is unavailable', () => {
    const mod = require('./rebuild');
    const execSync = require('child_process').execSync;
    const spy = vi.spyOn(require('child_process'), 'execSync').mockImplementation(() => {
      throw new Error('missing');
    });

    expect(mod.commandExists('nixos-rebuild-wrapper', {})).toBe(false);
    expect(mod.resolveRebuildCommand({})).toEqual(['nixos-manager-rebuild']);

    spy.mockRestore();
    void execSync;
  });

  it('prefers custom eval command when env var is set', () => {
    process.env.NIXOS_EVAL_COMMAND = 'my-eval --json';
    const mod = require('./rebuild');
    expect(mod.resolveEvalCommand({})).toEqual(['my-eval', '--json']);
  });

});
