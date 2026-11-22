# Review of tree, store, commands and MCP

- Start: 2026-11-17 09:32:34 UTC
- End: 2026-11-17 09:37:30 UTC

## What I did

- Read `src/core/tree`, `src/core/store`, `src/core/commands`, `src/core/mcp`, their tests, `scripts/parity.mjs`, and the main-process wiring that uses them (`src/main/modules/*.ts`, `src/main/index.ts`).
- Ran `pnpm typecheck` and `pnpm test` before and after the review. Both pass.
- Ran mutations with a helper that copies a file, applies one change, runs the related tests and restores the file. Mutations that the tests catch: no cycle check, token ignored, token of any session accepted, no Origin check, no Host check, Host without port check, scope check off, move destination unscoped, own folder removable, `ui_list_tree` unfiltered, no rollback, migration without transaction, `isWithin` only the node itself. Mutations that pass every test: a cycle check that looks only one level down (both implementations), `isWithin` that looks only one level up, `ui_create_leaf` without the scope check, `ui_move_node` without the scope check on the moved node.
- Wrote a temporary vitest file that wires the real session module, the SQLite tree and the MCP module with the fake claude. It showed that a session can create a leaf that points at another folder's session, move that leaf inside its own folder and so take over the other session, then remove the leaf and close the other session. The same file showed that the parity check over the real registry reports `session_create` as missing. I deleted the file afterwards.

## What took long

Nothing. Writing the end-to-end scope test against the real session module took the most time.

## What I could not finish

- I did not run `pnpm e2e` or the real-Claude scripts.
- I did not test two app instances on the same database.

# Review of the review ladder core (milestone 5)

- Start: 2026-11-21T19:09Z
- End: 2026-11-21T19:28Z

## What I did

- Read 0010, 0040 and 0041, `src/core/review` (capture, rules, policy, reviewer, manager, store) and `src/main/modules/review.ts`, and the quality and integration reports.
- Ran `npx vitest run src/core/review src/main/modules/review.test.ts`: all files pass.
- Wrote a temporary test file in `src/core/review/manager` against the in-memory manager with the real rules. It showed four defects: a rung D changeset whose flagged file has a control character in its name is accepted without the hunk seen; a sent-back changeset whose agent changes nothing can be neither accepted nor rejected, and the merge gate stays closed; `report_outcome` with `requestRung` does not raise the next capture; a second user escalation to the same rung after a demotion does nothing. I deleted the file afterwards.
- Ran mutations by hand with a helper that copies the file, applies one change, runs the related tests, restores the file and compares it with `cmp` (every file was restored byte for byte). Killed: `--attr-source` dropped from the capture guard; driver blanking dropped from the capture guard; the store compare-and-swap dropped; capture on any agent state; the module's repository stop of the reviewer; the catalogue rung of `policy.base_differs`; no `policy.base_differs` for a session-started swarm. Survived: the merge `update-ref` without its old value; capture triggered for readonly and scratch agents; the policy's daily limit not applied in the module; every session read as a session and never as a reviewer.

## What took long

Building the scratch rig over the fakes and the real rules.

## What I could not finish

- Free disk fell below 3 GiB during the review (my own files used under 1 MB), so I stopped running tests after the mutations above. I did not run `pnpm coverage`, `pnpm mutation`, `pnpm e2e` or the real-Claude scripts.
- I did not test the check under srt or a container, or the reviewer against real Claude.
