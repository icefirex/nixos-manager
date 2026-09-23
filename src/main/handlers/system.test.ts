describe('system handler', () => {
  it('exports register, factory, and pure helpers', () => {
    const mod = require('./system');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.createSystemHandlers).toBeInstanceOf(Function);
    expect(mod.parseOsRelease).toBeInstanceOf(Function);
    expect(mod.formatUptime).toBeInstanceOf(Function);
    expect(mod.buildMemoryInfo).toBeInstanceOf(Function);
    expect(mod.formatLastBuildTime).toBeInstanceOf(Function);
    expect(mod.resolveSpecialization).toBeInstanceOf(Function);
  });

  describe('parseOsRelease', () => {
    const { parseOsRelease } = require('./system');

    it('extracts version and pretty name', () => {
      const content = 'NAME="NixOS"\nVERSION_ID="25.05"\nPRETTY_NAME="NixOS 25.05 (Warbler)"\n';
      expect(parseOsRelease(content)).toEqual({
        version: '25.05',
        name: 'NixOS 25.05 (Warbler)'
      });
    });

    it('handles missing fields and empty content', () => {
      expect(parseOsRelease('NAME="NixOS"\n')).toEqual({ version: null, name: null });
      expect(parseOsRelease('')).toEqual({ version: null, name: null });
      expect(parseOsRelease(null)).toEqual({ version: null, name: null });
    });
  });

  describe('formatUptime', () => {
    const { formatUptime } = require('./system');

    it('formats with and without days', () => {
      expect(formatUptime(90061)).toBe('1d 1h 1m');
      expect(formatUptime(3660)).toBe('1h 1m');
      expect(formatUptime(59)).toBe('0h 0m');
    });
  });

  describe('buildMemoryInfo', () => {
    const { buildMemoryInfo } = require('./system');
    const GIB = 1073741824;

    it('computes used/free/percentage', () => {
      expect(buildMemoryInfo(8 * GIB, 4 * GIB)).toEqual({
        total: '8.0 GB',
        used: '4.0 GB',
        free: '4.0 GB',
        percentage: 50
      });
    });
  });

  describe('formatLastBuildTime', () => {
    const { formatLastBuildTime } = require('./system');
    const HOUR = 3600000;

    it('formats relative switch times', () => {
      const now = Date.now();
      expect(formatLastBuildTime(now - 30 * 60000, now)).toBe('just now');
      expect(formatLastBuildTime(now - 5 * HOUR, now)).toBe('5h ago');
      expect(formatLastBuildTime(now - 3 * 24 * HOUR, now)).toBe('3d ago');
    });
  });

  describe('resolveSpecialization', () => {
    const { resolveSpecialization } = require('./system');

    it('detects base, active specialization, and unknown', () => {
      expect(resolveSpecialization('/same', '/same', [], () => '/x')).toBe('base');

      const realpath = (p) => `/specs/${p}`;
      expect(resolveSpecialization('/specs/gaming', '/base', ['gaming', 'office'], realpath)).toBe('gaming');
      expect(resolveSpecialization('/other', '/base', ['gaming'], realpath)).toBe('unknown');
      expect(resolveSpecialization('/other', '/base', [], realpath)).toBe('unknown');
    });

    it('treats throwing realpath as unknown', () => {
      expect(resolveSpecialization('/a', '/b', ['x'], () => { throw new Error('boom'); })).toBe('unknown');
    });
  });

  describe('createSystemHandlers', () => {
    const { createSystemHandlers } = require('./system');

    function makeOs(overrides = {}) {
      return {
        hostname: () => 'nixbox',
        userInfo: () => ({ username: 'ice' }),
        release: () => '6.6.1-NixOS',
        platform: () => 'linux',
        arch: () => 'x86_64',
        uptime: () => 90061,
        totalmem: () => 8 * 1073741824,
        freemem: () => 4 * 1073741824,
        cpus: () => [{ model: 'Ryzen', speed: 3600 }],
        ...overrides
      };
    }

    function makeFs(overrides = {}) {
      return {
        readFileSync: vi.fn((p) => {
          if (String(p).endsWith('os-release')) {
            return 'VERSION_ID="25.05"\nPRETTY_NAME="NixOS 25.05 (Warbler)"\n';
          }
          return '';
        }),
        readlinkSync: vi.fn(() => '/nix/store/abc-system-42-link'),
        lstatSync: vi.fn(() => ({ mtimeMs: Date.now() - 2 * 3600000, mtime: new Date() })),
        existsSync: vi.fn(() => true),
        realpathSync: vi.fn((p) => String(p)),
        readdirSync: vi.fn(() => []),
        ...overrides
      };
    }

    it('getSystemInfo assembles header info from injected deps', async () => {
      const handlers = createSystemHandlers({
        os: makeOs(),
        fs: makeFs(),
        profilePath: '/nix/var/nix/profiles/system',
        currentSystem: '/run/current-system'
      });

      const info = await handlers.getSystemInfo();

      expect(info).toEqual({
        profile: 'ice',
        hostname: 'nixbox',
        nixosVersion: '25.05',
        kernelVersion: '6.6.1',
        generation: 42,
        lastBuild: '2h ago',
        healthy: true
      });
    });

    it('getDetailedSystemInfo assembles full info with base specialization', async () => {
      const runCmd = vi.fn(async (cmd) => {
        if (cmd.startsWith('df -h')) return '/dev/root 100G 80G 20G 80% /';
        if (cmd.includes('/nix/store')) return '12345';
        if (cmd.includes('sw/bin')) return '678';
        return '';
      });

      const handlers = createSystemHandlers({
        os: makeOs(),
        fs: makeFs({ realpathSync: vi.fn(() => '/real/base') }),
        runCmd,
        profilePath: '/nix/var/nix/profiles/system',
        currentSystem: '/run/current-system'
      });

      const info = await handlers.getDetailedSystemInfo();

      expect(info.hostname).toBe('nixbox');
      expect(info.nixosVersion).toBe('25.05');
      expect(info.osName).toBe('NixOS 25.05 (Warbler)');
      expect(info.uptime).toBe('1d 1h 1m');
      expect(info.memory.percentage).toBe(50);
      expect(info.cpu).toEqual({ model: 'Ryzen', cores: 1, speed: '3600 MHz' });
      expect(info.generation).toBe(42);
      expect(info.disk).toEqual({ total: '100G', used: '80G', available: '20G', percentage: 80 });
      expect(info.nixStorePaths).toBe('12345');
      expect(info.packageCount).toBe('678');
      expect(info.specialization).toBe('base');
    });

    it('getDetailedSystemInfo falls back to unknown when data is missing', async () => {
      const handlers = createSystemHandlers({
        os: makeOs({ cpus: () => [] }),
        fs: makeFs({
          readFileSync: vi.fn(() => { throw new Error('missing'); }),
          readlinkSync: vi.fn(() => { throw new Error('missing'); }),
          lstatSync: vi.fn(() => { throw new Error('missing'); }),
          existsSync: vi.fn(() => false),
          realpathSync: vi.fn((p) => `/real/${String(p)}`),
          readdirSync: vi.fn(() => ['gaming'])
        }),
        runCmd: vi.fn(async () => ''),
        profilePath: '/nix/var/nix/profiles/system',
        currentSystem: '/run/current-system'
      });

      const info = await handlers.getDetailedSystemInfo();

      expect(info.nixosVersion).toBe('unknown');
      expect(info.osName).toBe('NixOS');
      expect(info.generation).toBe(1);
      expect(info.buildTime).toBe('unknown');
      expect(info.disk).toEqual({ total: 'unknown', used: 'unknown', available: 'unknown', percentage: 0 });
      expect(info.nixStorePaths).toBe('unknown');
      expect(info.packageCount).toBe('unknown');
      expect(info.cpu.model).toBe('Unknown');
      expect(info.specialization).toBe('unknown');
    });
  });

  describe('register(deps) wiring', () => {
    it('registers both IPC channels and forwards deps', async () => {
      const { ipcMain } = require('../../../tests/mocks/electron');
      ipcMain.__resetHandlers();
      const mod = require('./system');

      mod.register({
        ipcMain,
        os: {
          hostname: () => 'h', userInfo: () => ({ username: 'u' }), release: () => 'r',
          platform: () => 'p', arch: () => 'a', uptime: () => 0,
          totalmem: () => 1, freemem: () => 1, cpus: () => []
        },
        fs: {
          readFileSync: () => { throw new Error('x'); },
          readlinkSync: () => '/x-system-7-link',
          lstatSync: () => ({ mtimeMs: Date.now(), mtime: new Date() }),
          existsSync: () => true
        },
        runCmd: async () => ''
      });

      expect(typeof ipcMain.__getHandler('get-system-info')).toBe('function');
      expect(typeof ipcMain.__getHandler('get-detailed-system-info')).toBe('function');

      const info = await ipcMain.__getHandler('get-system-info')();
      expect(info).toMatchObject({ generation: 7, profile: 'u' });
    });
  });
});

export {};
