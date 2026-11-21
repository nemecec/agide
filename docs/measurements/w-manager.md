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
