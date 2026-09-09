const fs = require('fs');
const os = require('os');
const path = require('path');

function makeTempFlake(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packages-unit-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

describe('packages handler', () => {
  it('exports register function', () => {
    const mod = require('./packages');
    expect(mod.register).toBeInstanceOf(Function);
  });

  it('parses nested scoped option changes from git diff', () => {
    const mod = require('./packages');
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
    const mod = require('./packages');
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
    const mod = require('./packages');
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
    const mod = require('./packages');
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

    expect(summary.changed.map(c => c.optionPath)).toEqual(['alpha.a', 'zeta.a']);
    fs.rmSync(flakeDir, { recursive: true, force: true });
  });

  it('infers scoped paths from existing file when diff shows only leaf key', () => {
    const mod = require('./packages');
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

});
