# review-swarm-design

Start: 2026-11-21T06:49:37Z (date -u). End: 2026-11-21T06:59Z (date -u).

## Done

- Independent review of `docs/decisions/0037-swarm-orchestration-design.md` against `notes/probes-m4-swarm.md`, the logs in `probes/out/` (P30, P32, P33), `claude --help` of the host CLI (2.1.330), the permission-modes, model-config and env-vars docs, decisions 0011, 0012, 0021, 0025, 0027, 0028 and 0035, and the code in `app/src/core` (agents, session, isolation, commands, tasks, permissions) and `app/src/renderer/ui/icons.ts`.
- Re-ran the section 12 SQL against `node:sqlite` with stand-in tables and the section 1 schema with the app's zod (4.6.7), both as temporary files outside the repository, removed afterwards.
- Edits to 0037: the probe fact table, the `--permission-mode` name mapping, the init check on every turn, the `done` rule on `is_error`, the crash path for open approvals, the paused state and the agent-store mapping, the cap count and the task-start counter, a raised cap, readiness under `continue`, retries before the failure policy, the merge-preview baseline, a fresh patch before forced removal, the `fable` alias, the budget labels, the resume reservation, the "Always" suggestion types, duplicate approval items from the `PermissionRequest` hook, spawn depth through `task_start`, command error codes, status icons, the zod default of `tools`, the first slice list and the not-verified list.

## Account

- No real-Claude calls; no app code changes; no tests run (design review).
- Longest step: tracing the cap and approval paths through `AgentsController`, `TaskStartService`, `HookItemMapper` and `launchArgs`.
- Disk: about 10 GiB free before and after.
- No second review agent ran inside this step: no agent-spawning tool is available here.
