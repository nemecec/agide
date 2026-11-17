# 0004 Claude launch path and reuse of Claude features

Status: proposed
Date: 2026-11-17
Inputs: `probes/RESULTS.md`, `notes/probes.md`, `probes/out/p5_*` and `notes/swarm-visibility.md` (P5, which those summary files do not cover), the probe review in this run (not stored on disk), `notes/surfaces-and-browser.md` (hook and MCP limits from the Claude Code docs), the Claude Code headless and permissions docs and the Atlassian support pages named below (read on 2026-11-17)

## Context

Decision 0001 requires the unmodified `claude` CLI (2.1.326) under the user's own login, with no Agent SDK and no handling of claude.ai credentials. The tool needs a launch path that keeps skills, plugins, the marketplace and claude.ai connectors (R7), lets the app host an MCP server the agent calls (R8, R14), gives the app an approval surface, and exposes enough events for status, subagents (R16) and observation delivery (R13).

The Phase 0 probes ran both candidate launch paths on the real account with Haiku and a budget cap per call:

- `-p` with `--input-format stream-json --output-format stream-json` (P1, P1c, P2, P3, P5).
- The interactive TUI in a pseudo-terminal (P1b, P2, P3).

An independent review checked the probe report against the logs and re-ran parts of P2 and P3. The output of the P2 re-run is not stored in `probes/out/`.

### What the probes show

| Topic | `-p` stream-json | Interactive TUI in a PTY |
|---|---|---|
| Multi-turn, `--session-id`, `--resume`, `--fork-session` | works | not tested: no PTY probe passes `--session-id`, `--resume` or `--fork-session`; the session id comes from the hook payloads |
| Image input | content blocks work | image paste not tested |
| Interrupt | `control_request` interrupt ends the turn and the process survives; SIGINT ends the process | not tested |
| Turn completion and status | `result` event with cost and usage; partial-message `stream_event` lines with `--include-partial-messages` | `Stop` hook with `last_assistant_message`, transcript JSONL; no deltas, no cost field |
| Subagents (P5) | `system/task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`; subagent tool calls carry `parent_tool_use_id`; a subagent's approval request reaches the host as `can_use_tool` and the host's deny reaches the subagent | `SubagentStart` and `SubagentStop` hooks from `--settings` fire with an agent id (`p5_pty_report.json`); the run logged a `SubagentStop` after `Stop` with no matching start, not explained; `Stop` payload carries `background_tasks` and `session_crons`; PTY subagent approval not tested |
| Approval | `--permission-prompt-tool stdio` (`can_use_tool` with `tool_name`, `input`, `tool_use_id`, `permission_suggestions`, `mcp_server`); `PermissionRequest` hook from `--settings` answers allow and deny for Write and MCP tools | `PermissionRequest` hook from `--settings` answered allow for an MCP tool; deny and built-in tools not exercised |
| App-hosted MCP (`"type":"http"`, bearer token) | works; missing `type` gives `url_missing_type`; wrong token gives `failed` | works |
| User skills, plugin skills | work | work |
| claude.ai Atlassian connector | works (read-only call) | works (read-only call) |
| `--strict-mcp-config` | drops plugin MCP servers and user MCP servers (`p2_report_listing.json`) and claude.ai connectors (later init of runs with the flag, compared with the later init of the run without it; see below); keeps skills and plugins | not checked in the PTY; assumed the same |
| `--bare` | fails with "Not logged in" under the subscription login | not tested |

Details that shape the design:

- Permission mode. User settings apply under `--setting-sources user`. This user's `defaultMode` is `auto`, and a `-p` run without `--permission-mode` ran Write without a prompt. No control run isolates the cause. The headless docs say a `-p` run starts in Manual mode when nothing sets a mode (2.1.302 and later), and the init events of the `-p` probes that passed no mode report `permissionMode: auto`, so the user setting is the likely cause. The fix is the same in either case: the app sets the mode on every launch.
- Tool and connector list. The first `system/init` has no claude.ai connectors and no claude.ai tools. A later init has them, and the `mcp_status` control request returns each server with status and tool count. `probes/out/p2_report_listing.json` shows that `--strict-mcp-config` drops plugin and user MCP servers. For claude.ai connectors that file compares only the first init, which lists no connectors with or without the flag, so it proves nothing for them. The stored evidence that the flag drops connectors is indirect: `p1_multi.jsonl`, `p1_interrupt_ctl.jsonl`, `p5_background.jsonl` and `p5_workflow.jsonl` ran with the flag, and their later init lists no MCP servers and no claude.ai tools, while the later init of the run without the flag (`p2_report_status.json`) lists the connectors and their tools. Those runs differ in prompt and timing, so this is not a controlled comparison. The reviewer's re-run looked at both inits and `mcp_status` with and without the flag and found the same; its output is not stored in `probes/out/`. A code comment in Nimbalyst states the same effect (`notes/triage-nimbalyst.md`). `probes/RESULTS.md` and `notes/probes.md` state the connector result without this limit.
- App MCP tools are deferred behind `ToolSearch`. The agent found and called them with one extra tool call and no instructions.
- Reserved MCP server names (Claude Code MCP docs, re-read on 2026-11-17): `workspace`, `claude-in-chrome`, `computer-use`, `Claude Preview`, `Claude Browser`. The docs introduce the list with "including", so it may be longer. Claude Code skips a configured server with such a name and shows a warning. The app server needs another name.
- Environment. `CLAUDE_CONFIG_DIR` selects the login in this environment, and transcripts live under `$CLAUDE_CONFIG_DIR/projects/<cwd with / replaced by ->/<session_id>.jsonl`. Variables injected by a parent Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*`) must be removed before launch. A launch without `CLAUDE_CONFIG_DIR` was not tested.
- Hook context. Hooks supplied through `--settings` fire in both paths. The hooks reference documents `hookSpecificOutput.additionalContext` for `UserPromptSubmit` (and plain stdout on exit 0 for `UserPromptSubmit` and `SessionStart`). Values over 10,000 characters go to a file, and the agent gets the path and a preview of up to 2,000 characters. Context worded as imperative instructions may trip prompt-injection defenses. The probes did not return `additionalContext`, so injection is documented but not exercised.
- `system/init` carries a `capabilities` list (entries such as `interrupt_receipt_v1`, `msg_lifecycle_v1`, `mcp_tool_ui_meta_v1`, `ui_surface_v1`, `ui_pane_widget_v1`, `mcp_read_resource_v1`, `sdk_mcp_tools_list_changed`) and a `messaging_socket_path`. No probe tested what they mean.

### Atlassian connector

The `claude.ai Atlassian` connector (status `connected`) answered a read-only call in both paths. Its MCP server instructions carry a deprecation notice. The notice arrives in server instructions, not in tool results, so the app sees it only if the agent repeats it. Separate `claude.ai Atlassian MCP` and `claude.ai Atlassian Rovo` entries exist in `needs-auth` state. Whether either uses the v2 endpoint, and how the OAuth flow for a `needs-auth` connector runs from the app, was not tested.

What happens to v1 on 2027-03-01 has sources that do not say the same thing:

| Source | What it says |
|---|---|
| The connector's MCP server instructions (text in `probes/RESULTS.md`) | The server runs on "the deprecated /v1/mcp endpoint which will be removed on 2027-03-01". The user removes the official connector and adds it again from Claude's connector directory, or recreates a custom connector with `https://mcp.atlassian.com/v2/mcp`, then authorizes |
| Atlassian support, "Get started with the Atlassian MCP server" and "How to upgrade from Atlassian MCP v1 to Atlassian MCP v2" (read on 2026-11-17) | "On March 1, 2027 any existing utilization of v1 will automatically start to expose and utilize v2 tools." Incompatible clients need to clear cached `clientIds` or `.well-known` credentials. For Claude: existing v1 installations become "Custom Web" connectors; the steps are to remove or disable the v1 connection and install the v2 connector from the Atlassian Claude connector listing. Neither page says the `/v1/mcp` URL is removed or stops answering |

Known: the date; that v2 at `https://mcp.atlassian.com/v2/mcp` is the current endpoint; that both sources tell a Claude user to replace the v1 connector with the v2 connector. The upgrade page says, for gateways and custom MCP clients, that `?tools=all` exposes all tools "without `discover` and `execute` tooling". That implies a default v2 tool list built on `discover` and `execute` tools, which differs from the v1 list.

Not known: whether the `/v1/mcp` URL stops answering on that date or keeps answering with v2 tools; whether the claude.ai connector counts as an incompatible client that needs a new authorization; whether the v2 connector in claude.ai keeps the v1 tool names (`atlassianUserInfo`, `getJiraIssue`, `addCommentToJiraIssue` and the others), which the permission rules and the action table in 0010 and 0011 match on; who wrote the notice text (Atlassian's server or the connector layer).

### The expected `--bare` default for `-p`

The Claude Code headless docs state that `--bare` will become the default for `-p` in a future release. Bare mode does not read OAuth or the keychain and skips plugins, hooks and automatic MCP. Hooks passed through `--settings` do not run in bare mode either, and background commands and background subagents are off. P2 shows that `--bare` fails with the subscription login. When the default changes, a `-p` launch under a subscription stops working unless an opt-out flag exists. Whether such a flag will exist is not known. The interactive TUI is not affected by the documented change.

## Decision

1. The tool supports both launch paths behind one session abstraction, with the interactive TUI in a PTY as the primary path.
   - User-facing Claude sessions run the stock TUI in a PTY. Status comes from hooks passed through `--settings` (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `SubagentStart`, `SubagentStop`, `PermissionRequest`) and from the transcript file.
   - Agents the app starts without a visible terminal (background tasks, swarm workers, reviewers) use `-p` stream-json while it works with the subscription. This path gives cost, deltas, structured subagent events and `can_use_tool`.
   - Every session type can fall back to the PTY path.
2. Every launch passes: `--permission-mode` set by the app, `--settings` with the app's hooks (the app does not write into the user's `settings.json`), `--mcp-config` with the app server entry (`"type":"http"`, per-session URL with a bearer token, bound to 127.0.0.1, Origin check), a scrubbed environment that keeps `CLAUDE_CONFIG_DIR`, and `--session-id` chosen by the app (probed in `-p` only; the PTY case is a stage 2 probe).
3. Approval uses one `PermissionRequest` hook implementation for both paths, and `can_use_tool` over stdio in `-p` where the richer payload helps. PTY deny and built-in tools in the PTY must be tested before the hook is relied on there.
4. The app server is named outside the reserved names (for example `app` and `browser`; whether `browser` collides with a built-in is not verified).
5. The connector list and status come from `mcp_status` or a later init, never the first init.
6. Skills, plugins, the marketplace and connectors are not reimplemented. The app launches the CLI so that it loads them, and lists them from `mcp_status` and init data.
7. Sessions in an untrusted checkout (PR tasks) need a launch mode that skips the repo's `.claude/settings.json` hooks and `.mcp.json` servers and still keeps connectors. `--strict-mcp-config` drops connectors, so it is not that mode. The permissions docs say that `--setting-sources user` makes a `-p` run read neither the project's settings files nor its `.mcp.json`, which makes `--setting-sources user` without `--strict-mcp-config` the candidate mode. No probe ran it in a checkout that has a `.mcp.json`, and the docs state it for `-p`, not for the interactive TUI. Until a probe confirms it in both paths, PR tasks run with `--strict-mcp-config` and the app MCP server, and the agent has no Atlassian connector in those sessions.
8. The user replaces the v1 Atlassian connector with the v2 connector before 2027-03-01. The app does not depend on the agent repeating the notice. After the move the app's tool-name tables are checked against the v2 tool list from `mcp_status`.

## Consequences

- The PTY path does not depend on `-p`, so the `--bare` change cannot remove the main user path. The background path loses cost and structured subagent events if `-p` stops working; status then comes from hooks and transcripts.
- The app parses the transcript JSONL format and hook payloads, which are not a stable public contract. Hook payloads are documented; the transcript format is not.
- Live streaming text in PTY sessions is the terminal itself. A custom chat view for PTY sessions is not available.
- R16 is stronger on the `-p` path (P5 events) than on the PTY path (hooks only).
- Legal position: the spike plan notes that `claude -p` is documented as "the Agent SDK via the CLI". The personal-use position of 0001 covers the unmodified binary; the use of `-p` for background agents stays inside that position only while it runs the user's own unmodified binary under the user's login. A team version needs the conversation with Anthropic named in 0001.

### Risks

| Risk | Effect | Mitigation or fallback |
|---|---|---|
| `--bare` becomes the default for `-p` | background path stops with "Not logged in" | run background agents as headless PTY sessions with hooks; check for an opt-out flag on each CLI upgrade |
| Hook or transcript formats change | status and R16 views break | version check on launch; probe scripts re-run on each CLI upgrade; keep the CLI version fixed per release of the tool |
| `--permission-prompt-tool` is absent from `--help` | may change without notice | the `PermissionRequest` hook covers the same need |
| PTY deny path untested | approval in PTY sessions could fail open | test before use; the app sets `--permission-mode` on every launch, and a request the hook does not answer falls to the on-screen prompt in the TUI (the `perm_screen` probe completes that path) |
| Connectors absent in PR tasks | Jira context missing for PR work | probe the documented `--setting-sources user` behaviour in stage 2 |
| Atlassian v1 change on 2027-03-01 (removal per the connector notice, automatic move to v2 tools per Atlassian) | Jira access stops, or tool names change under the app's rules | replace the connector with the v2 connector before the date; re-read the tool list |
| Subscription rules change again | both paths affected | an API key login in either path, which needs a change to 0001. `--bare` with an API key is not a substitute for the background path: hooks from `--settings` and background subagents do not run in bare mode |

### Not verified

Interactive `--bare`; OAuth for `needs-auth` connectors; MCP over SSE and server-initiated requests; PTY interrupt and image paste; `--session-id`, `--resume` and `--fork-session` in the PTY; a controlled stored run that shows `--strict-mcp-config` dropping claude.ai connectors, and any run of it in the PTY; `--setting-sources user` in a checkout with a `.mcp.json`; what the Atlassian v1 endpoint does after 2027-03-01 and the v2 connector's tool names; PTY deny through the hook; launch without `CLAUDE_CONFIG_DIR`; `additionalContext` injection in a run; the meaning of the `capabilities` entries and `messaging_socket_path`; `--bg` and `claude attach` and remote control as fallbacks; models other than Haiku; concurrency on one subscription; a second agent through ACP (P4 was not run, so extra models have no probe evidence). Cost per turn in `notes/probes.md` comes from single runs and depends on prompt-cache state.
