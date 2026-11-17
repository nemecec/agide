# fix

Start: 2026-11-17 09:44 UTC (first date -u of the run, 09:44:20). End: 2026-11-17T09:58:22Z.

## Built

- Surface ownership: `ui_create_leaf` from an MCP caller accepts only agent-creatable surface types; the session module acts only on the leaf it recorded for each session; a move to the top level revokes the grant; grants are revoked on exit and on a failed launch.
- Parity over the real module graph (`src/main/appForTests.ts`), `Command.mcpExempt`, `session_create` exempt, the unit test compares the doc and no longer writes it.
- Hook delivery by one file per hook (`HookInbox` replaces `JsonlTail`), run under `/bin/sh -c`.
- Contract tests for cycle and `isWithin` at depth, scope tests for move and create, not_found for unknown ids, listener errors, `UNION` in `isWithin`, migration version check, `busy_timeout`, single-instance lock, 413 and 500 handling in the MCP server, window permission handlers, frame URL check, `bypassPermissions` confirmation, `OutputBuffer` test, literal hook event list.
- Decision 0013 has an amendments section.

## What took long

- The rename e2e flake. A 25-run loop showed 4 failures. A first guess (the tree library's F2 hotkey) did not help: 3 failures in 40 runs. The cause is a rename input that opens before the tree moves DOM focus to the newly focused item, so the item steals focus and the input closes. Waiting for `toBeFocused()` before F2 gives 40 of 40 passes. The guess was reverted.

## Not done

- Config file in place of the token in the `claude` arguments: the limit is documented in 0013 and in the MCP types comment instead.
- Default permission mode: left as an open decision in 0013, since it needs the user.
- No test for the window handlers or the frame URL check (they import Electron); the e2e suite covers the normal path only.
- Hook ordering for hooks that run at the same instant is not defined.
- The review item about revoking grants of sessions whose folder is inside a removed subtree does not apply: the leaf of a session lives in its folder, so removal closes the session, and a move out of the folder rescopes or revokes at once.
- The UTF-8 split, file truncation and `size < offset` findings for `JsonlTail` no longer apply: the file tail is gone.
