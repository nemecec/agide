# review:w-ui

Start: 2026-11-21 16:43 UTC. End: 2026-11-21 16:52 UTC.

Independent review of the w-ui builder's work for R19: the `agide/review` pane, the review card actions, the swarm Review tab, the "Review work" menu entries, `e2e/review.spec.ts` and the `review` visual-check phase.

## What ran

| Command | Result |
|---|---|
| `npx vitest run` over `renderer/panes/review`, `inbox`, `swarm`, `tree`, `ui` | pass |
| `pnpm check:colours` | pass |
| `pnpm typecheck` | fail: the only errors are in `renderer/panes/review/untrustedText.test.ts` (node imports and `import.meta.dirname` in the renderer project) |
| `npx playwright test e2e/review.spec.ts` with hidden windows | pass, against the in-memory manager in the renderer |
| mutation checks of the review views (hash, rung, reject and send-back hashes, the "without the reviewer" tick, escaping of bidirectional, zero-width and carriage-return characters, dwell focus, ratio, time and the interactive flag, anchors of removed lines, outdated drafts, the card's rung and finding conditions, the demote token and reason, the reject reason, accept on a superseded changeset, the `m` key on a closed changeset, the merge button's gate) | each failed a test except the summary dwell on a closed changeset and the merge button's refusal and conflict condition |

Each mutated file was copied first and restored byte for byte, checked with `cmp`. A scratch test file in `renderer/panes/review` was added for one check and removed.

## Findings

- The list view and the swarm Review tab expect `review_list` to answer an array; the review module answers `{ changesets: [...] }`. A scratch render with that shape throws "items is not iterable". The e2e and the visual check do not see it, because their backend answers with the manager's raw values.
- `pnpm typecheck` fails on `untrustedText.test.ts`.
- The card's Accept at rung C sends `withoutReviewer: false` when the changeset has no report, so the manager refuses it.
- Smaller points: `review.dwellMs` is not read; the tick stays set after a report arrives; a second Open from a card for the same changeset does nothing once the pane is on the list; the check command is not escaped; the D rule, dwell marking and the demote floor have no e2e.

## Not checked

The visual-check phase was not run. Behaviour against the persistent manager and the real inbox was not run end to end. Free disk was about 3.4 GiB throughout.

## Clean-up

The temporary directory `/tmp/agide-review-w-ui/` (mutation helper, backups, logs) could not be removed: the permission system denied the `rm`. It holds no product file.
