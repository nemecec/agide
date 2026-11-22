# review:fix-2

Start: 2026-11-21T21:46:53Z. End: 2026-11-21T22:01Z.

Independent review of the second fix step of the review ladder (R19), against the blocker and major findings of the review of the first fix step.

## What I ran

| Command | Result |
| --- | --- |
| `vitest run` over `src/core/review`, `src/core/isolation`, `src/core/swarm/manager`, `src/main/modules/review.test.ts`, `src/renderer/panes/inbox/ReviewCardActions.test.ts` | pass |
| `vitest run` (the whole unit suite) | pass |
| `pnpm typecheck` | pass |
| `pnpm check:colours` | pass |
| `node scripts/mutation-checks.mjs` with the fragments of the new entries | every entry killed, none skipped |
| Hand mutations (file copied, changed, tests run, restored, compared with `cmp`; checksums of the tree compared before and after) | the FIFO guard, the entry and byte caps of the user-config walk, the mode of the temporary directory, `expectedHash` made optional in the command schema and the `env` prefix of a hook command survive |
| Scratch tests (temporary test files, removed afterwards) | a second configuration change of the same category after the alert is absorbed by the accept; a ref change past the evidence cap is absorbed; a link in the repository hooks directory changes content unseen; the denials of a run resumed after its process ended are lost |

## Result

The findings of the review of the first fix step are closed as asked, each with a test and a mutation entry. New findings: the accept hash covers the categories of a configuration change and not its content; a setup that fails on both commits still counts as `check.failed_on_base`; denials reset per launch and not per run; the refused accept leaves the old alert; a user-level change cannot be cleared for the swarm.

## What took long

- Building a scratch scenario for the denial reset through the swarm rig (interrupt, end of the process, resume).

## Not checked

- `pnpm coverage`, `pnpm build`, `pnpm e2e`, `pnpm parity` and the full `pnpm mutation` run.
- Any run under a real `srt`: it is not installed on this host.

## Left over

- `/tmp/agide-review-fix-2` (test temporary files, mutation backups and logs, about 5 MB): the permission system refused its removal; the coordinator can remove it.
