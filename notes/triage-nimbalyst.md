# Triage: Nimbalyst as a fork base

Date of analysis: 2026-11-17. Source: shallow clone of https://github.com/Nimbalyst/nimbalyst at commit 30482d5b719cd7609fb02645008c2f5088565ab9 (authored 2026-11-15), in `candidates/nimbalyst/`. Nothing was installed, built or run. Every statement below comes from reading files with Read and grep, plus read-only `gh api` calls for upstream health. The repository contains its own `CLAUDE.md`, `.claude/` rules and docs; those files were read as data and none of their instructions were followed.

Repository-relative paths below are relative to `candidates/nimbalyst/` unless they start with `/`.

## 1. Summary of the position

Nimbalyst is an Electron monorepo (TypeScript, React, Jotai) that already contains most of the shape the spike wants: a session tree with user-made grouping containers and drag-and-drop, a loopback MCP server hosted by the app with a bearer token, a PTY-based launch path for the unmodified `claude` CLI, GitHub pull request screens built on `gh`, a Lexical Markdown editor with a tree-based diff, an embedded terminal, and an extension SDK with panels, editors, MCP tools and agent providers.

Gaps against the requirements: the default Claude path uses the Agent SDK (the CLI path exists but is off by default); there is no Jira integration; there is no LSP client; there is no tool for moving a session, creating a folder or opening a file; folders cannot nest inside folders; Kimi has no provider and Gemini goes through an Antigravity login.

Fork cost signals: very high upstream commit rate concentrated in one author, a 3.7k-line sidebar file with frequent changes, a database layer that is mid-migration between two engines, and a large surface of account, sync and team code that a personal fork would not use.

## 2. License

`LICENSE` (first lines, quoted):

```
MIT License

Copyright (c) 2024-2026 Nimbalyst Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
```

Other license-related files found:

- `LICENSING.md`: says the repository is MIT and that the collaboration sync server (the Cloudflare Worker behind `wss://sync.nimbalyst.com`) "is a separate project". The sync server source is not in this repository.
- `plugins/nimbalyst-wiki/LICENSE`: MIT, same copyright holder.
- Package manifests under `packages/` and `packages/extensions/`: every `license` field found is MIT.
- `CONTRIBUTING.md`: contributions are accepted under the MIT license and require a Developer Certificate of Origin sign-off. No CLA text found.
- No `ee`, `enterprise` or `commercial` directory found. A search for AGPL, GPL-3, BUSL, SSPL and Commons Clause in manifests, license files and markdown found hits only in `CHANGELOG.md` and the generated `packages/electron/resources/generated/THIRD_PARTY_LICENSE_AUDIT.md`.
- `packages/electron/build/license-approvals.json` lists reviewed third-party exceptions: `@anthropic-ai/claude-agent-sdk` (Anthropic Commercial license, "used unmodified"), `elkjs` (EPL-2.0) and `libheif-js` (LGPL-3.0).

README claim ("Free and MIT licensed") matches the `LICENSE` file. A private fork is permitted by the repository license. The Agent SDK dependency has its own Anthropic terms; a fork that removes the SDK path avoids that dependency.

## 3. Architecture

### Process layout

- Main process: `packages/electron/src/main/` (entry `index.ts`, `bootstrap.ts`). Holds services, IPC handlers (`main/ipc/`), the database workers, node-pty terminals and the loopback HTTP/MCP server (`main/mcp/httpServer.ts`, bound to `127.0.0.1`, line with `httpServer.listen(port, "127.0.0.1", ...)`).
- Preload: `packages/electron/src/preload/` (`index.ts`, `ipcSubscriptions.ts`).
- Renderer: `packages/electron/src/renderer/` (React, Jotai atoms in `store/atoms/`, central IPC listeners in `store/listeners/`). Terminal rendering uses `ghostty-web` in the renderer and `node-pty` in main (`packages/electron/package.json`).
- Workers: database worker threads (`main/database/PGLiteDatabaseWorker.ts`, `main/database/sqlite/`), extension backend modules in `utilityProcess` or `worker_threads` (SDK type `BackendModuleRuntime` in `packages/extension-sdk/src/types/permissions.ts`).
- Shared runtime package: `packages/runtime/` (AI providers under `src/ai/server/`, Lexical editor under `src/editor/`, repositories under `src/storage/repositories/`).
- Separate repository, not present here: the collaboration server (`nimbalyst-collab`), named in `CLAUDE.md` and `LICENSING.md`.
- Native clients `packages/ios`, `packages/android` and a browser extension exist and are not needed for the spike.

### IPC style

Request/response over `ipcMain.handle` through a wrapper `safeHandle` and `safeOn` (`main/utils/ipcRegistry.ts`), with workspace-scoped channels taking `workspacePath` explicitly. Renderer components do not subscribe to IPC; listeners under `renderer/store/listeners/` update Jotai atoms (rule stated in `CLAUDE.md`, `docs/IPC_LISTENERS.md`). Main-to-renderer one-shot requests for tools that need renderer state use `requestFromRenderer` in `main/mcp/rendererRequest.ts`.

### State store and persistence

- Renderer state: Jotai atoms (`renderer/store/atoms/*`, for example `sessions.ts` holds `sessionRegistryAtom`).
- Persistent state in the main process: a database with two live engines, PGLite and better-sqlite3, selected per workspace at init (`packages/electron/DATABASE.md`; engine selection in `main/database/sqlite/BackendSelector.ts`; a PGLite-to-SQLite migrator and cutover machinery under `main/database/sqlite/`). Tables named in `DATABASE.md` include `ai_sessions`, `app_settings`, `project_state`, `session_state`, `document_history`. Transcripts are stored in `ai_agent_messages` (`CLAUDE.md`, `docs/TRANSCRIPT_ARCHITECTURE.md`).
- App and workspace settings: stores in `main/utils/store.ts`.
- Location on macOS: `~/Library/Application Support/@nimbalyst/electron/pglite-db/` (`DATABASE.md`).
- Document content is plain files in the project (README: "Plain files on disk"). The CLI path also relies on Claude's own transcript files under the Claude config directory.
- Renderer rule: no `localStorage`; persistent state goes through IPC (`DATABASE.md`).

### Where sessions and workspaces are modelled

- Session rows: `ai_sessions` accessed through `packages/runtime/src/storage/repositories/AISessionsRepository.ts` and `main/services/PGLiteSessionStore.ts`. Hierarchy columns `parent_session_id`, `created_by_session_id`, `worktree_id`, `session_type` (`docs/SESSION_HIERARCHY.md`).
- Hierarchy rules and recursive reads: `main/services/sessionHierarchy.ts`.
- Session IPC: `main/ipc/SessionHandlers.ts` (`sessions:create`, `sessions:list`, `sessions:list-children`, `sessions:create-child`, `sessions:set-parent`).
- Workspace and project: `main/services/PGLiteWorkspaceRepository.ts`, `main/ipc/WorkspaceHandlers.ts`, `main/ipc/ProjectSelectionHandlers.ts`, `project_state` table; multi-project rail in `renderer/components/ProjectRail.tsx`.
- Worktrees: `main/services/GitWorktreeService.ts`, `main/ipc/WorktreeHandlers.ts`, `docs/WORKTREES.md`.

### Where the left sidebar is implemented

- Agent mode session list: `renderer/components/AgenticCoding/SessionHistory.tsx` (the tree, grouping, virtual lists and handlers), `WorkstreamGroup.tsx` (expandable groups for workstreams and worktrees), `SessionListItem.tsx` (row, drag source and drop target), `useSessionTreeMove.ts` (drag payload, validation, undo), `sessionTreeModel.ts`, `sessionHistoryOrder.ts`. Mounted by `renderer/components/AgentMode/AgentMode.tsx` as `<SessionHistory />`.
- Files mode sidebar: `renderer/components/WorkspaceSidebar.tsx`.
- Navigation gutter (mode switcher and extension buttons): `renderer/components/NavigationGutter/NavigationGutter.tsx`.
- Other mode sidebars: `PullRequestMode/PullRequestSidebar.tsx`, `TrackerMode/TrackerSidebar.tsx`, `CollabMode/CollabSidebar.tsx`.

## 4. How the agent CLI is launched

Nimbalyst has two Claude paths.

### Path A: Claude Agent SDK (default)

- Provider id `claude-code`, enabled by default (`packages/electron/src/shared/settings/keys.ts`, `ai.provider.claude-code` has `enabled: true`).
- Implementation: `packages/runtime/src/ai/server/providers/ClaudeCodeProvider.ts` with `protocols/ClaudeSDKProtocol.ts`, which imports `query` from `@anthropic-ai/claude-agent-sdk` (version `0.3.321`, fixed in `pnpm-workspace.yaml` and `packages/*/package.json`).
- Options are built in `providers/claudeCode/sdkOptionsBuilder.ts`: `pathToClaudeCodeExecutable`, `settingSources`, `mcpServers` (the SDK serializes this into `--mcp-config`), `canUseTool`, and SDK in-process hooks `PreToolUse`, `PostToolUse`, `PermissionDenied`.
- Auth: login-based by default; `ANTHROPIC_API_KEY` is stripped from the inherited, shell and settings environments unless set in app settings. A code comment says an empty `ANTHROPIC_API_KEY` must not be set for login-based sessions. It sets `CLAUDE_CODE_ENTRYPOINT=cli`.
- The SDK drives the `claude` binary over its structured protocol (stream-json inside the SDK). Which binary is used: a resolved path (`providers/claudeCode/cliPathResolver.ts`, custom path setting, or the SDK's own native package).
- This path conflicts with decision 0001, which says the tool does not use the Agent SDK. Whether the SDK spawns the binary with a `-p`-like flag that would follow the `--bare` default change could not be verified from this repository.

### Path B: unmodified `claude` CLI in a PTY (off by default)

- Provider id `claude-code-cli`, `enabled: false` in `shared/settings/keys.ts`. CHANGELOG entry under 0.75.3: "The Claude Code CLI provider is off unless you turn it on, and is no longer labelled 'Subscription'". Earlier entry (0.65.0): "Run agent sessions on the genuine Claude Code CLI using your Claude Pro/Max subscription".
- The provider class `packages/runtime/src/ai/server/providers/ClaudeCodeCliProvider.ts` is an identity and model catalog; its `sendMessage` throws "not yet implemented (Phase 1)". Launching is done by the main-process launcher instead.
- Launcher: `packages/electron/src/main/services/ai/ClaudeCliSessionLauncher.ts` (orchestration), `claudeCliLauncherSingleton.ts` (production wiring), `claudeCliSpawnConfig.ts` (arguments and environment), spawn through `main/services/TerminalSessionManager.ts` (`createClaudeCliTerminal`) into a ghostty-web terminal strip (`renderer/components/UnifiedAI/ClaudeCliTerminalStrip.tsx`, `ClaudeCliPromptSurface.tsx`).
- Not `claude -p`. `claudeCliSpawnConfig.ts` header: "This runs the REAL interactive CLI — never `-p`/`--print`". This path does not depend on `-p` or on the `--bare` default.
- Arguments built: `--model <alias>`, `--mcp-config <temp file>`, `--resume <id>` or `--session-id <uuid>`, `--dangerously-skip-permissions` (only for workspaces the user trusted) or `--permission-mode default`, `--settings <temp file>`, `--add-dir`, `--plugin-dir` (one per extension plugin, when the CLI is at least 2.1.142), `--allowedTools mcp__<server>` for the app's own servers, `--disallowedTools AskUserQuestion`, `--append-system-prompt`.
- MCP and settings: the launcher writes `{ "mcpServers": ... }` to `os.tmpdir()/nimbalyst-claude-cli/<sessionId>.mcp.json` and passes it with `--mcp-config`. It does not pass `--strict-mcp-config`; a code comment (NIM-2372) says that flag made the binary ignore `~/.claude.json`, project `.mcp.json`, enterprise config and claude.ai connectors. The app's per-server off switch is written into the CLI's own `disabledMcpServers` instead (`claudeCodeDisabledServers.ts`, named in the comment).
- Under an enterprise `managed-mcp.json` the launcher passes no MCP config at all.
- Input: the app types the prompt into the PTY with bracketed paste and a separate Enter (`claudeCliSubmit.ts`, `claudeCliPromptComposer.ts`). Attachments are referenced by absolute path inside the prompt line; selection and active file are appended as one compact line.
- Status tracking: not by hooks. The app polls the CLI's per-process state file `~/.claude/sessions/{pid}.json` for `busy`, `shell`, `idle`, `waiting` (`claudeCliPidState.ts`; its header notes the schema is undocumented and floats with the CLI version). `claudeCliLauncherSingleton.ts` maps this to the session running/idle/waiting indicator.
- Hooks used: one `PreToolUse` command hook registered through the per-launch `--settings` file for `Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch` (`claudeCliPermissionHookConfig.ts`, script `packages/electron/resources/claudeCliPermissionHook.cjs`). It POSTs to the app's loopback `/permission` endpoint (`main/mcp/httpServer.ts`), bearer-gated, which renders a permission widget. Comment: the interactive CLI ignores `--permission-prompt-tool`; a `PreToolUse` hook is what works.
- Transcript observation: a per-session local HTTP proxy. The launcher sets `ANTHROPIC_BASE_URL` to a loopback proxy (`claudeCliObservationSingleton.ts`, `claudeCliObservation/claudeApiProxy.ts`), tees the request body and the SSE response, and persists assistant turns, tool results and context usage. The proxy forwards headers unchanged; its header comment says the OAuth token "rides along in the headers; we never read" it. This puts a local process in the path of the subscription traffic. Decision 0001 says the tool does not handle claude.ai credentials; the proxy sees them in flight, so this needs a decision (see section 12).
- Env: strips `ANTHROPIC_API_KEY` and `CLAUDECODE`, sets `ENABLE_TOOL_SEARCH=true` by default, `CLAUDE_CODE_EFFORT_LEVEL` when selected.
- Version dependence: comments reference CLI 2.1.141, 2.1.142 and 2.1.220. Behavior against 2.1.326 was not tested.

### Other agents

- Codex: `OpenAICodexProvider.ts` (SDK and app-server protocols), `OpenAICodexACPProvider.ts` (ACP).
- ACP or structured CLI providers: `CopilotCLIProvider.ts`, `GrokBuildProvider.ts` (`grok agent stdio`), `CursorAgentProvider.ts`, `OpenCodeProvider.ts`, shared body in `HeadlessCliAgentProvider.ts`.
- Gemini: `GeminiAntigravityProvider.ts`, Connect-RPC over the user's Antigravity login (`docs/FEATURE_INVENTORY.md`). No provider for the Gemini CLI found.
- Kimi: no provider found. A grep for kimi and moonshot hit only `OpenCodeConfigService.ts` and one renderer test.
- Extension-contributed agent providers: `ExtensionAgentProvider.ts` with the `AgentProtocol` interface in `packages/extension-sdk/src/agents/AgentProtocol.ts`, hosted in a privileged backend module.

## 5. Slice analysis

Method: reading code only. Estimates are working days for one engineer plus agents to reach a working slice, including tests that the repository's own rules require. Confidence is medium-low for all estimates because nothing was run.

### S1 Nested folder tree with drag and persistence

What exists: user-created grouping containers named workstreams (`session_type = 'workstream'`), shown with a folder icon, created from a "New Workstream" menu entry (`SessionHistory.tsx`, `createWorkstreamAtom`), filled by drag and drop (`SessionListItem.tsx`, `useSessionTreeMove.ts`), with an undo toast. Moves go through `sessions:set-parent` (`main/ipc/SessionHandlers.ts`) into `AISessionsRepository.updateMetadata` and persist as `parent_session_id` in the database. Sessions themselves nest to a large depth (`docs/SESSION_HIERARCHY.md`).

What blocks the requirement:
- `main/services/sessionHierarchy.ts`: "Workstream and Blitz containers must remain roots" and "cannot belong to a worktree".
- `useSessionTreeMove.ts`: `isDraggable` is false for `workstream` and `blitz` rows; `canJoinWorkstream` excludes worktree sessions.
- `sessionTreeModel.ts`: `sessionMoveError` refuses workstream sources.
- Semantics are blended: a container is never a manager, an unmarked container with one session merges into that session in the sidebar, the `userWorkstream` marker is local to one desktop, worktrees and Blitz rows have their own grouping.

Files that would change: `main/services/sessionHierarchy.ts`, `renderer/components/AgenticCoding/useSessionTreeMove.ts`, `sessionTreeModel.ts`, `SessionHistory.tsx`, `WorkstreamGroup.tsx`, `SessionListItem.tsx`, `main/ipc/SessionHandlers.ts`, `main/services/ai/mobileSessionHierarchy.ts` (guard for the mobile sync path), tests under `AgenticCoding/__tests__/` and `main/services/__tests__/`.

Extension point: none for the Agent mode session list. Extension panels with `placement: "sidebar"` render only in Files mode, in a fixed-width box (`renderer/App.tsx`, block `extension-panel-sidebar`), and the gutter code for sidebar panels is tied to `contentMode`. A new session tree cannot be added as an extension to Agent mode.

Effort: 5 days, ranging 4 to 7. Risk: `SessionHistory.tsx` is large and changed often (see section 8); the plan's 3-day stop rule is likely to trigger, which would mark the sidebar as hard to change.

### S2 Start a task from a plain prompt, a GitHub PR URL and a Jira key

What exists:
- Plain prompt: new session action `dispatchCreateNewSession` (`renderer/store/actions/sessionHistoryActions.ts`), launch popup (`UnifiedAI/SessionLaunchPopup.tsx`, `store/atoms/sessionLaunchPopup.ts`), title bar create (`store/atoms/titleBarCreate.ts`), initial prompt queue (`claudeCliQueueDispatch.ts`, `queuedPromptDispatcher.ts`). The MCP tool `spawn_session` starts a session from a prompt (`main/mcp/metaAgentServer.ts`).
- GitHub PR: PR mode lists repository PRs from `gh` (`main/services/GhApiService.ts`, `main/ipc/PullRequestHandlers.ts`, `renderer/components/PullRequestMode/`), creates a tracker overlay per PR and review sessions linked to it (`main/services/GithubPrOverlayService.ts`, which also holds `canonicalPrUrl` for URL parsing, `PrTrackerLifecycle.ts`). PR URL parsing accepts github.com only.
- Jira: no integration found. The only Jira-related code is a preset entry in `renderer/components/GlobalSettings/panels/MCPServersPanel.tsx` that runs `npx mcp-remote https://mcp.atlassian.com/v1/sse` as a user MCP server. The tracker importer extension `packages/extensions/github-issues-importer` shows the importer contribution shape, but an importer would need Jira credentials, which decision 0001 excludes.

What to add: a start dialog that accepts a prompt, a PR URL or a Jira key or URL. PR URL: parse (reuse `canonicalPrUrl`), fetch metadata through `GhApiService`, optionally check out into a worktree (`GitWorktreeService.ts`), create the session with PR context and link the overlay. Jira key: create a session whose first prompt tells the agent to fetch the issue with the Atlassian connector tools, with no Jira code in the app. This depends on the connector being authorized and visible in the CLI session; the launcher code keeps connectors (no `--strict-mcp-config`), but connector OAuth inside the PTY path was not tested.

Files that would change: `UnifiedAI/SessionLaunchPopup.tsx`, `store/atoms/sessionLaunchPopup.ts`, `store/actions/sessionHistoryActions.ts`, `main/services/GithubPrOverlayService.ts`, `main/ipc/PullRequestHandlers.ts`, `main/services/GhApiService.ts`, `main/services/GitWorktreeService.ts`, a new prompt-template module.

Extension point: backend module `ctx.services.sessions.create` (`packages/extension-sdk/src/types/backendSessions.ts`) creates owned sessions and workstreams, gated by the `ai-sessions` permission. The doc comment says `directive` is rejected for `claude-code-cli`; whether `create` accepts `claude-code-cli` as provider was not verified.

Effort: 3 days, ranging 2 to 4.

### S3 UI parity through a local MCP server

What exists: the app hosts MCP servers inside main on one loopback port with per-endpoint tool subsets (`main/mcp/httpServer.ts`, topology in `packages/runtime/src/ai/server/services/mcpTopology.ts`, registration in `packages/runtime/src/ai/server/services/McpConfigService.ts`). Per-launch bearer token (`main/mcp/mcpAuth.ts`), per-session URL carrying `sessionId`, `type: 'sse'` entries with `headers`. Main-to-renderer calls use `requestFromRenderer` (`main/mcp/rendererRequest.ts`). Extensions add tools through `aiTools` in the manifest and `registerMcpTools` in backend modules, each served at `/mcp/ext/<id>`.

Which of the four named capabilities exist as tools:
- Start a task: yes, `spawn_session` and `create_session` (`metaAgentServer.ts`).
- Create a folder: no tool for the session tree. `createSharedFolder` and `moveSharedItem` exist but act on the Team and Personal page tree (`SITUATIONAL_TOOLS` in `mcpTopology.ts`), not on sessions.
- Move a session: no tool. The UI action exists only as IPC `sessions:set-parent`. `update_session_board` changes the kanban phase and tags only.
- Open a file: no general tool. `extension_test_open_file` exists in the developer-mode server (`main/mcp/extensionDevServer.ts`), is labelled for Playwright testing, and sends `extension-test:open-file` to the renderer; it is a template for the real tool.

What to add: tools `session_create_folder`, `session_move`, `file_open`, `task_start` (and a parity table covering the sidebar, tabs, PR and settings actions). Implementation: schemas in `mcpTopology.ts` (`HOST_TOOLS`), dispatch in `httpServer.ts` or a new server file modelled on `sessionContextServer.ts`, main-side calls straight to `AISessionsRepository` for moves (as `sessions:set-parent` does) followed by the `sessions:refresh-list` broadcast, renderer requests through `requestFromRenderer` for opening files and tabs (`main/ipc/OpenFileHandlers.ts` is the real open path).

Existing parity for other actions: settings (`settings_get_overview`, `appearance_*`, `workspace_open`), trackers (`tracker_*`), kanban, notifications (`notify_user`), interactive prompts (`AskUserQuestion`, `PromptForUserInput`), widgets (`display_to_user`), commit proposals (`developer_git_commit_proposal`). Parity for PR actions, git panel, worktree actions and tab management was not found.

Effort: 6 days for the four tools plus the sidebar, files and PR actions, ranging 5 to 8. Full parity across every UI action in the app is larger and open-ended.

### S4 Context attach (file, selection, agent message, image into the composer)

What exists:
- File: `@` file mention typeahead (`store/atoms/fileMention.ts`), attachments through `main/services/AttachmentService.ts` and `main/ipc/AttachmentHandlers.ts` with a staging directory.
- Selection: chips (`UnifiedAI/SelectionChips.tsx`, `TextSelectionIndicator.tsx`), editor context items (`setEditorContextItems` in the EditorHost contract, `docs/EXTENSION_ARCHITECTURE.md`).
- Image: paste (`UnifiedAI/usePastedImage.ts`).
- Agent output: `@@` session mentions (`store/atoms/sessionMention.ts`, `UnifiedAI/sessionMentions.ts`) and `list_citable_inputs` (listed in `HOST_TOOLS`). What a session mention injects into the prompt was not read.
- CLI path composition: `claudeCliPromptComposer.ts` writes attachment paths and a one-line context block into the PTY line. The docs note that selection context flows to the SDK providers (`claude`, `claude-code`); the CLI path has its own composer.

What to add: an "attach to composer" action on a single transcript message (write the message text to a staged file and add it as an attachment), plus checks that each source reaches the CLI path. Files: `UnifiedAI/AIInput.tsx`, `SessionAIInput.tsx`, `main/services/AttachmentService.ts`, transcript message actions under `packages/runtime/src/ui/AgentTranscript/`, `claudeCliPromptComposer.ts`.

Effort: 3 days, ranging 2 to 4.

## 6. Existing MCP in the app

- Hosted locally in the Electron main process, one loopback HTTP port, bearer token generated per launch, no account required (`main/mcp/httpServer.ts`, `mcpAuth.ts`, `docs/INTERNAL_MCP_SERVERS.md`). `/clip` and the `/mcp` endpoints differ in guards: the `/mcp` endpoints use the bearer token as the only gate and do not send an `Access-Control-Allow-Origin` header; an Origin allow-list (`clipRequestGuards.ts`) applies to `/clip` only. The spike plan asks for an Origin check on the MCP server; this server does not add one beyond CORS omission.
- Registration with the CLI: `McpConfigService.getMcpServersConfig` returns entries of the form `{ type: 'sse', url: 'http://127.0.0.1:<port><endpoint>?...&sessionId=<id>', headers: { Authorization: 'Bearer <token>' } }`. The CLI path writes them to the temp `--mcp-config` file; the SDK path passes the same map in `mcpServers`. The core endpoint sets a long tool timeout because interactive tools block on the user.
- Servers and tools (names from `mcpTopology.ts`):
  - `nimbalyst` (core, `/mcp/core`): `AskUserQuestion`, `PromptForUserInput`, `display_to_user`, `update_session_meta` (always loaded); `capture_editor_screenshot`, `get_session_edited_files`, `developer_git_commit_proposal` (deferred).
  - `nimbalyst-host` (`/mcp/host`, deferred): settings and app control (`settings_get_overview`, `appearance_set_theme`, `appearance_set_completion_sound`, `appearance_set_spellcheck`, `appearance_set_spellcheck_languages`, `ai_set_default_model`, `ai_set_preferred_language`, `analytics_set_enabled`, `features_toggle`, `extension_set_enabled`, `extensions_list`, `sync_set_for_project`, `workspace_create`, `workspace_open`, `workspace_set_trust`); session context (`get_session_summary`, `get_session_coaching_signals`, `get_workstream_overview`, `get_workstream_edited_files`, `list_recent_sessions`, `schedule_wakeup`, `update_session_board`, `list_citable_inputs`); orchestration (`create_session`, `spawn_session`, `send_prompt`, `list_queued_prompts`, `notify_user`, `respond_to_prompt`, `get_session_status`, `get_session_result`, `list_spawned_sessions`, `list_worktrees`, `consume_session_inbox`).
  - `nimbalyst-trackers`: `tracker_*` tools, `work_radar`.
  - `nimbalyst-situational`: voice, collaborative document and page tree tools (`createSharedDoc`, `createSharedFolder`, `moveSharedItem`, `listPages`, and others), feedback tools, `RequestFeedback`.
  - `nimbalyst-<extension>`: one deferred server per active extension (`/mcp/ext/<id>`).
  - `nimbalyst-extension-dev` (own port, developer mode): `extension_*`, `renderer_eval`, `get_renderer_debug_logs`, `database_query`, `restart_nimbalyst`, `extension_test_open_file`.
- Tools that touch the UI: `AskUserQuestion`, `PromptForUserInput`, `display_to_user`, `developer_git_commit_proposal`, `capture_editor_screenshot`, `update_session_meta`, `update_session_board`, `notify_user`, `workspace_open`, `appearance_*`, `create_session`, `spawn_session`, extension editor tools, `extension_test_open_file`, `renderer_eval`.
- Cloud: the situational page-tree and collaboration tools need the vendor account and sync server (section 9). A separate remote MCP server for the wiki plugin is described in `docs/FEATURE_INVENTORY.md` and needs a Nimbalyst account for team pages.

### How `AskUserQuestion` reaches the CLI

The CLI path disables the CLI's built-in `AskUserQuestion` (`--disallowedTools AskUserQuestion`), appends a system prompt line telling the model to call `mcp__nimbalyst__AskUserQuestion` or `PromptForUserInput`, and pre-allows the app's servers (`--allowedTools mcp__nimbalyst ...`). The tool call blocks in `main/mcp/tools/askUserQuestionHandler.ts` and `interactiveToolHandlers.ts` until the renderer widget answers over IPC. The tracker tools register the same way, as a separate `nimbalyst-trackers` entry (`McpConfigService.ts`).

## 7. Telemetry and auto-update

### Telemetry

- README, section Telemetry: "Nimbalyst sends **anonymous usage analytics** to PostHog". Opt-out in Settings, Advanced, Analytics. Event list in `docs/POSTHOG_EVENTS.md`.
- Main process: `main/services/analytics/AnalyticsService.ts` with `posthog-node`, a hard-coded project key, `privacyMode: true`, `disableGeoip: false`, `enableExceptionAutocapture: false`. The store default is enabled: `getAppStore().get('analyticsEnabled', true)` and `analyticsEnabled: true // Default to enabled` in `main/utils/store.ts`. If the setting cannot be read, `allowedToSendAnalytics` returns true (comment: "Fail open").
- Renderer: `renderer/index.tsx` initializes `posthog-js` with `autocapture: false`, `disable_session_recording: true`, `capture_exceptions: false`, `capture_pageview: false`. `renderer/utils/analyticsConsent.ts` defaults to denied until main reports the setting.
- Environment switch: `NIMBALYST_DISABLE_ANALYTICS=1` turns everything off (`analyticsSuppression.ts`).
- Inconsistency: `docs/ANALYTICS_GUIDE.md` says opted-out users still send a `nimbalyst_session_start` retention ping, and a comment in `AnalyticsService.setSessionId` says the same, but the code in that method returns early when `allowedToSendAnalytics()` is false. Not resolved without running the app.
- Other outbound calls seen in code: `https://extensions.nimbalyst.com/registry` (extension marketplace, `main/ipc/ExtensionMarketplaceHandlers.ts`), `https://console.nimbalyst.com` links, and `https://sync.nimbalyst.com` (section 9). The `claude-code-cli` path adds a loopback proxy to `api.anthropic.com`.
- A fork would remove or hard-disable PostHog; touching points: `AnalyticsService.ts`, `renderer/index.tsx`, and the many call sites of `trackCreateAISession` and similar helpers.

### Auto-update

- `main/services/autoUpdater.ts` uses `electron-updater` with a GitHub provider: `GITHUB_UPDATE_PROVIDER = { provider: 'github', owner: 'nimbalyst', repo: 'nimbalyst' }`. `autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true;`. Channels stable and alpha (`getReleaseChannel`). README: "Nimbalyst automatically checks for updates and notifies you when a new version is available."
- `packages/electron/package.json` `build.publish` points to the same GitHub repository. A fork would need to change the provider or disable the service, and the app is not signed for a fork's feed.
- Extensions update silently from the marketplace registry (`ExtensionMarketplaceHandlers.ts`, comment "Auto-updating extensions silently").

## 8. Upstream health

Read-only `gh api` calls, run on 2026-11-17. See the measurements table below for numbers. Observations:

- Activity is very high and sustained across the eight-week window, with a peak in October. Releases are frequent, many marked prerelease, with a stable channel promoted less often.
- Contribution is concentrated in one account. A second account has a large all-time count. The remaining contributors are individuals with small counts.
- Issue volume is large, and a sample shows that many recent issues receive no non-author comment on the issue thread. Pull requests get a first non-author comment slower than issues in the sample. The maintainers also work from an internal tracker (`NIM-` keys in `CLAUDE.md`), so GitHub response time understates their activity. Low confidence.
- Churn on files a fork would patch is high for `SessionHistory.tsx` and moderate for the hierarchy, MCP and composer files (table below).
- The repository `CLAUDE.md` and `.claude/` rules describe a workflow run mostly by agents (orchestrators, parallel sessions, a token-discipline rule). This is context for the commit rate and not a quality judgement.

### Measurements (dated 2026-11-17)

| Measure | Value | Method |
| --- | --- | --- |
| Stars / forks | 2083 / 340 | `gh api repos/Nimbalyst/nimbalyst` |
| Created | 2025-10-30 | same |
| Last push | 2026-11-15 | same |
| Open issues + PRs (API field) | 840 | same |
| Open issues / open PRs | 768 / 72 | search API |
| Repo size (KB) | 103687 | same |
| Tracked files at clone | 9516 | clone output |
| Commits, 2026-09-22 to 2026-11-17 | 733 | commits API with `since` |
| Commits per ISO week, W37..W46 | 1, 49, 72, 180, 141, 106, 49, 51, 84 | same, grouped by author date (W38 absent) |
| Top committer share in window | 648 of 733 (88%) | same, login `ghinkle` |
| Next committers in window | 28, 15, 8, 8, 8 | same |
| Contributors (all time, API list) | 58 | contributors API |
| Top two all-time contribution counts | 5181, 1279 | same |
| PRs opened in window / merged | 116 / 61 | search API |
| Issues opened in window / closed | 283 / 74 | search API |
| Releases 2026-09-14 to 2026-11-15 | 30 listed on first page, latest v0.84.1 (2026-11-15), latest stable v0.83.0 (2026-11-10) | releases API |
| Stable releases in listed range | v0.83.0, v0.82.8, v0.81.7, v0.80.6, v0.79.1, v0.78.5 | same |
| Issue first non-author comment, sample of 25 issues created 2026-10-01 to 2026-11-05 | 5 had one; median 20.8 h among those | issue comments API |
| PR first non-author comment, sample of 25 PRs, same dates | 13 had one; median 68.9 h among those | same |
| Median time to close, closed items in sample | issues 33.0 h (6 closed), PRs 72.1 h (18 closed) | same |
| Commits touching `SessionHistory.tsx` in window | 22 | commits API with `path` |
| `sessionHierarchy.ts` / `useSessionTreeMove.ts` / `sessionTreeModel.ts` | 7 / 3 / 5 | same |
| `httpServer.ts` / `mcpTopology.ts` | 11 / 7 | same |
| `ClaudeCliSessionLauncher.ts` / `claudeCliSpawnConfig.ts` | 1 / 3 | same |
| `AIInput.tsx` / `SessionHandlers.ts` | 9 / 8 | same |
| Lines: `SessionHistory.tsx`, `WorkstreamGroup.tsx`, `httpServer.ts` | 3679, 964, 1339 | file read |

Sample limits: the comment sample excludes review comments on PRs and does not exclude bot comments. The time-to-close figures cover only items closed by 2026-11-17. The root `package.json` shows version 0.33.1 while releases are at 0.84.x; the root version appears stale and was not investigated.

## 9. Cloud dependency

Needs the vendor account or servers (Stytch B2B login, `https://sync.nimbalyst.com`):
- Team collaboration: shared documents, shared trackers, Team wiki pages, organization management, feedback requests (`docs/COLLABORATION_GUIDE.md`, `docs/IDENTITY_AUTH_AND_ROOMS.md`, `StytchAuthService.ts`, `SyncManager.ts`).
- Personal mobile sync to the iOS and Android companions, with zero-knowledge encryption (`SyncManager.ts`, `CollabV3Sync`).
- Share links and exports to shared URLs (`main/ipc/ShareHandlers.ts`, `SHARE_SERVER_URL = 'https://sync.nimbalyst.com'`).
- Cloudflare sandbox and headless runner management (`main/services/cloudflareSandbox/`).
- Extension marketplace registry (`extensions.nimbalyst.com`), with a bundled mock registry fallback (`main/data/extensionRegistry.json`, imported in `ExtensionMarketplaceHandlers.ts`).
- Auto-update feed on GitHub.
- PostHog analytics.

Works without an account according to the docs and code read: the Local wiki (`docs/FEATURE_INVENTORY.md`: "works with no account and no team"), local trackers, sessions and the session tree, worktrees, Lexical editor and diffs, the app-hosted MCP servers, GitHub PR mode (uses the installed `gh` login), and the embedded terminal. The sync server URL appears in code as a constant used when sync or share features run; `docs/COLLABORATION_GUIDE.md` describes offline queues for collaborative documents once an account exists.

Not verified: that the app starts and works fully offline with no account. No run was made. The startup path installs a collab asset protocol handler that resolves the production worker URL (`main/index.ts`), which only builds the URL. Whether any startup call blocks without network is unknown.

For a personal fork, the account, sync, team, iOS, Android and sandbox code is dead weight. It is large (a long list of `Collab*` and `Team*` services under `main/services/` and the packages `collab-*`).

## 10. Extra checks

### Extension SDK: editors and a new sidebar tree

- Editors: manifest `contributions.customEditors` with `filePatterns`, `component`, `supportsSourceMode`, `supportsDiffMode`, `supportsTranscriptEmbed` (example `packages/extensions/mockuplm/manifest.json`, `excalidraw/manifest.json`). The renderer exports components, and each receives an `EditorHost` (`loadContent`, `saveContent`, `setDirty`, `onFileChanged`, `onDiffRequested`, `setEditorContextItems`). All editors, including built-in ones, go through this contract (`docs/EXTENSION_ARCHITECTURE.md`).
- Panels: `contributions.panels` with `placement` of `sidebar`, `fullscreen`, `floating` or `bottom`; `PanelHost` gives `openFile`, `openPanel`, `workspacePath` (`docs/EXTENSION_PANELS.md`, `packages/extension-sdk/src/types/panel.ts`).
- Other contributions: `aiTools`, `backendModules` with permissions (`workspace-files`, `nimbalyst-database-read`, `nimbalyst-database-write`, `secrets-read`, `mcp-server-register`, `ai-sessions`), `claudePlugin`, `trackerImporters`, `settingsPanel`, agent providers.
- A new sidebar tree: a `sidebar` panel can render a tree, but it mounts only in Files mode at a fixed width (`renderer/App.tsx`, `extension-panel-sidebar`; `NavigationGutter.tsx` ties sidebar panels to `contentMode === 'files'`). It cannot replace or extend the Agent mode session list, which is core code. A `fullscreen` panel could host its own tree but would not show the live session list. A panel can read session rows with the `ai_sessions` query surface mentioned in `panel.ts`, and a backend module can create owned sessions and workstreams. So a task tree built as an extension would be a separate screen, with sessions moved through the backend sessions service, which covers only sessions the extension owns.

### Lexical Markdown editor: document model and diff

- Document model: a Lexical node tree (`packages/runtime/src/editor/`, nodes in `editor/nodes/`, import and export through forked transformers in `editor/markdown/`: `EnhancedMarkdownImport.ts`, `EnhancedMarkdownExport.ts`, with a `FORKED_MARKDOWN_IMPORT.md` note). Markdown remains the file format. A Y.Doc based package exists (`packages/markdown-ydoc`) for collaboration.
- Diff mechanism: a tree diff, not a text diff. `editor/plugins/DiffPlugin/core/canonicalTree.ts` canonicalizes the Lexical forest into nodes with `id`, `type`, `text`, `attrs`, `children`; `TreeMatcher.ts` and `ThresholdedOrderPreservingTree.ts` match nodes with a similarity threshold (`calculateNodeSimilarity.ts`, `textDistance.ts`), producing `NodeDiff` entries (`add`, `remove`, `update`); text inside matched nodes gets a word-level diff (`diffWords.ts`, `inlineTextDiff.ts`, `formattedTextDiff.ts`). `standardDiffFormat.ts` converts to and from unified diff text.
- Review flow (`docs/FILE_WATCHER_DIFF_SYSTEM.md`): a `PreToolUse` hook tags the pre-edit content, the agent writes to disk, the watcher shows old versus new as red/green with accept and reject.
- Not an mdast tree. HTML pages: `renderer/components/HtmlPage/HtmlPageEditor.tsx` shows a sandboxed live preview with a Monaco source toggle; `MonacoDiffApprovalBar` handles code diffs. HTML diff is text-level from what was read; HTML has no document model.

### Mockup annotation

- `packages/extensions/mockuplm/src/components/useMockupDrawing.ts`: a red-pen canvas over the iframe of a `.mockup.html` file. Its header says the strokes are ephemeral: "an AI prompt affordance, not a persisted annotation". `MockupEditor.tsx` stores annotations in `window.__mockupAnnotations` per file and `captureMockupComposite` (`utils/screenshotUtils.ts`) renders the composite for the prompt; `UnifiedAI/MockupAnnotationIndicator.tsx` shows the state in the composer.
- It cannot annotate arbitrary images. `renderer/components/ImageViewer.tsx` is a plain viewer.
- Adjacent piece: the Excalidraw extension (`packages/extensions/excalidraw/src/components/ExcalidrawEditor.tsx`) wraps `exportToBlob` to produce a PNG of the scene (`exportToPngBlob`). Excalidraw supports image elements as a library feature; whether this extension exposes inserting a local image was not verified. An annotate-image flow would open an image in an Excalidraw scene, export PNG and attach it to the composer.

### Sync server dependency and offline use

- `wss://sync.nimbalyst.com` appears as `PRODUCTION_SYNC_URL` and similar constants in `main/services/SyncManager.ts`, `main/utils/collabSyncUrl.ts`, `main/ipc/SettingsHandlers.ts`, `StytchAuthService.ts`. The server is a separate project and not in this repository. Sync is tied to a signed-in account (`personalSyncProfiles` in `main/utils/store.ts`, Stytch session JWTs).
- Whether the app works fully offline was not run. By code reading, the features in section 9 that work without an account do not need the server. The CLI itself needs network for the model.

## 11. Requirement scores (as a fork target)

Scoring: 0 absent or infeasible, 1 major work, 2 moderate work, 3 works today. `effort_days` is the estimate to reach 3 for one engineer plus agents. R10 has weight 1. All effort numbers rest on code reading only. Confidence is stated where thin.

| Req | Score | Days | Rationale |
| --- | --- | --- | --- |
| R1 desktop GUI | 3 | 1 | Electron app with macOS builds. One day set aside for a clean build in a VM: Node 24, corepack-provided pnpm, native modules (`node-pty`, `better-sqlite3`), an `install` that runs a `prepare` script; build reproduction was not tested. |
| R2 attach context | 2 | 3 | File mentions, selection chips, pasted images, `@@` session mentions and path-based attachments in the CLI path exist. Attaching a single agent message is missing (S4). |
| R3 image annotation | 2 | 4 | Existing annotation is mockup-only and ephemeral. Excalidraw extension and PNG export exist as parts. An annotate-and-attach flow for arbitrary images is new work. Low confidence on Excalidraw image insertion. |
| R4 agents | 2 | 8 | Claude through the unmodified CLI in a PTY exists but is off by default, uses a loopback proxy for transcripts, and the default path is the Agent SDK. Work: make the CLI path the default and remove or disable the SDK path, test against CLI 2.1.326, decide on the proxy. Codex through SDK, app-server and ACP exist. Gemini is Antigravity only; Kimi has no provider; extension agent providers and ACP adapters exist as hooks for both. |
| R5 GitHub PR integration | 3 | 0 | PR list, detail, diff, review sessions and tracker overlay on top of `gh`. The PR URL entry point is counted in R6 (S2). |
| R6 task tree and task start | 2 | 8 | Session tree with containers and drag-and-drop persists today; nested folders need S1 (5 days). Starting from PR URL and Jira key needs S2 (3 days). Plain prompt works. Risk: S1 may exceed the 3-day stop rule. |
| R7 reuse connectors, skills, plugins, marketplace | 3 | 1 | The CLI path launches the real CLI with additive `--mcp-config`, no `--strict-mcp-config`, `--plugin-dir` for extension plugins; user skills and plugins load through the CLI. One day to confirm connector OAuth and plugin marketplace in the PTY path. Medium confidence, not run. |
| R8 agent parity through MCP | 2 | 6 | MCP infrastructure, token, per-session URL and renderer bridge exist, and session spawn tools exist. No tools for folder creation, session move or file open; parity beyond the sidebar not found (S3). |
| R9 LSP and AST refactor | 1 | 10 | Monaco only. No language client and no ast-grep or Serena integration found. A Monaco LSP client plus the Kotlin risk is new work; agent-side Serena and ast-grep are MCP configuration through the CLI and cost little. |
| R10 build tools by command line | 3 | 0 | Embedded terminal (`ghostty-web`, `node-pty`) and the agent's own shell. Weight 1. |
| R11 Markdown and HTML | 3 | 0 | Lexical Markdown editor with a tree diff and accept/reject; HTML preview with Monaco source. HTML has no document model and text-level diff; the requirement says "ideally". Medium confidence for HTML. |

R9 is the largest single effort item.

Must-haves per decision 0001 (R1, R2, R4 Claude, R5, R6, R7, R8): all score at least 2 on this reading. The weighted score and the greenfield comparison belong to the Phase 3 scorecard.

## 12. Items for a decision

1. Agent SDK versus CLI: Nimbalyst's default Claude provider uses the Agent SDK, which decision 0001 excludes. A fork that keeps only the PTY CLI path satisfies 0001 but starts from a provider that is off by default and flagged by its own changelog as separate from the recommended path.
2. Loopback proxy: the CLI path routes `ANTHROPIC_BASE_URL` through an in-app proxy so the app can build transcripts. The proxy forwards the subscription token header in flight. Decision 0001 says the tool does not handle claude.ai credentials. An alternative the code already has is transcript reconstruction from the CLI's own jsonl (named in the launcher comments as an observation backend; the jsonl bridge was not read in depth).
3. Account and sync code: removing it from a fork is a large cut; leaving it in keeps vendor URLs and an auth stack in a personal tool.
4. Telemetry: default on with opt-out; a fork should disable it at build time.

## 13. What could not be verified

- Nothing was built or run. Every behavior claim is from reading code and docs.
- Whether the `claude-code-cli` path works end to end on Claude Code 2.1.326, including the PID state file schema, `--plugin-dir`, bracketed-paste submit and the proxy.
- Whether claude.ai connectors (Atlassian) load and authorize inside the PTY session launched with `--mcp-config`. The launcher comments say connectors stay available.
- Whether the Agent SDK path runs the binary in a mode affected by the `--bare` default.
- Offline startup and use without an account.
- Whether the PostHog retention ping is sent for opted-out users (docs say yes, the code read says no).
- The `ClaudeCodeCliProvider` stub versus the working launcher: how the renderer chooses between them for a `claude-code-cli` session was read only at the IPC level (`main/ipc/TerminalHandlers.ts`).
- Excalidraw image insertion, HTML diff in the app, what `@@` session mentions inject.
- The jsonl observation backend in `claudeCliObservation/claudeCliTranscriptBridge.ts` was only skimmed.
- Effort estimates have wide ranges and carry the uncertainty of reading without running.
- Upstream response-time numbers come from a small sample and exclude the internal tracker.
