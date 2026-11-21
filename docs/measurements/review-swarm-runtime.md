# Review of the swarm runtime, manager and module

Start 2026-11-21T09:22:29Z, end 2026-11-21T09:34:00Z.

## What I did

- Read `src/core/swarm` (manager, runtime, workspaces, schemas), `src/main/modules/swarm.ts` and their tests.
- Ran `pnpm typecheck` and `pnpm coverage`; both pass.
- Wrote short probe tests in the tree, ran them and removed them again. They showed that a stop of one agent does not hold when a message arrives during the stop, that a process silent past the start timeout never reports its exit, that a CLI that exits before any output is recorded as a stop by the user, that agents of a swarm the user started may start swarms at the default depth limit, and that the budget ledger reserves past a pot for an agent that spent before.
- Ran targeted mutations on a copy of the app outside the tree (node_modules linked, not copied). Most were caught; the ones that survived point at missing tests for the orphan check after a crash, the input of an allowed call, and the release of an interrupted process's spend.
- Reproduced in a temporary repository that a user's `diff.noprefix` setting makes the stored patch unusable for `git apply`.

## What took long

The mutation runs, since each one runs the swarm test folders.

## Not finished

- The temporary copy and its scripts could not be removed: the removal command was denied. They are listed in the review report.
- No end-to-end or real-Claude run.
