# Milestone 2 probes P11 to P15

Date: 2026-11-17. Claude Code 2.1.326, model Haiku (`--model haiku`), real login, environment scrubbed as in `probes/lib.mjs` and `probes/pty_lib.py` (`CLAUDE_CONFIG_DIR` kept). Interactive probes run in a PTY with `--setting-sources user`, `--strict-mcp-config` (P15 adds its own server through `--mcp-config`) and `--permission-mode manual` (P13 uses `acceptEdits`), each in a fresh empty directory under `probes/work/`. Hooks and the status line come through `--settings`. The PTY runs have no budget cap: `claude --help` says `--max-budget-usd` only works with `--print`. The status line reported between 0.004 and 0.014 USD per run. Evidence is in `probes/out/` (not tracked). Each script has a README line at the top. New helper `probes/m2_lib.py` builds on `stage2_lib.py`.

| Probe | Script | Result |
|---|---|---|
| P11 Notification hook | `p11_notification_hook.py` | pass |
| P12 status line | `p12_statusline.py`, `hooks/statusline_capture.py` | partial (user-level status line not tested) |
| P13 transcript usage | `p13_transcript_usage.py` | pass |
| P14 waiting PermissionRequest hook | `p14_waiting_permission_hook.py`, `hooks/perm_wait.py` | pass |
| P15 Elicitation | `p15_elicitation.py`, `fixtures/elicit_mcp_server.mjs`, `hooks/elicit_answer.py` | pass, with a stdio server |

## Folder-trust dialog (setup finding)

Fresh directories under `probes/work/` raised the folder-trust dialog ("Quick safety check ... Yes, I trust this folder") in these runs, with the default highlighted on "No, exit". The earlier stage 2 runs did not see it; the milestone 1 session build did (0014). A script that types a prompt into the dialog and presses Enter exits the session ("Claude Code didn't start because this folder isn't trusted"), and no hook fires. `m2_lib.py` and `p12_statusline.py` answer it with Down and Enter, so each run adds a trust entry for its temporary directory to the user's Claude config (0014 lists the same side effect for the smoke runs). An app that creates fresh working directories has to handle this dialog (or trust the directory beforehand); it blocks `SessionStart`, and the status line docs say the status line stays blank until the folder is trusted.

## P11 Notification hook in the interactive session

Method: logging hooks for the usual events plus `Notification` (no matcher). The prompt asked for one Bash command with no `PermissionRequest` decision, so the dialog stayed open; the script waited, answered with Enter, let the turn finish, and then idled at the prompt (`p11_report.json`, `p11_hooks.jsonl`).

Results:
- `permission_prompt` fires while a permission dialog is open: message "Claude needs your permission".
- `idle_prompt` fires when the prompt has been idle after a turn: message "Claude is waiting for your input".
- P15 shows `elicitation_dialog` ("Claude Code needs your input") and `elicitation_response` (message "Elicitation response for server "elicit": cancel").
- Payload keys: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `hook_event_name`, `message`, `notification_type`. The `notification_type` field distinguishes the types. `title` is absent (the hooks docs call it optional). There is no `tool_name`, no `tool_use_id` and no `permission_mode`; a permission notification does not say which call it is about (pair it with the `PermissionRequest` payload of the same session).
- Timing, in seconds:

| Notification | Delay |
|---|---|
| `permission_prompt` after `PermissionRequest` | about 6 |
| `idle_prompt` after `Stop` | about 59 |
| `elicitation_dialog` after `Elicitation` | about 6 |

  The permission and elicitation notifications fire about 6 s after the dialog opens, and only if it is still open (P14 shows the same delay while a hook is waiting). A user who answers within 6 s produces no notification. The hooks docs add that each keystroke defers the 6 s timer and that `idle_prompt` is not sent while a background agent runs; neither was probed. The idle period watched ended about 25 s after the `idle_prompt`, so a repeat interval is not known.
- The TUI also writes the permission, idle and elicitation dialog messages to the terminal as OSC 9 sequences (`ESC ] 9 ; Claude needs your permission BEL`, seen in `p11_raw.bin`, `p14_nokey_raw.bin` and `p15_log_only_raw.bin`), so the PTY output carries the same signal.
- Design effect: the `PermissionRequest` hook is the immediate signal for "waiting for approval"; `Notification` is a delayed second source and the only hook for the idle prompt. The idle prompt after about a minute can mark a session "needs attention" when no other state changed.

## P12 status line through --settings

Method: `statusLine` of type `command` in the `--settings` JSON, command `hooks/statusline_capture.py`, which writes the stdin JSON to `<dir>/<session_id>.json` through a temporary name and `os.replace`, and appends every call with its time to `fires.jsonl`. Runs: basic (12 s idle, then one Bash turn), `refreshInterval` 3, precedence against a project `.claude/settings.json` status line, and a concurrency stress of the capture script (`p12_report.json`, `p12_*_cap/`).

Payload keys (first call at start, then the same plus the fields marked later):

| Group | Fields |
|---|---|
| identity | `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `version`, `session_name` (after the first prompt), `prompt_id` (after the first prompt) |
| model | `model.id`, `model.display_name`, `effort.level`, `fast_mode`, `thinking.enabled`, `output_style.name` |
| workspace | `workspace.current_dir`, `workspace.project_dir`, `workspace.added_dirs` |
| cost | `cost.total_cost_usd`, `total_duration_ms`, `total_api_duration_ms`, `total_lines_added`, `total_lines_removed` |
| context | `context_window.context_window_size`, `total_input_tokens`, `total_output_tokens`, `current_usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), `used_percentage`, `remaining_percentage`; `exceeds_200k_tokens` at the top level |
| cache | `prompt_cache` (`warm`, `ttl`, `expires_at`, `requests`, `misses`, `hit_ratio`, `cache_write_tokens`, `recache_tokens_if_cold`, `miss_causes`, ...), after the first request |
| rate limits | `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and `resets_at` (epoch seconds); present after the first request in this subscriber login |

- At the first call (about 1 s after start) `cost` is zero, `context_window.current_usage`, `used_percentage` and `remaining_percentage` are null, and `prompt_cache` and `rate_limits` are absent.
- `context_window.total_input_tokens` equals the sum of the three input fields of `current_usage` (the latest request), so it describes the current context, not the session total; the status line docs say the same. The session total of tokens is not in the status line payload; the transcript has it (P13). `total_output_tokens` is the output of the latest request too (3 here).
- Cost accumulates in `cost.total_cost_usd` (here 0.004 USD after one Bash turn on Haiku). It includes subagent requests, by inference from the P13 run: the status line cost rose from 0.0038 to 0.0123 USD over the step in which both subagents ran and each wrote about 31,000 cache tokens, while `prompt_cache.requests` (main conversation only, per the docs) went from 1 to 2; its last value (0.0136) is close to the transcript's `cost-state` total (0.0142), which counts the subagent cache writes. One run, no per-request breakdown.
- Cadence without `refreshInterval`: one call at start, none during 12 s of idle, then a few calls during each turn; the intervals in one run were 0.6 s and 5 s after the first turn call. The docs list the triggers (a new assistant message, `/compact`, a permission mode change, a rate-limit reset, a prompt cache expiry and others), with a 300 ms debounce. With `refreshInterval` 3 the command runs every 3.0 s during idle as well, plus the event-driven calls. The setting is accepted.
- Precedence: with a project status line next to the `--settings` one, only the `--settings` command ran, under `--setting-sources user` and under `user,project`. The project command never ran in either case (its capture directory was never created). That the project file was read in the second case was not independently shown. No status line exists in this login's user settings, so "a user-level status line is replaced" was not run; by the observed order (flag over project) it is expected to be replaced, and a test needs a user settings file with a `statusLine` key.
- Atomic write: 200 concurrent runs of the capture script on one session id while a reader parsed the file in a loop produced no parse failure and left no temporary files. `os.replace` of a temporary file in the same directory is safe; the file name is built from `session_id` filtered to letters, digits, `-` and `_`. The docs say Claude Code cancels a status line command that is still running when the next update starts, which this test does not cover: a cancelled command can leave a temporary file, so an app that reads the directory ignores `.tmp` names and removes stale ones.
- The payload contains `transcript_path`, `cwd` and `scratchpad_dir`, which are absolute paths of the user's directories; an app that stores the per-session file keeps it out of anything shared.
- Design effect: a status line command is the only live source of cost and subscription rate limits in the interactive path (R24); context size also follows from the latest transcript usage. `rate_limits` values come from API responses, so `refreshInterval` re-runs the command with the same values; they change after the session's next request, and the docs say a window is dropped, with a fresh run, when its `resets_at` passes. Use `refreshInterval` for time-based output only. The command's own stdout is shown in the TUI status area, so the app's command can print an empty line or a short text.

## P13 transcript usage

Method: a fresh session with two parallel subagents, then a parse of the main transcript and the files under `<session id>/subagents/`. Transcripts of earlier probes (`p5`, `p6` bash allow and deny) were parsed as well because their files still exist (`p13_report.json`).

Results:
- Every assistant line carries `message.usage` and `message.model`. Usage keys: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, `output_tokens_details.thinking_tokens`, `server_tool_use.web_search_requests`, `server_tool_use.web_fetch_requests`, `service_tier`, `inference_geo`, `speed`, `iterations` (a list with the same token fields per request) and `fallback_credit`.
- Cache tokens are separate: creation and read are distinct fields, and creation splits into the 5-minute and 1-hour caches. The main conversation wrote to the 1-hour cache, the subagents to the 5-minute cache. `input_tokens` is only the uncached part (single digits here).
- One API message with several content blocks (two tool_use blocks here; a thinking block and two tool_use blocks in a re-run) is written as one transcript line per block, each with the same `message.id` and the same usage object. Summing every line double counts. Count each `message.id` once.
- Subagent usage lives in separate files: `<session id>/subagents/agent-<id>.jsonl` with a `agent-<id>.meta.json` next to it (`agentType`, `description`, `toolUseId`, `finished`, ...). Their lines carry `isSidechain` true and the same usage shape. The main transcript does not contain the subagent requests' usage. The `SubagentStop` payload names the file (`agent_transcript_path`) and `agent_id`. Two parallel subagents each showed a cache creation of the full context (no read), so a subagent's first request pays the cache write on its own.
- The `toolUseResult` of the Agent tool call in the main transcript carried no usage fields in this run.
- The subagents ran as background tasks (`requestShape` `background` in `.meta.json`). The main turn ended with `Stop` before their results arrived; each result came back as a `UserPromptSubmit` whose prompt is a `<task-notification>`, followed by a second `Stop`. A `Stop` therefore does not mean that the session's work is finished while background agents exist (0009).
- Further `SubagentStop` events came from internal agents: empty `agent_type`, ids that never had a `SubagentStart`, and an `agent_transcript_path` whose file does not exist.
- The main transcript ends with `cost-state` rows (0014), written when the process ends: `totalCostUSD` and per-model `modelUsage` (input, output, thinking, cache read, cache creation split by 5-minute and 1-hour). Their totals exceed the sum over main plus subagent files (for example `inputTokens` 2242 against single digits per transcript line), so they also count the internal requests.
- A per-message sum over main plus subagent files therefore undercounts the session; it is complete only for the requests that have assistant lines. The process total comes from `cost-state` at exit.
- Design effect: for per-session and per-task usage after the fact (R24), read transcripts by message id including `subagents/`, and take the session total from `cost-state` once the process has ended. The status line gives the live view, the current context and a cost that includes subagents.

## P14 waiting PermissionRequest hook

Method: `hooks/perm_wait.py` sleeps before answering. Cases for one Bash call (`p14_report.json`, `p14_<case>_hooks.jsonl`, `p14_<case>_hookwait.jsonl`, `p14_<case>_raw.bin`). The hook log has a start line and a decide line, so a killed hook shows no decide line.

| Case | Hook | Input | Outcome |
|---|---|---|---|
| nokey | allow after 8 s | none | Dialog on screen during the wait; the call ran after the hook answered |
| esc_vs_allow | allow after 12 s | Esc at 4 s | Call rejected (tool result "The user doesn't want to proceed with this tool use"); no marker file; the hook had no decide line (killed); no `Stop` fired |
| enter_vs_deny | deny after 12 s | Enter at 4 s | Call ran; the hook kept running and its deny line came at 12 s, ignored |
| timeout | allow after 12 s, `timeout` 5 | none | Hook ended without a decision (no decide line); the dialog stayed open and the session waited for the user; the run was ended after the wait window |

Results:
- While the hook waits, the TUI shows the normal permission dialog ("Yes", "Yes, and always allow access to <dir> from this project", "Yes, and switch to auto mode", "No"; "Esc to cancel · Tab to amend"). This corrects the earlier statement that no dialog shows when a hook answers: the dialog shows until the hook answers and then closes without a keypress. The P6 raw logs contain the dialog text as well, for allow and deny (0014).
- A keypress during the wait is a valid answer and wins over a later hook decision. Enter chose the first option and ran the call even though the hook would have denied it; Esc rejected the call even though the hook would have allowed it.
- Esc also ended the hook process. After Enter the hook continued to its end and its late output had no effect.
- A hook `timeout` that expires gives the dialog back to the user, with no automatic decision. A hook that fails to answer in time is therefore not a deny and not an allow. The hooks docs agree: a hook that reaches its `timeout` is cancelled and its output discarded. The default `timeout` for a command hook is 600 s.
- `Notification` `permission_prompt` still fires about 6 s after the dialog opens while the hook waits.
- Esc on the dialog produced no `Stop` hook (consistent with P10: an interrupt gives no hook).
- After Enter at 4 s the `PostToolUse` event came about 6 s later than the key, longer than the call itself (about 2 s in the nokey case, after the hook answered). In a reviewer re-run it came 2.3 s after the key, so the longer delay is not systematic.
- Design effect: an app can hold a request for the user's decision in its own UI (hook waiting) while the TUI shows its own dialog; the user can answer in either place and the first answer wins. After a hook answer from the app UI the dialog closes by itself. The app notices an answer given in the TUI from the next hook or transcript event, and the app UI for that request must then close. Set the hook `timeout` above the longest wait the app allows, or accept that expiry hands the decision to the TUI dialog.

## P15 Elicitation

Method: stdio server `fixtures/elicit_mcp_server.mjs` (no SDK) with one tool, `ask_color`, that sends `elicitation/create` with a form schema (one enum field) while the tool call is open and returns the client's answer as text. The HTTP test host `mcp_host.mjs` answers only plain POST responses and has no server-initiated requests, so it cannot carry an elicitation; this is why the probe uses stdio. Hooks logged `Elicitation`, `ElicitationResult` and `Notification` (`p15_report.json`, `p15_<case>_*`).

Results:
- Claude Code declares `elicitation` with `form` and `url` modes in its `initialize` capabilities (protocol version 2025-11-25), next to `roots`.
- `Elicitation` fires when the server sends the request. Payload keys: `hook_event_name`, `mcp_server_name`, `message`, `mode` (`form`), `requested_schema` (the server's JSON schema), plus the common `prompt_id`, `session_id`, `transcript_path`, `cwd`. There is no tool name or tool call id.
- Log-only run: the TUI shows "MCP server "elicit" requests your input" with the schema's field, Accept and Decline. `Notification` `elicitation_dialog` fired about 6 s after the request. Esc cancelled: `ElicitationResult` with `action` `cancel` (keys `action`, `mcp_server_name`, `mode`) and `Notification` `elicitation_response`. The server received `{"action":"cancel"}` and the tool returned it to the model.
- Hook answer run: a hook printing `hookSpecificOutput` with `hookEventName` `Elicitation`, `action` `accept` and `content` `{"color":"green"}` answered the request with no dialog. The server received `{"action":"accept","content":{"color":"green"}}`. `ElicitationResult` and the notifications did not fire in this case; the hooks docs say the same for `ElicitationResult`.
- The MCP tool call itself still needs a normal permission (the run allowed it through a `PermissionRequest` hook); the elicitation is a separate step after it.
- Design effect: an app can answer elicitations in its own form UI through the `Elicitation` hook (render `requested_schema`, return `accept` with `content`, or `decline` or `cancel`), the same pattern as approvals. Only form mode was probed; url mode was not. A hook that waits for the user was not probed for elicitation (P14 covers permissions only).

## Not verified

- A user-level `statusLine` in the login's settings and its replacement by `--settings`.
- A per-request check that `cost.total_cost_usd` includes subagent requests (inferred from totals above); the status line in a `-p` run.
- Notification types the docs list beyond those seen (`auth_success`, `elicitation_url_dialog`, `elicitation_complete`, `agent_needs_input`, `agent_completed`, the `quota_auto_resume_*` types and others), the keystroke deferral of the 6 s timer, and an `idle_prompt` repeat interval.
- A waiting `Elicitation` hook, URL-mode elicitation, an elicitation inside a subagent.
- Whether usage of a workflow started by the session rolls up to the parent session (0019).
- Models other than Haiku; one builder run per case.

## Reviewer re-run

An independent reviewer re-ran P11, P12 (`basic`, `atomic`), P13, P14 (`nokey`, `esc_vs_allow`, `enter_vs_deny`) and P15 (`log_only`, `accept`) on the same CLI version. The results reproduced: the same notification types and delays (6.0 s and 59.6 s), the same status line payload shape and fire pattern, no parse failure in the atomic test, the same transcript usage shape, the same outcomes of the waiting hook cases, and the same elicitation payloads and server responses. P12 `refresh` and `precedence` and P14 `timeout` were not re-run. The re-run logs are in `probes/out/m2-review/`; the files directly under `probes/out/` are the builder's.
