# Milestone 3 permission probes P20 to P24

Date: 2026-11-17. Claude Code 2.1.326, model Haiku (`--model haiku`), the real login, environment scrubbed as in `probes/lib.mjs` and `probes/pty_lib.py` (`CLAUDE_CONFIG_DIR` kept), `--setting-sources user`. `-p` runs use stream-json with `--permission-prompt-tool stdio`, so every permission prompt arrives as a `can_use_tool` control request that the script answers (deny unless noted). PTY runs use the `PermissionRequest` hook as the dialog signal and Esc as the deny key. Every case ran in a fresh directory (under `probes/work/` or, for P24, the OS temp directory) that the script removed. Evidence is in `probes/out/` (`p20_*` to `p24_*`, `ppty_*`, `p_perm_pty_report.json`); paths there are reduced to `<repo>`, `~` and `<os-temp>`.

The user-level settings of this login run their own hooks in every case (extra `PreToolUse` hook responses with exit code 0 appear in each `-p` hook event list, and user hooks on `SessionStart`, `UserPromptSubmit`, `PermissionRequest` and `Stop` also run, some of them ending with exit code 127) and the shell profile prints a banner into every Bash result. None of this changed a decision: every prompt still reached the script as a `can_use_tool` request.

A reviewer re-ran the Bash cases of P20, selected P21 and P23 cases, the invalid mode value and the `-p` trust case with the same outcomes, and added a `strictAllowlist` check (P23). The summary is in `probes/out/m3-review/perm_rerun.json`; the raw re-run logs were not kept because they hold unreduced paths.

## Summary

| Probe | Result | Short finding |
|---|---|---|
| P20 ask rules in auto mode | pass | A matching `permissions.ask` rule opens a prompt under `--permission-mode auto` for a Bash pattern, an app MCP tool and a claude.ai connector tool, in `-p` and in the TUI. Unmatched calls run without a prompt. |
| P21 PreToolUse hook | pass | `allow`, `deny`, `ask` and `updatedInput` work in both paths. Deny rules and hook deny win; a hook `allow` does not lift an ask rule; exit 2 blocks, exit 1 and a timeout hand the decision back to the mode. |
| P22 permission modes | pass | `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk` and `plan` are accepted, `auto` is available for this login, `defaultMode` works through `--settings`, and the hook payload reports the mode (`default` for `manual`). |
| P23 sandbox settings | pass | The sandbox works under `--settings`. A non-allowed host is blocked with a clear message, but in auto mode the model re-runs the command with the host in a per-command `allowed_domains` input and the auto-mode classifier approved it in these runs. `deniedDomains` and `network.strictAllowlist` hold. Plain SSH fails inside the sandbox. |
| P24 folder trust | pass | The dialog appears for a directory with no trusted ancestor in the TUI, never in `-p`. `CLAUDE_CODE_SANDBOXED=1` skips it without storing anything. Detection and answer keys are known. |

## P20 ask rules in auto mode

Scripts: `p20_ask_rules.mjs` (`-p`), `p_perm_pty.py p20_*` (TUI). Settings passed with `--settings`: `{"permissions":{"ask":[...]}}`.

| Case (auto mode) | Prompt in `-p` | Dialog in TUI | Call ran after the deny answer |
|---|---|---|---|
| Bash, ask rule `Bash(echo p20*)`, matching command | yes | yes | no |
| Bash, same rule, non-matching command | no | not run | yes |
| Bash, no rule | no | no | yes |
| Bash, ask rule `Bash` (whole tool) | yes | not run | no |
| Bash, matching rule, prompt answered allow | yes | not run | yes |
| App MCP `mcp__app__ui_create_folder`, exact rule | yes | yes | no |
| App MCP, rule `mcp__app__*` | yes | not run | no |
| App MCP, no rule | no | no | yes |
| Connector tool, exact rule `mcp__claude_ai_Atlassian__atlassianUserInfo` | yes | yes | no |
| Connector tool, rule `mcp__claude_ai_Atlassian__*`, answered allow | yes | not run | yes (one read-only call, result not kept) |

The TUI cases used the rule `Bash(echo p21*)` and the command `echo p21 > marker.txt`.

- Auto mode does not suppress an ask rule. It does not prompt for anything else in these cases. The permissions docs say the same: an ask rule prompts "even in auto mode".
- The `can_use_tool` request carries `decision_reason_type: "rule"`, `decision_reason_rule_source: "flagSettings"` and `server_policy_ask_only: false` for a rule that came from `--settings`. For the whole-tool rule `Bash`, with a command that writes a file, it carried `blocked_path` and `matched_ask_rule: {source, tool_name}` instead; a manual-mode prompt for the same kind of command without a rule carries `blocked_path` alone. Whether `matched_ask_rule` belongs to whole-tool rules or to the path check was not separated. MCP requests carry `mcp_server: {name, source}`; connector requests carry the same keys and the server name from the tool name. A host can tell a rule-driven prompt from the mode's own prompts by these fields.
- The connector call was made once with an allow answer and returned success; the tool names seen were `ToolSearch` and `mcp__claude_ai_Atlassian__atlassianUserInfo`. No connector content was saved (`saveEvents` off, result text dropped).
- In the TUI, the prompt for an ask-rule match fires `PermissionRequest` and shows the dialog. Esc answers it as a denial and ends the turn without a `Stop` hook (as in P10).

## P21 PreToolUse hook

Scripts: `p21_pretool_hook.mjs` (`-p`), `p_perm_pty.py p21_*` (TUI), hook `hooks/pretool_decide.py`. The hook output is `hookSpecificOutput` with `permissionDecision` (`allow`, `deny`, `ask`), an optional reason and an optional `updatedInput`.

| Hook behaviour | Other rule or mode | Result in `-p` |
|---|---|---|
| allow | none, auto or manual | Runs with no prompt. In manual mode this replaces the mode's prompt. |
| deny | none | Blocked, no prompt. The agent sees `PreToolUse:Bash hook error: <reason>`. |
| ask | none, auto or manual | A prompt opens, hook reason in `decision_reason`. |
| allow | ask rule on the command | The prompt still opens. The hook does not lift an ask rule. |
| deny | allow rule on the command | Blocked. The hook deny wins. |
| allow | deny rule on the command | Blocked with "Permission to use Bash ... has been denied". The deny rule wins. |
| ask | allow rule on the command | The prompt opens. |
| allow with `updatedInput` | none | The rewritten command runs, the original does not. |
| allow with `updatedInput` | ask rule | The prompt opens and shows the rewritten input; the rewrite is applied before the prompt. |
| exit 1 | auto | Non-blocking error: the call is decided by the mode and runs. |
| exit 1 | manual | Falls back to the normal prompt. |
| exit 2 (stderr text) | auto, also with an allow rule | Blocked, no prompt. The agent receives the hook command and the stderr text as the tool error. |
| sleep past `timeout` of 2 s | auto | Hook is cancelled (`outcome: cancelled`), the call runs. |
| sleep past `timeout` of 2 s | manual | Hook is cancelled, the normal prompt opens. |
| sleep 3 s, default timeout | auto | The hook completes (`outcome: success`) and the call runs; auto mode would run it without the hook too. |

The TUI ran hook allow (auto, manual), hook ask (auto), allow against an ask rule (auto, manual), deny against an allow rule, `updatedInput` (alone in auto, with an ask rule in manual), exit 1 (auto, manual), exit 2 (auto) and the 2 s timeout (auto, manual), with the same outcomes as `-p`. The other rows ran only in `-p`.

- The hook payload has `hook_event_name`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`, `session_id`, `prompt_id`, `effort`, `transcript_path` and `cwd` (see the `*_hook.jsonl` and `ppty_*_hooks.jsonl` files).
- The order is: deny rules and a hook deny first, then ask rules and a hook ask, then hook allow and allow rules. A hook cannot weaken an ask or deny rule; it can strengthen the outcome. The permissions docs state the same order ("PreToolUse hook decisions don't bypass permission rules"; a hook that exits 2 blocks before rules are evaluated).
- A timeout or a non-blocking error lets the call through to the normal permission flow, so a hook on every call fails open. The hooks docs describe `"onFailure": "block"` on a command hook to block on failure and give 600 s as the default timeout of a command hook; neither was tested here.
- With `--include-hook-events`, `-p` emits `hook_started` and `hook_response` system events with `outcome` and `exit_code` (`error` with 2 for the blocking exit, `cancelled` for the timeout). The deny and block texts reach the agent as the tool error, so a host that wants its own wording puts it in `permissionDecisionReason` or stderr.

## P22 permission modes

Script: `p22_modes.mjs` (`-p`), `p_perm_pty.py p22_*` (TUI). Prompt: one Write and one Bash call.

- `--permission-mode` accepts `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. Anything else exits with code 1 and lists the choices. `manual` is reported as `default` in `system/init` (`permissionMode`) and in the hook payload.
- `auto` is available for this login (init reports `auto`, Write and Bash run with no prompt). Without a flag the mode is `auto` here only because the user settings carry `defaultMode: auto` (`--setting-sources user`).
- `permissions.defaultMode` in `--settings` works for `acceptEdits` and `plan`; `auto` is accepted too, but the user settings give the same value, so that case shows no effect of its own. The `--permission-mode` flag overrides `defaultMode`.

| Mode | Write | Bash `echo > file` | `permission_mode` in payload |
|---|---|---|---|
| auto | runs | runs | `auto` |
| manual | prompt | prompt | `default` |
| acceptEdits | runs | runs (a simple file write) | `acceptEdits` |
| plan | not attempted: the agent writes a plan file under the config directory and calls `ExitPlanMode`, which prompts | not attempted | `plan` |
| dontAsk | denied, no prompt | denied, no prompt | `dontAsk` |
| bypassPermissions | runs | runs | `bypassPermissions` (accepted with and without `--allow-dangerously-skip-permissions` in `-p`) |

- In the TUI the same payload values appear for `acceptEdits`, `plan` and `dontAsk`; in plan mode `PermissionRequest` fired for `ExitPlanMode` and a plan-file write ran.
- Not tested: `bypassPermissions` in the TUI (it has its own start dialog), and mode switching with Shift+Tab.

## P23 sandbox settings

Scripts: `p23_sandbox.mjs` (`-p`), `p23_sandbox_pty.py` (TUI). Settings: `{"sandbox":{"enabled":true,"network":{"allowedDomains":["example.com"]}}}`. The sandbox ran without further setup in this environment.

| Command | Result |
|---|---|
| `curl` to an allowed domain | HTTP 200. |
| `curl` to a domain not in `allowedDomains` | Exit code 56, `CONNECT tunnel failed, response 403`, and a `<sandbox_violations>` block in the tool result: `deny network-outbound <host>:443 (not in this command's allowed_domains — re-run the command with this host listed if it needs it)`. |
| `curl` with `sandbox.enabled` and no domain list | Blocked the same way. |
| `curl` to a host in `network.deniedDomains` | Blocked with `(host is on the deny list)`. |
| `git ls-remote` over https, host allowed | Works. Blocked with the same 403 text when the host is not allowed. |
| `ssh` to a public host, host allowed | Fails with `Could not resolve hostname`; no connection is made. The same ssh command outside the sandbox connects. |
| `git ls-remote ssh://...` to the same host, host allowed | Fails with `Host key verification failed`: the sandbox denies reading `~/.ssh/known_hosts` (`Operation not permitted`). |
| Write outside the working directory | `operation not permitted`, the file is not created. |
| Write inside the working directory | Works. |

- The Bash tool accepts a per-command `allowed_domains` input. After a block, the model re-ran the command with the host listed (seen for `curl` and for `git ls-remote`, not on every run). In auto mode this ran with no prompt and returned the data. The result metadata of that call reads `permission_decision: {decision: "accept", reason_type: "classifier"}`: the auto-mode classifier approved the host list, as the sandboxing docs describe ("The classifier reviews the hosts together with the command"). A `PreToolUse` hook sees `allowed_domains` in `tool_input`, so a hook can deny or ask on it. `network.deniedDomains` blocked the host regardless.
- `sandbox.network.strictAllowlist: true` in `--settings` (reviewer run, auto mode) refuses the per-command list: the call with `allowed_domains` returns a tool error saying the configured sandbox allowlist is the whole allowlist here, and the plain call is blocked with `(host is not on the allow list)`. The docs list `--settings`, user and managed settings as the scopes for this key. `strictAllowlist`, `deniedDomains` or a hook is the lever when the host list must hold.
- Not tested: the docs say that with the sandbox on and `sandbox.autoAllowBashIfSandboxed`, a bare `Bash` ask rule no longer prompts for sandboxed commands, while content-scoped rules such as `Bash(git push *)` still do. The P20 whole-tool case ran without the sandbox.
- In manual mode the first Bash call prompts as in any manual run, and a non-allowed host adds a second request with `tool_name: "SandboxNetworkAccess"`, `input: {host}` and the description "Allow network connection to <host>?". Answering allow runs the call. A host app can answer it through the same `can_use_tool` path.
- `allowUnsandboxedCommands: false` in `--settings` was accepted; the model did not try to leave the sandbox in these runs, so this probe shows no effect either way.
- In the TUI a blocked call shows `Sandbox blocked 1 operation · ctrl+o for details · /sandbox to disable` and the agent explains the 403 in its reply. No `PermissionRequest` fires.
- A test of ssh outside the sandbox connected and authenticated: with `IdentityAgent=none` and `IdentitiesOnly=yes`, ssh still offers the identity files named in the user's ssh configuration and the default key files. No repository data was read; later ssh tests were not repeated for that reason. The script now also passes `-F /dev/null` and `IdentityFile=none` (checked with `ssh -G`, no connection), so the ssh cases present no key; the kept logs come from the earlier command.

## P24 folder-trust dialog

Scripts: `p24_trust.py`, `p24_print_untrusted.mjs`. The CLI logic was also read from the strings of the installed binary.

- The TUI checks the project entry for the working directory, then each ancestor (bounded by the git root when the directory is inside a repository) in the login's `.claude.json` (`projects[<path>].hasTrustDialogAccepted`). One trusted ancestor is enough. A fresh directory under `probes/work/` started with no dialog in these runs because an ancestor is trusted; a fresh directory under the OS temp directory raised the dialog about 0.7 s after start. The milestone 2 note records the dialog for directories under `probes/work/`; that was not reproduced here and the cause is not established.
- `-p` never shows the dialog; a `-p` run in a fresh OS temp directory succeeded.
- Pre-accept options:
  - `CLAUDE_CODE_SANDBOXED=1` in the child environment makes the CLI treat every workspace as trusted. The TUI started with `SessionStart` firing at once and no entry was written. The variable is not documented; the 2.1.326 code appears to use it to skip the project-grant gating as well, so it is suited to directories the app creates empty, not to checkouts with project hooks or settings.
  - A trust key in `--settings` (`hasTrustDialogAccepted`) had no effect; `--dangerously-skip-permissions` had no effect on the dialog.
  - The only persistent route is a `projects[<dir>].hasTrustDialogAccepted: true` entry in the login's `.claude.json` (the CLI's own message names it). Writing that file from the app risks races with running sessions.
  - Trust for the home directory lasts for one run only and is not saved (text in the CLI).
- Detection from the host: the dialog text contains `Quick safety check` and `Yes, I trust this folder` / `No, exit`; `SessionStart` does not fire while it shows (it fires about 0.6 s after start when there is no dialog). Detect either by the text in PTY output (match with spaces removed, as cursor moves split the words) or by no `SessionStart` within a few seconds. A host can also read the `.claude.json` entries before launch.
- Keys: the highlighted default is `No, exit`. Enter alone exits with code 1, Esc exits with code 0; both print `Claude Code didn't start because this folder isn't trusted`. Down then Enter selects `Yes, I trust this folder`: `SessionStart` followed after about 0.7 s and the entry was written as true. Typing `1` was not used. Accepting stores trust for the temporary directory.

## Changes to the host

The accepted TUI dialog (Down, Enter) wrote a project entry with trust true into the login's `.claude.json` for a removed temporary directory (name starts with `p24-`). The run also left an entry with trust false; the kept P24 report shows no entry for the declined directories (Esc, Enter), so the source of that entry is not established (a session start in a fresh directory, such as the `-p` run, is one candidate). They are left in place; removing them from a file other sessions write is riskier than the leftover entries. No software was installed and nothing outside `probes/` and the temporary directories was written; the outside-write sandbox test targeted a file in the home directory that was not created. The ssh test with default keys authenticated once to a public service (see P23). The reviewer re-run used fresh directories under `probes/work/` and one fresh OS temp directory for the `-p` trust case, all removed; it restored the original files in `probes/out/` after the run.

## Design effects

1. The app can keep auto as the default and rely on ask rules for outward-facing tools: a rule from `--settings` prompts in auto mode in both paths. The rule list, a `PreToolUse` hook on every call and a network policy are independent layers, and hook allow never loosens a rule. Write ask rules for outward-facing Bash commands with content (`Bash(git push *)`), since the docs say a bare `Bash` ask rule gives way to sandbox auto-allow. A hook that times out or fails lets the call through unless it is set to block on failure.
2. The sandbox network list is not a barrier against the agent in auto mode by itself: the classifier can approve a per-command host list. Set `sandbox.network.strictAllowlist` in `--settings` when the list must hold, put hosts that must stay closed in `deniedDomains`, or deny `allowed_domains` in the `PreToolUse` hook.
3. A host that answers `can_use_tool` requests also receives the `SandboxNetworkAccess` request in manual mode.
4. For directories the app creates, set `CLAUDE_CODE_SANDBOXED=1` for the TUI child, or keep sessions under a trusted ancestor; fall back to detecting the dialog and answering Down, Enter after asking the user.
5. `manual` is `default` in payloads; map it in the app.
