# Milestone 6 probes for R21: MCP call duration (P16) and the http hook transport (P45)

Date: 2026-11-26. `claude --version` reports 2.1.332 and the MCP requests carry the user agent `claude-code/2.1.332`. Model for every call: Haiku, `--max-budget-usd 0.25`, an empty temporary directory under `/tmp/agide-r21-probes/`, `--setting-sources user`, `--strict-mcp-config` with only the probe server, inherited `CLAUDE_CODE*` variables scrubbed as `probes/lib.mjs` does and `CLAUDE_CONFIG_DIR` kept. At most three `claude` processes ran at once. macOS, Node 22.22.3. The documentation pages read with WebFetch on 2026-11-26 are `code.claude.com/docs/en/hooks`, `/mcp` and `/sandboxing`; the hooks page is longer than one fetch returns, so the sections for Notification, Stop and the sandbox were not read in full and the measured payloads stand in for them.

Every case ran once unless a section says otherwise. A pass here means the case behaved as written in the table on this CLI version; the numbers are seconds measured at the server or in the event stream.

## Questions

P16 (open since milestone 3, 0021 section 4): how long does the CLI keep a call to an HTTP MCP tool open, what does the model see and what does the server see when the call ends early, and does the PTY session differ from `-p` stream-json?

P45 (0030 recommendation 1, 0022, 0024): what does a hook entry of type `http` post for `PermissionRequest`, `Notification`, `Stop`, `PreToolUse`; how does an answer allow or deny; what happens when the receiver is down, slow or answers an error; are headers from an environment variable supported and does the value show in a process argument list; can a request be held, for how long; where does the hook run under a sandbox?

## Method

`probes/p16_slow_mcp.mjs` is a localhost Streamable HTTP MCP server with one tool, `slow_wait(seconds, mode, progress_every_s)`. In `json` mode nothing is sent until the answer. In `sse` mode the response stream opens at once with a comment line and optional `notifications/progress` messages follow. The server logs when the call arrived, each progress message sent, every notification the client posts, and whether the connection closed before the answer was written.

- `probes/p16_mcp_timeout.mjs` runs the `-p` stream-json cases (server entry `timeout`, the `MCP_TOOL_TIMEOUT` and `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` variables, json and sse replies, interrupt).
- `probes/p16_mcp_timeout_pty.py` runs the PTY cases with the existing PTY harness (`pty_lib.py`, `m2_lib.py` pattern, a command logging hook for event times and the transcript file for the tool result), including Esc during a call, the move to a background task, and how a line break is typed.
- `probes/p45_hook_server.mjs` is the receiver for the http hook cases. It logs headers, remote address and body of each request, answers per a route spec (allow, deny, ask, delay, status, plain text, invalid JSON), and logs a connection that closed before the answer.
- `probes/p45_http_hook.mjs` runs the `-p` cases with the stdio permission prompt tool, so a call that reaches the permission prompt shows as a `can_use_tool` request. The host answers such a request after 4 s, because the CLI emits it before the `PermissionRequest` hooks start (a host answer given at once beats the hook).
- `probes/p45_http_hook_pty.py` runs the TUI cases (held request, keys during the hold, hook timeout, Notification payloads).

The login has user-level hooks of its own that run next to the probe hooks; the receiver log, not the CLI's hook event list, is the evidence for the probe hooks. A `ps -axo args` scan of all processes of the user, taken once 1.5 s after the session started, looked for the dummy header values in the header cases. Dummy header values are derived at run time from a SHA-256 hash of a label.

## P16 results: how long a call stays open

The call ends with the model-visible result in the last column. "Start" is the first byte of the tool request at the server.

| Case | Entry `timeout` and variables | Reply | Result | Model sees |
|---|---|---|---|---|
| baseline 20 s | none | json | answered at 20 s | `done after 20 seconds` |
| 65 s | none | json | aborted at 60 s, the connection closed at the server | `The operation timed out.` (error) |
| 65 s | `timeout` 600000 | json | answered at 65 s | the answer |
| 65 s | `MCP_TOOL_TIMEOUT=600000`, no entry | json | answered at 65 s | the answer |
| 130 s | `timeout` 600000 | json | answered at 130 s | the answer |
| 310 s, no progress | `timeout` 600000 | json | answered at 310 s | the answer |
| 130 s | none | sse | answered at 130 s | the answer |
| 130 s | `timeout` 100000 | json | aborted at 100 s | `MCP server "slow" tool "slow_wait" timed out after 100s` (error) |
| 130 s, progress every 20 s | `timeout` 100000 | sse | aborted at 100 s, progress did not extend it | the same `timed out after 100s` error |
| 330 s, no progress | none | sse | aborted at 300 s | `MCP server "slow" tool "slow_wait" sent no response or progress for 300s; aborting. If this server is configured in your MCP settings, set a per-server "timeout" (ms) to allow longer silent runs for just this server; otherwise set CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT (ms) globally (0 disables).` (error) |
| 330 s, progress every 60 s | none | sse | answered at 330 s | the answer |
| 60 s, no progress | `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT=15000`, no entry | sse | aborted at 30 s, the message says `30s` | the idle error with `30s` |
| 60 s | `timeout` 15000 | json | aborted at 15 s | `timed out after 15s` |
| 60 s, progress every 5 s | `timeout` 15000 | sse | aborted at 15 s | `timed out after 15s` |

The request carries `params._meta.progressToken` (the JSON-RPC request id) and `params._meta["claudecode/toolUseId"]` (the id of the `tool_use` block), the protocol header `mcp-protocol-version: 2025-11-25`, and the user agent `claude-code/2.1.332 (sdk-cli)` for `-p` or `(cli)` for the TUI. A progress notification reset the idle window (the 330 s sse call with progress survived the 300 s window) and did not move the wall-clock limit.

### What the server sees when a call ends early

| Event | Notification to the server | Connection |
|---|---|---|
| Request timer (no entry `timeout`, json reply, 60 s) | none | closed by the client at 60 s |
| Wall-clock `timeout` reached | `notifications/cancelled`, `reason: "SdkError: Request timed out"` | stays open until the server closes it. With a `timeout` above 60 s and a json reply the connection closed at the same moment as the cancel (the request timer has the same length then) |
| Idle window reached (sse) | none seen | stays open |
| Interrupt: `interrupt` control request in `-p` (json and sse) or Esc in the TUI | `notifications/cancelled`, `reason: "AbortError: remote-cancel"`, sent on a new connection | stays open; the original request stayed open for the 12 to 20 s the server was watched afterwards |

A server that waits for the connection to close therefore does not learn of an interrupt, a wall-clock timeout or an idle abort. A reply written later to the open connection goes nowhere and does no harm. The `-p` interrupt ended the turn as `error_during_execution`; the tool result for the model is the CLI's standard rejection text ("The user doesn't want to proceed with this tool use ... this call was stopped while running, not refused before it ran"). In the TUI Esc gave the same result text and `[Request interrupted by user for tool use]`, no hook fired, and the session took the next prompt.

### The PTY session

| Case | Result |
|---|---|
| 65 s, no entry, json | Same as `-p`: aborted at 60 s, `PostToolUseFailure` at 60 s, the model quoted `The operation timed out.` |
| 150 s, `timeout` 600000, json | The call moved to a background task at 120 s: `PostToolUse` fired at 120 s with the result text `MCP tool "slow/slow_wait" is still running after 120s. It was moved to the background as task <id> and keeps running; you'll receive a notification with the result when it completes.` The turn ended (`Stop` at 122 s). When the call finished at 150 s a `<task-notification>` user message carried `done after 150 seconds` and the model reported it in a second turn (`Stop` at 152 s). The status line showed `1 MCP task still running` |
| 150 s, `timeout` 600000, json, `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` in the environment | The call stayed in the foreground: `PostToolUse` at 150 s with the answer as the tool result, one `Stop` |
| 330 s, no entry, sse, silent | Backgrounded at 120 s. The idle abort at 300 s arrived as a `<task-notification>` with status `failed` and the same idle message; the model reported `Task failed: MCP server "slow" tool "slow_wait" sent no response or progress for 300s ...`. The server saw no notification and no close |
| 90 s, `timeout` 600000, Esc 15 s into the call | `notifications/cancelled` (`AbortError: remote-cancel`) at the key; connection open; the tool result was the rejection text; no hook fired; session usable |

`-p` calls never moved to the background: calls of 130 s, 310 s and 330 s stayed in the foreground.

### How a line break is typed into the TUI prompt

A prompt typed as keys with a line feed (0x0A) between two lines stayed in the input box without submitting; Enter (0x0D) then submitted both lines as one prompt, and the `UserPromptSubmit` payload held the line break. A bracketed paste (`ESC [200~ ... ESC [201~`) of the two lines behaved the same. Both runs used one prompt each.

## P45 results: the http hook

### Request

A POST with `Content-Type: application/json`, `Accept: application/json, text/plain, */*`, `User-Agent: axios/<version>` (1.15.2), `Connection: keep-alive`, no other headers unless the entry sets some. The body is the same JSON object a command hook gets on stdin. Fields seen (session id, transcript path and working directory are in every payload; the list does not repeat them):

| Event | Fields besides the common ones (`session_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `prompt_id`, `hook_event_name`) |
|---|---|
| `UserPromptSubmit` | `permission_mode`, `prompt` |
| `PreToolUse` | `permission_mode`, `effort`, `tool_name`, `tool_input`, `tool_use_id` |
| `PermissionRequest` | `permission_mode`, `effort`, `tool_name`, `tool_input`, `permission_suggestions` (an `addRules` entry with the Bash prefix and an `addDirectories` entry); no `tool_use_id` |
| `PostToolUse` | `permission_mode`, `effort`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms` |
| `Notification` | `message`, `notification_type`; no `permission_mode`. TUI: `permission_prompt` ("Claude needs your permission") 6 s after the dialog opened, `idle_prompt` ("Claude is waiting for your input") about 60 s after `Stop` |
| `Stop` | `permission_mode`, `effort`, `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons` |

A `SessionStart` http hook next to a command hook on the same event posted nothing in `-p` or in the TUI while the command hook ran. A `SessionEnd` http hook posted in the TUI about 1.7 s after `/exit` (extra field `reason`, here `prompt_input_exit`); it was not measured in `-p`. `Notification` posted in the TUI only (not in `-p`).

### Answers

| Event | Body | Effect measured |
|---|---|---|
| `PermissionRequest` | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` | The tool ran with no prompt. In `-p` the pending `can_use_tool` request was cancelled (`control_cancel_request`) |
| `PermissionRequest` | `decision: {"behavior":"deny","message":"..."}` | The tool did not run; the model got the message as the tool error text |
| `PermissionRequest` | `deny` with `"interrupt": true` | The tool did not run, the turn ended with `error_during_execution`; the model-side text is the generic rejection, not the message |
| `PreToolUse` | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}` | The tool ran with no prompt |
| `PreToolUse` | `permissionDecision: "deny"`, `permissionDecisionReason` | The tool did not run; the model got `PreToolUse:Bash hook error: <reason>` |
| `PreToolUse` | `permissionDecision: "ask"` | The call went on to the permission prompt |
| `UserPromptSubmit` | `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"The p45 context word is <word>."}}` | The model repeated the word when asked, in `-p` and in the TUI |

An empty 200 body means no decision. The CLI reports the HTTP status as the hook `exit_code` in `hook_response` events (`exit_code: 200` on success).

### Failure

| Receiver | Default entry | With `onFailure: "block"` |
|---|---|---|
| Down (connection refused) | Non-blocking error (`connect ECONNREFUSED ...`), the call goes on to the normal permission flow | `PermissionRequest`: denied, the tool error reads `[<url>]: failed; blocking because onFailure is "block"` plus the connect error. `PreToolUse`: blocked with `PreToolUse:Bash hook error: [<url>]: failed; blocking ...` |
| 500 | Non-blocking error `HTTP 500 from <url>`, flow continues | not run |
| 200 with a plain text body | Non-blocking error `HTTP hook must return JSON, but got non-JSON response body: ...`, flow continues | not run |
| 200 with JSON that fails the schema (a `PreToolUse` decision `sometimes`, a `PermissionRequest` body without `decision`) | Non-blocking error `Hook JSON output validation failed — ...`, flow continues | not run |
| Slower than the entry `timeout` (3 s against 10 s) | The CLI cancels the request at the timeout, the receiver sees the connection close at 3 s after the request, outcome `cancelled`, flow continues without the hook's answer | `PreToolUse`: blocked, `[<url>]: timed out; blocking because onFailure is "block"` |

So the transport fails open by default. A permission or mode source that must not fail open needs `onFailure: "block"` on that hook.

### Held requests

| Case | Result |
|---|---|
| `-p`, no `timeout` in the entry, receiver answers `allow` after 20 s, 130 s, 330 s | Allowed after the wait each time; the tool ran; the pending `can_use_tool` request was cancelled |
| TUI, held 20 s, no key | The dialog was on screen during the hold; `permission_prompt` Notification at 6 s; the tool ran after the allow; no keypress needed |
| TUI, held 150 s | The same; the tool ran at 150 s |
| TUI, Esc 5 s into a 30 s hold | The CLI closed the HTTP request at the key (the receiver saw the close), the call was rejected |
| TUI, Enter 5 s into a 30 s hold (the hold would deny) | The call ran (`PostToolUse` at 8 s, `Stop` at 9 s). The request stayed open until the receiver's deny at 30 s, which the CLI ignored; the receiver saw no close. A second case watched the whole hold with the same result |
| TUI, the receiver answers a held request after 12 s with an empty 200 body | No decision: the dialog stayed on screen and Enter at 15 s ran the tool. The same empty answer in `-p` sent the call on to the `can_use_tool` request |
| TUI, entry `timeout` 5 s, answer after 12 s | The request closed at 5 s; the dialog stayed and `permission_prompt` still fired at 6 s; Enter ran the tool |

The documented default timeout of 600 seconds for http hooks was not run to its end.

### Headers

| Case | Result |
|---|---|
| `Authorization: Bearer $VAR` with `allowedEnvVars: ["VAR"]`, `--settings` given as JSON text | The receiver got the value. `${VAR}` works too. A header that names a variable missing from `allowedEnvVars` arrived as an empty string. The CLI's argument list holds the text `$VAR`, not the value; no process argument list held the value |
| A literal value in the header, settings passed as a path to a 0600 file | The receiver got the value; the argument list holds the file path only |
| A Bash tool command run by the agent in the same session, `printenv VAR` | Printed the value: the variable is inherited by the agent's commands |

### Where the hook runs

| Setup | Result |
|---|---|
| The CLI with its own sandbox setting (`sandbox.enabled`, `allowedDomains: []`) and an http hook to `127.0.0.1` | The hook failed with `HTTP 403 from <url>` and the CLI raised a `SandboxNetworkAccess` permission request for host `127.0.0.1`; the host's deny gave the 403. The receiver saw nothing. With `127.0.0.1` in `allowedDomains` the hook arrived |
| The whole CLI under srt, `allowLocalBinding: false`, loopback in `allowedDomains` | `connect ECONNREFUSED`, fail open |
| The whole CLI under srt, `allowLocalBinding: true` (with or without loopback in `allowedDomains`) | Delivered; the deny took effect |

## Where the documentation and the measured behavior differ

| Topic | Documentation | Measured |
|---|---|---|
| Hooks and the sandbox | The sandbox page says hooks run outside the sandbox; the sandbox covers shell commands | The http hook's request to loopback was gated by the CLI's own sandbox network rules (403 and a `SandboxNetworkAccess` request for the host). Under srt around the whole CLI the hook is inside by construction and needs `allowLocalBinding` |
| Idle window | `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` is in milliseconds | A value of 15000 aborted at 30 s with `30s` in the message. A floor of 30 s, or a doubling, is not explained by the page |
| Cancel on abort | The page says the CLI asks the server to cancel (for tasks) | `notifications/cancelled` was sent after an interrupt and a wall-clock timeout, not after the idle abort or the 60 s request timer; the HTTP connection was not closed by the CLI on interrupt, wall-clock or idle abort |
| `SessionStart` | Listed among events that support http hooks | The http hook posted nothing at session start in either path |
| `PermissionRequest` in `-p` with `--permission-prompt-tool stdio` | A hook can allow or deny | The `can_use_tool` request is emitted before the hooks start; a host that answers within a few milliseconds wins, a later hook answer cancels the pending request |
| MCP timer | Per-request timer covers the request up to the first response byte, wall-clock `timeout` is hard, progress does not extend it, idle window 5 minutes and raised to the entry `timeout`, 2 minute move to a background task in the main conversation | Confirmed, including that an `sse` reply with its first byte at once is outside the 60 s request timer and that `-p` never moves a call to the background |
| Hook failure | Non-2xx, connection failure and invalid bodies are non-blocking errors; `onFailure: "block"` blocks and denies `PermissionRequest` | Confirmed on 2.1.332 |
| Header interpolation | Only variables in `allowedEnvVars` resolve; others become empty | Confirmed |

## What the design of milestone 6 can rely on

For `inbox_ask` (0021):

- A server entry with `timeout` set above the largest `timeoutSeconds` keeps a call open that long in `-p` and in the TUI, with `json` replies and no progress (verified to 310 s with `timeout` 600000). Without the entry the call dies at 60 s (`json`). The app entry sets `timeout` (3,700,000 ms would cover the 3,600 s ceiling of the schema; values above 600000 were not run) and the server answers `timeout` itself before then. The wall-clock limit is the entry `timeout` whatever progress the server sends.
- The server cannot learn of an interrupt from the connection. It reads `notifications/cancelled` and matches `requestId` to the JSON-RPC id of the pending `tools/call`; the id equals the `progressToken`, and `claudecode/toolUseId` in `_meta` links the ask to the transcript's `tool_use`. An idle abort and the 60 s request timer need no handling when the entry `timeout` is set, and a late answer to an open connection nobody reads is harmless.
- In the TUI a call that runs past 120 s moves to a background task; the model is told so and the answer arrives later as a task notification and a second turn. Setting `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` in the environment of the launch keeps the call in the foreground (150 s verified). The design picks one: the in-call answer (`delivery: in_call`) needs the variable, and without it the answer after two minutes is a task notification, which the app cannot distinguish from a typed answer unless it types its own.
- Multi-line text from the user goes into the TUI as a bracketed paste followed by Enter, or as lines joined by line feeds followed by Enter. The text is stripped of escape sequences first.
- Session summaries and items must not depend on a `Stop` after a long call: in the TUI the background move makes `PostToolUse` fire at 120 s and `Stop` follow.

For the `http` hook transport (0030 recommendation 1):

- The payloads above are the contract of the receiver: `PermissionRequest` (no `tool_use_id`, with `permission_suggestions`), `PreToolUse`, `PostToolUse`, `Notification` (`permission_prompt`, `idle_prompt`), `Stop` (`last_assistant_message`, `background_tasks`). `PermissionRequest` answers allow, deny (with message) and deny with interrupt, as in the table. A request can be held for minutes: 330 s in `-p` and 150 s in the TUI worked with no entry `timeout`.
- The card closes on the first of: the matching `PostToolUse`, `Stop`, the receiver seeing the request close (the CLI closes it when the user presses Esc or the hook `timeout` expires), and the interrupt line. An Enter in the terminal leaves the request open for the whole hold (it never closed, and a later answer is ignored), so the close signal alone is not enough: `PostToolUse` for the same call clears the card after an Enter.
- A reply with an empty body (or any non-decision) after the app's wait returns the decision to the TUI dialog; the app never has to guess allow or deny.
- `additionalContext` in the reply to a `UserPromptSubmit` request reaches the model in both paths, so queued answers can ride on the user's next prompt without a printing command hook.
- The hook must fail closed where a failure would grant something, and open where it would block the user: set `onFailure: "block"` on `PermissionRequest` approvals only if a failed receiver should deny; the default lets the TUI dialog decide, which is the safer default for approvals from the card.
- Token: a literal bearer value in the 0600 settings file passed by path keeps the value out of every argument list. An environment variable carries the value into the agent's own commands (printed by `printenv` in the test), so the variable must not be used for a token that the agent should not read. The agent can also read a settings file that the sandbox allows it to read; a per-session token only holds up when the file is outside the agent's read access or the agent cannot reach the receiver.
- The agent can post forged payloads to the receiver whenever its sandbox can reach loopback. Under srt that is the same `allowLocalBinding` setting the CLI needs for the hook itself, so under a whole-CLI sandbox the hook transport and the agent share one network door. The receiver therefore keys each token to one session and checks the `session_id` in the body against it; it never treats a payload as proof of the mode without that check.
- `SessionStart` stays a command hook (the http type posted nothing). `SessionEnd` over http works in the TUI.
- Under the CLI's own sandbox setting the app adds `127.0.0.1` to `sandbox.network.allowedDomains` for the hook; under srt it sets `allowLocalBinding`. A launch that lacks either fails open (a connection error or a 403) and the session shows no mode source, which the session header must say. Record 0043 decides differently for profiles with the CLI's own sandbox on: allowing `127.0.0.1` also opens every local service to the agent's sandboxed commands, so those profiles keep the file transport until loopback can be allowed per port (0043 question 8).

## Not verified

- The 600 s default timeout of an http hook, held to its end; holds beyond 330 s.
- `SessionEnd` over http in `-p` (the TUI posted it); `SubagentStop`, `Elicitation` and `PostToolUseFailure` payloads.
- Whether the CLI closes an open MCP or hook request when it exits or when the session ends; the cases ended by killing the process after the server had been told nothing.
- The idle floor of 30 s (the cause of 30 s for a 15 s setting), and whether it also applies to the entry `timeout` floor.
- An `sse` reply with progress in the TUI, a progress notification in a background task, and an MCP call in a subagent (the docs say subagent calls never move to the background).
- HTTPS hook URLs, redirects, `allowedHttpHookUrls`, `httpHookAllowedEnvVars`, and non-loopback receivers; concurrency of many held requests.
- Linux and the container providers; the results are macOS only.
- One run per case. The timing cases (60 s, 100 s, 300 s) repeated within a second of the documented values; the cases with an unexpected result (the idle floor, the open connection after interrupt, the sandbox gate) had one run in `-p` and the interrupt case had a second run in the TUI.

## Cost

Calls with a recorded cost in the `-p` runs sum to about 0.11 USD (runs whose report entry a concurrent run overwrote are not in the sum); the TUI runs do not report cost and were similar in size (a few tenths of a cent to one cent each). All calls were Haiku with short prompts; the long waits cost time, not tokens.

## Evidence

Reports and raw logs are under `probes/out/` (git-ignored): `p16_mcp_report.json`, `p16_pty_report_*.json`, `p45_report.json`, `p45_pty_report_*.json`, with per-case `p16_*_server.jsonl`, `p45_*_server.jsonl` and stream logs. The PTY transcript excerpts in those reports contain the login's own system reminders, so they are not copied into this repository.
