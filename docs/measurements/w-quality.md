# w-quality: test quality after the review integration

Start: 2026-11-21T18:02Z. End: 2026-11-21T19:12Z.

## What was built

- Pure functions extracted from the review module (`app/src/core/review/budgetDay.ts`: local day, time to midnight, the midnight timer, the daily limit; `app/src/core/review/reviewCaller.ts`: reading a command caller as a review caller) with unit tests including edge and negative cases. `app/src/main/modules/review.ts` calls them.
- New unit tests: policy globs, the fail-closed pipeline slots, the caller view of a changeset (reviewer words, check output, null values), the inbox failure paths, the `review_seen` input rules, the module wiring of a connected capture service (pending captures, capture at the end of a run, a failed policy preparation), a disposed reviewer runner, summary hash binding, the floor rule of the state machine, the overlay network rule, secret detection for AWS temporary keys and symbolic links, attribute conversion in the reviewer checkout.
- A decision contract for both review managers (`app/src/core/review/manager/reviewDecisionContract.ts`): demotion tokens of another changeset and expired tokens, escalation and demotion to the same rung, a reviewer that sees nothing, seen marks of files with and without hunks, a stale reject, the hunks of reviewer findings at rung D, rung A without a passed check, a rejected agent in the merge gate, reviewers and agents that never merge.
- `pnpm mutation` gained entries for the review ladder: policy read from the base commit only and the overlay that only tightens, hard floors, raise-only rungs, agents and reviewers that never demote or accept, tool sets of the report tools, report scope, hash-bound seen marks, accept lapse, the merge gate, budget exhaustion, secret detection and the scrubbed check environment. Each was broken once and a test failed.
- Vitest: review test doubles, contracts and fixtures are excluded from coverage like the other contract files. Thresholds for `src/core/review/**`, `src/main/modules/review.ts` and `src/renderer/panes/review/**` are new; `src/core`, `src/main` and `src/main/modules` rose.

## Mutation results

The first run of the new entries left survivors. Tests were added for each real one. Entries that cannot change behaviour were removed from the list: a hard-reason floor of reviewer reasons (no reviewer reason is hard), a demotion to the same rung (the state machine refuses it with the same message), a reviewer reading changesets (the folder scope refuses it anyway), a repository reason accepted by a non-user at rung E (only the user accepts at E), an accept on other content (the content hash of a changeset is fixed), the merge taking agents that are not accepted (the gate refuses them first), a demotion token used twice (the second use lowers nothing), the seen-mark level (hashes differ per level) and the changeset id of a demotion token (the content hash covers it; the entry removes all three token checks together).

A mutation of the reviewer checkout that restores attribute reading survived from the earlier milestone, because configured filters are blanked and the old test could not see a conversion. A test with `eol` and `ident` attributes kills it.

The last full run left one survivor (`checkout reads attributes`); a test was added and a filtered run of that entry killed it, so no single full run showed every entry killed. The fix step that followed ran the full list again; see `fix.md`.

## Coverage (unit tests, V8, two runs)

| Area | Statements | Branches | Functions | Lines | Threshold (s/b/f/l) |
| --- | --- | --- | --- | --- | --- |
| all of src | 90.9 | 82.7 | 90.1 | 93.3 | none |
| src/core | 94.3 | 86.0 | 94.8 | 97.1 | 94/85/94/97 |
| src/core/review | 95.2 | 88.3 | 95.1 | 98.1 | 95/88/95/98 |
| src/core/swarm | 96.1 | 90.2 | 94.5 | 98.7 | unchanged |
| src/main | 81.7 | 69.4 | 79.0 | 85.0 | 81/68/78/84 |
| src/main/modules | 83.8 | 69.1 | 81.2 | 86.9 | 83/68/81/86 |
| src/main/modules/review.ts | 83.8 | 74.2 | 67.9 | 87.0 | 83/73/67/86 |
| src/renderer/panes/review | 95.1 | 83.2 | 96.4 | 97.2 | 95/83/96/97 |
| src/renderer/ui | 98.2 | 92.3 | 98.6 | 99.3 | unchanged |
| src/shared | 100 | none | 100 | 100 | unchanged |

Before the work the review module had 78.6 statements and 65.5 functions, and `src/core/review` 86.1 functions.

`pnpm typecheck`, `pnpm coverage` (twice), `pnpm mutation` and `pnpm e2e` (hidden windows, every end-to-end test) passed. `pnpm coverage:e2e` was not run.

## What took long and what is left

- The full mutation run takes about 45 minutes; the review entries alone take about 8.
- The review module still has glue that only the end-to-end tests reach (the real pipeline services built from the profile).
- A session that is an agent of one swarm and started another cannot ask for escalation on the second swarm, because the starter check requires a session that is no agent. No test fixes it either way.

## Disk

Free space stayed at about 3.3 GiB on the data volume.
