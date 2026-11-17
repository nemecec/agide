# 0013 Stage 2 architecture and contracts

Status: accepted
Date: 2026-11-17
Decided by: spike agents
Inputs: 0004, 0006, 0009, 0012, `probes/RESULTS.md`, `probes/mcp_host.mjs`, `probes/lib.mjs`

## Context

0012 starts milestone 1 of the greenfield Electron shell: the shell, the task tree with persistence, the Claude session surface in a PTY, and the app MCP server with the command registry. Builders implement these slices in parallel. They need a repository, a toolchain that builds and tests, and contracts fixed before they start, so that no two builders edit the same file.

The application code is in `app/` of the Agide repository.

## Decision

### Toolchain

| Part | Choice | Version at scaffold |
|---|---|---|
| Runtime | Electron | 45.3.3 (Node 24.22 inside) |
| Build | electron-vite with Vite and `@vitejs/plugin-react` | 6.0.0, 8.3.8, 6.3.0 |
| UI | React | 19.3.1 |
| Language | TypeScript, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | 7.0.2 |
| Unit tests | Vitest, plain Node, over `src/core` and the Electron-free module tests in `src/main` | 5.1.0 |
| End-to-end tests | Playwright `_electron.launch` | 1.65.1 |
| Schemas | zod | 4.6.7 |
| MCP | `@modelcontextprotocol/sdk` | 1.32.2 |
| Terminal | `@xterm/xterm`, `@xterm/addon-fit`, `node-pty` | 6.0.0, 0.11.0, 1.1.0 |
| Tree UI | `@headless-tree/core`, `@headless-tree/react` | 1.8.0 |
| Database | `node:sqlite` (built in) | SQLite 3.51 in Node 22.22, 3.54 in Electron 45 |
| Package manager | pnpm | 11.21.0 |

Choices and their reasons:

- SQLite driver: `node:sqlite`. A test run opened a file database, created a table, inserted and read a row, in Node 22.22 and in the Electron 45 main process. Both worked. There is no native module to rebuild for Electron. Node 22 prints an experimental warning; the API is synchronous, like better-sqlite3. If a later Electron drops or changes the module, better-sqlite3 13.x is the fallback and needs `@electron/rebuild` against the Electron ABI.
- MCP SDK: the official `@modelcontextprotocol/sdk` server with the Streamable HTTP transport. The probe server (`probes/mcp_host.mjs`) shows the security checks and the config shape; the SDK replaces its hand-written JSON-RPC handling.
- TypeScript 7 is the `latest` tag. typescript-eslint 8.73 accepts TypeScript below 6.1 only, so there is no ESLint setup; `pnpm typecheck` is the static check.
- Lifecycle scripts: pnpm 11 replaced `onlyBuiltDependencies` with `allowBuilds` in `pnpm-workspace.yaml`. Only `node-pty` may run its scripts; they check for a prebuild, build with node-gyp when none matches the platform, and clean the build folder (read before allowing). Electron 45 has no install script; the app's own `postinstall` runs Electron's `install.js` (download with checksums from the package) and sets the executable bit on node-pty's `spawn-helper`, which node-pty 1.1.0 publishes without it (every spawn then fails with `posix_spawnp failed`). node-pty uses N-API prebuilds; after that fix it spawns a process inside the Electron main process without a rebuild.

### Modules

```
src/core      Electron-free, plain Node; unit-tested with Vitest (the main-module tests in src/main/modules run there too)
  events      typed event bus; AppEvent union of all module events
  store       openStore (node:sqlite, WAL), migrate per module
  tree        TreeService contract, InMemoryTreeService, shared contract tests
  commands    Command, CommandRegistry, Caller, CommandContext, requireInScope
  surfaces    SurfaceType and related types from 0006 (types only)
  session     SessionService contract, FakeSessionService
  mcp         AppMcpServer contract, grant and --mcp-config shapes
src/shared    IPC channel names and the RendererApi type
src/main      lifecycle (index.ts), window.ts, ipc.ts, modules.ts, context.ts, modules/{tree,mcp,session}.ts
src/preload   window.api: invoke, listCommands, subscribe
src/renderer  App.tsx layout (owns the node list and the open node), panes/TreePane.tsx, panes/TerminalPane.tsx, panes/SurfacePane.tsx
e2e           Playwright tests against the built app
```

A test in `src/core` fails when a core file imports `electron` or code from `main`, `preload` or `renderer`.

`modules.ts` initializes the modules in dependency order and passes each the `ModuleContext` (event bus, command registry, database, data directory) plus the services it depends on: tree first, then mcp (gets the tree), then session (gets the tree and the mcp server). Each `init` returns `{ service, dispose? }`. Dispose runs in reverse order on quit. The modules are the real ones: the SQLite tree, the Streamable HTTP MCP server and the PTY sessions. `src/main/appForTests.ts` starts the same module graph on a chosen database and data directory without Electron; the module tests and `pnpm parity` use it.

### Contracts

Tree (`core/tree/types.ts`):

- A node is a folder or a leaf. Both have `id`, `parentId` (`null` is the top level), `title` and `order`, the dense 0-based position among siblings. A leaf adds `surfaceType` and `surfaceId`.
- Operations are synchronous: `list`, `get`, `children`, `createFolder`, `createLeaf`, `move` (rejects a move into the node itself or a descendant with `cycle`), `rename` (trims, rejects blank), `remove` (whole subtree, returns the removed nodes), `isWithin`, `subscribe`. Only folders hold children. A failing operation throws `TreeError` and changes nothing.
- Events: `tree.node_created`, `tree.node_renamed`, `tree.node_moved`, `tree.subtree_removed` (lists every removed node, so surface owners dispose their leaves). Sibling renumbering emits no extra events.
- `describeTreeServiceContract` holds the behaviour tests; the SQLite implementation runs the same suite.

Session (`core/session/types.ts`):

- The app chooses the session id and passes it with `--session-id`. A session has a folder, title, working directory, launch path (`pty` or `stream-json`), status (`starting`, `idle`, `busy`, `waiting`, `exited`) and creation time.
- Operations: `create`, `resume` (a new process with `--resume` for an exited session), `close`, `sendText` (types and submits a prompt), `write` (raw terminal input), `resize`, `get`, `list`, `subscribe`.
- Events: `session.created`, `session.status_changed`, `session.output` (raw PTY output), `session.hook` (a hook payload from the app's `--settings` hooks, the status source for PTY sessions in 0004 and the input for agent records in 0009), `session.exited`, `session.closed`.
- `permissionMode` is passed on every launch (0004). Launches follow 0004 decision 2.

Commands (`core/commands/types.ts`):

- A command has `id`, `title`, `description`, a zod `input` schema, `ui` (a menu or accelerator binding, or `false`), `mcp` (exposed as a tool or not) and `run(input, ctx)`. The result is JSON-serializable.
- The id is `<area>_<verb>[_<object>]` in lower snake case and is also the MCP tool name, such as `ui_create_folder` or `session_send_text`. The registry rejects other ids and duplicates.
- `invoke(id, input, caller)` parses the input for every caller and returns `{ ok: true, value }` or `{ ok: false, error: { code, message } }`, never throws. Codes: `not_found`, `invalid_input`, `out_of_scope`, `failed`. An MCP caller cannot see commands with `mcp: false`.
- `Caller` is `{ kind: 'ui' }` or `{ kind: 'mcp', sessionId, folderId }`. Commands call `requireInScope(tree, caller, nodeId)` before touching a node, which rejects nodes outside an MCP caller's folder.

MCP server (`core/mcp/types.ts`):

- Streamable HTTP from the SDK, bound to 127.0.0.1, URL `http://127.0.0.1:<port>/mcp/<sessionId>`.
- A random bearer token per session, compared in constant time, valid only for the session in the path. Requests with an `Origin` header get 403; a `Host` other than `127.0.0.1:<port>` or `localhost:<port>` gets 403.
- Tools are the registry's commands with `mcp: true`: name from the id, description, JSON Schema from the zod schema. Calls run with the caller from the grant. Command errors return as tool results with `isError: true`.
- `grant(sessionId, folderId)` issues the token before launch; `configFor` returns the `--mcp-config` JSON with server name `app` and `"type": "http"`; `rescope` follows a moved session; `revoke` ends access.

IPC (`shared/ipc.ts`): `commands:invoke` (renderer to main, caller `ui`), `commands:list` (descriptors without schemas or functions) and `events:event` (main to renderer, every bus event). Only the main frame of an app window may invoke. The renderer has no other channel, so the UI and the agent share one code path. The window runs with context isolation, the sandbox and a CommonJS preload.

### Ownership

| Builder | Owns | Must not edit |
|---|---|---|
| Tree | new files under `src/core/tree/` (SQLite `TreeService`, its migrations and tests), `src/main/modules/tree.ts`, `ui_*` tree commands | other modules, contracts |
| Session | new files under `src/core/session/` (PTY `SessionService`, launch arguments, hook relay), `src/main/modules/session.ts`, `session_*` commands, real-Claude scripts under `scripts/` | other modules, contracts |
| MCP | new files under `src/core/mcp/`, `src/main/modules/mcp.ts` | other modules, contracts |
| Renderer | `src/renderer/**` except `api.ts` | main, core |

The contract files (`types.ts` in each core folder, `core/events/index.ts`, `core/commands/CommandRegistry.ts`, `core/store/Store.ts`, `shared/ipc.ts`, `main/context.ts`, `main/modules.ts`, `main/ipc.ts`, `main/index.ts`, `preload/index.ts`), `package.json`, the lockfile and the configs belong to the scaffold. A builder who needs a contract change records it in its measurement file and the integration step applies it. All dependencies are installed now.

The session module creates the `claude-session` leaf through the tree service and the grant through the mcp service it receives; the tree builder does not know about sessions. Tree commands for the renderer (list, create, move, rename, remove) come from the tree builder; the renderer builder calls them by id and works against the stubs and fakes until they exist.

### Test strategy

- `pnpm test`: Vitest over `src/core/**/*.test.ts` and `src/main/**/*.test.ts`, plain Node, no Electron, no Claude. The MCP tests use HTTP on the loopback interface only, and the session tests start a fake `claude` script through node-pty. Implementations of a contract run its shared suite.
- `pnpm e2e`: builds the app and launches it with Playwright, with `AGIDE_HIDDEN=1` (the window is never shown) and a temporary `AGIDE_USER_DATA`.
- Real-Claude tests are scripts outside both commands. They follow the probe rules: model `haiku`, `--max-budget-usd 0.25`, an empty temporary working directory, `--setting-sources user`, `--strict-mcp-config` unless a connector is the point, and the environment scrub of `probes/lib.mjs` that keeps `CLAUDE_CONFIG_DIR`.

## Consequences

- Builders work in disjoint files; a contract change needs a coordinated edit and is the main merge risk.
- The core runs in plain Node, so tree, commands and the MCP tool mapping are testable without Electron.
- `node:sqlite` is experimental in Node 22. The store is behind `openStore` and `migrate`, so a switch to better-sqlite3 touches one file plus the rebuild step.
- There is no linter until typescript-eslint supports TypeScript 7.
- The app quits through `app.exit` after async disposal, because under Playwright a second `app.quit` after a held `will-quit` does not quit.
- Not verified: `pnpm dev` with the renderer's Content Security Policy (the React refresh preamble is an inline script). The Streamable HTTP rules and the zod JSON Schema output are covered by `scripts/e2e-claude-mcp.mjs` against the real CLI.

## Amendments after review

These change or sharpen the contracts above. The code follows them. The tests cover them except for the rules listed under "Rules without a test".

### Ownership as built

- The `ui_*` node commands are in `core/commands/treeCommands.ts`. The MCP builder wrote them and the mcp module registers them through `registerBuiltinCommands`. The tree module registers `ui_list_surface_types` only.
- No separate renderer builder ran. The tree builder wrote the tree pane, the session builder wrote the terminal pane, and the integration step wrote `App.tsx` and `SurfacePane`.

### Surface ownership

- A surface type whose leaves are created together with the surface is owned by its module. `ui_create_leaf` from an MCP caller accepts only the types in `AGENT_CREATABLE_SURFACE_TYPES` (`core/tree/surfaceCatalog.ts`: `browser-tab`, `slack-thread`) and answers `invalid_input` for any other type, so an agent cannot create a `claude-session` leaf. A UI caller may create any type.
- The session module records the leaf id of each session (`session_create` sets it; at startup the first leaf of a session in tree order is adopted). Moves and removals of any other leaf with the same `surfaceId` have no effect on the session. A session whose leaf is missing at startup is closed.
- A move of the session's own leaf to the top level revokes its MCP grant, because the scope is a folder. A move into another folder rescopes the grant and sets the session folder. A resumed session whose leaf is outside its folder gets no grant.
- The grant is revoked when the session closes, when its process exits (resume issues a new grant), and when a launch from `session_create` fails after the grant was issued. A failed resume launch does not revoke the grant; its token reached no process, and the next resume replaces it.

### Commands

- `Command.mcpExempt` (optional string) states why a UI-bound command is not an MCP tool. `checkParity` accepts a UI-bound command without a tool only with this reason and `docs/parity.md` shows it. `session_create` is exempt: agents do not start sessions.
- The parity check runs over the registry that the real module graph builds (tree, mcp and session modules), in `pnpm parity` and in `src/main/modules/appModules.test.ts`. The unit test compares `docs/parity.md` with the generated table and fails when it is out of date; only `pnpm parity` writes the file.
- `requireInScope` answers `not_found` for a node id that does not exist and `out_of_scope` for a node outside the folder. The `out_of_scope` message tells the agent to call `ui_list_tree`.
- Tree errors `cycle` and `parent_not_folder` map to `invalid_input`, with the tree's message. `failed` is for faults the caller cannot fix.
- `session_create` takes `confirmBypassPermissions`. A request for `bypassPermissions` without it answers `invalid_input`.

### Tree and store

- A listener that throws does not undo a committed tree operation or stop later listeners. Both tree implementations take an `onListenerError` callback (default `console.error`).
- `SqliteTreeService.isWithin` uses `UNION`, so a stored cycle ends the walk.
- `openStore` sets `busy_timeout` to 2000 ms. `migrate` throws when a module's recorded version is above the highest known migration (`<module> schema is at version N, this build knows up to M`).
- The main process holds `app.requestSingleInstanceLock()` and a second instance on the same data directory exits.

### Hooks

- A hook command writes its payload to a temporary file in the session's inbox directory (`<dataDir>/session-events/<sessionId>/`) and renames it to `*.json` when complete. It runs under `/bin/sh -c` whatever the login shell is. `HookInbox` (replaces `JsonlTail`) delivers the files oldest first by modification time, then name, deletes them after reading and empties the directory at each launch. Concurrent hooks with large payloads cannot interleave, and a multi-byte character cannot be split. Order between hooks that run at the same instant is not defined.
- The command string parses the same way under fish, zsh, bash and sh (checked in the review with an inbox path that holds spaces and a quote). The CLI 2.1.326 starts a `--settings` hook command with `/bin/sh -c` when `SHELL` is zsh (one `-p` run in the review), so the wrapper has an effect only if the CLI changes that.
- `buildLaunchArgs` takes `inboxDir` in place of `eventsFile`.

### Security limits

- The MCP folder scope protects against an agent's mistakes. It does not protect against an adversarial agent with shell access: the bearer token is in the `claude` process arguments (`ps` shows it to same-user processes) and a session can open the app database. Moving the config into a 0600 file would remove the token from `ps` output only.
- The main window denies all web permission requests, loads the dev server URL only when the app is not packaged, and `commands:invoke` and `commands:list` accept only the main frame of an app window whose frame URL is the built page or the dev server.

### Rules without a test

A mutation run in the review removed each rule in turn and ran `pnpm test`. These removals pass every test:

- the revoke after a failed `session_create` launch;
- the withheld grant for a resumed session whose leaf is outside its folder;
- `busy_timeout`;
- the 500 answer of the MCP request handler.

The single-instance lock, the web permission handlers, the dev URL rule and the frame URL check import Electron and have no test. A manual run in the review showed that a second instance on the same data directory exits at once and that an instance on another data directory runs next to the first.

The revoke on `session.closed` can be removed without a failing test because the process exit, which precedes it, already revokes the grant. With `UNION ALL` in `isWithin` the stored-cycle test does not fail; it never returns, because the query is synchronous.

### Open decision

- App sessions launch with `permissionMode` `default` unless the caller passes another mode, and every `mcp__app__*` call asks for approval. 0012 sets the default for app-launched agents to the user's auto mode with ask rules. Which default applies to sessions the user starts is not decided. The launch always passes the mode explicitly (0004).
