# w-manager: persistent swarm manager

Start: 2026-11-21 07:38:48 UTC (from `date -u`; the first command of the run)
End: 2026-11-21 08:15:07 UTC

## What was built

The first slice of the swarm manager of 0037 and 0038, in `app/`:

| Area | Files |
|---|---|
| Definition validation | `src/core/swarm/manager/validate.ts` |
| Budget ledger | `src/core/swarm/manager/BudgetLedger.ts` |
| Manager | `src/core/swarm/manager/PersistentSwarmManager.ts`, `entries.ts`, `rows.ts`, `ApprovalItems.ts`, `SwarmAlerts.ts`, `inputs.ts`, `timers.ts`, `TreeFolders.ts`, `callerView.ts` |
| Tables | `src/core/swarm/manager/swarmMigrations.ts`, `SwarmStore.ts` (migration 1 is the schema of 0037 section 12, migration 2 adds the swarm's warnings and an agent's pending message) |
| Workspaces | `src/core/swarm/workspace/git.ts`, `SwarmWorkspaces.ts` |
| Module | `src/main/modules/swarm.ts` |
| Tests | `manager/*.test.ts`, `manager/testRig.ts`, `workspace/SwarmWorkspaces.test.ts`, `src/main/modules/swarm.test.ts`, `e2e/swarmManager.spec.ts` |

The persistent manager runs `describeSwarmManagerContract` unskipped.

- Validation collects every problem before it refuses: schema issues with their path, a "fields here are" hint for an unknown key, the graph checks, the repository and base (resolved once to a commit; a base that starts with `-` is refused), `owns` overlap of agents that can run at the same time (empty `owns` next to a concurrent worktree agent is refused), tier aliases against the `initialize` models list once a process has answered it, and a warning for tool names the CLI does not list. A session caller may use only repositories the profile used before.
- Tiers come from `resolveTier` with the profile table; `maxTier` lowering is reported as a warning on the start result.
- The cap counts live swarm agents of every swarm plus `otherLive()` (the module passes the app-started agent rows that are not swarm sessions). The queue is ordered by swarm start, stage, definition position. A lowered cap stops nothing; a wait of more than five minutes raises one low alert.
- Stages, `continue`, `stop-dependents` and `stop-swarm`, and the single retry after 30 s for `exit`, `spawn` and `api_error` (a failure before the process reported `started` retries as a fresh launch). The retry delay is a dependency; `false` turns retries off.
- Budgets: reservations per agent from the swarm total (review allowance when `reviewShare` is set), subtraction of earlier spend on resume, the app's own check after each assistant message, the 80 percent alert, the swarm stop with an interrupt of the running agents, the wall clock (paused time not counted), the `rate_limit` pause.
- Workspaces: worktree per editing agent on `agide/swarm-<short id>/<name>`, detached worktree with a merge preview for readonly reviewers (each patch committed on its own, so a failing patch resets only itself), scratch directories, `inputs.md` with a nonce-tagged untrusted block, collection of diff, numstat, commits, `outsideOwns`, overlaps and readonly changes, patches stored 0600 in a 0700 directory, readonly worktrees removed when the swarm ends, removal with `removalPlan` and `remove` (patch before force, branches only when merged or ticked, nothing removed when the patch cannot be stored).
- Persistence and restart: rows written at every change; a restart leaves running agents `interrupted` by crash, pauses every running swarm, expires open approval items, ends an orphan process whose command line names the session, and resumes nothing. A resume after a crash starts with the note about the working directory.
- Approvals: one inbox item per `can_use_tool` request with `SwarmApprovalPayload`, deny after `swarm.approvalTimeoutMinutes` with the item `expired`, supersession on cancel, exit and stop, `expired` on quit.
- Commands: handlers for every `swarm_*` command through `registerSwarmCommands`; the module derives the manager's caller from the command caller (folder scope, depth, session mode, swarm agent). Status shows no working directory to agents, results wrap agent text in an untrusted block and give the worktree path only to the session that started the swarm.

## Runtime selection

The module builds `StreamAgentRuntime` of w-runtime, registers its launch contributor and sets it into `streams`. `AGIDE_SWARM_RUNTIME=fake` runs agents on `InMemoryAgentRuntime` instead; the end-to-end test uses it. The variable is not in `app/README.md` (not a file of this task).

## Results

| Command | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm parity` | parity ok; `docs/parity.md` lists the swarm commands |
| `pnpm coverage` | all tests pass except `src/core/inbox/plainText.test.ts`, which names `src/renderer/panes/inbox/SwarmApprovalActions.test.ts` (a file of w-ui) as writing markup; with that one test excluded the thresholds pass |
| `npx playwright test e2e/swarmManager.spec.ts e2e/integration.spec.ts e2e/milestone3.spec.ts e2e/tasks.spec.ts` | passes, windows hidden |

Mutation checks, each run by editing one line, running the unit tests of the area and restoring the file; all were killed by a test except the one noted:

| Mutation | Killed by |
|---|---|
| cap comparison `>=` to `>` | the cap test |
| other app-started processes not counted | the cap test with `otherLive` |
| a waiting agent does not hold a slot | the cap and approval tests |
| caller cap dropped from the effective mode; swarm mode dropped | the mode matrix test |
| bypass allowed for a session on a qualifying provider | the bypass test |
| reservation not held; resume ignores earlier spend | ledger and budget tests |
| swarm cap never stops; wall clock ignored | the budget and wall clock tests |
| spawn depth check dropped | contract test and module test |
| patch skipped before forced removal; forced removal for a clean worktree | workspace and removal tests |
| sessions steer swarms they did not start | contract and scope tests |
| approval timeout does not deny | the timeout test |
| dependency failure not applied; crash does not interrupt | policy and restart tests |
| the handler check that only the UI answers approvals | survives: the command registry already hides `swarm_approval_answer` from MCP callers (an agent gets `not_found`), so the handler check is a second layer that no caller can reach |

## What took long

- Finding that `end` on the in-memory runtime exits synchronously inside the `result` event, so the swarm became `done` before the budget check of the same result ran. The result handler now records the ending, checks the swarm budget, then tells the process.
- The merge preview: a failing `git apply --3way` followed by `reset --hard` also dropped the earlier, uncommitted patches. Each applied patch is committed now.
- Restart cases need a runtime that knows a session id after the manager restarts; the tests use a second runtime and register the id by running it once.

## Not finished or not done

- The cap lines of `TaskStartService` and `AgentsController.beginAppStarted` are unchanged: a swarm counts agent-started tasks against the cap, but `task_start` does not see swarm agents. The change touches files other builders may edit.
- Spawn depth for a session that `task_start` started from an agent (caller depth plus one) is not derived; the module reads depth only for swarm agents.
- `remove` and `removalPlan` exist on the manager and are tested, but no command exposes them: the contract has no `swarm_remove` command. The "Remove swarm…" dialog of w-ui needs one added at integration.
- "Always" and "Edit and allow" are not built (0037 waits on them). `editedInputs` stays false.
- Inspector records on approval items (`SwarmApprovalPayload.inspector`) are accepted by the item writer, but nothing supplies them.
- `scripts/real-swarm.mjs` is not built; no real Claude process ran in this task.
- The review of this work by a second agent was not done: this run had no way to start a sub-agent.
- The swarm's `done` state can show before the last collection finishes; `swarm_results` and `remove` wait for it, `swarm_status` warnings about readonly changes appear after it.

## Contract changes wanted at integration

- A `swarm_remove` command (and `swarm_removal_plan`, or one command with a dry-run flag) for the swarm row's menu.
- `AgentResult` has no field for a readonly agent's changes; the manager reports them as a swarm warning.
- `AGIDE_SWARM_RUNTIME` documented in `app/README.md`.

## Incident

Early in the run `prettier --write` was run over `src/core/swarm` without the project's style (single quotes, width 180), which rewrote the contract files and the files of w-runtime in that directory with double quotes. It was undone with `--single-quote --print-width 180 --trailing-comma all`, then `--object-wrap collapse` was applied to the contract files and the files of this task. Semantics are unchanged and the type check and tests pass, but object literals in the contract files and in w-runtime's files may be laid out differently from before (these files are untracked, so no earlier copy exists to compare with). Nobody else should need to re-read for a semantic reason.

## Temporary files

The tests remove their temporary directories. Directories named `swarm-rig-*` left by interrupted early runs were removed. No temporary file of this run remains.

# w-manager: review manager (R19, 0040 and 0041)

Start: 2026-11-21 16:16:16 UTC (`date -u`, first command of the run)
End: 2026-11-21 16:46 UTC (`date -u` at the last command)

## What was built

| Area | Files |
|---|---|
| SQLite store over the `review` tables; diffs kept as rows | `src/core/review/store/SqliteChangesetStore.ts`, `sqliteHarness.ts` |
| Persistent manager: recovery after a crash or a quit, queued reviews, one merge per swarm | `src/core/review/manager/PersistentReviewManager.ts` |
| Review items in the inbox | `manager/ReviewInbox.ts` |
| Budget over the swarm's review pot and the day's allowance | `manager/SqliteReviewBudget.ts` |
| Facts and send-back over the swarm manager | `manager/SwarmReviewFacts.ts` |
| Git merge of 0040 section 15.3 | `manager/GitMerger.ts` |
| Fail-closed slots for the capture, rules, check and reviewer services | `manager/pipelineSlots.ts` |
| What a session reads of a changeset (untrusted-data blocks, 100 KB cap) | `manager/callerView.ts` |
| Test rig | `manager/persistentRig.ts` |
| Module wiring, handlers, caller derivation, midnight timer | `src/main/modules/review.ts` |
| `swarm_merge` handler slot | `src/main/modules/swarm.ts` (`setMergeHandler`) |
| `app.merge` class (approve, hard floor, ask rule `mcp__app__swarm_merge`) | `src/core/permissions/types.ts`, `classTable.ts`, `inspector.ts` |
| `reviewShare` default 0.3 for a swarm with a `worktree` agent | `src/core/swarm/definition.ts`, `manager/rows.ts`, `manager/InMemorySwarmManager.ts` |
| Reader for the review pipeline | `PersistentSwarmManager.reviewInputs` |

Tests: the SQLite store and the persistent manager run the unskipped contract suites. Further tests: `SqliteChangesetStore.test.ts` (reopen a database file, compare-and-swap between two writers, constraint refusals roll back); `PersistentReviewManager.test.ts` (demotion across a restart, token lost with the process, reviewer runs cut short by a crash and by a quit, running check turned `not_run`, repeated steps, budget queue, nothing an agent can do, supersession and seen marks, one merge at a time, the gate after a send-back and after a raise of a merged changeset); `ReviewInbox.test.ts`; `SqliteReviewBudget.test.ts`; `GitMerger.test.ts` on temporary repositories (squash commits, dry run, conflicts, dirty checkout, a branch no checkout has, hostile filter, merge driver and hook); `swarmIntegration.test.ts` (facts, auto accept, gate and merge, send-back, refused send-back over a real swarm manager and real git); `callerView.test.ts`; `main/modules/review.test.ts` in the real module graph; `permissions/mergeClass.test.ts`; `swarm/reviewShare.test.ts`.

## Mutation checks

Each mutation was applied to the source, the manager, store and module tests ran, and the file was restored.

| Mutation | Result |
|---|---|
| merge ignores a closed gate | killed |
| gate ignores the latest changeset's state | killed after adding the send-back test; the first run survived because the accept check covered most states |
| gate ignores the accept rung and content | killed by the merged-and-raised test; the content part cannot be told apart, since a changeset never changes its content |
| agents may accept, reject, demote, mark seen or comment | killed |
| agent request at or below the current rung allowed | killed |
| no supersession on a new capture | killed |
| demotion forgotten after a restart | killed |
| recovery skips a failed reviewer run | killed |
| queued reviews never start | killed |
| merger runs the filters and drivers of the repository | killed |
| store without compare-and-swap | killed |
| daily allowance ignored | killed |
| pot forgets reservations of runs that ended with the app | killed |
| inbox item never resolved | killed |
| one merge per swarm lifted | killed after adding the test; the first run survived |

## Choices

- `PersistentReviewManager` extends `InMemoryReviewManager`. The base class changed in four ways, all keeping its contract suite green: members the subclass needs went from `private` to `protected` (`deps`, `clock`, `closed`, `pipeline`, `startReview`, `track`, `require`, `stopWork`, `rungNow`, `move`); the demotion is read from its decision row instead of a map, so it needs no persistence of its own; the tail of `pipeline` became `decide`, and the failure tail of `onReviewer` became `afterFailedRun`, so recovery can enter at those steps; `startReview` leaves a `queued_for_budget` changeset in that state when the budget still cannot pay. A later step can rename the base class.
- Pot accounting is read from `review_runs` (a running run counts its reservation, an ended one its cost, a run that ended with the app keeps its reservation), so the swarm ledger needed no review account.
- A quit records its runs as `cancelled` with `app-exit`; recovery treats those like crash-cut runs (`failed`, `app-exit`).
- `reviewer.skipped_budget` stays among a changeset's reasons after the queue released it, so the released review ends at C with the report for the user to read; the reviewer does not accept it. The reasons table has no removal.
- `swarm_merge` reaches the review module through `SwarmModuleService.setMergeHandler`; the swarm module owns the command registration.
- `GitMerger` runs its own git calls (it needs the exit code of `merge-tree`) and imports the guard constants of `workspace/git.ts`, which now export `GUARD_CONFIG`, `EMPTY_TREE` and `COMMIT_IDENTITY`. For a target that a checkout has checked out it accepts the main checkout and linked worktrees whose git directory is the common directory or below `worktrees/`, and refuses any other.
- Until `services.review.connect(...)` runs, rules give `check.not_run`, the check executor answers `not_run` and the reviewer ends at once with `spawn`: a changeset goes to a person.

## Shared files edited

`src/core/review/manager/InMemoryReviewManager.ts` (visibility, derived demotion, two extracted steps, queued budget; see Choices), `src/core/swarm/workspace/git.ts` (three `export` keywords), `src/core/swarm/definition.ts` and `manager/rows.ts` and `manager/InMemorySwarmManager.ts` (the `reviewShare` default), `src/core/swarm/manager/PersistentSwarmManager.ts` (`reviewInputs`), `src/core/permissions/*` (the `app.merge` class), `src/main/modules/swarm.ts`, `README.md` (a Review manager section), `docs/parity.md` (rewritten by `pnpm parity`, no change in the commands).

## Not done

- The capture triggers, held messages, background wait and the reviewer count in the live count of `PersistentSwarmManager`; they need the capture service.
- Per-launch outward modes and the `deploy` ask rules from the policy.
- Pending `report_outcome` claims stay in memory; a crash between the report and the next capture falls back to the result text.
- A reviewer run is not held by the `rate_limit_event` pause.
- The merge does not hold the swarm's captures, sends and resumes while it runs; it refuses a second merge of the same swarm only.
- The path from `swarm_start` with a worktree agent to `swarm_merge` in the real module graph: the swarm manager starts worktree agents only in repositories the task history knows, so the module test covers the commands, the inbox and the accept, and the integration test covers swarm manager, git and merge below the module.
- The start dialog's initial review share is still the form's `0` (w-ui); a definition without `reviewShare` gets 0.3.

## What took long

Reading the contracts and the reference manager, finding that a clean quit leaves reviewer runs `cancelled` and not `failed` (the first recovery tests timed out on it), and clock values that run ahead of wall time in a monotonic clock (a restart test needed a shared clock). `pnpm typecheck` reports errors in `renderer/panes/review/untrustedText.test.ts`, which belongs to w-ui.
