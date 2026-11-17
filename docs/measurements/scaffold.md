# scaffold

Start: 2026-11-17 08:24:50 UTC
End: 2026-11-17 08:47:10 UTC
Wall time: about 22 minutes

## What was built

- `app/` as a git repository on `spike/stage2`, no commit.
- Toolchain: Electron 45.3.3, electron-vite 6.0.0, Vite 8.3.8, React 19.3.1, TypeScript 7.0.2, Vitest 5.1.0, Playwright 1.65.1, zod 4.6.7, `@modelcontextprotocol/sdk` 1.32.2, `@xterm/xterm` 6.0.0 with `@xterm/addon-fit` 0.11.0, node-pty 1.1.0, `@headless-tree/core` and `@headless-tree/react` 1.8.0. All dependencies the builders need are installed.
- `src/core` contracts and reference code: event bus, store with per-module migrations, tree contract with `InMemoryTreeService` and a shared contract test suite, command registry with caller and scope check, surface types from 0006, session contract with `FakeSessionService`, MCP server contract.
- `src/main` lifecycle, window, generic IPC, `modules.ts` and stub module files for tree, mcp and session. `src/preload` with `invoke`, `listCommands`, `subscribe`. `src/renderer` with the layout and stub panes.
- Decision record 0013 and `app/README.md`.
- Checks run and passing: `pnpm typecheck`, `pnpm test` (unit tests of the core), `pnpm build`, `pnpm e2e` (hidden window, title, both panes, command API reachable).

## What took long

- `pnpm e2e` hung in `app.close()`. Cause: under Playwright, a second `app.quit()` after a held `will-quit` does not quit. Reduced to a minimal Electron main and fixed by `app.exit(0)` after disposal.
- node-pty 1.1.0 publishes `spawn-helper` without the executable bit; every spawn failed with `posix_spawnp failed`. The app `postinstall` sets the bit. Verified by spawning `/bin/echo` inside the Electron main process.
- pnpm 11 ignores `onlyBuiltDependencies` and asks for `allowBuilds`; Electron 45 no longer has an install script, so the binary download moved into the app `postinstall`.

## Findings

- `node:sqlite` works in Node 22.22 (SQLite 3.51) and in the Electron 45 main process (Node 24.22, SQLite 3.54). Chosen; no native rebuild.
- typescript-eslint 8.73 does not support TypeScript 7, so no lint script.

## Not finished or not verified

- No lint script.
- `pnpm dev` was not run: it opens a visible window. The renderer Content Security Policy may block the React refresh preamble in dev mode.
- The MCP SDK Streamable HTTP transport with the Host and Origin rules, and zod 4 JSON Schema output in the CLI tool list, are left to the MCP builder.
- The sandbox printed `sandbox_extension_issue_file_to_process failed ... Operation not permitted` on each Electron start; Electron ran normally.
