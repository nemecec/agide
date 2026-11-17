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
