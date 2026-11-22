# Review of w-manager

Start: 2026-11-21 16:46 UTC. End: 2026-11-21 17:00 UTC.

## What was done

- Read 0040 sections 9 to 17 and 0041, then the builder's files: the persistent manager, the module, the store, the budget, the merger, the inbox items, the caller view, the swarm facts, the `app.merge` class and the `reviewShare` default.
- Ran the area tests (`src/core/review/manager`, `src/core/review/store`, `src/main/modules/review.test.ts`, `src/core/permissions`, `src/core/swarm/reviewShare.test.ts`): all pass.
- Ran `pnpm typecheck`: the node project passes; the errors left are in `src/renderer/panes/review/untrustedText.test.ts` (w-ui). Ran `pnpm parity`: ok.
- Ran a set of source mutations with a script under the temporary directory. Each file was copied first and restored after the run; `cmp` showed every restored file equal to its copy. Survivors: the merger's compare-and-swap of the ref, the merger's refusal of an unrecognised checkout, the store's compare-and-swap on the rung, the termination of a reviewer process that outlived a crash, the inbox payload's `cardAccept`, the inbox's latest-changeset filter, and three mutations of `SwarmReviewFacts` (workspace, default target, folder scope).
- Two scratch tests, removed afterwards: an escalation by the user while a merge runs (the merger moves the branch, then the manager throws and records nothing), and a merge into a linked worktree that has the target checked out (a smudge filter from that worktree's `config.worktree` runs).

## What took long

Reading the base manager, which the builder changed, to tell which paths the persistent manager inherits.

## Not finished

The real module graph with connected capture, rules, check and reviewer services; the real-Claude path; the renderer.
