# fix-2

Start: 2026-11-21 10:06 UTC. End: 2026-11-21 10:14 UTC (date -u).

Built: the blocker and major findings of the review of the fix step.

- Git guard: `Git.addWorktree` records the git directory git created; a later call refuses a `.git` file that names another directory or a directory inside the worktree. Attributes of the worktree are not read (`--attr-source` names the empty tree), so a `filter` driver of the repository configuration does not run. Tests: filter driver, git directory forged inside the worktree, pointer that differs from the record. Each fails without its fix.
- `removeWorktree` keeps a worktree whose stored patch does not apply: test with a Git whose `verifyPatch` throws.
- Process group termination: test with a grandchild in the leader's group.
- Leaf after a resume: module test with a session and a leaf already in the tree.
- Group resume skips an agent that is ending: test with a slow stop.
- Calibration is kept for each agent in the ledger.
- A close of a session by the user during its start ends the agent as stopped by the user; the runtime reports its own closes through `closedByRuntime`.
- Wording and the 0038 section updated.

Took long: arranging a stop that is still running during a group resume.

Not done: the calibration is not persisted across a restart; `leafOf` still scans the tree on a cache miss. No second reviewing agent was available in this run (no agent tool), so the review of this step is open.

## Second review fixes for the review ladder (R19)

Start: 2026-11-21T20:51:05Z. End: 2026-11-21T21:46Z.

### Built

- Accepting a repository change compares and stores one snapshot, so a ref, configuration or hooks change made during the accept is not absorbed. The stored hash of the user-level Claude files stays, so a change there keeps stopping reviewers after the accept. `expectedHash` is required in the command, the service and the pane.
- The alert names the armed categories and the first moved refs (cleaned inbox text). An alert without the hash of its change shows Open swarm only. A test passes a caller that is neither the user nor an MCP session and shows that the module refuses it.
- The project check gets a private temporary directory next to its checkout: it is in `writeDirs`, `TMPDIR`, `TMP` and `TEMP` name it, and it is removed with the checkout. The settings files of a check run are removed when the run ends (`release` on the environment of `srtToolEnvironment`).
- The write limit under `srt` is tested on the settings file that `-s` names, for the check environment and for the provider's `toolCommand`: the allowed paths equal the checkout and the temporary directory with their resolved forms.
- The user-level hash follows links (loop-safe, capped by entries and bytes) so a linked skill, agent, `CLAUDE.md` or `settings.json` is hashed by content. Hook commands add the program and the script of an interpreter for each simple command; arguments and directories are left out, a bare program is resolved through `PATH`, `~` and `$HOME` are expanded.
- A changeset that moved on `no_new_capture` has its own card message. The denial counts of an agent restart with each run.
- Mutation entries for each fix, and the corrections of `fix.md` named in the review.

### Not done

- Plugin directories are not hashed beyond the manifest, and reviewers do not get a configuration directory of their own (0040 open question 6).
- No real `srt` run: `srt` is not installed on this host, so the write limit and the temporary directory are verified on the generated settings and with a plain process only.

### Results

| Command | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm coverage` | pass, no threshold failure |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | all specs pass |
| `pnpm parity` | ok |
| `pnpm check:colours` | pass |
| `pnpm mutation` | no survivor; an entry was skipped because the module change moved its text, fixed and run again: killed |

### What took long

- The full mutation run, and the survivor among the new entries (a directory named as the script of an interpreter), closed with a test.
- The registry hides `review_accept_repo_change` from MCP callers, so the module's own caller check is reached in the test only with a caller of another kind.
