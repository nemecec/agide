# fix-m4-review

Start: 2026-11-21T09:35:16Z
End: 2026-11-21T09:57Z

The label is `fix`; the file name has the milestone suffix because `fix.md` holds the record of an earlier fix run.

## What was built

Fixes for the findings of the swarm runtime review and the swarm UI review. Each fix has a test that fails without it (checked by reverting the fix for the manager, ledger, runtime, git, task depth and the stream wiring).

- Manager: a message to an agent that is ending as stopped or failed is refused, so a stop and a budget ending hold. A process that starts after its agent was stopped or the app began to close is ended, and an exit of an already ended agent changes nothing. `session.closed` of a session whose launch is in progress is ignored. A user swarm puts its agents at depth 1. A failed interrupt puts the agent back. `recover` ends the process group.
- Runtime: the exit of a process that was silent past the start timeout is reported; the process group is ended on every exit; an interrupt gives up after the control timeout.
- Ledger: the agent's own spend counts against its pot; estimates are scaled by the reported cost of the latest turn.
- Git: calls in an agent's worktree use the git directory of the registered worktree, switch off command settings of the repository and ignore the user's diff settings; patches keep their bytes; a forced removal first checks that the stored patch applies to the base.
- Caller view: paths, commit subjects, conflict text and approval inputs reach another agent as quoted lines or untrusted blocks; `inputs.md` quotes paths.
- Depth through `task_start`: the store records a spawn depth; the swarm module supplies the depth of swarm agents.
- Module: tree leaves of resumed agents are found in the tree before one is created.
- UI: no group Resume for a stopped swarm; the approval card shows the tool input in full, names the swarm, is keyed by the item and has a clear Dismiss tooltip and no peek; the swarm chip replaces the tallies of the app-started node of a swarm agent; failures of the per-agent interrupt show in the pane; invalid cells of the agents table carry text and `aria-describedby`.
- Tests added for the survivors named in the review: the command-line check of `recover`, the updated input of an allow, the ledger after an interrupted process closed.
- Contract changes are in 0038, section "Changes after the review".

## Commands

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm coverage` (first run) | all test files pass, all thresholds met; statements 89.58, branches 81.21 |
| `pnpm coverage` (second run) | same result |
| `pnpm build` | built |
| `pnpm e2e` | all specs pass with hidden windows, about 2.1 minutes |
| `pnpm parity` | parity ok; `docs/parity.md` rewritten, with no user path in it |
| `pnpm check:colours` | no colour literal outside the allowlist |

The first coverage run failed the `src/core/swarm/**` thresholds for lines and functions by a fraction of a point; tests for the process control of the host, the interrupt failure of the manager and the interrupt timeout of the runtime brought both back above the threshold.

## What took long

The two stream-wiring and launch-race tests: a database check (`interrupted` needs a cause) hid an error that the launch swallowed, so the process stayed alive until the test printed its state.

## Not finished

- The shared cap between the manager and `task_start` still has a short window; it needs one slot counter that both use.
- A child swarm is not bounded by the connectors, tools and budget of the agent that starts it.
- The tree menu actions report no failure; the agent rows of the start dialog are keyed by position; the swarm feed still polls every swarm every three seconds.
- No test for the tree leaf lookup after a restart: the fake runtime creates no session, so the leaf code does not run in a module test.
- No second agent reviewed this run: the session had no sub-agent tool.
- The real-Claude scripts were not run.
- Temporary files: none left by this run.
