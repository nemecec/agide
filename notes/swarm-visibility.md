# Swarm visibility (R16)

Date: 2026-11-17. Claude Code 2.1.326. Probe model: Haiku. Scripts: `probes/p5_subagents.mjs` (stream-json), `probes/p5_subagents_pty.py` (PTY). Raw logs: `probes/out/p5_*.jsonl`, `probes/out/p5_report_*.json`, `probes/out/p5_pty_*`.

## Summary

- The stream-json path gives the host a complete lifecycle for every subagent and workflow without parsing transcripts: `system/task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`. Each carries `task_id` and `tool_use_id`. The documented status values on `task_notification` are completed, failed and stopped.
- A subagent's approval request arrives as a `can_use_tool` control request that carries `agent_id`, the same id as `task_id` of its `task_started`. The host can show "waiting for approval" on the right child.
- A workflow is one task (`task_type: local_workflow`). Its agents are not separate `task_started` events. They appear inside the `workflow_progress` array of `task_progress` and `task_notification`, with a per-agent `state`, label, phase and `agentId`.
- The PTY path has no event stream. Hooks `SubagentStart` and `SubagentStop` give start and finish with `agent_id`, and `SubagentStop` carries `agent_transcript_path`. Waiting for approval comes from the `PermissionRequest` or `Notification` hooks; whether `PermissionRequest` carries `agent_id` for a subagent is not verified. Failure has no hook of its own.
- Transcripts stay on disk after a node leaves the tree: one JSONL and one `.meta.json` per agent under the parent session's directory, plus a journal and a result file per workflow. A history view needs to persist only the session id and the project directory name; the rest is derivable. The app should still store its own index rows, because the CLI deletes transcripts after the retention period (default 30 days, `cleanupPeriodDays`).
- No base shows subagents as tree children today, and no base keeps a durable history of finished agents across sessions. Superset has a hook-fed subagent roster with a running count and an in-memory finished list. Scores are in the last section.

## 1. Event sources

### Stream-json (`claude -p --output-format stream-json --verbose`)

Documented (headless docs, "Follow subagent messages"; Agent SDK reference):

- Messages of subagents and forked skills appear as `assistant` and `user` messages with `parent_tool_use_id` set to the id of the `Agent` or `Skill` tool_use block. Main-conversation messages carry `null`. The docs tie forwarding at every nesting depth to `--forward-subagent-text` or `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`; the default for nested subagents is not stated and was not probed. `parent_agent_id` (v2.1.202 and later) names the spawning subagent in session messages.
- By default only the `tool_use` and `tool_result` blocks of a subagent are forwarded. `--forward-subagent-text` (or `CLAUDE_CODE_FORWARD_SUBAGENT_TEXT`) adds text and thinking blocks.
- A forked skill started with `/<name>` as the prompt uses a `forked-command-` prefix instead of a tool id and delivers its messages after it finishes.
- Background work: with stdin closed, `-p` stays open for background subagents and workflows until each finishes or a 10-minute idle cap (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) ends the wait. `--max-budget-usd` stops remaining background work. `--bare` disables background tasks.
- `task_notification` (SDK type `SDKTaskNotificationMessage`): fields `task_id`, `run_id`, `tool_use_id`, `status` (`completed`, `failed`, `stopped`), `output_file`, `summary`, `usage`. It covers background Bash, Monitor watches and background subagents. `task_progress` can carry a one-line `summary` per subagent when the SDK option `agentProgressSummaries` is on. `stopTask(taskId)` stops a task (control request in the CLI path; the exact control subtype was not probed).
- Workflow tool output: `taskId`, `taskType: local_workflow`, `runId`. Limits from the workflows page: 16 concurrent agents by default (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`, 1 to 256), 1,000 agents per run, 4,096 items per `parallel()` or `pipeline()`.

Observed in the probe (all of it not in the docs I read as field-level detail):

- `system/task_started`: `task_id`, `run_id`, `tool_use_id`, `description`, `subagent_type`, `is_backgrounded`, `spawn_depth`, `task_type` (`local_agent` or `local_workflow`), `prompt`; `workflow_name` for workflows.
- The first subagent `user` message carries `parent_tool_use_id`, `agent_id` (equal to `task_id`), `subagent_type`, `task_description`.
- `system/task_updated`: `patch: {status: "completed", end_time}`.
- `system/task_notification`: as documented, plus `summary_is_report` for background agents.
- `system/background_tasks_changed`: the full list of running background tasks, with `task_id`, `task_type`, `subagent_type`, `description`. It emits an empty list when the last one ends. It lists background tasks only; the foreground stream run emitted none, so it is a cross-check, not a count source.
- `task_progress` for a subagent: `last_tool_name` and `description` ("Writing p5_probe.txt").
- Workflow `task_progress.workflow_progress[]`: `workflow_phase` entries (`index`, `title`) and `workflow_agent` entries (`index`, `label`, `phaseIndex`, `phaseTitle`, `agentId`, `model`, `state` start or done, `startedAt`, `queuedAt`, `attempt`, `promptPreview`, `lastProgressAt`). The array is cumulative, so the host replaces its copy on each event.
- Subagents run in the foreground when the tool call says `run_in_background: false`, and `task_started.is_backgrounded` shows which. The model chose background on its own in one probe, so the host cannot assume foreground.
- Approval: `control_request` with `request.subtype: can_use_tool`, fields `tool_name`, `input`, `tool_use_id`, `permission_suggestions`, `agent_id`. The main session's requests have no `agent_id`. A denial by the host ended the subagent normally; `task_notification.status` was `completed`, not `failed`, and the subagent's own summary states the denial. A host that wants a failed state for denied work derives it.
- Closing stdin while a subagent waits for approval cancels the pending prompt (headless docs, "Stop a run with SIGTERM"). The exact error text is unverified: no log on disk shows it, and the approval run was foreground with stdin open. The host keeps stdin open until the second `result` of the run.
- A turn that starts background work ends with a `result`, and a later turn (a second `system/init` and a second `result`) follows when the notification wakes the model. The host must not treat the first `result` as the end of all work. A workflow's second `result` carries `origin: {kind: "task-notification", producer: "session-task", runId}`.
- `result.subagent_stats` exists (spawned, completed, failed, killed by parent/user/system, refused for depth, concurrency or budget). It counts Agent-tool subagents (stream: spawned 2, completed 2; background and approval runs agree) and reads zero for workflow agents.
- An invalid `subagent_type` fails as an `is_error` tool_result with no task events. A host sees a failed `tool_use` on the `Agent` call, not a failed node.
- The Workflow tool is available in `-p`. It needs permission: the probe approved it through the stdio permission prompt. The docs list allow rules `Workflow` or `Workflow(<name>)`, auto mode, bypass mode, a `PreToolUse` hook or the permission prompt tool as other routes. The `ultracode` keyword does not start a workflow in `-p`.

Transcript files for stream-json runs: same layout as the PTY path (below). `-p` sessions do not show in the `claude --resume` picker but resume by id. `--no-session-persistence` suppresses all transcript writes, so the app must not use it.

### PTY (interactive TUI)

Documented: hooks `SubagentStart` (fields `agent_id`, `agent_type`; matcher on agent type; cannot block), `SubagentStop` (fields `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`, `background_tasks`, `session_crons`), `TaskCreated` and `TaskCompleted` (for the TaskCreate tool, not subagents), `TeammateIdle` (agent teams). No workflow hook exists in the reference I read; the hooks page was read in part (the chunk after SubagentStop was read, the rest of the file was not).

Observed (PTY probe, two parallel subagents, hooks through `--settings`):

| Time from first hook (s) | Hook | agent_id |
|---|---|---|
| 0.00 | SessionStart | none |
| 8.38 and 8.44 | PreToolUse (Agent, twice) | none |
| 8.89 and 8.95 | SubagentStart | two ids |
| 9.72 and 9.77 | SubagentStop | the same two ids |
| 10.18 | Stop | none |
| 11.25 | SubagentStop | an id not seen at start (internal agent) |

- The last row is an internal agent of Claude Code (for example a prompt suggestion). The documentation says `SubagentStop` fires for those too, with `agent_type` empty or equal to the session's `--agent`. The host filters on an id it saw in `SubagentStart`.
- `SubagentStart` has no description and no `tool_use_id`. The link to the spawning tool call comes from `PreToolUse`/`PostToolUse` of the `Agent` tool (`tool_use_id`, `tool_input.description`) or, after the fact, from the `.meta.json` file (`toolUseId`, `description`). Matching by time order alone is ambiguous for parallel starts.
- The TUI itself shows the agents (footer "agents" count and a list under the prompt), which the user sees inside the terminal leaf. A host cannot read that reliably; hooks are the source.
- Waiting for approval: `PermissionRequest` and `Notification` (`notification_type: permission_prompt`) hooks. Not probed for a subagent in the PTY.
- Failure: no hook. `SubagentStop` fires for failed and finished agents alike. The host reads the tail of the agent transcript or `last_assistant_message`.
- `Stop` and `SubagentStop` carry `background_tasks`, the parent's list of background tasks (`id`, `type`, `status`, `description`; workflow tasks have type `workflow` and a `name`). The list lags: in the probe `Stop` still listed an agent as running after its `SubagentStop`. It is a cross-check, not a count source.
- For background launches, `PostToolUse` of `Agent` fires at launch with `tool_response` carrying `agentId`, `tool_use_id`, `outputFile` and `canContinueAgent`, so the join to the spawning call is exact. Foreground launches were not probed for the same data.
- Workflows in the PTY: not probed. The documentation says progress is in `/workflows` and the task panel; the agents of a workflow have `agent-*.meta.json` files and a `journal.jsonl` (below), so a host that watches the directory sees them.
- `~/.claude/sessions/{pid}.json` (used by Nimbalyst for busy, idle, waiting; undocumented) was not checked for subagents.

### Where transcripts live

Observed under `$CLAUDE_CONFIG_DIR/projects/<cwd with non-alphanumerics replaced by ->/` (default `~/.claude/projects/...`):

```
<session-id>.jsonl                                   main transcript
<session-id>/subagents/agent-<agentId>.jsonl         one per subagent
<session-id>/subagents/agent-<agentId>.meta.json     agentType, description, toolUseId, spawnDepth, requestShape, finished
<session-id>/subagents/workflows/<runId>/agent-<agentId>.jsonl and .meta.json
<session-id>/subagents/workflows/<runId>/journal.jsonl   launched, started (agentId, label, phase), result entries
<session-id>/workflows/<runId>.json                  script, taskId, run summary
<session-id>/workflows/scripts/<name>-<runId>.js     the script
/private/tmp/claude-<uid>/<cwd-name>/<session-id>/tasks/<taskId>.output   output_file of task_notification (temp, not durable)
```

- The `.meta.json` of a workflow agent has `agentType: workflow-subagent`, `workflowPhase`, `inWorkflowRun: true` and no `toolUseId`. The `finished` flag appeared on the Agent-tool subagent files and was not present in the workflow agent file I printed.
- The hook documentation confirms `agent_transcript_path` as `.../<session-id>/subagents/agent-<id>.jsonl`.
- The docs call the transcript entry format internal and unstable. The layout above is observed on 2.1.326 only. The app should treat parsing as best effort and fall back to showing the raw lines.
- Retention: 30 days by default (`cleanupPeriodDays`). `claude purge` deletes a project's transcripts.
- Nested agents: the layout under `subagents/` for a subagent that spawns subagents was not probed.

## 2. Probe

Measurements (2026-11-17, Haiku, `--max-budget-usd 0.25`, `--setting-sources user`, `--strict-mcp-config`, cwd `probes/work`):

| Run | Mode | What it did | total_cost_usd | Task events seen |
|---|---|---|---|---|
| stream | -p | two parallel Agent calls | 0.0086 | started, updated, notification for each |
| background | -p | one Agent with run_in_background | 0.0035 + 0.0053 (two results) | started, background_tasks_changed, updated, notification |
| approval | -p, manual mode, stdio prompt tool | subagent Write, host denies | 0.0058 | started, progress, control_request with agent_id, updated, notification |
| failure | -p | Agent with unknown type | 0.0034 | none, error tool_result |
| workflow | -p | Workflow, two agents in parallel | 0.0063 + 0.0070 | started (local_workflow), progress with workflow_progress, updated, notification |
| pty | TUI, hooks | two parallel subagents | not reported in this mode | SubagentStart, SubagentStop, Stop |

Event shapes that identify a subagent:

- Identity: `task_id` (equal to `agent_id` and to the id in `agent-<id>.jsonl`), `tool_use_id` of the spawning `Agent` call (equal to `parent_tool_use_id` on its messages and to `toolUseId` in its meta file), `run_id` (per start). The workflow directory id (`wf_...`) is neither the stream's `run_id` nor `result.origin.runId`. The join from stream to directory goes through the workflow `task_id`, which equals `taskId` in `<session-id>/workflows/<wf-id>.json`.
- Start: `task_started`. End: `task_updated` with `patch.status` followed by `task_notification` with `status`.
- Failure: documented as `status: failed` or `stopped` on `task_notification`. Not reproduced; the only failure I triggered happened before a task existed.
- Workflow agent identity: `workflow_progress[].agentId`, `label`, `phaseIndex`, joined to `task_id` of the workflow task. Workflow agents do not get `parent_tool_use_id` messages in the stream; the probe's stream carries no subagent assistant messages for them.

Not verified: `--forward-subagent-text` output (not run); a runtime subagent failure and `stopped` via `TaskStop`; nested subagents; a workflow agent waiting for approval (the probe allowed the workflow, and its agents used no tools); a subagent approval in the PTY; workflows in the PTY; agents started through the app's own MCP server.

## 3. Design

### Node model

Tree nodes are children of the session leaf. Source of truth is one record per agent, keyed `sessionId + agentId`. Workflow agents are keyed by workflow `task_id` plus `index` until `agentId` appears (queued agents have none), and the group node stores both the workflow `task_id` and the directory id `wf_...`. `SubagentStart` also fires when an agent resumes, and `canContinueAgent` allows a done agent to come back, so the store deduplicates by `agent_id` and lets a done node return to running.

States and how the host sets them:

| State | Stream-json | PTY |
|---|---|---|
| queued | workflow agent with `queuedAt` and no `startedAt` state start | not visible |
| running | `task_started`; workflow agent `state: start` | `SubagentStart` |
| waiting for approval | `can_use_tool` with this `agent_id` open and unanswered | `PermissionRequest`/`Notification` while the agent is running (attribution needs checking) |
| failed | `task_notification.status` failed; host-derived failure when the app denied a request and the agent reports it | last transcript line shows an error; no hook |
| stopped | `status: stopped` or the app called stop | app-initiated stop recorded by the app |
| done | `status: completed`; workflow agent `state: done` | `SubagentStop` |

Waiting overrides running and returns to running when the control response is sent. Failed and stopped are terminal states shown with the failed colour or a muted colour; the node does not linger longer than done unless it failed (see delay).

Workflows: a group node under the session labelled with `workflow_name` and the phase title, with agent children under phases, from `workflow_progress`. The group node follows the workflow task state. Because the array is cumulative, the host re-renders from the latest copy.

Count: the parent shows "N running" computed as running plus waiting agents across its subtree, and a second marker when any child waits for approval (a badge colour change, since waiting needs the user). `background_tasks_changed` and the `Stop` hook's `background_tasks` are cross-checks, not the source, because they omit foreground subagents.

Delay: a done node leaves the tree 10 seconds after it reaches done, configurable. A failed or waiting node stays until the user dismisses it or it is done; failed agents leave after 5 minutes unless selected. An agent that is selected or has its transcript open stays until it is deselected. On quick agents (the probe's finished in about a second), the node appears and leaves within the delay, so the parent keeps a short "finished" tally (a counter that resets after a minute) so the user sees that agents ran.

### History view

A filter on the tree ("Show finished agents") and a separate list. Both read the same index. The list is grouped by project folder, then session, then run, with columns for agent type or label, description, state, start, duration and tokens. Selecting a row opens the transcript read-only in a viewer pane (never a PTY, never `--resume`). The viewer reads `agent_transcript_path` and renders user, assistant, tool_use and tool_result lines. A "resume this agent" action is out of scope here. Forwarding is not needed for the viewer, since it reads the file.

### Data the app must persist

Per agent row: `agentId`, `sessionId`, `runId` (workflow) or null, `parentToolUseId` or null, `parentAgentId` or null, `projectDir` (cwd), `configDir` (the `CLAUDE_CONFIG_DIR` in force at launch), the absolute `transcriptPath` as reported by the hook or computed from the layout, `description`, `agentType`, `label`, `phase`, state, `startedAt`, `endedAt`, `summary`, tokens and duration from `task_notification.usage` when present, and `origin` (`session-started` or `app-started`, see below). Also persist the main session's transcript path and the workflow journal path for workflow groups.

Why: after the node disappears, the layout alone does not tell which config directory or project holds the file when several accounts or a `CLAUDE_CODE_PROJECT_DIR_NAME` are used. The index also survives the 30-day retention in a useful form: a row whose file is gone shows its summary and a "transcript removed" marker. Rows are written when the start event arrives and updated at the end, so a crash leaves a row in running state; on startup the app marks rows running with no live session as `unknown` and checks the `.meta.json` `finished` flag and the transcript's last line.

Consider raising `cleanupPeriodDays` in the settings the app passes with `--settings` for its sessions. Not tested whether `--settings` can set it (it is a user setting, so this needs checking).

### App-level swarm next to agent-started swarms

The app's MCP server (P3 in `RESULTS.md`) offers a tool to start sessions, and a tool to start several at once. Each started session is a normal Claude process the app owns, so it appears as a child of the requesting session, with `origin: app-started`. Differences the tree shows:

- Session-started agents (Agent tool, Workflow) are children by `parent_tool_use_id` and `task_id` of a task in the parent's stream. They have no process of their own; they die with the parent session.
- App-started agents are separate sessions. Each has its own stream, its own `result`, its own approvals and its own subagents. In the tree an app-started agent is a child node of the session that called the MCP tool, found through the MCP request (the app records the caller's session id from the tool call, which needs the app to learn the caller; the MCP request itself does not carry a session id, so the app issues a per-session token in the `--mcp-config` URL or header and maps token to session).
- Both kinds share one node component and one count. The icon marks the origin. An app-started child can have its own children, shown nested with its own count; the parent's count includes descendants.
- App-started agents can outlive the parent turn and can be stopped from the tree (kill the process, or send the interrupt control request). Session-started agents are stopped with `TaskStop` (the tool name seen in the tool list) or, in stream-json, the stop-task control request; the PTY has no host-side stop, only keys in the TUI.
- Concurrency limits differ. Session-started: the session's concurrent subagent limit and, for workflows, 16 agents by default. App-started: the app sets its own cap (cost and CPU) and shows it as "N of M" on the project node.

Open design point: the app starts agents in the PTY when the user wants to watch them, and in stream-json when it needs structured status. Swarm nodes need the stream-json path to show waiting and failure reliably; with a PTY leaf the app gets start, done and the approval hooks only. This is a reason to prefer stream-json for agents that belong to a swarm.

## 4. R16 scores by base

Weight 3 (0008). Scores after the independent review, from the existing notes and from reading the clones (nothing was run).

| Base | Score | Effort days to 3 | Confidence |
|---|---|---|---|
| superset | 2 | 6 | low |
| emdash | 2 | 8 | low |
| nimbalyst | 1 | 12 | low to medium |
| vscode | 2 | 6 | low to medium |
| greenfield | 2 | 7 | medium |

### Superset

- Status today: pane states `working`, `permission`, `review` and `failed` (`candidates/superset/apps/desktop/src/shared/tabs-types.ts`), set by hook-style events (`Stop`, `PermissionRequest`, `Failed` in `packages/agent-setup/templates/*`). `useTerminalAgentStatuses` in the renderer derives per-terminal status from the host-service store (`packages/host-service/src/terminal-agents/store.ts`).
- Subagents: shown inside the chat transcript. The chat protocol flattens items and expresses hierarchy through `parentItemId` (`plans/chat-protocol-v1.md`, line 17 and 104), with `subagentOutcome` mapping to running, failed, stopped, finished (`packages/chat/src/core/subagents/subagents.ts`), and the desktop has a subagent pane and a `subagentsInTurn` util under the ChatSession component. The host service has a subagent roster with Claude transcript parsers (`packages/host-service/src/terminal-agents/subagent-harnesses/claude.ts`, `docs/agent-session-handoff.md`, "The subagent pane keeps its own parsers"). The plan lists "Subagent transcripts as first-class sessions" as out of scope for v1 (`plans/chat-protocol-v1.md`, line 322).
- Superset already registers `SubagentStart` and `SubagentStop` for Claude (`packages/agent-setup/src/agent-wrappers-claude-codex-opencode.ts`) and keeps a roster per terminal with a stale timeout and a retention window (`packages/host-service/src/terminal-agents/store.ts`). The workspace activity panel has a Subagents group with a running count on the group and the trigger button; running subagents move automatically into a capped finished list, and each finished row opens the transcript in a pane (`WorkspaceActivityMenu.tsx`, `activityPanelStore.ts`).
- Missing: rows as tree children, waiting and failed states per subagent (finished rows say only "Done"), durable history across sessions (the finished list is an in-memory store), workflow agents.
- Work: the missing items above. Effort is raised by the size of the monorepo and the fixed pane registry (`notes/surfaces-candidates.md`).

### Emdash

- Status today: PTY transport installs hooks for `SessionStart`, `UserPromptSubmit`, `Notification` and `Stop` only (`packages/plugins/src/agents/impl/claude/hooks.ts`; `notes/triage-emdash.md`, "Status tracking uses hooks"), posted to a loopback `hook-server.ts`. Notifications are classified by message text, so there is a waiting state. One state per session, shown in the session list.
- Subagents: only in the ACP chat transport. The reducer folds tool calls of kind `subagent`, `task` or `agent` into a `spawn-subagent-tool-call` item (`packages/core/src/runtimes/acp/api/reducer/item-fold.ts`, lines 64 and 178), and `agents/integrations/providers.md` says known status updates subagent state. These render in the transcript, not in the tree. The ACP path uses the Agent SDK adapter, which 0001 excludes.
- Work: register `SubagentStart`/`SubagentStop`/`PermissionRequest` in the hook installer, extend the hook server's event schema and the session store with child records, add tree rows, count, timer and history. The hook installer writes into the user's real `~/.claude/settings.json` (`notes/triage-emdash.md`, "Extra check"), which the user must accept anyway. No stream-json path exists in the repo, so waiting and failure per agent are weaker than the stream-json design. The existing loopback hook server, hook installer and per-session status are more than the VS Code path has, and both get subagent data from PTY hooks only, so emdash scores 2 like VS Code.

### Nimbalyst

- Status today: sessions on a kanban-style board and a session list. In the CLI path the status comes from polling `~/.claude/sessions/{pid}.json` (busy, shell, idle, waiting; undocumented schema) (`notes/triage-nimbalyst.md`, "Status tracking: not by hooks").
- Subagents: a `TeammatePanel` in the session sidebar lists teammates and SDK-native spawned tasks with status `running`, `completed`, `errored`, `idle` (`candidates/nimbalyst/packages/electron/src/renderer/components/AgentMode/TeammatePanel.tsx`; `docs/TEAMMATE_IMPLEMENTATION.md`). The transcript view nests subagent events under parent calls (`docs/TRANSCRIPT_ARCHITECTURE.md`, line 96). Data comes from the Agent SDK path (`ClaudeCodeProvider`, `TeammateManager`), which is the default path and the one 0001 excludes; the CLI path has no equivalent today.
- Not children in the session tree: the panel sits inside the session view. The panel header shows a running/total count. No auto-removal, no finished-agent history across sessions.
- Work: feed `task_started`/`task_notification` (stream-json) or the hooks (PTY) into the existing teammate atoms, then promote the entries to tree rows with count and timer, plus a history list. Since the CLI path is off by default and the proxy-based observation sits in that path, extra work goes into the transport first.

### VS Code extension

- Status today: nothing exists. The planned tree uses a TreeView with nested nodes and hook-fed status through a local server (`notes/triage-vscode.md`, "Tree and task start" section; not tested).
- Fit: `TreeDataProvider` with `onDidChangeTreeData` supports adding and removing children at runtime, `TreeItem.description` for the "N running" text, `TreeItem.iconPath` with `ThemeIcon` and colour for state, `TreeView.badge` for a total, and `TextDocumentContentProvider` for read-only transcript documents (API facts from the VS Code API reference, not re-verified in this pass). The terminal-based session path means hooks are the data source; stream-json is possible for app-started agents through a child process.
- Limits: no custom row layout, no inline progress per row beyond icon and description, no timers except what the extension sets itself.
- Work: hook receiver for the start, stop and approval events, the node store, the timer, the history view as a second TreeView or a QuickPick, a content provider for transcripts.

### Greenfield

- Everything is built, so the R16 effort is the increment over the tree and session runtime. The stream-json event model above maps one-to-one to nodes; the PTY path needs hooks. Score 2 on the assumption that the tree (R6) and the launch paths are already part of the greenfield estimate.
- Work: event normaliser (stream-json and hook forms into one agent record), store, tree rows with state colours and count, timer, history view and read-only transcript viewer, approval routing by `agent_id`. The app-started swarm tool belongs to R18 and is not counted here.

## Not verified

- Subagent failure and `stopped` statuses in the stream.
- `--forward-subagent-text` behaviour in the probe.
- Nested subagents and nested workflow transcripts.
- A workflow agent that needs approval; workflows in the PTY.
- Whether `PermissionRequest` hooks carry `agent_id` for a subagent.
- The TaskStop and stop-task control message shapes.
- Whether `cleanupPeriodDays` can be raised through `--settings`.
- VS Code API capabilities: from memory of the API, not fetched in this pass.
- Candidate scores rest on reading code only; nothing was built or run.

## Review corrections

An independent review checked this note against the probe logs, the clones and the docs. Changes made:

- R16 weighs 3 (0008), not 2.
- Superset: hooks, roster, running count, automatic move to a finished list and transcript panes exist; effort 10 to 6, rationale rewritten.
- Emdash: 1 / 12 to 2 / 8, for consistency with VS Code (both are hook-only; emdash has the hook server already).
- VS Code: 2 / 6 kept, confidence lowered to low to medium (API facts from memory).
- Greenfield: 8 to 7 days; the app-started swarm tool moves to R18.
- Nimbalyst: 1 / 12 kept; its panel has a running/total count.
- `subagent_stats` counts Agent-tool subagents; zero only for workflow agents.
- The `AbortError: Stream closed` text has no log; the behaviour rests on the headless docs.
- `background_tasks_changed` and `background_tasks` are cross-checks only (background-only, and the PTY list lags).
- Workflow directory id differs from the stream ids; the join uses the workflow `task_id`.
- Nested-subagent rebuild depends on `--forward-subagent-text`, not probed.
- Added from the review, not probed: `SubagentStart` fires on resume, so done nodes can return to running; the internal agent's `agent_transcript_path` did not exist on disk, so the history view must not assume a readable path; `PermissionRequest` input has no `tool_use_id` (hooks reference), so a PTY approval cannot be tied to one tool call; `task_notification` for foreground subagents is observed on 2.1.326, not documented; the probe ran with `--setting-sources user`, so user plugin agents loaded.
