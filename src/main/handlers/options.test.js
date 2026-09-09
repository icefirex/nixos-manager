const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'options-unit-'));
  const filePath = path.join(dir, 'config.nix');
  fs.writeFileSync(filePath, content);
  return { dir, filePath };
}

describe('options handler', () => {
  it('exports register function', () => {
    const mod = require('./options');
    expect(mod.register).toBeInstanceOf(Function);
  });

  it('updates nested attrset assignments via updateOptionInFile', () => {
    const mod = require('./options');
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
    const mod = require('./options');
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
    const mod = require('./options');
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
    const mod = require('./options');
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

    const hit = entries.find(e => e.lhs === 'AllowUnencrypted');
    expect(hit).toBeTruthy();
    expect(hit.fullPath).toBe('services.cockpit.settings.WebService.AllowUnencrypted');
    expect(hit.value).toBe('true');
  });

  it('normalizes option values by trimming and removing trailing semicolon', () => {
    const mod = require('./options');
    expect(mod.normalizeOptionValue('  true;  ')).toBe('true');
    expect(mod.normalizeOptionValue('"abc" ;')).toBe('"abc"');
    expect(mod.normalizeOptionValue(null)).toBe('');
  });

  it('resolves absolute-root scope precedence in resolveScopePath', () => {
    const mod = require('./options');
    const resolved = mod.resolveScopePath(['foo', 'services.cockpit', 'settings.WebService']);
    expect(resolved).toBe('services.cockpit.settings.WebService');
  });

  it('resolves target file paths with flake-dir-prefixed relative paths', () => {
    const mod = require('./options');
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
    const mod = require('./options');
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
    const mod = require('./options');
    const value = mod.extractOptionValueFromContent('{ services.openssh.enable = true; }\n', 'programs.zsh.enable');
    expect(value).toBeNull();
  });

});
