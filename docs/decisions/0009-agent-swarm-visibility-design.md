# 0009 Agent swarm visibility: design

Status: proposed
Date: 2026-11-17
Proposed by: spike agents, pending user confirmation (0007)
Inputs: 0002 (R16), 0004, 0008, `notes/swarm-visibility.md` and its review corrections, `probes/out/p5_*`

## Context

R16 (0002, weight 3 under 0008) asks that every running agent shows in the tree as a child of the session that started it, with a state, a running count on the parent, automatic removal after a short delay, and a history view that opens finished transcripts read-only. Agents start inside a session (Agent tool, Workflow tool) or from the app (0011).

The P5 probe on Claude Code 2.1.326 measured what each launch path exposes. The stream-json path gives a typed lifecycle per subagent. The PTY path gives hooks only. An independent review corrected the probe note; this record uses the corrected facts. Nothing in the design below is built.

## Decision

### 1. Event sources

| Need | Stream-json (`-p`) | PTY (interactive TUI) |
|---|---|---|
| Start | `system/task_started` (`task_id` = `agent_id`, `tool_use_id`, `description`, `subagent_type`, `is_backgrounded`, `task_type`) | `SubagentStart` (`agent_id`, `agent_type`; no description, no `tool_use_id`) |
| Link to the spawning call | `parent_tool_use_id` on the subagent's messages; `tool_use_id` on `task_started` | `PostToolUse` of `Agent`: for background launches its `tool_response` carries `agentId` and `tool_use_id`; later the `.meta.json` file (`toolUseId`, `description`) |
| Progress | `task_progress` (`last_tool_name`, `description`, usage in tokens) | none |
| Waiting for approval | `can_use_tool` control request with `agent_id` | `PermissionRequest` or `Notification` hook; `agent_id` on these is documented as a common field, not probed; no `tool_use_id` |
| End | `task_updated` with `patch.status`, then `task_notification` (`completed`, `failed`, `stopped`) | `SubagentStop` (`agent_transcript_path`, `last_assistant_message`); no failure hook |
| Workflows | one task with `task_type: local_workflow`; agents in the cumulative `workflow_progress` array | `background_tasks` on `Stop` and `SubagentStop` lists the workflow; per-agent detail only from the run directory |
| Running background work | `background_tasks_changed` (background tasks only) | `background_tasks` on `Stop` and `SubagentStop` (lags) |

One normaliser turns both forms into agent records. The app filters out `SubagentStop` events for ids it never saw start (internal agents). Agents that belong to an app swarm run on stream-json, because the PTY path cannot show waiting or failure reliably.

### 2. Node states

| State | Set by |
|---|---|
| queued | workflow agent with `queuedAt` and no `startedAt` |
| running | `task_started`, workflow `state: start`, `SubagentStart` |
| waiting for approval | an open `can_use_tool` request with this `agent_id`; in the PTY a `PermissionRequest` while the agent runs (attribution unverified) |
| failed | `task_notification` status `failed`; a host-derived failure when the agent reports a denial (a host denial ends the task as `completed`) |
| stopped | status `stopped`, or a stop the app issued |
| done | status `completed`, workflow `state: done`, `SubagentStop` |
| unknown | after an app restart, a running row with no live session |

Waiting overrides running and returns to running when the answer is sent. `SubagentStart` also fires when an agent resumes, and `canContinueAgent` allows a finished agent to come back, so records are keyed `sessionId + agentId` and a done node can return to running. Workflow agents are keyed by the workflow `task_id` plus their index until an `agentId` appears.

### 3. Running count

The parent shows the number of running and waiting agents across its subtree, computed from the app's own records. A separate marker shows when any descendant waits for approval. `background_tasks_changed` and the hook `background_tasks` lists are cross-checks only: they omit foreground subagents and the hook list lags. Quick agents can appear and leave inside the removal delay, so the parent also keeps a short "finished" tally that resets after a minute.

### 4. Removal delay

A done node leaves the tree 10 seconds after it reaches done; the delay is a setting. A failed node stays for 5 minutes or until dismissed. A waiting node never leaves on a timer. A node that is selected or has its transcript open stays until deselected. A revived agent re-enters the tree and cancels its timer.

### 5. History view and what to persist

A tree filter ("show finished agents") and a separate list read the same index, grouped by project folder, session and run, with agent type or label, description, state, start, duration and tokens. Selecting a row opens the transcript read-only in a viewer pane, never a PTY and never `--resume`.

Persisted per agent: `agentId`, `sessionId`, the workflow `task_id` and run directory id (`wf_...`) for workflow agents, `parentToolUseId`, `parentAgentId`, project directory, `CLAUDE_CONFIG_DIR` at launch, absolute transcript path, description, agent type, label, phase, state, start and end times, summary, tokens and duration when reported, and origin (`session-started` or `app-started`). Also the main transcript path and, for workflows, the journal and run-file paths.

Reasons: the transcript layout alone does not say which config directory or project holds a file; the CLI deletes transcripts after the retention period (30 days by default); the workflow directory id differs from every id in the stream and is joined through the workflow `task_id` in `<session-id>/workflows/<wf-id>.json`. A row whose transcript is gone shows its summary and a "transcript removed" mark. A row whose reported path does not exist (seen for an internal agent) shows the same mark. Rows are written at start and updated at the end; after a crash the app checks the `.meta.json` `finished` flag and the last transcript line.

### 6. App-level swarms beside session-started agents

- Session-started agents (Agent tool, Workflow tool) are tasks inside the parent's process. They are children by `parent_tool_use_id` and `task_id`, end with the parent, and stop through `TaskStop` or the stop-task control request in stream-json; the PTY has no host-side stop.
- App-started agents (0011) are separate sessions with their own stream, results, approvals and subagents. The app's MCP request carries no session id, so the app issues a per-session token in the `--mcp-config` URL and maps token to caller. The new session appears as a child of the caller, or under the swarm's folder node when the user started it.
- Both kinds use one node component and one count; an icon marks the origin. Nested children show with their own counts, and the parent count includes descendants.
- Concurrency shows per origin: the session's subagent limit and the workflow limit for session-started agents, and the app's own cap as "N of M" on the project node for app-started agents.

## Consequences

- The tree is strongest for agents on the stream-json path. PTY sessions show start, end and approval prompts; waiting attribution and failure there are best effort.
- The transcript entry format is internal and unstable; parsing is best effort with a raw-line fallback, and the probe scripts re-run on each CLI upgrade.
- Effort for greenfield: 2 / 7 days in 0005, over the tree and session runtime of R6 and 0004. The swarm start tools belong to R18 (0011).
- Not verified: subagent `failed` and `stopped` in a run; nested subagents and their transcript layout (nested forwarding is tied to `--forward-subagent-text`); a workflow agent waiting for approval; workflows in the PTY; `agent_id` on PTY approval hooks; foreground `PostToolUse` data for the join; the `TaskStop` and stop-task message shapes; whether `cleanupPeriodDays` can be raised through `--settings`.
