# review:fix

Start: 2026-11-21T20:36:45Z. End: 2026-11-21T20:51Z.

Independent review of the fixes of the fix step for the review ladder (R19), against the blocker and major findings of the final reviews.

## What I ran

| Command | Result |
| --- | --- |
| `vitest run` over `src/core/review`, `src/main/modules/review.test.ts`, the review and inbox panes, `src/core/isolation`, `src/core/swarm/manager` | pass |
| `pnpm typecheck` | pass |
| `pnpm check:colours` | pass |
| `pnpm parity` | ok; `docs/parity.md` unchanged by the run |
| `node scripts/mutation-checks.mjs` with the fragments of the fix's new entries | every entry killed, none skipped |
| Hand mutations (file copied, changed, tests run, restored, compared with `cmp`) | the check's write limit and the module's caller check on `review_accept_repo_change` survive; see the findings |
| Scratch capture tests (a temporary test file, removed afterwards) | an accept from the repository alert absorbs a changed user `CLAUDE.md` and a ref moved during the accept; a symlinked skill changes unseen |
| `vitest` coverage of `review.ts` from `review.test.ts` alone | the file's own thresholds hold; the `src/main/**` function threshold does not hold from this file alone |

## What took long

- The mutation subset ran for about ten minutes; my own mutations waited for it, since both edit the same files.

## Not done

- The e2e suite, the full coverage run, the build and the full mutation run were not repeated.
- No real `srt` run: `srt` is not installed on this host.
- No real-Claude script was run.
- The removal of my temporary directory `/tmp/agide-review-fix/` (32 KiB: the mutation helper, its log and the scratch test copy) was refused by the permission prompt; it is left for the coordinator.
