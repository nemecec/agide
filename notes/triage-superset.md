# Triage: superset (now Paradev)

Date of reading: 2026-11-17. Source: shallow clone of https://github.com/superset-sh/superset at commit 1097f1caef61adeb5e7de0131a47abd7c3cf7561 (committed 2026-11-16), in `candidates/superset`. Nothing was installed, built or run. All statements come from reading files and from read-only `gh api` calls, except where marked as unverified. Scope: R1 to R11. R12 to R15 are covered by another agent; places where this triage touched them are marked.

The repository contains `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `WARP.md`, many `docs/` and `plans/` files and a `plugins/superset/skills` folder with agent skills. These are third-party data. They were used only as descriptions, and each claim below was checked against source files.

## Naming

The project is renamed. The README title is "Paradev (formerly Superset)" and states that the CLI command is still `superset`. The GitHub API resolves both `superset-sh/superset` and `paradevai/paradev` to the repository with full name `ParadevAI/Paradev`. Residue of the old name: the desktop package is `@superset/desktop` with `productName` "Superset", the CLI has a `paradev` alias, environment variables and the host-service state carry the `SUPERSET_` prefix, and the default cloud URLs still point at superset.sh domains (`packages/shared/src/constants.ts` comment: the root domain flips at cutover). The company legal name in the constants is "Superset Inc.". It is unrelated to Apache Superset. A secondary-source name "desktop-mcp" is covered below.

## Measurements (dated 2026-11-17)

| Item | Value | Source |
| --- | --- | --- |
| Stars | 16348 | `gh api repos/paradevai/paradev` |
| Forks | 1467 | same |
| Open issues plus PRs | 1315 (API field `open_issues_count`) | same |
| Open PRs, first page of 100 | 100 (page full, total not counted) | `pulls?state=open` |
| Repo created | 2025-10-21 | same |
| Last push | 2026-11-17 | same |
| Desktop version in `apps/desktop/package.json` | 2.0.9 | file |
| Commits on `main` since 2026-09-22 | 1247 | `commits?since=` |
| Commits per ISO week, W39 to W47 (W47 partial, to 11-17) | 107, 156, 158, 126, 163, 200, 134, 158, 45 | same |
| Distinct commit authors in window | 37 (includes bot accounts) | same |
| Top authors in window | 450, 442, 158, 96 | same |
| Bot accounts in window | 32 and 25 commits | same |
| All-time contributions, top six | 2737, 1836, 518, 183, 34, 32 | `contributors` |
| Desktop stable releases since 2026-10-02 | v1.34.0 and v1.35.0 10-02, v1.36.0 10-06, v1.37.0 10-08, v1.38.0 10-14, v1.39.0 10-19, v1.40.0 10-23, v2.0.0 10-26, v2.0.2 10-29, v2.0.3 11-01, v2.0.4 11-04, v2.0.5 11-05, v2.0.6 11-08, v2.0.7 11-09, v2.0.8 11-10, v2.0.9 11-15 | `releases` |
| Canary | rolling tag `desktop-canary`, last published 2026-11-17 | same |
| CLI releases | `cli-v*` tags alongside the desktop tags | same |
| PR open-to-merge time, 51 merged of 60 most recently updated closed PRs | median 0.37 h, 90th percentile 5.1 h | `pulls?state=closed` |
| Author association of those merged PRs | 34 `COLLABORATOR`, 16 `MEMBER`, 1 `CONTRIBUTOR` | same |
| Non-PR issues created since 2026-10-25 | 4; 4 have comments; 1 closed | `issues?since=` |
| First comment delay on those 4 issues | about 1 to 2 minutes each, author association `CONTRIBUTOR` | per-issue comments |
| Commits since 2026-09-22 under `apps/desktop/.../_dashboard/components/DashboardSidebar` | 88 | `commits?path=` |
| Same, `.../DashboardSidebar/hooks/useSidebarDnd` | 0 | same |
| Same, `.../providers/CollectionsProvider` | 13 | same |
| Same, `packages/host-service/src/tag-folders` | 1 | same |
| Same, `packages/host-service/src/trpc/router/panes` | 4 | same |
| Same, `.../components/DashboardNewWorkspaceModal` | 54 | same |
| Same, `packages/host-service/src/trpc/router/workspace-creation` | 25 | same |
| Same, `packages/agent-setup` | 22 | same |
| Same, `packages/host-service/src/terminal-agents` | 9 | same |
| Same, `packages/host-service/src/chat-v3` | 31 | same |
| Same, `packages/mcp` | 33 | same |

Exact dependency versions read from `apps/desktop/package.json` and `packages/mcp/package.json`: Electron 44.10.0, React 19.3.0, Zustand 5.0.12, `@tanstack/react-db` 0.1.95, drizzle-orm 0.45.2, better-sqlite3 12.11.1, node-pty 1.2.0-beta.14, `@xterm/xterm` 6.1.0-beta.315, CodeMirror 6 packages, Tiptap 3.30.5, `@pierre/diffs` 1.6.2, `@dnd-kit/core` 6.3.1 and `@dnd-kit/sortable` 10.0.0 (react-dnd is also used for the shell), `@agentclientprotocol/claude-agent-acp` 0.107.0, `@agentclientprotocol/codex-acp` 2.1.0, `@modelcontextprotocol/sdk` 1.32.0 (in `packages/mcp` only), electron-updater 6.8.3. The build uses Bun and a Turborepo monorepo.

Reading of the activity numbers: several authors share the recent commits, the pace is high, merges by team members take hours and releases come every few days. The issue sample is very small (see table) and the first comments arrive within minutes from a `CONTRIBUTOR` account; an automated triage workflow exists (`.github/workflows/triage-issue.yml`) but was not read, so whether these are bots is not known. Low confidence on issue response time.

## 2. License

`LICENSE.md` starts with:

```
MIT License

Copyright (c) 2025-2026 Superset Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, ...
```

The text is the standard MIT License. The README states "released under the MIT License".

Other checks:
- No other file named LICENSE, COPYING or NOTICE exists outside the root `LICENSE.md` (find over the clone, excluding `node_modules`).
- No `ee` or `enterprise` directory exists.
- The root `package.json`, `packages/sdk/package.json` and `plugins/superset/plugin.json` say MIT. Other workspace `package.json` files carry no license field.
- `CLA.md` (adapted from the Apache ICLA) and `.github/workflows/cla.yml` exist. The CLA binds contributors to upstream, not users of a fork. It matters only if a fork sends patches upstream.
- MIT carries no trade name clause. The brand names Paradev and Superset, the icons and the domains are the company's. A distributed fork needs its own name and icon as a matter of courtesy and trademark law; not checked beyond the file.
- The ACP adapters `claude-agent-acp` and `codex-acp` are separate npm packages; their licenses were not checked.

Conclusion: a private fork is allowed.

## 3. Architecture

Paths are relative to the repository root unless stated.

Process layout:
- Electron main process: `apps/desktop/src/main/` (entry `index.ts`, windows in `windows/main.ts`).
- Preload: `apps/desktop/src/preload/`.
- Renderer: `apps/desktop/src/renderer/`, React 19, TanStack Router (file routes under `routes/`), Zustand stores, TanStack DB local collections, tRPC over Electron IPC to the main process (`apps/desktop/src/lib/trpc/`).
- Host service: `packages/host-service`, a Hono server on 127.0.0.1 (`src/serve.ts` sets hostname 127.0.0.1 outside sandboxes) with a tRPC router in `src/trpc/router/`. It owns workspaces, git, terminals, chat, filesystem watching and pull requests. The desktop spawns, adopts and supervises it (`apps/desktop/src/main/lib/host-service-coordinator.ts`, `host-service-manifest.ts`). Endpoint and bearer token are in a manifest file that the `superset` CLI reads (`packages/cli/src/lib/host-api-token.ts`). `docs/HOST_SERVICE_ARCHITECTURE.md` says the host service must not know about Electron; a test (`no-electron-coupling.test.ts`) enforces it.
- PTY daemon: `packages/pty-daemon`, a separate process that holds node-pty sessions so terminals survive an app restart; the host service talks to it through `packages/host-service/src/terminal/DaemonClient` and `src/daemon/`.
- Desktop bridge: an express and WebSocket server in the main process (`apps/desktop/src/main/lib/browser/browser-bridge.ts`). Only the host service holds its secret. It carries pane layout operations and browser pane control from the host service to the renderer.
- Cloud apps in the same monorepo: `apps/api` (Next.js, includes the MCP route), `apps/relay`, `apps/realtime`, `apps/web`, `apps/mobile`, `apps/agent-worker`. They are not needed to read the desktop code and are the cloud side of section 9.

State and persistence:
- Host database: SQLite (better-sqlite3, drizzle) in the host service, schema in `packages/host-service/src/db/schema.ts`. Tables include `projects`, `workspaces`, `workspaceTags`, `tagFolderSettings`, `terminalSessions`, `terminalAgentBindings`, `pullRequests`, `hostAgentConfigs`, `hostSettings`.
- Renderer state: TanStack DB collections backed by `localStorage`, one set per organisation id (`apps/desktop/src/renderer/routes/_authenticated/providers/CollectionsProvider/collections.ts`). They hold sidebar projects, sidebar sections, per-workspace local state (including the pane layout), terminal presets and user preferences. Schemas are in `.../CollectionsProvider/dashboardSidebarLocal/schema.ts`. A read-heal wrapper deletes rows that fail to parse.
- Reads of projects and workspaces fan out to every known host; the local host answers live and offline. The source comment in `renderer/hooks/host-projects/useHostProjects/useHostProjects.ts` says "Projects are fully local - there is no cloud source".
- Chat sessions: `packages/host-service/src/chat-v3/` plus `packages/chat-runtime`, `packages/chat`, `packages/chat-ui`.

Where sessions and workspaces are modelled:
- A workspace is a git worktree (or the project checkout, or a projectless "session") held in the host database and shown as one leaf in the sidebar. Inside a workspace the user opens tabs and split panes. A pane has a `kind` and free-form `data` (`packages/panes/src/types.ts`). Pane kinds are registered in one object in `apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/usePaneRegistry.tsx` (file, diff, terminal, browser, files, changes-list, review, pages-list, mobile, comment, pull-request, page, devtools).
- A coding agent session is therefore a terminal pane (PTY) or a chat pane inside a workspace; the agent binding is in `terminalAgentBindings` and the in-memory store `packages/host-service/src/terminal-agents/`.
- Tasks in the product sense are cloud records (`packages/trpc/src/router/task`); the host service calls `api.task.start` and `api.task.byId`. They are separate from workspaces.

Where the left sidebar is implemented (`apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/DashboardSidebar/`):
- `DashboardSidebar.tsx` composes the sections: Sessions (projectless workspaces), a favourites section, Projects, Channels, Devs.
- `providers/DashboardSidebarDndProvider`, `hooks/useSidebarDnd/useSidebarDnd.ts` (a long hook) and `sectionUnits.ts`: drag and drop on `@dnd-kit` with drop zones per lane. Sessions reorder, move into and out of folders, and folders drag as units.
- `components/DashboardSidebarProjectSection/`, `DashboardSidebarSessionsSection/`, `SortableSectionHeader/`, `SortableWorkspaceItem/`, `DashboardSidebarWorkspaceItem/`.
- Data: `hooks/useProjectTagFolderSections`, `hooks/useDashboardSidebarData`, and the folder helper `routes/_authenticated/utils/workspaceTagFolders`.
- Folder model: `dashboardSidebarSectionSchema` ("sections are flat and project-scoped" in the source comment). A folder is either a legacy renderer-side section (membership in `sidebarState.sectionId` of the workspace local state) or a tag-backed folder, a `(scope, tag)` pair whose membership is the workspace tag list in the host database (`packages/host-service/src/tag-folders/`, `workspaceTags`, `packages/shared/src/workspace-tags.ts`). Scope is a project id or the Sessions lane. An older sidebar (`renderer/screens/main/components/WorkspaceSidebar/`) still exists for the previous workspace model.

## 4. How the agent CLI is launched

Default path is the interactive CLI in a PTY.
- Builtin terminal agents are listed in `packages/shared/src/builtin-terminal-agents.ts`. Claude: command `claude --dangerously-skip-permissions`, resume `claude --dangerously-skip-permissions --resume`, fork `... --resume {sessionId} --fork-session`, and a non-interactive command `claude --strict-mcp-config -p`. The same file lists Amp, Codex, Gemini, Kimi, OpenCode, Pi, Cursor Agent, Copilot, Droid, Grok, Kiro and others. Gemini and Kimi are therefore present without extra work. Users can edit the commands in settings (`AgentFormControls.tsx`).
- The initial prompt is passed as a positional argument (`promptTransport` defaults to `argv` in `packages/shared/src/agent-definition.ts`; composition in `apps/desktop/src/renderer/lib/agent-launch-command.ts`). The command is started in a workspace terminal through the host service (`initialCommand` on `terminal.createSession`).
- A wrapper script named `claude` in an app-managed bin directory that is put on the terminal PATH finds the real binary and runs `exec "$REAL_BIN" "$@"`, adding only environment variables (`packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts`, `agent-wrappers-common.ts`). Arguments pass through unchanged. `CLAUDE_CONFIG_DIR` is forwarded for secondary accounts.
- No `--mcp-config`, `--settings`, `--setting-sources`, `--bare` or `stream-json` appears in the repository (grep over `apps` and `packages`). The only `-p` use is the `nonInteractiveCommand`; it is used for generating workspace names (`packages/host-service/src/trpc/router/workspace-creation/utils/ai-workspace-names.ts`) and for cloud automations. The interactive path does not depend on `claude -p`. Whether the naming call is affected by a `--bare` default for `-p` is not verified.
- Authentication is whatever the installed `claude` already has. The app does not read claude.ai credentials.

Hooks (status tracking):
- `createClaudeSettingsJson` merges hook entries into the real `~/.claude/settings.json` (path from `getClaudeGlobalSettingsJsonPath`; `ensureClaudeManagedHooksAt` does the same under `CLAUDE_CONFIG_DIR` for secondary accounts). Events: SessionStart, SessionEnd, UserPromptSubmit, Stop, StopFailure, SubagentStart, SubagentStop, PostToolUse and PostToolUseFailure with matcher `*`, PermissionRequest with matcher `*`. A PreToolUse guard for the tool named `Artifact` is also installed. Entries are recognised by the notify script path; a removal function exists (`removeClaudeManagedHooks`) and a per-agent disable list (`disabled-agent-hooks.ts`).
- The hook script posts the event to the host service (`SUPERSET_HOST_AGENT_HOOK_URL`, no auth token by design per a source comment in `packages/host-service/src/terminal/env.ts`) or to the desktop. Environment variables identify the workspace and the terminal.
- The PostToolUse and PermissionRequest events carry tool call data to the app. This is relevant to R13 (observation of sessions) and is noted for the agent covering that requirement.

MCP written to the CLI's config:
- `packages/agent-setup/src/managed-mcp-servers.ts` writes the MCP servers of installed Paradev plugins into `~/.claude.json` (also Codex TOML and the app's own agent config), with a ledger file that records which keys it wrote so it reaps only its own entries. This is a working mechanism for delivering an app-hosted MCP server to Claude sessions (S3), global to all sessions.

Chat transport (second, optional):
- `packages/host-service/src/chat-v3/` runs agents over ACP with the catalogue in `acpCatalogue.ts`: `claude-acp` (adapter `@agentclientprotocol/claude-agent-acp`, `CLAUDE_CODE_EXECUTABLE` set to the host `claude`), `codex-acp`, `gemini` (`gemini --acp`), `opencode`, `pi`, and `pdev acp` (Paradev's own agent, bundled). The Claude adapter is built on the Agent SDK per its package description; this path conflicts with the decision that the tool does not use the Agent SDK. It is optional per agent; which transport the Claude agent uses by default in the current build was not determined (all builtin agents in `builtin-terminal-agents.ts` have kind `terminal`). Whether `--bare` affects the adapter's CLI child is not verified.

Agent presets: `pdev` is the vendor's own agent; it is not needed.

## 5. Slice analysis

Effort figures are working days for one engineer plus agents, from code reading only.

### S1 nested folder tree with drag and persistence: about 8 days

State today: folders exist and are flat and project-scoped. Sessions (projectless workspaces) can be filed into folders and folders drag as units, with persistence in the host database for tag-backed folders and `localStorage` for legacy sections and order.

Files that change:
- `packages/host-service/src/db/schema.ts` and `drizzle/` migrations: a parent reference and order for `tagFolderSettings` (today keyed by scope and tag, with `displayName`, `color`, `tabOrder`); `packages/host-service/src/tag-folders/tag-folder-store.ts` and `trpc/router/tag-folders/tag-folders.ts` for create, rename, move and delete with cycle checks.
- `packages/shared/src/workspace-tags.ts`: tags are normalised, lowercased, limited in length and per-workspace count; a tree needs a path or parent id convention.
- `.../providers/CollectionsProvider/dashboardSidebarLocal/schema.ts` and `collections.ts`: section rows gain a parent; the read-heal wrapper deletes rows that fail parsing, so schema changes must stay backward compatible.
- `.../DashboardSidebar/hooks/useSidebarDnd/useSidebarDnd.ts`, `sectionUnits.ts`, `SortableSectionHeader`, `SortableWorkspaceItem`, `DashboardSidebarProjectSection/*`, `DashboardSidebarSessionsSection`: drop targets above, below and inside a folder, indentation, collapse state, drag of a subtree.
- `useMigrateLegacySidebarFolders` and `workspaceTagFolders` for the legacy and tag-backed folder representations.

Extension point: the tag-backed folder store is a clean seam on the host side and is already reachable through the host tRPC router. The sidebar itself is a fixed set of sections, not a registry of leaf types.

Constraints: a workspace belongs to one project (or the Sessions lane), and folders are scoped to a project or to Sessions. A user tree across projects needs either a single user-level scope or a layer that references workspaces across scopes. Browser tabs and Slack threads are not workspaces; leaf types for them are an R12 question for the other agent.

Risk: the DnD hook is large and the sidebar directory sees steady commit traffic (table), though the DnD hook directory itself had none since 2026-09-22. The plan's stop rule (more than 3 days on S1 marks the sidebar hard to change) is likely to trigger.

### S2 start a task from a prompt, a PR URL and a Jira key: about 3 days

State today:
- Prompt: works. New workspace screen and form in `apps/desktop/src/renderer/routes/_authenticated/components/DashboardNewWorkspaceModal/` (`NewWorkspaceScreen`, `useSubmitWorkspace`), draft store `renderer/stores/new-workspace-draft.ts`, host procedure `packages/host-service/src/trpc/router/workspace-creation/`. "No project" creates a session. Docs: `apps/desktop/docs/V2_LAUNCH_CONTEXT.md`.
- PR: the draft holds a `LinkedPR`. A PR is searched and chosen in the form; the host procedure `search-pull-requests.ts` accepts a pasted URL, a `#123` or a bare number, and direct-looks-up the number when the URL matches the project's repository (`normalize-github-query.ts`); a URL from another repository is flagged `repoMismatch`. The workspace checkout of a PR branch exists in `workspaces.ts` (PR number, head ref, fork fields). `renderer/lib/github/pullRequestRef.ts` parses PR URLs. Needed: parse a pasted URL on its own, map owner and repository to a project by remote, and start the task without the picker. About 1.5 days.
- Jira: no Jira code exists (grep over `apps` and `packages`). Linked issues come from GitHub, Linear and internal cloud tasks (`LinkedIssue.source`). With the connector-only decision, the route is a key field or key detection in the prompt that adds an instruction for Claude to read the ticket through the claude.ai Atlassian connector. About 1 day. Whether connector tools are available inside the PTY session is not verified (probe P2).
- Starting from a task record calls `api.task.start` on the cloud API; with no cloud it must be skipped (about 0.5 day, see S3 and section 9).

Extension point: `LinkedIssue` and `LinkedPR` in the draft store, prompt composition in `renderer/stores/new-workspace-prompt-context/` (fetchers per source) and `apps/desktop/src/renderer/lib/agent-launch-command.ts`.

### S3 UI parity through a local MCP server: about 7 days

State today: the cloud MCP server does not control the app window (section 6). The app has a different agent-facing surface: the `superset` CLI, which calls the local host-service tRPC router and, for pane and browser operations, the desktop bridge. Skills for agents are shipped in `plugins/superset/skills/` (panes, browser, computer, page, orchestrate) and use `Bash(superset:*)`.

Already available through host tRPC (and CLI):
- Open a file, changes, files list, pages or a browser in the right sidebar: `panes.open` with `tool`, `path`, `line`, `url`, `background` (`packages/host-service/src/trpc/router/panes/panes.ts`). Also pane `split`, `newTab`, `focus`, `close`, `move`, `swap`, `resize`, `equalize`, `sidebar`.
- Browser pane control: `browser.open`, `navigate`, `reload`, `screenshot`, `eval`, `console`, and a raw CDP WebSocket route (`trpc/router/browser/browser.ts`, bridge in `browser-bridge.ts`). Relevant to R15; not assessed here.
- Start a task or workspace: `workspaces.create*`, `workspace-creation`, `sessions.create`, `sessions.send`, `terminal` procedures.
- Folders and moves for tag-backed folders: `tagFolders.upsert` and `delete`, and `workspace.update` with `tags`.

Missing:
- Folder operations for legacy renderer-side sections (they live in `localStorage`; no host procedure reaches them), a move that works across the whole tree after S1, and a highlight or reveal of a sidebar item (no op found in `packages/shared/src/pane-layout-ops.ts`).
- An MCP server. `@modelcontextprotocol/sdk` 1.32.0 is already a dependency of `packages/mcp` and is not used by the desktop or the host service.

Work:
- An MCP endpoint in the host service (Streamable HTTP on 127.0.0.1, bearer token from the manifest, Origin check) or a stdio shim started by the CLI, as a thin layer over the existing tRPC procedures: about 3 days including tests.
- Delivery to Claude sessions: reuse the managed-MCP writer and ledger in `packages/agent-setup/src/managed-mcp-servers.ts` (global `~/.claude.json`), or add per-session arguments; about 1 day. Permission allow rules for the new tools in the CLI's permission model are not handled by the app (the default Claude command runs with `--dangerously-skip-permissions`).
- New bridge operations and renderer handlers for reveal and highlight, and for folder moves after S1: about 2 days.
- Parity table of UI actions against tools: about 1 day.

### S4 context attach (file, selection, agent message, image): about 5 days

State today:
- Chat composer (`packages/chat-ui`, Lexical): drop and paste of images and files as attachments (`PromptInputAttachment`), file mentions, slash commands; the host stores attachments locally (`trpc/router/attachments/`, `resolveAttachment.ts`), and a cloud import path exists but local bytes are served from the host store.
- Terminal pane: clipboard files and images are shipped to the workspace and the paths pasted into the TUI (`TerminalPane.tsx`, remote image paste block). New-workspace launch writes attachments to `<worktree>/.superset/attachments/`.
- Diff and review comments can be sent to a running agent session: `useSendToTerminalAgent`, `packages/host-service/src/terminal-agents/send-to-agent.ts`; for a terminal session the text goes through the terminal write path, for a chat session through `promptChatSession`.
- Not found: attach an editor selection from the file pane, attach an agent message, attach an image from an annotation tool.

Work: actions in the file pane and chat transcript that format a payload and call the existing send path; a composer strip for terminal sessions that have no composer. About 5 days. Image annotation (R3) would feed the same path.

## 6. Existing MCP

- The MCP server is cloud-hosted: `packages/mcp` (server and tools) is served by `apps/api/src/app/mcp/route.ts` (alias `/api/v2/agent/mcp`), documented at `https://api.superset.sh/mcp`. `packages/mcp/docs/ROADMAP.md` calls it stateless Streamable HTTP.
- Authentication: `packages/mcp/src/auth.ts` verifies an API key (`sk_` prefix), an OAuth token (better-auth) or a sandbox credential against the cloud database and organisation tables. Without a Paradev account there is no token and the server is not reachable. No local-only mode exists in this package.
- Tool families in `packages/mcp/src/tools/`: agents, automations, hosts, organization members, pages, projects, tasks, terminals (create, list, read, send, close), workspaces (create, list, update, delete). Tools reach a user's machine through the relay and the host service tRPC (`host-service-client.ts`, `workspace-service-target.ts`). The server instructions describe tasks, worktrees, agent sessions, terminals and automations.
- No tool controls the app window, the sidebar, folders, panes, the browser or files in the editor.
- Without an account, the host-service tRPC surface and the `superset` CLI work against the local host (the CLI resolves a host token from the manifest first, `packages/cli/src/lib/resolve-auth.ts`); this was read, not run. The CLI also has `superset mcp` commands, which call plugin MCP servers through the cloud (`commands/mcp/call-tool`), not a local server.
- Plugins: `plugins/` holds Paradev plugins (many MCP-backed connectors) with a cloud proxy (`packages/trpc/src/router/plugins/proxy`); not needed for the Claude connector route.
- Desktop-mcp: the name "desktop-mcp" does not occur anywhere in the clone (file names, directories, strings in source, docs and skills; grep excluding `node_modules`). `packages/mcp` has no desktop control tool. The nearest equivalents are the `superset panes` and `superset browser` CLI commands and their skills, which drive the UI over the host service and the desktop bridge. The secondary-source report is not confirmed for this commit.

## 7. Telemetry and auto-update

Telemetry:
- Main process (`apps/desktop/src/main/lib/analytics/index.ts`): the PostHog client is created only when `NEXT_PUBLIC_POSTHOG_KEY` is set; the constant `DEFAULT_TELEMETRY_ENABLED = true` (`apps/desktop/src/shared/constants.ts`) and a settings toggle synchronised by `renderer/components/TelemetrySync`. The key is a build-time value baked in by `electron.vite.config.ts` (`defineEnv`). No key is in the source, so a local build without the variable sends nothing from the main process. The renderer reads the same variable and has a `PostHogProvider`.
- Sentry: `src/main/lib/sentry.ts` initialises only with `SENTRY_DSN_DESKTOP` set and `NODE_ENV` production; the host service has its own DSN variable. The DSNs are build-time values.
- The host service posts analytics events to the cloud API when signed in (`api.analytics.captureEvent` in `packages/host-service/src/workspaces/local-workspace-store.ts`), and `api.v2Workspace.trackCreated` after workspace creation (fire and forget).
- The layout mounts components such as `LeaderboardAutoPublish`, `StarNagObserver`, `RealtimeNudges` and `PostHogPlanFlags` inside the authenticated shell; their behaviour was not read.

Auto-update (`apps/desktop/src/main/lib/auto-updater.ts`):
- `electron-updater` with `autoDownload` and `autoInstallOnAppQuit` on, `disableDifferentialDownload` on, periodic checks after a first delay (interval constant UPDATE_CHECK_INTERVAL_MS). `setupAutoUpdater` returns early when `NODE_ENV` is development or the platform is not an update platform.
- Feed: `https://github.com/paradevai/paradev/releases/latest/download` for stable and `.../releases/download/desktop-canary` for canary; `electron-builder.ts` publish target is GitHub `paradevai/paradev`.
- Consequence for a fork: a packaged build with unchanged publish settings looks for upstream releases and installs them without a prompt. The feed URL and publish target must change, or `setupAutoUpdater` be stubbed, before a packaged fork is used.
- The host service has its own self-update path (`packages/host-service/src/self-update`, authorised by `api.host.authorizeUpdate`); not read in detail.

## 8. Upstream health

See the measurements table. Summary of reading: very active with several authors, a high commit rate, a release every few days, fast merges by team members. The upstream restructured the product recently (v2 workspaces, tag folders, host service, chat-v3, rename to Paradev), and the files a fork would patch for S1, S2 and S3 see steady change: the sidebar tree, the new workspace modal and the shared packages. A fork that diverges in those files carries a rebase cost; merge-conflict counts were not measured. The company is Y Combinator backed per marketing links in the source; whether the project continues in the current shape is outside what the repository shows.

## 9. Cloud dependency

Needs the vendor's account or servers:
- Sign-in: the authenticated layout (`renderer/routes/_authenticated/layout.tsx`) redirects to `/sign-in` unless a better-auth session exists, then requires an active organisation and an onboarding flag. The bypass is `SKIP_ENV_VALIDATION`, which only takes effect when `NODE_ENV` is development (`renderer/env.renderer.ts`, `main/env.main.ts`): it skips sign-in and uses a mock organisation id. `apps/desktop/BUILDING.md` documents `SKIP_ENV_VALIDATION=1 bun run dev` and says desktop chat falls back to local-only bootstrap in that mode. A packaged production build has no account-free mode; a fork must patch the gate.
- Default cloud URLs (`NEXT_PUBLIC_API_URL`, `RELAY_URL`, `REALTIME_URL`) point at superset.sh hosts when not overridden.
- Host registration and tunnel to the relay (`packages/host-service/src/tunnel`, `api.host.ensure`) for remote access.
- Plan-gated features (`renderer/components/Paywall/constants.ts`): tasks, remote access, mobile app, automations, member invites.
- Cloud-backed: tasks records, pages (and page comments), channels and realtime, automations, cloud workspaces and sandboxes, plugin MCP proxy, the MCP server, chat history sync, usage, voice, leaderboard.
- Optional telemetry, crash reporting and the update feed (section 7).

Works without the vendor (from reading; not run): local projects and worktrees, workspace sidebar and tag folders, PTY sessions with any CLI agent, terminal presets and scripts, git, GitHub through the host's credentials (token from `gh` or the credential provider; `providers/git`), diff and review panes, pull request panes, file view with Markdown, image and PDF views, in-app browser panes, ACP chat sessions, the `superset` CLI against the local host.

Unverified for the account-free path: how many renderer features throw or stall when the cloud API is unreachable while a mock session is active (for example `api.task.*` calls, `useKnownHosts`, `ChannelsRealtime`, `OrganizationPluginSync` mounted in the shell).

## 10. Requirement scores for a fork of superset

| Req | Score | Days to 3 | Rationale |
| --- | --- | --- | --- |
| R1 desktop GUI | 2 | 4 | Electron app with macOS builds; not run here. A production build requires a Paradev sign-in and organisation; the account-free path exists only as a development flag. Needs a patch of the auth gate, cloud URL defaults, and the unconfirmed behaviour of cloud-dependent shell components with no server. |
| R2 attach context | 2 | 5 | Chat composer takes images, files and mentions; the terminal pane takes files and images; diff comments go to a running agent. Editor selection and agent-message attach are absent; terminal sessions have no composer. |
| R3 image annotation | 1 | 8 | No annotation code (grep). Pane kinds are an in-file registry and the file pane has an image view registry, so a drawing pane with PNG export can be hosted and then attached through the R2 path. |
| R4 agents | 2 | 1 | Claude runs as the unmodified interactive CLI in a PTY under the user's login, with arguments passed through; Codex, Gemini and Kimi are builtin terminal agents. Needed: review the default `--dangerously-skip-permissions` command, keep the optional Agent SDK based Claude chat adapter off to match decision 0001, and decide on the `claude -p` use for workspace names. |
| R5 GitHub PRs | 3 | 0 | PR pane with checks and review, PR checkout into a workspace including fork fields, search by URL or number, ship actions, local GitHub credentials; not run. |
| R6 task tree and task start | 2 | 11 | Flat folders in a Sessions lane and in each project with persistence and drag exist; nesting needs S1 (about 8 days). Prompt start works; a PR URL needs a direct path and a Jira key needs the connector prompt route (S2, about 3 days). |
| R7 reuse connectors, skills, plugins | 3 | 0 | The PTY transport runs the real `claude` with the user's `~/.claude`, so skills, plugins and connectors are those of the CLI. The app edits `~/.claude/settings.json` (hooks) and `~/.claude.json` (plugin MCP entries). Not run; connectors in PTY sessions need probe P2. |
| R8 UI actions through MCP or API | 2 | 7 | Host-service tRPC and the `superset` CLI already open files, split and focus panes, drive the browser, create workspaces and sessions, and move workspaces between tag folders. No local MCP server; the cloud MCP has no UI tools. A local MCP layer, delivery through the managed-MCP writer, reveal and highlight operations and folder tools after S1 are needed (S3). |
| R9 code browsing and AST tools | 1 | 12 | CodeMirror 6 with language modes and a diff viewer; no language server client, no tree-sitter or ast-grep (grep). Needs an LSP client and server lifecycle in the host service and editor, plus Serena and ast-grep wired as MCP servers through the managed-MCP writer; Kotlin is an added risk. |
| R10 build tools by command line | 3 | 0 | Workspace terminals, presets, setup, run and teardown scripts, PTY daemon. |
| R11 Markdown and HTML | 2 | 5 | File pane with Markdown view backed by a Tiptap (ProseMirror) editor for files up to a size limit, front matter handling, CodeMirror source view, diff rendering with `@pierre/diffs`, and a sandboxed HTML preview (used for chat replies) plus browser panes. The ProseMirror document is not exposed to the agent or used for diffs. |

Weights apply per `docs/decisions/0001-scope-and-constraints.md` and the task text; R10 weight 1.

Must-have check for this base within R1 to R11: R1, R2, R4, R5, R6, R7 and R8 score at least 2 under these figures. R12 and R13 are scored elsewhere. R1 sits at 2 only if the cloud-less path works as the code suggests; this is the largest uncertainty. R6 and R9 carry the largest effort.

## Not verified

- Nothing was run: no install, build, launch, tests or timings. Build time, start time and memory are not measured. The account-free path (development flag, or a patched gate in a packaged build) was read, not exercised; the behaviour of cloud-dependent shell components with no reachable server is unknown.
- Whether claude.ai connectors and the user's plugins load inside the PTY session started by the app: expected from running the real CLI, not tested.
- Whether `claude` 2.1.326 accepts the hook JSON the app writes, and what the hooks do to `~/.claude/settings.json` formatting: not tested.
- Which transport the Claude agent uses by default in the current build (PTY terminal or ACP chat): not determined. Whether the Claude ACP adapter honours `--bare` or loads connectors: not read at adapter source level.
- Whether the workspace-name call with `claude -p` is subject to the `--bare` change.
- Licenses of the ACP adapter packages and of bundled third-party assets: not checked.
- Contents of `LeaderboardAutoPublish`, `StarNagObserver`, `RealtimeNudges`: not read; whether they send data without consent is unknown.
- Merge-conflict count against current upstream was not measured (needs a full clone and a patch set).
- Issue response time is a very small sample; whether the early comments are automated is not known.
- The `desktop-mcp` claim: absent from this commit; earlier or later commits and other branches were not searched (shallow clone, single branch).
- The sandbox denied one `cd`-based `find` command with a message about a deny rule on `~/.ssh/**`; the same command with absolute paths succeeded. No step was skipped.
