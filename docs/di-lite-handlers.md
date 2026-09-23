# DI-lite Handlers

This project uses a lightweight dependency injection pattern for IPC handlers.
The goal is better testability with minimal runtime changes.

## Pattern

1. Keep pure helpers at module scope (existing behavior unchanged).
2. Add `createXHandlers(deps = {})` that returns plain async functions.
3. In `register(deps = {})`, resolve `ipcMain` from deps and wire channels to factory methods.
4. Default every dependency to the production import.
5. Export the factory for tests.

## Template

```js
const { ipcMain } = require('electron');
const { realDep } = require('../utils');

function createExampleHandlers(deps = {}) {
  const depsRealDep = deps.realDep || realDep;

  return {
    doThing: async (input) => {
      return depsRealDep(input);
    }
  };
}

function register(deps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createExampleHandlers(deps);

  depsIpcMain.handle('example-do-thing', async (_event, input) => {
    return handlers.doThing(input);
  });
}

module.exports = { register, createExampleHandlers };
```

## Current Usage

Full DI-lite factories (`createXHandlers`):

- `src/main/handlers/options.js` exports `createOptionsHandlers`.
- `src/main/handlers/packages.js` exports `createPackagesHandlers`.
- `src/main/handlers/history.js` exports `createHistoryHandlers`.
- `src/main/handlers/rebuild.js` exports `createRebuildHandlers`.
- `src/main/handlers/git.js` exports `createGitHandlers` (+ pure parsers).
- `src/main/handlers/generations.js` exports `createGenerationsHandlers` (+ pure parsers).
- `src/main/handlers/notifications.js` exports `createNotificationsHandlers` (+ pure builders).
- `src/main/handlers/system.js` exports `createSystemHandlers` (+ pure helpers).

Pure-parser-only extraction (factory can be added later):

- `src/main/handlers/flake.js` exports `parseFlakeInputs`, `parseFlakeLockInfo`.

## Testing Guidance

- Inject side-effecting dependencies (`runCmd`, `spawn`, `getDb`, filesystem helpers).
- Keep tests focused on returned payloads and command/argument wiring.
- Use small fake process objects for spawn-based flows (`stdout`, `stderr`, `close`, `error`).
- Keep one integration-style test through `register()` only when channel wiring itself is under test.

## TypeScript Strategy

The Electron main process is plain CommonJS loaded directly by Electron (`main.js`),
with no bundler. Renaming `.js` sources to `.ts` would therefore break the runtime.
The migration is two-track:

1. **Test files** are real TypeScript (`.test.ts`), checked by `npm run typecheck`
   (`tsc -p tsconfig.json --noEmit`, strict mode, `allowJs`).
2. **Source files** stay `.js` and opt into checking with a `// @ts-check` pragma plus
   JSDoc annotations (`@param`, `@returns`, `@typedef`).

Every source module carries `// @ts-check`, including `main.js`, `preload.js`,
`window.js`, and all handlers. Handler factories declare their DI contract via
`@typedef {Object} XDeps` so injected dependencies are type-checked.

To migrate a source file to real `.ts` later, a main-process build step
(e.g. esbuild) must be introduced first.
