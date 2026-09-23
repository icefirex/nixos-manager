describe('flake handler', () => {
  it('exports register and getInputUpdateStatus', () => {
    const mod = require('./flake.ts');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.getInputUpdateStatus).toBeInstanceOf(Function);
  });

  it('getInputUpdateStatus returns an object', () => {
    const {  getInputUpdateStatus  } = require('./flake.ts');
    expect(getInputUpdateStatus()).toEqual({});
  });

  it('relativeTime formats recent and old timestamps', () => {
    const {  relativeTime  } = require('./flake.ts');
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(relativeTime(now - 10 * 60 * 1000)).toBe('just now');
    expect(relativeTime(now - 3 * 60 * 60 * 1000)).toBe('3h ago');
    expect(relativeTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');

    nowSpy.mockRestore();
  });

  describe('parseFlakeInputs', () => {
    const {  parseFlakeInputs  } = require('./flake.ts');

    function makeLock(lastModifiedNixpkgs: number, lastModifiedHm: number) {
      return {
        nodes: {
          root: { inputs: { nixpkgs: 'nixpkgs_1', homeManager: 'hm_1', broken: 'missing_1' } },
          nixpkgs_1: {
            locked: { type: 'github', rev: 'a'.repeat(40), lastModified: lastModifiedNixpkgs }
          },
          hm_1: {
            locked: { type: 'github', rev: 'b'.repeat(40), lastModified: lastModifiedHm }
          },
          missing_1: {}
        }
      };
    }

    it('builds input list with age, freshness, and update flags', () => {
      const now = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
      const nowSec = Math.floor(now / 1000);

      const inputs = parseFlakeInputs(makeLock(nowSec, nowSec - 30 * 86400), { nixpkgs: true });

      expect(inputs).toContainEqual({
        name: 'nixpkgs',
        status: 'fresh',
        age: 'today',
        hasUpdate: true
      });
      expect(inputs).toContainEqual({
        name: 'homeManager',
        status: 'stale',
        age: '30 days',
        hasUpdate: false
      });
      expect(inputs).toHaveLength(2);

      nowSpy.mockRestore();
    });

    it('handles empty and malformed locks', () => {
      expect(parseFlakeInputs({}, {})).toEqual([]);
      expect(parseFlakeInputs(null, {})).toEqual([]);
      expect(parseFlakeInputs({ nodes: {} }, {})).toEqual([]);
    });
  });

  describe('parseFlakeLockInfo', () => {
    const {  parseFlakeLockInfo  } = require('./flake.ts');

    it('extracts input counts and nixpkgs pin details', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const lock = {
        nodes: {
          root: { inputs: { nixpkgs: 'nixpkgs_1', homeManager: 'hm_1' } },
          nixpkgs_1: {
            locked: { rev: 'abcdef1234567890abcdef1234567890abcdef12', lastModified: nowSec },
            original: { ref: 'nixos-25.05' }
          },
          hm_1: { locked: { rev: 'b'.repeat(40) } }
        }
      };

      const info = parseFlakeLockInfo(lock);

      expect(info.inputCount).toBe(2);
      expect(info.inputNames).toEqual(['nixpkgs', 'homeManager']);
      expect(info.nixpkgsBranch).toBe('nixos-25.05');
      expect(info.nixpkgsRev).toBe('abcdef123456');
      expect(info.nixpkgsDate).toBeTruthy();
      expect(info.nixpkgsRelative).toBeTruthy();
    });

    it('skips nixpkgs details for follows-style references', () => {
      const lock = {
        nodes: {
          root: { inputs: { nixpkgs: ['flake'], homeManager: 'hm_1' } },
          hm_1: { locked: { rev: 'c'.repeat(40) } }
        }
      };

      const info = parseFlakeLockInfo(lock);

      expect(info.inputCount).toBe(2);
      expect(info.nixpkgsBranch).toBeUndefined();
      expect(info.nixpkgsRev).toBeUndefined();
    });

  it('handles malformed locks', () => {
    expect(parseFlakeLockInfo(null)).toEqual({ inputCount: 0, inputNames: [] });
  });

  describe('createFlakeHandlers', () => {
    const { EventEmitter } = require('events');
    const { createFlakeHandlers, resetInputUpdateStatus, getInputUpdateStatus } = require('./flake.ts');

    function makeFs(lockContent?: string) {
      return {
        existsSync: vi.fn((p: string) => lockContent !== undefined && String(p).endsWith('flake.lock')),
        readFileSync: vi.fn(() => lockContent ?? ''),
        lstatSync: vi.fn(() => ({ mtime: { toLocaleString: () => 'NOW' }, mtimeMs: 123456 })),
        readlinkSync: vi.fn(() => '/nix/store/x-system-42-link'),
      } as any;
    }

    function fakeSpawn() {
      const proc: any = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return vi.fn(() => proc);
    }

    it('registers all expected IPC channels via register(deps)', () => {
      const { ipcMain } = require('../../../tests/mocks/electron.ts');
      ipcMain.__resetHandlers();
      const mod = require('./flake.ts');

      mod.register({ ipcMain });

      for (const channel of [
        'update-flake-inputs',
        'update-flake-input',
        'get-flake-inputs',
        'check-flake-input-updates',
        'get-flake-info'
      ]) {
        expect(typeof ipcMain.__getHandler(channel)).toBe('function');
      }
    });

    it('updateFlakeInputs streams output and resets cached statuses', async () => {
      resetInputUpdateStatus();
      getInputUpdateStatus().nixpkgs = true;

      const spawn = fakeSpawn();
      const send = vi.fn();
      const handlers = createFlakeHandlers({
        findFlakeDir: () => '/tmp/flake',
        fs: makeFs('{"old": true}'),
        spawn,
        getMainWindow: () => ({ webContents: { send } }),
      });

      const done = handlers.updateFlakeInputs();
      spawn.mock.results[0].value.emit('close', 0);
      const result = await done;

      expect(result).toBe('Flake inputs updated');
      expect(spawn).toHaveBeenCalledWith('nix', ['flake', 'update'], expect.objectContaining({ cwd: '/tmp/flake' }));
      expect(getInputUpdateStatus().nixpkgs).toBeUndefined();
      expect(send).toHaveBeenCalledWith('build-complete', { success: true });
    });

    it('updateFlakeInput clears the cached status for that input', async () => {
      resetInputUpdateStatus();
      getInputUpdateStatus().homeManager = true;

      const spawn = fakeSpawn();
      const handlers = createFlakeHandlers({
        findFlakeDir: () => '/tmp/flake',
        fs: makeFs('{"before": true}'),
        spawn,
        getMainWindow: () => ({ webContents: { send: vi.fn() } }),
      });

      const done = handlers.updateFlakeInput('homeManager');
      spawn.mock.results[0].value.emit('close', 0);
      const result = await done;

      expect(result).toBe('Flake input "homeManager" updated');
      expect(getInputUpdateStatus().homeManager).toBe(false);
    });

    it('rejects when the spawn fails and reports build-complete false', async () => {
      const spawn = fakeSpawn();
      const send = vi.fn();
      const handlers = createFlakeHandlers({
        findFlakeDir: () => '/tmp/flake',
        fs: makeFs(),
        spawn,
        getMainWindow: () => ({ webContents: { send } }),
      });

      const done = handlers.updateFlakeInputs();
      spawn.mock.results[0].value.emit('close', 1);
      await expect(done).rejects.toThrow('Update failed with code 1');
      expect(send).toHaveBeenCalledWith('build-complete', { success: false });
    });

    it('getFlakeInputs returns [] without a flake dir and parses locks otherwise', async () => {
      const none = createFlakeHandlers({ findFlakeDir: () => null });
      expect(await none.getFlakeInputs()).toEqual([]);

      const nowSec = Math.floor(Date.now() / 1000);
      const lock = JSON.stringify({
        nodes: {
          root: { inputs: { nixpkgs: 'np' } },
          np: { locked: { rev: 'a', lastModified: nowSec } }
        }
      });
      const handlers = createFlakeHandlers({ findFlakeDir: () => '/tmp/flake', fs: makeFs(lock) });
      const inputs = await handlers.getFlakeInputs();
      expect(inputs).toEqual([{ name: 'nixpkgs', status: 'fresh', age: 'today', hasUpdate: false }]);
    });

    it('checkFlakeInputUpdates broadcasts the cached status', async () => {
      resetInputUpdateStatus();
      getInputUpdateStatus().nixpkgs = true;
      const send = vi.fn();
      const runUpdateChecks = vi.fn(async () => {});

      const handlers = createFlakeHandlers({
        findFlakeDir: () => '/tmp/flake',
        runUpdateChecks,
        getMainWindow: () => ({ webContents: { send } }),
      });

      const result = await handlers.checkFlakeInputUpdates();
      expect(runUpdateChecks).toHaveBeenCalledWith('/tmp/flake');
      expect(result).toEqual({ nixpkgs: true });
      expect(send).toHaveBeenCalledWith('flake-update-check-complete', { nixpkgs: true });
    });

    it('getFlakeInfo assembles description, lock, git, and version info', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const lock = JSON.stringify({
        nodes: {
          root: { inputs: { nixpkgs: 'np' } },
          np: { locked: { rev: 'a'.repeat(40), lastModified: nowSec }, original: { ref: 'nixos-unstable' } }
        }
      });

      const fsDep: any = {
        existsSync: vi.fn((p: string) => !String(p).includes('os-release')),
        readFileSync: vi.fn((p: string) => {
          if (String(p).endsWith('flake.nix')) return 'description = "My config";';
          if (String(p).endsWith('flake.lock')) return lock;
          if (String(p).endsWith('os-release')) return 'VERSION_ID="25.05"';
          return '';
        }),
        lstatSync: vi.fn(() => ({ mtime: { toLocaleString: () => 'NOW' }, mtimeMs: 123 })),
        readlinkSync: vi.fn(() => '/nix/store/x-system-7-link'),
      };
      const runCmd = vi.fn(async (cmd: string) => {
        if (cmd.includes('branch --show-current')) return 'main';
        if (cmd.includes('rev-parse')) return 'abc1234';
        if (cmd.includes('log -1')) return 'feat: x|2 days ago';
        if (cmd.includes('status --porcelain')) return ' M a.nix\n M b.nix';
        if (cmd.includes('nix --version')) return 'nix (Nix) 2.28.3';
        return '';
      });

      const handlers = createFlakeHandlers({ findFlakeDir: () => '/tmp/flake', fs: fsDep, runCmd });
      const info = await handlers.getFlakeInfo();

      expect(info.flakeDir).toBe('/tmp/flake');
      expect(info.description).toBe('My config');
      expect(info.inputCount).toBe(1);
      expect(info.nixpkgsBranch).toBe('nixos-unstable');
      expect(info.nixpkgsRev).toBe('a'.repeat(12));
      expect(info.gitBranch).toBe('main');
      expect(info.gitRev).toBe('abc1234');
      expect(info.gitLastMsg).toBe('feat: x');
      expect(info.gitDirty).toBe(2);
      expect(info.generation).toBe(7);
      expect(info.nixosVersion).toBe('25.05');
      expect(info.nixVersion).toBe('2.28.3');
    });

    it('getFlakeInfo returns null flakeDir when missing', async () => {
      const handlers = createFlakeHandlers({ findFlakeDir: () => null });
      expect(await handlers.getFlakeInfo()).toEqual({ flakeDir: null });
    });
  });
});
});

export {};
