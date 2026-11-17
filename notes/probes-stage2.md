# Stage 2 probes P6 to P10

Date: 2026-11-17. Claude Code 2.1.326, model Haiku (`--model haiku`), real login, environment scrubbed as in `probes/lib.mjs` and `probes/pty_lib.py` (`CLAUDE_CONFIG_DIR` kept). Each run used an empty directory under `probes/work/` (trusted through its parent, so no folder-trust dialog appears) or, for P9, a fixture checkout there. `-p` runs used `--max-budget-usd 0.25`. PTY runs used `--permission-mode manual` and hooks passed through `--settings`. Evidence is in `probes/out/`. Each script has a README line at the top. Shared helpers: `probes/stage2_lib.py` (PTY and hook setup), `probes/lib.mjs`, `probes/pty_lib.py`.

| Probe | Script | Result |
|---|---|---|
| P6 PTY permissions | `p6_pty_permissions.py` | pass |
| P7 PTY sessions | `p7_pty_sessions.py` | pass |
| P8 additionalContext | `p8_additional_context.py` | pass |
| P9 setting sources | `p9_setting_sources_p.mjs`, `p9_setting_sources_pty.py`, `p9b_strict_compare.mjs` | pass, with the limits below |
| P10 PTY interrupt | `p10_pty_interrupt.py` | pass |

## P6 PTY permissions through the PermissionRequest hook

Method: `hooks/perm_policy.py` (decision per tool name) added next to a logging hook through `--settings`. Prompts asked for Bash (`echo ... > marker.txt`), Edit (`alpha` to `beta` in an existing file) and the app MCP tool `ui_create_folder`, each once with allow and once with deny. The prompt asked the model to quote any refusal text.

Results (`p6_report.json`, `p6_<case>_hooks.jsonl`, `p6_<case>_hooks.jsonl.perm`):
- The hook fires in the TUI for Bash, Edit and the MCP tool, once per call, in `permission_mode` `default` (manual).
- Deny works for all three. No marker file, the file still says `alpha`, the host state has no new folder. The deny message from the hook reaches the agent as an error tool result, and the model quoted it back in each case.
- Allow works for all three: the marker exists, the file says `beta`, the folder exists.
- Sequence on deny: `PreToolUse`, `PermissionRequest`, `Stop`. No `PostToolUse` fires for a denied call. On allow: `PreToolUse`, `PermissionRequest`, `PostToolUse`.
- No dialog appears on screen when the hook answers.
- PermissionRequest payload keys: `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `tool_name`, `tool_input`, `permission_suggestions`, and `mcp_server` for MCP tools. There is no `tool_use_id` and no `agent_id`. The `PreToolUse` payload of the same call carries `tool_use_id`, so an app pairs the two by order within a session and by identical `tool_input`.
- `tool_input` per tool: Bash `command` and `description`; Edit `file_path`, `old_string`, `new_string`, `replace_all`; MCP the arguments object. The tool name for the MCP tool is `mcp__app__ui_create_folder`.
- `permission_suggestions` entries seen: `addDirectories` (Bash, destination `session`), `setMode` to `acceptEdits` (Edit), `addRules` with `toolName` (MCP, destination `localSettings`).
- Bash tool results in this environment include the user's shell start-up banner (two lines) before the command output.

## P7 PTY sessions

Method: five launches in one directory. Hook payloads give `session_id` and `transcript_path` (`p7_report.json`, `p7_<case>_hooks.jsonl`).

Results:
- `--session-id <uuid>` creates the session with that id. The transcript file is `<uuid>.jsonl` and every hook payload carries that id. `SessionStart` has `source: startup`.
- `--resume <uuid>` continues the same session: same id, same transcript file (it grows), `SessionStart` `source: resume`, and the model recalled the word given before.
- `--resume <uuid> --fork-session` creates a new id and a new transcript file, with `source: fork`. History carries over (the model recalled the word). The original transcript does not change.
- `--resume <uuid> --fork-session --session-id <new uuid>` forks into the chosen id (transcript name matches).
- `--session-id <existing uuid>` alone exits with `Error: Session ID ... is already in use.`
- `--resume <uuid> --session-id <new uuid>` without `--fork-session` exits with `Error: --session-id with --continue or --resume also needs --fork-session.`
- Both error launches exit with code 1 and print the message on the screen; no hook fires.

## P8 additionalContext

Method: `hooks/ctx_hook.py` is a UserPromptSubmit hook that emits tagged context of a chosen size, as `hookSpecificOutput.additionalContext` or as plain stdout. Tags sit at the start, the middle and the end. Tools were disabled and the prompt asked which `TAG-` tokens the model sees outside the user message. Same cases in `-p` (`--output-format json`) and in the PTY (`p8_report.json`, `p8_p_*`, `p8_pty_*`).

Results:
- The model sees injected context in both paths. With `additionalContext` of 200, 5,000 and 9,900 characters it listed all three tags.
- Plain stdout of a UserPromptSubmit hook (exit 0) reaches the model the same way (`-p` and PTY, 200 characters).
- Limit: from 10,100 characters (12,000 and 60,000 tested) the model sees a preview of about 2,000 characters (the first tag only) and a note that the full output was saved to a file. 9,900 passes whole, 10,100 is cut, so the boundary is 10,000 characters as documented. The model could not read the file in these runs because tools were off.
- The transcript stores the context as a line of type `attachment` with `attachment.type` `hook_additional_context` (JSON output) or `hook_success` (stdout). A second line of type `api-request-blob` holds the request body. The `hookAdditionalContext` key seen in earlier transcripts is not what carries it here.
- Imperative wording ("from now on end every reply with BANANAPHONE"): the model reported the instruction in both paths. In the single `-p` run it also obeyed. In the single PTY run its reply did not end with the word. One run each, so no conclusion on how reliably injected instructions are followed.
- Design effect: use `additionalContext` for state the agent needs per turn (task, surface list), keep it under 10,000 characters, put the most important lines first, word it as facts.

## P9 setting sources

Fixture (`make_checkout.py`): project `.mcp.json` with a stdio server `projfix` that writes a marker file on launch, `.claude/settings.json` with SessionStart and UserPromptSubmit hooks that append to a marker file, and `CLAUDE.md` with a codeword (`CLAUDEMD-OWL-913`). Markers live outside the checkout. Three launch configurations in `-p` and in the PTY: `--setting-sources user`, the same plus `--strict-mcp-config`, and a control with `--setting-sources user,project,local`. The app hook came through `--settings`. One read-only connector call (`atlassianUserInfo` on the claude.ai Atlassian connector), only on the runs without `--strict-mcp-config`; the reply was reduced to SUCCESS or FAILURE and no returned data was stored.

Results (`p9_p_report.json`, `p9_pty_report.json`, `p9b_strict_compare.json`):

| Configuration | Project server starts | Project hook runs | CLAUDE.md read | User-scope MCP servers | claude.ai connectors | Connector call |
|---|---|---|---|---|---|---|
| `-p`, user | no | no | no | listed (connected or failed as on the machine) | listed, several connected | SUCCESS |
| `-p`, user + strict | no | no | no | none | none | not applicable |
| `-p`, all sources | yes, no approval prompt | yes | yes | listed | listed | SUCCESS |
| PTY, user | no | no | no | listed | listed | SUCCESS |
| PTY, user + strict | no | no | no | none | none | not applicable |
| PTY, all sources | yes after an approval dialog | yes | yes | listed | listed | SUCCESS |

- `--setting-sources user` without `--strict-mcp-config` is the mode that skips the project `.mcp.json`, the project hooks and the project `CLAUDE.md` and keeps connectors, in `-p` and in the interactive TUI. The documented behaviour holds in both paths. It also keeps user-scope MCP servers from the login's `.claude.json` (here `grafana`, `coralogix` and a failing `codex`).
- `CLAUDE.md` is skipped with it, so a reviewer launched this way does not read the repo's `CLAUDE.md`. Anything the reviewer needs from it goes in through the prompt, `additionalContext` or `--append-system-prompt`.
- In the PTY with all sources the TUI shows "New MCP server found in this project" with three options and the third ("Continue without using this MCP server") highlighted. Enter on it writes `disabledMcpjsonServers` to the checkout's `.claude/settings.local.json`; Up twice and Enter enables it and writes `enabledMcpjsonServers`. Under `--setting-sources user` the dialog does not appear. In `-p` the project server connected without a prompt.
- Controlled comparison of `--strict-mcp-config` (`p9b_strict_compare.json`): same directory, same prompt, same other flags, order off, on, on, off. Without the flag `mcp_status` lists the connectors and user servers (several connected claude.ai entries); with the flag it lists no servers, and every init lists none. The two runs without the flag differ in their `system/init`: one init held a short server list and the other a long list. The `mcp_status` response was the same in both. Read `mcp_status`, not the init, for the list.
- PTY listing under strict: the `/mcp` screen shows only the built-in `claude-in-chrome` entry, and the model's own list of MCP tool prefixes was `claude-in-chrome` alone. Without the flag the model listed the connectors, the user servers and plugin servers as well. `claude-in-chrome` is built in and stays under `--strict-mcp-config`.
- Limit of the fixture: it sits under a directory that is already trusted, so the folder-trust dialog did not appear and its effect on project hooks in the PTY is untested. The project hook in the control run ran without a trust dialog.

## P10 PTY interrupt

Method: Esc, Ctrl-C (byte 0x03) and SIGINT to the TUI process, during a long Bash call (a Python sleep, since the shell guard in this environment refuses a foreground `sleep ... ; echo`) and during text generation; double Ctrl-C at idle. An allow-all hook answered the permission request. After each interrupt the script waited, recorded hooks, screen and transcript, then sent a follow-up prompt (`p10_report.json`, `p10_<case>_hooks.jsonl`).

Results:
- Esc and a single Ctrl-C behave the same. Both stop the turn, the TUI stays running and the session answers the next prompt (follow-up reply `alive` in each case).
- During a tool call the tool process ends and the screen shows "No result recorded for 1 call" and "Interrupted · What should Claude do instead?". During generation the screen shows "Interrupted · What should Claude do instead?".
- No hook fires on interrupt: no `Stop`, no `PostToolUse`, no `PostToolUseFailure` (the settings listed both names and the launch accepted them). The host cannot learn of an interrupt from hooks.
- The transcript records it as a user line: `[Request interrupted by user]` during generation and `[Request interrupted by user for tool use]` during a tool call. This is the observable signal, together with the screen text.
- SIGINT to the process during a tool call ends the process (exit code 0). `SessionEnd` fires with `reason: other`.
- Ctrl-C at idle shows "Press Ctrl-C again to exit"; a second Ctrl-C exits and `SessionEnd` has `reason: prompt_input_exit`. The `/exit` command gives the same reason.
- Design effect: the app sends 0x03 or Esc to interrupt, then marks the turn interrupted when the transcript shows the interrupt line (or the screen text appears), and marks the turn finished without waiting for `Stop`. A turn state machine that waits for `Stop` stays "running" after an interrupt.

## Not verified here

- PTY deny and the built-in tools in other permission modes (`acceptEdits`, `auto`, `bypassPermissions`), and for subagents (`agent_id` on PTY approval hooks).
- `updatedInput` through the hook.
- Folder-trust dialog with an untrusted checkout, and project hooks behind it.
- Image paste in the PTY.
- Interrupt while an approval dialog is open, and interrupt of a background subagent.
- Behaviour on Haiku only; one run per case for P6 to P8 and P10.
- Whether imperative injected context is followed.
