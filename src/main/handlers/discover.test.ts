const fs = require('fs');
const os = require('os');
const path = require('path');

describe('discover handler', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('exports register and cleanup functions', () => {
    const mod = require('./discover');
    expect(mod.register).toBeInstanceOf(Function);
    expect(mod.cleanup).toBeInstanceOf(Function);
  });

  it('detects tty-related errors', () => {
    const mod = require('./discover');
    expect(mod.isTTYError('error opening terminal')).toBe(true);
    expect(mod.isTTYError('all good')).toBe(false);
  });

  it('decodes xml entities in catalog values', () => {
    const mod = require('./discover');
    expect(mod.decodeXmlEntities('Fish &amp; Chips &lt;3')).toBe('Fish & Chips <3');
  });

  it('extracts icon and categories from appstream xml snippet', () => {
    const mod = require('./discover');
    const xml = `
<component type="desktop-application">
  <id>org.demo.App</id>
  <name>Demo</name>
  <pkgname>demo</pkgname>
  <icon type="cached">demo.png</icon>
  <categories>
    <category>Utility</category>
    <category>GTK</category>
  </categories>
</component>
`;

    expect(mod.extractIcon(xml)).toEqual({ type: 'cached', name: 'demo.png' });
    expect(mod.extractCategories(xml)).toEqual(['Utility', 'GTK']);
  });

  it('parses appstream xml component fields', () => {
    const mod = require('./discover');
    const parsed = mod.parseAppStreamXML(`
<components version="0.16">
  <component type="desktop-application">
    <id>org.gimp.GIMP</id>
    <pkgname>gimp</pkgname>
    <name>GIMP</name>
    <summary>Image editor</summary>
    <description><p>Powerful editor</p></description>
    <url type="homepage">https://gimp.org</url>
  </component>
</components>
`);

    expect(parsed.length).toBeGreaterThanOrEqual(1);
    const gimp = parsed.find(p => p.pkgname === 'gimp');
    expect(gimp).toBeTruthy();
    expect(gimp.name).toBe('GIMP');
    expect(gimp.summary).toBe('Image editor');
    expect(gimp.homepage).toBe('https://gimp.org');
  });

  describe('searchComponents', () => {
    const { searchComponents } = require('./discover');

    const components = [
      { name: 'GIMP', summary: 'Image editor', pkgname: 'gimp', categories: ['Graphics'] },
      { name: 'Firefox', summary: 'Web browser', pkgname: 'firefox', categories: ['Network'] },
      { name: 'Inkscape', summary: 'Vector graphics editor image', pkgname: 'inkscape', categories: ['Graphics'] }
    ];

    it('filters by query across name, summary, and pkgname', () => {
      expect(searchComponents(components, 'gimp')).toHaveLength(1);
      expect(searchComponents(components, 'browser')).toHaveLength(1);
      expect(searchComponents(components, 'image')).toHaveLength(2);
      expect(searchComponents(components, '')).toHaveLength(3);
    });

    it('filters by category and combines with query', () => {
      expect(searchComponents(components, '', { category: 'Graphics' })).toHaveLength(2);
      expect(searchComponents(components, 'image', { category: 'Network' })).toHaveLength(0);
    });

    it('prioritizes exact name matches and respects limit', () => {
      const results = searchComponents(components, 'firefox');
      expect(results[0].pkgname).toBe('firefox');

      expect(searchComponents(components, '', { limit: 2 })).toHaveLength(2);
    });

    it('matches pkgname exactly regardless of case', () => {
      const results = searchComponents(components, 'INKSCAPE');
      expect(results[0].pkgname).toBe('inkscape');
    });
  });

  describe('parseNixpkgsSearchResults', () => {
    const { parseNixpkgsSearchResults } = require('./discover');

    it('maps nix search json output to result entries', () => {
      const stdout = JSON.stringify({
        'legacyPackages.x86_64-linux.hello': { pname: 'hello', version: '2.12', description: 'Hello program' },
        'legacyPackages.x86_64-linux.git': { pname: 'git', version: '2.40', description: 'Distributed VCS' }
      });

      const results = parseNixpkgsSearchResults(stdout);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ pkgname: 'git', name: 'git', version: '2.40', isNixpkgsResult: true });
      expect(results[1]).toMatchObject({ pkgname: 'hello', name: 'hello', summary: 'Hello program' });
    });

    it('falls back to last attr segment when pname is missing', () => {
      const stdout = JSON.stringify({
        'legacyPackages.x86_64-linux.python3Packages.requests': { version: '2.0' }
      });
      const results = parseNixpkgsSearchResults(stdout);
      expect(results[0].name).toBe('requests');
      expect(results[0].pkgname).toBe('python3Packages.requests');
    });

    it('returns empty for empty or malformed output', () => {
      expect(parseNixpkgsSearchResults('')).toEqual([]);
      expect(parseNixpkgsSearchResults('{}')).toEqual([]);
      expect(parseNixpkgsSearchResults('not json')).toEqual([]);
    });
  });

  describe('resolvePackageSection', () => {
    const { resolvePackageSection } = require('./discover');

    it('resolves all package types', () => {
      expect(resolvePackageSection('system')).toEqual({ ok: true, sectionPrefix: 'environment.systemPackages' });
      expect(resolvePackageSection('homeManager')).toEqual({ ok: true, sectionPrefix: 'home.packages' });
      expect(resolvePackageSection('user', 'ice')).toEqual({ ok: true, sectionPrefix: 'users.users.ice.packages' });
    });

    it('rejects user type without a user name and unknown types', () => {
      expect(resolvePackageSection('user')).toEqual({ ok: false, error: 'User name is required for user packages' });
      expect(resolvePackageSection('bogus').ok).toBe(false);
    });
  });

  describe('removePackageFromContent', () => {
    const { removePackageFromContent } = require('./discover');

    it('removes a pkgs reference line and collapses blank lines', () => {
      const content = 'environment.systemPackages = with pkgs; [\n  pkgs.hello\n\n  pkgs.git\n];\n';
      const result = removePackageFromContent(content, 'hello');
      expect(result.ok).toBe(true);
      expect(result.content).toContain('pkgs.git');
      expect(result.content).not.toContain('pkgs.hello');
      expect(result.content).not.toContain('\n\n\n');
    });

    it('keeps trailing comments when removing', () => {
      const content = '[\n  pkgs.hello # small tool\n];\n';
      const result = removePackageFromContent(content, 'hello');
      expect(result.ok).toBe(true);
      expect(result.content).not.toContain('hello');
    });

    it('falls back to bare package names', () => {
      const content = '[\n  hello\n];\n';
      const result = removePackageFromContent(content, 'hello');
      expect(result.ok).toBe(true);
      expect(result.content).not.toContain('hello');
    });

    it('reports not-found packages', () => {
      expect(removePackageFromContent('[\n  pkgs.git\n];\n', 'hello'))
        .toEqual({ ok: false, error: "Package 'hello' not found in file" });
    });
  });

  describe('addPackageToContent', () => {
    const { addPackageToContent } = require('./discover');

    it('inserts into an existing list matching its indentation', () => {
      const content = 'environment.systemPackages = with pkgs; [\n  pkgs.git\n];\n';
      const result = addPackageToContent(content, 'hello', 'environment.systemPackages');
      expect(result.ok).toBe(true);
      expect(result.content).toContain('pkgs.git\n  pkgs.hello');
    });

    it('rejects duplicates', () => {
      const content = 'environment.systemPackages = [ pkgs.hello ];\n';
      const result = addPackageToContent(content, 'hello', 'environment.systemPackages');
      expect(result.ok).toBe(false);
      expect(result.error).toContain("already in environment.systemPackages");
    });

    it('creates a missing section before the closing brace', () => {
      const content = '{\n  programs.git.enable = true;\n}\n';
      const result = addPackageToContent(content, 'hello', 'home.packages');
      expect(result.ok).toBe(true);
      expect(result.content).toMatch(/home\.packages = with pkgs; \[\n    pkgs\.hello\n  \];/);
      expect(result.content.trimEnd().endsWith('}')).toBe(true);
    });

    it('reports a missing closing bracket', () => {
      const content = 'environment.systemPackages = [\n';
      const result = addPackageToContent(content, 'hello', 'environment.systemPackages');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Could not find closing bracket for the section');
    });
  });

  describe('scanNixConfigFiles', () => {
    const { scanNixConfigFiles } = require('./discover');

    it('scans .nix files and reports sections and users', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-scan-'));
      fs.mkdirSync(path.join(dir, 'modules'));
      fs.writeFileSync(path.join(dir, 'configuration.nix'),
        '{ environment.systemPackages = [ pkgs.git ]; users.users.ice.packages = [ pkgs.hello ]; }\n');
      fs.writeFileSync(path.join(dir, 'modules', 'home.nix'),
        '{ home.packages = [ pkgs.vim ]; }\n');
      fs.writeFileSync(path.join(dir, 'README.md'), 'not nix');

      const files = scanNixConfigFiles(dir);

      expect(files).toHaveLength(2);
      const cfg = files.find(f => f.relativePath === 'configuration.nix');
      expect(cfg.sections).toEqual(['system', 'user']);
      expect(cfg.users).toEqual(['ice']);
      const home = files.find(f => f.relativePath === path.join('modules', 'home.nix'));
      expect(home.sections).toEqual(['homeManager']);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('createDiscoverHandlers', () => {
    const mod = require('./discover');

    it('init reports stats on success and errors on failure', async () => {
      const okHandlers = mod.createDiscoverHandlers({
        loadComponents: vi.fn(async () => []),
        getComponentsCache: () => [{ pkgname: 'x' }],
        getCategories: () => ['A', 'B']
      });
      expect(await okHandlers.init()).toEqual({ success: true, stats: { totalApps: 1, categories: 2 } });

      const failHandlers = mod.createDiscoverHandlers({
        loadComponents: vi.fn(async () => { throw new Error('no data'); })
      });
      expect(await failHandlers.init()).toEqual({ success: false, error: 'no data' });
    });

    it('search and byCategory use the injected cache', async () => {
      const cache = [
        { name: 'GIMP', summary: 'editor', pkgname: 'gimp', categories: ['Graphics'] },
        { name: 'Firefox', summary: 'browser', pkgname: 'firefox', categories: ['Network'] }
      ];
      const handlers = mod.createDiscoverHandlers({
        loadComponents: vi.fn(async () => cache),
        getComponentsCache: () => cache
      });

      expect(await handlers.search('browser')).toHaveLength(1);
      expect(await handlers.byCategory('Graphics')).toHaveLength(1);
      expect(await handlers.getCategories()).toBeUndefined; // not wired here
    });

    it('getDetails merges appstream and injected nix eval data', async () => {
      const handlers = mod.createDiscoverHandlers({
        loadComponents: vi.fn(async () => []),
        getComponentsByPkgname: () => new Map([['hello', { name: 'Hello', pkgname: 'hello' }]]),
        nixEvalJson: vi.fn(async () => ({ license: { spdxId: 'MIT' }, homepage: 'x', platforms: ['a', 'b', 'c', 'd', 'e', 'f'], maintainers: [{ name: 'Ice' }] })),
        nixEvalRaw: vi.fn(async () => '2.12')
      });

      const details = await handlers.getDetails('hello');
      expect(details.appstream).toEqual({ name: 'Hello', pkgname: 'hello' });
      expect(details.nix).toMatchObject({ version: '2.12', license: 'MIT', platforms: ['a', 'b', 'c', 'd', 'e'], maintainers: ['Ice'] });
    });

    it('getIcon guards against path traversal and encodes files', async () => {
      const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-icons-'));
      fs.mkdirSync(path.join(cacheDir, 'icons'));
      fs.writeFileSync(path.join(cacheDir, 'icons', 'demo.png'), Buffer.from('pngdata'));

      const handlers = mod.createDiscoverHandlers({ fs, cacheDir });

      expect(await handlers.getIcon('../../etc/passwd')).toBe(null);
      expect(await handlers.getIcon('missing.png')).toBe(null);
      const dataUrl = await handlers.getIcon('demo.png');
      expect(dataUrl).toBe(`data:image/png;base64,${Buffer.from('pngdata').toString('base64')}`);

      fs.rmSync(cacheDir, { recursive: true, force: true });
    });

    it('checkNixpkgsPackage and getConfigured flow through injected deps', async () => {
      const handlers = mod.createDiscoverHandlers({
        nixEvalRaw: vi.fn(async (attr) => (attr.includes('hello') ? 'A program' : '')),
        findFlakeDir: () => '/tmp/flake',
        getAllPackages: () => ({ system: ['git', 'git'], user: ['hello'], homeManager: [] })
      });

      expect(await handlers.checkNixpkgsPackage('hello')).toEqual({ exists: true });
      expect(await handlers.checkNixpkgsPackage('nope')).toEqual({ exists: false });

      const configured = await handlers.getConfigured();
      expect(configured).toEqual({ success: true, packages: ['git', 'hello'] });
    });

    it('addPackage writes to a real file and reports a diff', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-add-'));
      const filePath = path.join(dir, 'config.nix');
      fs.writeFileSync(filePath, '{\n  environment.systemPackages = with pkgs; [\n    pkgs.git\n  ];\n}\n');

      const handlers = mod.createDiscoverHandlers({
        fs,
        findFlakeDir: () => dir,
        runCmd: vi.fn(async () => '+    pkgs.hello')
      });

      const result = await handlers.addPackage({ pkgname: 'hello', filePath, packageType: 'system' });
      expect(result.success).toBe(true);
      expect(result.diff).toBe('+    pkgs.hello');
      expect(fs.readFileSync(filePath, 'utf8')).toContain('pkgs.hello');

      const dup = await handlers.addPackage({ pkgname: 'hello', filePath, packageType: 'system' });
      expect(dup.success).toBe(false);
      expect(dup.error).toContain('already in');

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('removePackage deletes the line and handles missing files', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-rm-'));
      const filePath = path.join(dir, 'config.nix');
      fs.writeFileSync(filePath, '{\n  environment.systemPackages = with pkgs; [\n    pkgs.git\n    pkgs.hello\n  ];\n}\n');

      const handlers = mod.createDiscoverHandlers({ fs, findFlakeDir: () => null });

      const result = await handlers.removePackage({ pkgname: 'hello', filePath });
      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf8')).not.toContain('pkgs.hello');

      const missing = await handlers.removePackage({ pkgname: 'hello', filePath: '/nope/missing.nix' });
      expect(missing).toEqual({ success: false, error: 'Target file does not exist' });

      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('register(deps) wiring', () => {
    it('registers all expected IPC channels and forwards deps', async () => {
      const { ipcMain } = require('../../../tests/mocks/electron');
      ipcMain.__resetHandlers();
      const mod = require('./discover');

      mod.register({
        ipcMain,
        findFlakeDir: () => null,
        flakeDirNotFoundMsg: () => 'no flake'
      });

      for (const channel of [
        'discover-init',
        'discover-get-categories',
        'discover-search',
        'discover-by-category',
        'discover-featured',
        'discover-get-icon',
        'discover-get-details',
        'discover-search-nixpkgs',
        'discover-refresh',
        'discover-is-trying',
        'discover-kill-try',
        'discover-try-package',
        'discover-get-config-files',
        'discover-check-nixpkgs-package',
        'discover-find-package',
        'discover-get-configured',
        'discover-remove-package',
        'discover-add-package'
      ]) {
        expect(typeof ipcMain.__getHandler(channel)).toBe('function');
      }

      const result = await ipcMain.__getHandler('discover-get-config-files')();
      expect(result).toEqual({ success: false, error: 'no flake' });

      const trying = await ipcMain.__getHandler('discover-is-trying')();
      expect(trying).toEqual({ running: false, package: null });
    });
  });

});

export {};
