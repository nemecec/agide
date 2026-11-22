# w-ui

Start: 2026-11-21T16:16Z (date -u). End: 2026-11-21T16:45Z (date -u).

## Built

- The `agide/review` pane in `app/src/renderer/panes/review/`: the changeset list with the merge control and the merge Dialog (dry run, gate per agent, conflicts, Confirm), the changeset view (state, rung with every reason, its source, evidence and hard flag, the check with its output tail, the reviewer report with its author line, the claim marked as not verified, the files table with seen state, the batch of draft comments, the action bar with accept, reject, send back, raise and lower the rung), the file view and the hunk view (numbered lines, `+` and `-` in their own column, findings under their line, a comment box per line, a page of lines and a page of hunks with a "not shown" notice, keys `j`, `k`, `n`, `m`), dwell tracking for the summary and for hunks, and the inbox card actions in `panes/inbox/ReviewCardActions.tsx`.
- The Review tab of the swarm pane and the "Review work" entries of the tree menu for a swarm folder and an agent leaf.
- Agent text goes through `plainText` (control, bidirectional and zero-width characters shown as escapes) and is always rendered as React text; a source scan test refuses markup writes.
- Tests: view models and components in jsdom with a fake API (`reviewTestApi.ts`), and `e2e/review.spec.ts` on the in-memory review manager (`e2e/reviewBackend.ts`): open a review item from the inbox card, read a changeset down to a hunk, mark seen by key, comment, send back, see the unchanged hunk keep its mark and the changed one lapse, accept, see the accept lapse when the content changes, and the merge gate and merge.
- The `review` phase of `pnpm visual-check` (`scripts/lib/visual/phaseReview.mjs`), run hidden into a directory under `/tmp/agide-w-ui/`; the screenshots were opened and read. The screens drew correctly; the only fix was in the phase, which opened the wrong row first.

## Changes to shared files

- `app/src/renderer/api.ts`: `api()` reads `window.__agideApi` before `window.api`. The preload's `api` cannot be redefined, so the e2e test and the visual check put their wrapper there. Production code never sets it.
- `app/src/renderer/panes/swarm/openSwarmPane.ts`: `planOpenPane` is the generic part of `planOpenSwarmPane`; the swarm behaviour and its tests are unchanged.
- `app/src/renderer/ui/icons.ts`: four action glyphs (comment, merge, escalate, mark seen).
- Tests of the swarm tree menu list the new "Review work" entries.

## Not finished or not verified

- The dwell time is the default of 1,500 ms; the profile setting `review.dwellMs` is not read in the renderer.
- A draft counts as outdated only when the hunks of its file are loaded; whether `review_get` returns drafts of earlier changesets is not known, so that path is tested against a fake only.
- The views were run against the in-memory manager, not the persistent manager of w-manager.
- `pnpm test` shows failures outside the renderer (`core/review/manager/PersistentReviewManager.test.ts`, from a parallel builder); `pnpm typecheck` shows errors in other builders' files. Renderer and e2e files are clean.
- A hunk taller than twice the window never reaches half in view, so it is seen only by "Mark seen".

Temporary files: `/tmp/agide-w-ui/` was removed at the end.
