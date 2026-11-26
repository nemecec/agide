# r21-design: milestone 6 architecture and contracts (0043)

Start: 2026-11-26 12:55:15 UTC
End: see the last section

## What was built

- `docs/decisions/0043-milestone-6-architecture-and-contracts.md`: an audit of 0021 against the code, section by section; the scope of milestone 6 with what waits; the amendments to 0021; contracts for the `http` hook transport, hook approvals from the inbox card, the mode source, `inbox_ask` with its delivery in PTY and stream-json sessions, tasks and reminders, views, retention, wake and the notification click, session summaries; the command and IPC table with the parity rule; the UI components with the tokens of 0035; the builder split with owned files and the order; the test plan with mutation targets; the security table; estimates; risks; probe points; questions for the user.
- One row for 0043 in `docs/README.md`.
- The SQL of inbox migration 2 was run against `node:sqlite` in a scratch script under `/tmp/agide-r21-design/` (removed at the end).

No file under `app/` was changed. No model was started. No git command that changes the tree was run.

## What took long

- Reading the inbox, MCP, session and permission code to separate what milestone 2 built from what 0021 designed, and finding the differences no record states (the `ui: false` bindings of the inbox commands, status and gate records that travel through the agent-writable hook directory).
- The mode source: an `http` hook token sits in a file the CLI must read, so a same-user agent can still post. The record uses a rule that holds without trusting the transport (a reported mode only lowers the stored mode).
- Answer delivery: typing a fixed notice line made by the app and reading the answer through a tool removes both agent text and multi-line user text from the terminal.

## Probe results folded in

The parallel probe run wrote `notes/probes-m6-r21.md` (P16 and P45) at about 13:55 UTC; the draft of 0043 was done at about 13:06 UTC, so most of the wall time was the wait for it. The record now cites it: the app MCP entry `timeout`, the cancellation by `notifications/cancelled` (the CLI never closes an interrupted call's connection, so the signal of a tool call follows the notification), the default move of PTY calls to a background task, held `PermissionRequest` replies, the close at an Esc and at the hook timeout (not at an Enter), fail-open receivers, the token as a literal header in a settings file, `allowLocalBinding` under `srt`, the 403 under the Bash sandbox (question 8 added), and `SessionStart` and `SessionEnd` kept as command hooks.

## What could not be finished

- The removal of the settings file after start was not probed; 0043 leaves it to w-hooks tests against the real CLI. `additionalContext` in the `UserPromptSubmit` reply was measured by P45 (`notes/probes-m6-r21.md`) after this run wrote its account, and the review of 0043 folded the result in.
- 0043 has had no independent review yet.

End: 2026-11-26 14:00 UTC (about 65 minutes; about 50 of them waiting for the probe notes).
