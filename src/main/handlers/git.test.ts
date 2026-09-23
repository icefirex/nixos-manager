describe('git handler', () => {
  it('exports register, factory, and pure parsers', () => {
    const mod = require('./git');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.createGitHandlers).toBeInstanceOf(Function);
    expect(mod.extractRepoName).toBeInstanceOf(Function);
    expect(mod.parseBranchList).toBeInstanceOf(Function);
    expect(mod.parsePorcelainStatus).toBeInstanceOf(Function);
    expect(mod.parseRecentCommits).toBeInstanceOf(Function);
    expect(mod.parseCommitInfo).toBeInstanceOf(Function);
  });

  describe('extractRepoName', () => {
    const { extractRepoName } = require('./git');

    it('handles HTTPS and SSH URLs with optional .git suffix', () => {
      expect(extractRepoName('https://github.com/ice/nixos-config.git')).toBe('ice/nixos-config');
      expect(extractRepoName('git@github.com:ice/nixos-config.git')).toBe('ice/nixos-config');
      expect(extractRepoName('https://gitlab.com/ice/config')).toBe('ice/config');
    });

    it('falls back to raw URL and handles empty input', () => {
      expect(extractRepoName('/local/path/repo')).toBe('path/repo');
      expect(extractRepoName('')).toBe(null);
      expect(extractRepoName(null)).toBe(null);
    });
  });

  describe('parseBranchList', () => {
    const { parseBranchList } = require('./git');

    it('dedupes, strips origin/ prefix, skips origin/HEAD, sorts current first', () => {
      const output = [
        'main|',
        'origin/main|origin/main|',
        'origin/HEAD|origin/main|',
        'dev|',
        'origin/dev|origin/dev|'
      ].join('\n');

      const branches = parseBranchList(output, 'dev');

      expect(branches).toHaveLength(4);
      expect(branches[0]).toMatchObject({ name: 'dev', isRemote: false, isCurrent: true });
      expect(branches[1]).toMatchObject({ name: 'main', isRemote: false, isCurrent: false });
      expect(branches[2]).toMatchObject({ name: 'dev', isRemote: true, isCurrent: false });
      expect(branches[3]).toMatchObject({ name: 'main', isRemote: true, isCurrent: false });
    });

    it('returns empty list for empty output', () => {
      expect(parseBranchList('', 'main')).toEqual([]);
      expect(parseBranchList(null, 'main')).toEqual([]);
    });
  });

  describe('parsePorcelainStatus', () => {
    const { parsePorcelainStatus } = require('./git');

    it('splits staged, modified, and untracked entries', () => {
      const status = parsePorcelainStatus([
        'M  core.nix',
        ' M flake.nix',
        'D  old.nix',
        '?? new.nix'
      ].join('\n'));

      expect(status.staged).toEqual([
        { file: 'core.nix', status: 'M' },
        { file: 'old.nix', status: 'D' }
      ]);
      expect(status.modified).toEqual([
        { file: 'flake.nix', status: 'M' }
      ]);
      expect(status.untracked).toEqual(['new.nix']);
    });

    it('returns empty buckets for empty output', () => {
      expect(parsePorcelainStatus('')).toEqual({ staged: [], modified: [], untracked: [] });
      expect(parsePorcelainStatus(null)).toEqual({ staged: [], modified: [], untracked: [] });
    });
  });

  describe('parseRecentCommits', () => {
    const { parseRecentCommits } = require('./git');

    it('parses pipe-delimited log lines', () => {
      const commits = parseRecentCommits('h1|h1|feat: x|Ice|2 days ago\nh2|h2|fix: y|Nix|3 hours ago');
      expect(commits).toEqual([
        { hash: 'h1', shortHash: 'h1', subject: 'feat: x', author: 'Ice', timeAgo: '2 days ago' },
        { hash: 'h2', shortHash: 'h2', subject: 'fix: y', author: 'Nix', timeAgo: '3 hours ago' }
      ]);
    });

    it('returns empty list for empty output', () => {
      expect(parseRecentCommits('')).toEqual([]);
    });
  });

  describe('parseCommitInfo', () => {
    const { parseCommitInfo } = require('./git');

    it('parses message, author, and file changes', () => {
      const commitInfo = [
        'abc123',
        'feat: add bar',
        'long body here',
        '---AUTHOR---',
        'Ice',
        'ice@example.com',
        '2026-09-20T10:00:00+02:00',
        'M\tflake.nix',
        'A\tnew.nix'
      ].join('\n');

      const details = parseCommitInfo(commitInfo);

      expect(details.fullMessage).toBe('feat: add bar\nlong body here');
      expect(details.author).toBe('Ice');
      expect(details.authorEmail).toBe('ice@example.com');
      expect(details.date).toBe('2026-09-20T10:00:00+02:00');
      expect(details.files).toEqual([
        { status: 'M', file: 'flake.nix' },
        { status: 'A', file: 'new.nix' }
      ]);
    });

    it('returns defaults for missing or separator-less output', () => {
      expect(parseCommitInfo(null)).toEqual({ fullMessage: null, author: null, authorEmail: null, date: null, files: [] });
      expect(parseCommitInfo('no separator here')).toEqual({ fullMessage: null, author: null, authorEmail: null, date: null, files: [] });
    });
  });

  describe('createGitHandlers', () => {
    it('assembles git info from injected runCmd output', async () => {
      const { createGitHandlers } = require('./git');

      const runCmd = vi.fn(async (cmd) => {
        if (cmd.includes('config user.name')) return 'ice\n';
        if (cmd.includes('config user.email')) return 'ice@example.com\n';
        if (cmd.includes('remote get-url')) return 'https://github.com/ice/nixos-config.git\n';
        if (cmd.includes('branch --show-current')) return 'main\n';
        if (cmd.includes('branch -a')) return 'main|\norigin/main|origin/main|\norigin/HEAD|origin/main|\n';
        if (cmd.includes('rev-list')) return '2 1\n';
        if (cmd.includes('status --porcelain')) return 'M  core.nix\n M flake.nix\n?? new.nix\n';
        if (cmd.includes('log --oneline')) return 'h1|h1|feat: x|Ice|2 days ago\n';
        return '';
      });

      const handlers = createGitHandlers({ findFlakeDir: () => '/tmp/flake', runCmd });
      const info = await handlers.getGitInfo();

      expect(info.user).toBe('ice');
      expect(info.email).toBe('ice@example.com');
      expect(info.remoteUrl).toBe('https://github.com/ice/nixos-config.git');
      expect(info.repo).toBe('ice/nixos-config');
      expect(info.branch).toBe('main');
      expect(info.branches[0]).toMatchObject({ name: 'main', isRemote: false, isCurrent: true });
      expect(info.status.ahead).toBe(2);
      expect(info.status.behind).toBe(1);
      expect(info.status.staged).toEqual([{ file: 'core.nix', status: 'M' }]);
      expect(info.status.modified).toEqual([{ file: 'flake.nix', status: 'M' }]);
      expect(info.status.untracked).toEqual(['new.nix']);
      expect(info.recentCommits).toHaveLength(1);
    });

    it('reports failure when switchBranch command fails', async () => {
      const { createGitHandlers } = require('./git');

      const handlers = createGitHandlers({
        findFlakeDir: () => '/tmp/flake',
        runCmd: vi.fn(async () => { throw new Error('checkout failed'); })
      });

      const result = await handlers.switchBranch('main');
      expect(result).toEqual({ success: false, message: 'checkout failed' });
    });

    it('throws injected not-found message when flake dir is missing', async () => {
      const { createGitHandlers } = require('./git');

      const handlers = createGitHandlers({
        findFlakeDir: () => null,
        flakeDirNotFoundMsg: () => 'no flake'
      });

      await expect(handlers.getGitInfo()).rejects.toThrow('no flake');
    });
  });

  describe('register(deps) wiring', () => {
    it('registers all expected IPC channels and forwards deps', async () => {
      const { ipcMain } = require('../../../tests/mocks/electron');
      ipcMain.__resetHandlers();
      const mod = require('./git');

      mod.register({
        ipcMain,
        findFlakeDir: () => null,
        flakeDirNotFoundMsg: () => 'no flake'
      });

      for (const channel of [
        'get-git-info',
        'get-commit-details',
        'git-switch-branch',
        'git-pull',
        'git-fetch'
      ]) {
        expect(typeof ipcMain.__getHandler(channel)).toBe('function');
      }

      await expect(ipcMain.__getHandler('get-git-info')()).rejects.toThrow('no flake');
    });
  });
});

export {};
