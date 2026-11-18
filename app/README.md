# Agide

A personal macOS desktop tool for agentic coding: a task tree whose leaves are surfaces (Claude sessions, browser tabs, Slack threads), with an app-hosted MCP server so the agent can do what the UI can do, a layout that the user and agents edit, an inbox with tasks and reminders, and profiles that run side by side. Architecture and contracts: `../docs/decisions/0013-stage2-architecture-and-contracts.md`, `../docs/decisions/0023-milestone-2-architecture-and-contracts.md` and `../docs/decisions/0029-milestone-3-architecture-and-contracts.md`. What is built and verified: `../docs/decisions/0014-milestone-1-results.md`, `../docs/decisions/0024-milestone-2-results.md` and `../docs/decisions/0030-milestone-3-results.md`.

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
| `AGIDE_PERMISSION_MODE` | Test override of the permission mode of sessions that name none: `default`, `acceptEdits`, `plan` or `auto`. Without it a session starts in the profile's default mode, `auto` unless the profile settings say otherwise. `bypassPermissions` is accepted only per session, with a confirmation, inside a provider that limits files and the whole process's network. |
| `AGIDE_SESSION_CWD` | Working directory of sessions started from the tree. Defaults to `Agide/<folder id>` below the home directory, created with mode 0700. A directory inside the app root is refused. |
| `AGIDE_TASK_BASE` | Base directory of task starts (`worktrees/` and `sources/`). Defaults to `Agide` below the home directory. Used by the tests. |
| `AGIDE_SRT_BIN` | Path of the `srt` executable for the srt provider. Defaults to `srt` on `PATH`; the srt tests also look for the probe's install prefix and are marked unavailable without one. |
| `AGIDE_BROWSER_APPROVAL_TIMEOUT_MS` | How long a browser permission request waits for an answer. Default 115000. Used by the tests. |
| `AGIDE_E2E_COVERAGE_DIR` | Set by `pnpm coverage:e2e`: every launched app writes V8 coverage there. |

## Use

Right-click the tree to add folders and surfaces. "New Claude session" is offered inside a folder: it starts `claude` in a PTY and opens its terminal. Clicking a session leaf shows its terminal again; a session from an earlier run shows as exited with a Resume button. Every session gets the app MCP server through `--mcp-config`, a file with mode 0600 in the session's directory under `sessions/` (the bearer token is never a process argument). The app removes the file once the session has started (`SessionStart`) and writes it again on resume, and removes leftover session directories at start. The server is scoped to the session's folder, so the agent can change the tree below that folder. Its tool calls show the CLI's own permission prompt in the terminal when the mode or an ask rule asks.

## Permissions

"New Claude session" opens a dialog with the title, the working directory and the permission mode. The mode starts at the profile default (`auto` for a profile that never saved permission settings) and a session keeps it across resume. The profile settings panel, reached from the tree's background menu, holds the default mode with a sentence per mode, how each class of outward action is handled, the Bash sandbox with its host lists and the folder-trust setting. The setup pane of a new profile states what the default mode allows and that agents run as your user.

The network allowlist of the Permissions section is also the policy of a provider that limits the whole process: under srt it becomes the sandbox's allowed domains, next to the Anthropic hosts and loopback.

Every launch writes ask rules for outward-facing tools (GitHub writes, pushes, publishing, ssh, connector writes, unknown connector and MCP tools) into `--settings`, and replaces the app's `PreToolUse` hook with an inspector: `ELECTRON_RUN_AS_NODE=1 <app> inspect.js <gate file>`. The inspector splits a Bash command into its simple commands (compound commands, subshells, substitutions, quoting, variables, `sh -c`, wrappers such as `env` and `sudo`, git options such as `-C`), classes each one and answers `deny` or `ask` with the class named, or no decision so that the mode decides. It never answers `allow`. A command it cannot read is asked about, and so are shell forms that hide the program (`env -S`, git aliases, a dynamic `gh api graphql` query). Under bypass mode an ask becomes a deny, so bypass is refused when the inspector cannot run (a missing `inspect.js`, or the container provider, whose capability statement says that only the ask rules apply there). The inspector starts in about 70 ms per call. The inspector writes the payload with its decision into the session's inbox directory; a denial becomes an inbox item (`gate:deny`), an approval card names the class, and a sandbox block becomes a status item. `node --experimental-strip-types scripts/real-claude-gate.mjs` runs the real CLI against the gate after `pnpm build`.

The launch settings deny the CLI's Read and Edit tools on the app root; a shell command run by the agent is not covered, because local sessions run as the user.

A new working directory makes `claude` ask whether you trust the folder, with "No, exit" selected. The app watches the terminal for that question. With "Answer Claude's folder-trust question for folders the app creates" on (off by default), it answers Yes for a directory it created in that task start, after reading the latest screen. Otherwise, and for any directory you picked, it shows a banner above the terminal and an inbox item, and you answer in the terminal. Each Yes adds an entry to the login's `.claude.json`.

The session's mode is the mode it launched with; the app does not follow a Shift+Tab switch inside the terminal, because the hook payloads that report it lie in a directory the agent can write. Refusing a permission dialog with Escape interrupts the turn and fires no hook, so the session shows as waiting and its approval item stays open until the next hook.

## Profiles

Unless `AGIDE_USER_DATA` is set without `AGIDE_ROOT`, each profile runs as its own process with its own data directory, browser partitions and Claude configuration directory. The first start moves the milestone 1 data into the `default` profile and keeps its Claude login. Start a profile with `--profile=<id>`; a second start of a running profile focuses its window.

The rail at the left edge lists the profiles with their colour and unread count; a click opens or focuses the profile. "New profile" creates one with its own Claude directory and isolated tool credentials (gh, git, ssh, AWS, npm and Docker locations inside the profile, and only an allow list of inherited environment variables). The setup pane of a new profile opens a terminal in an empty `Agide/login-<profile id>` directory below the home directory (outside the app root, where sessions are refused) to sign in to Claude, checks the login with `claude auth status`, and asks for the git identity. Plain `ssh` and `scp` run by an agent still read your default keys; only git uses the profile's ssh config.

A profile reads of the other profiles only their definition (id, name, colour, creation time) and their entry in `registry/` in the app root: the profile id, the process id, a random id per start, the time of the last refresh and the unread count.

## Inbox, tasks and reminders

The inbox tab lists items that wait for you: approvals and idle prompts from Claude hooks, failed turns, posts from agents (`inbox_post`) and fired reminders. An approval item appears when a session asks for permission, notifies only when the dialog is still open after the CLI's own delay, and clears when the tool call runs. The detail card shows the project and session context and can peek at the session's terminal without focusing it. Agent text is shown as plain text. Unread items of normal or high urgency count towards the dock badge and the rail.

Agents use `inbox_post`, `inbox_list`, `inbox_resolve`, `task_create`, `task_list`, `task_update`, `reminder_create`, `reminder_list` and `reminder_delete`. Reminders take an RFC 5545 RRULE subset in a time zone; a rule above 48 occurrences a day is refused. Reminders missed while the app was closed fire at the next start: by default one item for the latest missed occurrence (`catchUp` `latest`), or one per occurrence (`each`), or none (`none`).

## Browser tabs and observation

"New Browser tab" in a folder adds a `browser-tab` leaf. Its tab chrome (back, forward, reload or stop, the address field with the host emphasised, the service badge, the observation control, Open in Chrome and a menu with copy URL, clear site data and DevTools) is drawn by the app above the page view, so a page cannot draw over the address or over a permission request. Only `http`, `https` and `about:blank` load; typed text that is not an address is refused, never searched. Each service (`jira`, `github`, `notion`, `slack`, `discord`, `web`) has its own persistent partition under the profile's data directory, and a link to another service opens a tab of that service next to the source. Pages get no permissions except fullscreen and sanitized clipboard writes.

Every session also gets the `agide-browser` MCP server (`/mcp/<session>/browser`), with the Claude in Chrome tool names: `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `computer`, `read_page`, `find`, `form_input`, `get_page_text`, `javascript_tool`, `read_console_messages`, `read_network_requests` and `browser_batch`. Sessions start with `--no-chrome`. The app server adds `surfaces_observe`, `surface_highlight` and `browser_open_in_chrome`. Every call checks the folder scope first and answers a tab of another folder like an unknown id; page content in a result starts with an "Untrusted page content" line.

Observation is a switch per tab (off, on demand, live) that only the user changes, from the tab chrome or the tree row indicator. Off refuses every page tool and `surfaces_observe`, lists the tab without URL or title, and draws a "not shared" mask in place of the tab in `ui_capture_window`. Slack and Discord tabs start off and never give page content. Clicking or typing in a page as an agent is an acting call: loopback addresses in `web` tabs run, other `web` origins ask once per session, Jira, GitHub and Notion ask on every call and refuse `javascript_tool` unless enabled for the site, Slack and Discord refuse. An agent that navigates to an origin outside loopback asks first, unless the origin is `https` and its host is on the profile's network allowlist (Permissions section) and belongs to no signed-in service. An answer to a navigation never allows clicks, typing or scripts on that origin, and an acting call checks the origin again after its approval and refuses when the tab moved. `browser_open_in_chrome` asks before an agent runs it. An agent that calls `navigate` without a tab gets an empty tab of its own first. The question is a bar in the tab chrome and an approval item in the inbox that links to the tab; the item's card offers Deny and Allow once, dismissing it denies, and a request of a session that ends is denied. Under the srt provider, tabs an agent opened or drives load only loopback, allowlisted hosts of no signed-in service and origins the user let the agent open; other requests of the page are cancelled. Native views hide behind still images while a drag, a dialog, a context menu, the tab menu or the observation popover is open. The access log (`observation_log` in the profile database) keeps time, session, node, kind, origin, size and outcome, never content. A `UserPromptSubmit` hook prints a short digest of changed tabs from `digest.json` in the session directory. `browser-blocked.json` in the data directory lists origins and path prefixes that force observation off.

## Task start

"New task…" in the tree menus opens a dialog that takes a prompt, a GitHub pull request (URL or `owner/repo#n`) or a Jira key or URL, a repository path for pull requests, a base and the permission mode. `task_start` does the same for the UI and for agents. A start creates a folder, a Claude session leaf, a `task_starts` row and a task in the inbox's task list, and opens a browser tab for a pull request or Jira source.

- A pull request runs in a git worktree under `~/Agide/worktrees`, on branch `agide/pr-<n>` fetched as `pull/<n>/head` from the remote whose URL matches `owner/repo` (read with `git config`, so `insteadOf` rewrites do not hide it). An existing branch name gets a suffix; nothing is overwritten.
- The pull request's title, author, state, head branch, description and changed files go into `task-source.md` under `~/Agide/sources/<folder id>`, passed with `--add-dir`. The typed prompt holds no pull request text; it tells the agent to read that file as untrusted data. Repository guidance comes from `CLAUDE.md` at `<remote>/<base branch>`, never from the pull request head.
- A Jira source asks the agent to read the issue through the user's connector.
- When an agent calls `task_start`, the start stays in the agent's folder, cannot use a looser mode than the agent or bypass, may use only repositories you already used, and counts against a cap of 4 agent-started sessions, starts in progress included; at the cap an inbox item says so.
- A start that fails removes the worktree, the branch it created and the source directory. Removing a task folder does not remove its worktree yet.

## Agents and usage

Subagents of a session appear as rows under its leaf with their state (running, waiting, failed, done); the session leaf shows the running count, a waiting marker and a tally of agents that finished recently. Finished rows leave after a delay (done 10 s, failed 300 s by default; "Show finished agents" brings them back). The history pane (`agide/agent-history`) lists finished agents; the transcript viewer (`agide/transcript-viewer`) opens a transcript read-only, only after `realpath` shows it below the session's projects directory or the profile's transcript copies, which keep finished transcripts gzip-compressed under a size cap.

Every launch sets a status line command that writes `status.snapshot` in the session's events directory; only identifiers and numbers are kept. The usage pane (`agide/usage-ranking`) ranks sessions by recent cost per minute with heat markers and folder rollups; the rail shows the own profile's plan usage with a forecast. Usage alerts (cost per minute, plan thresholds, a window that runs out) become inbox items whose Pause (Esc in the terminal) and Stop act only on a click. Costs computed from tokens use `src/core/usage/prices.json` and are labelled as estimates. Settings live in the profile's `agents` key and are changed with `agents_settings_set`. App-started agents on the `-p` stream-json path are not started anywhere yet; their adapter runs on fixtures.

## Isolation providers

The Isolation section of the profile settings lists the providers with their check and what each limits:

- `local` (default): `claude` on the host as your user.
- `srt`: Anthropic's sandbox runtime, installed by you (`srt` on `PATH` or `AGIDE_SRT_BIN`). The launch is `srt -s <settings> -- claude …` with settings generated per session: writes only to the workspace, the hook directory, the CLI's temporary directory and the Claude configuration (its settings, `CLAUDE.md`, commands, agents, skills, plugins and hooks denied); network only to the Anthropic hosts, loopback and the profile allowlist; `allowPty` for the terminal and `allowLocalBinding` for the app's MCP server, which opens every loopback port to the agent. The Keychain stays readable and `.claude.json` writable. Bypass mode is offered only here.
- `container`: Docker, one `docker run -it --rm --init` per launch with mounts at the same paths and the gh directory read-only. It is listed with its statement and cannot be chosen, because no real `claude` has run in it; it has no network policy and the inspector hook cannot run inside it.

`isolation_status` and `isolation_set_provider` are UI commands, not MCP tools, so an agent cannot choose its own isolation.

## Layouts

The window shows a layout: `layouts/<id>.json` in the data directory, or a shipped preset (`session`, `pair`). Both presets place the profile rail at the left edge, the task tree, the surface host and the inbox as a tab beside the surface. Editing the file while the app runs changes the window; an invalid file keeps the running layout, shows the errors and is not rewritten until it is valid again. `window-layout.json` names the layout of the window. Every change is a revision in the app database, and Undo applies the previous one as a new revision. Agents use `blocks_list`, `layout_get`, `layout_validate`, `layout_apply`, `layout_undo`, `layout_switch`, `ui_open_to_side` and `ui_capture_window`; an agent changes a layout only while the focused node lies in its folder, and its captures mask the tree, the inbox and the rail. The formats are in `../docs/blocks.md`.

## Test

```sh
pnpm typecheck    # tsc over the Node side (core, main, preload, e2e) and the renderer
pnpm test         # Vitest unit tests of src/core, src/main, src/shared and the renderer logic (Node, jsdom for hooks and panes)
pnpm coverage     # the unit tests with V8 coverage; thresholds on src/core, src/main, src/main/modules, src/shared and the renderer logic files; report in coverage/
pnpm e2e          # builds, then launches the app hidden with Playwright
pnpm mutation     # breaks each security decision once (folder scope, navigation schemes, inspector rules, redaction, observation switch) and fails when no unit test notices; `pnpm mutation <name fragment>` runs a subset
pnpm coverage:e2e # builds with source maps, runs the end-to-end tests and prints the coverage of the renderer and the main process; report in coverage-e2e/
pnpm parity       # every UI-bound command is an MCP tool or states an exemption; writes ../docs/parity.md
pnpm blocks-docs  # writes ../docs/blocks.md from the manifest and layout schemas
pnpm check        # typecheck, unit tests and end-to-end tests
```

The Electron entry points hold no decisions: which frames may call commands, the window open and navigation policy, the web preferences, the focus request and the `window.api` object come from small functions (`src/main/ipcPolicy.ts`, `src/main/windowPolicy.ts`, `src/main/focusRequest.ts`, `src/shared/rendererApi.ts`) that the unit tests cover, including the foreign-frame, subframe, other-origin and `window.open` cases. `src/main/ipc.ts` and `src/main/window.ts` are tested against a mocked `electron` module. Renderer tests that need the DOM start with `// @vitest-environment jsdom` and use `src/renderer/testing` (a fake `window.api` and a render helper). Panes that load an engine with a canvas (the terminal) are tested with the engine mocked.

`pnpm coverage:e2e` measures what the end-to-end tests reach: `page.coverage` for each window and `NODE_V8_COVERAGE` for the main process, mapped to `src` through source maps and merged by `monocart-coverage-reports`. It prints functions, branches and lines per area and is not a CI gate. `e2e/coverageHook.ts` is active only when `AGIDE_E2E_COVERAGE_DIR` is set. `--reuse` rebuilds the report from the raw data of the last run.

`pnpm mutation` (`scripts/mutation-checks.mjs`) edits one source line at a time, runs the unit tests that guard it and restores the file afterwards, also on Ctrl-C. A mutation counts as killed only when a test fails; a suite that does not load does not count. A new security decision gets an entry in the script's list.

The browser view placement (`src/main/browser/viewPlacement.ts`: bounds scaling, eviction, download attribution), the navigation guards (`guards.ts`), the inspector command (`src/core/permissions/inspectCommand.ts`) and the blocked-address file parser (`src/core/browser/blocked.ts`) are pure or take their inputs as arguments, so their negative cases run in Vitest. `src/main/browser/ElectronViews.ts` is tested against a mocked `electron` module with fake views, windows and sessions.

Tests that call the real `claude` CLI are scripts outside these commands: `pnpm e2e:real-claude` (the whole app with a session that creates a folder through the app MCP server), `pnpm e2e:real-claude-inbox` (a session that posts an inbox item with `inbox_post`; the item shows in the inbox pane), `pnpm e2e:real-claude-m3` (a session in auto mode reads and clicks a local page through the `agide-browser` tools, then the push it is asked to run meets the `Bash(git push *)` ask rule and the script refuses it in the terminal), `pnpm e2e:claude-mcp` (the MCP server with `claude -p`) and `node scripts/smoke-real-claude.mjs` (the PTY session service alone). They use `--model haiku`, `--max-budget-usd 0.25`, an empty temporary working directory, `--setting-sources user`, `--strict-mcp-config` unless a connector is under test, and an environment without inherited `CLAUDECODE` and `CLAUDE_CODE_*` variables that keeps `CLAUDE_CONFIG_DIR`.

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
| `src/core/isolation` | `IsolationProvider` interface, `LocalProvider` (claude on the host), `SrtProvider` (Anthropic's sandbox runtime), `ContainerProvider` (Docker), `FakeProvider`, capability statements, the `isolation_*` commands and the shared provider contract tests. The srt and container tests run where `srt` (`AGIDE_SRT_BIN`) and Docker with a local `alpine:latest` exist and are marked unavailable elsewhere |
| `src/core/mcp` | App MCP server contract and `--mcp-config` shape |
| `src/core/inbox` | SQLite inbox and task stores, hook mapping, notifier, scheduler, `inbox_*`, `task_*` and `reminder_*` commands |
| `src/core/permissions` | Permission modes and mode resolution, the action class table, permission settings, the policy builder, the launch contributor, the hook inspector with its shell parser and classifier, and the inspector entry script (0028) |
| `src/core/browser` | Browser tab state, service table, URL recognizer, address policy, site table, redaction, digest, the CDP page session and the hosted tools, observation switches and access log (0026) |
| `src/main/browser` | `WebContentsView` registry and parking, partitions and guards, CDP transport, capture composition, Open in Chrome |
| `src/core/agents` | Agent facts, the hook, stream-json and transcript adapters (`normalise/`), the agent stores (memory, SQLite), removal timers, the controller that feeds store and usage, transcript viewer and copies (0027) |
| `src/core/usage` | Price table, rate buffers, `UsageEngine` (totals, rates, ranking, plan usage and forecast), the status line command and snapshot parser, `SessionWatcher` (status snapshot and transcript tailing), alert evaluator, folder rollups (0027) |
| `src/core/tasks` | Task sources and the strict source parser, the prompt composer, the pull request reader over `gh`, the git working directory manager, task start, the `task_starts` store, folder-trust detection and answer (0028) |
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
| `src/main/modules.ts` | Module init order: profile, tree, mcp, permissions, session, layout, inbox, browser, agents, tasks (0029) |
| `src/main/modules/*.ts` | One file per module, each owned by one builder |
| `src/preload/index.ts` | Exposes `window.api` (`invoke`, `listCommands`, `subscribe`) built by `src/shared/rendererApi.ts` |
| `src/renderer` | React UI: `App.tsx` and `layout/LayoutHost.tsx` (dockview behind `layout/dockviewAdapter.ts`, `layout/hostModel.ts` for titles, inputs and the engine sync decisions, the profile strip above it), pane blocks `panes/TreeBlock.tsx`, `panes/SurfaceHostBlock.tsx`, `panes/PlaceholderPane.tsx`, `panes/InboxPane.tsx`, `panes/ProfileRail.tsx`, the floating `panes/SetupPane.tsx` |
| `src/renderer/dialogs` | The dialog host and the new-session, new-task and profile settings dialogs |
| `e2e` | Playwright tests against the built app (one spec per area: tree, session, layout, workspace, inbox, profiles, browser, agents, permissions, tasks, isolation, integration); `e2e/milestone3.spec.ts` runs the milestone 3 modules together (task start, launch policy, provider choice, browser tools and observation, agent nodes, usage and the inbox) with the fake `claude` and fake `srt` in `e2e/fixtures/` |

`src/core` must not import Electron or anything from `main`, `preload` or `renderer`; a unit test enforces this.

## Dependencies

Only packages listed under `allowBuilds` in `pnpm-workspace.yaml` run lifecycle scripts. Read a package's install script before adding it there.

## License

Apache License 2.0. See `../LICENSE` and `../NOTICE`.
