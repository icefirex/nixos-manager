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

```ts
import { ipcMain } from 'electron';
import { realDep } from '../utils.ts';

type ExampleDeps = {
  ipcMain?: import('electron').IpcMain;
  realDep?: (input: string) => Promise<string>;
};

function createExampleHandlers(deps: ExampleDeps = {}) {
  const depsRealDep = deps.realDep || realDep;

  return {
    doThing: async (input: string) => {
      return depsRealDep(input);
    }
  };
}

function register(deps: ExampleDeps = {}) {
  const depsIpcMain = deps.ipcMain || ipcMain;
  const handlers = createExampleHandlers(deps);

  depsIpcMain.handle('example-do-thing', async (_event, input) => {
    return handlers.doThing(input);
  });
}

export { register, createExampleHandlers };
```

## Current Usage

All 11 handler modules follow the pattern:

- `src/main/handlers/options.ts` exports `createOptionsHandlers`.
- `src/main/handlers/packages.ts` exports `createPackagesHandlers`.
- `src/main/handlers/history.ts` exports `createHistoryHandlers`.
- `src/main/handlers/rebuild.ts` exports `createRebuildHandlers`.
- `src/main/handlers/git.ts` exports `createGitHandlers` (+ pure parsers).
- `src/main/handlers/generations.ts` exports `createGenerationsHandlers` (+ pure parsers).
- `src/main/handlers/notifications.ts` exports `createNotificationsHandlers` (+ pure builders).
- `src/main/handlers/system.ts` exports `createSystemHandlers` (+ pure helpers).
- `src/main/handlers/specializations.ts` exports `createSpecializationsHandlers`.
- `src/main/handlers/discover.ts` exports `createDiscoverHandlers` (+ pure helpers).
- `src/main/handlers/flake.ts` exports `createFlakeHandlers` (+ `parseFlakeInputs`, `parseFlakeLockInfo`).

## Testing Guidance

- Inject side-effecting dependencies (`runCmd`, `spawn`, `getDb`, filesystem helpers).
- Keep tests focused on returned payloads and command/argument wiring.
- Use small fake process objects for spawn-based flows (`stdout`, `stderr`, `close`, `error`).
- Keep one integration-style test through `register()` only when channel wiring itself is under test.

## TypeScript

The main process is **real TypeScript** (`.ts` sources, ESM imports/exports):

- `npm run typecheck` — strict `tsc` check of sources, types, and tests.
- `npm run build:main` — compiles `main.ts` + `preload.ts` + `src/main/**` to
  `dist-electron/` as CommonJS (`tsconfig.build.json`; relative `.ts` specifiers
  are rewritten to `.js` via `rewriteRelativeImportExtensions`).
- `package.json` `main` points at `dist-electron/main.js`; the Nix package
  (`package.nix`) builds and wraps the same output.
- Vitest runs the `.ts` sources natively through Node's type stripping
  (Node >= 23.6 required — nix-shell provides Node 24).
- Dev workflow: run `npm run build:main` (or `npm run dev:electron`) before
  launching `electron .`, since Electron now loads the compiled output.
