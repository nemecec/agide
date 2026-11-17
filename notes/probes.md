# Probes: launching and driving the unmodified claude CLI

Date: 2026-11-17. Claude Code 2.1.326 (`claude --version` and `system/init`). Model for probe calls: Haiku (`--model haiku`, resolves to `claude-haiku-5-5`). Scripts are in `probes/`, raw logs in `probes/out/`, summary in `probes/RESULTS.md`. This file was written from those logs; no probe was re-run.

Common setup: working directory `probes/work` (empty), `--setting-sources user`, `--strict-mcp-config` except where a connector was tested. `-p` runs also used `--max-budget-usd 0.25` and, unless hooks were under test, `--settings '{"disableAllHooks":true}'`. The probes ran inside another Claude Code session; the scripts remove the injected `CLAUDECODE` and `CLAUDE_CODE_*` variables and keep `CLAUDE_CONFIG_DIR` because it selects the login.

## P1 stream-json (`p1_stream.mjs`)

Method: one `claude -p --input-format stream-json --output-format stream-json` process per scenario, user messages written to stdin, events parsed from stdout.

Results:
- Multi-turn over one process: two turns, same `session_id`, second turn recalled a value from the first, `result` events carry `total cost`, `num_turns`, `usage`, `terminal_reason`.
- `--session-id` is honoured (init reports the requested id). `--resume <id>` keeps the id and recalls context. `--fork-session` yields a new id and recalls context. Resuming an unknown id exits with code 1, stderr "No conversation found with session ID".
- Image input as a base64 content block: the agent read both colour halves correctly.
- Interrupt: a `control_request` with subtype `interrupt` ends the turn (`error_during_execution`, `terminal_reason: aborted_streaming`) in about 16 ms and the process stays alive for a next turn. SIGINT ends the turn and the process (exit code 0).

Caveats: Haiku only; short prompts; image test used one synthetic two-colour PNG.

## P1c permissions (`p1c_permissions.mjs`)

Method: Write tool and an app MCP tool requested under `--permission-mode` variants, with each approval route.

Results:
- `-p` with no approval route denies calls that need approval.
- `--permission-prompt-tool mcp__app__permission_prompt` (an MCP tool of the app server): allow and deny both reach the agent; deny text appears as the tool error.
- `--permission-prompt-tool stdio`: a `can_use_tool` control request arrives with `tool_name`, `display_name`, `input`, `description`, `permission_suggestions`, `server_policy_ask_only`, `tool_use_id` and, for MCP tools, `mcp_server`. The host answers with a control response; allow and deny both work.
- A `PermissionRequest` hook supplied through `--settings` answers allow and deny for built-in and MCP tools.
- `--permission-prompts none` with an allow rule (`mcp__app__*`) runs without prompts.
- The user's own `defaultMode` is `auto` and applies under `--setting-sources user`; `-p` without an explicit mode wrote a file with no prompt.

Caveats: `--permission-prompt-tool` is not listed in `claude --help` as its own flag; it works. Only Write and one MCP tool were exercised.

## P1b PTY (`p1b_pty.py`, `pty_lib.py`)

Method: interactive `claude` in a pseudo-terminal, hooks supplied through `--settings` logging each event to JSONL, prompt typed into the PTY.

Results:
- Ready text appears; turn completion is observable through the `Stop` hook, which carries `last_assistant_message`, `permission_mode`, `prompt_id` and `transcript_path`, and through the transcript JSONL.
- Hook events seen in order: SessionStart, UserPromptSubmit, PreToolUse and PostToolUse per tool, PermissionRequest where approval is needed, Stop.
- `PermissionRequest` hook output answers the prompt in the PTY for an MCP tool; the on-screen prompt path (`perm_screen`) also completes.
- No streaming deltas and no cost field in this mode.

Caveats: PTY interrupt and image paste were not tested. Timings are in the table below.

## P3 app MCP server (`mcp_host.mjs`, `p3_mcp.mjs`, `p1b_pty.py mcp`)

Method: localhost Streamable HTTP MCP server with bearer token, Origin and Host checks, passed through `--mcp-config` with `--strict-mcp-config`. Tools: `ui_create_folder`, `ui_move_session`, `ui_open_file`, `ui_state`, `permission_prompt`.

Results:
- `"type":"http"` connects in `-p` and in the PTY. `streamable-http` as an alias also connects.
- The app tools are deferred behind `ToolSearch`; the agent found and called them with one extra tool call and no extra instruction. Host state after the run shows the folder created, session moved and file opened.
- Missing `type`: server skipped, `mcp_server_errors` reports `url_missing_type`.
- Wrong token: server status `failed`; host saw 401 responses; the agent reported the 401.
- A tool error ("unknown session") reaches the agent as an error result and the agent repeats the text.

Caveats: the server answers request/response only. SSE and server-initiated requests were not exercised.

## P2 reuse (`p2_reuse.mjs`, `p2_pty.py`)

Method: listing of `system/init`, skill invocation, connector call and `mcp_status` in `-p`; skill and connector call in the PTY.

Results:
- User skills and marketplace plugin skills are listed in init and invoked successfully in `-p` and in the PTY. Skill directories without a `SKILL.md` (`.trash`, `synced`) are absent from the list.
- `--strict-mcp-config` removes claude.ai connectors, plugin MCP servers and user MCP servers from the server list; skills and plugins stay loaded.
- The claude.ai Atlassian connector (`connected`) answered `atlassianUserInfo` in `-p` and in the PTY. The PTY run shows a `PermissionRequest` hook call for it.
- The connector's deprecation notice is in the MCP server instructions, not in the tool result; the model repeated parts of it.
- `--bare` with the subscription login: "Not logged in", exit code 1.

Caveats: connector content was not recorded. `claude.ai Atlassian MCP` and `claude.ai Atlassian Rovo` are `needs-auth`; their endpoint version is untested.

## Session-start state: first and later `system/init`

- Two turns on one `-p` process (`p1_multi.jsonl`): both init events have the same `session_id`, tool list, skill list, plugin list and an empty MCP server list. No change between them.
- With claude.ai connectors enabled (`p2_report_status.json`): the first init lists a short set of servers (plugin and user servers, mostly `pending` or `needs-auth`) and no claude.ai tools. The later init lists many more servers, including `claude.ai Atlassian` as `connected`, and a large set of claude.ai tools. The `mcp_status` control request returns each server with status, scope and tool count (41 tools for the connected Atlassian server). An app that needs the connector or tool list reads `mcp_status` or a later init, not the first init.
- The init event has no list of sessions. Session ids come from the `session_id` field and the transcript files under `$CLAUDE_CONFIG_DIR/projects/<cwd with / replaced by ->/<session_id>.jsonl`.

## Hook context injection (UserPromptSubmit `additionalContext`)

- The probe hooks only log; none returned `additionalContext`, so injection was not exercised.
- Facts in the logs: hooks supplied through `--settings` fire in `-p` and in the PTY, including UserPromptSubmit (payload keys: `prompt`, `prompt_id`, `permission_mode`, `session_id`, `transcript_path`, `cwd`). Transcript lines carry a `hookAdditionalContext` key, which indicates the host records hook-supplied context per turn.
- The documented hook contract (Claude Code hooks reference, from prior knowledge, not re-fetched in this run) lets UserPromptSubmit return `hookSpecificOutput.additionalContext`. Treat as likely but unverified here.

## Measurements (2026-11-17, Haiku, one run each)

| Measure | Value |
|---|---|
| `-p` turn duration, short prompt | 0.8 to 1.7 s |
| `-p` cost per short turn | about 0.003 to 0.006 USD |
| Interrupt control request to result | 16 ms |
| SIGINT to process exit | 916 ms |
| PTY start to ready text | 0.8 s |
| PTY prompt to Stop hook, plain reply | 1.7 s |
| PTY prompt to Stop hook, MCP tool calls | 5.4 to 6.4 s |
| PTY prompt to Stop hook, skills and connector | 10.6 s |

## Not verified

- Interactive mode with `--bare`.
- OAuth flow for a connector in `needs-auth` state.
- MCP servers needing SSE or server-initiated requests (sampling, elicitation, notifications).
- PTY interrupt and image paste.
- Launching `claude` without `CLAUDE_CONFIG_DIR`.
- UserPromptSubmit `additionalContext` injection (see above).
- Models other than Haiku, longer turns, and concurrent processes.
- Whether `-p` becomes bare by default in a later release.
- Whether the other Atlassian connector entries use the v2 endpoint.
