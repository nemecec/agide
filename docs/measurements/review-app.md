# review:app: independent review of the review ladder in the running application

Start: 2026-11-21T19:09:51Z
End: 2026-11-21T19:32Z

## What I did

- Read 0010, 0040 (sections 9 to 17) and 0041, then the renderer review pane, the inbox card, `main/modules/review.ts`, `reviewCaller.ts`, `callerView.ts`, `ReviewInbox.ts`, `SwarmReviewFacts.ts` and the decision paths of `InMemoryReviewManager.ts`.
- Made a scratch copy of `app/` without `node_modules` (a symbolic link to the tree's `node_modules`) under the temporary directory, so builds, probes and mutations did not touch the shared tree while another agent ran `pnpm coverage` there.
- Ran the review area tests (54 files pass), the full `pnpm e2e` with hidden windows (86 passed, 4.7 minutes), `pnpm typecheck`, `pnpm check:colours` and `pnpm parity` in the tree.
- Wrote a probe spec in the scratch copy only. It called the tools over MCP as a worker session and as a live reviewer session, with a forged token, a stolen token on another path and forged changeset ids. It also covered a commit of the user on the base branch during a swarm, the keyboard keys of the file view, a 4,000-line hunk and the error state.
- Ran mutation checks of the application seams in the scratch copy. Each file was copied first, restored and compared with `cmp`; none differed. One mutation was rebuilt and run against `e2e/reviewLadder.spec.ts`.
- Ran `pnpm visual-check --hidden --only review` and read the screenshots.

## Results

- The MCP surface held: a reviewer grant lists only `report_review`; a worker grant lists `report_outcome` and not `report_review` or any decision of the user; forged and misplaced tokens get 401; out-of-scope reads and requests are refused.
- A commit of the user on the base branch during a swarm gives `repo.ref_moved` at rung E and closes the merge gate. Nothing in the app can open it again, and no repository alert reaches the inbox.
- These mutations survived the unit tests: the module passing the user as caller for `review_list`, `review_get`, `swarm_merge` and `review_request_escalation`; the 100 KB hunk cap; the card accept with a blocking finding (killed only by the end-to-end test); readonly agents captured.
- A single hunk over 100 KB reaches a session cut, with `hunksTruncated` false.

## Notes

- `pnpm parity` rewrites `docs/parity.md`. The rewrite in the tree was identical to the file generated from my scratch snapshot.
- Nothing took unusually long; the end-to-end run and the mutation run were the longest steps.
- Not done: a full `pnpm mutation`, `pnpm coverage`, real-Claude runs, the srt and container providers.
