# review-fix-m4

Start: 2026-11-21T09:57:28Z
End: 2026-11-21T10:05Z

Independent review of the fixes for the swarm runtime and swarm UI review findings. No code was changed.

## What was done

- Ran the checks in a temporary copy of `app/` (with `docs/` and `probes/` beside it), installed with `pnpm install --frozen-lockfile`. A copy with a symbolic link to the repository's `node_modules` does not work: pnpm's dependency check refuses to run install over a modules directory outside the project.
- Read the changed code for each blocker and major finding.
- Reverted each fix in the copy, ran the tests that cover it, and restored the file. Each restored file was compared byte for byte with the original.
- Probed the git guard with a filter driver in the repository configuration and with a git directory forged inside the worktree.

## Commands

| Command | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm coverage` (first run) | all test files pass, thresholds met; statements 89.58, branches 81.19 |
| `pnpm coverage` (second run) | all test files pass, thresholds met; statements 89.58, branches 81.21 |
| `pnpm e2e` | all specs pass with hidden windows, 2.3 minutes |
| `pnpm parity` | parity ok; output identical to `docs/parity.md` |
| `pnpm check:colours` | no colour literal outside the allowlist |

## Findings

- The git guard still lets an agent run a command on the host. A filter driver from the repository configuration with a `.gitattributes` in the worktree runs under `hasChanges` and `collect`. A git directory forged inside the worktree, whose `gitdir` file names the worktree, passes the guard, and its configuration then runs.
- Fix reverts that no test catches: the process-group signal in `recover`, the `verifyPatch` call before a forced removal, and the tree leaf lookup after a restart.
- A word from the style rules' banned list appears in `git.ts` and in `fix-m4-review.md`.

## Not finished

- The real-Claude scripts and `pnpm mutation` were not run.
- No second agent reviewed this review: the session has no sub-agent tool.
- The temporary copy `/tmp/rev-fix-m4` (about 613 MB, with its installed `node_modules`) could not be removed, because the removal command was denied.
