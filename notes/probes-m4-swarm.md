# Milestone 4 swarm probes P30 to P37

Date: 2026-11-21. Claude Code 2.1.330 on the host (`claude --version`); the earlier probes ran on 2.1.326, and every row below was observed on 2.1.330. Model Haiku (resolves to `claude-haiku-5-5`), subscription login (`claude auth status`: claude.ai login, team plan), budget cap 0.25 USD per call, `--setting-sources user`, `--strict-mcp-config` and `disableAllHooks` unless a probe says otherwise, a fresh directory under `probes/work/` per scenario removed afterwards, at most three concurrent processes. Raw logs are in `probes/out/` (not tracked); file names are given per probe. Shared helpers: `probes/lib.mjs` and the new `probes/p_swarm_lib.mjs`. Total real-Claude spend of the whole set is a few cents.

## Method

Each probe is a small Node script with a README line at the top. The CLI is started as the app would start a swarm agent: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`, user messages written as NDJSON on stdin, host answers written as `control_response` lines. `--permission-mode manual --permission-prompt-tool stdio` turns every approval into a `can_use_tool` control request. Environment variables injected by a parent Claude session are scrubbed, `CLAUDE_CONFIG_DIR` is kept.

## Results

| Probe | Result | Evidence |
|---|---|---|
| P30 stream-json agent, can_use_tool | pass | `p30_report.json`, `p30_stream_agent.jsonl` |
| P31 interrupt | pass | `p31_report.json` (mid-text and SIGINT), `p31_report_mid_bash_control.json`, `p31_report_pending_permission_control.json`, `p31_*.jsonl` |
| P32 control requests | pass (list), partial (effects) | `p32_report.json`, `p32_control_requests.jsonl` |
| P33 resume | pass | `p33_report.json`, `p33_*.jsonl` |
| P34 concurrency | pass | `p34_report.json`, `p34_agent1.jsonl` to `p34_agent3.jsonl` |
| P35 budgets | pass | `p35_report.json`, `p35_report_after_budget.json`, `p35_*.jsonl` |
| P36 worktrees | pass | `p36_report.json`, `p36_agent.jsonl` |
| P37 --bare | pass | `p37_report.json`, `p37_*.jsonl` |

### P30 stream-json agent under -p

- Four user messages over one process share one session id. Every turn ends with its own `result` event, and every turn re-emits `system/init`, so the host sees one init per turn. With `--permission-mode manual` the init reports `permissionMode: default`.
- The `can_use_tool` control request carries `request_id` on the envelope and, in `request`: `subtype`, `tool_name`, `display_name`, `input`, `description` (the file name for Write), `permission_suggestions` (for Write in manual mode one `setMode acceptEdits` suggestion with destination `session`) and `tool_use_id`. No `decision_reason` was present for a plain manual-mode prompt.
- Allow with `updatedInput: <the input>` runs the tool. Deny with `{behavior: "deny", message}` makes the tool result an error whose content is the message text; the agent repeats it, the file is not written, and the turn result lists the call in `permission_denials` with `tool_name`, `tool_use_id` and `tool_input`.
- Allow with a changed `updatedInput` runs the tool with the new input: the host replaced the content of a Write, the file on disk held the host's text, and the agent noticed on read-back that the file differed from what it wrote. A host that rewrites input should say so to the agent in a user message, because the tool result does not mention the rewrite.
- A request left unanswered stays pending: after 60 s of silence the process was alive, no further events except stream tail events arrived, and an allow after 60 s completed the turn normally (turn duration 61 s, API time 7 s). No timeout was observed within that window. The SDK docs (Handle approvals and user input) state that the callback "can stay pending indefinitely" and that Claude "isn't told you changed anything" when the host changes the input.

### P31 interrupt

| Case | `control_response` | Result of the interrupted turn | Next user message |
|---|---|---|---|
| Interrupt during text generation | success, `{still_queued: []}` in about 5 ms | `error_during_execution`, `is_error` true, `terminal_reason: aborted_streaming`, about 20 ms later, empty `result` text, cost of the partial turn reported | works, same process and session |
| Interrupt while a Bash command runs | same | `error_during_execution`, `terminal_reason: aborted_tools`; the tool result is an error saying the call was stopped while running | works |
| Interrupt while a `can_use_tool` request is pending | same | `error_during_execution`, `terminal_reason: aborted_tools`; the tool result is the standard rejection text ("The user doesn't want to proceed with this tool use ..."); the CLI sends a `control_cancel_request` for the pending `request_id` | works |
| SIGINT during text generation | none | `error_during_execution`, `aborted_streaming`; the process exits by itself with code 0 | not possible, process gone |

The interrupt request is the right stop for one turn. SIGINT ends the process. The `errors` array of the result holds a line starting with `[ede_diagnostic]`; the app should not parse it. The init event lists `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`, `interrupt_send_now_v1` and `interrupt_requeue_taken_v1` in `capabilities`; the `still_queued` field is the receipt. The send-now and requeue variants were not exercised.

### P32 control requests

Sent with the smallest plausible payload to a live `-p` stream-json process; subtype names come from strings in the CLI binary and the SDK reference. "Answered" means a `control_response` with the same `request_id` arrived.

| Subtype | Answer |
|---|---|
| `initialize` (before any user message) | success, returns commands, agents, models and account data (about 0.6 s) |
| `mcp_status` (before and after a turn) | success, `mcpServers` list |
| `set_permission_mode` | success with the mode; the next `init` reports it. Valid values: `acceptEdits`, `auto`, `bypassPermissions`, `default`, `dontAsk`, `plan` (`default` is the name for manual). Invalid value: error naming the valid ones |
| `set_model` | success with the resolved id (`sonnet` gives `claude-sonnet-5-5`); unknown id: error `Model '<id>' not found` after about 0.2 s |
| `set_max_thinking_tokens`, `apply_flag_settings`, `rename_session`, `seed_read_state`, `end_session` | success, empty body; `end_session` makes the process exit with code 0 |
| `stop_task` | success with an empty body for an unknown id and for a real background Bash task; for the real task the stream then shows `task_updated` with status `killed`, `task_notification` with status `stopped` and `background_tasks_changed` |
| `get_task_output` | success with the output so far, `total_bytes`, `truncated` |
| `mcp_set_servers`, `mcp_toggle`, `mcp_reconnect` | success with `added`, `removed`, `errors` for an empty set; error `Server not found` for an unknown server |
| `get_context_usage`, `get_session_cost`, `get_usage`, `get_status`, `get_settings`, `list_models`, `list_permission_rules`, `get_hooks_listing`, `get_plan`, `get_workspace_diff` | success with data |
| `reload_plugins`, `reload_skills` | success with the command and skill lists |
| `rewind_files` | success with `canRewind: false` and "File rewinding is not enabled" |
| `cancel_async_message` | success, `cancelled: false` for an unknown message |
| `side_question` | success, the model answered a side question without touching the main context |
| `generate_session_title` | success with `title: null` for a short description |
| `set_cwd` | error: needs a non-empty path string (field name differs from the one sent) |
| unknown subtype | error `Unsupported control request subtype: <name>` |

The binary lists further subtypes (for example `mcp_message`, `mcp_clear_auth`, `hook_callback`, `get_skills_dialog`) that were not sent. Effects verified: the permission mode change and the stop of a background task. Not verified: that a mode change from `manual` to `acceptEdits` stops prompts in the same turn, and the field names of the requests that answered with a generic success.

### P33 resume

- Session file: `<config dir>/projects/<working directory with every character other than a letter or digit replaced by ->/<session-id>.jsonl`, where the config dir is `CLAUDE_CONFIG_DIR` when set. The probe directories contained only `/`, `.` and `-`; a review run in a directory whose name held `_`, `.` and a space found the file under the name with all three replaced. The file exists and holds the first user text after a SIGKILL that follows a finished turn.
- `--session-id <uuid>` on a new session gives init and result that session id. The same flag on an id whose file exists fails at start: stderr `Session ID ... is already in use.`, exit code 1, no events. A restart must use `--resume`.
- `--resume <id>` after SIGKILL continues the context (the codeword was recalled), keeps the id and appends to the same file. It works from a different working directory because the CLI finds the session by id.
- Killing the process while a Bash tool ran leaves a transcript that ends in an assistant `tool_use` with no result. `--resume` of that session recalls earlier context and the agent reports that the command outcome is unknown. The docs describe `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` to continue the interrupted turn; not run.
- Two processes can hold the same session id with `--resume`: the second one started and answered with the first one's context while the first was alive. Both use the same session id and therefore the same file; the app should allow one live process per session.
- The first event arrives about 0.5 to 0.7 s after spawn, and nothing is emitted before the first user message is written, so the host must not wait for an init before sending.

### P34 concurrency

Three haiku agents, two turns each, started together, default MCP and plugin configuration of the user login except `--strict-mcp-config`, no `--tools` restriction, permission mode from the user settings (init reported `auto`).

| Agent | Spawn to init (ms) | Turn 1 (ms from spawn) | Turn 2 (ms after turn 1) | Cumulative `total_cost_usd` after turn 1 and 2 (USD) |
|---|---|---|---|---|
| 1 | 952 | 2059 | 708 | 0.0037 / 0.0040 |
| 2 | 1011 | 1919 | 908 | 0.0037 / 0.0067 |
| 3 | 972 | 1881 | 915 | 0.0037 / 0.0067 |

All turns succeeded, all three recalled their number, no `api_retry`, no error events, exit code 0 each. Total wall time 3.7 s; the three sessions are distinct. Cost fields: `total_cost_usd` on `result` is cumulative per process, `modelUsage` holds per-model tokens and cost (also cumulative, P30), `usage` holds the token counts of the turn.

Each agent emitted one `rate_limit_event` with `rate_limit_info`: `status` (`allowed`), `resetsAt` (epoch seconds), `rateLimitType` (`five_hour`), `overageStatus` and `overageDisabledReason` (organization level), `isUsingOverage`, and `unifiedWindows` with `five_hour` and `seven_day`, each with `utilization` (fraction), `resetsAt` and `status`. Utilization was low for both windows, so no `rejected` or `allowed_warning` payload was seen. This is the field the swarm view reads for the pause on a limit event (0011); the payload of a limit that is hit is not verified.

### P35 budgets

- `--max-turns N` counts model turns inside one user message, not the process. With `--max-turns 1` and a task that needs tools, the `result` has `subtype: error_max_turns`, `is_error: true`, `terminal_reason: max_turns`, `errors: ["Reached maximum number of turns (1)"]`, empty `result` text, cost so far. The process stays alive and the next user message runs normally. Three simple turns under `--max-turns 2` all succeeded, so the count restarts per user message.
- `--max-budget-usd` is cumulative for the process. When a turn pushes the estimate over the cap the `result` has `subtype: error_max_budget_usd`, `terminal_reason: budget_exhausted`, `errors: ["Reached maximum budget ($0.00025)"]`. The check happens after a response: the response that crosses the cap is still streamed as an `assistant` message, the `result` then reports `error_max_budget_usd` with empty `result` text, and the cumulative cost exceeds the cap. A first turn can already cross a tiny cap (a review re-run with 0.00025 USD did). A plain `-p --output-format json` run whose total stays below the cap succeeds with exit 0; the budget error under plain json was not produced.
- After the budget result the process stays alive; each later user message returns `error_max_budget_usd` at once with the same cost and no model call.
- Exit code with stdin closed follows the last result: 0 after a success, 1 after an error result. Plain `-p --output-format json` with `--max-turns 1` exits 1 with `subtype: error_max_turns`.
- Host rule: treat any `result` with `is_error` true or a subtype other than `success` as the end of that agent's allowance; the app must stop the process or stop sending.

### P36 worktrees

Temporary repository, `git worktree add -b agent/agent-1 <dir> HEAD` into a separate temporary directory, haiku started with the worktree as working directory (`init.cwd` is the worktree), acceptEdits mode. The agent edited one tracked file and created a new one using Bash commands; the main checkout stayed clean.

- Collecting the diff: `git status --porcelain` lists both files; plain `git diff` shows only the tracked change. `git add -N .` followed by `git diff HEAD` (or `--numstat`, `--stat`) includes the new file as a `new file mode` patch. The `get_workspace_diff` control request returns the same information as `stats`, `perFileStats` (path, added, removed, `isUntracked`, `status`) and `hunks` per file, with `source.kind: working-tree`, so the app can ask the agent process directly.
- `git worktree remove <dir>` with modified or untracked files fails: "contains modified or untracked files, use --force to delete it", also after `git add -A`. A locked worktree needs the lock removed or `-f -f`. `git worktree remove --force` deletes the directory and the edits are gone (stash list empty, branch has no extra commits). The branch `agent/agent-1` stays.
- A worktree whose agent committed removes without `--force`; `git diff main...agent/agent-2` gives the agent's change. A worktree directory deleted by hand shows as `prunable` and `git worktree prune` clears the entry; the branch remains.
- Host rule: commit (or `git add -N` and write the patch to the app store) before any removal; never pass `--force` without a stored patch; delete the branch separately.

### P37 --bare

- Default `-p` in 2.1.330 is not bare: the init of a plain `-p` run lists the user's plugins, skills, agents, slash commands and MCP servers (connectors included) and the full tool list, whose length differed between two runs; `--strict-mcp-config` is needed to drop connectors. The headless docs state that `--bare` "will become the default for `-p` in a future release" and recommend it for scripted calls. Nothing has changed yet.
- `--bare -p` ends with `is_error: true`, `result: "Not logged in · Please run /login"`, `subtype: success`, `terminal_reason: api_error`, exit code 1 and cost 0 when no `ANTHROPIC_API_KEY` is set: it never reads the OAuth login or the Keychain. The help text and the docs say the same. `--setting-sources user` does not change it.
- Consequence for the swarm: on the subscription login the app must not pass `--bare`. If `--bare` becomes the default, the app needs an explicit opt-out; the flag to disable it was not found in `--help`. The check for that moment is a startup run with `--bare` absent that still logs in, plus a version gate on the first init `apiKeySource`.
- Other facts from the docs page: SIGTERM leaves the running turn without a result and exits 143; SIGINT or `interrupt` ends the turn first. `claude -p` starts in manual mode when nothing sets a mode (2.1.302 or later). `--permission-prompts none` denies requests without asking a host.
- A `defaultMode` in the user settings counts as setting a mode: this login's user settings hold `defaultMode: auto`, and every run here without `--permission-mode` (P34, P37, including `--bare`) reported `permissionMode: auto` in init. The app passes `--permission-mode` on every launch so the swarm mode does not depend on the user's settings.

## Design effects

1. One `claude -p` stream-json process per agent works end to end: multi-turn, approvals, steering, interrupt, budgets and resume are all host-visible.
2. Per-agent stop is the `interrupt` request; per-agent kill is process termination; `stop_task` ends background work inside an agent.
3. Budget and turn limits do not end the process; the app owns the end of an agent after an error result.
4. Worktree diffs come from `get_workspace_diff` or git; removal must follow a stored patch or a commit.
5. The subscription login excludes `--bare`.

## Caveats

- Haiku and tiny prompts only; timing at larger models and longer turns is not covered.
- Probes ran from inside another Claude session with scrubbed variables; an app launched from the desktop may differ in the environment, not in the protocol.
- P30 pending-request wait was bounded at 60 s.
- `get_workspace_diff` was run in a worktree repository only; large diffs report `skippedLarge` and `omitted` fields that were not triggered.

## Not verified

- A pending `can_use_tool` request beyond 60 s.
- The payload of a `rate_limit_event` that is rejected or warns, and the real limits of the plan under three or more parallel agents.
- Whether native subagents inside a stream-json agent can call app MCP tools, and `SendMessage` against a running subagent (still docs only).
- `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`, and file integrity when two processes write one session.
- Effects of `set_permission_mode` in the middle of a turn, `mcp_set_servers` with a real server, `rewind_files` with checkpointing enabled.
- Whether the flag that will switch `-p` to bare by default has an opt-out, and the login behaviour then.
- The decided default permission mode for swarms is auto (0025), but every approval probe here ran in manual mode; which calls reach `can_use_tool` under auto mode with `--permission-prompt-tool stdio` is open.
- An independent review agent checked these notes against the logs and the headless, permission-mode and SDK approval docs, and re-ran P37, P35 `after_budget` and P31 `pending_permission_control` one process at a time; all three reproduced. The re-runs replaced the matching files in `probes/out/`.
