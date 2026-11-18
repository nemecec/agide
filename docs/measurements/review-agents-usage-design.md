# Review of 0027 (agent nodes and usage design)

Start: 2026-11-17 20:34 UTC. End: 2026-11-17 20:44 UTC (`date -u`).

## Work

An independent review of `docs/decisions/0027-agent-nodes-and-usage-design.md`. The event and field claims were checked against the probe logs in `probes/out/` (P5 stream-json and PTY, P12 captures, P13 report and hook log), `notes/probes-m2.md`, `notes/swarm-visibility.md`, the hooks, status line and settings docs, and the session, inbox and isolation code under `app/src/core`. The SQL of section 4 ran against `node:sqlite` in Node 22 with stand-in `tree_nodes` and `sessions` tables, and the refusals and the folder deletion the record describes held.

Corrections made in 0027:

- `result.total_cost_usd` and `modelUsage` are cumulative per process (P1 multi-turn, P5 background and workflow), so the stream-json session cost is the latest `result`, not a sum.
- `task_notification.usage` carries only `total_tokens`, `tool_uses` and `duration_ms`; the `ended` fact holds a total, and agent cost comes from transcript tokens per class.
- `rate_limit_event` fields are in the P5 logs (`rate_limit_info.unifiedWindows`, `utilization` as a fraction, `resetsAt`); U3 now asks only for other statuses, the match with the status line and the status line in `-p`. The 0021 rate-limit alert applies to a status other than `allowed`.
- The `<task-notification>` prompt format is in the P13 hook log; U1 now asks for the failed and stopped forms.
- Foreground `PostToolUse` of `Agent` carries `agentId` at completion (hooks docs); `SubagentStop` answers the agent's open requests; the `SubagentHandback` summary rule from the hooks docs.
- Stop on a PTY session: `close` forgets the session, so the stop keeps it and the slice adds a per-session stop.
- Facts on `main`, the workflow group key, the status line going quiet during background work, the `/clear` cost reset, `modelPricing`, the `spend_limit` window, the `http` hook delivery, the temporary-file cleanup rule, the forecast arithmetic wording, and the pause effect on background subagents.
- The agent-readable usage data source contradicted the "What waits" row; agents do not read it in this slice.
- The effort figure: 5 to 7 days was below R16 alone (7 days); now 11 to 15 days.

## What took long

Reading the hooks reference, which is too long for one fetch, and matching stream-json `result` values across turns to show they are cumulative.

## Not finished

The temporary check directory `/tmp/rev0027` (a small script and schema copy, 8 KB) could not be removed: the removal command was denied.
