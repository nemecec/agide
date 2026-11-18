# 0029 Milestone 3 architecture and contracts

Status: accepted
Date: 2026-11-17
Decided by: spike agents
Inputs: 0010, 0011, 0013, 0019, 0022, 0023, 0024, 0025, 0026, 0027, 0028; `notes/probes-m3-permissions.md` (P20 to P24), `notes/probes-m3-isolation.md` (I1 to I3), `probes/RESULTS.md` (PB1 and the milestone 3 sections); the milestone 2 code in `app/`

## Context

0026 (browser surface and observation), 0027 (agent nodes and usage) and 0028 (permission model and task start) are reviewed designs, each with a first slice. The permission probes P20 to P24 and the isolation probes I1 to I3 ran against the CLI 2.1.326 and were reviewed. 0025 records the user's decisions: the permission mode is selectable per profile and per session with auto as the default, local agents run as the user, and the isolation providers for Anthropic's sandbox runtime (srt) and a container are part of milestone 3.

The builders w-browser, w-agents, w-permissions, w-tasks and w-iso work next, in parallel. As in 0013 and 0023 they need the contracts fixed first and files that do not overlap. Milestone 2 showed where builders collide: the session launch, the MCP server, the tree pane and the setup pane are touched by almost every slice. This record states the slices, the provider designs from the probes, the probe results that change earlier records, the modules and contracts that now exist in the code, the seams that keep the builders out of each other's files, who owns which file, the module initialization order, the test strategy, and the choices made while writing the contracts.

## Decision

### Slices

| Builder | Slice | From |
|---|---|---|
| w-browser | The first slice of 0026 section 9: the first-slice Electron checks with result lines in `probes/RESULTS.md`; the pure modules (address policy, service table and recognizer for Slack and Notion, site table and acting-call classifier, tab id table, ref table, redaction, digest builder, truncation and labels); `main/browser` (view registry and parking, placement, suspend and resume with stills, partitions and handlers, guards, downloads, dialogs, crash, CDP wrapper with a fake CDP transport); the `browser-tab` surface with its tab chrome and `slack-thread` as its Slack variant; the `agide-browser` endpoint with the tools marked "yes" and the site check; `surfaces_observe`, `ui_set_observation`, the indicator, the SQLite access log with the per-tab popover, `surface_highlight` for tabs, `browser_open_in_chrome`, the digest file and hook, capture composition and masks in `ui_capture_window`, `--no-chrome` with its profile setting | 0026 sections 1 to 9 |
| w-agents | Items 1 to 4 of 0027's first slice first (normaliser and adapters with fixtures, the SQLite `AgentStore` with migration 1 and the repair at start, tree rows with state, count, waiting marker, finished tally and removal timers, the history and transcript panes with transcript copies, the status line command, `UsageCollector`, price table, rates, `usage_totals` and `plan_usage`), then items 5 and 6 (ranking pane, heat markers, folder rollups, own-profile plan usage and forecast in the rail, alerts with pause and stop), and probes U1, U3 and U4 | 0027 "First slice for milestone 3" |
| w-permissions | Part 1 of 0028 section 8: `PermissionSettings` in the profile, the Permissions section, the new-session dialog, the mode on the session header from payloads, bypass refused on `local`; the class table, the rule generator, the shell parser and classifier; the inspector entry script and its `PreToolUse` entry with the latency measurement; the sandbox settings with `strictAllowlist` and the `GIT_CONFIG_COUNT` rewrite; class on approval items and the `gate:deny`, `gate:notify` and sandbox-block status items; the real-Claude gate script; probes Q1 to Q7 | 0028 sections 1 to 8 |
| w-tasks | Part 2 of 0028 section 14: source parser use, prompt composer and `task-source.md` writer; the PR reader over `gh` with a fake `gh`; the worktree manager on temporary repositories with a local bare remote carrying `refs/pull/1/head`, and the removal question on folder deletion; folder-trust handling with recorded P24 frames and the profile setting; the `tasks` module with `task_starts`, `task_start` (UI and MCP), the new-task dialog, the browser leaf and the 0021 task link; the real-Claude prompt start script | 0028 sections 9 to 14 |
| w-iso | The srt provider and the container provider below, each passing the shared provider contract; provider choice per profile in the settings panel with the provider's check and its capabilities in words; a real-Claude script under srt (Haiku, empty temporary directory) | this record, "Isolation providers" |

What waits is listed in 0026 section 9, 0027 "What waits" and 0028 sections 8 and 14. Added here: a provider per session (the new-task dialog offers the profile's provider only, because `sessions` has no provider column), the `http` hook transport (no provider in this milestone needs it), and the OpenShell provider (milestone 4, 0025).

### Isolation providers from the probes

The srt and container providers implement the 0022 interface and run the shared contract suite. Both are implemented (`core/isolation/SrtProvider.ts`, `ContainerProvider.ts`) with the capabilities below, and the contract suite runs against them with the fake claude where the runtimes exist: srt with the `srt` found through `AGIDE_SRT_BIN`, the probe's install prefix or `PATH`, and the container where `docker` and the test image exist. The e2e tests use a fake `srt`.

srt (I1, `notes/probes-m3-isolation.md`):

| Aspect | Design |
|---|---|
| Command | `srt -s <settings file> -- claude <args>`. The `--` is required; without it srt's own `--settings` option takes the CLI's argument (I1). |
| Settings file | Generated per session under `<profile data>/isolation/srt/` (0700, file 0600): `filesystem.allowWrite` with the workspace, the session's hook inbox, the CLI temp directory `/private/tmp/claude-<uid>`, and the Claude configuration (the profile's directory, or `~/.claude` and `~/.claude.json` for the CLI default login); `network.allowedDomains` from `NetworkPolicy` plus the Anthropic API and sign-in hosts the CLI needs and `127.0.0.1`; `allowPty: true`; `allowLocalBinding: true`. |
| Why the extra settings | Without `allowPty` the Seatbelt profile denies the termios ioctls, Enter arrives as a line feed and the trust dialog cannot be answered. Without `allowLocalBinding` the MCP client gets EPERM, because srt sets `NO_PROXY` for loopback and the client dials `127.0.0.1` directly. Without the temp directory the Bash tool fails on a mkdir. |
| Capabilities | `filesystem: 'enforced'`, `network: 'allowlist'`, `login: 'host-keychain'`, hooks `inbox-dir`, transcripts `host-files`. |
| Limits stated in the settings panel | Loopback is open to the agent on every port (`allowLocalBinding`). The Keychain stays readable, so the agent can read its own login. srt adds about 0.2 s to a start. |
| `terminate` | SIGTERM goes to the srt process, which passes it to the inner process. SIGKILL goes to the process group the PTY child leads, because killing srt alone left the inner process running (seen by w-iso; no log kept). The SIGTERM test runs the real srt with a stand-in process; the SIGKILL test uses a plain process group without srt. |
| Install | The user installs `@anthropic-ai/sandbox-runtime` with pnpm; the profile's `isolation.options` names the `srt` path. The check reports a missing binary with that fix. Installing from the app waits. |

Container (I2):

| Aspect | Design |
|---|---|
| Command | `docker run -it --rm --init --label agide.session=<session id> --name agide-<session id> --user <uid>:<gid> --env-file <0600 file> -v <workspace>:<workspace> -v <session files>:<session files>:ro -v <hook inbox>:<hook inbox> -v <provider Claude dir>:<same path> -w <cwd> <image> claude <args>`: one container per launch, mounts at the same absolute path, so transcript and hook paths need no mapping (0022). |
| MCP | `mcpEndpoint` returns `http://host.docker.internal:<port>/mcp/<session>` with `hostHeader` `host.docker.internal:<port>`; the session module passes that `Host` into the grant, and the server accepts it for that session only (built in this step). |
| `terminate` | SIGTERM to the docker client is forwarded and SessionEnd runs (I2). SIGKILL of the client leaves the container running, so `terminate('SIGKILL')` runs `docker kill agide-<session id>`. Start-up removes containers with the `agide.session` label left by a crash. |
| Capabilities | `filesystem: 'enforced'`, `network: 'none'` (no egress policy; a proxy container comes later), `login: 'environment-file'`, hooks `inbox-dir`, transcripts `host-files`. |
| Claude in the image | No Linux `claude` build was available and the image would exceed this run's 100 MB pull limit. The provider is built and tested against `probes/fixtures/fake_claude.sh` on a local alpine image; the contract suite runs where `docker` and that image exist and is marked unavailable elsewhere. The settings panel lists the provider as not verified with Claude, and it is not offered for real sessions until a real `claude` has run in it (D3). |

Bypass: srt meets the rule of 0028 section 6 (enforced filesystem, process-wide allowlist); the container does not. Q2 is not probed, so the build offers bypass on srt under the stricter rule of 0028 section 6: the inspector turns an ask into a deny under bypass, and bypass is refused when the inspector cannot run ("Changes after review").

### Probe results that change earlier records

These records are not rewritten; the statements below need amendment when each is next revised.

0010:

| 0010 statement | Finding | Amendment |
|---|---|---|
| Section 6: "the sandbox network allowlist as the guarantee for CLI writes" | P23: in auto mode the model re-runs a blocked command with a per-command `allowed_domains` input and the classifier approves it. `network.strictAllowlist: true` refuses that input; `deniedDomains` holds. Plain ssh and git over ssh fail inside the sandbox. | The allowlist is a guarantee only with `strictAllowlist`; git over ssh needs the app to do the fetch outside the sandbox (0028 section 5). |
| Section 8: "a timed-out `PreToolUse` hook lets the call through" | P21: a timeout and exit 1 hand the call to the mode, which in auto runs it; exit 2 blocks; `"onFailure": "block"` is not probed (Q1). | Confirmed; the fail-open case needs static ask rules for draft and approve classes. |
| Consequences: the gate depends on unprobed ask rules on connector names in auto mode, `updatedInput` and `PreToolUse` precedence | P20: ask rules from `--settings` prompt in auto mode for a Bash pattern, an app MCP tool and an Atlassian connector tool, in `-p` and the TUI. P21: deny rules and hook deny win, then ask rules and hook ask, then allow; a hook allow does not lift an ask rule; `updatedInput` applies before the prompt. | Settled for Atlassian; Slack and Notion connector rules and connector write calls stay open (Q7). |

0011:

| 0011 statement | Finding | Amendment |
|---|---|---|
| Not verified: "whether permission rules and `can_use_tool` match `mcp__claude_ai_*` names in a run" | P20: an exact rule and a server wildcard on `mcp__claude_ai_Atlassian__*` prompt; the `can_use_tool` request names the server and the rule source. | Verified for Atlassian; Slack and Notion stay open. |
| Section 3: swarm agents start with "the sandbox settings" | P23 as above; P24: a fresh worktree raises the folder-trust dialog in the TUI and never in `-p`. | Sandbox settings carry `strictAllowlist`; app-started agents on stream-json need no trust answer; PTY task sessions do (0028 section 11). |
| Section 3: "A swarm under `bypassPermissions` is refused unless the policy allows it" | 0025 and 0028: bypass only inside a provider with an enforced filesystem and a process-wide allowlist. I1 shows srt qualifies, with loopback open and the Keychain readable; I2 shows the container has no egress policy. | Bypass for swarms needs srt and the outcome of Q2. |
| Section 1 table: PR start uses "a worktree for the head ref" | 0028 review: fetch `pull/<n>/head` from the remote that matched `owner/repo`, since `origin` in a fork clone names another repository. | Use the matched remote. |

0019:

| 0019 statement | Finding | Amendment |
|---|---|---|
| The status line command "writes the received JSON to the session's events directory" | I1: under srt the hook writes only to a directory in `allowWrite`; I2: a bind-mounted events directory delivers files owned by the host user; I3: OpenShell has no host mount without an opt-in, and files leave the sandbox only through `sandbox download` or HTTP. | The events directory must be writable inside every provider; providers without a mount need another route for the status line snapshot (0027 section 6). |
| Plan usage comes from the status line `rate_limits` | P5 logs re-read in the 0027 review: stream-json carries `rate_limit_event` with `unifiedWindows.five_hour` and `seven_day` (`utilization` as a fraction, `resetsAt` in epoch seconds). | Add `rate_limit_event` as the plan source of app-started agents. |

0022:

| 0022 statement | Finding | Amendment |
|---|---|---|
| Section 6 row 2: srt, "Keychain access under the Seatbelt profile is unverified" | I1: the login works under srt; the srt profile allows the Keychain services, and an open-access test item was readable with `security`. The TUI needs `allowPty`, the loopback MCP server needs `allowLocalBinding` (which opens every loopback port), and the Bash tool needs `/private/tmp/claude-<uid>` writable. srt adds about 0.2 s. | `login: 'host-keychain'` holds; the provider sets these keys and states the loopback opening. |
| Probe D1: does Docker Desktop's host address reach a loopback service, with which `Host` | I2 with the fake claude: `host.docker.internal` reaches the server on `127.0.0.1`; the `Host` header is refused unless allowed. | Settled; the per-grant `Host` allowance is built. |
| Probe D2: ending the `docker exec` client can leave `claude` running | I2 with `docker run -it`: SIGTERM to the client is forwarded and SessionEnd runs; SIGKILL leaves the container running; a kill by pid file through `docker exec` ends it. | `terminate` sends SIGTERM to the client and uses `docker kill` for SIGKILL. |
| Section 5 table, container PTY attach through `docker exec -it` | I2 drove `docker run -it` per launch; PTY size, resize and Ctrl-C pass through. | One container per launch with `docker run -it --rm --init`. |
| Probe D3: login inside the container | Not run: no Linux `claude` build. | Still open. |
| Probes O1, O3, O7 | I3 with a fake claude: `sandbox exec --tty` and `sandbox connect` both give a working PTY; no host bind mount without the opt-in; files leave through `sandbox download` (paths under `/sandbox` only) or HTTP. The release archives install without Homebrew; the gateway needs `supervisor_network_mode = "bridge"`, plaintext loopback, `allow_unauthenticated_users = true` and launch-signing certificates. | Settled for the fake; OpenShell is milestone 4 (0025). |
| Section 5 table, network row for `local`: the Bash sandbox, "which 0010 and 0012 already assume" | P23 as under 0010. | `bash-allowlist` requires `strictAllowlist`. |

### Modules

```
src/core
  session      launchContributions.ts: LaunchContributor, LaunchContributors, mergeContributions; SessionInfo.permissionMode,
               SessionService.stop and setPermissionMode; PtySessionService options selectProvider, networkPolicy, contributors
  isolation    ClaudeLaunch.env, SessionFileName gains gate.json and digest.json; SrtProvider and ContainerProvider;
               IsolationProviders; defaultProviders.ts (createIsolationProviders, registerIsolationCommands)
  mcp          McpConfigJson gains the agide-browser entry with timeout; McpServerName; grant options with Host values;
               toolsFrom and callTool per server; Command.mcpServer in core/commands
  permissions  modes, action class ids and table type, PermissionSettings with zod schema and defaults, PolicyBuilder,
               HookInspector, PermissionService, the shell parser and classifier, the inspector entry and the contract suites
  browser      BrowserTabState, ServiceId, ServiceObject, service table, recognizer (Jira, GitHub, Slack, Notion), tool input schemas,
               ObservationService with the in-memory implementation and contract, BrowserService
  agents       AgentRef, AgentFact, AgentRecord, AgentStore with the in-memory implementation and contract, UsageAggregator,
               AgentsService
  tasks        TaskSource, the strict source parser, taskStartInputSchema, TaskStarter, PullRequestReader,
               WorkingDirectoryManager, TaskStartRecord, TasksService
  surfaces     ObserveSnapshot.kind gains tree
  blocks       first-party pane types agide/usage-ranking, agide/agent-history, agide/transcript-viewer, agide/observation-log
  events       AppEvent gains PermissionsEvent, BrowserEvent, AgentsEvent, TasksEvent
src/main
  context.ts   Services gains permissions, browser, agents, tasks; ModuleContext gains browserViews?
  browser/     views.ts: BrowserViews, the Electron seam of the browser module
  modules/     permissions.ts, browser.ts, agents.ts, tasks.ts
src/renderer
  dialogs/     dialogStore.ts, DialogHost.tsx, SettingsPanel.tsx; NewSessionDialog.tsx and newSession.ts, NewTaskDialog.tsx
  panes/       BrowserPane, UsagePane, AgentHistoryPane, TranscriptViewerPane; ObservationLogPane is a placeholder
  panes/tree/  AgentRows, SessionDecorations, BrowserTabDecorations, leafDecorations.tsx, createLeaf.ts
  panes/rail/  PlanUsage; panes/session/SessionHeader; panes/settings/PermissionsSection, IsolationSection
```

A builder may add folders for its slice: `core/usage` (w-agents), `main/browser/*` (w-browser), `renderer/panes/<area>/` for its own components. The test that keeps `src/core` free of Electron covers them.

### Contracts

Session launch (`core/session/launchContributions.ts`):

- A `LaunchContributor` has an `id` and `contribute(context)`. The session service asks every registered contributor before each spawn, for `create` and for `resume`, after the provider prepared the environment and before `mcp.json` is written. The context names the session, `resume`, the permission mode, the provider id and capabilities, the hook directory and the MCP URL as the CLI inside the environment sees them, a path mapper, and `writeSessionFile(name, content)`, which writes a 0600 session file through the environment and returns its path inside it.
- A contribution can add `settings` (a fragment of the `--settings` JSON), replace base hook events (`replacesBaseHooks`), and add arguments, environment variables and MCP servers.
- `mergeContributions` appends hook entries, `permissions.ask`, `deny` and `allow` rules and arguments in registration order. Every other settings key, every variable, every MCP server name and every replaced hook event may come from one contributor; a second one throws, and the name `app` is refused. The app's own hook entry of an event stays unless a contribution replaces it, and the app root deny rules stay first.
- A contributor that throws fails the launch with `launch_failed`, so a session never starts without the rules a module meant to add.
- `PtySessionServiceOptions.selectProvider(session)` and `networkPolicy(session)` are read before every launch, since they are needed before the environment exists.
- `SessionInfo.permissionMode` is the mode of the latest launch; `setPermissionMode` stores the mode for the next launch (nothing calls it from hook payloads; the stored mode is the one the session launched with); `stop` ends the process and keeps the session as `exited` (0027 section 11).

Isolation (`core/isolation/types.ts`): `ClaudeLaunch.env` adds variables for one launch on top of the profile environment; a launch variable cannot change `CLAUDE_CONFIG_DIR`. `SESSION_FILE_NAMES` lists `mcp.json`, `settings.json`, `gate.json` and `digest.json`. `describeIsolationProviderContract(name, create, { pending?, unavailable? })` skips the suite with `[pending <owner>]` or `[unavailable: <reason>]` in its title. `IsolationProviders` creates each provider once from its factory and refuses an id without one. `createIsolationProviders` and `registerIsolationCommands` in `defaultProviders.ts` are where w-iso adds providers and the provider-choice commands; the session module calls both.

MCP (`core/mcp/types.ts`, `core/commands/types.ts`): `Command.mcpServer` is `app` (default) or `agide-browser`; on `agide-browser` the tool name is the command id without `browser_`. `toolsFrom(registry, server)` and `callTool(…, server)` list and run only that server's commands, and a tool of another server answers `not_found`. `AppMcpServer.grant(sessionId, folderId, { hostHeaders })` allows those `Host` values for that session's requests; `McpConfigJson.mcpServers['agide-browser']` is optional with `timeout`. The `/mcp/<session>/browser` endpoint is w-browser's.

Permissions (`core/permissions/types.ts`, `schemas.ts`): the class ids of 0028 section 2 as a constant list; `ActionClass` with default mode, static ask rules, an optional hard floor and its network coverage; `PermissionSettings` with a zod schema that refuses bypass as a default, unknown class ids and hosts with paths; `ProfileSettings.permissions` is optional and `permissionSettingsOf` reads a missing key as auto, with the Bash sandbox off for the default profile and on for others. `PolicyBuilder.build` returns the ask and deny rules, the sandbox settings, the launch environment, the gate file content and the provider's network policy. `HookInspector.inspect` returns `deny`, `ask` or `none` with the class; `allow` is not a value of the type. `PermissionService` gives `settings`, `resolveMode`, `networkPolicy`, `table` and its launch contributor. `isLooser`, `MODE_ORDER` and `qualifiesForBypass` are pure helpers with tests.

Browser (`core/browser/types.ts`): `BrowserTabState` follows 0026 section 1; `recognize(url)` returns a `ServiceObject` for Jira, GitHub, Slack and Notion URLs and `undefined` for anything else; `BROWSER_TOOL_INPUTS` holds zod schemas of the Claude in Chrome tools with their first-slice status, and `isActingCall` classes calls for the site check. `ObservationService` keeps the switch per recorded surface (service default until the user changes it, `not_user` for an MCP caller, `not_found` for a surface it did not record) and the access log (origin only, `invalid` otherwise, newest first, prune by time). `BrowserService.openTab` is how other modules open a tab.

Agents (`core/agents/types.ts`): `AgentFact` and `TokenUsage` as in 0027 section 1. `AgentStore.apply` follows 0027 section 2: start, waiting and answered per request key, ended with outcome and basis, revival of an ended agent, each message id counted once, facts on `main` marking the session only, facts before their start kept for 5 seconds. `UsageAggregator` gives the ranking, rates, plan windows and session totals. `agents.changed` carries the changed records.

Tasks (`core/tasks/types.ts`): `TaskSource` (prompt, pull request, Jira key or URL), `parseTaskSource` with the strict forms of 0028 section 9, `taskStartInputSchema` of section 13, `TaskStarter.start(input, caller)`, `PullRequestReader`, `WorkingDirectoryManager` (default directory, repository by remote, worktree create and remove, `createdByApp` for the trust answer) and the `task_starts` row.

Main process: `ModuleContext.browserViews` is the Electron side of the browser module (`main/browser/views.ts`), passed by `main/index.ts` and absent in plain Node tests. Modules reach Electron only through `desktop` and `browserViews`.

Renderer: `dialogs/dialogStore.ts` opens one floating dialog at a time (`new-session`, `new-task`, `settings`); `DialogHost` renders it. The tree's background menu gains "Profile settings…" and every menu gains "New task…". "New Claude session" calls `startNewSession` and other surface types call `createSurfaceLeaf`, so the builders of those surfaces change what the menu does without editing the tree. `LeafDecorations` adds marks after a leaf's title by surface type; `AgentRows` renders under every session leaf. `SurfacePane` shows `BrowserPane` for `browser-tab` leaves. `TerminalPane` renders `SessionHeader`; `ProfileRail` renders `PlanUsage`.

### Order of module initialization

1. profile (no dependencies).
2. tree.
3. mcp (tree).
4. permissions (profile, launch): the session module asks it for the mode, the network policy and the rules of every launch.
5. session (tree, mcp, profile, permissions, launch): starts the MCP listener, builds the providers, registers the isolation commands.
6. layout (tree).
7. inbox (tree, sessions, profile).
8. browser (tree, mcp, sessions, profile, inbox, launch).
9. agents (tree, sessions, inbox, profile, launch).
10. tasks (tree, sessions, profile, permissions, inbox, browser, launch): last, because it opens browser tabs.
11. `mcp.start()` once more after every module registered its tools.

`launch` is one `LaunchContributors` object created in `modules.ts` before the modules. The session service reads it at each launch, so contributors registered by modules after the session module are in time for every launch; no session launches during init. Dispose runs in reverse order.

### Ownership

| Builder | Owns | Must not edit |
|---|---|---|
| w-browser | `src/core/browser/**` except the contract files; `src/core/mcp/**` except `types.ts` (the `/browser` endpoint, the guard path, the browser tool mapping); `src/core/tree/surfaceCatalog.ts` (whether agents may create `browser-tab` leaves); `src/main/modules/browser.ts`; `src/main/browser/**`, `views.ts` included; `src/main/windowCapture.ts`; the lines in `src/main/index.ts` and `src/main/window.ts` that create `BrowserViews`; `src/renderer/panes/BrowserPane.tsx`, `ObservationLogPane.tsx`, `panes/tree/BrowserTabDecorations.tsx`, `panes/tree/createLeaf.ts`, new files under `renderer/panes/browser/`; `browser_*`, `surfaces_observe`, `ui_set_observation` commands; `e2e/browser.spec.ts` and its fixture server; the first-slice check scripts and a real-Claude browser script | other modules, the contract files |
| w-agents | `src/core/agents/**` except the contract files; new `src/core/usage/**`; `src/main/modules/agents.ts`; `src/renderer/panes/UsagePane.tsx`, `AgentHistoryPane.tsx`, `TranscriptViewerPane.tsx`, `panes/tree/AgentRows.tsx`, `panes/tree/SessionDecorations.tsx`, `panes/rail/PlanUsage.tsx`, new files under `renderer/panes/agents/`; `agents_*` and `usage_*` commands; `e2e/agents.spec.ts`; probes U1, U3, U4 and the real-Claude subagent script | other modules, the contract files |
| w-permissions | `src/core/permissions/**` except the contract files; `src/core/inbox/HookItemMapper.ts` (class on approval items, gate and sandbox status items); `src/main/modules/permissions.ts`; the inspector entry and its build entry in `electron.vite.config.ts` (the one config change allowed to a builder); `src/renderer/dialogs/NewSessionDialog.tsx`, `dialogs/newSession.ts`, `panes/settings/PermissionsSection.tsx`, `panes/session/SessionHeader.tsx`; `permissions_*` commands; the e2e helper that clicks "New Claude session" in `e2e/integration.spec.ts` and the bypass line of `src/main/modules/appModules.test.ts`, when the dialog and the bypass rule change them; probes Q1 to Q7 and the real-Claude gate script | other modules, the contract files |
| w-tasks | `src/core/tasks/**` except the contract files; `src/main/modules/tasks.ts`; `src/renderer/dialogs/NewTaskDialog.tsx` and new files under `renderer/dialogs/task/`; `task_start`; `e2e/tasks.spec.ts`; the real-Claude task start script | other modules, the contract files |
| w-iso | `src/core/isolation/**` except the contract files; `src/renderer/panes/settings/IsolationSection.tsx` and new files under `renderer/panes/isolation/`; `isolation_*` commands; provider probe and real-Claude scripts under `probes/` and `scripts/` | other modules, the contract files |

Contract files belong to this step and change only through the integration step: `core/session/launchContributions.ts`, `core/session/types.ts`, `core/isolation/types.ts`, `core/isolation/isolationProviderContract.ts`, `core/mcp/types.ts`, `core/commands/types.ts`, `core/permissions/types.ts`, `schemas.ts`, `hookInspectorContract.ts`, `policyBuilderContract.ts`, `core/browser/types.ts`, `observationServiceContract.ts`, `core/agents/types.ts`, `agentStoreContract.ts`, `core/tasks/types.ts`, `core/profile/types.ts`, `core/profile/schemas.ts`, `core/surfaces/types.ts`, `core/events/index.ts`, `core/blocks/firstParty.ts`, `main/context.ts`, `main/modules.ts`, `renderer/panes/paneComponents.tsx`, `renderer/dialogs/dialogStore.ts`, `DialogHost.tsx`, `SettingsPanel.tsx`, `renderer/panes/tree/leafDecorations.tsx`, `renderer/App.tsx`, `package.json`, the lockfile and the configs. No builder edits `src/core/session/**`, `src/main/modules/session.ts`, `TreePane.tsx`, `SurfacePane.tsx`, `TerminalPane.tsx` or `ProfileRail.tsx`: their slices reach them through the seams above. A builder records a needed contract change in its measurement file.

Shared seams that need care:

- Launch settings keys: w-permissions owns `sandbox` and replaces the base `PreToolUse` hook; w-agents owns `statusLine`; w-browser appends a `UserPromptSubmit` entry and owns the `agide-browser` server and `--no-chrome`; w-tasks adds `--add-dir`. `mergeContributions` refuses any second owner, so a collision shows as a failing test.
- `gate.json` and `digest.json` are written through `LaunchContext.writeSessionFile`; the digest is rewritten while the session runs, through the environment's `writeSessionFile`, by the browser module.
- The task row of 0021: w-tasks creates it by invoking `task_create` through the command registry as the UI caller; the inbox contract does not change.
- `ui_create_leaf` and `browser-tab`: w-browser decides in `surfaceCatalog.ts` and `createLeaf.ts`; no other builder touches either.

Dependencies: none added in this step. w-iso does not add srt or docker as packages: both are external programs the user installs. A builder that adds a package runs `pnpm add` once; a builder whose lockfile moved runs `pnpm install`.

### Test strategy

- `pnpm test`: Vitest in plain Node over `src/core`, `src/main`, `src/shared` and the renderer logic. Shared contract suites: `describeIsolationProviderContract` (local, fake, srt and container), `describeHookInspectorContract` and `describePolicyBuilderContract` (the inspector and the policy builder), `describeObservationServiceContract` and `describeAgentStoreContract` (in-memory and SQLite). At the contracts step the suites of unbuilt parts were skipped with `[pending <owner>]` in the title; a builder's slice was done when its implementation ran the suite unskipped, and none is pending now. The srt and container suites are marked `[unavailable: <reason>]` on a host without the runtime. The milestone 2 suites stay.
- `src/main/modules/m3Modules.test.ts` runs the milestone 3 modules in the real module graph through `startAppModules`; `src/core/session/PtySessionContributions.test.ts` drives a launch with contributors through the fake provider and the fake `claude`.
- `pnpm e2e` stays as in 0023, with hidden windows. New e2e files per builder: `browser.spec.ts` (with a `node:http` fixture server on `127.0.0.1`), `agents.spec.ts` (a fake `claude` that writes hook files, a status snapshot and transcripts), `tasks.spec.ts` (temporary repositories and a fake `gh`), `permissions.spec.ts` if the dialog needs one.
- Real-Claude scripts stay outside the default commands and follow 0013: Haiku, `--max-budget-usd 0.25` where `-p` allows it, an empty temporary directory, `--setting-sources user`, `--strict-mcp-config` unless a connector is the point, the `probes/lib.mjs` scrub that keeps `CLAUDE_CONFIG_DIR`. Each script lists the trust entries it leaves.
- Reviews after the builders run mutations on: the merge refusal for a second owner, the base hook replacement, the contributor failure path, the per-grant `Host` check, the server filter in `callTool`, the observation `not_user` and origin checks, the message-id dedupe and the `main` attribution in the agent store, the strict source parser, and the items each design lists (0026 section 9, 0027 slice item 8, 0028 sections 8 and 14).

### Choices

- Modules add to a launch through `LaunchContributor`; no builder edits the session launch code. Contributors run after the environment is prepared, because the hook directory, the MCP URL and the session files are paths inside the environment. The provider choice and the network policy are separate options, because they are needed before the environment exists.
- Contributions fail closed: a contributor error fails the launch. A session without the permission rules it was meant to carry would run outward actions without asking.
- `SessionInfo.permissionMode`, `stop` and `setPermissionMode` are added now, since 0027 and 0028 both need them and both would otherwise edit the session service.
- The per-grant `Host` allowance (0022 section 5) and the per-server tool listing (0026 section 3) are built in this step: each is small, and leaving them would put w-iso and w-browser in the same MCP files. The `/browser` endpoint itself is w-browser's.
- 0028 names `core/gate/` and a `taskstart` module; they are `core/permissions/` and `tasks` here, so each builder's files sit under one name. 0027's `core/usage/prices.json` stays under `core/usage/`, owned by w-agents.
- The stub `resolveMode` keeps the milestone 2 rule (`AGIDE_PERMISSION_MODE`, bypass with confirmation on any provider). The move to auto as the default and the bypass refusal on `local` land with w-permissions, so the tests that expect the old rule change in one slice.
- A profile without `permissions` reads as the defaults; nothing writes the key until the user saves the section. The Bash sandbox default differs between the default profile (off) and new profiles (on), as 0028 section 5 says.
- The provider is chosen per profile; a provider per session waits, because `sessions` has no provider column.
- srt reports `network: 'allowlist'` although `allowLocalBinding` opens loopback; the settings panel says so, and until Q2 is probed bypass on srt denies what would ask.
- The container provider runs one container per launch and is tested against the fake claude; it is not offered for real sessions until a Linux `claude` has run in it.
- Profile settings get a floating panel reachable from the tree's background menu, because the setup pane shows only while a new profile is being set up, and the default profile needs the Permissions section too.
- The new pane types are in the first-party manifest now, with stub components, so `paneComponents.tsx` and `firstParty.ts` stay with this step and `docs/blocks.md` changes once.
- The browser module reaches Electron through `ModuleContext.browserViews`, as the profile and inbox modules do through `desktop`, so it stays testable in plain Node.

### Changes after review

The review of the milestone 3 code led to these contract changes. Each has a test.

Session and isolation:

- `ProviderCapabilities.inspectorHook` is optional: `host-executable` (the default) or `unavailable`. The permission contributor adds no `PreToolUse` hook for a provider that says `unavailable`; the container says so, because the hook command names the host's executable. The capability statement of the container says that only the ask rules apply there.
- `ModeRequest.inspectorAvailable` is false when the inspector script is missing or the provider cannot run it. `resolveSessionMode` refuses `bypassPermissions` then, because the rule that turns asks into denials under bypass lives in the inspector.
- srt `filesystem.denyWrite` lists `settings.json`, `settings.local.json`, `CLAUDE.md`, `keybindings.json`, `commands`, `agents`, `skills`, `plugins` and `hooks` of the Claude configuration directory, whose directory stays writable for transcripts. `.claude.json` stays writable, because the CLI keeps its state in it; the capability statement says so. Whether srt's own mandatory deny list covers more of these paths is not verified.
- The container run uses `--mount type=bind,src=...,dst=...[,readonly]`; a path with a comma or a line break is refused. The gh configuration directory is mounted read-only.
- `profile_setup_status.loginDirectory` is `defaultSessionCwd('login-<profile id>')`, outside the app root, because `session_create` refuses a working directory inside it. `ProfilePaths.login` is removed. The setup pane removes the folder it created when the login session cannot start.

Browser:

- `SiteGrants` keeps navigation answers apart from the grants for acting calls: `allowNavigationForSession` and `allowNavigationAlways` are read by `navigationDecision` only. An answer to "open this origin" never allows a click, typing or `javascript_tool` there.
- An acting call checks the origin again after the approval wait and before the CDP call, and refuses when the tab moved to another origin or observation turned off.
- An agent that calls `navigate` without a tab gets an empty tab of its own before the question, so the question has a tab and an inbox item. The approval item carries `approvalId` in its payload, its card offers Deny and Allow once, and dismissing the item denies the request. Pending requests of a session end as denied when the session exits or closes.
- Every URL returned to an agent passes `redactNetworkUrl`, console text passes `maskSecrets`, and blocked-address matching compares decoded, lower-case paths with duplicate slashes collapsed. Masking cannot stop an agent that encodes a secret before it returns it from `javascript_tool`; the user approves each script call on a signed-in site for that reason.
- `Stop agent` keeps its sessions per tab.
- `BrowserViews.setRequestPolicy(policy)` lets the module cancel requests of a tab. Under the srt provider the tabs an agent opened or drives load loopback, hosts of the profile allowlist that belong to no signed-in service, origins the user let the agent open and origins with a navigation grant, and nothing else. A page in such a tab cannot reach a host the agent process could not, which keeps the claim behind bypass true for the embedded browser. Third-party resources of an opened page are cancelled with the rest.
- The profile allowlist counts as consent to open an origin only for hosts that belong to no signed-in service, so adding `github.com` for package downloads does not let an agent load GitHub in the signed-in partition. `browser_open_in_chrome` asks before an agent runs it.
- `setupPartition(session, dataDir?)` throws when the partition stores its data outside the profile data directory; `ElectronViews` passes the data directory.
- A view that is evicted or never created is not created again by a hidden placement. `ElectronViews.page` serializes concurrent attach calls and detaches again after a failed attach; destroy detaches the debugger and the load timer is cleared.
- Dialogs, the tree context menu, the tab menu and the observation popover hide the native views behind stills while they are open (`holdViews`, `useViewSuspension` in `renderer/panes/browser/suspension.ts`). Holds add up with the drag suspension, and a view placed during a suspension stays hidden until resume. The session peek of the inbox sits in a pane and needs no hold.

Main process:

- App events go to windows that show an app page; a sign-in pop-up gets none. The DevTools of the app window are off in a packaged build. Sign-in pop-ups are hidden in hidden test runs.

Tasks:

- A pull request start reads `CLAUDE.md` at `<remote>/<base branch>`, never at the head of the pull request, and the prompt names the base branch. `GitWorkingDirectoryManager.readFileAtCommit` became `readFileAtRevision`, which resolves the revision after `--end-of-options`.
- The cap on agent starts counts starts in progress. A start that fails after it created a worktree removes the worktree, deletes the branch with `-D` and removes the source directory. `TrustAutomation.dispose` clears every watch and the tasks module calls it.

Permissions and usage:

- The shell parser reads `$"..."`, `$(( ... ))` with substitutions inside, backticks and a single quote inside `${...}` in double quotes, `time -p`, and `function name { ... }`. The classifier treats `env -S`, `git --config-env=alias.*`, `git config alias.*` and `GIT_CONFIG_KEY_*` or `GIT_CONFIG_PARAMETERS` with an alias as `shell.opaque`, and a dynamic field of `gh api` as a possible mutation.
- The inspector writes its record as a temporary file renamed to `.json`, so no temporary directory is left in the events directory, and the sweep of stale files removes a directory and continues after an entry it cannot remove.
- `UsageEngine` counts the largest value seen per token class of a message, so a repeated line never subtracts. `modelOf` gives a subagent only the model its own transcript names; its cost is left out when there is none.

## Consequences

- The builders can work in disjoint files. The shared places (session launch, MCP listing, tree menu and rows, surface pane, settings, rail, terminal header) are seams with one owner per hook point.
- The modules are implemented and run in the app. The observation log pane is still a placeholder section although the block manifest lists it. `docs/blocks.md` lists the new pane types.
- 0013 and 0023's contract lists grow by the files under Ownership. 0022's interface gains `ClaudeLaunch.env` and two session file names. 0026, 0027 and 0028 are mapped to the module names above.
- Not verified: a real `claude` under srt through the app (SIGTERM through srt is tested with a stand-in process; SIGKILL of the process group is tested without srt); any `claude` inside a container; the Anthropic host list srt needs beyond the hosts I1 allowed; that contributors stay fast enough to run before every launch (the inspector's gate file and the digest are small writes); the dialog host and the settings panel on screen (the hidden e2e runs do not open them).
