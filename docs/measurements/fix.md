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

## Review fixes for milestone 2

Start: 2026-11-17T18:21:40Z. End: 2026-11-17T18:53:36Z.

### Built

- Layout: while the file on disk is invalid or newer, a change stays in memory with a warning at `/file` and the file is not rewritten; the next valid file replaces it. `layout_undo` from an agent checks the scopes of the target revision.
- Scheduler: enumeration starts near the period of `from`, rules above 48 occurrences a day are refused, enabling a schedule recomputes the next occurrence, snoozes count towards the timer, events of a firing are held until the commit, task reminders use the task instant in zone UTC, `updateTask` is one transaction and keeps the reminder when the due time is unchanged.
- Sessions: grants are revoked through `onLaunchFailed` for create and resume, `mcp.json` is removed at the first `SessionStart`, stale session directories are removed at start, deny rules for the app root go into `--settings`, the default working directory is a directory per folder instead of the home directory, a working directory inside the app root is refused, the login terminal runs in an empty `data/login`.
- Isolated profiles inherit only an allow list of variables. The migration takes over a stale lock by rename, stages per pid and moves `Partitions`.
- Smaller: `useInbox` drops older responses, `app.focus({ steal: true })` before `window.focus()`, Unicode format characters and line separators removed from item text, setup pane states that agents run as the user, flaky polls given explicit timeouts, 0023 corrected and given an amendments section.
- New tests fail without their fix (checked by reverting: enable-schedule, old dense rule time budget, `ensureDir` chmod, `useInbox` ordering).

### What took long

- Moving the default working directory out of the data directory broke unit tests that used one directory for both; they now use a separate work directory. The e2e specs read `mcp.json` after launch, so the fake CLIs record its content at launch, as the real CLI reads it.
- One test run created a directory below the real home directory because `os.homedir()` ignored `HOME` in the test; `defaultSessionCwd` now reads `HOME` first, and the empty directory was removed.

### Not done or not applying

- The ssh wrapper on PATH is not built; the limit is recorded in 0023 and shown in the setup pane.
- A layout file written directly into the layouts directory is still adopted without a scope check; recorded as a limit in 0023.
- Window focus on screen, and the effect of the deny rule syntax in a real session, are not verified. `e2e-real-claude.mjs` and `e2e-claude-mcp.mjs` ran once each and the app MCP server still connected after `mcp.json` was removed.
- The review note that the profiles e2e spec fails with `CLAUDE_CONFIG_DIR` set did not reproduce.
