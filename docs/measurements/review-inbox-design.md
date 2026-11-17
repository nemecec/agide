# review-inbox-design

Start: 2026-11-17T15:08:43Z
End: 2026-11-17T15:20Z
Wall time: about 12 minutes

## Work

- Independent review of `docs/decisions/0021-inbox-and-tasks-design.md`, edited in place.
- Checked the hook claims against the Claude Code hooks reference, the MCP reference and the environment variable reference (read on 2026-11-17), `probes/RESULTS.md`, `notes/probes.md`, `notes/probes-stage2.md`, `notes/swarm-visibility.md`, and the P11 log and report in `probes/out/`.
- Checked the schema against `app/src/core/store/Store.ts`, `app/src/core/tree/treeMigrations.ts`, `app/src/core/session/SessionStore.ts`, `app/src/core/session/hooks.ts`, `app/src/core/mcp/mcpConfig.ts` and `app/src/core/surfaces/types.ts`; re-ran every SQL block of the record against `node:sqlite` in Node 22 on top of the milestone 1 tables, before and after the edits.
- Checked the recurrence rules against RFC 5545 sections 3.3.5 and 3.3.10, and the summary-run flags against `claude --help` of 2.1.326.
- Checked consistency with 0004, 0006, 0009, 0010, 0011, 0012, 0013, 0014 and 0015 to 0019.

## Main findings

- Documented MCP limits (60-second per-request timeout for HTTP servers, 5-minute idle window, move to a background task after 2 minutes in the interactive session) change the answer path of `inbox_ask`; the record now states them and sets a server `timeout` in the app's MCP config.
- `StopFailure` and `SessionEnd` reason `resume` were missing from the hook mapping; several documented Notification types were missing.
- Probe numbers P12 and P13 were already taken (status line, transcript usage); the waiting `PermissionRequest` probe exists as P14. The record's probes were renumbered.
- Contradictions fixed: agent `high` urgency refused by the schema though the rules lower it; rate limit both failing and coalescing; option labels typed into the session though agent text is never typed; `status` notification rule against `Stop` items notifying; a failed check past the retry limit as `failure` against 0010.

## What took long

Reading the long reference pages in parts to find the MCP time limits and the Notification type list.

## Not finished

- P14 was running in parallel; its report was not read.
- No probe was run; the documented MCP limits remain unprobed.
