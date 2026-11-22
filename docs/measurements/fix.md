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

## Final review fixes for the review ladder (R19)

Start: 2026-11-21T19:32:37Z. End: 2026-11-21T20:36Z.

### Built

- The project check follows the agent's confinement (`checkEnvironment.ts`): a profile with the Bash sandbox on, or the `srt` provider, runs it under `srt` with writes limited to the checkout and ends `not_run` ("the sandbox runtime is not installed") without `srt`; only a profile without the sandbox runs a plain process; `container` stays not connected. `srtToolEnvironment` in `SrtProvider.ts` shares the command builder with the provider.
- Rung D accept compares the escaped path as well, so a name with a tab or a bidirectional character is held to the seen rule; a D that no reason or finding points at needs the summary mark or every hunk. The pane disables Accept for the same cases and matches reasons to odd file names.
- A sent-back changeset whose agent ends without new work, or whose capture fails, moves to the person with the new action `no_new_capture`; the user may also reject from `sent_back`.
- `requestRung` of `report_outcome` makes `agent.requested` at the next capture. A user escalation has its own subject, so a second escalation after a demotion applies.
- `review_accept_repo_change` (UI only) with an action on the repository alert, bound to the hash of the change in the alert payload. The alert is also posted for a captured changeset that carries `repo.ref_moved` or `repo.armed` that is not accepted yet.
- The user-level Claude files hashed for `reviewer.user_config_changed` now include skills, agents, commands, output styles, hooks, the plugin manifest and the scripts the settings name as hook commands.
- A policy that sets `outward` or `deployCommands` gets a warning on the swarm start (`beforeFirstLaunch` may return warnings). `file.large_unreviewed` is at rung D.
- Permission denials of an agent reach the capture facts, so `run.denials` can fire.
- The session view of `review_get` marks a hunk cut at the cap, wraps agent text in reason evidence, drops ref evidence, reviewer session ids, process ids and actor session ids.
- Pane: Escape closes the comment box and returns the focus; more hidden characters are escaped in `plainText`.
- `GitMerger` takes an optional `beforeMove` seam so a test can move the target between the tip and the swap.
- Mutation script: entries for each fix, for the module seams (list, get, merge and request escalation read as the user, daily limit, reviewer split, scratch agents), the git-level decisions (attributes, driver blanking, snapshot stop, merge swap) and the card rules; a name filter takes several fragments separated by `|`.

### Results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm coverage` | pass, no threshold failure; `review.ts` meets its own file thresholds from its own tests, and the thresholds of `src/main/**` and `src/main/modules/**` hold over the whole suite only |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 passed |
| `pnpm parity` | ok, `docs/parity.md` regenerated for the new command |
| `pnpm check:colours` | pass |
| `pnpm mutation` | one full run: no survivor; a skipped entry was an older entry whose text my change to `commands.ts` moved, fixed and run again: killed |

### What took long

- The first run of the new entries left survivors, each a missing test: the module's use of the profile provider, a failed capture after a send-back, the module's user-config paths and the attribute switch of the merge. The last needed the merge to run with the repository as the working directory, since git otherwise reads the attributes of the work tree.
- The module tests needed a real swarm with a started repository, because a session may use only a repository an earlier start used.
- Free disk stayed at about 3.2 GiB; no step ran below 3 GiB.

### Left, and why

- A merge that rebuilds a deleted checkpoint from the stored patch (0040 section 15.3): the merge still refuses. It is a feature, not a fix.
- Secrets in binary files and in large text files are still not read by the detectors; a large file now goes to rung D, a binary stays at B.
- A user's own commit on the target branch still counts as `repo.ref_moved`; the user now has the alert and the accept, and the changesets still need rung E. Leaving out moves of the checked-out branch by the user is a policy choice that needs the user.
- Plugin directories are hashed through the manifest only, and files imported by `CLAUDE.md` are not followed.
- `outward` and `deployCommands` are reported as not applied; the per-launch merge into `gate.json` is not built.
- `run.background_stopped` still never fires; denials of an agent are kept in memory and read as zero after an app restart.
- The inbox card in the visual phase still comes from the e2e backend, not from `ReviewInbox`.
- An e2e test for a user commit during a swarm, the alert, the accept and the merge: the module and unit tests cover each step, not the whole path.
- The real-Claude scripts were not run; this step changed no launch path.
