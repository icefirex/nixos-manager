describe('generations handler', () => {
  it('exports register, factory, and pure helpers', () => {
    const mod = require('./generations.ts');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.createGenerationsHandlers).toBeInstanceOf(Function);
    expect(mod.parseCurrentGenerationLink).toBeInstanceOf(Function);
    expect(mod.parseGenerationEntries).toBeInstanceOf(Function);
    expect(mod.parseClosureDiff).toBeInstanceOf(Function);
  });

  describe('parseCurrentGenerationLink', () => {
    const {  parseCurrentGenerationLink  } = require('./generations.ts');

    it('extracts generation number from a profile link target', () => {
      expect(parseCurrentGenerationLink('/nix/store/abc-system-42-link')).toBe(42);
    });

    it('returns null for unrecognized targets', () => {
      expect(parseCurrentGenerationLink('bogus')).toBe(null);
      expect(parseCurrentGenerationLink('')).toBe(null);
      expect(parseCurrentGenerationLink(undefined)).toBe(null);
    });
  });

  describe('parseGenerationEntries', () => {
    const {  parseGenerationEntries  } = require('./generations.ts');

    it('maps matching entries with dates and current flag', () => {
      const entries = ['system-3-link', 'system-10-link', 'other-file'];
      const getMtimeIso = vi.fn(() => '2026-01-01T00:00:00.000Z');

      const gens = parseGenerationEntries(entries, 3, '/profiles', getMtimeIso);

      expect(gens).toEqual([
        { number: 3, date: '2026-01-01T00:00:00.000Z', current: true, path: '/profiles/system-3-link' },
        { number: 10, date: '2026-01-01T00:00:00.000Z', current: false, path: '/profiles/system-10-link' }
      ]);
      expect(getMtimeIso).toHaveBeenCalledTimes(2);
    });

    it('falls back to empty date when the callback throws or is absent', () => {
      const gens = parseGenerationEntries(['system-1-link'], 1, '/profiles', () => { throw new Error('boom'); });
      expect(gens[0].date).toBe('');

      const noDate = parseGenerationEntries(['system-1-link'], 1, '/profiles');
      expect(noDate[0].date).toBe('');
    });
  });

  describe('parseClosureDiff', () => {
    const {  parseClosureDiff  } = require('./generations.ts');

    it('categorizes added, removed, and changed packages and strips ANSI', () => {
      const output = '\x1b[32mhello:\x1b[0m ∅ → 2.1.2, +1.2 MiB\nfirefox: 120.0 → 121.0, +5.0 MiB\ngimp: 2.10 → ∅\nrandom note line';

      const diff = parseClosureDiff(output);

      expect(diff.added).toEqual([{ name: 'hello', change: '∅ → 2.1.2, +1.2 MiB' }]);
      expect(diff.changed).toEqual([{ name: 'firefox', change: '120.0 → 121.0, +5.0 MiB' }]);
      expect(diff.removed).toEqual([{ name: 'gimp', change: '2.10 → ∅' }]);
      expect(diff.raw).not.toContain('\x1b');
      expect(diff.raw).toContain('random note line');
    });

    it('handles empty output', () => {
      const diff = parseClosureDiff('');
      expect(diff).toEqual({ added: [], removed: [], changed: [], raw: '' });
    });
  });

  describe('createGenerationsHandlers', () => {
    const {  createGenerationsHandlers  } = require('./generations.ts');

    function makeFs(overrides = {}) {
      return {
        readlinkSync: vi.fn(() => '/nix/store/abc-system-5-link'),
        readdirSync: vi.fn(() => ['system-3-link', 'system-10-link', 'system-5-link', 'user-profiles']),
        lstatSync: vi.fn(() => ({ mtime: { toISOString: () => '2026-01-01T00:00:00.000Z' } })),
        existsSync: vi.fn(() => true),
        readFileSync: vi.fn((p) => {
          if (String(p).endsWith('nixos-version')) return '25.05\n';
          if (String(p).endsWith('configuration-revision')) return 'abc123\n';
          return 'content';
        }),
        realpathSync: vi.fn(() => '/nix/store/xyz-linux-6.6.1/bzImage'),
        ...overrides
      };
    }

    it('getGenerations lists entries newest-first with current flag and dates', async () => {
      const fakeFs = makeFs();
      const handlers = createGenerationsHandlers({ fs: fakeFs, profileDir: '/profiles', profilePath: '/run/current-system' });

      const gens = await handlers.getGenerations();

      expect(gens.map(g => g.number)).toEqual([10, 5, 3]);
      expect(gens.find(g => g.number === 5).current).toBe(true);
      expect(gens.find(g => g.number === 3).current).toBe(false);
      expect(gens[0].date).toBe('2026-01-01T00:00:00.000Z');
      expect(fakeFs.readlinkSync).toHaveBeenCalledWith('/run/current-system');
    });

    it('getGenerations rejects with a readable error when the profile dir is unreadable', async () => {
      const handlers = createGenerationsHandlers({
        fs: makeFs({ readdirSync: vi.fn(() => { throw new Error('EACCES'); }) }),
        profileDir: '/profiles'
      });

      await expect(handlers.getGenerations()).rejects.toThrow('Failed to read generations: EACCES');
    });

    it('getGenerationInfo collects version, kernel, revision, and closure size', async () => {
      const fakeFs = makeFs();
      const exec = vi.fn((cmd, cb) => cb(null, '/nix/store/xyz-system-42-link 1.5 GiB'));
      const handlers = createGenerationsHandlers({ fs: fakeFs, exec, profilePath: '/run/current-system' });

      const info = await handlers.getGenerationInfo(42);

      expect(info.path).toBe('/run/current-system-42-link');
      expect(info.nixosVersion).toBe('25.05');
      expect(info.kernelVersion).toBe('6.6.1');
      expect(info.configurationRevision).toBe('abc123');
      expect(info.closureSize).toBe('1.5');
      expect(exec).toHaveBeenCalledWith('nix path-info -Sh /run/current-system-42-link 2>/dev/null', expect.any(Function));
    });

    it('getGenerationInfo throws for missing generations', async () => {
      const handlers = createGenerationsHandlers({
        fs: makeFs({ existsSync: vi.fn(() => false) }),
        profilePath: '/run/current-system'
      });

      await expect(handlers.getGenerationInfo(9)).rejects.toThrow('Generation 9 not found');
    });

    it('getGenerationDiff reports unavailable on exec error and parses on success', async () => {
      const failExec = vi.fn((cmd, cb) => cb(new Error('boom'), '', ''));
      const handlersFail = createGenerationsHandlers({ fs: makeFs(), exec: failExec });
      expect(await handlersFail.getGenerationDiff(1, 2)).toEqual({ available: false, error: 'Diff not available' });

      const okExec = vi.fn((cmd, cb) => cb(null, 'hello: ∅ → 2.1.2\n', ''));
      const handlersOk = createGenerationsHandlers({ fs: makeFs(), exec: okExec });
      const diff = await handlersOk.getGenerationDiff(1, 2);
      expect(diff.available).toBe(true);
      expect(diff.added).toEqual([{ name: 'hello', change: '∅ → 2.1.2' }]);
    });

    it('switchGeneration and deleteGeneration resolve via injected exec', async () => {
      const exec = vi.fn((cmd, optsOrCb, maybeCb) => {
        const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        cb(null, '', '');
      });
      const handlers = createGenerationsHandlers({ fs: makeFs(), exec, profilePath: '/run/current-system' });

      await expect(handlers.switchGeneration(42)).resolves.toBe('Switched to generation 42');
      await expect(handlers.bootGeneration(42)).resolves.toBe('Generation 42 will be active on next boot');
      await expect(handlers.deleteGeneration(42)).resolves.toBe('Generation 42 deleted');
    });

    it('switchGeneration rejects with stderr on exec error', async () => {
      const exec = vi.fn((cmd, opts, cb) => cb(new Error('pkexec failed'), '', 'denied'));
      const handlers = createGenerationsHandlers({ fs: makeFs(), exec, profilePath: '/run/current-system' });

      await expect(handlers.switchGeneration(42)).rejects.toThrow('denied');
    });
  });

  describe('register(deps) wiring', () => {
    it('registers all expected IPC channels and forwards deps', async () => {
      const {  ipcMain  } = require('../../../tests/mocks/electron');
      ipcMain.__resetHandlers();
      const mod = require('./generations.ts');

      mod.register({
        ipcMain,
        fs: { existsSync: () => false },
        profilePath: '/run/current-system'
      });

      for (const channel of [
        'get-generations',
        'get-generation-info',
        'get-generation-diff',
        'switch-generation',
        'boot-generation',
        'delete-generation'
      ]) {
        expect(typeof ipcMain.__getHandler(channel)).toBe('function');
      }

      await expect(ipcMain.__getHandler('get-generation-info')(null, 9)).rejects.toThrow('Generation 9 not found');
    });
  });
});

export {};
