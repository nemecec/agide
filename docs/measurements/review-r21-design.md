# review:r21-design: independent review of 0043 and the R21 probes

Start: 2026-11-26 14:06 UTC
End: 2026-11-26 14:20 UTC

## What was reviewed

- `docs/decisions/0043-milestone-6-architecture-and-contracts.md` against the code under `app/src` (inbox, tasks, MCP server and request guard, session hooks and launch arguments, isolation types and `HostEnvironment`, permission inspector, command registry and parity check, module order in `main/modules.ts`) and against 0021, 0024, 0029, 0030 and 0041.
- `notes/probes-m6-r21.md`, the P16 and P45 scripts and the new section of `probes/RESULTS.md`, checked against the reports and server logs in `probes/out/`.
- The SQL of inbox migration 2, run again against `node:sqlite` on top of inbox migration 1: an answered row without an answer is refused, an ask goes with its item, a view goes with its folder.
- One extra P16 case in `-p` with Haiku on 2.1.332: an entry `timeout` of 3,660,000 ms held a silent JSON call of 620 s to its answer (cost about 0.005 USD). The script imported `probes/lib.mjs` and `probes/p16_slow_mcp.mjs` from a scratch directory under `/tmp/agide-review-r21-design/`, which was removed at the end.

## Changes made to 0043

- The record said that `additionalContext` in a `UserPromptSubmit` reply was not measured and kept `context` delivery off. P45 measured it in `-p` and in the TUI. The amendment, the delivery table and section 10 now say so, and `context` delivery is on for `http` sessions.
- `SessionEnd` over `http` posted in the TUI (P45); the record said it was not measured.
- Section 10 said the CLI never closes the connection of a call that ended early. A wall-clock timeout above 60 s closed it together with the cancel. It also called the 3,660,000 ms entry settled when no value above 600,000 ms had run; the extra case above now backs it.
- The ordering rule for hook requests claimed one request finishes before the next one. P45 shows `Notification`, `PostToolUse` and `Stop` arriving while a `PermissionRequest` is held. The rule now says that listeners see arrival order and that a held reply never delays a later request.
- Contracts: the `http` variant of `HookDelivery` gains `dir` for the `SessionStart` and `SessionEnd` command hooks. `hookDelivery` lives in `HostEnvironment.ts`. `HookInbox` stays for those two events. The mode rule compares with the mode of the current launch and ignores unknown values (payloads report `default` for `--permission-mode manual`). `MODE_RANK` follows `MODE_ORDER`. The example in the header text was reversed.
- Audit: the parity finding now names the renderer-called inbox commands (the renderer calls no task command). A forged gate record can also post `gate:deny` and `gate:notify` items. `inbox_set_viewing` is added to the command table.
- Builder split: c-m6 owns `core/isolation/types.ts`, `main/modules.ts`, a stub `main/modules/hooks.ts`, the cancel handling in `HttpAppMcpServer.ts` and the fake CLI extensions, so w-hooks and w-ask do not both edit `fake-claude-hooks.mjs`. w-hooks owns `HostEnvironment.ts` and the endpoint wiring in `main/modules/session.ts`; w-approvals edits both after w-hooks. Integration owns `scripts/mutation-checks.mjs` and `docs/parity.md`.
- Scope, risks, questions: the `http` inspector for the container waits (0030 recommendation 1). A risk row covers a Bash sandbox switched on in the user's own settings. Question 7 refers to question 8. A hold of the default 15 minutes is open.

## What took long

Waiting for the 620 s case. Checking each audit row against the code.

## Not done

- `docs/README.md` still describes P16 as "not run" in the probe-script list, and its summary line does not name P16 and P45. This run did not edit those rows.
- The design run's measurement file still lists `additionalContext` as not probed.
