# Agide

A personal macOS desktop tool for agentic coding: a task tree whose leaves are surfaces (Claude sessions, browser tabs, Slack threads), with an app-hosted MCP server so the agent can do what the UI can do, a layout that the user and agents edit, an inbox with tasks and reminders, and profiles that run side by side. Architecture and contracts: `../docs/decisions/0013-stage2-architecture-and-contracts.md` and `../docs/decisions/0023-milestone-2-architecture-and-contracts.md`. What is built and verified: `../docs/decisions/0014-milestone-1-results.md` and `../docs/decisions/0024-milestone-2-results.md`.

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
| `AGIDE_ROOT` | App root holding `profiles/` and `registry/`. Defaults to `<appData>/agide`. |
| `AGIDE_PROFILE` | Profile to open when `--profile=<id>` is absent. Default: the profile focused last, else `default`. |
| `AGIDE_USER_DATA` | Data directory of one unnamed profile, without profiles and registry (used when `AGIDE_ROOT` is not set). |
| `AGIDE_HIDDEN=1` | The window is never shown. Used by the end-to-end tests. |
| `AGIDE_CLAUDE_BIN` | Path of the `claude` executable. Defaults to the usual install locations, then `PATH`. |
| `AGIDE_CLAUDE_ARGS` | JSON array of extra arguments for every `claude` launch, such as `["--model","haiku"]`. |
| `AGIDE_PERMISSION_MODE` | Permission mode of sessions that name none: `default` (the CLI's prompting mode, every tool call asks), `acceptEdits`, `plan` or `auto`. `default` when unset. `bypassPermissions` is only accepted per session with a confirmation. |
| `AGIDE_SESSION_CWD` | Working directory of sessions started from the tree. Defaults to `Agide/<folder id>` below the home directory, created with mode 0700. A directory inside the app root is refused. |
| `AGIDE_E2E_COVERAGE_DIR` | Set by `pnpm coverage:e2e`: every launched app writes V8 coverage there. |

## Use

Right-click the tree to add folders and surfaces. "New Claude session" is offered inside a folder: it starts `claude` in a PTY and opens its terminal. Clicking a session leaf shows its terminal again; a session from an earlier run shows as exited with a Resume button. Every session gets the app MCP server through `--mcp-config`, a file with mode 0600 in the session's directory under `sessions/` (the bearer token is never a process argument). The app removes the file once the session has started (`SessionStart`) and writes it again on resume, and removes leftover session directories at start. The server is scoped to the session's folder, so the agent can change the tree below that folder. Its tool calls show the CLI's own permission prompt in the terminal. The launch settings deny the CLI's Read and Edit tools on the app root; a shell command run by the agent is not covered, because local sessions run as the user.

A new working directory makes `claude` ask whether you trust the folder, with "No, exit" selected. Answer in the terminal.

## Profiles

Unless `AGIDE_USER_DATA` is set without `AGIDE_ROOT`, each profile runs as its own process with its own data directory, browser partitions and Claude configuration directory. The first start moves the milestone 1 data into the `default` profile and keeps its Claude login. Start a profile with `--profile=<id>`; a second start of a running profile focuses its window.

The rail at the left edge lists the profiles with their colour and unread count; a click opens or focuses the profile. "New profile" creates one with its own Claude directory and isolated tool credentials (gh, git, ssh, AWS, npm and Docker locations inside the profile, and only an allow list of inherited environment variables). The setup pane of a new profile opens a terminal in an empty `data/login` directory to sign in to Claude, checks the login with `claude auth status`, and asks for the git identity. Plain `ssh` and `scp` run by an agent still read your default keys; only git uses the profile's ssh config.

A profile reads of the other profiles only their definition (id, name, colour, creation time) and their entry in `registry/` in the app root: the profile id, the process id, a random id per start, the time of the last refresh and the unread count.

## Inbox, tasks and reminders

The inbox tab lists items that wait for you: approvals and idle prompts from Claude hooks, failed turns, posts from agents (`inbox_post`) and fired reminders. An approval item appears when a session asks for permission, notifies only when the dialog is still open after the CLI's own delay, and clears when the tool call runs. The detail card shows the project and session context and can peek at the session's terminal without focusing it. Agent text is shown as plain text. Unread items of normal or high urgency count towards the dock badge and the rail.

Agents use `inbox_post`, `inbox_list`, `inbox_resolve`, `task_create`, `task_list`, `task_update`, `reminder_create`, `reminder_list` and `reminder_delete`. Reminders take an RFC 5545 RRULE subset in a time zone; a rule above 48 occurrences a day is refused. Reminders missed while the app was closed fire at the next start: by default one item for the latest missed occurrence (`catchUp` `latest`), or one per occurrence (`each`), or none (`none`).

## Layouts

The window shows a layout: `layouts/<id>.json` in the data directory, or a shipped preset (`session`, `pair`). Both presets place the profile rail at the left edge, the task tree, the surface host and the inbox as a tab beside the surface. Editing the file while the app runs changes the window; an invalid file keeps the running layout, shows the errors and is not rewritten until it is valid again. `window-layout.json` names the layout of the window. Every change is a revision in the app database, and Undo applies the previous one as a new revision. Agents use `blocks_list`, `layout_get`, `layout_validate`, `layout_apply`, `layout_undo`, `layout_switch`, `ui_open_to_side` and `ui_capture_window`; an agent changes a layout only while the focused node lies in its folder, and its captures mask the tree, the inbox and the rail. The formats are in `../docs/blocks.md`.

## Test

```sh
pnpm typecheck    # tsc over the Node side (core, main, preload, e2e) and the renderer
pnpm test         # Vitest unit tests of src/core, src/main, src/shared and the renderer logic (Node, jsdom for hooks and panes)
pnpm coverage     # the unit tests with V8 coverage; thresholds on src/core, src/main, src/main/modules, src/shared and the renderer logic files; report in coverage/
pnpm e2e          # builds, then launches the app hidden with Playwright
pnpm coverage:e2e # builds with source maps, runs the end-to-end tests and prints the coverage of the renderer and the main process; report in coverage-e2e/
pnpm parity       # every UI-bound command is an MCP tool or states an exemption; writes ../docs/parity.md
pnpm blocks-docs  # writes ../docs/blocks.md from the manifest and layout schemas
pnpm check        # typecheck, unit tests and end-to-end tests
```

The Electron entry points hold no decisions: which frames may call commands, the window open and navigation policy, the web preferences, the focus request and the `window.api` object come from small functions (`src/main/ipcPolicy.ts`, `src/main/windowPolicy.ts`, `src/main/focusRequest.ts`, `src/shared/rendererApi.ts`) that the unit tests cover, including the foreign-frame, subframe, other-origin and `window.open` cases. `src/main/ipc.ts` and `src/main/window.ts` are tested against a mocked `electron` module. Renderer tests that need the DOM start with `// @vitest-environment jsdom` and use `src/renderer/testing` (a fake `window.api` and a render helper). Panes that load an engine with a canvas (the terminal) are tested with the engine mocked.

`pnpm coverage:e2e` measures what the end-to-end tests reach: `page.coverage` for each window and `NODE_V8_COVERAGE` for the main process, mapped to `src` through source maps and merged by `monocart-coverage-reports`. It prints functions, branches and lines per area and is not a CI gate. `e2e/coverageHook.ts` is active only when `AGIDE_E2E_COVERAGE_DIR` is set. `--reuse` rebuilds the report from the raw data of the last run.

Tests that call the real `claude` CLI are scripts outside these commands: `pnpm e2e:real-claude` (the whole app with a session that creates a folder through the app MCP server), `pnpm e2e:real-claude-inbox` (a session that posts an inbox item with `inbox_post`; the item shows in the inbox pane), `pnpm e2e:claude-mcp` (the MCP server with `claude -p`) and `node scripts/smoke-real-claude.mjs` (the PTY session service alone). They use `--model haiku`, `--max-budget-usd 0.25`, an empty temporary working directory, `--setting-sources user`, `--strict-mcp-config` unless a connector is under test, and an environment without inherited `CLAUDECODE` and `CLAUDE_CODE_*` variables that keeps `CLAUDE_CONFIG_DIR`.

## Module map

| Path | Responsibility |
|---|---|
| `src/core/events` | Typed event bus and the `AppEvent` union |
| `src/core/store` | `openStore` (`node:sqlite`) and per-module migrations |
| `src/core/tree` | `TreeService` contract, `InMemoryTreeService`, shared contract tests |
| `src/core/commands` | `Command`, `CommandRegistry`, `Caller`, folder scope check |
| `src/core/surfaces` | `SurfaceType` interface (types only) |
| `src/core/profile` | Profile model, file store and registry, milestone 1 migration, `profileEnv`, tool files, partition names |
| `src/core/blocks` | Block manifest and layout schemas, `BlockRegistry`, presets, `docs/blocks.md` generator |
| `src/core/layout` | Layout files with hot reload, migrations, JSON Patch, diff, revision history and undo, layout commands |
| `src/core/context` | Shared context store per window |
| `src/core/session` | `SessionService` contract, `FakeSessionService`, `PtySessionService` (launches through an isolation provider) |
| `src/core/isolation` | `IsolationProvider` interface, `LocalProvider` (claude on the host), `FakeProvider` and the shared provider contract tests |
| `src/core/mcp` | App MCP server contract and `--mcp-config` shape |
| `src/core/inbox` | SQLite inbox and task stores, hook mapping, notifier, scheduler, `inbox_*`, `task_*` and `reminder_*` commands |
| `src/shared/ipc.ts` | IPC channel names and the `window.api` type |
| `src/shared/rendererApi.ts` | The `window.api` object, built over a minimal `ipcRenderer` interface |
| `src/main/index.ts` | App lifecycle, profile resolution, the single-instance lock per profile |
| `src/main/profileBoot.ts`, `profileLauncher.ts`, `profileHost.ts` | Profile, data directory and settings before `ready`; starting or focusing another profile; the seam between the profile module and the Electron process |
| `src/main/desktop.ts` | Notifications and the dock badge behind `Desktop`; records them in hidden runs |
| `src/main/windowCapture.ts` | Window capture with the mask for folder-scoped callers |
| `src/main/window.ts` | Main window |
| `src/main/windowPolicy.ts` | App frame URLs, `window.open` decision, web preferences |
| `src/main/ipc.ts` | `commands:invoke`, `commands:list`, event broadcast |
| `src/main/ipcPolicy.ts` | Which senders may call commands, and the answers for those that may not |
| `src/main/focusRequest.ts` | Recognises the focus request of a second start of a profile |
| `src/main/modules.ts` | Module init order: profile, tree, mcp, session, layout, inbox |
| `src/main/modules/*.ts` | One file per module, each owned by one builder |
| `src/preload/index.ts` | Exposes `window.api` (`invoke`, `listCommands`, `subscribe`) built by `src/shared/rendererApi.ts` |
| `src/renderer` | React UI: `App.tsx` and `layout/LayoutHost.tsx` (dockview behind `layout/dockviewAdapter.ts`, `layout/hostModel.ts` for titles, inputs and the engine sync decisions, the profile strip above it), pane blocks `panes/TreeBlock.tsx`, `panes/SurfaceHostBlock.tsx`, `panes/PlaceholderPane.tsx`, `panes/InboxPane.tsx`, `panes/ProfileRail.tsx`, the floating `panes/SetupPane.tsx` |
| `e2e` | Playwright tests against the built app |

`src/core` must not import Electron or anything from `main`, `preload` or `renderer`; a unit test enforces this.

## Dependencies

Only packages listed under `allowBuilds` in `pnpm-workspace.yaml` run lifecycle scripts. Read a package's install script before adding it there.

## License

Apache License 2.0. See `../LICENSE` and `../NOTICE`.
