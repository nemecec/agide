# w-agents

Start: 2026-11-17T22:11:16Z
End: 2026-11-17T22:58:17Z

## Built

First slice of 0027, items 1 to 5 and the alert part of item 6.

- `src/core/agents`
  - `normalise/hookAdapter.ts`: `HookNormaliser` over `SubagentStart`, `SubagentStop`, `PreToolUse` and `PostToolUse` of `Agent`, `SubagentHandback`, `PermissionRequest`, `UserPromptSubmit` (task notifications), `Stop`, `StopFailure`, `SessionEnd` and process exit. Request keys use the `requestHash` of the inbox.
  - `normalise/streamAdapter.ts`: `StreamNormaliser` for app-started processes (task start, progress, workflow diff, control requests and responses, results, rate limit events, exit).
  - `normalise/transcriptAdapter.ts`, `outcomeCheck.ts`, `taskNotification.ts`: usage lines by message id, `cost-state`, interrupt and API error lines, agent metadata, tail read.
  - `SqliteAgentStore.ts` with migration 1 (agents, usage totals, plan usage): write-through over the in-memory store, rows replayed as facts at start, `repairAfterRestart`.
  - `RemovalScheduler.ts`: removal timers with hold, release, dismiss and revival. `view.ts`: node view, running count, finished tally, history filter.
  - `AgentsController.ts`: feeds store and usage engine from `session.*` events, the outcome check at `SubagentStop`, the last read at exit, the app-started cap.
  - `transcriptFiles.ts`: path check with `realpath`, plain-text entries, 20 MB read limit, gzip copies with a size cap.
  - `settings.ts`: `agents` profile settings (removal delays, cap, copy size, usage thresholds).
- `src/core/usage`: price table, `RateBuffer` (10-second buckets), `UsageEngine`, forecast, heat levels, folder rollups, status line command and snapshot parser, `SessionWatcher`, `AlertEvaluator`, `SqliteUsageStore`.
- `src/main/modules/agents.ts`: wiring, the status line launch contributor, usage alerts to the inbox, and the commands `agents_list`, `agents_history`, `agents_dismiss`, `agents_hold`, `agents_transcript`, `agents_settings_set`, `usage_state`, `usage_pause`, `usage_stop`, `usage_alert_action`.
- Renderer: agent rows, session decorations (count, waiting marker, finished tally, heat), folder rollup marker, "Show finished agents" in the tree background menu, `UsagePane`, `AgentHistoryPane` (filters, removal delay inputs, read-only transcript), `TranscriptViewerPane`, `PlanUsage` in the rail.
- Tests: Vitest for each adapter, the stores, the timers with a fake clock, the usage engine, forecast, alerts, watcher, controller and the panes; `e2e/agents.spec.ts` with `fake-claude-agents.mjs`.

## Shared files edited

- `src/core/profile/types.ts` and `schemas.ts`: optional `agents` settings key, one import and one field each.
- `src/renderer/panes/TreePane.tsx`: the "Show finished agents" menu entry, `FolderDecorations` on folder rows, the agents stylesheet import.
- `src/main/modules/m3Modules.test.ts`: waits for the coalesced `agents.changed` event instead of expecting it at once.
- `README.md`: module map lines for `core/agents` and `core/usage`.

## Verified

- `pnpm test` (also with `--coverage`): all tests pass; the coverage thresholds fail for the repository as a whole because modules owned by other builders are still stubs. `core/agents` shows 92 percent statements and 94 percent lines, `core/usage` 94 percent statements and 96 percent lines.
- Playwright `e2e/agents.spec.ts`: four tests pass with hidden windows.
- Mutations that make a test fail: message-id replacement in the usage engine and in the store, `agent_id` attribution in the hook adapter, `realpath` in the path check, the held check of the removal scheduler (after a test was added for it).
- `pnpm parity` passes. `tsc` passes for my files; other builders' files had type errors while they worked.
- Tests of other builders failed by timeout in some full runs (`PtySessionService`, `appModules`, `tasks`) and passed when run again; the cause was not examined.

## What took long

The decision is large; the adapters and the engine were quick, the renderer parts and the end-to-end setup (folder collapsed in the tree, layout files with the usage and history panes) took the rest.

## Not done or not verified

- No `-p` stream-json launch path exists, so the stream adapter and the cap run on fixtures and through `AgentsController.beginAppStarted`; nothing starts an app-started agent yet. Pause and stop through alerts work for PTY sessions only. The cap alert is posted by `AgentsRuntime.beginAppStarted`.
- The real CLI was not run: formats of the `cost-state` row and of the workflow progress entries are read tolerantly and are not checked against a live run. The price table values were not checked against the published prices.
- Probes U1 to U7 were not run. Waiting attribution for subagents needs U4; the outcome check knows only the interrupt line and the `isApiErrorMessage` marker.
- Plan usage of other profiles in the rail is not shown (open in 0025). The `usage.keepUserStatusLine` setting is not built.
- Workflow nodes show as flat rows keyed `wf:<task>:<index>` in app-started processes only; there is no group node or phase heading in the tree.
- Agents started by the app are not rendered under the calling session leaf (no launch path).
- Rates poll every second, transcripts too (the design says every 2 seconds).
- Transcript copies and the 30-second token write for running rows are implemented as a delayed write after changes, not on a 30-second timer.
