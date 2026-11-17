# Agide

A personal macOS desktop tool for agentic coding: a task tree whose leaves are surfaces (Claude sessions, browser tabs, Slack threads), with an app-hosted MCP server so the agent can do what the UI can do. Architecture and contracts: `../docs/decisions/0013-stage2-architecture-and-contracts.md`.

## Requirements

- macOS, Node 22.12 or later, pnpm 11.
- The `claude` CLI for real sessions (not needed for the tests).

## Run

```sh
pnpm install      # also downloads the Electron binary and repairs node-pty's spawn-helper
pnpm dev          # Electron with the Vite dev server
pnpm build        # production build into out/
```

Environment variables of the app:

| Variable | Effect |
|---|---|
| `AGIDE_USER_DATA` | Data directory (database and module files). Defaults to Electron's `userData`. |
| `AGIDE_HIDDEN=1` | The window is never shown. Used by the end-to-end tests. |
| `AGIDE_CLAUDE_BIN` | Path of the `claude` executable. Defaults to the usual install locations, then `PATH`. |
| `AGIDE_CLAUDE_ARGS` | JSON array of extra arguments for every `claude` launch, such as `["--model","haiku"]`. |
| `AGIDE_SESSION_CWD` | Working directory of sessions started from the tree. Defaults to the home directory. |

## Use

Right-click the tree to add folders and surfaces. "New Claude session" is offered inside a folder: it starts `claude` in a PTY and opens its terminal on the right. Clicking a session leaf shows its terminal again; a session from an earlier run shows as exited with a Resume button. Every session gets the app MCP server through `--mcp-config`, scoped to the session's folder, so the agent can change the tree below that folder. Its tool calls show the CLI's own permission prompt in the terminal.

## Test

```sh
pnpm typecheck    # tsc over the Node side (core, main, preload, e2e) and the renderer
pnpm test         # Vitest unit tests of src/core in plain Node
pnpm e2e          # builds, then launches the app hidden with Playwright
pnpm check        # typecheck, unit tests and end-to-end tests
```

Tests that call the real `claude` CLI are scripts outside these commands: `pnpm e2e:real-claude` (the whole app with a session that creates a folder through the app MCP server), `pnpm e2e:claude-mcp` (the MCP server with `claude -p`) and `node scripts/smoke-real-claude.mjs` (the PTY session service alone). They use `--model haiku`, `--max-budget-usd 0.25`, an empty temporary working directory, `--setting-sources user`, `--strict-mcp-config` unless a connector is under test, and an environment without inherited `CLAUDECODE` and `CLAUDE_CODE_*` variables that keeps `CLAUDE_CONFIG_DIR`.

## Module map

| Path | Responsibility |
|---|---|
| `src/core/events` | Typed event bus and the `AppEvent` union |
| `src/core/store` | `openStore` (`node:sqlite`) and per-module migrations |
| `src/core/tree` | `TreeService` contract, `InMemoryTreeService`, shared contract tests |
| `src/core/commands` | `Command`, `CommandRegistry`, `Caller`, folder scope check |
| `src/core/surfaces` | `SurfaceType` interface (types only) |
| `src/core/session` | `SessionService` contract, `FakeSessionService` |
| `src/core/mcp` | App MCP server contract and `--mcp-config` shape |
| `src/shared/ipc.ts` | IPC channel names and the `window.api` type |
| `src/main/index.ts` | App lifecycle |
| `src/main/window.ts` | Main window |
| `src/main/ipc.ts` | `commands:invoke`, `commands:list`, event broadcast |
| `src/main/modules.ts` | Module init order: tree, mcp, session |
| `src/main/modules/*.ts` | One file per module, each owned by one builder |
| `src/preload/index.ts` | `window.api`: `invoke`, `listCommands`, `subscribe` |
| `src/renderer` | React UI: `App.tsx` layout and open leaf, `panes/TreePane.tsx`, `panes/SurfacePane.tsx` (picks the view for a leaf), `panes/TerminalPane.tsx` |
| `e2e` | Playwright tests against the built app |

`src/core` must not import Electron or anything from `main`, `preload` or `renderer`; a unit test enforces this.

## Dependencies

Only packages listed under `allowBuilds` in `pnpm-workspace.yaml` run lifecycle scripts. Read a package's install script before adding it there.
