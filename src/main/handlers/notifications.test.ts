describe('notifications handler', () => {
  const nowSec = Math.floor(Date.now() / 1000);

  it('exports register, factory, and pure builders', () => {
    const mod = require('./notifications.ts');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.createNotificationsHandlers).toBeInstanceOf(Function);
    expect(mod.buildGitSyncNotifications).toBeInstanceOf(Function);
    expect(mod.collectStaleInputs).toBeInstanceOf(Function);
    expect(mod.buildStaleInputsNotification).toBeInstanceOf(Function);
    expect(mod.buildDiskNotification).toBeInstanceOf(Function);
    expect(mod.buildFlakeUpdatesNotification).toBeInstanceOf(Function);
  });

  describe('buildGitSyncNotifications', () => {
    const {  buildGitSyncNotifications  } = require('./notifications.ts');

    it('emits behind, ahead, and dirty notifications as needed', () => {
      const all = buildGitSyncNotifications('2', '3', 'a\nb\n');
      expect(all.map(n => n.id)).toEqual(['git-behind', 'git-ahead', 'git-dirty']);
      expect(all[0].type).toBe('warning');
      expect(all[1].action).toBe('git push');
      expect(all[2].message).toContain('2 file(s)');
    });

    it('emits nothing when synced and clean', () => {
      expect(buildGitSyncNotifications('0', '0', '')).toEqual([]);
      expect(buildGitSyncNotifications('0\n', '0\n', null)).toEqual([]);
    });
  });

  describe('collectStaleInputs', () => {
    const {  collectStaleInputs  } = require('./notifications.ts');

    it('collects only inputs older than the stale threshold, newest first', () => {
      const lock = {
        nodes: {
          root: { inputs: { fresh: 'fresh_1', old: 'old_1', older: 'older_1' } },
          fresh_1: { locked: { lastModified: nowSec } },
          old_1: { locked: { lastModified: nowSec - 15 * 86400 } },
          older_1: { locked: { lastModified: nowSec - 40 * 86400 } }
        }
      };

      const stale = collectStaleInputs(lock);

      expect(stale.map(i => i.name)).toEqual(['older', 'old']);
      expect(stale[0].days).toBeGreaterThanOrEqual(40);
    });

    it('handles malformed locks', () => {
      expect(collectStaleInputs(null)).toEqual([]);
      expect(collectStaleInputs({})).toEqual([]);
    });
  });

  describe('buildStaleInputsNotification', () => {
    const {  buildStaleInputsNotification  } = require('./notifications.ts');

    it('returns null when nothing is stale', () => {
      expect(buildStaleInputsNotification([])).toBe(null);
      expect(buildStaleInputsNotification(null)).toBe(null);
    });

    it('lists up to 3 names, truncates beyond with a count', () => {
      const three = buildStaleInputsNotification([
        { name: 'a', days: 30 }, { name: 'b', days: 20 }, { name: 'c', days: 15 }
      ]);
      expect(three.message).toContain('a (30d), b (20d), c (15d)');

      const five = buildStaleInputsNotification([
        { name: 'a', days: 50 }, { name: 'b', days: 40 }, { name: 'c', days: 30 }, { name: 'd', days: 20 }, { name: 'e', days: 10 }
      ]);
      expect(five.message).toContain('a (50d), b (40d) +3 more');
      expect(five.message).toContain('5 input(s) older than 14 days');
    });
  });

  describe('buildDiskNotification', () => {
    const {  buildDiskNotification  } = require('./notifications.ts');

    it('classifies critical, warning, and healthy usage', () => {
      expect(buildDiskNotification(95).id).toBe('disk-critical');
      expect(buildDiskNotification(95).type).toBe('error');
      expect(buildDiskNotification(85).id).toBe('disk-warning');
      expect(buildDiskNotification(50)).toBe(null);
    });
  });

  describe('buildFlakeUpdatesNotification', () => {
    const {  buildFlakeUpdatesNotification  } = require('./notifications.ts');

    it('returns null when no updates', () => {
      expect(buildFlakeUpdatesNotification({})).toBe(null);
      expect(buildFlakeUpdatesNotification({ nixpkgs: false })).toBe(null);
      expect(buildFlakeUpdatesNotification(undefined)).toBe(null);
    });

    it('formats singular and plural update notifications', () => {
      const single = buildFlakeUpdatesNotification({ nixpkgs: true, hm: false });
      expect(single.title).toBe('Flake update available');
      expect(single.message).toBe('nixpkgs has a newer version available');
      expect(single.action).toBe('nix flake update nixpkgs');

      const many = buildFlakeUpdatesNotification({
        a: true, b: true, c: true, d: true, e: true
      });
      expect(many.title).toBe('5 flake updates available');
      expect(many.message).toBe('a, b, c +2 more');
      expect(many.action).toBe('nix flake update');
    });
  });

  describe('createNotificationsHandlers', () => {
    it('assembles notifications from injected dependencies', async () => {
      const {  createNotificationsHandlers  } = require('./notifications.ts');

      const runCmd = vi.fn(async (cmd) => {
        if (cmd.includes('fetch --quiet')) return '';
        if (cmd.includes('HEAD..@{u}')) return '0';
        if (cmd.includes('@{u}..HEAD')) return '2';
        if (cmd.includes('status --porcelain')) return 'a\nb\n';
        if (cmd.startsWith('df -h')) return '/dev/root 1 2 3 85% 4 5';
        return '';
      });

      const lockContent = {
        nodes: {
          root: { inputs: { nixpkgs: 'np_1', hm: 'hm_1' } },
          np_1: { locked: { lastModified: nowSec - 21 * 86400 } },
          hm_1: { locked: { lastModified: nowSec } }
        }
      };

      const fakeFs = {
        existsSync: vi.fn(() => true),
        promises: { readFile: vi.fn(async () => JSON.stringify(lockContent)) },
        readdirSync: vi.fn(() => Array.from({ length: 21 }, (_, i) => `system-${i + 1}-link`))
      };

      const handlers = createNotificationsHandlers({
        findFlakeDir: () => '/tmp/flake',
        runCmd,
        fs: fakeFs,
        getInputUpdateStatus: () => ({ nixpkgs: true, hm: false }),
        getLastBuildStatus: () => ({ success: false, message: 'build boom', time: 123 })
      });

      const notifications = await handlers.getNotifications();
      const ids = notifications.map(n => n.id);

      expect(ids).toEqual([
        'git-ahead',
        'git-dirty',
        'flake-stale',
        'disk-warning',
        'generations-many',
        'flake-updates-available',
        'last-build'
      ]);
      expect(notifications.find(n => n.id === 'last-build')).toMatchObject({
        type: 'error',
        message: 'build boom',
        time: 123
      });
    });

    it('returns only the last-build entry when there is no flake dir and system is healthy', async () => {
      const {  createNotificationsHandlers  } = require('./notifications.ts');

      const handlers = createNotificationsHandlers({
        findFlakeDir: () => null,
        runCmd: vi.fn(async () => '/dev/root 1 2 3 50% 4 5'),
        fs: { readdirSync: () => [] },
        getInputUpdateStatus: () => ({}),
        getLastBuildStatus: () => ({ success: true, message: 'ok', time: 5 })
      });

      const notifications = await handlers.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ id: 'last-build', type: 'success' });
    });
  });

  describe('register(deps) wiring', () => {
    it('registers the get-notifications channel and forwards deps', async () => {
      const {  ipcMain  } = require('../../../tests/mocks/electron.ts');
      ipcMain.__resetHandlers();
      const mod = require('./notifications.ts');

      mod.register({
        ipcMain,
        findFlakeDir: () => null,
        runCmd: vi.fn(async () => '/dev/root 1 2 3 85% 4 5'),
        fs: { readdirSync: () => [] },
        getInputUpdateStatus: () => ({}),
        getLastBuildStatus: () => null
      });

      expect(typeof ipcMain.__getHandler('get-notifications')).toBe('function');
      const result = await ipcMain.__getHandler('get-notifications')();
      expect(result.map(n => n.id)).toEqual(['disk-warning']);
    });
  });
});

export {};
