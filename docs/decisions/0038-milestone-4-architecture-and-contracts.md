# 0038 Milestone 4 architecture and contracts

Status: accepted
Date: 2026-11-21
Decided by: spike agents
Inputs: 0004 (amended by 0014 and 0024), 0008 (R18), 0009, 0010, 0011, 0012, 0013, 0021, 0022, 0023, 0025, 0027, 0028, 0029, 0030, 0035, 0036, 0037 (reviewed); `notes/probes-m4-swarm.md` (P30 to P37, reviewed), `notes/swarm-orchestration.md`, `notes/swarm-visibility.md`, `probes/RESULTS.md`, `probes/out/p30_*` to `p35_*`; the milestone 3 code in `app/`

## Context

0037 designs swarm orchestration (R18): a swarm definition, one `claude -p` stream-json process per agent through the isolation provider, a manager with run states, a profile-wide cap with a queue, stages, a failure policy, budgets, approvals from `can_use_tool`, worktrees, the `swarm_*` tools and the UI. The probes P30 to P37 settled the runtime facts it rests on.

The builders w-runtime, w-manager and w-ui work next, in parallel. As in 0013, 0023 and 0029 they need the contracts fixed first and files that do not overlap. The session launch, the module graph, the tree pane and the inbox card are where they would collide. This record states the slice of each builder, the modules and contracts that now exist in the code, the seams that keep the builders out of each other's files, who owns which file, the module initialization order, the test strategy, and the choices made while writing the contracts.

## Decision

### Slices

The first slice of 0037 ("Consequences", items 1 to 7) is split by layer:

| Builder | Slice | From |
|---|---|---|
| w-runtime | `AgentEnvironment.processCommand` in the local, srt, container and fake providers (the container without `-t`), made required in the interface at integration; the stream-json runtime `core/swarm/runtime` (`StreamAgentRuntime`) that implements both `AgentRuntime` and `StreamSpawner`, and its launch contributor with the stream-json arguments, the agent's deny rules and variables; the NDJSON channel with the 4 MiB line limit, user messages queued per turn, control requests with the 20 s timeout, `can_use_tool` and `control_cancel_request`, interrupt, end, stop through `terminate`, resume, the one-process-per-session lock, `init` events with the mode as the CLI reports it and `apiKeySource`, event normalization into `RuntimeEvent`; `HookItemMapper` skipping `PermissionRequest` and `Notification` `permission_prompt` for stream-json sessions; the runtime contract suite run unskipped against `fixtures/fake-claude-stream.mjs` | 0037 sections 2.1 to 2.3, 7.2 (mapper), 14 (fake CLI) |
| w-manager | The persistent manager in `core/swarm/manager`: the checks of 0037 section 1 that read the repository, the tool list and the `initialize` models list; the `system/init` mode check (a stricter mode kept with a warning, a looser or unknown one ended with `mode-mismatch`); run states, the cap counted in `beginAppStarted` with the task-start count moved there, the queue and its alert, stages, failure policy and the single retry; the budget ledger with reservations, the 80 percent alert, the swarm cap and the wall clock; workspaces (worktree, readonly, scratch), `inputs.md`, result collection with stored patches, merge previews, the cleanup rules; approval items from `can_use_tool` with `SwarmApprovalPayload`, the app timeout and supersession; quit, crash and restart; the `swarm` tables (migration 1); `main/modules/swarm.ts` with the command handlers, the runtime set into `streams`, the agents controller wiring (`streamMessage`, `streamResponse`), the agent leaves and the events; the manager contract suite run unskipped; the real-Claude swarm script | 0037 sections 2.1 (init check), 2.4, 3, 4, 5, 6, 7.1, 7.2 (items), 8, 9, 11, 12, 14 |
| w-ui | The start-swarm dialog (Form and JSON tabs, agents table, preview), the `agide/swarm` pane with the Agents and Results tabs and the budget meter, swarm folder and agent row decorations with the new chips, the context menu entries of a swarm folder and an agent leaf, the Banner for paused and stopped swarms, the approval answers on the inbox card and the agent node Popover; the new glyphs in `renderer/ui/icons.ts`; `e2e/swarm.spec.ts` | 0037 sections 10, 7.2 (buttons) |

What waits is the table "What waits" of 0037. Added here: a keyboard shortcut for "New swarm…" (no accelerator is bound in this step; w-ui may add one in the renderer if it does not collide), and a `network` glyph as the tree icon of a swarm folder (the icon slot belongs to `TreePane.tsx`; the swarm decoration carries the glyph after the title).

### Modules

```
src/core
  swarm        definition.ts: zod schema, SwarmDefinition, checkDefinitionGraph, dependenciesOf
               tiers.ts: TierTable, DEFAULT_TIERS, ROLE_TIERS, resolveTier
               budget.ts: AgentSpend, SwarmBudget, ReservationResult, MIN_RESERVATION_USD, defaultAgentBudget
               settings.ts: swarm profile settings schema and defaults
               policy.ts: strictestMode
               types.ts: run and swarm states, reasons, SwarmCaller, SwarmManager, SwarmService, SwarmEvent, SwarmError,
                         SwarmApprovalPayload
               commands.ts: SWARM_COMMAND_INPUTS, SWARM_COMMANDS, registerSwarmCommands
    runtime/   types.ts: AgentLaunchSpec, RuntimeEvent, TurnResult, PermissionAnswer, AgentRuntime, RuntimeError
               fakeScript.ts: the step language of the fake agents
               InMemoryAgentRuntime.ts, agentRuntimeContract.ts, agentRuntime.test.ts
    manager/   InMemorySwarmManager.ts (with SwarmFolders), swarmManagerContract.ts, swarmManager.test.ts
    fixtures/  fake-claude-stream.mjs, fakeClaudeStream.test.ts
  session      streamSpawner.ts: StreamSpawnRequest, StreamProcess, StreamSpawner, StreamSpawners;
               SessionCreateInput.id; PtySessionServiceOptions.streamSpawner
  isolation    AgentEnvironment.processCommand, ProcessLaunch
  commands     CommandErrorCode gains limit_reached and refused
  events       AppEvent gains SwarmEvent
  profile      ProfileSettings.swarm
  blocks       first-party pane type agide/swarm
  permissions  mcp__app__swarm_start in the app.agent_start class
src/main
  context.ts   Services gains swarm
  modules.ts   StreamSpawners created next to LaunchContributors; swarm initialized last
  modules/     swarm.ts (stub), swarm.test.ts; session.ts takes streams and adopts leaves made for leafless sessions
src/renderer
  dialogs/     dialogStore new-swarm; DialogHost; swarm/StartSwarmDialog.tsx (stub)
  panes/       swarm/SwarmPane.tsx (stub); paneComponents agide/swarm
  panes/tree/  SwarmDecorations.tsx (SwarmFolderDecorations, SwarmAgentDecorations), swarmMenu.ts (stubs);
               TreePane "New swarm…" entry and the hook calls; leafDecorations calls SwarmAgentDecorations
  panes/inbox/ SwarmApprovalActions.tsx (stub); ItemCard calls it and hides "Open session to answer" for swarm approvals
  ui/icons.ts  PANE_ICONS.swarm and ACTION_ICONS['new-swarm'] (network glyph)
```

A builder may add folders for its slice: `core/swarm/runtime/*` (w-runtime), `core/swarm/manager/*` and `core/swarm/workspace/*` (w-manager), `renderer/panes/swarm/*` and `renderer/dialogs/swarm/*` (w-ui). The test that keeps `src/core` free of Electron covers them.

### Contracts

Swarm definition (`core/swarm/definition.ts`): the schema of 0037 section 1 as written there, with `bypassPermissions` absent from both mode fields and `.strict()` on every object. `SwarmDefinitionInput` is what a caller writes, `SwarmDefinition` the parsed copy with defaults the manager stores. `checkDefinitionGraph` returns the checks that need nothing outside the definition, each with a dotted path: unique names, known dependencies, no self-dependency, a repository for `worktree` and `readonly` agents, and no cycle through `dependsOn` plus the stage order. `dependenciesOf` gives an agent's `dependsOn` and every agent of a lower stage. The checks that read the repository (`base`, disjoint `owns` against the tracked files), the CLI's tool list and the `initialize` models list are w-manager's (`manager/validate.ts`).

Tiers (`core/swarm/tiers.ts`): `TierTable` maps `strong`, `mid` and `small` to a `--model` alias and an `--effort`. `DEFAULT_TIERS` is `fable`/`high`, `sonnet`/`medium`, `haiku`/`low`; `ROLE_TIERS` maps reviewer, worker and mechanical to them. `resolveTier(table, maxTier, agent)` returns the tier, model and effort an agent runs with and whether `maxTier` lowered the tier or the effort. The profile's `swarm.tiers` replaces single rows (`settings.ts`).

Budgets (`core/swarm/budget.ts`): types only. `AgentSpend` holds reported, estimated and reserved dollars and whether the agent's models have prices; `SwarmBudget` is the swarm's view for `swarm_status` and the meter; `ReservationResult` answers a reservation with the pot it came from or `swarm-short` (stay queued) or `agent-spent` (fail with `agent-budget`). The ledger is w-manager's.

Settings (`core/swarm/settings.ts`): `ProfileSettings.swarm` with `tiers`, `approvalTimeoutMinutes` (default 60), `interruptedKeepSeconds` (300), `maxSpawnDepth` (1, range 0 to 2) and `maxActivePerSession` (2). The cap stays `agents.maxConcurrentAppStarted`.

Agent runtime (`core/swarm/runtime/types.ts`):

- `AgentLaunchSpec` is everything one launch or resume needs: the app-chosen session id, folder, title, working directory, model, effort, effective mode, `maxBudgetUsd` (the reservation), `maxTurnsPerMessage`, `connectors`, `tools`, extra deny rules, `--add-dir` entries, launch variables and the first message.
- `AgentRuntime`: `launch` and `resume` write the first message at once; `send` queues a message until the running turn's `result`, and with `now` interrupts first; `answer` answers a `can_use_tool` request; `interrupt` resolves after the turn's `result` and keeps the process; `end` closes stdin after the running and queued turns; `stop` interrupts, closes stdin and terminates; `control` sends a control request such as `initialize`; `isLive`; `isBusy`, which is false from a turn's `result` event on unless a queued message starts the next turn, so a listener of `result` can decide that the agent is done; `subscribe`; `dispose`.
- `RuntimeEvent` per session, in order: `started` (pid, resumed), `init` (mode as the CLI reports it, model, `apiKeySource`, tools; the manager compares the mode with the effective mode, since it owns the end reasons and the swarm's warnings), `assistant` (message id, model, usage, text, tool names), `permission_request` (the raw `can_use_tool` request), `permission_cancelled`, `result` (`TurnResult`: subtype, `isError`, terminal reason, cumulative cost, turns, text, errors without `[ede_diagnostic]` lines, denials, and `interrupted` when the app caused the end), `rate_limit`, `message` (every parsed stdout line, for `AgentsController.streamMessage`), `exited` (code, signal, `byApp`).
- `RuntimeError` codes: `not_found`, `already_running`, `not_running`, `spawn`, `unsupported`, `timeout`. A launch with a used session id fails with `spawn` (P33), a resume of an unknown id with `not_found`, a second live process with `already_running`.

Fake agents (`runtime/fakeScript.ts`, `fixtures/fake-claude-stream.mjs`): one step language for the in-memory runtime and the fake CLI: `/text`, `/tool <name> <json>`, `/cost`, `/sleep`, `/fail <terminal reason>`, `/exit <code>`, `/write <file> <text>` (the CLI fake only); a message without steps gets `echo: <message>`. The fake CLI writes lines shaped like the P30 to P35 logs (init per turn with `manual` reported as `default`, assistant usage, a `rate_limit_event`, `can_use_tool` with an `addRules` session suggestion, `control_cancel_request` on interrupt, results with `total_cost_usd`, `modelUsage`, `permission_denials` and `terminal_reason`), keeps session ids under `$FAKE_CLAUDE_STATE`, records arguments and selected variables to `$FAKE_CLAUDE_RECORD`, stops model work after the result that reaches `--max-budget-usd`, and ends with code 0 when stdin closes. Its writes drain before it exits, since stdout to a pipe is asynchronous on macOS.

Session seam (`core/session/streamSpawner.ts`, `PtySessionService`): a session with `launchPath: 'stream-json'` goes through the same preparation as a PTY session (provider check and prepare, hook inbox, `mcp.json` with the grant, launch contributors, `buildLaunchArgs`), then `streamSpawner.spawn` gets the session, `resume`, the prepared environment, the arguments and the merged variables. The stream-json flags and the agent's own arguments, deny rules and variables come from a launch contributor of the runtime, so they are already in `args`, `--settings` and `env`. The spawner calls `environment.processCommand`, spawns with pipes and returns a `StreamProcess` (pid, `sendText`, `onExit`). The session service attaches the pid, so `stop` and `close` reach the process through `terminate`, and marks the session `exited` on exit. `sendText` on a stream-json session goes to `StreamProcess.sendText`; `write` and `resize` answer `not_running`. Without a spawner such a launch fails with `launch_failed`. `SessionCreateInput.id` lets a caller choose the session id; an id in use fails with `launch_failed`. `StreamSpawners` is the slot `modules.ts` creates and passes to the session module; the swarm module sets the runtime into it.

Isolation (`core/isolation/types.ts`): `AgentEnvironment.processCommand?(launch: ProcessLaunch)` returns the host command for a process without a terminal; `ProcessLaunch` is `ClaudeLaunch` without the terminal size. Every provider has it, and the interface requires it.

Manager (`core/swarm/types.ts`):

- Run states `queued`, `running`, `waiting`, `interrupted`, `done`, `failed`, `stopped`; swarm states `running`, `paused`, `done`, `failed`, `stopped`; `EndReason`, `InterruptedBy` and `QueueReason` (`dependencies`, `slot`, `budget`, `pause`) as in 0037 section 3.1.
- `SwarmCaller` is the UI, or a session with its folder scope, spawn depth, current mode and, for a swarm agent, its swarm and `mayStartSwarms`. The swarm module derives it from the command `Caller`.
- `SwarmManager`: `start`, `list`, `status`, `send`, `interrupt`, `stop` and `results` take the caller; `answerApproval` has none, because only the UI reaches it; `subscribe`; `shutdown` for app quit. Without `agent`, `send` resumes the swarm, `interrupt` pauses it and `stop` stops it.
- `SwarmStatus` and `SwarmAgentStatus` carry what `swarm_status` and the pane show, including open approvals with the raw request; `AgentResult` what `swarm_results` returns.
- `SwarmError` codes map onto `CommandErrorCode` with the same names, which gains `limit_reached` and `refused`.
- `SWARM_APPROVAL_ORIGIN` is `swarm:can_use_tool`, the inbox origin of approval items. `SwarmApprovalPayload` is their `payload`: `swarmId`, `agent`, `requestId`, the raw request, the effective mode, `expiresAt` and the inspector record when one exists. w-manager writes it; w-ui reads it on the card.
- `SwarmCaller.depth` comes from the swarm module: 0 for a user session, the swarm's depth for its agents, and the depth recorded by `task_start` for a session an agent started (see the changes after the review).

Commands (`core/swarm/commands.ts`): the inputs of 0037 section 9 plus `bypass` on `swarm_start` (refused by the manager for any caller but the UI) and `swarm_approval_answer` (`swarmId`, `agent`, `requestId`, `decision`). Every command has a UI binding; all are MCP tools except `swarm_approval_answer`, which states `mcpExempt: 'agents never answer approvals'`, so the parity check passes with that exemption. `registerSwarmCommands(registry, handlers)` registers all of them; a command without a handler answers `failed` with "<id> is not built yet", and a thrown `SwarmError` becomes a `CommandError` with the same code. `mcp__app__swarm_start` is in the `app.agent_start` class, so a start from any session asks the user.

In-memory implementations: `InMemoryAgentRuntime` runs the step language without processes and records every launch spec; `reportMode` sets the mode its `system/init` reports (the requested one by default). `InMemorySwarmManager` keeps run states, stages and dependencies, the cap with its queue (oldest swarm, then stage, then definition order), the failure policies, steering, approvals forwarded to the runtime and superseded by a cancel, the `system/init` mode check, scope, spawn depth and the active swarms per session, and shutdown; it has no ledger, workspaces, inbox items, retries or persistence. `InMemorySwarmFolders` stands in for the tree in its folder checks.

Events: `swarm.changed`, `swarm.agent_changed` (with the session id once launched) and `swarm.removed` go on the app bus and cross IPC.

Renderer: `DialogRequest` gains `new-swarm` with `parentFolderId`; `DialogHost` renders `StartSwarmDialog`. The tree's menus gain "New swarm…". `TreePane` renders `SwarmFolderDecorations` before `FolderDecorations` on every folder and appends `swarmMenuEntries(node)` to a node's menu; `LeafDecorations` renders `SwarmAgentDecorations` before `SessionDecorations` on every session leaf. `ItemCard` renders `SwarmApprovalActions` and does not offer "Open session to answer" for `swarm:can_use_tool` items, since a stream-json session has no terminal. `PANE_COMPONENTS['agide/swarm']` is `SwarmPane` with property `swarmId`.

Session module: a `claude-session` leaf created in a session's folder for a session that has no leaf becomes its leaf, so the swarm module creates an agent's leaf after `sessions.create` and the leaf's removal closes the session as for any session. A leaf in another folder is not adopted.

### Order of module initialization

1. profile (no dependencies).
2. tree.
3. mcp (tree).
4. permissions (profile, launch).
5. session (tree, mcp, profile, permissions, launch, streams): starts the MCP listener, builds the providers, holds the `streams` slot for stream-json launches.
6. layout (tree).
7. theme.
8. inbox (tree, sessions, profile).
9. browser (tree, mcp, sessions, profile, permissions, inbox, launch).
10. agents (tree, sessions, inbox, profile, launch).
11. tasks (tree, sessions, profile, permissions, inbox, browser, launch).
12. swarm (tree, sessions, profile, permissions, inbox, agents, launch, streams): last, because it posts inbox items, counts app-started agents through agents, and sets the stream-json runtime into `streams`.
13. `mcp.start()` once more after every module registered its tools.

`launch` (`LaunchContributors`) and `streams` (`StreamSpawners`) are created in `modules.ts` before the modules. The session service reads both at each launch, so the runtime set by the swarm module after the session module is in time; no stream-json session launches during init, and the restart path of 0037 section 2.4 resumes nothing by itself. Dispose runs in reverse order, so the swarm module's `shutdown` (interrupt, end, pause) runs before the session module ends the remaining processes.

### Ownership

| Builder | Owns | Must not edit |
|---|---|---|
| w-runtime | `src/core/swarm/runtime/**` except the contract files; the `stream-json runtime` line of `runtime/agentRuntime.test.ts`; `src/core/swarm/fixtures/**` (the step language stays that of `fakeScript.ts`); `processCommand` in `src/core/isolation/LocalProvider.ts`, `SrtProvider.ts`, `ContainerProvider.ts`, `dockerArgs.ts`, `FakeProvider.ts` and their tests; the stream-json lines of `src/core/inbox/HookItemMapper.ts` and its tests; real-Claude scripts `scripts/e2e-real-swarm-runtime.mjs` and `scripts/lib/realSwarm.mjs` | other modules, the contract files |
| w-manager | `src/core/swarm/manager/**` except the contract files; the `persistent manager` line of `manager/swarmManager.test.ts`; new `src/core/swarm/workspace/**`; `src/main/modules/swarm.ts` and `swarm.test.ts`; the cap lines of `src/core/agents/AgentsController.ts`, `src/main/modules/agents.ts` (`beginAppStarted`) and `src/core/tasks/TaskStartService.ts` (its own count moves there) with their tests; the detached variant and swarm branch name in `src/core/tasks/GitWorkingDirectoryManager.ts` with its tests; `scripts/e2e-real-swarm-mcp.mjs` | other modules, the contract files |
| w-ui | `src/renderer/dialogs/swarm/**`, `src/renderer/panes/swarm/**`, `panes/tree/SwarmDecorations.tsx`, `panes/tree/swarmMenu.ts`, `panes/inbox/SwarmApprovalActions.tsx`, new glyphs and status entries in `src/renderer/ui/icons.ts` with `icons.test.ts`; `e2e/swarm.spec.ts` and its fixtures | other modules, the contract files |

Contract files belong to this step and change only through the integration step: `core/swarm/types.ts`, `definition.ts`, `tiers.ts`, `budget.ts`, `settings.ts`, `policy.ts`, `commands.ts`, `index.ts`, `runtime/types.ts`, `runtime/fakeScript.ts`, `runtime/InMemoryAgentRuntime.ts`, `runtime/agentRuntimeContract.ts`, `manager/InMemorySwarmManager.ts`, `manager/swarmManagerContract.ts`; `core/session/streamSpawner.ts`, `core/session/types.ts`, `core/isolation/types.ts`, `core/commands/types.ts`, `core/events/index.ts`, `core/profile/types.ts`, `core/profile/schemas.ts`, `core/blocks/firstParty.ts`, `main/context.ts`, `main/modules.ts`, `renderer/dialogs/dialogStore.ts`, `DialogHost.tsx`, `renderer/panes/paneComponents.tsx`, `renderer/panes/tree/leafDecorations.tsx`, the contract files of 0029, `package.json`, the lockfile and the configs. No builder edits `src/core/session/**`, `src/main/modules/session.ts`, `TreePane.tsx` or `ItemCard.tsx`: the slices reach them through the seams above. A builder records a needed contract change in its measurement file.

Shared seams that need care:

- The runtime's construction: `new StreamAgentRuntime({ sessions })` takes the session service and may take more options of its own; it exposes `contributor`, its `LaunchContributor`. The swarm module calls `launch.register(runtime.contributor)` and `streams.set(runtime)`, and gives the runtime to the manager as its `AgentRuntime`.
- The runtime and the session service: `StreamAgentRuntime.launch(spec)` keeps the spec by session id and calls `sessions.create({ id, folderId, cwd, title, permissionMode, launchPath: 'stream-json' })`. Its launch contributor (id `swarm`, registered on `launch` by the swarm module) contributes, for a stream-json session whose spec it holds, the stream-json flags (`-p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio`), the agent's arguments (`--model`, `--effort`, `--max-budget-usd`, `--max-turns`, `--strict-mcp-config` unless connectors, `--tools`, `--add-dir` mapped with `toEnv`), its deny rules as `permissions.deny` and its variables, and nothing for any other session. `mergeContributions` appends the deny rules to the app's own, so `--settings` stays one argument. Its `spawn(request)` reads the spec of `request.session.id`, gets the command from `processCommand` and writes the first message. Resume is `sessions.resume(id)` after the spec is replaced.
- Runtime events to the agents module: the swarm module (w-manager) passes every `message` event to `AgentsController.streamMessage` and every answer to `streamResponse`; the runtime does not know the agents module.
- The cap: `beginAppStarted` becomes the one count of live app-started processes; w-manager changes its comparison and the task-start count together and keeps the existing `agents` and `tasks` tests passing.
- The agent's tree leaf: the swarm module creates it in the swarm folder after `sessions.create` resolves. A close of an agent's session that the manager did not ask for (the leaf removed, `session_close`) reaches the runtime as an exit with `byApp` false, and `session.closed` follows it; the swarm module then ends the agent `stopped` with reason `user` and drops any pending retry, since the session can no longer be resumed.
- `swarm_*` commands: the definitions and bindings are the contract; w-manager supplies the handlers through `registerSwarmCommands`; w-ui calls them through `api().invoke`.
- Approval items: w-manager posts them with origin `SWARM_APPROVAL_ORIGIN` and a `SwarmApprovalPayload`; `SwarmApprovalActions` reads only that payload and answers through `swarm_approval_answer`.

Dependencies: none added. A builder that adds a package runs `pnpm add` once; a builder whose lockfile moved runs `pnpm install`.

### Test strategy

- `pnpm test`: Vitest in plain Node. New contract suites: `describeAgentRuntimeContract` (in-memory now; stream-json runtime over the fake CLI `[pending w-runtime]`) and `describeSwarmManagerContract` (in-memory now; persistent manager `[pending w-manager]`). A builder's slice is done when its implementation runs the suite unskipped. The manager suite uses the in-memory runtime for both managers, so it tests manager rules and not processes.
- Unit tests in this step: the definition schema and graph checks, the tier resolution, the strictest mode, the settings defaults, the swarm commands (pending answers, the exemption, the error mapping, the schema of `swarm_start`), the fake CLI driven directly over pipes, the stream-json seam of the session service with an idle child process, and the swarm module in the real module graph (the pending commands, the tool list agents receive, the leaf adoption).
- w-runtime adds tests with temporary directories and the fake CLI: the argument list per tier and workspace, the line limit, the control timeout, the mode check, and `processCommand` per provider (srt and container marked unavailable on a host without them).
- w-manager adds the tests of 0037 section 14 that are not in the contract: reservations and release, the alerts, retries, worktree and readonly workspaces on temporary repositories, merge previews, cleanup refused without a stored patch, quit and crash with a recorded pid, persistence across a restart, the MCP scope per caller role.
- `pnpm e2e` stays with hidden windows; w-ui adds `e2e/swarm.spec.ts` with the fake CLI as `AGIDE_CLAUDE_BIN` for stream-json launches.
- Real-Claude scripts stay outside the default commands and follow 0013: Haiku, `--max-budget-usd 0.25` per agent, an empty temporary directory or repository, `--setting-sources user`, `--strict-mcp-config`, the `probes/lib.mjs` scrub that keeps `CLAUDE_CONFIG_DIR`, at most 3 processes.
- Reviews after the builders run the mutations of 0037 section 14 and these: dropping the folder check of the leaf adoption fails the swarm module test (run in this step: it does); answering `isBusy` true at a final result keeps an agent running and fails the contract; a launch with a used session id that succeeds fails the runtime contract. The contract review ran mutations of the in-memory runtime and manager (the busy flag at a result, a reused or unknown id, the interrupted flag, `now` without an interrupt, the budget stop, `byApp`, the end of a running turn, denials, the cap comparison, the looser mode, the depth, `mayStartSwarms` and bypass checks, the queue order, the failure policies, scope and steering, a swarm agent's view, the active swarms per session, the waiting state, an allow sent as a deny, supersession and the `system/init` mode check); each fails a contract test.

### Choices

- The stream-json runtime lives in `core/swarm/runtime` and reaches the session service through a spawner slot, so w-runtime does not edit `core/session`. 0037 placed a `StreamSessionService` in `core/session`; the seam keeps one session service that dispatches on `launchPath`, as 0037 asks, without a second builder in the session files.
- The session service does the preparation for both launch paths. Hooks, ask rules, the inspector, the sandbox settings, the MCP grant and the launch contributors of 0028 then come with every swarm agent with no second copy of that code.
- `processCommand` was optional in the interface while w-runtime added it to the providers; the integration step made it required.
- `SessionCreateInput.id` is added because the manager stores the session id before the launch (0037 section 12) and the runtime needs it to match a spawn to its spec.
- The agent leaf is adopted by the session module from a tree event. The alternative, a `session_create` variant for stream-json sessions, would put the swarm's launch arguments into the session command's input.
- The swarm commands are registered now with their final bindings and no handlers, so `docs/parity.md` changes once and the parity check sees the exemption from the start. A pending command answers `failed`, never `not_found`, so an agent sees that the tool exists.
- `swarm_start` takes `bypass` in its input. The manager refuses it from every caller but the UI; the start dialog sets it only after the provider check and the user's confirmation (0037 section 7.1).
- The swarm module is initialized last. It needs the agents controller and the inbox, and nothing depends on it.
- `isBusy` is defined at the `result` event, so the manager decides "done" from the event without a timer.
- The in-memory runtime reports the app's mode in `system/init`; the fake CLI turns `manual` into `default` as the CLI does (P30), so both report the same value for the contract.
- The mode check of `system/init` is the manager's. It needs the effective mode, ends the agent with a reason of the manager's and adds the stricter-mode warning to the swarm, so the runtime only reports the mode.
- The fake CLI keeps its session ids in a state directory outside the agent's working directory, so a worktree diff never shows its files.
- A keyboard shortcut for "New swarm…" is not bound in the command registry: the accelerators there are Electron menu items, and `swarm_start` cannot run without a definition.

### Changes after the review

Contract changes made when the review findings were applied.

- **Spawn depth.** A swarm the user starts has depth 1, so its agents sit one level below the user, who counts as depth 0. A swarm a session starts has the session's depth plus 1. With `maxSpawnDepth` at its default of 1, no agent of a user swarm can start a swarm. The row check keeps its range of 0 to 2.
- **Depth through `task_start`.** `TaskStartStore` gains the column `spawn_depth` (migration 2) and `depthOf(sessionId)`. `TasksService` gains `setSpawnContext(resolver)`; the swarm module hands it the swarm agent of a session. A session that a swarm agent, or a session below one, starts with `task_start` records the caller's depth plus 1. A session below a plain user session keeps depth 0. The swarm module reads `depthOf` for every session that is not a swarm agent, so `swarm_start` from such a session meets the same limit. The swarm module now receives `tasks` in its dependencies, and `modules.ts` passes it.
- **Stop and send.** `send` to a live agent that is ending as stopped or failed (a stop, the agent budget, the mode check) is refused with `refused`. Only an ending of `done` is cleared by a message.
- **Late processes.** After `runtime.launch` or `resume` returns, the manager checks that the agent still runs; if the agent was stopped or requeued, or the app began to close, it stops the process. An agent that was running when the app closed during its start becomes `interrupted` with cause `quit`. An exit of an agent that already ended changes nothing.
- **Start failures.** The manager ignores `session.closed` for a session whose launch is in progress, so a CLI that exits before its first output is a `failed` agent with reason `spawn`, retried once, instead of a stop by the user. `StreamAgentRuntime` reports `exited` for every process once `launch` or `resume` has returned, also for one that wrote nothing, and ends the process group on every exit.
- **Interrupt.** `StreamAgentRuntime.interrupt` waits for the end of the turn for the control timeout and then fails with `timeout`. The manager puts the agent back in its earlier state when the interrupt fails.
- **Group resume.** A resume of the whole swarm skips an agent that is ending as stopped or failed.
- **Close during start.** `session.closed` during a launch is ignored only when the runtime closed the session itself (`closedByRuntime`); a close by the user ends the agent as stopped by the user.
- **Budget.** A resume or a resumed reviewer reserves what is left of its pot after its own spend. The ledger scales the estimates of each agent by the ratio of the reported cost to the estimated cost of that agent's latest turn (limits 0.05 and 4), so a price table above the real cost does not end an agent or a swarm early. Before a first result the estimate is used as it is. `prices.json` is not changed: it is not checked against the published prices.
- **Git.** Every git call in an agent's directory runs with `--git-dir` and `--work-tree`. `Git.addWorktree` records the git directory git created for the worktree; a later call refuses a `.git` file that names another directory, a directory inside the worktree, or a directory registered for another worktree. For a worktree of an earlier run, which has no record, the checks on the registered directory and the location outside the worktree apply. Command settings of the repository (`core.fsmonitor`, `core.hooksPath`, `core.untrackedCache`) are switched off, attributes of the worktree are not read (`--attr-source` names the empty tree), so no `filter` or `diff` driver of the repository configuration runs, and diffs ignore the diff settings of the user. The patch is read as bytes (`latin1` decoding, written back the same way). Before a forced removal, `git apply --check` runs the stored patch against the base in a temporary index; a patch that does not apply keeps the worktree.
- **Caller view.** For a session caller, commit subjects, changed paths, outside-owned paths and the conflict text are one quoted line each, the input of an open approval request is an untrusted block, and `inputs.md` writes paths as quoted lines.
- **Start dialog bypass.** `bypass: true` makes the swarm mode `bypassPermissions` whatever mode the definition names; an agent that names a stricter mode keeps it. The module still sets no `bypassAllowed`, so the manager refuses every bypass start until a provider check is wired.
- **Process end after a crash.** `recover` signals the process group of a recorded pid, after the command-line check.
- **Swarm pane.** Group Resume is for a paused swarm only. A stopped swarm continues agent by agent with a message; its banner says so. The approval card shows the tool input in full above the buttons, names the swarm, is keyed by the item so an error does not carry over, says that Dismiss leaves the call to the automatic denial, and has no peek at a stream agent. The swarm chip replaces the tallies of the app-started node of a swarm agent in the tree.
- **Built differently from the slices above.** The cap is counted in two places: the manager counts its live agents plus the other live app-started processes (`manager/liveCount.ts`), and `task_start` counts app-started agent rows against the same setting; `beginAppStarted` did not become the one count. Swarm workspaces use their own `Git` class in `core/swarm/workspace/git.ts`, and `GitWorkingDirectoryManager` is unchanged. The approval answers are on the inbox card only; the agent node has none. The real-Claude scripts are `scripts/e2e-real-swarm-runtime.mjs`, `e2e-real-swarm-mcp.mjs` and `e2e-real-swarm-dialog.mjs`.
- **Not changed.** The shared cap between the manager and `task_start` still has a short window in which both can pass the check before either has recorded its agent. A child swarm is not bounded by the connectors, tools and budget of the agent that starts it; the approval card of `swarm_start` is the control. The tree menu actions report no failure. Agent rows of the start dialog are keyed by position.

## Consequences

- The builders can work in disjoint files. The shared places (session launch, module graph, tree pane, inbox card, dialog host) are seams with one owner per hook point.
- 0037's `StreamSessionService` becomes the spawner seam of this record; the rest of 0037 is unchanged.
- 0029's contract list grows by the files under Ownership. 0022's interface gains `processCommand`.
- The `swarm_*` tools are listed to agents now and answer "not built yet" until w-manager's handlers land; `docs/parity.md` and `docs/blocks.md` list the new commands and the `agide/swarm` pane type.
- Not verified: the stream-json runtime, the persistent manager and the UI themselves; everything 0037 lists as not verified.
