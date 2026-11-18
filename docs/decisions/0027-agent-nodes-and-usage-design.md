# 0027 Agent nodes and usage: design

Status: proposed
Date: 2026-11-17
Proposed by: spike agents, pending user confirmation
Inputs: 0004 (amended by 0014 and 0024), 0009, 0011, 0012, 0013, 0017, 0019, 0020, 0021, 0022, 0023, 0024, 0025; `notes/swarm-visibility.md`, `notes/probes-m2.md` (P11, P12, P13), `probes/RESULTS.md`, `probes/out/p5_*`, `probes/out/p13_report.json`, `probes/hooks/statusline_capture.py`; the session code in `app/src/core/session` (`hooks.ts`, `HookInbox.ts`, `status.ts`, `types.ts`, `launchArgs.ts`, `PtySessionService.ts`, `SessionStore.ts`) and the hook delivery contract in `app/src/core/isolation/types.ts`
Refines: 0009 (R16) and 0019 (R24)
Amends: 0021 section 3 (usage alerts, the `SubagentStop` and `rate_limit_event` rows), 0024 recommendation 4

## Context

0009 designed agent nodes from the P5 probe: one normaliser over stream-json events and PTY hooks, node states, a running count, a removal delay and a history view. 0019 stated R24: usage per session, agent, swarm and profile, rates over a sliding window, a ranking, heat markers, plan usage per profile with a forecast, alerts to the inbox, and labels that say what a number is. Neither is built. 0025 places "agent nodes with usage views" in milestone 3.

Milestone 2 changed the facts under both records:

- P11: `Notification` fires with `notification_type` `permission_prompt` about 6 s after a dialog opens and only while it is open, and `idle_prompt` about 59 s after `Stop`. It carries no tool fields.
- P12: a status line command from `--settings` receives JSON on each update with `cost.total_cost_usd` (subagent requests included, inferred from one run), the context of the latest request, `prompt_cache`, and, after the first request of a subscriber session, `rate_limits.five_hour` and `rate_limits.seven_day` with `used_percentage` and `resets_at`. It overrides a project status line. Claude Code may cancel a running command, so readers ignore temporary files. The payload holds absolute paths of the user's directories.
- P13: every assistant transcript line carries `message.usage`; one API message with several content blocks spans several lines with the same `message.id` and usage, so each id counts once. Subagents write `<session id>/subagents/agent-<id>.jsonl` and `.meta.json`. Internal agents leave no transcript, so a sum over files undercounts; the `cost-state` rows written at process exit hold the process total. Background subagent results come back as `UserPromptSubmit` prompts that start with `<task-notification>`, each followed by another `Stop`.
- The app already registers `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Notification`, `PermissionRequest`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop` and `SessionEnd` through `--settings` (`hooks.ts`). The hook command writes one file per payload into the session's events directory; `HookInbox` delivers every file whose name ends in `.json` and deletes it. `PtySessionService` emits `session.hook` events with the raw payload, and `status.ts` derives the session status from them.
- The `-p` stream-json launch path is not built (0024). The concurrent-agent cap of app-started agents is 4 (0012, 0024).

## Decision

### 1. Event normaliser

One pure module, `core/agents/normalise`, turns each source into `AgentFact` values. It does no I/O and keeps no state beyond what the caller passes in; the store (section 2) applies facts in order. Each source has its own adapter, tested against fixtures copied from `probes/out` with paths and personal values replaced.

```ts
/** `agentKey` is the CLI agent id, `wf:<workflow task id>` for a workflow group, `wf:<workflow task id>:<index>` for a workflow agent, or `main` for the session's own conversation. */
interface AgentRef { readonly sessionId: SessionId; readonly agentKey: string }

type AgentFact =
  | { kind: 'started'; ref: AgentRef; at: string; agentId?: string; agentType?: string; description?: string;
      toolUseId?: string; parentAgentId?: string; backgrounded?: boolean; queued?: boolean;
      workflow?: { taskId: string; index: number; label?: string; phase?: string }; transcriptPath?: string }
  | { kind: 'linked'; ref: AgentRef; agentId?: string; toolUseId?: string; description?: string; transcriptPath?: string }
  | { kind: 'progress'; ref: AgentRef; at: string; lastTool?: string; text?: string }
  | { kind: 'waiting'; ref: AgentRef; at: string; requestKey: string; toolName?: string; attribution: 'exact' | 'session' }
  | { kind: 'answered'; ref: AgentRef; at: string; requestKey?: string }
  | { kind: 'ended'; ref: AgentRef; at: string; outcome: 'completed' | 'stopped' | 'failed' | 'denied' | 'lost';
      basis: 'reported' | 'derived'; summary?: string; transcriptPath?: string; totalTokens?: number }
  | { kind: 'usage'; ref: AgentRef; at: string; messageId: string; model?: string; usage: TokenUsage }
  | { kind: 'session-cost'; sessionId: SessionId; at: string; costUsd: number; basis: 'status-line' | 'result' | 'cost-state' }
  | { kind: 'plan'; at: string; window: 'five_hour' | 'seven_day'; usedPercentage: number; resetsAt: string;
      source: 'status-line' | 'rate-limit-event' };

interface TokenUsage { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }
```

Sources:

| Source | Used for | Adapter input |
|---|---|---|
| Hook inbox | sessions in the PTY (user sessions) | `session.hook` events (`hookEvent`, raw payload) plus the session's open-request table |
| Stream-json | app-started agents on `-p --output-format stream-json`, under the cap of 4 concurrent app-started agents (0012) | each parsed stdout message and each control request and response the app sends |
| Status line file | live cost and plan usage of PTY sessions | the latest `status.snapshot` of the session (section 6) |
| Transcripts | usage per agent while it runs, history, repair after a crash, outcome checks | appended lines of the main and `subagents/` files, the `.meta.json` files, the `cost-state` rows at exit |

Hook adapter (PTY):

| Hook | Fact |
|---|---|
| `SubagentStart` | `started` with `agent_id`, `agent_type`; the transcript path is `<dirname of transcript_path>/<session id>/subagents/agent-<id>.jsonl` |
| `PreToolUse` of `Agent` | no fact; the adapter queues `tool_input.description` and `tool_use_id` per session for the next `SubagentStart` (ambiguous for parallel starts, so the match is marked tentative until `linked` arrives) |
| `PostToolUse` of `Agent` with `tool_response.agentId` | `linked` with `agentId`, `tool_use_id`, the description from the queued input; a background launch reports it at launch (`status` `async_launched`, P5, P13), a foreground launch at completion (`status` `completed`, hooks docs, not probed) |
| `PermissionRequest` | `waiting` on the agent named by `agent_id` when the payload has one and the agent is running (`attribution: 'exact'`), otherwise on `main` with `attribution: 'session'`; `requestKey` is the hash of tool name and input that 0021 uses for its dedupe key |
| `PreToolUse`, `PostToolUse` with the same tool name and input as an open request | `answered` for that request |
| `Stop`, an interrupt line in the transcript, `SessionEnd` | `answered` for every open request of the session |
| `SubagentStop` for an id seen at `SubagentStart` | `answered` for the open requests attributed to that agent; `ended`, outcome `completed`, basis `derived`, `last_assistant_message` as summary, `agent_transcript_path`; the outcome check below may change it |
| `PreToolUse` of `SubagentHandback` with an `agent_id` | no fact; the adapter keeps `tool_input.message` as that agent's summary, because the hooks docs say `last_assistant_message` then holds the closing text and not the report (2.1.271 and later, not probed) |
| `SubagentStop` for an id never seen at start | dropped (internal agents, P5 and P13) |
| `UserPromptSubmit` whose prompt starts with `<task-notification>` | a refinement of the matching agent's outcome from the `<task-id>` and `<status>` elements; the prompt also carries `<tool-use-id>`, `<summary>`, `<result>` and `<usage>` with `<subagent_tokens>` (a total), `<tool_uses>` and `<duration_ms>` (P13 hook log, status `completed` only; other status values are U1). The note in the prompt says one agent can notify more than once when it is resumed |
| `Notification` `permission_prompt` | no fact; it confirms that the open request is still unanswered (0021 uses it for notifying) |
| `StopFailure` | `answered` for open requests of the session; running foreground agents keep their state until their `SubagentStop` or the session's exit |
| `session.exited` | every agent of the session still `running` or `waiting` ends with outcome `lost`, basis `derived`, unless its `.meta.json` says `finished`, which gives `completed` |

Outcome check for PTY agents: after `SubagentStop` the adapter reads the last lines of the agent transcript (at most 64 KiB from the end). A last assistant line marked as an API error, or an interrupt line, turns the outcome into `failed` or `stopped` with basis `derived`. Which marker the CLI writes for a failed subagent is not probed (U2); until then the check recognises the interrupt line of P10 only and every other `SubagentStop` stays `completed`.

Stream-json adapter (app-started agents):

| Message | Fact |
|---|---|
| `system/task_started`, `task_type` `local_agent` | `started` with `task_id` as agent id, `tool_use_id`, `description`, `subagent_type`, `is_backgrounded` |
| `system/task_started`, `task_type` `local_workflow` | `started` for a workflow group row with `agentKey` `wf:<task id>` |
| `task_progress` | `progress` (`last_tool_name`, `description`); for a workflow, the cumulative `workflow_progress` array is diffed against the previous copy: an entry with `queuedAt` and no `startedAt` is `started` with `queued: true`, `state: start` is `started`, `state: done` is `ended` with outcome `completed`, basis `reported` |
| `control_request` `can_use_tool` | `waiting` on `agent_id` when present (`attribution: 'exact'`), on `main` otherwise; `requestKey` is the request id |
| the app's `control_response` | `answered`; a deny from the app is remembered per agent, and that agent's later `ended` becomes outcome `denied`, basis `derived` (P5: a host denial ends the task as `completed`) |
| `task_updated` with `patch.status`, `task_notification` | `ended` with the reported status (`completed`, `failed`, `stopped`), basis `reported`, `summary`, and `usage.total_tokens` as `totalTokens` (the stream reports only `total_tokens`, `tool_uses` and `duration_ms`, P5) |
| `result` | `session-cost` with `total_cost_usd`, basis `result`; the value and `modelUsage` are cumulative for the process, so each `result` replaces the previous one (P1 multi-turn, P5 background and workflow runs); `subagent_stats` is a cross-check in the debug log only. The first `result` of a turn with background work is not the end of the session's work (P5) |
| `rate_limit_event` | `plan` facts from `rate_limit_info.unifiedWindows.five_hour` and `.seven_day`: `utilization` (a fraction, times 100) and `resetsAt` (epoch seconds), seen in the `-p` probe logs (P5 and later) with `status` `allowed`; a `status` other than `allowed` (not observed, U3) also raises the rate-limit alert of 0021 section 3 |
| process exit | as `session.exited` above |

Transcript adapter (both paths): `usage` facts by `message.id` from appended assistant lines; for each id the last seen usage object counts, once. `cost-state` rows at exit give `session-cost` with basis `cost-state`. For history and repair it reads `.meta.json` (`agentType`, `description`, `toolUseId`, `finished`) and the first and last line times.

`background_tasks_changed` and the `background_tasks` lists on `Stop` and `SubagentStop` are cross-checks written to the debug log; they never set a state (0009).

### 2. Agent store and states

Module `agents` (new, under `src/core/agents`, initialized after `session` and `inbox`) owns an `AgentStore` interface with an in-memory and a SQLite implementation that pass one contract suite. It applies facts, keeps the open requests per session, runs the removal timers (section 3) and emits `agents.changed` with the changed rows on the event bus, coalesced to at most one event per 250 ms.

States:

| State | Meaning | Shown as |
|---|---|---|
| `running` | started and not ended; a queued workflow agent is `running` with a "queued" mark | state colour and the last tool or description |
| `waiting` | an open approval request is attributed to the agent; overrides `running` and returns to it on `answered` | the waiting colour; the parent gets the waiting marker |
| `failed` | ended with outcome `failed`, `denied` or `lost` | the failed colour; the outcome and its basis ("reported" or "derived") in the tooltip and the history row |
| `done` | ended with outcome `completed` or `stopped` | muted; a `stopped` row says "stopped" |

Derivation per source:

| State | Stream-json | Hook inbox (PTY) | Transcripts (history and repair) |
|---|---|---|---|
| `running` | `task_started`; workflow entry `start` or queued | `SubagentStart` | `.meta.json` without `finished` while the session runs |
| `waiting` | open `can_use_tool` with this `agent_id` (exact) | `PermissionRequest` with this `agent_id` (documented field, not probed for a subagent, U4); without it the request marks the session, never a guessed agent | not derived |
| `failed` | `task_notification` `failed`; a run whose request the app denied; process exit while running | outcome check after `SubagentStop`; session exit without `SubagentStop` and without `finished` | last line an API error (U2); `finished` missing after the session ended |
| `done` | `task_notification` `completed` or `stopped`; workflow entry `done` | `SubagentStop` | `finished` true |

Rules:

- Records are keyed by session and agent key. `SubagentStart` also fires when an agent resumes and a finished agent can continue, so a `started` fact for an ended record returns it to `running`, clears its end time and cancels its removal timer.
- A workflow agent keyed `wf:<task id>:<index>` takes its CLI id when the first `workflow_progress` entry with an `agentId` arrives; the key stays, the id is stored.
- Facts on `main` are not agent records of a user session: `waiting` and `answered` on `main` set and clear the session leaf's waiting marker, and `usage` on `main` counts towards the session only. For an app-started session the store applies them to its row with agent key `session`.
- Facts that arrive for an unknown record and are not `started` are kept for 5 seconds in a pending list per session (hook files and transcript reads can reorder) and then dropped with a debug line.
- After an app restart no PTY or stream-json process of the old run is alive. Rows still `running` or `waiting` go through the transcript repair: `finished` true gives `done`, anything else `failed` with outcome `lost`, basis `derived`.

### 3. Tree: agent nodes under their session

Agent nodes are not rows of `tree_nodes`. The tree pane merges the `agents` data source (0020 section 1) under session leaves, so the tree store sees no writes per agent and folder scoping stays the session's.

- Session-started agents are children of their session leaf. A child with `parent_agent_id` nests under that agent (nested agents are not probed; until then every subagent shows one level below the session). A workflow is a group node labelled with the workflow name, its agents under phase headings from `workflow_progress`.
- App-started agents are sessions of their own (stream-json, section 5). They are leaves of the caller's folder with a `spawned_by` link, and the tree pane renders them nested under the calling session leaf. Started by the user from a swarm (0011), they sit under the swarm's folder. Their own subagents nest below them.
- One node component for both origins; an icon marks app-started agents. The row shows label or description (plain text, 0021 section 9), state, elapsed time and the heat marker (section 9).
- Running count: the parent shows the number of `running` and `waiting` agents in its subtree, app-started descendants included, and a separate waiting marker when any of them waits. A finished tally ("N finished") counts agents that ended in the last minute, so agents that start and end inside the removal delay still leave a trace.
- The project folder shows the app-started cap as "N of 4" (the setting `agents.maxConcurrentAppStarted`, default 4, 0012).

Removal delay:

| Node | Leaves the tree |
|---|---|
| `done` | after `agents.removeDoneAfterSeconds`, default 10, range 0 to 3600 |
| `failed` | after `agents.removeFailedAfterSeconds`, default 300, or on dismiss |
| `waiting`, `running` | never on a timer |
| selected, or its transcript open in a viewer | stays until deselected or the viewer closes; the timer restarts then |
| a revived agent | re-enters and cancels its timer |

Both settings live in the profile settings (0022) and apply to new timers at once.

### 4. History view and what is persisted

- A tree filter, "Show finished agents", keeps ended nodes in the tree with a muted style. A history pane, block `agide/agent-history`, lists the same rows grouped by project folder, session and workflow run, with filters for state, origin, folder (the caller's scope) and time range. Columns: label or type, description, state with outcome and basis, start, duration, tokens, estimated cost.
- Selecting a row opens the transcript read-only in an `agide/transcript-viewer` pane: user, assistant, tool use and tool result lines rendered as plain text, unknown line types as raw JSON text. Never a PTY and never `--resume`. A file over 20 MB opens at its last 20 MB with a notice.

Persisted (module `agents`, migration 1, in the profile's database; checked against `node:sqlite` in Node 22 with stand-in `tree_nodes` and `sessions` tables):

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,                 -- '<session id>:<agent key>'; an app-started agent uses its own session id
  session_id TEXT NOT NULL,            -- the session the agent runs in
  agent_key TEXT NOT NULL,             -- CLI agent id, 'wf:<task id>' (group), 'wf:<task id>:<index>', or 'session' for an app-started agent
  agent_id TEXT,
  parent_session_id TEXT,              -- the caller of an app-started agent; NULL when the user started it
  parent_agent_id TEXT,
  parent_tool_use_id TEXT,
  swarm_id TEXT,
  workflow_task_id TEXT,
  workflow_dir_id TEXT,                -- the 'wf_...' directory id, joined through '<session>/workflows/<wf-id>.json'
  workflow_index INTEGER,
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('session-started', 'app-started')),
  source TEXT NOT NULL CHECK (source IN ('hook', 'stream', 'transcript')),
  agent_type TEXT CHECK (agent_type IS NULL OR length(agent_type) <= 120),
  label TEXT CHECK (label IS NULL OR length(label) <= 120),
  phase TEXT CHECK (phase IS NULL OR length(phase) <= 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 400),
  state TEXT NOT NULL CHECK (state IN ('running', 'waiting', 'failed', 'done')),
  outcome TEXT CHECK (outcome IN ('completed', 'stopped', 'failed', 'denied', 'lost')),
  outcome_basis TEXT CHECK (outcome_basis IN ('reported', 'derived')),
  project_dir TEXT NOT NULL,
  config_dir TEXT,                     -- CLAUDE_CONFIG_DIR in force at launch; NULL for the CLI default
  transcript_path TEXT,
  transcript_copy TEXT,                -- path of the app's compressed copy, relative to the profile data directory
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 2000),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  updated_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cost_basis TEXT CHECK (cost_basis IN ('reported', 'price-table')),
  UNIQUE (session_id, agent_key),
  CHECK ((state IN ('failed', 'done')) = (ended_at IS NOT NULL AND outcome IS NOT NULL)),
  CHECK ((origin = 'app-started') = (agent_key = 'session'))
);
CREATE INDEX agents_by_session ON agents (session_id, state);
CREATE INDEX agents_history ON agents (folder_id, ended_at);

CREATE TABLE usage_totals (
  session_id TEXT PRIMARY KEY,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  cache_read_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0),
  cost_basis TEXT CHECK (cost_basis IN ('status-line', 'result', 'cost-state', 'price-table')),
  final INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE plan_usage (
  window TEXT PRIMARY KEY CHECK (window IN ('five_hour', 'seven_day')),
  used_percentage REAL NOT NULL CHECK (used_percentage >= 0),
  resets_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('status-line', 'rate-limit-event'))
);
```

The check showed that a done row without an outcome, a second row for the same session and agent key, an app-started row with an agent key and an unknown plan window are refused, that a revived row can return to `running`, and that deleting a folder keeps its agent rows with no folder.

Rows are written at `started` and updated on every state change and at the end; token columns are written at the end and every 30 seconds while running. Why each path field is kept: the transcript layout alone does not say which configuration directory or project holds a file (0009); profiles may use their own `CLAUDE_CONFIG_DIR` (0022).

Keeping transcripts reachable:

- The CLI deletes transcripts after `cleanupPeriodDays` (30 by default). The app does not raise it through `--settings`: the cleanup runs over every project of the configuration directory, so a session's setting would change retention for the user's own sessions too.
- When an agent ends, the app copies its transcript (and `.meta.json`) gzip-compressed to `transcripts/<session id>/agent-<id>.jsonl.gz` in the profile data directory (0700 directory, 0600 files), and the main transcript of a session when it exits. Setting `agents.keepTranscriptsMb`, default 200; above it the oldest copies go first, and their rows lose `transcript_copy`. 0 turns copying off.
- The viewer opens the original while it exists, else the copy. A row with neither shows its summary and "transcript removed". A reported path that never existed (seen for internal agents) shows the same mark.
- Done and failed rows follow the inbox retention setting (default 90 days, 0021); their copies go with them.

### 5. App-started agents beside session-started agents

| | Session-started (Agent tool, Workflow tool) | App-started (0011 swarm tools, task start) |
|---|---|---|
| Process | a task inside the parent session's process | a `claude -p` stream-json process of its own, through the isolation provider like any session |
| Events | hooks (PTY) or stream-json of the parent | its own stream-json |
| States | `waiting` attribution exact in stream-json, session-level in the PTY until U4; failure best effort in the PTY | every state reported |
| Tree place | child of the session leaf | leaf in the caller's folder, rendered under the caller (the app maps the per-session MCP token to the caller, 0009) |
| Limit | the CLI's subagent limit and the workflow limit (16 by default) | the app's cap, default 4, shown as "N of 4"; a start at the cap is refused with an `alert` item (0021) |
| Pause | interrupt of the whole parent turn (PTY: Esc, P10; stream-json: interrupt control request); whether running background subagents stop with it is not probed | interrupt control request; the app holds the next prompt and new starts of its swarm |
| Stop | stream-json: the stop-task control request (shape not probed, U5); PTY: none for one agent, only an interrupt of the session | close stdin, then end the process after 5 s; outcome `stopped`, basis `reported` by the app |
| Usage | breakdown of the parent session's usage | a session of its own; rolls up to its swarm and folder, not into the caller's own figure |

App-started agents use stream-json because the PTY cannot show waiting and failure reliably (0009). An app-started agent the user wants to watch opens a read-only transcript viewer; a PTY for it waits.

### 6. Status line command

The session launch adds a `statusLine` to the `--settings` JSON next to the hooks:

```ts
{ statusLine: { type: 'command', command: statusLineCommand(delivery.dir) } }
```

`statusLineCommand` follows `hookCommand`: `/bin/sh -c 'f=$(mktemp "$1/tmp-XXXXXX") && cat > "$f" && mv "$f" "$1/status.snapshot"' sh <dir>`. It prints nothing, so the TUI status area stays empty; with any status line configured the TUI also drops some footer hints such as `? for shortcuts` (status line docs). It writes into the session's events directory, which the isolation provider already maps (`HookDelivery` `inbox-dir`), as `status.snapshot`. An `http` delivery has no directory; the session service refuses it today, and a provider that offers only `http` needs another route for the snapshot. The name has no `.json` suffix, so `HookInbox` never delivers or deletes it. The `rename` is atomic in one directory (P12 stress test). A `UsageCollector` per session polls the file's modification time every second, parses it with a zod schema that keeps only `session_id`, `model.id`, `cost.total_cost_usd`, `cost.total_duration_ms`, `context_window.used_percentage`, `context_window.context_window_size` and `rate_limits`, and drops the rest, so the absolute paths in the payload never leave the collector. It removes `tmp-*` files without the `.json` suffix that are older than 60 seconds (a cancelled command can leave one). Hook commands use the same prefix; their `cat` ends when the CLI closes stdin, so a hook temporary file of that age is expected to be a leftover too (not measured), and a finished hook file (`.json`) is left to `HookInbox`. No `refreshInterval`: the values change only with requests (P12).

The status line JSON reaches the collector only; no MCP tool returns it, and the per-session directory is removed with the session as today.

A user-level `statusLine` is expected to be replaced by the app's: the settings docs place `--settings` above the user file, and P12 showed the same order against a project file; it is not tested for user settings (U6). Once U6 confirms it, a setting `usage.keepUserStatusLine` lets the app's command pass the JSON on to the user's command and print its output; it is off until then.

### 7. Counting usage

| Figure | Live source | Final source | Label |
|---|---|---|---|
| Session cost, PTY | `cost.total_cost_usd` from the status line (subagents included, inferred, U7) | `cost-state` `totalCostUSD` at exit | "estimated, list price" |
| Session cost, stream-json | the latest `result.total_cost_usd` of the process (cumulative, section 1); between results the token usage since that `result` times the price table | the last `result` and `cost-state` at exit | "estimated, list price" |
| Session tokens | transcript usage by `message.id`, main file and `subagents/` | `cost-state` `modelUsage` at exit (internal requests included) | "tokens"; before exit "so far, without internal requests" |
| Agent tokens | its transcript by `message.id`, per token class; stream-json `task_progress.usage.total_tokens` and the workflow entry's `tokens` give a total only | the transcript at `ended`; `task_notification.usage.total_tokens` or the `<subagent_tokens>` of a `<task-notification>` prompt when the transcript is missing | "tokens" |
| Agent cost | the transcript's tokens per class times the price table; a total without classes gives no cost | the same | "estimated from tokens" |
| Other requests of a session | session cost minus main and agent estimates, at exit | `cost-state` | "internal requests, estimated" |
| Context in use | `context_window.used_percentage` | none | "context of the latest request" |

- Transcript tailing: the collector keeps a byte offset per file and reads only appended bytes, parsing complete lines only. A line over 1 MiB is skipped. For each `message.id` it keeps the last usage seen and adds the difference to the totals, so repeated lines never double count. Files are polled every 2 seconds while their session or agent runs and read once at the end.
- A status line cost that drops starts a new segment; the session's figure is the sum of segments. The status line docs say the cost resets to 0 when `/clear` starts a new session; whether a new process after `--resume` starts from 0 is not probed. A stream-json process after `--resume` follows the same rule for its `result` values.
- Price table: a data file in the app (`core/usage/prices.json`) keyed by model family, with input, output, cache write (5 minutes, 1 hour) and cache read prices per million tokens, its date, and a model pattern. A model with no entry gets no cost estimate, only tokens. The table is checked against Anthropic's published list prices when the slice is built and on each model release.
- Agent figures are a breakdown of their session's figure, never added to it. Rollups add session figures only: a folder, swarm or profile sums its sessions, app-started sessions included once.
- Usage of a session-started workflow: its agents' transcripts under `subagents/workflows/<run id>/` count towards the workflow group node. In stream-json the cumulative `result.modelUsage` already held the 5-minute cache writes of a finished workflow agent (P5 workflow run; the main conversation wrote only to the 1-hour cache), so `result` cost includes workflow agents; whether the status line cost includes them is not probed (U7).

### 8. Rates

- Each subject (session, agent, swarm, folder, profile) has a ring buffer of 10-second buckets, kept for 30 minutes in memory. A bucket holds the cost estimate and the weighted tokens that arrived in it. Nothing of the buffers is persisted; after a restart rates start empty.
- Rate = sum over the window divided by the window length, or by the elapsed time since the subject started when that is shorter. The window is the setting `usage.rateWindowMinutes`, default 5, range 1 to 30.
- Rates per subject: estimated cost per minute (the ranking key) and weighted tokens per minute (the fallback when a model has no price, and the figure shown for agents). Weights per token class are settings; the defaults are the ratios of the list prices of the session's model to its input price, so weighted tokens track cost.
- Cost deltas come from the status line (PTY sessions), `result` and token estimates between results (stream-json), and transcript usage (agents). A status line delta that covers both main and subagent requests goes to the session; agent rates come from their transcripts. The status line docs say the event-driven updates can go quiet while the main conversation is idle and background subagents run; in that time the session rate comes from its agents' transcript estimates, and the next status line delta adds only its part above what those estimates already counted.

### 9. Ranking, heat markers and rollups

- Block `agide/usage-ranking`: the sessions and agents with the highest cost rate in the window, at most `usage.rankingSize` rows (default 8), each with rate, tokens per minute, share of the profile's rate, elapsed time and a link to the node. Ties go to the most recent activity. Above the list: the profile rate, the app-started count "N of 4", and the plan windows (section 10). A pane bound with a folder scope (0020) shows only subjects within that folder. Agents do not read the usage data source in this slice (see What waits).
- Heat marker on every session and agent node, from the share of the profile's current rate: none below `usage.heatFloorUsdPerMinute` (default 0.01) or below 10 percent share; level 1 from 10 percent; level 2 from 30 percent; level 3 from 60 percent or above the alert threshold. The marker is a small bar with a text tooltip ("about 0.12 USD per minute, 45 percent of the profile, estimated"), never colour alone.
- Rollups on folders, swarm folders and the profile show the summed rate and the session count with activity in the window. A collapsed folder shows the highest heat level inside it.

### 10. Plan usage per profile and forecast

- Plan usage is account-wide (0019), so it belongs to the profile. Every `plan` fact of any session in the profile updates `plan_usage` when its `observed_at` is newer. Values arrive only with requests (P12). The rail (shown when more than one profile exists, 0022) and the ranking show the five-hour and seven-day percentages, their reset times in local time, "as of <time>", and the forecast.
- A window whose `resets_at` has passed shows "reset, no data since" until the next request.
- A profile whose login gets no `rate_limits` (API key, or no subscriber request yet) shows "no plan data" and cost only. The `spend_limit` window that a Claude apps gateway adds (status line docs) is not shown in this slice.
- The rail shows the own profile only. Showing other profiles' plan usage adds a field to the registry that 0017 and 0022 do not allow; it waits for the user (open in 0025).
- Forecast per window: a least-squares slope over the samples of the last 30 minutes (at least 3 samples spread over at least 5 minutes), in percent per minute. When the slope is positive, the time to 100 percent is `(100 - used) / slope` minutes. When the current time plus that time falls before `resets_at`, the rail shows "may run out around HH:MM"; otherwise "resets before it runs out at this rate". Without enough samples it shows no forecast. The forecast is labelled "estimate at the current rate". The status line gave whole percentages in P12, so the slope moves in steps; `utilization` in `rate_limit_event` has two decimals.

### 11. Alerts to the inbox

Alerts are `alert` items of 0021 with source `app` and origin `usage`:

| Condition | Urgency | Dedupe key | Actions |
|---|---|---|---|
| a session, agent or swarm above `usage.alertUsdPerMinute` (default 0.50) for a whole window | `normal` | `usage:rate:<subject>:<window start>` | open, pause, stop |
| a plan window crosses `usage.planThresholds` (defaults 80 and 95) | `normal` at the first, `high` at the second | `usage:plan:<window>:<threshold>:<resets_at>` | open the ranking, pause the top subject, pause all app-started agents |
| the forecast says a window runs out within 30 minutes and before its reset | `normal` | `usage:forecast:<window>:<resets_at>` | open the ranking, pause the top subject |
| an app-started start refused at the cap (0021) | `low` | `swarm:cap:<swarm>` | open |

- Pause on a PTY session sends Esc to the PTY (P10: the turn stops, the session stays); the item says the turn was interrupted, and that background subagents may keep running (not probed). On an app-started agent it sends the interrupt control request and holds the next prompt and new starts of its swarm until "Resume" on the node or the item.
- Stop on a PTY session ends the process (SIGTERM, then SIGKILL after the kill timeout, as `shutdown` does at app quit) and keeps the session as `exited`, so it can be resumed. `close` does not fit: it forgets the session. The session service has no per-session stop today; the slice adds one. On an app-started agent it stops the process (section 5). A session-started agent offers stop only in stream-json, after U5; in the PTY the item offers pause of the session and says it affects every agent of that session.
- Every action needs a click by the user. No MCP tool triggers pause or stop through an alert; agent text never selects an action (0021 section 9).
- An alert resolves with `acted` when an action runs and with `superseded` when its condition has been false for a whole window.
- "Switch to a cheaper tier" (0019) waits: it needs the tier table of 0011 at launch, and in the PTY it would type a command into the session.

### 12. What is labelled an estimate

| Number | Label |
|---|---|
| every dollar figure | "estimated, list price"; under a subscription "list-price equivalent, not billed" |
| agent cost and cost between stream-json results | "estimated from tokens" |
| rates, heat, ranking share | "estimated over the last N minutes" |
| forecast | "estimate at the current rate" |
| plan percentage | not an estimate: "percent of the five-hour window, reported by Claude Code, as of <time>" |
| session tokens before exit | "so far, without internal requests" |
| PTY agent outcome with basis `derived` | "outcome derived by Agide" |

The status line and `result` compute cost at list price unless the user's settings carry a `modelPricing` table (status line docs); `modelUsage` in the probe logs reports `costBasis` `list`. A collector that sees another `costBasis` drops "list price" from the label.

### 13. Threats and limits

- Forged events: local agents run as the user (0025), so any process of the user can write files into a session's events directory and forge hook payloads or a status snapshot. Forged agents, states or usage mislead the views; they never authorize anything. Budget stops of 0011 use `result` events from processes the app owns.
- Forged transcript paths: the viewer and the copier open a path only after `realpath` shows it below the session's `<config dir>/projects/` directory or the profile's `transcripts/` directory, and only regular files; anything else shows "transcript removed".
- Untrusted text: descriptions, labels, summaries and transcript content are agent text, rendered as plain text by the rules of 0021 section 9.
- Personal data: the status line payload and transcript paths hold absolute user paths. The collector keeps only the identifiers and numeric fields listed in section 6; paths stay in the profile's database and never cross profiles, enter the registry, logs kept in the repository, MCP results or layout files.
- Resource use: polling covers running subjects only, reads appended bytes, caps line size and viewer size, and coalesces `agents.changed`. A swarm at the cap of 4 with a few subagents each is the expected load.
- Limits: PTY failure and stop of a session-started agent are best effort or missing; subagent `waiting` in the PTY is session-level until U4; internal requests show only as a remainder at exit; workflow usage roll-up and the subagent share of the status line cost are inferred (U7); `rate_limit_event` fields are observed but undocumented, and statuses other than `allowed` are not known (U3); the transcript format is internal and unstable, so the adapters keep a raw-line fallback and the fixtures are re-recorded on each CLI upgrade; a new CLI version can add or rename fields without notice.

### 14. Probes for this slice

Scripts in `probes/`, real Claude on Haiku with `--max-budget-usd 0.25` where `-p` allows it, `--setting-sources user`, `--strict-mcp-config`, an empty temporary directory, the environment scrub of `probes/lib.mjs`:

| Probe | Question |
|---|---|
| U1 | The `<status>` values of a `<task-notification>` prompt in the PTY for a failed and a stopped background subagent (the `completed` form is in `probes/out/p13_hooks.jsonl`); whether a foreground subagent produces one |
| U2 | The transcript lines of a subagent that fails (an API error or a tool error that ends it) and of one stopped through `TaskStop` |
| U3 | `rate_limit_event` `status` values other than `allowed`, and whether `utilization` times 100 matches the status line `used_percentage` at the same moment (the window fields are in the P5 logs); whether the status line runs in `-p` |
| U4 | `agent_id` on `PermissionRequest` and `Notification` for a subagent in the PTY |
| U5 | The stop-task control request and the `TaskStop` result shape |
| U6 | A user-level `statusLine` next to the app's `--settings` one (needs a user settings file the user prepares, or a profile with its own configuration directory) |
| U7 | A per-request check that the status line cost includes subagent and workflow requests |

## Consequences

### First slice for milestone 3

1. `core/agents`: `AgentFact`, the hook, stream-json and transcript adapters with fixtures from `probes/out` (P5, P11, P13) and a recorded PTY run; the in-memory and SQLite `AgentStore` with the contract suite; migration 1 above; the repair at start.
2. Wiring of the hook adapter to `session.hook` and `session.exited` in the session module; the stream-json adapter wired to the stream-json launch path when that path is built in this milestone (0024 recommendation 4), tested on fixtures until then.
3. Tree rows under session leaves with state, count, waiting marker, finished tally and the removal timers; the "Show finished agents" filter; the `agide/agent-history` pane; the `agide/transcript-viewer` pane; transcript copies with the size cap.
4. `statusLineCommand` in `--settings`, `UsageCollector` (status snapshot, transcript tailing by `message.id`, `cost-state` at exit), the price table, ring buffers and rates, `usage_totals` and `plan_usage`.
5. The `agide/usage-ranking` pane, heat markers and folder rollups, own-profile plan usage and forecast in the rail.
6. Rate, plan and forecast alerts with the pause and stop actions for PTY sessions and app-started agents; a per-session stop in the session service that keeps the session.
7. Probes U1, U3 and U4 with the slice, since the adapters depend on them.
8. Tests: adapter tables over fixtures (including a split message id, an unknown `SubagentStop`, a resumed agent, reordered facts, a second cumulative `result` that replaces the first), the store contract, timers with a fake clock, the rate and forecast functions, the path check of the viewer with a symbolic link and a path outside the projects directory, a mutation check on the message-id dedupe and on the waiting attribution, an e2e test with a fake `claude` that writes hook files, a status snapshot and transcripts, and a real-Claude script outside `pnpm test` with parallel subagents in the PTY.

### What waits

| Item | Waits for |
|---|---|
| Stop of a single session-started agent | U5 |
| Exact waiting attribution for PTY subagents | U4 |
| Failure outcomes of PTY subagents beyond interrupts | U2 |
| Nested agent layout and display beyond one level | a probe of nested subagents |
| Workflow nodes in PTY sessions | a probe of workflows in the PTY |
| Plan usage of other profiles in the rail | the user (0025) |
| Passing the JSON on to the user's own status line | U6 |
| "Switch to a cheaper tier" action | the tier table of 0011 at launch |
| A PTY view for an app-started agent | the stream-json launch path and a design for attaching to it |
| Usage data source for agents through MCP (`usage_get`) | the review of what an agent may learn about other sessions in its folder |

### Other consequences

- 0009 is refined: the stopped state becomes outcome `stopped` of `done`, queued becomes a mark on `running`, unknown after a restart becomes `failed` with outcome `lost` or `done` from the repair; transcripts get an app copy with a size cap.
- 0019 is refined: the status line file is `status.snapshot` in the session's events directory; only numeric fields are kept; agent costs come from a price table; rates use 10-second buckets in memory only.
- 0021 is amended: usage alerts carry the dedupe keys and actions above; the `SubagentStop` row feeds the agent store and creates an inbox item only under the existing policy; the `rate_limit_event` row applies only to a `status` other than `allowed`, because the event arrives with every request.
- 0024 recommendation 4 is amended: the stream-json adapter is tested on fixtures until the `-p` launch path exists, and its wiring follows that path.
- Effort: the slice holds nearly all of R16 (7 days in 0009: normaliser, store, tree rows, timers, history and viewer) and most of R24 (5 to 8 days in 0019 after the normaliser: collector, rates, ranking, heat, plan usage, forecast, alerts), so it is roughly 11 to 15 working days in 0005 units, one engineer plus agents, low confidence. Items 1 to 3 and 4 to 6 are separable slices on a shared `core/agents` contract.
- Not verified: everything listed under section 14; the price table values; the forecast on real plan data over hours; the polling load with several swarms; that node-pty children of the PTY path always end with the app, on which the repair rule relies.
