describe('rebuild handler', () => {
  afterEach(() => {
    delete process.env.NIXOS_REBUILD_COMMAND;
    delete process.env.NIXOS_EVAL_COMMAND;
    vi.restoreAllMocks();
  });

  it('exports register function', () => {
    const mod = require('./rebuild.ts');
    expect(mod.register).toBeInstanceOf(Function);
  });

  it('registers all expected IPC channels via register(deps)', () => {
    const {  ipcMain  } = require('../../../tests/mocks/electron');
    ipcMain.__resetHandlers();
    const mod = require('./rebuild.ts');

    mod.register({ ipcMain });

    for (const channel of ['nixos-rebuild', 'cancel-rebuild']) {
      expect(typeof ipcMain.__getHandler(channel)).toBe('function');
    }
  });

  it('register(deps) forwards injected deps so channels use the factory', async () => {
    const {  ipcMain  } = require('../../../tests/mocks/electron');
    ipcMain.__resetHandlers();
    const mod = require('./rebuild.ts');

    mod.register({
      ipcMain,
      findFlakeDir: () => null,
      flakeDirNotFoundMsg: () => 'missing flake'
    });

    const cancelHandler = ipcMain.__getHandler('cancel-rebuild');
    expect(cancelHandler()).toBe(false);

    const rebuildHandler = ipcMain.__getHandler('nixos-rebuild');
    await expect(rebuildHandler({}, { action: 'switch' })).rejects.toThrow('missing flake');
  });

  it('prefers custom rebuild command when env var is set', () => {
    process.env.NIXOS_REBUILD_COMMAND = 'my-rebuild --fast';
    const mod = require('./rebuild.ts');
    expect(mod.resolveRebuildCommand({})).toEqual(['my-rebuild', '--fast']);
  });

  it('falls back to nixos-manager-rebuild when wrapper is unavailable', () => {
    const mod = require('./rebuild.ts');
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
    const mod = require('./rebuild.ts');
    expect(mod.resolveEvalCommand({})).toEqual(['my-eval', '--json']);
  });

  it('supports DI-lite createRebuildHandlers for dry-build success path', async () => {
    const { EventEmitter } = require('events');
    const mod = require('./rebuild.ts');

    const sendSpy = vi.fn();
    const updateBuildStatusSpy = vi.fn();

    const fakeSpawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();

      setTimeout(() => {
        proc.stdout.emit('data', Buffer.from('ok output'));
        proc.emit('close', 0);
      }, 0);

      return proc;
    });

    const handlers = mod.createRebuildHandlers({
      findFlakeDir: () => '/tmp/fake-flake',
      flakeDirNotFoundMsg: () => 'missing flake',
      getMainWindow: () => ({ webContents: { send: sendSpy } }),
      getSpawnEnv: () => ({ PATH: '/tmp/bin' }),
      resolveEvalCommand: () => ['nixos-manager-eval', '--json'],
      resolveRebuildCommand: () => ['nixos-manager-rebuild'],
      updateBuildStatus: updateBuildStatusSpy,
      spawn: fakeSpawn
    });

    const result = await handlers.nixosRebuild({ action: 'dry-build', updateInputs: false });

    expect(fakeSpawn).toHaveBeenCalledWith('nixos-manager-eval', ['--json'], {
      env: { PATH: '/tmp/bin' },
      cwd: '/tmp/fake-flake'
    });
    expect(result).toEqual({ success: true, output: 'ok output' });
    expect(updateBuildStatusSpy).toHaveBeenCalledWith(true, 'Evaluation successful');
    expect(sendSpy).toHaveBeenCalledWith('terminal-show', { title: 'Evaluating Configuration' });
    expect(sendSpy).toHaveBeenCalledWith('build-complete', { success: true });
  });

  it('supports DI-lite cancelRebuild by killing running process', async () => {
    const { EventEmitter } = require('events');
    const mod = require('./rebuild.ts');

    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();

    const fakeSpawn = vi.fn(() => proc);

    const handlers = mod.createRebuildHandlers({
      findFlakeDir: () => '/tmp/fake-flake',
      getMainWindow: () => ({ webContents: { send: vi.fn() } }),
      getSpawnEnv: () => ({ PATH: '/tmp/bin' }),
      resolveRebuildCommand: () => ['nixos-manager-rebuild'],
      updateBuildStatus: vi.fn(),
      spawn: fakeSpawn
    });

    const pending = handlers.nixosRebuild({ action: 'switch', updateInputs: false });
    expect(handlers.cancelRebuild()).toBe(true);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    proc.emit('close', 0);
    await pending;
  });

});

export {};
