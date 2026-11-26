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

## Browser design probe PB1 (2026-11-17)

Evidence in `probes/out/pb1_server_names.json`. One `claude -p` run on Haiku, `--strict-mcp-config`, hooks disabled, an empty temporary working directory, budget cap 0.25 USD (cost 0.0035 USD).

| Probe | Result | Short finding |
|---|---|---|
| PB1 MCP server names | pass | One HTTP MCP server registered under the names `browser`, `agide-browser`, `agide_browser`, `claude-in-chrome` and `app`. All but `claude-in-chrome` connected and listed their tools as `mcp__<name>__<tool>`. `claude-in-chrome` was dropped without an error: no `mcp_servers` entry and no tools. Used by 0026 for the server name `agide-browser`. |

New script: `pb1_server_names.mjs`.

## Milestone 3 isolation probes I1 to I3 (2026-11-17)

Details, host changes and latency in `notes/probes-m3-isolation.md`; evidence in `probes/out/p16_*` to `p18_*`. I1 runs the real claude (Haiku, empty temporary directory, `--setting-sources user`, `--strict-mcp-config`); I2 and I3 run the fake claude from `fixtures/fake_claude.sh` because no Linux claude build is available locally. The Keychain check of I1 and the provider placeholder and live policy reload of I3 were manual steps without kept logs. A reviewer re-run of I2 is in `probes/out/m3-review/`.

| Probe | Result | Short finding |
|---|---|---|
| I1 srt | pass | Write outside the allowed directories and a request to a non-allowed domain are denied; an allowed domain works. The real claude runs in a PTY under srt with hooks written to an allowed directory, the Keychain login works, and `mcp_host.mjs` on loopback is reachable. Needs `allowPty`, `allowLocalBinding` and a write allowance for the Claude temp directory. The Keychain stays readable from inside. srt adds about 0.2 s to a start. |
| I2 container | pass (fake claude) | PTY, resize, Ctrl-C, SIGTERM through the docker client, events directory, host MCP through `host.docker.internal` with a bearer token, bind-mount ownership and teardown work. SIGKILL of the docker client leaves the container running. Start 0.2 to 0.35 s. Real claude unverified. |
| I3 OpenShell | pass (fake claude) | Installs from a checksummed release without administrator rights and runs on local images with about 33 MB of OpenShell runtime images. Filesystem and per-binary network policy, host MCP through the policy, PTY through `sandbox exec --tty` and `sandbox connect`, and a credential placeholder work. Create to Ready 1 to 2 s. Real claude and the subscription login not run. |

New scripts: `p16_srt.py`, `p17_container.py`, `p17_container_lib.py`, `p18_openshell.py`, `fixtures/fake_claude.sh`, `fixtures/hook_events.sh`, `hooks/srt_claude.sh`. `mcp_host.mjs` takes `--allow-host` and `--bind`.

## Milestone 3 permission probes P20 to P24 (2026-11-17)

Details in `notes/probes-m3-permissions.md`; evidence in `probes/out/p20_*` to `p24_*`, `ppty_*` and `p_perm_pty_report.json`. `-p` runs used the stdio permission prompt tool so that each prompt is a `can_use_tool` request; TUI runs used the `PermissionRequest` hook as the dialog signal. Same safety settings as above; every case ran in a fresh directory that the script removed. A reviewer re-run of selected cases, with a `strictAllowlist` check, is summarised in `probes/out/m3-review/perm_rerun.json`.

| Probe | Result | Short finding |
|---|---|---|
| P20 ask rules in auto mode | pass | A `permissions.ask` rule from `--settings` still prompts under `--permission-mode auto` for a Bash pattern, an app MCP tool and a claude.ai connector tool, in `-p` and in the TUI. Unmatched calls run without a prompt. The request carries `decision_reason_rule_source: "flagSettings"` or `matched_ask_rule`. |
| P21 PreToolUse hook | pass | Hook allow, deny, ask and `updatedInput` work in both paths. Hook deny and deny rules beat allow; a hook allow does not lift an ask rule; a rewrite applies before the prompt. Exit 2 blocks with stderr to the agent; exit 1 and a timeout hand the decision back to the mode. |
| P22 permission modes | pass | `--permission-mode` accepts `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. `auto` is available for this login. `defaultMode` works in `--settings` and the flag overrides it. The hook payload reports `default` for `manual`, otherwise the mode name. |
| P23 sandbox settings | pass | The sandbox works under `--settings`. A non-allowed host gets a 403 and a `<sandbox_violations>` block; the TUI shows `Sandbox blocked 1 operation`. In auto mode the model can add the host through a per-command `allowed_domains` input; the auto-mode classifier approved it with no prompt, and a `PreToolUse` hook sees the input. `deniedDomains` holds, and `network.strictAllowlist` in `--settings` refuses the per-command list. Manual mode asks through a `SandboxNetworkAccess` request. Plain SSH fails inside the sandbox (no name resolution), git over SSH fails on the unreadable `known_hosts`; https git works for allowed hosts. |
| P24 folder trust | pass | The TUI dialog appears for a directory with no trusted ancestor, `-p` never shows it. `CLAUDE_CODE_SANDBOXED=1` skips it and writes nothing; `--settings` keys and `--dangerously-skip-permissions` do not. Detect by the text `Quick safety check` or no `SessionStart`; Down then Enter answers Yes and stores trust, Enter alone exits. |

### Design effects

1. Auto can be the default with ask rules for outward-facing tools: rules, a `PreToolUse` hook and the network policy are separate layers, and a hook allow never loosens a rule. Bash ask rules need content (`Bash(git push *)`), since the docs say a bare `Bash` ask rule gives way to sandbox auto-allow; a hook that times out or fails lets the call through.
2. `sandbox.network.allowedDomains` does not hold against the agent in auto mode alone. Use `network.strictAllowlist`, `deniedDomains` or a `PreToolUse` hook that checks `allowed_domains`.
3. A host that answers `can_use_tool` also sees `SandboxNetworkAccess` requests in manual mode.
4. For directories the app creates, `CLAUDE_CODE_SANDBOXED=1` on the TUI child avoids the dialog and the stored entry; the variable is undocumented.
5. Payload and init report `manual` as `default`.

New scripts: `p_perm_lib.mjs`, `p20_ask_rules.mjs`, `p21_pretool_hook.mjs`, `p22_modes.mjs`, `p23_sandbox.mjs`, `p23_sandbox_pty.py`, `p24_trust.py`, `p24_print_untrusted.mjs`, `p_perm_pty.py`, `hooks/pretool_decide.py`.

## Milestone 3 browser first-slice checks (2026-11-17)

Script `app/scripts/browser-checks.mjs`, run with the Electron 45.3.3 binary and no visible window (a `BaseWindow` with `show: false`, a local `node:http` page on 127.0.0.1).

| Check | Result | Short finding |
|---|---|---|
| `Page.captureScreenshot` in a view of a hidden window | pass | Returns a PNG while the view is visible in the hidden window. |
| Same after `view.setVisible(false)` | fail | No answer within 5 s. A parked view needs its own hidden window or an on-screen position, not `setVisible(false)`. |
| `capturePage` of a view | pass | Returns the view at device pixel ratio 2 (1600 by 1120 for a 800 by 560 view). |
| `Runtime.evaluate` with `replMode` | pass | A `const` from one call is visible to the next and top-level `await` works. |
| `Accessibility.getFullAXTree` on a view | pass | Roles, names and `backendDOMNodeId` per node. |
| `Overlay.highlightNode` and `highlightRect` on a view | pass | Both accepted and cleared by `hideHighlight` after `DOM.enable` and `Overlay.enable`. |
| `Input.insertText` into a focused input | pass | The value is set. |
| Second `debugger.attach` | throws | "Debugger is already attached to the target". The wrapper keeps one attach per webContents. |
| `navigationHistory.restore` | pass | Two entries restored, the current one loads, back is possible. |
| `Page.navigate` and `will-navigate` | confirmed | CDP navigation fires no `will-navigate`, so the address policy runs in the tool before the call. |
| `web-contents-created` timing | confirmed | Fires while the `WebContentsView` constructor runs, before the module can record the id. The backstop cannot look the contents up in the registry. |
| `capturePage` of the app window with a view child | fail (as expected) | The child view is not in the image. `ui_capture_window` composes view captures itself. |
| `getStoragePath()` of a persistent partition | pass | Lies under `userData`. |

Not run: P16 (how long the CLI keeps an MCP call open with the entry `timeout` set).

## Milestone 4 swarm probes P30 to P37 (2026-11-21)

Claude Code 2.1.330 (earlier probes: 2.1.326). Details in `notes/probes-m4-swarm.md`; evidence in `probes/out/p30_*` to `p37_*`. Haiku, `--max-budget-usd 0.25`, `--setting-sources user`, `--strict-mcp-config` except where P37 compares, fresh directories under `probes/work/` removed afterwards, at most three concurrent processes, subscription login.

| Probe | Result | Short finding |
|---|---|---|
| P30 stream-json agent | pass | Several user turns over one process and session; every turn re-emits `system/init`. `can_use_tool` carries `tool_name`, `display_name`, `input`, `description`, `permission_suggestions`, `tool_use_id`. Allow, deny (message becomes the tool error, listed in `permission_denials`) and a changed `updatedInput` (runs with the host's input, the tool result does not say so) work. An unanswered request stayed pending for 60 s with the process alive and completed after the answer. |
| P31 interrupt | pass | The `interrupt` control request answers with `still_queued` in a few ms and ends the turn with `error_during_execution` (`aborted_streaming` or `aborted_tools`) about 20 ms later; a pending approval gets a `control_cancel_request`. The next user message works in all three cases. SIGINT ends the turn and the process (exit 0). |
| P32 control requests | pass (list), partial (effects) | Accepted under `-p` stream-json: `initialize`, `mcp_status`, `set_permission_mode`, `set_model`, `set_max_thinking_tokens`, `stop_task`, `get_task_output`, `mcp_set_servers`, `mcp_toggle`, `mcp_reconnect`, `get_context_usage`, `get_session_cost`, `get_usage`, `get_status`, `get_settings`, `list_models`, `list_permission_rules`, `get_hooks_listing`, `get_workspace_diff`, `reload_plugins`, `reload_skills`, `side_question`, `end_session` and others. `set_permission_mode` and `stop_task` show their effect; unknown subtypes answer `Unsupported control request subtype`. |
| P33 resume | pass | Session file `<config dir>/projects/<cwd with every character other than a letter or digit as ->/<id>.jsonl`. `--resume` after SIGKILL continues the context, also from another directory, also after a kill during a running tool. `--session-id` on an existing id fails (`already in use`, exit 1). A second live process can resume the same session. |
| P34 concurrency | pass | Three agents with two turns each: all succeeded, init after about 1 s, first turn about 2 s, second under 1 s, no errors. `rate_limit_event` carries `rate_limit_info` with `status`, `rateLimitType`, `resetsAt`, overage fields and `unifiedWindows` (`five_hour`, `seven_day` with `utilization`). `result` carries cumulative `total_cost_usd`, `usage` and `modelUsage`. |
| P35 budgets | pass | `--max-turns` is per user message: `error_max_turns`, process stays alive. `--max-budget-usd` is per process: `error_max_budget_usd` with `terminal_reason: budget_exhausted`, checked after a response (the crossing response is streamed, its `result` is the error with empty text and a cost above the cap); later messages return the same error without a model call. Exit code follows the last result (0 or 1). |
| P36 worktrees | pass | `git worktree add` works as the isolation; the agent's `cwd` is the worktree. Plain `git diff` misses new files; `git add -N .` then `git diff HEAD`, or the `get_workspace_diff` control request, collects them. `git worktree remove` refuses with modified or untracked files, `--force` deletes the edits and keeps the branch; a committed worktree removes cleanly. |
| P37 --bare | pass | Default `-p` is not bare in 2.1.330 (user plugins, skills, connectors load). The docs say `--bare` will become the default later. `--bare -p` returns `Not logged in` with exit 1: it never reads the subscription login. The swarm must not pass `--bare`. A user-settings `defaultMode` (here `auto`) applies to `-p` runs without `--permission-mode`, so the app passes the mode explicitly. |

### Design effects

1. One `claude -p` stream-json process per swarm agent covers multi-turn input, approvals, interrupt, resume, budgets and diff collection from the host side.
2. After an `error_max_*` result the process stays alive, so the app ends or stops feeding the agent itself.
3. Per-agent removal of a worktree needs a commit or a stored patch first.
4. The `rate_limit_event` windows give the swarm view a utilization meter; the payload of a rejected limit is not seen yet.
5. The approval probes ran in manual mode; `can_use_tool` under auto mode, the decided swarm default (0025), is not probed.

Reviewed by a second agent against the logs and the headless, permission-mode and SDK approval docs; P37, P35 `after_budget` and P31 `pending_permission_control` re-ran and reproduced.

New scripts: `p_swarm_lib.mjs`, `p30_stream_agent.mjs`, `p31_interrupt.mjs`, `p32_control_requests.mjs`, `p33_resume.mjs`, `p34_concurrency.mjs`, `p35_budgets.mjs`, `p36_worktrees.mjs`, `p37_bare.mjs`.

## Milestone 5 review probes P40 to P43 (2026-11-21)

Claude Code 2.1.330, git 2.54.0. Details in `notes/probes-m5-review.md`; evidence in `probes/out/p40_*` to `p43_*`. Haiku, `--max-budget-usd 0.25`, `--setting-sources user` and `--strict-mcp-config` except where a probe compares, fresh directories under `/tmp/agide-p-review/` removed afterwards, at most three concurrent processes, subscription login. Every run cost under one cent; the stored logs of the final runs sum to about 0.17 USD.

| Probe | Result | Short finding |
|---|---|---|
| P40 settings isolation | pass (flags), partial (tamper) | `--setting-sources user` drops the project `CLAUDE.md`, skills, `.mcp.json`, hooks and rules; the default launch loads all of them. `--strict-mcp-config` removes every connector and plugin server but leaves `CLAUDE.md` and skills. In an untrusted workspace project `permissions.allow` is ignored (stderr says so) while project deny rules and project hooks apply. A `--settings` file is read at session start: an in-session rewrite did not lift a deny rule (the docs' settings reload does not cover `--settings`). The agent could rewrite the file under `bypassPermissions` in some runs, inside a read-only checkout through `chmod` and outside the working directory through Bash; under `acceptEdits` with the file outside the working directory its attempts were refused, though the one Bash write was chained with the denied `date`. |
| P41 report tool | pass | `--tools Read,Grep,Glob` leaves exactly those tools plus the MCP tool; `--disallowedTools` removes only the named tools; `--allowedTools` alone leaves Bash and the write tools offered but denied under `-p`. Bash with prefix allow rules runs the allowed commands only. The reviewer calls `report_review` once and then writes a prose recap. A schema violation returns `MCP error -32602 ... Input validation error` as a tool error and the model corrects the call. A denied tool, a server that failed at start and a server that dies mid-session all end with `result.subtype: success` and no report, the model falls back to prose. |
| P42 checkpoint and diff | pass | Checkpoint with `-c core.hooksPath=/dev/null -c commit.gpgsign=false -c core.fsmonitor=false`, `--no-verify` and an environment author ignores failing hooks and signing, in a repo and in a worktree. A 20 MB file costs about 0.1 s and 21 MB of diff text; thousands of lines over many files cost about 20 ms. Naive parsing loses quoted names and the names of binary, empty and mode-only files; a type change appears as two entries; header-like content lines need hunk-count parsing. `git diff -z --raw` gives unquoted names. A clean filter, an external diff, the fsmonitor program, a hook and textconv run from agent-controlled `.gitattributes` and config unless switched off: `--no-ext-diff --no-textconv`, the `-c` overrides, and `--attr-source` or blanked `filter.*` names for clean filters. |
| P43 injection and anchoring | pass (small sample) | Over repeated runs no injection changed a verdict in the direction it asked: a hidden bug was still reported as blocker or major, the demanded reject and invented finding did not appear, the canary file was never read. The injection text was reported as a finding and moved a correct diff to revise. No finding named a file outside the diff; in the final run every finding sat on an added line. |

### Design effects

1. The reviewer launch is `--setting-sources user --strict-mcp-config --mcp-config <app file> --tools Read,Grep,Glob --allowedTools <report tool> --permission-mode default` with the app's `--settings` file outside the checkout.
2. A missing or invalid report is the failure signal; the result subtype is not.
3. Checkpoint and diff commands need the override set and a clean-filter measure; the diff file list comes from `-z --raw`, the body from a hunk-count parser.

Reviewed by a second agent against the logs and the CLI reference, settings and permissions docs; P42, P41 and the P40 project-rule cases re-ran one process at a time and reproduced.

New scripts: `p_review_lib.mjs`, `p40_settings_isolation.mjs`, `p41_report_tool.mjs`, `p42_diff_parse.mjs`, `p42_checkpoint_diff.mjs`, `p43_injection_anchoring.mjs`.

## Milestone 6 credential-proxy probes P44 (2026-11-22)

srt 0.0.83 (`srt --version`), macOS, Node 22.22.3 and Electron 45.3.3 as Node, npm 10.9.8, pnpm 11.21.0, cargo 1.99.0, Gradle 9.5.1, Maven 3.9.16, uv 0.11.17. Details in `notes/probes-m6-credential-proxy.md`; evidence in `probes/out/p44_*` (calibrate, `p44_tool_<tool>_<mech>`, `p44_safety_<group>`, `p44_embed_*`). A local HTTPS test registry (npm, Maven, Cargo sparse, PyPI layouts, `/echo`) with a throwaway CA and random per-run secrets; no real credential was read; no model was started. Mechanism A is the srt `credentials.envVars` mask (CLI settings file), A2 is A with a prebuilt Authorization header, B is an own placeholder swapped by `network.filterRequest` with `SandboxManager` as a library.

| Probe | Result | Short finding |
|---|---|---|
| P44.0 setup and srt rules | pass | `*.localhost` names need no loopback entry, but srt sets `NO_PROXY=localhost,...` and curl skips the proxy for every such name (cleared in the probes). `tlsTerminate.extraCaCertPaths` only extends the sandbox-side bundle; the proxy verifies the upstream with Node's roots plus `NODE_EXTRA_CA_CERTS` (or `tls.setDefaultCACertificates`). `~` in srt paths follows the HOME of the srt process. |
| P44.1 tool by mechanism | partial | npm, pnpm, cargo: A and B pass. Gradle, Maven, uv: A fails (Basic header, the sentinel sits inside base64, 401); B passes; A2 (whole Basic blob masked) passes for Gradle and Maven. Trust: Node and cargo take srt's variables; JVM tools need a truststore built from `$SSL_CERT_FILE`; Gradle needs `allowLocalBinding`; Maven needs a `<proxies>` entry (the Java agent is not enough). No tool validated the placeholder shape; npm (`#`, `;`, `${}`) and cargo (`"`) fail only on config syntax. |
| P44.2 secret not readable in the sandbox | fail for A through the plain CLI, pass for B | `ps` is refused, but `sysctl(KERN_PROCARGS2)` returns the arguments and the exec-time environment of all same-user processes (not of Apple platform binaries), and `proc_pidinfo` the working directory and open files: the real secret was read from the srt process environment (A, CLI). No Seatbelt rule tried blocks the arguments and environment, and srt 0.0.83 has no setting that adds a rule. Not found when the secret is set into `process.env` at run time (A through the library, A through a CLI wrapper) and in B. Files, temp, caches and verbose tool logs: no hit. The proxy CA key in the srt temp directory is readable. |
| P44.3 non-inject host | pass | Only the placeholder arrives at other hosts, subdomains and the IP literal; host spellings are canonicalized. A with `injectHosts` omitted substitutes at every allowed host. |
| P44.4 echo endpoint | fail | The reflected header and the body return the real value to the sandbox in A and B. `stripResponseHeaders` removes headers only; `onResponse` sees status and headers, no body, and cannot change anything. Path and method scoping in the filter (B) stops it for other paths and for writes; nothing stops a body reflection on an allowed path. |
| P44.5 plaintext | pass | Placeholder or sentinel only by default; a filter that sets headers on plain HTTP gets `403`; the plaintext opt-ins send the real value in cleartext. |
| P44.6 opaque tunnels, host match | pass | `refuseOpaqueTunnels` refuses CONNECT to excluded hosts, SOCKS and non-TLS CONNECT; `requireHostMatch` answers `421` or breaks the minted certificate. Without them these paths carry the placeholder only. |
| P44.7 other routes | partial | Query and path are not substituted; A substitutes bodies and any header, B only what the filter sets; redirects across hosts keep the placeholder; `TRACE` is forwarded by A and refused (`405`) with `filterRequest`; credential gating per host works in A; the credential is usable for writes (B can limit methods). |
| P44.8 derived values and logs | pass | An HMAC over the placeholder is not repaired; verbose npm, cargo, Gradle and Maven logs show neither placeholder nor secret. |
| P44.9 library embedding | pass | `initialize` about 60 to 90 ms, `wrapWithSandbox` about 7 ms, `reset` about 2 ms; one TCP listener per initialize, no descriptor growth over repeated rounds; works under Electron's Node. After any host exit the listener is gone, sandboxed children keep running without a proxy, and SIGKILL leaves the CA directory (with `ca.key`) in the temp directory. The library appends `<sandbox_violations>` to stderr with a `commandId`; the CLI does not. |
| P44.10 cost | pass | CLI adds about 0.2 to 0.3 s per command; the library adds little after one initialize (tool times in the notes). |

### Design effects

1. Use mechanism B (library with `filterRequest`) for the first slice: it covers Basic, keeps the real value out of every environment and argument list, and scopes substitution by host, path and method.
2. Never put a real secret into the environment or arguments of any process, and start the app's host with a clean environment; the macOS profile lets sandboxed code read arguments and environment of all processes of the user (not of Apple platform binaries), nothing tried blocks it, and tokens exported in a shell or an editor are exposed the same way.
3. Always set explicit hosts, keep TLS-only, `refuseOpaqueTunnels`, `requireHostMatch` and plaintext opt-ins off, and give the app its own CA outside the readable area.
4. Tools that sign or digest the credential, mTLS registries and token-exchange flows stay `not_run` with a reason.

Not run: pip, go, git over HTTPS, Docker, uv with a header option, `credentials.sigv4`, a real Electron main process, Linux and Windows, real remote registries (see the notes).

New scripts: `p_cred_lib.mjs`, `p44_calibrate.mjs`, `p44_tools.mjs`, `p44_safety.mjs`, `p44_embed.mjs`.

## Milestone 6 notes and mounts probes P50 to P53 (2026-11-26)

macOS (APFS, case-insensitive), Node 22.22.3 and Electron 45.3.3 (as Node for every probe, as a main process for P50). Details in `notes/probes-m6-notes.md`; evidence in `probes/out/p50_*` to `p53_*`. No model was started; directories under `/tmp/agide-notes-design/`, removed by each probe. P45 to P49 are left to the R21 design run of the same day.

| Probe | Result | Short finding |
|---|---|---|
| P50 watch events | pass with limits | One recursive `fs.watch` reports create, change, atomic saves (the temporary name too), renames (old and new name, unpaired), moves in and out, `chmod`, `utimes`, hidden files and every file of a 300-file burst, about 10 ms after the call. The event type is unusable (`rename` for appends in Node; `change` or `rename` in the Electron main process). Links are not followed: changes behind a link to the outside give no event. A moved or removed root gives one event with the root's own name; a directory recreated at the path is watched again. A watcher on a single file goes silent after the first atomic save; a watcher on its parent keeps working. |
| P51 watch scale | pass with limits | At 20000 files in 200 directories: full listing 26 to 44 ms, `lstat` of all 57 to 86 ms, watcher setup about 1 ms, no extra descriptors or memory, no idle CPU. A burst of 2000 appends to 2000 files delivered between 1910 and 2000 events (up to about 4.5 % lost in Electron as Node); 5000 new files lost nothing. Review reruns: 2000, 2000 (Node) and 1997, 2000 (Electron as Node). |
| P52 paths | pass | `realpathSync.native` gives the real root (`/tmp` is `/private/tmp`) and the spelling on disk; containment of the real path refuses links out, chains, dangling links and `/dev/zero`; FIFOs need a type check; hard links cannot be told apart except by `nlink`. `O_NOFOLLOW` checks only the last component; an open followed by `fstat`, a second resolve and a device and inode comparison catches a parent swapped for a link (a review check confirmed it with the swap between the resolve and the open). A temporary file with `O_EXCL` and `O_NOFOLLOW` plus `rename` replaces a link in the last component and leaves its target unchanged; a parent swapped for a link before the `rename` sends the write outside (review check). Reading 50 MB takes about 0.1 s. |
| P53 FTS5 | pass | `node:sqlite` in Node 22 and Electron 45 has FTS5 with `unicode61` (diacritics folded: `ohtu` finds `õhtu`) and `trigram`; 2000 notes of 2.3 KB index in about 0.1 s and queries with `bm25` and `snippet` take under 7 ms; an unbalanced quote in user text is a syntax error, quoting each word avoids it. |

### Design effects

1. One recursive watcher per mounted directory in the main process; ignore the event type; debounce, list the named parent directories again and reconcile on focus, wake and a timer, since bursts lose events.
2. Watch a mounted file or a file note through its parent directory; check the root's device and inode after a root event.
3. Read through the checked open, write through a temporary file and `rename`, key paths by `realpathSync.native`.
4. Search notes with FTS5 `unicode61 remove_diacritics 2` and quote user text word by word.

Not run: network and cloud volumes, the Electron main process at 20000 files, other editors' save patterns, FTS at 20000 notes.

New scripts: `p_notes_lib.mjs`, `p50_watch_events.mjs`, `p51_watch_scale.mjs`, `p52_paths.mjs`, `p53_sqlite_fts.mjs`.

## Check follow-up probes P54 to P56 (2026-11-26)

macOS (APFS), Node 22.22.3, vitest 5.1.0 (the app's own), cargo 1.99.0, cargo-nextest 0.9.149, Gradle 9.5.1 offline with JUnit Jupiter 6.1.3. Details in `notes/probes-checks-design.md`; evidence in `probes/out/p54_*` to `p56_*`. No model was started and nothing was downloaded (fast-xml-parser came from the local npm cache); directories under `/tmp/agide-checks-design/`, left for the coordinator to remove (the permission system denied the removal). P45 to P49 stay with the R21 run. An independent review reran P55 on the same day with the same outcomes.

| Probe | Result | Short finding |
|---|---|---|
| P54 report samples | pass with limits | Real JUnit from vitest (one suite per file, `<describe> > <test>` names, `todo` as skipped, BEL dropped from names), nextest (one suite per test binary, a thread id in each failure message, ignored tests absent from the report) and Gradle (one file per class, every exception as `<failure>`, BEL as U+FFFD, `hostname` in each suite); real libtest text from `cargo test`. A failing test's printed `test <name> ... ok` lands in its `failures:` section and a line reader counts it; with `--nocapture` it lands inside the list. pytest, Maven surefire and jest were not available offline: their formats are from the documentation. |
| P55 XML parsers | pass for saxes with limits around it | saxes 6.0.0 (in the lockfile through jsdom) expanded no entity, read no external file, streamed 200 MB in 1.8 s at 84 MB, and has no depth or attribute limit of its own. fast-xml-parser 5.11.2 left entities as literal text, refused the external entity and deep nesting, and took about 1.8 GB for 200 MB (a tree from one string). The prototype subset reader refused every hostile case and also a valid raw `>` in an attribute. |
| P56 zero tests | pass | Exit 0 with nothing executed: cargo test (no tests, a filter that matches nothing, every test ignored), vitest with a filter that matches nothing or every test skipped, Gradle without test sources or with every test disabled. Non-zero: vitest without test files (1), nextest (4), Gradle with test sources and no tests (`failOnNoDiscoveredTests`) or an unmatched `--tests` filter (1). |

### Design effects

1. Count executed tests as passed plus failed; a check that exits 0 with none is a case to catch, from reports or libtest blocks only.
2. Read libtest only as blocks (`running N tests`, N case lines, the result line) and refuse a block whose counts disagree.
3. Key a test by suite and name; leave messages, times and thread ids out.
4. Parse JUnit with saxes behind a handler with byte, depth, attribute and case limits that refuses a DOCTYPE.

Not run: pytest, Maven surefire and jest; saxes in the Electron main process; report reading under `srt`.

New scripts: `p_checks_lib.mjs`, `p54_report_samples.mjs`, `p55_xml_parsers.mjs`, `p56_zero_tests.mjs`.

## Milestone 6 R21 probes P16 and P45 (2026-11-26)

`claude --version` reports 2.1.332. Haiku, empty temporary directories under `/tmp/agide-r21-probes/`, `--setting-sources user`, `--strict-mcp-config`. Details, tables and the design reading are in `notes/probes-m6-r21.md`; evidence in `probes/out/p16_mcp_report.json`, `p16_pty_report_*.json`, `p45_report.json`, `p45_pty_report_*.json` and the per-case server logs. P16 was open since milestone 3; the old `p16_srt.py` is an isolation probe whose file name predates the ids.

| Probe | Result | Short finding |
|---|---|---|
| P16 MCP call duration, `-p` | pass | Without an entry `timeout` a silent JSON reply dies at 60 s (`The operation timed out.`); with `timeout` 600000 or `MCP_TOOL_TIMEOUT=600000` calls of 65, 130 and 310 s completed. An SSE reply that sends its first byte at once is outside the 60 s timer and lives until the idle window of 300 s; progress notifications every 60 s kept a 330 s call alive. The entry `timeout` is a hard wall-clock limit (aborted at 100 s with progress every 20 s). A `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` of 15000 ms aborted at 30 s. The model sees the error text of each case. |
| P16 what the server sees | pass | The request carries `_meta.progressToken` (the request id) and `_meta["claudecode/toolUseId"]`. An interrupt (control request in `-p`, Esc in the TUI) and a wall-clock timeout send `notifications/cancelled`; the CLI does not close the HTTP request on interrupt, wall-clock or idle abort. The idle abort sends nothing. The 60 s request timer closes the connection with no notification. |
| P16 PTY | pass | Same 60 s abort and idle abort. A main-conversation call still running after 120 s moves to a background task: `PostToolUse` at 120 s with a "moved to the background" result, `Stop`, then a `<task-notification>` turn with the answer. `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` keeps the call in the foreground (150 s). `-p` never backgrounds. Esc ends the call with the standard rejection text and no hook. A line feed in typed text and a bracketed paste both keep a two-line prompt in one submission. |
| P45 http hook payloads and answers | pass | `PermissionRequest`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `UserPromptSubmit` and (TUI) `SessionEnd` post the command hook's JSON; allow and deny work through `hookSpecificOutput` for `PermissionRequest` (with `message`, `interrupt`) and `PreToolUse`; `additionalContext` in a `UserPromptSubmit` reply reaches the model in both paths. A `SessionStart` http hook posted nothing. |
| P45 failure and holds | pass | Receiver down, 500, non-JSON body, schema-invalid body and a slow receiver are non-blocking errors (the call goes on to the normal permission flow); `onFailure: "block"` blocks, and denies a `PermissionRequest`. A request was held for 330 s in `-p` and 150 s in the TUI. Esc in the TUI closes the held request; Enter does not (the request stays open and a late answer is ignored); the hook `timeout` closes it and the dialog stays; an empty reply leaves the dialog in charge. |
| P45 headers and sandbox | partial | `Authorization: Bearer $VAR` with `allowedEnvVars` works (unlisted variables become empty), no argument list held the value, a literal value in a settings file passed by path works, and the agent's Bash command can print the variable. Under srt the hook needs `allowLocalBinding`; under the CLI's own sandbox setting the hook's request is gated by the sandbox network rules (403 and a `SandboxNetworkAccess` request), contrary to the documentation that hooks run outside the sandbox. One run per case. |

Differences from the documentation: hooks and the sandbox (above), the 30 s idle floor for a 15 s setting, the notification and connection behavior on abort (above), and the silent `SessionStart` http hook. The documentation matches on the 60 s request timer, the wall-clock limit that progress does not extend, the 2 minute background move, header interpolation and the non-blocking failure rules.

Not run: the 600 s default hook timeout to its end, holds beyond 330 s, `SessionEnd` in `-p`, HTTPS and non-loopback receivers, redirects, Linux and container providers, an entry `timeout` above 600000, an SSE reply with progress in the TUI, whether the CLI closes open requests on exit.

New scripts: `p16_slow_mcp.mjs`, `p16_mcp_timeout.mjs`, `p16_mcp_timeout_pty.py`, `p45_hook_server.mjs`, `p45_http_hook.mjs`, `p45_http_hook_pty.py`.

## Adaptive mount watching probe P57 (2026-11-26)

macOS (APFS), Node 22.22.3 twice and Electron 45.3.3 as Node once. Details and the script in `notes/probes-m6-notes.md` (section P57); the evidence files were not kept. No model was started; the script and its directories lived under `/tmp/agide-amend/`; the script removed its trees, and the directory is left for the coordinator to remove (the permission system denied the removal). Run by `decisions-amend` for the adaptive watcher of 0044 section 4.8.

| Probe | Result | Short finding |
|---|---|---|
| P57 watch tiers | pass | A single change reaches a recursive watcher after about 13 ms (median; 95th percentile 13 to 23 ms) at every size from 200 to 20,000 files; a burst of 100 new files is named within 54 to 65 ms. A full walk (`readdir` with types and `lstat`) costs 2 to 3 ms at 1,000 entries and 52 to 57 ms at 20,000; the entry count 3 to 4 ms and 71 to 79 ms; the re-list of one directory of 100 about 0.2 ms. No event was lost. |

### Design effects

1. Mounts of up to about 1,000 entries: a 30 ms debounce, at most 150 ms per batch, and a full walk every 30 s.
2. Larger mounts: a 250 ms debounce, at most 2 s per batch, a re-list of the cached directories every 5 minutes and a full walk every 30 minutes.

Not run: the Electron main process with a renderer, network and cloud volumes, bursts large enough to lose events at the 30 ms debounce.

New scripts: none in `probes/` (the script is in the notes).
