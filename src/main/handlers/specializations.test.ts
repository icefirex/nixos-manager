describe('specializations handler', () => {
  it('exports register, factory, and pure helpers', () => {
    const mod = require('./specializations.ts');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.createSpecializationsHandlers).toBeInstanceOf(Function);
    expect(mod.buildSpecSwitchPath).toBeInstanceOf(Function);
    expect(mod.determineActiveSpec).toBeInstanceOf(Function);
    expect(mod.buildSpecializationList).toBeInstanceOf(Function);
  });

  describe('VALID_SPEC_NAME', () => {
    const {  VALID_SPEC_NAME  } = require('./specializations.ts');

    it('accepts safe names and rejects traversal/odd characters', () => {
      expect(VALID_SPEC_NAME.test('gaming')).toBe(true);
      expect(VALID_SPEC_NAME.test('gaming-desktop_2')).toBe(true);
      expect(VALID_SPEC_NAME.test('../oops')).toBe(false);
      expect(VALID_SPEC_NAME.test('foo bar')).toBe(false);
      expect(VALID_SPEC_NAME.test('')).toBe(false);
    });
  });

  describe('buildSpecSwitchPath', () => {
    const {  buildSpecSwitchPath  } = require('./specializations.ts');

    it('builds base and specialization switch paths', () => {
      expect(buildSpecSwitchPath('base', '/nix/var/nix/profiles/system'))
        .toBe('/nix/var/nix/profiles/system/bin/switch-to-configuration');
      expect(buildSpecSwitchPath('gaming', '/nix/var/nix/profiles/system'))
        .toBe('/nix/var/nix/profiles/system/specialisation/gaming/bin/switch-to-configuration');
    });
  });

  describe('determineActiveSpec', () => {
    const {  determineActiveSpec  } = require('./specializations.ts');

    it('returns base when current matches base path', () => {
      expect(determineActiveSpec('/same', '/same', [], () => '/x')).toBe('base');
    });

    it('matches an entry via injected realpath', () => {
      const realpath = (p) => `/specs/${p}`;
      expect(determineActiveSpec('/specs/office', '/base', ['gaming', 'office'], realpath)).toBe('office');
    });

    it('returns null for unresolved paths, non-matches, and throwing realpath', () => {
      expect(determineActiveSpec(null, '/base', [], () => '/x')).toBe(null);
      expect(determineActiveSpec('/other', '/base', [], () => '/x')).toBe(null);
      expect(determineActiveSpec('/other', '/base', ['a'], () => { throw new Error('boom'); })).toBe(null);
    });

    it('continues past entries whose realpath throws', () => {
      const realpath = (p) => (p === 'broken' ? (() => { throw new Error('boom'); })() : `/specs/${p}`);
      expect(determineActiveSpec('/specs/ok', '/base', ['broken', 'ok'], realpath)).toBe('ok');
    });
  });

  describe('buildSpecializationList', () => {
    const {  buildSpecializationList  } = require('./specializations.ts');

    it('lists base first plus directory entries with active flags', () => {
      const list = buildSpecializationList('gaming', ['gaming', 'notes.txt'], (e) => e !== 'notes.txt');
      expect(list).toEqual([
        { name: 'base', active: false },
        { name: 'gaming', active: true }
      ]);
    });

    it('marks base active when no other spec matches', () => {
      const list = buildSpecializationList('base', ['gaming'], () => true);
      expect(list[0]).toEqual({ name: 'base', active: true });
      expect(list[1]).toEqual({ name: 'gaming', active: false });
    });
  });

  describe('createSpecializationsHandlers', () => {
    const {  createSpecializationsHandlers  } = require('./specializations.ts');

    function makeFs(overrides = {}) {
      return {
        existsSync: vi.fn(() => true),
        realpathSync: vi.fn((p) => `/real/${String(p)}`),
        readdirSync: vi.fn(() => ['gaming', 'notes.txt']),
        statSync: vi.fn((p) => ({ isDirectory: () => !String(p).endsWith('notes.txt') })),
        ...overrides
      };
    }

    it('switchSpecialization rejects invalid names before any fs access', async () => {
      const fakeFs = makeFs();
      const handlers = createSpecializationsHandlers({ fs: fakeFs, profilePath: '/system' });

      await expect(handlers.switchSpecialization('../oops')).rejects.toThrow('Invalid specialization name');
      await expect(handlers.switchSpecialization('')).rejects.toThrow('Invalid specialization name');
      expect(fakeFs.existsSync).not.toHaveBeenCalled();
    });

    it('switchSpecialization rejects when the switch path is missing', async () => {
      const handlers = createSpecializationsHandlers({
        fs: makeFs({ existsSync: vi.fn(() => false) }),
        profilePath: '/system'
      });

      await expect(handlers.switchSpecialization('gaming')).rejects.toThrow("Specialization 'gaming' not found");
    });

    it('switchSpecialization invokes pkexec with array args and resolves', async () => {
      const execFile = vi.fn((cmd, args, cb) => cb(null, '', ''));
      const handlers = createSpecializationsHandlers({
        fs: makeFs(),
        execFile,
        profilePath: '/system'
      });

      await expect(handlers.switchSpecialization('gaming')).resolves.toBe('Switched to specialization: gaming');
      expect(execFile).toHaveBeenCalledWith('pkexec', ['/system/specialisation/gaming/bin/switch-to-configuration', 'switch'], expect.any(Function));
    });

    it('switchSpecialization uses the base switch path for base', async () => {
      const execFile = vi.fn((cmd, args, cb) => cb(null, '', ''));
      const handlers = createSpecializationsHandlers({
        fs: makeFs(),
        execFile,
        profilePath: '/system'
      });

      await expect(handlers.switchSpecialization('base')).resolves.toBe('Switched to specialization: base');
      expect(execFile).toHaveBeenCalledWith('pkexec', ['/system/bin/switch-to-configuration', 'switch'], expect.any(Function));
    });

    it('switchSpecialization rejects with stderr on exec failure', async () => {
      const execFile = vi.fn((cmd, args, cb) => cb(new Error('pkexec failed'), '', 'denied'));
      const handlers = createSpecializationsHandlers({ fs: makeFs(), execFile, profilePath: '/system' });

      await expect(handlers.switchSpecialization('gaming')).rejects.toThrow('denied');
    });

    it('getSpecializations lists base plus directories with active detection', async () => {
      const fakeFs = makeFs({
        realpathSync: vi.fn((p) => {
          const s = String(p);
          if (s === '/run/current-system') return '/current';
          if (s === '/system/specialisation/gaming') return '/current';
          return `/real/${s}`;
        })
      });
      const handlers = createSpecializationsHandlers({
        fs: fakeFs,
        profilePath: '/system',
        currentSystem: '/run/current-system'
      });

      const list = await handlers.getSpecializations();

      expect(list).toEqual([
        { name: 'base', active: false },
        { name: 'gaming', active: true }
      ]);
    });

    it('getSpecializations marks base active when current system equals base', async () => {
      const handlers = createSpecializationsHandlers({
        fs: makeFs({ realpathSync: vi.fn(() => '/real/same') }),
        profilePath: '/system'
      });

      const list = await handlers.getSpecializations();
      expect(list[0]).toEqual({ name: 'base', active: true });
    });

    it('getSpecializations tolerates missing spec dir and unresolved paths', async () => {
      const handlers = createSpecializationsHandlers({
        fs: makeFs({
          realpathSync: vi.fn(() => { throw new Error('missing'); }),
          existsSync: vi.fn(() => false)
        }),
        profilePath: '/system'
      });

      const list = await handlers.getSpecializations();
      expect(list).toEqual([{ name: 'base', active: false }]);
    });
  });

  describe('register(deps) wiring', () => {
    it('registers both IPC channels and forwards deps', async () => {
      const {  ipcMain  } = require('../../../tests/mocks/electron.ts');
      ipcMain.__resetHandlers();
      const mod = require('./specializations.ts');

      mod.register({
        ipcMain,
        fs: { existsSync: () => false },
        profilePath: '/system'
      });

      expect(typeof ipcMain.__getHandler('switch-specialization')).toBe('function');
      expect(typeof ipcMain.__getHandler('get-specializations')).toBe('function');

      await expect(ipcMain.__getHandler('switch-specialization')(null, '../oops'))
        .rejects.toThrow('Invalid specialization name');
    });
  });
});

export {};
