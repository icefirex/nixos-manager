import fs from 'fs';
import os from 'os';
import path from 'path';

function makeTempFile(content: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'options-unit-'));
  const filePath = path.join(dir, 'config.nix');
  fs.writeFileSync(filePath, content);
  return { dir, filePath };
}

describe('options handler', () => {
  it('exports register function', () => {
    const mod = require('./options.ts');
    expect(mod.register).toBeInstanceOf(Function);
  });

  it('registers all expected IPC channels via register(deps)', () => {
    const {  ipcMain  } = require('../../../tests/mocks/electron.ts');
    ipcMain.__resetHandlers();
    const mod = require('./options.ts');

    mod.register({ ipcMain });

    for (const channel of [
      'get-options',
      'get-option-info',
      'options-list-files',
      'set-option-value',
      'revert-option-from-git',
      'search-options-catalog',
      'get-live-options'
    ]) {
      expect(typeof ipcMain.__getHandler(channel)).toBe('function');
    }
  });

  it('register(deps) forwards injected deps so channels use the factory', async () => {
    const {  ipcMain  } = require('../../../tests/mocks/electron.ts');
    ipcMain.__resetHandlers();
    const mod = require('./options.ts');

    mod.register({
      ipcMain,
      findFlakeDir: () => null,
      flakeDirNotFoundMsg: () => 'no flake'
    });

    const handler = ipcMain.__getHandler('options-list-files');
    const result = await handler();
    expect(result).toEqual({ success: false, error: 'no flake' });
  });

  it('updates nested attrset assignments via updateOptionInFile', () => {
    const mod = require('./options.ts');
    const { dir, filePath } = makeTempFile(`
{ ... }:
{
  xdg.portal = {
    enable = false;
  };
}
`);

    const result = mod.updateOptionInFile(filePath, 'xdg.portal.enable', 'true', false);
    expect(result.action).toBe('set');
    expect(result.oldValue).toBe('false');
    expect(result.newValue).toBe('true');

    const updated = fs.readFileSync(filePath, 'utf8');
    expect(updated).toContain('enable = true;');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws when allowCreate is false and option does not exist', () => {
    const mod = require('./options.ts');
    const { dir, filePath } = makeTempFile(`
{ ... }:
{
  services.openssh.enable = true;
}
`);

    expect(() => mod.updateOptionInFile(filePath, 'programs.zsh.enable', 'true', false)).toThrow(
      "Option 'programs.zsh.enable' was not found in target file"
    );

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts scoped values from committed content when nested keys are used', () => {
    const mod = require('./options.ts');
    const value = mod.extractOptionValueFromContent(`
{ ... }:
{
  services.cockpit = {
    settings.WebService = {
      AllowUnencrypted = true;
    };
  };
}
`, 'services.cockpit.settings.WebService.AllowUnencrypted');

    expect(value).toBe('true');
  });

  it('builds scoped assignments for relative keys inside nested blocks', () => {
    const mod = require('./options.ts');
    const entries = mod.buildScopedAssignments(`
{ ... }:
{
  services.cockpit = {
    settings.WebService = {
      AllowUnencrypted = true;
    };
  };
}
`);

    const hit = entries.find((e: any) => e.lhs === 'AllowUnencrypted');
    expect(hit).toBeTruthy();
    expect(hit.fullPath).toBe('services.cockpit.settings.WebService.AllowUnencrypted');
    expect(hit.value).toBe('true');
  });

  it('normalizes option values by trimming and removing trailing semicolon', () => {
    const mod = require('./options.ts');
    expect(mod.normalizeOptionValue('  true;  ')).toBe('true');
    expect(mod.normalizeOptionValue('"abc" ;')).toBe('"abc"');
    expect(mod.normalizeOptionValue(null)).toBe('');
  });

  it('resolves absolute-root scope precedence in resolveScopePath', () => {
    const mod = require('./options.ts');
    const resolved = mod.resolveScopePath(['foo', 'services.cockpit', 'settings.WebService']);
    expect(resolved).toBe('services.cockpit.settings.WebService');
  });

  it('resolves target file paths with flake-dir-prefixed relative paths', () => {
    const mod = require('./options.ts');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'options-path-'));
    const flakeDir = path.join(dir, 'myflake');
    fs.mkdirSync(path.join(flakeDir, 'modules'), { recursive: true });
    const target = path.join(flakeDir, 'modules', 'ui.nix');
    fs.writeFileSync(target, '{ }\n');

    const resolved = mod.resolveTargetFilePath(flakeDir, 'myflake/modules/ui.nix');
    expect(resolved).toBe(target);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('updates multiline assignment while preserving trailing comment', () => {
    const mod = require('./options.ts');
    const { dir, filePath } = makeTempFile(`
{ ... }:
{
  services.demo.script = ''
    echo one
    echo two
  ''; # keep
}
`);

    const result = mod.updateOptionInFile(filePath, 'services.demo.script', "''\n    echo patched\n  ''", false);
    expect(result.action).toBe('set');
    expect(result.oldValue).toContain('echo one');

    const updated = fs.readFileSync(filePath, 'utf8');
    expect(updated).toContain("services.demo.script = ''\n    echo patched\n  ''; # keep");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when option is not present in content', () => {
    const mod = require('./options.ts');
    const value = mod.extractOptionValueFromContent('{ services.openssh.enable = true; }\n', 'programs.zsh.enable');
    expect(value).toBeNull();
  });

  it('supports DI-lite via createOptionsHandlers for setOptionValue flow', async () => {
    const mod = require('./options.ts');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'options-di-lite-'));
    fs.writeFileSync(path.join(dir, 'flake.nix'), '{ }\n');
    const filePath = path.join(dir, 'configuration.nix');
    fs.writeFileSync(filePath, '{\n  services.openssh.enable = true;\n}\n');

    const runCmdCalls: string[] = [];
    const historyCalls: Array<{ action?: string }> = [];
    const handlers = mod.createOptionsHandlers({
      findFlakeDir: () => dir,
      flakeDirNotFoundMsg: () => 'missing flake dir',
      runCmd: async (cmd: any) => {
        runCmdCalls.push(cmd);
        return cmd.includes(' diff ') ? 'diff --git a/configuration.nix b/configuration.nix' : '';
      },
      addOptionHistoryEntry: (entry: any) => historyCalls.push(entry)
    });

    const result = await handlers.setOptionValue({
      optionPath: 'services.openssh.enable',
      newValue: 'false',
      filePath
    });

    expect(result.success).toBe(true);
    expect(result.action).toBe('set');
    expect(result.oldValue).toBe('true');
    expect(result.newValue).toBe('false');
    expect(runCmdCalls.some(cmd => cmd.includes('git -C'))).toBe(true);
    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0].action).toBe('set');

    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('createOptionsHandlers coverage', () => {
    const { createOptionsHandlers } = require('./options.ts');

    function makeTempFlake(files: Record<string, string>) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'options-factory-'));
      for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
      }
      return dir;
    }

    it('getOptions parses and categorizes options from the flake', async () => {
      const dir = makeTempFlake({
        'configuration.nix': `
{ config, pkgs, ... }:
{
  services.openssh.enable = true;
  programs.zsh.enable = true;
  networking.hostName = "box";
}
`
      });

      const handlers = createOptionsHandlers({ findFlakeDir: () => dir });
      const options = await handlers.getOptions();

      expect(options.services).toContainEqual(expect.objectContaining({ path: 'services.openssh.enable' }));
      expect(options.programs).toContainEqual(expect.objectContaining({ path: 'programs.zsh.enable' }));
      expect(options.networking).toContainEqual(expect.objectContaining({ path: 'networking.hostName' }));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('optionsListFiles lists nix files with relative paths', async () => {
      const dir = makeTempFlake({
        'configuration.nix': '{ }\n',
        'modules/home.nix': '{ }\n',
        'README.md': 'not nix',
      });

      const handlers = createOptionsHandlers({ findFlakeDir: () => dir });
      const result = await handlers.optionsListFiles();
      expect(result.success).toBe(true);
      expect(result.files.map((f: any) => f.relativePath).sort()).toEqual(['configuration.nix', path.join('modules', 'home.nix')]);

      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('optionsListFiles reports failure without a flake dir', async () => {
      const handlers = createOptionsHandlers({ findFlakeDir: () => null, flakeDirNotFoundMsg: () => 'no flake' });
      expect(await handlers.optionsListFiles()).toEqual({ success: false, error: 'no flake' });
    });

    it('getLiveOptions collects services, programs, networking, and boot info', async () => {
      const runCmd = vi.fn(async (cmd: string) => {
        if (cmd.includes('systemctl list-unit-files')) return 'sshd.service enabled enabled\nsystemd-journald.service enabled enabled';
        if (cmd.startsWith('which git')) return '/run/current-system/sw/bin/git';
        if (cmd.startsWith('which vim')) return '';
        if (cmd === 'hostname 2>/dev/null') return 'nixbox';
        if (cmd.includes('firewall')) return 'active';
        if (cmd.startsWith('uname -r')) return '6.6.1';
        return '';
      });

      const handlers = createOptionsHandlers({ runCmd });
      const live = await handlers.getLiveOptions();

      expect(live.services).toContainEqual({ path: 'services.sshd', value: 'enabled', source: 'systemd' });
      expect(live.programs).toContainEqual({ path: 'programs.git', value: '/run/current-system/sw/bin/git', source: 'which' });
      expect(live.networking.map((o: any) => o.path)).toContain('networking.hostName');
      expect(live.networking.map((o: any) => o.path)).toContain('networking.firewall');
      expect(live.boot).toContainEqual({ path: 'boot.kernelPackages', value: '6.6.1', source: 'uname' });
    });

    it('getOptionInfo merges nixos-option output with config locations', async () => {
      const runCmd = vi.fn(async (cmd: string) => {
        if (cmd.startsWith('nixos-option')) return '{}';
        if (cmd.startsWith('grep')) return '/flake/config.nix:5:services.x.enable = true;\n/flake/config.nix:9:services.x.enable = false;';
        return '';
      });

      const handlers = createOptionsHandlers({
        findFlakeDir: () => '/flake',
        runCmd,
      });

      const info = await handlers.getOptionInfo('services.x.enable');
      expect(info.path).toBe('services.x.enable');
      expect(info.configLocations).toEqual(['config.nix:5', 'config.nix:9']);
    });

    it('searchOptionsCatalog passes through to the injected catalog search', async () => {
      const searchOptionCatalog = vi.fn(async () => [{ path: 'services.x.enable', description: null }]);
      const handlers = createOptionsHandlers({ searchOptionCatalog });

      const result = await handlers.searchOptionsCatalog('services.x');
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(searchOptionCatalog).toHaveBeenCalledWith('services.x', 'unstable', 20);
    });

    it('searchOptionsCatalog reports errors from the catalog', async () => {
      const handlers = createOptionsHandlers({
        searchOptionCatalog: vi.fn(async () => { throw new Error('network down'); }),
      });
      const result = await handlers.searchOptionsCatalog('x');
      expect(result).toEqual({ success: false, error: 'network down' });
    });
  });

});

export {};
