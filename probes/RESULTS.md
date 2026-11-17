# Probe results (Phase 0, base-independent)

Date: 2026-11-17. Claude Code: `claude --version` reports 2.1.326, and `system/init` reports `claude_code_version` 2.1.326. Model for all probe calls: Haiku (`--model haiku`, resolves to `claude-haiku-5-5`). Full details, measurements and caveats are in `notes/probes.md`. Raw event logs are in `probes/out/`.

Every probe ran `claude` with the working directory `probes/work` (empty), `--setting-sources user`, and `--strict-mcp-config` except where a connector was tested. `-p` runs also passed `--max-budget-usd 0.25` and, unless the probe tested hooks, `--settings '{"disableAllHooks":true}'`.

## Outcome

The stop rule in `docs/spike-plan.md` does not trigger. Both launch paths, `-p` stream-json (P1) and the interactive TUI in a PTY (P1b), load user skills and marketplace plugins (P2), reach the claude.ai Atlassian connector (P2), and drive an app-hosted HTTP MCP server (P3).

| Probe | Result | Short finding |
|---|---|---|
| P1 stream-json | pass | Multi-turn over one process, `--session-id`, `--resume`, `--fork-session`, images, cost and usage in `result`, and the `control_request` interrupt all work. SIGINT ends the turn and the process. |
| P1c permissions | pass | `-p` denies approval-needing calls without a host. `--permission-prompt-tool` (an MCP tool, or `stdio` control messages), a `PermissionRequest` hook, `--permission-prompts none` and `mcp__app__*` allow rules all behave as the plan expects. |
| P1b PTY | pass | Turn completion is observable through the `Stop` hook (with `last_assistant_message`) and the transcript JSONL. No streaming deltas and no cost field in this mode. |
| P3 app MCP | pass | `"type":"http"` works in `-p` and in the PTY. A missing `type` is reported in `mcp_server_errors` (`url_missing_type`). A wrong token yields `status: failed`. Tool errors reach the agent. |
| P2 reuse | pass | User skills, plugin skills and the Atlassian connector work in `-p` and in the PTY. `--strict-mcp-config` excludes claude.ai connectors, plugin MCP servers and user MCP servers, and leaves skills and plugins loaded. `--bare` cannot use the subscription login. |

## Findings that change design

1. `--bare` fails with "Not logged in" under the subscription login (exit code 1). If `-p` turns bare by default in a later release, the `-p` launch path stops working with a subscription. Interactive mode with `--bare` was not tested.
2. The `can_use_tool` control request over stdio (`--permission-prompt-tool stdio`) carries `tool_name`, `input`, `tool_use_id`, `permission_suggestions` and, for MCP tools, `mcp_server`. This is the natural approval surface for a GUI in stream-json mode. `--permission-prompt-tool` is absent from `claude --help` (it appears only inside the `--permission-prompts` description) but works.
3. A `PermissionRequest` hook supplied through `--settings` answers permission requests in both `-p` and PTY mode, so one approval implementation can serve both launch paths.
4. User settings apply under `--setting-sources user`. This user's `defaultMode` is `auto`, so `-p` without `--permission-mode manual` ran the Write tool without a prompt. An app needs to set the permission mode explicitly.
5. MCP tools of the app server are deferred behind `ToolSearch` in the model's tool list. The agent found and called them without extra instructions, with one additional tool call.
6. claude.ai connectors are absent from the first `system/init` of a process and appear in later ones (`mcp_servers` and `tools`). The `mcp_status` control request lists them with status and tool count. An app that needs the connector list reads `mcp_status`, not the first init.
7. The Atlassian connector carries a deprecation notice in its MCP server instructions (text below). It does not appear in the tool result.
8. Inherited environment: the probes run inside another Claude Code session, whose injected variables (`CLAUDECODE`, `CLAUDE_CODE_*` and similar) the scripts remove. `CLAUDE_CONFIG_DIR` is kept because it selects the login. In this environment transcripts live under `$CLAUDE_CONFIG_DIR/projects/<cwd with / replaced by ->/<session_id>.jsonl`, not under `~/.claude/projects`.

## Atlassian connector notice

The notice reaches the agent through the connector's server instructions. Text as given in those instructions. In the `-p` run and the PTY run the model quoted parts of it back:

> This server is running on the deprecated /v1/mcp endpoint which will be removed on 2027-03-01. After the first tool call you make to Atlassian MCP in this session, you must tell the user: Your Atlassian connection is using a deprecated V1 endpoint. If you use the official Atlassian connector, remove it and add it again from Claude's connector directory. If you configured a custom connector, update or recreate it using https://mcp.atlassian.com/v2/mcp, then authorize the connection. If your organization manages the connector, ask your admin to make the change.

The `claude.ai Atlassian` connector (status `connected`) was used for the read-only call (`atlassianUserInfo`): success in `-p` and in the PTY, with no content recorded. Separate `claude.ai Atlassian MCP` and `claude.ai Atlassian Rovo` entries exist with status `needs-auth`; whether they use the v2 endpoint was not tested.

## Scripts

All scripts start with a README line. Run them from `probes/` with `node` (Node ESM, no dependencies) or `python3` (standard library only). They call the real `claude` and the user's login, so each run spends a small amount of subscription budget.

| Script | Purpose |
|---|---|
| `lib.mjs`, `pty_lib.py` | Shared helpers (spawn, NDJSON parsing, environment scrub, PTY driver). |
| `smoke.mjs` | One stream-json turn. |
| `p1_stream.mjs [multi\|session\|image\|init\|interrupt\|all]` | P1. |
| `p1c_permissions.mjs [step ...]` | P1c. |
| `mcp_host.mjs` | Localhost Streamable HTTP MCP server (bearer token, Origin and Host checks); `--serve` runs it standalone. |
| `mcp_selftest.mjs` | Checks `mcp_host.mjs` without `claude`. |
| `p3_mcp.mjs` | P3 in `-p` mode. |
| `p1b_pty.py [basic\|mcp\|perm_hook\|perm_screen]` | P1b and P3 in PTY mode. |
| `p2_reuse.mjs [listing\|skills\|connector\|status\|bare\|all]` | P2 in `-p` mode. |
| `p2_pty.py` | P2 in PTY mode. |
| `hooks/log_hook.py`, `hooks/perm_hook.py` | Hook helpers. |
| `mkimg.py` | Writes `fixtures/halves.png`. |
| `pty_explore.py` | Prints the TUI startup screen. |

## Not verified

See the final section of `notes/probes.md`. The main gaps: interactive mode with `--bare`, the OAuth flow for a connector in `needs-auth` state, an MCP server that needs SSE or server-initiated requests, PTY interrupt and image paste, and behavior when the app launches `claude` without `CLAUDE_CONFIG_DIR`.

## Stage 2 probes P6 to P10 (2026-11-17)

Details in `notes/probes-stage2.md`; evidence in `probes/out/p6_*` to `p10_*` and `p9b_*`. Same safety settings as above, plus a PTY helper `stage2_lib.py`. Fixture checkouts and temporary directories were created under `probes/work/` and removed.

| Probe | Result | Short finding |
|---|---|---|
| P6 PTY permissions | pass | The `PermissionRequest` hook fires for Bash, Edit and an MCP tool in the TUI. Deny blocks the call, the deny message reaches the agent as an error tool result, and the dialog closes without a keypress once the hook answers (corrected by P14; the raw logs show the dialog while the hook runs). The payload has no `tool_use_id` (the `PreToolUse` payload has it). |
| P7 PTY sessions | pass | `--session-id` sets the id and the transcript name. `--resume` keeps id and file. `--fork-session` makes a new id and file with history. A reused id and `--resume` with `--session-id` but no fork exit with an error. |
| P8 additionalContext | pass | Injected context reaches the model in `-p` and in the PTY, from a JSON field or plain stdout. Above 10,000 characters the model gets a preview of about 2,000 characters and a file note. |
| P9 setting sources | pass | In `-p` and in the PTY, `--setting-sources user` skips the project `.mcp.json`, hooks and `CLAUDE.md` and keeps connectors and user MCP servers. `--strict-mcp-config` drops connectors and user servers (controlled comparison), keeping only built-in `claude-in-chrome`. |
| P10 PTY interrupt | pass | Esc and Ctrl-C stop the turn and the session continues. No hook fires; the transcript gets an interrupt line. SIGINT ends the process with `SessionEnd`. |

### Design effects

1. PR tasks and the reviewer launch can use `--setting-sources user` without `--strict-mcp-config` in both paths: no repo hooks, no repo servers, connectors kept. The repo `CLAUDE.md` is skipped too, so the app supplies repo guidance itself. This replaces the interim rule that PR tasks run with `--strict-mcp-config` and no connectors.
2. One approval implementation through the `PermissionRequest` hook serves the TUI too: deny and allow work for built-in and MCP tools. Correlate the request with its `PreToolUse` by order and `tool_input`, since the request carries no `tool_use_id`.
3. The app picks session ids for PTY sessions (`--session-id`), resumes them and forks them with a chosen id (`--resume --fork-session --session-id`).
4. `additionalContext` is a usable per-turn channel under 10,000 characters.
5. The PTY turn state machine treats an interrupt as its own end state, read from the transcript, because no hook reports it.
6. The first `system/init` is not a reliable server list; `mcp_status` is (the earlier note that the first init never lists connectors does not hold: its content varies between runs).
7. User-scope MCP servers from the login's `.claude.json` stay under `--setting-sources user`; only `--strict-mcp-config` removes them.

### Remaining gaps

PTY approval in the other permission modes and for subagents; `updatedInput`; folder-trust dialog with an untrusted checkout; image paste; interrupt during an approval dialog; models other than Haiku. The scripts are listed in `notes/probes-stage2.md`.

New scripts: `stage2_lib.py`, `p6_pty_permissions.py`, `p7_pty_sessions.py`, `p8_additional_context.py`, `p9_setting_sources_p.mjs`, `p9_setting_sources_pty.py`, `p9b_strict_compare.mjs`, `p10_pty_interrupt.py`, `make_checkout.py`, `fixtures/proj_mcp_server.mjs`, `hooks/perm_policy.py`, `hooks/ctx_hook.py`, `hooks/marker_hook.py`.

## Milestone 2 probes P11 to P15 (2026-11-17)

Details in `notes/probes-m2.md`; evidence in `probes/out/p11_*` to `p15_*`, reviewer re-runs in `probes/out/m2-review/`. Same safety settings as above, except that the PTY runs have no budget cap (`--max-budget-usd` only works with `--print`). New helper `m2_lib.py` answers the folder-trust dialog, which fresh directories under `probes/work/` raised in these runs; the prompt typed into that dialog exits the session.

| Probe | Result | Short finding |
|---|---|---|
| P11 Notification hook | pass | `notification_type` distinguishes `permission_prompt`, `idle_prompt`, `elicitation_dialog` and `elicitation_response`. The permission and elicitation types fire about 6 s after the dialog opens, the idle type about 59 s after `Stop`. The payload has `message` and `notification_type`, no tool fields. |
| P12 status line | partial | The `--settings` status line command gets JSON with cost, context window (latest request only), prompt cache and `rate_limits` (`five_hour`, `seven_day`, `used_percentage`, `resets_at`). The cost includes subagent requests (inferred from totals in P13). It fires at start and during turns, and every `refreshInterval` seconds when set; a refresh repeats the last rate-limit values. It overrides a project status line. Atomic per-session file writes held under concurrency. A user-level status line was not available to test. |
| P13 transcript usage | pass | Per assistant line `usage` with separate cache creation (5 m and 1 h) and cache read fields. One API message spans several lines with the same id and usage: count each `message.id` once. Subagents write their own files under `<session>/subagents/`. Internal agents leave no file, so the process total comes from the `cost-state` rows written at exit. Background subagents end the main turn with `Stop` before their results return as `<task-notification>` prompts. |
| P14 waiting PermissionRequest hook | pass | The dialog shows while the hook waits. A keypress during the wait answers the request and beats the hook (Esc kills the hook). A hook `timeout` hands the decision back to the dialog. Corrects the P6 statement that no dialog shows. |
| P15 Elicitation | pass | The `Elicitation` hook fires with `mcp_server_name`, `message`, `mode`, `requested_schema`; a hook answer with `action` and `content` reaches the server with no dialog. The test used a stdio server because `mcp_host.mjs` has no server-initiated requests. |

New scripts: `m2_lib.py`, `p11_notification_hook.py`, `p12_statusline.py`, `p13_transcript_usage.py`, `p14_waiting_permission_hook.py`, `p15_elicitation.py`, `fixtures/elicit_mcp_server.mjs`, `hooks/statusline_capture.py`, `hooks/perm_wait.py`, `hooks/elicit_answer.py`.
