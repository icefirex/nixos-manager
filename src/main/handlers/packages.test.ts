import fs from 'fs';
import os from 'os';
import path from 'path';

function makeTempFlake(files: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packages-unit-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content as any);
  }
  return dir;
}

describe('packages handler', () => {
  it('exports register function', () => {
    const mod = require('./packages.ts');
    expect(mod.register).toBeInstanceOf(Function);
  });

  it('registers all expected IPC channels via register(deps)', () => {
    const {  ipcMain  } = require('../../../tests/mocks/electron.ts');
    ipcMain.__resetHandlers();
    const mod = require('./packages.ts');

    mod.register({ ipcMain });

    for (const channel of [
      'get-packages',
      'get-package-info',
      'get-live-packages',
      'packages-get-duplicates',
      'get-pending-changes'
    ]) {
      expect(typeof ipcMain.__getHandler(channel)).toBe('function');
    }
  });

  it('register(deps) forwards injected deps so factory channels use them', async () => {
    const { ipcMain } = require('../../../tests/mocks/electron.ts');
    ipcMain.__resetHandlers();
    const mod = require('./packages.ts');

    mod.register({ ipcMain, findFlakeDir: () => null });

    const handler = ipcMain.__getHandler('packages-get-duplicates');
    const result = await handler();
    expect(result).toEqual({ success: false, error: 'Flake directory not found' });
  });

  describe('createPackagesHandlers coverage', () => {
    const { createPackagesHandlers } = require('./packages.ts');

    it('getPackages returns all packages from the injected scanner', async () => {
      const handlers = createPackagesHandlers({
        findFlakeDir: () => '/tmp/flake',
        getAllPackages: () => ({ system: ['git'], user: ['hello'], homeManager: ['vim'] }),
      });
      expect(await handlers.getPackages()).toEqual({
        system: ['git'],
        user: ['hello'],
        homeManager: ['vim'],
      });
    });

    it('getPackages throws the injected message when flake dir is missing', async () => {
      const handlers = createPackagesHandlers({
        findFlakeDir: () => null,
        flakeDirNotFoundMsg: () => 'no flake',
      });
      await expect(handlers.getPackages()).rejects.toThrow('no flake');
    });

    it('getDuplicates returns duplicates from the injected finder', async () => {
      const handlers = createPackagesHandlers({
        findFlakeDir: () => '/tmp/flake',
        findDuplicates: () => [{ pkgname: 'git', scope: 'system', files: [], crossUser: false }],
      });
      expect(await handlers.getDuplicates()).toEqual({
        success: true,
        duplicates: [{ pkgname: 'git', scope: 'system', files: [], crossUser: false }],
      });
    });
  });

  it('parses nested scoped option changes from git diff', () => {
    const mod = require('./packages.ts');
    const flakeDir = makeTempFlake({
      'modules/cockpit.nix': `
{ ... }:
{
  services.cockpit = {
    settings.WebService = {
      AllowUnencrypted = false;
    };
  };
}
`
    });

    const diffOut = `
diff --git a/modules/cockpit.nix b/modules/cockpit.nix
index 1111111..2222222 100644
--- a/modules/cockpit.nix
+++ b/modules/cockpit.nix
@@ -1,8 +1,8 @@
 { ... }:
 {
   services.cockpit = {
     settings.WebService = {
-      AllowUnencrypted = false;
+      AllowUnencrypted = true;
     };
   };
 }
`;

    const summary = mod.parseOptionDiffSummary(diffOut, flakeDir);
    expect(summary.changed).toContainEqual(expect.objectContaining({
      optionPath: 'services.cockpit.settings.WebService.AllowUnencrypted',
      from: 'false',
      to: 'true',
      file: 'modules/cockpit.nix'
    }));
    fs.rmSync(flakeDir, { recursive: true, force: true });
  });

  it('categorizes added and removed option assignments', () => {
    const mod = require('./packages.ts');
    const flakeDir = makeTempFlake({
      'configuration.nix': '{ ... }: { }\n'
    });

    const diffOut = `
diff --git a/configuration.nix b/configuration.nix
index aaaaaaa..bbbbbbb 100644
--- a/configuration.nix
+++ b/configuration.nix
@@ -1,4 +1,5 @@
 { ... }:
 {
-  services.old.enable = true;
+  services.new.enable = true;
 }
`;

    const summary = mod.parseOptionDiffSummary(diffOut, flakeDir);
    expect(summary.removed).toContainEqual(expect.objectContaining({
      optionPath: 'services.old.enable',
      from: 'true',
      file: 'configuration.nix'
    }));
    expect(summary.added).toContainEqual(expect.objectContaining({
      optionPath: 'services.new.enable',
      to: 'true',
      file: 'configuration.nix'
    }));
    fs.rmSync(flakeDir, { recursive: true, force: true });
  });

  it('ignores non-assignment diff lines and escaped newline markers', () => {
    const mod = require('./packages.ts');
    const flakeDir = makeTempFlake({ 'a.nix': '{ }\n' });
    const summary = mod.parseOptionDiffSummary(`
diff --git a/a.nix b/a.nix
--- a/a.nix
+++ b/a.nix
@@ -1,2 +1,2 @@
 \ No newline at end of file
-# comment
+# comment changed
`, flakeDir);

    expect(summary.added).toEqual([]);
    expect(summary.removed).toEqual([]);
    expect(summary.changed).toEqual([]);
    fs.rmSync(flakeDir, { recursive: true, force: true });
  });

  it('sorts changed entries by option path', () => {
    const mod = require('./packages.ts');
    const flakeDir = makeTempFlake({ 'b.nix': '{ }\n' });
    const summary = mod.parseOptionDiffSummary(`
diff --git a/b.nix b/b.nix
--- a/b.nix
+++ b/b.nix
@@ -1,4 +1,4 @@
-zeta.a = false;
+zeta.a = true;
-alpha.a = false;
+alpha.a = true;
`, flakeDir);

    expect(summary.changed.map((c: any) => c.optionPath)).toEqual(['alpha.a', 'zeta.a']);
    fs.rmSync(flakeDir, { recursive: true, force: true });
  });

  it('infers scoped paths from existing file when diff shows only leaf key', () => {
    const mod = require('./packages.ts');
    const flakeDir = makeTempFlake({
      'modules/portal.nix': `
{ ... }:
{
  xdg.portal = {
    enable = false;
  };
}
`
    });

    const diffOut = `
diff --git a/modules/portal.nix b/modules/portal.nix
index 1234567..89abcde 100644
--- a/modules/portal.nix
+++ b/modules/portal.nix
@@ -3,5 +3,5 @@
 {
   xdg.portal = {
-    enable = false;
+    enable = true;
   };
 }
`;

    const summary = mod.parseOptionDiffSummary(diffOut, flakeDir);
    expect(summary.changed).toContainEqual(expect.objectContaining({
      optionPath: 'xdg.portal.enable',
      from: 'false',
      to: 'true',
      file: 'modules/portal.nix'
    }));
    fs.rmSync(flakeDir, { recursive: true, force: true });
  });

  it('supports DI-lite via createPackagesHandlers for pending changes flow', async () => {
    const mod = require('./packages.ts');
    const flakeDir = makeTempFlake({
      'configuration.nix': '{\n  services.demo.enable = false;\n}\n'
    });

    const handlers = mod.createPackagesHandlers({
      findFlakeDir: () => flakeDir,
      runCmd: async (cmd: any) => {
        if (cmd.includes('diff --name-only')) return 'configuration.nix\n';
        if (cmd.includes("diff --unified=20 -- '*.nix'")) {
          return `
diff --git a/configuration.nix b/configuration.nix
--- a/configuration.nix
+++ b/configuration.nix
@@ -1,3 +1,3 @@
 {
-  services.demo.enable = false;
+  services.demo.enable = true;
 }
`;
        }
        return '';
      }
    });

    const result = await handlers.getPendingChanges();
    expect(result.hasDrift).toBe(true);
    expect(result.changedFiles).toEqual(['configuration.nix']);
    expect(result.optionChanges).toContainEqual(expect.objectContaining({
      optionPath: 'services.demo.enable',
      action: 'set',
      oldValue: 'false',
      newValue: 'true',
      source: 'git'
    }));

    fs.rmSync(flakeDir, { recursive: true, force: true });
  });

  it('returns flake-not-found payload from DI-lite getDuplicates', async () => {
    const mod = require('./packages.ts');
    const handlers = mod.createPackagesHandlers({ findFlakeDir: () => null });
    const result = await handlers.getDuplicates();
    expect(result).toEqual({ success: false, error: 'Flake directory not found' });
  });

});

export {};
