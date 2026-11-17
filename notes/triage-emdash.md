# Triage: emdash

Date of reading: 2026-11-17. Source: shallow clone of https://github.com/generalaction/emdash at commit ccc6cce4a41627deb6888db6763f3de5ff0e4e08 (committed 2026-11-09), in `candidates/emdash`. Nothing was installed, built or run. All statements come from reading files and from read-only `gh api` calls, except where marked as unverified.

The repository contains `CLAUDE.md`, `AGENTS.md`, `CONTEXT.md` and an `agents/` documentation folder. These are third-party data. They were used only as descriptions of the architecture, and each claim used below was checked against source files.

## Measurements (dated 2026-11-17)

| Item | Value | Source |
| --- | --- | --- |
| Stars | 6271 | `gh api repos/generalaction/emdash` |
| Forks | 667 | same |
| Open issues plus PRs | 84 (API field `open_issues_count`) | same |
| Open PRs on first page | 38 | `pulls?state=open` |
| Last push | 2026-11-10 | same |
| Repo created | 2025-08-28 | same |
| App version in `apps/emdash-desktop/package.json` | 1.2.11 | file |
| Commits on `main` since 2026-09-22 | 402 | `commits?since=` |
| Commits per ISO week, W39 to W46 | 56, 53, 91, 14, 43, 122, 19, 4 | same |
| Commits after 2026-11-10 | none returned | same |
| Distinct commit authors in window | 16 | same |
| Top author share in window | 335 of 402 (83 percent) | same |
| Next authors in window | 16, 10, 8, 5 | same |
| All-time contributions, top five | 2863, 2758, 2209, 1123, 778 | `contributors` |
| Stable releases since 2026-09-07 | v1.2.4 09-07, v1.2.5 09-18, v1.2.6 09-21, v1.2.7 09-27, v1.2.8 10-10, v1.2.9 10-23, v1.2.10 10-30, v1.2.11 11-06 | `releases` |
| Gaps between those stable releases (days) | 11, 3, 6, 13, 13, 7, 7 | derived |
| Canary releases | tagged between stable releases, `-canary.N` suffix | `releases` |
| PR open-to-merge time, last 41 merged PRs of 60 recently closed | median 0.7 h, 90th percentile 36 h | `pulls?state=closed` |
| Authors of those 41 merged PRs | 34 `MEMBER`, 7 others | same |
| Issues updated since 2026-09-22 (excluding PRs) | 27; 19 have zero comments; 18 closed | `issues?since=` |
| First comment delay, 8 issues with comments | 1 min, 16 min, 1.1 h, 1.7 h, 1 d, 2.7 d, 6 d, 11.2 d | per-issue comments |
| Author association of those first comments | 6 `NONE`, 1 `CONTRIBUTOR`, 1 `MEMBER` | same |
| Commits since 2026-09-22 touching `workbench/browser/sidebar` | 2 | `commits?path=` |
| Same, `tasks/browser/create-task-modal` | 8 | same |
| Same, `tasks/node/operations/createTask.ts` | 2 | same |
| Same, `packages/plugins/src/agents/impl/claude` | 7 | same |
| Same, `packages/core/src/runtimes/tui-agents` | 15 | same |
| Same, `conversations/browser/acp` | 11 | same |

Exact dependency versions read from `package.json` and `pnpm-lock.yaml`: Electron 40.10.2, React 19, MobX 6.15, node-pty 1.1.0, better-sqlite3 12.6, drizzle-orm 0.32, monaco-editor 0.55.1, typescript-language-server 6.0.1, pyright 1.1.414, `@agentclientprotocol/claude-agent-acp` 0.81.2, `@anthropic-ai/claude-agent-sdk` 0.3.280, `@agentclientprotocol/sdk` ^1.1.0.

Reading of the activity numbers: one author accounts for most commits in the window. The repository had no commits on `main` after 2026-11-10 at the time of reading, one week before today. Whether that is a pause is not known. Issue first-response data is a small sample with low confidence; `NONE` commenters may be community members or bots.

## 2. License

`LICENSE.md` starts with:

```
Copyright 2026 General Action, Inc.

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/
```

The text continues as the unmodified Apache License 2.0 including the appendix. The README states "Licensed under the Apache-2.0 license" and the badge says the same. The README claim matches the file.

Other checks:
- No other file named LICENSE, COPYING or NOTICE exists outside `LICENSE.md` (find over the clone).
- No `ee` or `enterprise` directory exists.
- Every workspace `package.json` under `apps/` and `packages/` has `"license": "Apache-2.0"`.
- `CONTRIBUTING.md` and `.github/` contain no CLA text, no DCO text and no CLA workflow.
- License section 6 excludes use of the licensor's trade names and product names. A fork needs a different name and icon if it is distributed.
- The ACP adapter used for Claude, `agentclientprotocol/claude-agent-acp`, is reported as Apache-2.0 on its GitHub page (WebFetch, not verified against its LICENSE file).

Conclusion: a private fork is allowed.

## 3. Architecture

Paths are relative to `apps/emdash-desktop/` unless stated.

Process layout:
- Electron main process: `src/main/` (bootstrap in `src/main/bootstrap/`, entry `src/entry/main.ts`).
- Preload: `src/entry/preload.ts`, exposes a Wire message port and a file path lookup only.
- Renderer: `src/renderer/` plus feature slices in `src/core/features/*/browser`. React 19 with MobX stores. The chat transcript view is a separate package, `packages/chat-ui`, built with Solid.
- Child worker processes started by the main process through `@emdash/wire/worker`. The worker list is in `src/core/manifests/node/workers.ts` and covers runtimes for acp, tui-agents, conversations, terminals, git, files, file-search, fs-watch, lsp, scripts, workspace-registry, agent-config, automations, host-settings, provider-usage, resource-usage, mementos and pull-requests. The spawner is `src/main/gateway/desktop-workers.ts`.
- Separate daemon for SSH hosts: `apps/workspace-server`. It runs on a remote machine and is not used for local work.

IPC style: typed RPC and live models over the `@emdash/wire` package (`packages/wire`). Contracts are zod based and composed in `src/core/manifests/shared/desktop-wire-contract.ts`. The main process serves the contract over a transferred message port (`src/main/gateway/desktop-wire.ts`). Feature code is split into `api/`, `node/`, `browser/` and `contributions/` folders per slice, with manifests in `src/core/manifests/`.

State store and persistence:
- App database: SQLite through better-sqlite3 and drizzle, file name `emdash4.db` in the Electron userData directory (`src/main/db/default-path.ts`, `src/main/db/path.ts`). Schema in `src/core/services/app-db/node/schema.ts`. Migrations in `drizzle/`.
- UI state ("mementos"): a separate `mementos.db`, served by a worker (`src/core/services/mementos/`, `src/core/primitives/mementos/README.md`). Memento schemas are zod versioned schemas.
- Conversation records: a host-side conversations runtime and registry (`packages/core/src/runtimes/conversations/`) plus annotation columns in the app database.
- Secrets and provider accounts: `src/core/services/provider-accounts/`, `appSecrets` and `providerAccounts` tables.

Where sessions and workspaces are modelled:
- Projects: `projects` table. A project is a repository root.
- Tasks: `tasks` table, each with a required `projectId`, name, status, linked issue, and a `workspaceId`.
- Workspaces: `workspaces` table (kind: git worktree, repository root or directory; location local or remote; `parentId` links worktrees to a repository).
- Conversations (sessions): `conversations` table with `taskId` (nullable, set null on task deletion), `type` of `pty` or `acp`, `provider`, `providerSessionId`. Schema types in `packages/core/src/runtimes/conversations/api/schemas.ts`.
- Task creation: `src/core/features/tasks/node/operations/createTask.ts`.
- A conversation can be relinked to another task: `src/core/features/conversations/node/link-conversation-to-task.ts`.

Where the left sidebar is implemented (`src/core/features/workbench/browser/sidebar/`):
- `left-sidebar.tsx`: container.
- `sidebar-store.ts`: MobX store. Rows are a flat union of `project` and `task` rows. Project order, per-project task order, expanded projects and sort key live in the `workbench.sidebar` memento (`src/core/features/workbench/contributions/mementos.ts`).
- `sidebar-virtual-list.tsx`: virtualized list with `@dnd-kit` sortable. `handleDragEnd` reorders projects, and reorders tasks only inside the same project.
- `project-item.tsx`, `task-item.tsx`, `projects-group-label.tsx`, `sidebar-primitives.tsx`, `use-sidebar-drop.ts` (drop a folder to add a project).
- Sessions under a task: `src/core/features/conversations/contributions/browser/sidebar-conversations-list.tsx`.

## 4. How the agent CLI is launched

Each conversation uses one of two transports, chosen at creation (`conversationTypeSchema` is `pty` or `acp`). The default is `pty`: `preferredConversationType` has `defaults: 'pty'` in `src/core/features/conversations/contributions/settings.ts`, and `createTask.ts` uses `ic.type ?? 'pty'`. The user can switch to the chat UI per task or globally.

PTY transport (default):
- Runtime: `packages/core/src/runtimes/tui-agents/node/runtime/runtime.ts`. `spawnInto` builds the command through the provider plugin and starts the interactive CLI in a node-pty session (`resolveLocalPtySpawn`, optional tmux wrapper).
- Command for Claude: `packages/plugins/src/agents/impl/claude/index.ts`, `buildStandardCommand` with `--dangerously-skip-permissions` when auto-approve is on, `--session-id <uuid>` on a fresh start, `--resume <id>` on resume, `--model`, and the initial prompt as a positional argument. User-set extra arguments per provider are appended (`extraArgs`).
- No `-p`, no `--print`, no `stream-json`, no `--bare`, no `--mcp-config`, no `--settings`, no `--setting-sources` appear anywhere in the repository (grep over `apps`, `packages`, `agents`, `docs`). The PTY path therefore does not depend on `claude -p` and is not affected by a `--bare` default for `-p`.
- Authentication is whatever the installed `claude` already has. `claudeAuthStatus` (`impl/claude/auth.ts`) runs `claude auth status` and also accepts `ANTHROPIC_API_KEY`.

Status tracking uses hooks (PTY transport):
- A local HTTP server on 127.0.0.1, random port, token header `x-emdash-token`: `packages/core/src/runtimes/tui-agents/node/hooks/hook-server.ts`.
- The session environment carries `EMDASH_HOOK_PORT`, `EMDASH_PTY_ID`, `EMDASH_HOOK_NONCE` (`prepareHookEnv` in `runtime.ts`).
- Hook commands are shell snippets that exit when those variables are unset, then `curl` the event to the server (`packages/core/src/services/agent-plugins/api/plugins/helpers/hooks.ts`).
- Claude events installed: SessionStart, UserPromptSubmit, Notification, Stop (`impl/claude/hooks.ts`). Notifications are classified by message text.
- Hook events update the session state and the provider session id (the id changes when the user runs `/resume` inside the TUI).

ACP transport (optional, "chat UI"):
- Runtime: `packages/core/src/runtimes/acp/`. Claude runs through the adapter `@agentclientprotocol/claude-agent-acp`, which the adapter page describes as built on the Claude Agent SDK. `impl/claude/index.ts` spawns the adapter with the Electron binary as Node (`ELECTRON_RUN_AS_NODE=1`) and sets `CLAUDE_CODE_EXECUTABLE` to the host-installed `claude`, so the adapter drives the user's own CLI binary.
- The same plugin file also calls the Agent SDK `query()` directly for subscription usage limits (`impl/claude/usage.ts`): `pathToClaudeCodeExecutable` set to the host CLI, `settingSources: ['user']`, `settings: { disableAllHooks: true }`, `strictMcpConfig: true`, `ENABLE_CLAUDEAI_MCP_SERVERS: 'false'`, no prompt sent. This is a use of the Agent SDK inside the app, which differs from decision 0001 ("the tool does not use the Agent SDK"). It is a removable capability (`usageLimits` in the plugin descriptor).
- Whether the SDK-driven CLI process in ACP mode is subject to the `--bare` change for `-p` is not verified. How the adapter chooses setting sources, and whether claude.ai connectors load in that mode, is not verified: the adapter page does not say and its source was not reachable (the raw file URL returned 404).
- Other agents: Codex has an ACP adapter (`impl/codex/adapter.ts`), Kimi has native ACP (`impl/kimi/index.ts`). A Gemini CLI provider is not registered (`packages/plugins/src/agents/registry.ts`); only an Antigravity provider exists. Adding Gemini means writing a provider plugin.

MCP and settings passed to the CLI:
- None per session. `mcp: passthroughMcpAdapter('.claude.json')` makes the app read and write MCP servers in the user-level `~/.claude.json` (global scope, transports stdio and http). In ACP mode the registered servers are converted and passed in the ACP session request (`packages/core/src/runtimes/acp/node/runtime/mcp-servers.ts`).

## Extra check: lifecycle hooks and the real `~/.claude`

Yes, the hooks go into the user's real Claude settings.
- Config root resolver for Claude: `configRoots(envConfigRoot('CLAUDE_CONFIG_DIR', '.claude'))` (`impl/claude/hooks.ts`), so the target is `$CLAUDE_CONFIG_DIR/settings.json`, otherwise `~/.claude/settings.json`. The hook scope is `global` (`hooks: { kind: 'config', scope: 'global' }` in `impl/claude/index.ts`).
- `AgentHookInstaller.ensureHooksInstalled` (`packages/core/src/services/agent-plugins/node/hook-installer.ts`) runs before every PTY session spawn (`prepareHookEnv`). If the entries are absent it calls `writeHooks`, which reads the JSON, removes entries carrying the Emdash marker, appends the hook entries, and rewrites the whole file with `JSON.stringify(config, null, 2)` (`buildNestedJsonHookConfig` in `helpers/hook-config.ts`). Formatting and key order of the user's file can change on that rewrite.
- The entries carry a version marker and `EMDASH_HOOK_PORT`; the guard `exit 0` makes them inert outside an Emdash session, as the README states. `deleteHooks` exists in the behavior, but no call from a user action was looked for.
- The environment for resolving the root is the base environment merged with per-provider variables (`params.env` = `providerVars`), so setting `CLAUDE_CONFIG_DIR` in the provider's environment settings redirects both the hook write and the CLI. That would also hide the user's skills, plugins and connector state unless that directory is populated. This was not tested.
- Workspace trust: when auto-approve is on or the project setting `autoTrustWorktrees` is on, `TuiWorkspaceTrust` writes `projects[<worktree path>].hasTrustDialogAccepted = true` and `hasCompletedProjectOnboarding = true` into `~/.claude.json` (`impl/claude/trust.ts`, trigger in `src/core/features/conversations/node/tui-conversation-provider.ts`). This is also a write to the real config.
- Codex and the other agents get the same treatment in their own user-level files.

## 5. Slice analysis

Effort figures are working days for one engineer plus agents, from code reading only.

### S1 nested folder tree with drag and persistence: about 7 days

Files that change:
- `src/core/features/workbench/contributions/mementos.ts`: new schema version with a folder tree (folder id, name, parent id, ordered child ids, task or conversation references). `defineVersionedSchema` supports adding a version with a migration.
- `src/core/features/workbench/browser/sidebar/sidebar-store.ts`: `SidebarRow` gains a `folder` kind with depth; `sidebarRows` flattens the tree; new actions for create, rename, delete, move.
- `src/core/features/workbench/browser/sidebar/sidebar-virtual-list.tsx`: `handleDragEnd`, `parseDndId`, `rowToDndId`, and the collision function need parent-aware drop targets (above, below, inside) and cross-parent moves. Today a task can only move within its own project.
- New `folder-item.tsx` beside `project-item.tsx` and `task-item.tsx`; `left-sidebar.tsx` for the composition.
- `src/core/features/conversations/contributions/browser/sidebar-conversations-list.tsx` if sessions, not only tasks, are placed in folders.

Extension point: the versioned memento schema and the MobX store are clean seams. The sidebar rows themselves are a fixed union, not a contribution registry (none found in the files read).

Constraint: `tasks.projectId` is required and a task owns a git worktree, so the existing hierarchy is repository, task, session. A user-facing folder tree has to be a layer that references task ids across projects (stored in the memento), or projects become folder children. Moving a session between tasks exists as relinking (`link-conversation-to-task.ts`) but has no drag UI found.

Risk: the plan sets a stop rule on S1 time. Nested drag and drop on a virtualized flat list is the part most likely to exceed it. Recent churn in the sidebar directory is low, so merge conflicts with upstream are unlikely.

### S2 start a task from a prompt, a GitHub PR URL and a Jira key: about 4 days

State today:
- Plain prompt: works. Modal in `src/core/features/tasks/browser/create-task-modal/` (`create-task-modal.tsx`, `use-create-task-state.ts`, `build-create-task-params.ts`, `initial-conversation-text.ts`); node side in `src/core/features/tasks/node/operations/createTask.ts`.
- PR: `LinkedType` is `'issue' | 'pr' | null`. A PR is chosen from a list (`pr-combobox-field.tsx`), not pasted. The PR checkout plan is solid: `src/core/primitives/workspaces/api/compile-worktree-git-plan.ts` handles same-repo and fork PRs, fetching the PR ref, and `build-workspace-config-from-preset.ts` builds the config. Needed: parse a PR URL into owner, repo and number, map to a project by remote, and call the existing PR client (`packages/plugins/src/pull-requests/impl/github/client.ts`). About 2 days.
- Jira: see the extra check below. The built-in route uses REST with a stored token. The decision to use only the claude.ai Atlassian connector means the app cannot fetch tickets itself. The practical route is a Jira-key field that fills the initial prompt with an instruction for Claude to read the ticket through the connector, with the key parsed by the existing pattern (`JIRA_KEY_PATTERN` in `packages/plugins/src/issues/impl/jira/index.ts`). About 1.5 days. Whether connector tools are available inside the PTY session is not verified (probe P2 in the plan covers it).

Extension point: the issues plugin framework (`packages/plugins/src/issues/plugin.ts`, `capabilities/issues.ts`, registry in `src/core/features/issues/node/registry.ts`). An issues plugin needs `listIssues` and `searchIssues` and optionally `getIssue`, all through credentials handed in by the host; there is no hook for "ask the CLI".

### S3 UI parity through a local MCP server: about 12 days

State today: no MCP server is hosted by the app (see section 6).

Extension points found:
- A typed command catalog with zod inputs: `src/core/primitives/commands/api/define-command.ts`, `catalog.ts`, with command definitions in `contributions/commands.ts` per feature (for example `app.newProject`, `app.newTask` in `src/core/features/workbench/contributions/commands.ts`). Runtime implementations come from view scopes in the renderer. Many commands exist.
- A single entry for opening files: `openFile` in `src/core/features/workbench/api/browser/open-file.ts`.
- Typed wire contracts for tasks, projects, conversations, files (`src/core/features/*/api/contract.ts`).
- A local loopback HTTP server pattern with a token and header checks: `hook-server.ts`, `git-credential-server.ts`.
- Injection of MCP servers into ACP sessions (`mcp-servers.ts`).

Work:
- Main-process MCP server (Streamable HTTP, 127.0.0.1, per-session token, Origin check). The repository has no `@modelcontextprotocol/sdk` dependency, so this is new. About 3 days including tests.
- A bridge from main to the renderer for command execution and results, since command implementations live in view scopes. About 4 days.
- Tools for folder, move-session, open-file, start-task, and a parity table for the existing UI actions with one tool each. About 3 days; the folder tools depend on S1.
- Per-session delivery to PTY sessions: there is no `--mcp-config` path. Options are the global `~/.claude.json` write (shared by all sessions and every `claude` run) or per-provider extra arguments with a generated config file. About 2 days. In ACP sessions the ACP request carries the server.
- Permission allow rules for the app's tools in the CLI's permission model are not handled by the app; they would need to be added.

### S4 context attach (file, selection, agent message, image into the composer): about 6 days

State today:
- ACP composer: `src/core/features/conversations/browser/acp/acp-chat-panel.tsx` accepts dropped or pasted images (PNG, JPEG, GIF, WebP), uploads them through the attachment service, supports file mentions with `@`, queued prompts and a prompt library. Mention resolution: `api/browser/chat/workspace-file-mention-provider.ts`.
- PTY: files dragged onto the terminal are prepared and referenced by path or uploaded for remote hosts (`src/core/services/attachments/node/prepare-terminal-files.ts`, `src/core/features/terminals/api/browser/terminal-attachments.ts`). Diff line comments are formatted as XML and pasted (`src/core/primitives/line-comments/api/line-comments.ts`, `src/core/primitives/prompt-injection/api/prompt-injection.ts`, bracketed paste).
- Not found: attach an editor selection, attach an agent message, or attach an image from an annotation tool.

Work: PTY sessions have no composer, so a native input strip above the terminal or a paste-into-TUI action is needed for the default transport. Selection and message actions add commands in the editor and chat-ui, with payload formatting. Estimate assumes the PTY paste route.

## Extra check: Jira, Linear and GitHub intake

- Providers are integration plugins plus issues plugins in `packages/plugins/src/integrations/impl/*` and `packages/plugins/src/issues/impl/*`: jira, linear, github, gitlab, forgejo, asana, monday, plain, youtrack, notion, plane, trello, featurebase (README also lists Monday.com and Plain).
- Jira: REST through the `jira.js` client (`packages/plugins/src/integrations/impl/jira/client.ts`). Auth forms: site URL plus email plus API token (basic), or an OAuth 2.0 access token (bearer, via `api.atlassian.com/ex/jira/<cloudId>`). Credentials are stored in the app (provider accounts and secrets). Issues are read by JQL search (`issues/impl/jira/index.ts`). It does not use MCP and does not call the CLI.
- Linear: `@linear/sdk` GraphQL client (`issues/impl/linear/`), token or OAuth.
- GitHub: Octokit REST and GraphQL (`integrations/impl/github/client.ts`, `pull-requests/impl/github/`). Auth methods: OAuth through the Emdash account server, device flow using Emdash's registered OAuth client id `Ov23ligC35uHWopzCeWf` with scopes repo, read:user, read:org, or `cli-import` of the `gh` login (`features/github/node/accounts/github-cli-account-import.ts`).
- Could Jira use the claude.ai Atlassian connector through the CLI instead? Not in the current structure. The connector authorization belongs to claude.ai and the CLI; the app has no access to it and would have to start a CLI process to use it, which `claude -p` would turn into a different launch path. In the PTY model, the agent itself can read the ticket when the prompt says so. The built-in Jira REST plugin can stay unused. The issue picker UI (list and search) would not work without a token plugin.

## 6. Existing MCP

- The app does not host an MCP server. There is no MCP server SDK in any `package.json`, and the only servers started in the code are the hook receiver (`hook-server.ts`), the git credential helper server (`features/github/node/services/git-credential-server.ts`), the OAuth callback server (`src/main/core/shared/oauth-flow.ts`), a port-forward tunnel and the SSH-host wire socket. No tool names exist for the UI.
- The app is an MCP configuration manager: `src/core/features/mcp/`, `src/main/core/mcp` and `packages/core/src/primitives/mcp`. It reads, merges and writes MCP server entries into each agent's own config file and shows a catalog. The catalog source is the public registry `https://registry.modelcontextprotocol.io` (`src/core/features/catalog/node/catalog-service.ts`) plus a bundled catalog.
- Skills: installed into `~/.agentskills` (`packages/core/src/runtimes/agent-config/node/runtime/skills.ts`), catalog from skills.sh, `anthropics/skills` and `openai/skills` on GitHub.
- No account is needed for any of this. Nothing is cloud-hosted by the vendor.

## 7. Telemetry and auto-update

Telemetry (PostHog), from `src/main/lib/telemetry.ts`:
```
private isEnabled(): boolean {
  return (
    !isViteDevBuild &&
    this.enabled === true &&
    this.userOptOut !== true &&
    !!this.apiKey &&
    !!this.host &&
    typeof this.instanceId === 'string' &&
    this.instanceId.length > 0
  );
}
```
- The key and host come from `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` at build time, written from CI secrets in `.github/actions/setup-build/action.yml` (lines 78 and 79). No key is in the source. A fork built locally without those variables sends nothing.
- When enabled it posts to `<host>/capture/`, `/decide/` and an `$identify` event. Base properties can include `github_username` and `account_id`, and identify can carry an email when an Emdash account is known. Event properties pass an allow-list.
- Opt-out: Settings, "Privacy & Telemetry" card (`TelemetryCard.tsx`), or `TELEMETRY_ENABLED=false`. The README states: "Telemetry is optional and can be disabled in Settings or by launching with: TELEMETRY_ENABLED=false".
- A waitlist feature posts to a Supabase REST endpoint (`src/core/features/waitlist/node/join-waitlist.ts`) when the user submits the form.

Auto-update (`src/main/host/updates/update-service.ts`):
- Uses `electron-updater`. `autoDownload = false`, `autoInstallOnAppQuit = true`, `autoRunAppAfterInstall = true`, `allowDowngrade = false`. First check 30 seconds after start, then hourly. `initialize()` returns early in a Vite dev build (`if (import.meta.env.DEV) return;`).
- Publish targets in `electron-builder.config.ts`: GitHub `generalaction/emdash` and a generic provider at `R2_BASE_URL = 'https://releases.emdash.sh'` (`src/core/primitives/app-identity/api/app-identity.ts`).
- Consequence for a fork: a packaged fork built with the unchanged publish config looks for upstream releases and could offer or install them. The publish config and `R2_BASE_URL` must change, or the update service must be stubbed, before a packaged build is used.
- The SSH workspace-server installer also downloads from `https://releases.emdash.sh/workspace-server` (`src/core/services/hosts/node/settings.ts`); not used for local work.

## 8. Upstream health

See the measurements table. Summary of reading: very active, one author wrote most recent commits, merges are fast for the members who author them, stable releases roughly weekly to biweekly, issue replies from maintainers are not evident in the small sample. The company behind the project (General Action, Inc.) lists Y Combinator W26 in the README. Whether the project continues is outside what the repository shows.

## 9. Cloud dependency

Needs the vendor's account or servers:
- Optional Emdash account at `https://auth.emdash.sh` (`src/core/features/account/node/config.ts`). It acts as an OAuth broker for provider sign-in and dispatches provider tokens into the app. Packaged builds always use that server. The integration screens also offer token entry and `gh` import, so the account is optional for GitHub; for other providers the token forms were seen for Jira and are expected for others (not checked for each).
- Telemetry endpoint (optional, build-time key).
- Update feed at `releases.emdash.sh` and GitHub releases.
- SSH workspace-server artifacts at `releases.emdash.sh`.
- Waitlist (Supabase).

Works without the vendor: local projects, worktrees, PTY and ACP sessions, MCP and skill catalogs (public registries), git, terminals, LSP, diff view.

## 10. Requirement scores for a fork of emdash

| Req | Score | Days to 3 | Rationale |
| --- | --- | --- | --- |
| R1 desktop GUI | 3 | 0 | Electron app with macOS builds; not run here. |
| R2 attach context | 2 | 6 | Images and file mentions in the ACP composer, file drops in the terminal, diff line comments. Selection and agent-message attach are absent; the default PTY transport has no composer. |
| R3 image annotation | 1 | 8 | No annotation code. Tab kinds are contributed (`src/core/features/editor/contributions/tabs.ts`), so a drawing tab and PNG export can be hosted, then attached through the R2 path. |
| R4 agents | 2 | 2 | Claude launches as the unmodified interactive CLI under the user's login (PTY default); Codex and Kimi are supported. Needed: remove or disable the Agent SDK usage probe and the SDK-based ACP path for Claude to match decision 0001, add a Gemini provider plugin. |
| R5 GitHub PRs | 3 | 0 | PR list, checkout plans for forks, diff with PR comments, checks, create and merge are present in code; not run. |
| R6 task tree and task start | 2 | 11 | Flat repository, task, session tree with reorder inside a level. Folders and nesting need S1 (about 7 days). Task start from prompt works; PR URL and Jira key need S2 (about 4 days). |
| R7 reuse connectors, skills, plugins | 3 | 0 | The PTY transport runs the real `claude` with the user's `~/.claude`, so skills, plugins and connectors are those of the CLI. Not run; ACP mode unverified. Claude connectors inside PTY sessions need probe P2. |
| R8 UI actions through MCP | 2 | 12 | No MCP server. Typed command catalog, `openFile` entry and wire contracts make a bridge feasible (S3). |
| R9 code browsing and AST tools | 2 | 8 | Monaco with host LSP for hover, definition, type definition, references and diagnostics; TypeScript and Python bundled, others installable (`packages/core/src/runtimes/lsp/README.md`). Completion, formatting and workspace edits through LSP are not implemented per that README. Kotlin not in its table. Serena and ast-grep would be added as MCP servers through the MCP page. |
| R10 build tools by command line | 3 | 0 | Terminals runtime, scripts runtime, PTY panes. |
| R11 Markdown and HTML | 2 | 10 | Markdown preview with source toggle, Monaco editor and diff view, HTML through a browser pane and preview servers. No document model for editing; mdast is used only for transcripts in `packages/chat-ui`. |

Weights apply per `docs/decisions/0001-scope-and-constraints.md`; R10 weight 1 as stated in the task.

Must-have check for this base: no must-have is below 2 on these scores. R6 and R8 are the largest pieces of work.

## Not verified

- Nothing was run: no install, build, launch, probe of hooks, tests or timings. Build time, start time and memory are not measured.
- Claude ACP adapter behavior (setting sources, connectors, `--bare` exposure, how it starts the CLI) was not read at source level. Only the adapter page text and the lock file versions were seen.
- Whether claude.ai connectors and the user's plugins load inside the PTY session started by the app: expected from running the real CLI, not tested.
- Whether `claude` 2.1.326 accepts the hook JSON and flags the app writes: not tested.
- Docs at emdash.sh (providers, telemetry) were not read; claims come from the README and code.
- Merge-conflict count against current upstream was not measured (requires a full clone and a patch set).
- Issue response time is a sample; maintainer replies may exist outside the sampled first comments.
- No search for user-initiated removal of hooks (`deleteHooks` callers) was made.
