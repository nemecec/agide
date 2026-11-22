# review:r19-fix-3: review of the third fix step of the review ladder

Start: 2026-11-21 23:53 UTC (`date -u`). End: 2026-11-22 00:08 UTC.

## What was done

Read `docs/measurements/r19-fix-3.md`, the changed functions in `repoSnapshot.ts`, `GitCaptureService.ts`, `ProcessCheckExecutor.ts`, `checkEnv.ts`, `checkEnvironment.ts`, `srtSettings.ts`, `SrtProvider.ts`, `main/modules/review.ts`, `InMemoryReviewManager.ts`, `ReviewInbox.ts`, `PersistentSwarmManager.ts`, and the related parts of 0040, 0041 and 0042.

- Scratch tests (two temporary test files next to the capture tests, removed afterwards) attacked the accept: a `config.worktree`, a hook made executable, `info/attributes`, a link target, a tag created, an annotated tag moved, a replace ref and a user-level file, each changed between the alert and the accept. Every accept was refused, and the user-level change stayed visible. Probes outside the content binding: a hook over the size cap with its mtime restored, a hook past the entry cap, `core.hooksPath` and `include.path` pointing to files the agent writes. All of these were accepted or not seen.
- `srt` 0.0.83 is installed on this host now. A real check ran through `ProcessCheckExecutor` under `srt` with the settings the module builds. The cache home and the temporary directory are writable. Writes beside the cache directory and to the real home directory are denied and end `not_run` with the denial reason. A `cargo` check under the redirected home fails on both commits without a denial message. Checkpoint code that writes `$HOME/.npmrc` makes the base run fail right after it.
- `pnpm mutation` on the entries of this step: all killed. Afterwards every mutated source file was compared with a copy by `cmp`: identical. Hand mutations were run with a script under the temporary directory that restores each file; `cmp` afterwards: identical. The ones that survived are in the findings.
- `pnpm typecheck`, `pnpm check:colours`, `pnpm test` (with a real `srt` and container runtime, so no test was skipped): pass.

## What took long

The mutation subset, about ten minutes.

## Not done

`pnpm build`, `pnpm coverage`, `AGIDE_HIDDEN=1 pnpm e2e` and a full mutation run. The `srt` denial text on Linux was not checked. Without a git baseline for the uncommitted work, this review could not prove that only the reported files changed.
