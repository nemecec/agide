# 0021 Inbox, tasks and reminders: design

Status: proposed
Date: 2026-11-17
Proposed by: spike agents, pending user confirmation
Inputs: 0003, 0004, 0006, 0009, 0010, 0011, 0012, 0013, 0014, 0015 (R20), 0016 (R21), 0017 (R22), 0018 (R23), 0019 (R24); `probes/RESULTS.md`, `notes/probes-m2.md`, `probes/out/p11_*` to `p15_*`, the Claude Code hooks, MCP and environment variable references, `notes/probes.md`, `notes/probes-stage2.md`, `notes/swarm-visibility.md`; the milestone 1 code in `app/src/core/store`, `app/src/core/session` and `app/src/core/surfaces`

## Context

R21 (0016) asks for one inbox of items that wait for the user, scoped by folder, with several inboxes as saved views, durable tasks, recurring reminders, agent tools to post updates and ask questions, context in layers that the user opens step by step, and notifications with a dock badge and a per-profile unread count. 0016 left open how the Notification hook separates permission prompts from idle prompts in the PTY, how a blocking question is answered in the PTY and in stream-json sessions, noise limits, and how the agent's own to-do list is mirrored.

Milestone 1 (0014) gives the substrate: one SQLite database per data directory with per-module migrations (`openStore`, `migrate`), the tree service with folder scoping (`isWithin`), PTY sessions whose hooks arrive as `session.hook` events through `HookInbox`, a session status machine fed by those hooks (`status.ts`), the app MCP server whose tools come from the command registry with a folder-scoped caller, and the surface interface of 0006 as types. The hook command writes the payload to a file and prints nothing, so it never answers a permission request; the TUI draws its own dialog.

Probe facts this design relies on:

| Fact | Source |
|---|---|
| `Stop` fires at turn end in the PTY with `last_assistant_message`, `permission_mode`, `prompt_id`, `transcript_path`; in `Stop` and `SubagentStop`, `background_tasks` lists running background work and lags | P1b, P5, P6, P7 |
| `PermissionRequest` fires in the PTY for Bash, Edit and MCP tools with `tool_name`, `tool_input`, `permission_suggestions`, `mcp_server`; no `tool_use_id`, no `agent_id` in the main session; order `PreToolUse`, `PermissionRequest`, then `PostToolUse` on allow or `Stop` on deny, both given by the hook. A deny chosen in the TUI dialog was not exercised | P6 |
| The TUI dialog is on screen while a `PermissionRequest` hook runs, also when the hook waits. A key pressed in the terminal during the wait answers the dialog and wins: Enter runs the call and a later hook deny is ignored; Esc rejects the call, ends the hook process and fires no `Stop`. A hook that reaches its `timeout` gives the decision back to the dialog, with no allow and no deny. `permission_prompt` still fires about 6 seconds after the dialog opens while the hook waits. One run per case, re-run by a reviewer except the timeout case | P14 (`probes/p14_waiting_permission_hook.py`, `notes/probes-m2.md`) |
| `SubagentStart` and `SubagentStop` fire in the PTY with `agent_id`; `SubagentStop` also fires for internal agents, with an empty `agent_type`, an id that had no `SubagentStart` and an `agent_transcript_path` that does not exist | P5, P13 |
| Subagents can run as background tasks: the main turn ends with `Stop` before their results arrive, and each result comes back as a `UserPromptSubmit` whose prompt is a `<task-notification>` block, followed by another `Stop`. Such a `UserPromptSubmit` is not user input | P13 |
| `Elicitation` fires when an MCP server sends an elicitation request, with `mcp_server_name`, `message`, `mode` (`form` seen), `requested_schema`, and no tool name or call id. A hook that prints `action` `accept` with `content` answers it with no dialog, and then neither `ElicitationResult` nor a Notification fires. Without a hook answer the TUI shows its own form; `elicitation_dialog` fires about 6 seconds later and `elicitation_response` after the user's answer. Form mode only, with a stdio fixture server | P15 (`probes/p15_elicitation.py`) |
| The TUI also writes the permission, idle and elicitation messages to the terminal as OSC 9 sequences, so the PTY output carries the same signal as the Notification hook | P11, P14, P15 raw output |
| `UserPromptSubmit` fires in both paths; its `additionalContext` (under 10,000 characters) or plain stdout reaches the model | P1b, P8 |
| No hook fires on Esc or Ctrl-C; the transcript gets an interrupt line; `SessionEnd` carries a reason | P10 |
| Multi-turn over stdin in stream-json; `can_use_tool` carries `tool_use_id` and, for subagents, `agent_id` | P1, P1c, P5 |
| Tool errors and results of the app MCP server reach the agent in both paths; the server answers request and response only, no SSE | P3 |
| `Notification` fires in the PTY with `notification_type` `permission_prompt` and the fixed message "Claude needs your permission" about 6 seconds after `PermissionRequest` while the dialog stays unanswered, and with `idle_prompt` and "Claude is waiting for your input" about 60 seconds after `Stop`. The payload has `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `message`, `notification_type`; no `title` (documented as optional), no tool data, no `agent_id`. One run | P11 (`probes/p11_notification_hook.py`, `probes/out/p11_report.json`) |

Documented facts this design relies on, not shown by any probe log here (hooks reference https://code.claude.com/docs/en/hooks, MCP reference https://code.claude.com/docs/en/mcp, environment variables https://code.claude.com/docs/en/env-vars, read on 2026-11-17):

| Fact | Source |
|---|---|
| `Stop` does not run after a user interrupt. A turn that ends on an API error fires `StopFailure` in place of `Stop`, with `error` (`rate_limit`, `authentication_failed`, `billing_error`, `server_error`, `max_output_tokens`, `unknown` and others), optional `error_details`, and the API error string in `last_assistant_message` | hooks reference |
| `SessionEnd` reasons: `clear`, `resume`, `logout`, `prompt_input_exit`, `other` | hooks reference |
| `Notification` types besides the probed ones: `auth_success`, `auth_storage_failure`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_fired`, `quota_auto_resume_stale`, `quota_auto_resume_disabled`, `plugin_notification` | hooks reference |
| `PermissionRequest` does not run for the network request of a sandboxed command; the `permission_prompt` Notification is the only signal for that prompt. A command hook times out after 600 seconds by default | hooks reference |
| `Elicitation` receives `mcp_server_name`, `message` and optional `mode` (`form` or `url`), `url`, `elicitation_id`, `requested_schema`; a hook answers with `action` `accept` and `content`, `decline` or `cancel`, or prints nothing to leave the dialog to the user. An `accept` for a URL-mode request skips the dialog, so the URL never opens | hooks reference |
| An MCP tool call to an HTTP server times out per request after 60 seconds unless `MCP_TOOL_TIMEOUT` or the server entry's `timeout` is above 60,000 ms; it aborts after 5 minutes without a response or progress notification (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`; a server `timeout` of at least 1,000 ms raises that window to the `timeout`); the wall-clock default is about 28 hours | env-vars and MCP reference |
| In an interactive session a main-conversation MCP call still running after 2 minutes moves to a background task: Claude gets a task id and keeps working, the result arrives later as a task notification, and the task does not survive the end of the session (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`, 0 turns it off). Calls from subagents and calls in `-p` mode stay in the foreground | MCP reference |

## Decision

### 1. Item model

An item is something that waits for the user or tells the user about work. Every item has a kind, a state, an urgency, a source, a folder, optional session and agent ids, a deep link, a short message, an optional long description, a payload, and an author of its text.

Kinds. This design adds to the kinds of 0016 `alert` for usage and swarm limits, which are neither failures nor requests for input.

| Kind | Meaning | Resolved by |
|---|---|---|
| `status` | an update: a turn finished, an agent reports progress | viewing the session, the user typing in it, dismissal |
| `input` | the agent waits for an answer: `inbox_ask`, an elicitation, an idle prompt after a question | an answer, the user typing in the session, dismissal |
| `approval` | a tool call, an outward-action draft, a scheduled agent run or a summary draft waits for a decision | approve, deny, edit and approve, or the session moving on (the matching `PostToolUse`, `Stop`, `StopFailure`, an interrupt) |
| `review` | a changeset escalated to rung C, D or E (0010) | the review decision in the review views |
| `failure` | a session ended unexpectedly, a turn ended on an API error, an app-started agent failed (a check that fails past the retry limit escalates to rung C in 0010 and arrives as `review`) | dismissal, a resume, a new run |
| `reminder` | a reminder fired | done, snooze, dismissal |
| `alert` | usage or swarm limit crossed (0011, 0012, 0019) | an action on the item (pause, stop, switch tier), dismissal, the condition clearing |

States and transitions:

| From | To | Trigger |
|---|---|---|
| (none) | `new` | creation; a coalesced repeat of an open item also returns it to `new` |
| `new` | `seen` | the detail card is shown for 1 second, or the item is marked read |
| `new`, `seen` | `snoozed` | the user snoozes until a time |
| `snoozed` | `new` | the snooze time passes (the scheduler wakes it and it notifies again) |
| `new`, `seen`, `snoozed` | `done` | an answer, a decision, dismissal, auto-resolve, supersession, expiry; `resolution` records which |
| `done` | `seen` | the user reopens it |

Unread means state `new`. `done` items stay in the store and show under a "Done" filter; a retention setting (default 90 days) deletes older done items.

Urgency is `low`, `normal` or `high`. Agents may post `low` or `normal`; `high` from an agent is lowered to `normal` unless the project policy allows it. App sources set `high` for hard-floor review escalations, budget stops and plan windows above the second threshold.

Every approval shows the raw command, tool input or draft from the payload; the agent's summary is never the only content (0016).

### 2. Store and schema

The tables live in the profile's existing SQLite database (one per data directory, 0017) and follow the 0013 module rules: each module owns its tables and migration list, `migrate` runs each step in a transaction and refuses a newer schema. Times are ISO 8601 UTC text, as in `sessions.created_at`. Lengths are characters.

Module `inbox`, migration 1:

```sql
CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('status', 'input', 'approval', 'review', 'failure', 'reminder', 'alert')),
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'seen', 'snoozed', 'done')),
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low', 'normal', 'high')),
  source TEXT NOT NULL CHECK (source IN ('hook', 'agent', 'app', 'scheduler')),
  origin TEXT NOT NULL,
  session_id TEXT,
  agent_id TEXT,
  link_node_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  link_anchor TEXT,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 140),
  details TEXT CHECK (details IS NULL OR length(details) <= 8000),
  text_author TEXT NOT NULL CHECK (text_author IN ('agent', 'app', 'user')),
  payload TEXT,
  dedupe_key TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  seen_at TEXT,
  snoozed_until TEXT,
  done_at TEXT,
  resolution TEXT CHECK (resolution IN
    ('answered', 'approved', 'denied', 'dismissed', 'viewed', 'superseded', 'expired', 'acted')),
  CHECK ((state = 'snoozed') = (snoozed_until IS NOT NULL)),
  CHECK ((state = 'done') = (done_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX inbox_items_open ON inbox_items (state, folder_id, updated_at);
CREATE INDEX inbox_items_by_session ON inbox_items (session_id, state);
CREATE UNIQUE INDEX inbox_items_open_dedupe ON inbox_items (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state <> 'done';

CREATE TABLE inbox_asks (
  item_id TEXT PRIMARY KEY REFERENCES inbox_items(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  options TEXT NOT NULL,
  allow_free_text INTEGER NOT NULL CHECK (allow_free_text IN (0, 1)),
  timeout_at TEXT NOT NULL,
  call_state TEXT NOT NULL CHECK (call_state IN ('waiting', 'returned', 'timed_out', 'cancelled')),
  answer_choice TEXT,
  answer_text TEXT CHECK (answer_text IS NULL OR length(answer_text) <= 4000),
  answered_at TEXT,
  delivery TEXT NOT NULL DEFAULT 'none'
    CHECK (delivery IN ('none', 'in_call', 'queued', 'typed', 'stdin', 'context', 'failed')),
  delivered_at TEXT
);
CREATE INDEX inbox_asks_queued ON inbox_asks (session_id, delivery);

CREATE TABLE inbox_views (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE CASCADE,
  filter TEXT NOT NULL,
  sort TEXT NOT NULL DEFAULT 'urgency_then_time' CHECK (sort IN ('urgency_then_time', 'time', 'project')),
  position INTEGER NOT NULL
);

CREATE TABLE inbox_policies (
  folder_id TEXT PRIMARY KEY REFERENCES tree_nodes(id) ON DELETE CASCADE,
  policy TEXT NOT NULL
);
```

Column notes:

- `folder_id` NULL means the top level. Deleting a folder moves its items there, marked "folder removed" in the card, so a removed folder never hides an open approval.
- `origin` names the producer: `hook:Stop`, `hook:StopFailure`, `hook:PermissionRequest`, `hook:Notification:permission_prompt`, `mcp:inbox_post`, `mcp:inbox_ask`, `review`, `outward`, `swarm`, `usage`, `reminder`, `schedule`.
- `link_anchor` is JSON: `{ "transcriptPath", "byteOffset" }` (the transcript size when the hook arrived, so the peek opens at that point), `{ "changesetId", "file", "hunk" }`, `{ "url" }` or `{ "surfaceId" }`.
- `payload` is JSON per kind: `{ "toolName", "toolInput", "mcpServer", "permissionSuggestions" }` for a hook approval; the exact draft for an outward action; the alert's numbers and offered actions.
- `text_author` says who wrote `message` and `details`. `agent` text is untrusted (section 9). Text the app builds from agent output (a tool command, a last assistant message) is also `agent`.
- `dedupe_key` coalesces repeats into one open item (section 8). A partial unique index allows a key again once the earlier item is done. Reopening a done item whose key an open item now holds would violate the index, so the reopen clears the reopened item's key.
- The app default policy is a setting; `inbox_policies` holds overrides per project folder.

Module `tasks`, migration 1 (initialized after `inbox`, since runs link to items):

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  link_node_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 8000),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  owner TEXT NOT NULL CHECK (owner IN ('user', 'agent')),
  owner_session_id TEXT,
  external_url TEXT,
  due_at TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((owner = 'agent') = (owner_session_id IS NOT NULL)),
  CHECK ((state IN ('done', 'cancelled')) = (completed_at IS NOT NULL))
);
CREATE INDEX tasks_by_folder ON tasks (folder_id, state, position);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('reminder', 'agent_run')),
  folder_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  link_node_id TEXT REFERENCES tree_nodes(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 140),
  details TEXT CHECK (details IS NULL OR length(details) <= 8000),
  dtstart TEXT NOT NULL,
  tzid TEXT NOT NULL,
  rrule TEXT,
  catch_up TEXT NOT NULL DEFAULT 'latest' CHECK (catch_up IN ('latest', 'each', 'none')),
  prompt TEXT,
  approved_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  next_due_at TEXT,
  last_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((kind = 'agent_run') = (prompt IS NOT NULL))
);
CREATE INDEX schedules_due ON schedules (enabled, next_due_at);

CREATE TABLE schedule_runs (
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('fired', 'caught_up', 'folded', 'skipped')),
  item_id TEXT REFERENCES inbox_items(id) ON DELETE SET NULL,
  PRIMARY KEY (schedule_id, due_at)
);
```

Migrations of existing modules, for the context layers (section 5):

```sql
-- module tree, migration 2
ALTER TABLE tree_nodes ADD COLUMN description TEXT CHECK (description IS NULL OR length(description) <= 2000);
ALTER TABLE tree_nodes ADD COLUMN description_updated_at TEXT;
ALTER TABLE tree_nodes ADD COLUMN is_project INTEGER NOT NULL DEFAULT 0 CHECK (is_project IN (0, 1));

-- module session, migration 2
ALTER TABLE sessions ADD COLUMN turns INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN summary TEXT CHECK (summary IS NULL OR length(summary) <= 400);
ALTER TABLE sessions ADD COLUMN summary_generated_at TEXT;
ALTER TABLE sessions ADD COLUMN summary_model TEXT;
ALTER TABLE sessions ADD COLUMN summary_turns INTEGER;
ALTER TABLE sessions ADD COLUMN summary_transcript_bytes INTEGER;
```

Migration plan:

- The new modules start at version 1 in the same database file. The module graph of 0013 initializes tree, mcp, session, then inbox, then tasks, because of the foreign keys into `tree_nodes` and `inbox_items`.
- Tree migration 2 and session migration 2 only add columns with defaults or NULL, so existing rows stay valid and milestone 1 data opens unchanged. A build from before this change refuses the migrated database (`schema is at version 2, this build knows up to 1`), which is the existing rule.
- Folder scoping reuses the recursive walk of `SqliteTreeService.isWithin` (`UNION`, so a stored cycle ends): a folder's inbox is the items whose `folder_id` is the folder or a descendant; the root view has no folder filter and also shows top-level items.
- An item takes the folder of its session at creation. When a session leaf moves (`tree.node_moved`), its open items move with it; done items keep their folder.
- The project of a node is its nearest ancestor folder with `is_project = 1`, or its top-level folder when none is marked.
- `node:sqlite` stays the driver (0013). The schema was checked by running every block above against `node:sqlite` in Node 22 on top of the milestone 1 tables.

### 3. Sources and the mapping to items

Verification column: **probed** means a probe log shows the event and the fields used; **docs** means the Claude Code documentation (Context) describes it and no log here shows it; **to probe** names the probe that must run before the mapping is relied on. The column was updated after P13, P14 and P15 (`notes/probes-m2.md`); rows those probes changed name them.

Claude Code hooks (PTY sessions, delivered as `session.hook`):

| Hook | Condition | Item | Verification |
|---|---|---|---|
| `Notification`, `notification_type` `permission_prompt` | an approval item of the session is open | no new item. It marks that the dialog is still unanswered, and only then does the approval item notify (section 10), so prompts the user answers at once never raise a macOS notification | probed (P11, one run) |
| `Notification`, `permission_prompt` | no approval item of the session is open (hook missed or already resolved, or a sandboxed command's network request, for which `PermissionRequest` does not run) | an `approval` item, "Waiting for permission", linking to the terminal; the payload holds no tool data | probed (P11); the sandbox case docs |
| `Notification`, `idle_prompt` | the session has an open `Stop` item | no new item; the `Stop` item notifies now if the session is still not in view | probed (P11, one run) |
| `Notification`, `idle_prompt` | the session has no open item and is not in view | `input`, urgency `low`, "Waiting for you", details from the last `Stop` message | probed (P11) |
| `Notification`, `elicitation_dialog`, `elicitation_url_dialog` | no `Elicitation` item of the session is open | `input`, details from `message`; a URL-mode item shows the URL as text and only opens it on an explicit action | probed for `elicitation_dialog` in form mode (P15, about 6 seconds after `Elicitation`); `elicitation_url_dialog` docs, to probe in P17 |
| `Notification`, `elicitation_dialog` | an `Elicitation` item of the session is open | no new item; that item notifies now, as for `permission_prompt` | probed (P15) |
| `Notification`, `elicitation_complete`, `elicitation_response` | an elicitation item of the session is open | that item becomes `done`, resolution `superseded` | probed for `elicitation_response` after a cancel in the TUI (P15); `elicitation_complete` docs |
| `Notification`, `auth_success` | never | none (logged) | docs |
| `Notification`, `auth_storage_failure` | always | `failure` with `message` | docs |
| `Notification`, other or missing type (`agent_needs_input`, `agent_completed`, `quota_auto_resume_*`, `plugin_notification`, unknown) | policy; off by default | `status`, urgency `low`, text from `message` | docs |
| `Stop` | the session is not in view, and the turn lasted at least the policy minimum (default 20 seconds) or ended in a question mark | `status` "Turn finished", details from `last_assistant_message` (capped), anchor at the transcript size; one open item per session (dedupe `stop:<sessionId>`). While background agents run, a `Stop` is followed by more turns from their task notifications (P13); each later `Stop` updates the same open item through the dedupe key, and the card says that background work was running when `background_tasks` is not empty | probed (P1b, P6, P7, P13) |
| `Stop` | an approval item of this session is open | that item becomes `done`, resolution `superseded` (a hook deny ends with `Stop`) | probed for a hook deny (P6 order); a deny in the TUI dialog is not probed and may end as an interrupt, which the interrupt row covers |
| `StopFailure` | always | `failure` "Turn failed: <error>", details from `error_details` and `last_assistant_message` (the API error text, written by the CLI, so `text_author` `app`); dedupe `stopfail:<sessionId>`. Resolves the session's open approval items like `Stop`. With `error` `rate_limit` the item is an `alert` instead | docs; the hook is not yet in the app's hook list |
| `SubagentStop` | the agent belongs to an app swarm or the policy asks for it; ids never seen at `SubagentStart` are ignored, which drops the internal agents (empty `agent_type`, P13) | `status`, details from `last_assistant_message`; failure is not detectable from this hook | probed (P5, P13) |
| `PermissionRequest` | always | `approval`, message "Wants to run <tool>: <first line of the input>", payload with the raw `tool_input`; dedupe `perm:<sessionId>:<hash of tool name and input>`, since the payload has no `tool_use_id` and subagents running in parallel may each have a request open (PTY approval for subagents is not probed) | probed (P6) |
| `PermissionRequest` answered from the card | when the hook waits for the app; the hook's `timeout` is set above the longest wait the app allows (the default command timeout is 600 seconds) | the card's allow and deny answer the hook and the TUI dialog closes by itself. The user can also answer in the terminal, and the first answer wins: an Enter there runs the call and a later answer from the card has no effect, an Esc rejects the call and ends the hook. The card therefore closes on the matching `PostToolUse`, on `Stop`, or on the interrupt line, and a hook that reaches its timeout leaves the decision to the TUI dialog, never to a default. The hook needs a reply path, which the `inbox-dir` transport lacks: it waits for the `http` transport of 0022 | probed (P14: dialog during the wait, a key racing the hook in both directions, the timeout case once) |
| `PostToolUse` | an approval item of this session with the same tool name and `tool_input` is open (the P6 pairing rule of 0014) | `done`, resolution `superseded` (the tool call went ahead, also after an Enter in the terminal while a hook waited) | probed (P6 order, P14) |
| `Elicitation` | always | `input` with the server name, message and requested fields; answering through the hook output for form mode only | probed for form mode and an immediate hook answer (P15); a hook that waits for the user and URL mode are not probed (P17); the hook is not yet in the app's hook list |
| `UserPromptSubmit` | the prompt does not start with `<task-notification>` | no item. Resolves open `status` and hook-made `input` items of the session (resolution `viewed`); delivers queued answers as `additionalContext` (section 4) | probed (P1b, P8) |
| `UserPromptSubmit` | the prompt starts with `<task-notification>` (a background agent's result, P13) | no item and no resolution: it is not the user acting | probed (P13) |
| `SessionEnd` | reason other than `prompt_input_exit`, `clear`, `resume`, `logout`, and the app did not close the session | `failure` "Session ended" with the reason | probed for `other` and `prompt_input_exit` (P10, P11); other reasons docs |
| Interrupt line in the transcript | a turn was interrupted | no item; resolves the session's open approval items | probed for interrupts during generation and during a tool run (P10); Esc on an open approval dialog rejects the call and fires no `Stop` (P14), so this row is the only resolution for that case; the transcript line for it is not checked |

Stream-json sessions (0004 decision 1, built later in milestone 2): `can_use_tool` makes an `approval` item answered by the control response (probed, P1c, P5); `task_notification` with status `failed` makes a `failure` item (docs; P5 did not reproduce a failure); a `result` with an error subtype makes a `failure` item, except after an interrupt the app or the user sent, which P1 shows as `error_during_execution` with `terminal_reason` `aborted_streaming` and which creates no item (other error results not probed).

App sources:

| Source | Condition | Item |
|---|---|---|
| Review escalation (0010 section 4) | a unit reaches rung C, D or E | `review`, urgency `normal`, `high` for hard floors; link to the changeset view; dedupe per changeset |
| Outward-action draft (0010 section 6, 0011 section 1) | mode `draft` or `approve` | `approval` with the exact payload; `draft` allows edit before approve; text authored by the agent, the action class by the app |
| Scheduled agent run (section 7) | a run is due and not pre-approved | `approval` "Run scheduled task" with the prompt |
| Swarm cap (0011, 0012) | a start is refused at the concurrent-agent cap | `alert`, urgency `low`, dedupe per swarm |
| Swarm budget (0011 section 4) | a swarm reaches its budget and the app stops it | `alert`, urgency `high`, actions: raise budget, stop |
| Rate limit event (0011) | `rate_limit_event` pauses a group | `alert`, urgency `normal` |
| Usage rate (0019) | a session, agent or swarm above the rate threshold for the window | `alert`, urgency `normal`, actions: pause, stop, switch to a cheaper tier; dedupe per subject and window |
| Plan window (0019) | the 5-hour or 7-day percentage crosses a threshold (defaults 80 and 95) | `alert`, `normal` at the first threshold and `high` at the second; dedupe per window, threshold and reset time |
| Project summary draft (section 5) | an agent proposes a project description | `approval` with the proposed text |
| Reminder (section 7) | a reminder fires | `reminder` |

The agent's own to-do list (the TaskCreate tool and the documented `TaskCreated` and `TaskCompleted` hooks) is not an item source. It shows later as observed data on the session node (0009), read-only and separate from app tasks; a probe of those hooks comes with that work.

### 4. Agent tools: `inbox_post` and `inbox_ask`

Both are registry commands with `mcp: true` and no UI binding, so they are tools of the app MCP server with the caller's folder scope (0013). The item's folder and session come from the caller's grant, never from the input. The input schemas in zod terms:

```ts
const link = z.object({
  nodeId: z.string().max(64).optional(),          // must be within the caller's folder
  url: z.string().url().max(2000).optional(),     // shown as text with an explicit Open action
}).strict();

const inboxPostInput = z.object({
  message: z.string().min(1).max(140),
  details: z.string().max(8000).optional(),
  kind: z.enum(['status', 'failure', 'review']).default('status'),
  urgency: z.enum(['low', 'normal', 'high']).default('normal'),  // high is lowered to normal unless the policy allows it
  link: link.optional(),
  dedupeKey: z.string().regex(/^[a-z0-9_.-]{1,64}$/).optional(),  // prefixed with the session id by the app
}).strict();
// result: { itemId: string, coalesced: boolean }

const inboxAskInput = z.object({
  question: z.string().min(1).max(140),
  details: z.string().max(8000).optional(),
  options: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    label: z.string().min(1).max(60),
  }).strict()).max(6).default([]),
  allowFreeText: z.boolean().optional(),          // default: true when there are no options
  timeoutSeconds: z.number().int().min(30).max(3600).default(600),
  wait: z.boolean().default(true),
  link: link.optional(),
}).strict();
// result, one of:
//   { status: 'answered', askId, choice?: string, text?: string, answeredAt }
//   { status: 'timeout', askId, note }   // note: the answer will arrive later as a user message
//   { status: 'queued', askId, note }    // wait: false
//   { status: 'dismissed', askId }
```

Rules:

- `inbox_post` never blocks. It answers `invalid_input` for an out-of-scope `nodeId`. Beyond the session's rate limit (section 8) a post coalesces into the session's "more updates" item and the result says `coalesced: true`.
- `inbox_ask` creates an `input` item and an `inbox_asks` row. A session has at most 3 open asks; another answers `failed`.
- An answer is the option id, free text, or both. Option labels are agent text; clicking one returns only its id to the same session and starts nothing else.

How the answer reaches the session:

| Situation | PTY session | Stream-json session |
|---|---|---|
| The call is still open (`wait: true`, before the timeout) | the tool result carries the answer; delivery `in_call`. After 2 minutes the CLI moves a main-conversation call to a background task (docs), so the session goes on working or turns idle, and the result arrives as a task notification while the session runs | the tool result carries the answer; `-p` calls stay in the foreground (docs) |
| The call returned (timeout, `wait: false`, or the user interrupted the turn so the request closed) and the session is idle | the session service types the answer as a prompt through `sendText`: "Answer to inbox question <askId>: <option id or the user's text>"; delivery `typed` | a user message on stdin; delivery `stdin` (multi-turn probed, P1) |
| The session is busy or waiting | queued. If the user submits a prompt first, the answer goes into that turn through `UserPromptSubmit` `additionalContext` (P8), delivery `context`; else it is typed at the next `Stop` | queued until the turn's `result`, then written to stdin |
| The session has exited | stored; delivered after the next resume once the session is idle | the same |

The answer text is the user's own text, so typing it into the session is ordinary user input. Agent text is never typed into any session: an option goes back as its id, which the schema limits to `[a-z0-9_-]`, so it cannot carry a line break or an escape sequence. A line break in the user's text would submit the prompt early in the TUI; how multi-line text is typed is part of P16.

The `UserPromptSubmit` delivery needs a hook that prints output. The milestone 1 hook command writes the payload to a file and prints nothing, so the session module adds a `UserPromptSubmit` command that prints the queued answers the app left for the session and marks them delivered.

Time limits on the open call, as documented (Context): an HTTP MCP request ends after 60 seconds unless the server entry sets a `timeout` above 60,000 ms, and a call without a response or progress notification aborts after 5 minutes. The app server sends no progress notifications (stateless, no SSE, P3), and `mcpConfigFor` sets no `timeout` today. So the app's MCP config entry sets `timeout` above the largest `timeoutSeconds`, which also raises the idle window. No probe has shown these limits, what an Esc or Ctrl-C in the TUI does to an open MCP call (P10 shows that a Bash tool process ends; the MCP reference says Esc ends an MCP task call that Claude waits on), the move to a background task after 2 minutes in the PTY, or whether the server sees the HTTP request close. Probe P16 measures these in both paths with a fixture tool that sleeps. Until it passes, the server returns `timeout` 5 seconds before the smaller of `timeoutSeconds` and the measured CLI limit, and `inbox_ask` stays out of the first slice.

MCP elicitation, where the server asks the client for input, is the protocol's own form of a question. It needs server-initiated requests on a stateful session, which the app server does not support (stateless per request, P3), and the TUI would show the question as a dialog. It is reconsidered after P17.

### 5. Context layers

| Layer | Text | Comes from | Editable by |
|---|---|---|---|
| Project name | folder title | the tree | user |
| Project summary | `tree_nodes.description` of the project folder, up to 2,000 characters | the user; an agent proposes a draft as an `approval` item, accepted text is stored with `description_updated_at` | user |
| Session name | session title | the session (milestone 1 default is the leaf title; a rename of the leaf renames the session, closing a 0014 open item) | user |
| Session summary | `sessions.summary`, up to 400 characters, with generation time and model | the small model, lazily (below) | regenerated on request |
| Short message | `inbox_items.message`, up to 140 characters | `inbox_post` and `inbox_ask` from the agent; for hook items the app builds it: `Stop` takes the first sentence of `last_assistant_message`, `PermissionRequest` takes the tool name and the first line of the input | none |
| Long description | `inbox_items.details`, up to 8,000 characters, expands in place | the agent's `details`; for hook items the full last assistant message or the raw tool input, capped | none |
| Drill-down | transcript at the anchor, diff, ticket or pull request, browser page, live terminal | the item's `link_node_id` and `link_anchor`, opened in the peek (section 6) | none |

The macOS notification uses the profile name, the project name and the short message.

Session summary generation:

- Generated when a card or session header needs it and the cached summary is missing or stale. It is never generated per turn in the background.
- Stale when the session has completed at least 3 turns since generation (`turns` counts `Stop` hooks and stream-json results), or the transcript has grown by more than 50 kB, or the user asks. A stale summary still shows, with "generated 25 minutes ago, 4 turns since" and a refresh control.
- Input: the session's first user prompt and the tail of the transcript, user and assistant text only, up to 20,000 characters, wrapped as quoted data with the instruction to summarize it in at most 400 characters of plain text. Tool output and injected context are left out.
- Process: `claude -p` with the small model of 0003 (`--model haiku`), `--max-budget-usd 0.05`, `--setting-sources user`, `--strict-mcp-config`, `--no-chrome` (the built-in Chrome server stays under `--strict-mcp-config`, P9), `--tools ""` (no built-in tools), `--no-session-persistence`, `--settings '{"disableAllHooks":true}'`, an empty temporary working directory, the profile's `CLAUDE_CONFIG_DIR` and the 0013 environment scrub. One generation runs at a time per profile and one per session; a daily cap (default 200 generations) stops further ones with a visible note. These runs do not count against the concurrent-agent cap, since they have no tools.
- The result is plain text; anything over 400 characters is cut. Failure leaves the old summary and shows the error in the header.
- To verify: `claude --help` of 2.1.326 lists `--tools ""` for no built-in tools, `--no-session-persistence` (print mode only) and `--no-chrome`; no run has shown that together they leave no transcript and no folder-trust entry in the user's Claude configuration and that the model gets no tool.

### 6. User interface

The inbox is a pane block under R20 (0015) with a property `viewId`. Several inboxes are several panes on different views.

- **List.** Rows grouped by project, ordered by urgency, then by `updated_at`. A row shows the kind icon, the project and session names, the short message, the age and the occurrence mark of a coalesced item. Keyboard: up and down, Enter opens, `e` done, `s` snooze, `u` mark unread.
- **Detail card.** The header shows project name and summary, session name and summary (layers of section 5). The body shows the short message and the long description, collapsed to a few lines with "Show more". Below are the actions of the kind: answer options and a text box for `input`; approve, deny and edit for `approval`, with the raw payload in a monospace block; snooze presets (10 minutes, 1 hour, tomorrow 09:00) for every kind.
- **Peek beside the card.** Drill-down opens in a split to the right of the card, so the card stays visible. Peek targets: the transcript viewer of 0009 at the anchor, the live terminal of the session, the changeset or diff view, the browser surface of a ticket or pull request.
- **Back stack.** Each card keeps its own stack of peek entries. A link inside a peek pushes an entry. Esc or the back control pops one; "Back to message" clears the stack and closes the peek. The stack is in memory and resets when another item opens.
- **Filters as saved views.** A view is `inbox_views`: a name, a scope folder, and a filter of kinds, states, minimum urgency, sources and text. Defaults: "All", "Needs me" (input, approval, review; states new and seen), "Done". A folder's context menu offers "Open inbox for this folder", which opens a pane on a view scoped to it.

Peek mount mode. `SurfaceType.mount` gains an options argument:

```ts
interface MountOptions {
  readonly mode: 'full' | 'peek';
  /** Surface-specific position to show, such as a transcript offset. */
  readonly anchor?: unknown;
}
mount(host: SurfaceHost<State>, options?: MountOptions): SurfaceInstance;
```

A peek instance is read-only, never takes keyboard focus, never resizes the underlying process or page, and does not count as the user acting in the surface. A type that cannot peek returns an instance that shows its `observe.snapshot(state, 'summary')` text, or only its title when the type has no `observe`, and an "Open" button. The peek is shown to the user, so the per-surface observation switch of 0006, which governs what agents see, does not apply to it. The session surface peeks with an xterm instance that receives `session.output` with `disableStdin` and the PTY's own size, scaled to fit. The browser surface peeks with a capture of the existing page (`capturePage`) refreshed on open, so a peek never loads the page a second time; "Open" moves to the full surface.

### 7. Tasks and reminders

- **Task.** A row in `tasks`: title, notes, state (`open`, `in_progress`, `blocked`, `done`, `cancelled`), owner (user, or an agent session), optional due time, an optional link to a tree node, and an optional external URL (a Jira issue or pull request stays an external object, 0016). A task pane lists tasks per folder subtree, ordered by `position`. A task with a due time owns a one-off `reminder` schedule (`schedules.task_id`), so the due reminder fires once through the scheduler and its run record, and a changed due time updates that schedule.
- **Recurrence format.** A schedule stores `dtstart` as local wall time, `tzid` as an IANA zone and `rrule` as an RFC 5545 RRULE limited to `FREQ` (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`), `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYHOUR`, `BYMINUTE`, `COUNT` and `UNTIL`. A NULL `rrule` is a one-off. `UNTIL` is stored in UTC, which RFC 5545 requires when the start has a zone. Occurrences are computed in wall time in the zone, so a daily 09:00 stays at 09:00 across a daylight-saving change. RFC 5545 drops an occurrence whose wall time does not exist on a change day (section 3.3.10); this design departs from that and moves it to the first valid minute after the gap, so a reminder is never lost, and the moved occurrence counts towards `COUNT`. A wall time that occurs twice fires once, at its first occurrence (section 3.3.5). A date the month lacks, such as `BYMONTHDAY=31` in April, gives no occurrence, as RFC 5545 states. The evaluator is the `rrule` npm package if its zone handling passes the daylight-saving tests; else a small evaluator for the subset above.
- **Scheduler.** One timer to the earliest `next_due_at`, never longer than 60 seconds, so sleep and clock changes are noticed. It also recomputes on wake from sleep (`powerMonitor` resume) and when a schedule changes. A firing runs in one transaction: insert `schedule_runs` (the primary key on schedule and due time makes a repeat a no-op after a crash), insert the item, advance `next_due_at`. Snoozed items wake through the same timer.
- **Catch-up on start.** Reminders do not fire while the app is closed. On start, and on wake from sleep, the scheduler finds the due times from the stored `next_due_at` up to now. `latest` (default) creates one item for the most recent missed occurrence, marked "missed while Agide was closed" with the time, and records the earlier ones as `folded`; `each` creates an item per missed occurrence up to 10, then folds; `none` records them as `skipped`. One-off reminders always catch up once.
- **Reminders as items.** A fired reminder is a `reminder` item in the schedule's folder with its title as the short message and a link to the linked node or task. Done on the item does not stop the recurrence; the schedule has its own enable switch.
- **Agent-run schedules.** A schedule of kind `agent_run` starts a session with its prompt in its folder. Creating one, from the user or from an agent through a later `schedule_create` tool, needs approval; without a stored `approved_at` each run creates an `approval` item first. Runs count against the concurrent-agent cap (0012, default 4); at the cap the run waits and an `alert` item says so. Catch-up never starts an agent run on its own: missed runs become one `approval` item.

### 8. Noise control and auto-resolve

Policy per project folder (`inbox_policies`, JSON), inherited from the nearest ancestor with one, else the app default:

| Setting | Default |
|---|---|
| Hook events that create items | `PermissionRequest`, `Notification` (permission, idle and elicitation types, under the conditions of section 3), `Stop` under the conditions of section 3, `StopFailure`, `SessionEnd` failures |
| `Stop` minimum turn length | 20 seconds |
| `inbox_post` rate per session | 10 items per 10 minutes; beyond it posts coalesce into one "more updates" item per session |
| Kinds that notify | `input`, `approval`, `review`, `failure`, `reminder`, `alert`; `status` only at urgency `high`, apart from `Stop` items, which notify on the `idle_prompt` Notification (section 10) |
| Notification throttle | at most one per session per minute; later items in that minute update the list only |
| Quiet hours | off; when on, only `high` items notify, the badge still counts |
| Notification body | shown; can be hidden, which leaves the profile and project names only |

Coalescing: hook items carry dedupe keys (`stop:<session>`, `stopfail:<session>`, `perm:<session>:<request hash>`, `idle:<session>`); app alerts carry keys per subject and window; agents can pass their own key, which the app prefixes with the session id. A repeat updates the open item's text, raises `occurrences`, sets `updated_at` and returns it to `new`.

Auto-resolve on view: the session counts as viewed when its leaf is the open node in a focused window, or its peek is shown, for 2 seconds. Viewing resolves that session's open `status` items and hook-made `input` items with resolution `viewed`. It marks `approval`, `input` from `inbox_ask`, `review`, `failure` and `alert` items as `seen` only; they need an action. A user prompt in the session resolves the same set as viewing. This uses the app's own open-node state; observation data of R13 can replace it later.

### 9. Untrusted text

All agent text (messages, details, option labels, last assistant messages, tool inputs, summaries, and anything from a third-party page) is untrusted:

- Rendered as plain text through React text nodes. No HTML, no Markdown, no auto-linking; no `dangerouslySetInnerHTML` in the inbox, task or notification code (a test greps for it).
- Control characters, ANSI escape sequences and Unicode bidirectional overrides are stripped at the store boundary; length limits are enforced in the schema and in the zod input.
- A URL from an agent shows as text; "Open" shows the full URL and opens it in a browser surface of the item's folder, never in the app window.
- Agent text never becomes a command id, a command argument the user did not confirm, a notification action, or input to another session. The only effect of an option button is to return its id to the asking session.
- Session summaries from the small model are agent text by the same rule and carry their author mark.

### 10. Notifications, badge and the profile registry

- When an item notifies: hook-made approval items notify on the `permission_prompt` Notification (the dialog is still open after a few seconds), and hook-made `Stop` items on the `idle_prompt` Notification (the user has not come back after about a minute), both only while the session is not in view. Items from agents, the app and the scheduler notify at creation. The policy of section 8 applies on top.
- macOS notifications use Electron's `Notification` in the main process, behind a `Notifier` interface with a fake in tests. Title: profile name and project name. Body: the short message on one line. Clicking focuses the profile's window and opens the item's card.
- The dock badge shows the profile's unread count: items in state `new` with urgency `normal` or `high`, across all folders. Low-urgency items do not count. A setting limits the badge to `input` and `approval`.
- The inbox service emits `inbox.unread_changed` with the count. The profile registry writer of 0017 (format in the profile design, 0022) subscribes and publishes the count, debounced to 500 ms. The count joins the profile name and colour, which 0017 already lets cross the profile boundary; no item text, project name or session name crosses (0017). The per-profile switches of 0017 apply: the badge can be off, and a profile can hide its count from other profiles. An isolated agent (0018) has no path to the registry.

### 11. Tests

- **Store contract.** One shared suite for the in-memory and SQLite inbox stores: every state transition and every refused one, coalescing through the open dedupe index (a done item frees its key), subtree scoping including top-level items and a folder deleted under open items, item moves with their session, unread count with snoozed and low-urgency items, retention.
- **Migrations.** A milestone 1 database file opens, migrates and keeps its tree and sessions; a newer schema is refused.
- **Hook mapping.** Table-driven tests over payload fixtures copied from `probes/out` (Stop, PermissionRequest, SessionEnd, SubagentStop) with paths and personal values replaced; Notification fixtures from P11 (`permission_prompt`, `idle_prompt`); a `StopFailure` fixture from the documented example. Sequence tests: allow (`PreToolUse`, `PermissionRequest`, `PostToolUse`), deny (`PreToolUse`, `PermissionRequest`, `Stop`) and an interrupt line after `PermissionRequest` leave no open approval item; two open requests with different inputs stay separate items and a `PostToolUse` resolves only its own.
- **MCP tools.** With the SDK client: scope of `link.nodeId`, length and schema errors, rate limit, `high` urgency lowered, `inbox_ask` answered in the call, timed out, answered later and delivered by typing into a fake `claude` through node-pty, delivered through `additionalContext`, and queued while busy.
- **Scheduler.** A fake clock: daily and weekly rules, a daylight-saving week in Europe/Tallinn with a daily 09:00 rule and a daily 03:30 rule (inside the spring gap and the autumn repeat of that zone), `BYMONTHDAY=31` over short months, `COUNT` across a moved occurrence, `UNTIL` on the last occurrence, each catch-up policy over a closed period, a crash between the run insert and the item insert, wake from sleep, snooze wake.
- **Untrusted text.** An e2e test posts a message and details with HTML, a Markdown link, an ANSI sequence and a bidi override, and asserts the literal text in the card, no link element and no image request. A grep test fails on `dangerouslySetInnerHTML` under the inbox code.
- **UI.** Playwright: list, card, peek of a transcript, back stack, "Back to message", saved views, auto-resolve on view, dock badge and notification through the fake `Notifier`.
- **Mutation checks** in the review step, as in milestone 1: scope check on `nodeId`, the plain-text rule, the dedupe index, the run primary key.
- **Real Claude**, as a script outside `pnpm test`: a PTY session calls `inbox_post` and `inbox_ask`, the script answers through the command, the session receives the answer. Model `haiku`, `--max-budget-usd 0.25`, empty temporary directory, `--setting-sources user`, `--strict-mcp-config`, the 0013 environment scrub.

### 12. First milestone 2 slice and what waits

First slice:

- Inbox and tasks modules with the migrations of section 2 (tree and session migration 2 included), the store contract suite.
- Hook mapping for `Stop`, `StopFailure` (added to the app's hook list), `Notification` (including `elicitation_dialog` as an `input` item that links to the terminal) and `PermissionRequest`, plus the resolving rules of `PostToolUse`, `UserPromptSubmit` (without the `<task-notification>` prompts) and the interrupt line. Approval items from `PermissionRequest` link to the terminal; the decision stays in the TUI dialog until the `http` hook transport exists.
- `inbox_post` with rate limit and coalescing.
- Inbox pane with list and detail card (header with project and session names and the project description; short message and expandable details), one default view, auto-resolve on view.
- Unread count, `inbox.unread_changed`, macOS notification and dock badge with the throttle.
- Tasks pane, reminders with the RRULE subset, the persisted scheduler with catch-up and snooze.

Waits:

| Item | Waits for |
|---|---|
| `inbox_ask` and answer delivery | P16 |
| Allow and deny from the card for PTY approvals | the `http` hook transport of 0022 (P14 passed: the first answer wins, a timeout returns the decision to the dialog) |
| Elicitation answers from a form in the card | the `Elicitation` hook in the app's hook list and the `http` transport (P15 passed for form mode with an immediate answer); a hook that waits for the user: P17 |
| URL-mode elicitation and the `elicitation_url_dialog` Notification subtype | P17 |
| Session summaries by the small model, staleness and refresh | after the slice; check of transcripts and trust entries left by summary runs |
| Peek mount mode, back stack, saved views beyond the default | the R20 block model (0015) and the transcript viewer (0009) |
| Stream-json sources (`can_use_tool`, `task_notification`) | the stream-json launch path |
| Review, outward-draft, swarm and usage items | 0010, 0011 and 0019 modules |
| Agent-run schedules | the swarm cap and the stream-json path |
| Per-project policies, quiet hours | after the slice; the app default applies |
| Profile registry publishing | the profile work of 0017 and 0022 |
| Mirror of the agent's own to-do list | 0009 agent nodes |

## Consequences

- R21 becomes buildable in slices. The first slice is roughly 4 to 6 working days in 0005 units; the full R21 stays at the 10 to 15 days of 0016, low confidence.
- The inbox depends on hook payloads and Notification types that the hooks reference documents and that change between CLI releases (the reference lists Notification types no probe has shown). The hook mapper keeps the raw payload in `payload` for unknown cases and its fixtures are re-recorded on each CLI upgrade, with the probe scripts.
- `inbox_ask` waits for P16; until then agents in PTY sessions ask questions in the terminal, and the `Stop` item ending in a question mark carries them to the inbox.
- The surface interface of 0006 changes (`MountOptions`), a contract change under 0013 that the integration step applies.
- 0016 is amended: kind `alert` is added; the source field holds the producer class (`hook`, `agent`, `app`, `scheduler`) and `origin` names the producer, in place of the session, agent, swarm and surface sources of 0016; items keep `done` with a resolution; the session summary columns live in the session module and the project summary in the tree module.
- The app's hook list (`HOOK_EVENTS`) gains `StopFailure`, and `Elicitation` together with the `http` transport that can answer it (P15); the `UserPromptSubmit` hook command prints queued answers.
- P11 showed the permission and idle subtypes, P15 the `elicitation_dialog` and `elicitation_response` subtypes and the `Elicitation` hook in form mode, P14 the waiting `PermissionRequest` hook, and P13 that background subagents report through `<task-notification>` prompts after `Stop`. A reviewer re-ran P11, P13, P14 (without the timeout case) and P15 with the same results. Probes to run: P16 long MCP tool calls, the documented 60-second, idle and background limits, and interrupts in both paths; P17 URL-mode elicitation and an `Elicitation` hook that waits for the user; a check that summary runs leave no transcripts or trust entries behind. P11 to P15 are the milestone 2 probes of `notes/probes-m2.md` (P12 status line, P13 transcript usage).
- Not verified: `StopFailure`, and the Notification subtypes other than `permission_prompt`, `idle_prompt`, `elicitation_dialog` and `elicitation_response`; whether the idle delay of about 60 seconds is fixed and whether `idle_prompt` repeats; the MCP time limits and the move to a background task; a deny chosen in the TUI dialog without a waiting hook, and the transcript line an Esc on the dialog leaves; the `rrule` package's daylight-saving handling; Electron's dock badge and notification behaviour under Focus modes; `SessionEnd` reasons other than `other` and `prompt_input_exit`.
