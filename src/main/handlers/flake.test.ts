describe('flake handler', () => {
  it('exports register and getInputUpdateStatus', () => {
    const mod = require('./flake');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.getInputUpdateStatus).toBeInstanceOf(Function);
  });

  it('getInputUpdateStatus returns an object', () => {
    const { getInputUpdateStatus } = require('./flake');
    expect(getInputUpdateStatus()).toEqual({});
  });

  it('relativeTime formats recent and old timestamps', () => {
    const { relativeTime } = require('./flake');
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(relativeTime(now - 10 * 60 * 1000)).toBe('just now');
    expect(relativeTime(now - 3 * 60 * 60 * 1000)).toBe('3h ago');
    expect(relativeTime(now - 2 * 24 * 60 * 60 * 1000)).toBe('2 days ago');

    nowSpy.mockRestore();
  });

  describe('parseFlakeInputs', () => {
    const { parseFlakeInputs } = require('./flake');

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
    const { parseFlakeLockInfo } = require('./flake');

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
  });
});

export {};
