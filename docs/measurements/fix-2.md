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
