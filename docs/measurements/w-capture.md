# w-capture

Start: 2026-11-21T16:16:14Z (`date -u`). End: 2026-11-21T16:43:00Z.

## What was built

The capture, check, rules and policy slice of the review ladder (0040 sections 4 to 8, 17; 0041 w-capture row). Folders follow the task text (`capture`, `rules`, `policy`) and not the names of 0040 section 18.2 (`diff`, `check`, `reasons`): the parser, the hashes and the check executor sit in `capture/`, the reason rules in `rules/`.

| Module | Files | Behaviour |
|---|---|---|
| Guarded git | `capture/guardedGit.ts` | Every call has the git directory, `--attr-source` at the empty tree, `core.attributesFile=/dev/null`, `core.fsmonitor`, `core.hooksPath`, `core.pager`, signing, `core.autocrlf`, `core.safecrlf`, `core.filemode` and `core.symlinks` fixed, and an empty value for every `filter.<name>.clean`, `.smudge`, `.process`, `.required` and `merge.<name>.driver` that the effective configuration lists. Inherited `GIT_*` variables are dropped. `worktreeGitDir` checks the `.git` file of a worktree against the common directory. |
| Checkpoint | `capture/checkpoint.ts` | `snapshotTree` (temporary index, `read-tree HEAD`, `add -A`, `write-tree`), `commitCheckpoint` (`commit-tree`, `update-ref` with the zero old value), `readDiff` (tree against tree from the common directory without a work tree: `--raw -z`, the unified diff and the `--binary --no-renames` patch). |
| Diff parser | `capture/parseDiff.ts` | Files from `--raw -z`, hunks by the `@@` counts; binary, rename, mode change, type change (one file from two blocks), symlink, submodule, odd names, CRLF, no final newline, empty files; size limits (file bytes, changed lines, changeset bytes, file count, parse time) turn files into `large`; file, hunk hashes (a moved hunk keeps its hash, equal bodies get ordinals). |
| Check executor | `capture/ProcessCheckExecutor.ts`, `checkEnv.ts`, `outputRing.ts`, `runProcess.ts` | Fresh detached worktree of the checkpoint, setup and command through `toolCommand` of the isolation environment, scrubbed environment plus `CI=1`, one timeout for both steps, process group ended at the limit and when the leader exits, first 64 KiB and last 960 KiB of output in a log file, exit code and 8,000-character tail, queue with a concurrency limit, `cancel`, base comparison with the stored base run reused. |
| Repository snapshot | `capture/repoSnapshot.ts` | Hashes of the configuration files, the hooks directory, `info/attributes`, the user-level Claude files and the refs without the agent branches; `compareSnapshots`. |
| Capture service | `capture/GitCaptureService.ts`, `captureState.ts` | `prepare`, `capture`, `resumePending`, `compareRepo`, `acceptRepoChange` of `CaptureService`; jobs and snapshots in memory or in the review tables (`SqliteCaptureState`). |
| Rules | `rules/*.ts` | `DefaultRiskRules`: the check, size, diffusion, file, path, configuration, dependency, build, policy, test, secret, telemetry, claim and retry reasons of the catalogue with the policy's `rungs`, hard reasons only raised, and accumulation. |
| Policy | `policy/GitPolicyLoader.ts`, `mergePolicy.ts`, `defaults.ts` | `ls-tree` and `cat-file` from the base commit only; missing, malformed (not JSON, schema, link, size, encoding) and valid files; user overlay that only tightens; canonical JSON hash. |

## Shared files changed

- `core/isolation/types.ts`: `ToolLaunch` and `AgentEnvironment.toolCommand` (0022 amended in 0040 section 6).
- `core/isolation/HostEnvironment.ts`: default `toolCommand` for `local`.
- `core/isolation/SrtProvider.ts` and `srtSettings.ts`: `toolCommand` and `buildToolSrtSettings` (writes limited to the checkout and listed directories, no hosts or the development hosts).
- `core/isolation/ContainerProvider.ts`: `toolCommand` (`docker run -i`, checkout and write directories mounted, `--network none`, variable names only in the arguments).
- `core/isolation/FakeProvider.ts`: records `toolCommand`.
- New test `core/isolation/toolCommand.test.ts`.
- Not changed: `core/swarm/workspace/git.ts`. The guard additions of 0040 section 4.2 live in `capture/guardedGit.ts`, because the review capture works from the common directory and a worktree git directory, which the swarm `Git` class does not model, and because other builders edit the swarm files. The milestone 4 calls in `git.ts` (`collect`, `hasChanges`, `applyPatch`, `commitAll`) still lack `core.attributesFile`, the filter blanking and `core.autocrlf=false`; the integration step can switch them to `GuardedGit`.

## Decisions and deviations

- `size.run` adds the agent's merged changesets to the current one and ignores superseded and rejected ones. Every changeset diffs from the base, so adding a superseded one counts the same work twice, while a changeset after a merge carries only the new work. 0040 section 7.2 says "not rejected".
- Accumulation counts reason rows at the highest rung and adds one `accumulate` reason, once per assessment, never at E. The evidence lists the distinct ids.
- A reason that the policy's `rungs` names is lowered only when it is not hard; a hard reason takes the higher of its default and the policy value.
- `retry.limit` is raised when the check failed (not on the base too) and the send-backs of the changeset have reached `retryLimit`.
- `config.test_lint` and `deps.changed` classify a change of `package.json` from the hunks: the block opener when a hunk shows it, else the value (version-like for a dependency, shell-like for a script). A hunk that shows neither cannot be classified and may be missed.
- Secret detectors skip `large` and binary files; evidence holds path, first line, first detector and a list of line and detector pairs, never the matched text.
- The line-ending finding: with `core.autocrlf=input` (the host's global setting) `add -A` rewrote CRLF to LF for a new file, so the checkpoint differed from the file the agent wrote. The guard sets `core.autocrlf=false` and `core.safecrlf=false`; a test with a new CRLF file fails without it.
- `core.filemode=true` and `core.symlinks=true` are set, so a repository configuration cannot hide a mode change or a link.

## Contract notes for the integration step

- `GitCaptureService` takes an optional `snapshotTaken(subject)` callback, called when the work tree has been read or the capture ended without reading it, so the manager can release held messages.
- The snapshot's `armedAccepted` (what the user accepted from a `repo.armed` alert) is stored inside the `refs` JSON column of `review_repo_snapshots`, so migration 1 is unchanged.
- A merge that the app runs moves the target branch, which the next snapshot comparison reports as `repo.ref_moved`. The manager should call `acceptRepoChange` after its own merge, or the module should refresh the snapshot refs; `acceptRepoChange` also records an accepted configuration change, so a ref-only refresh needs a separate method if that matters.
- `CheckEnvironment` is the port the review module fills from the profile and the provider: `ready` with the environment, the profile launch environment and whether the network limit is enforced, or `unavailable` with the reason (for example `local` with the Bash sandbox on and no `srt`).
- `review/index.ts` is a contract file and was not changed; `capture/index.ts` and `policy/index.ts` export the new modules.

## Tests and mutation checks

`pnpm typecheck`: the only errors are in files of other builders (`core/swarm/manager/InMemorySwarmManager.ts`, `main/modules/review.ts`, `e2e/review.spec.ts`). `pnpm test`: all files of this slice pass; the run of the whole suite had one failure in `core/inbox/plainText.test.ts` caused by `renderer/panes/inbox/ReviewCardActions.test.ts` of w-ui.

Mutations applied one at a time with `/tmp` scripts and reverted; each was killed by the named tests.

| Mutation | Killed by |
|---|---|
| policy read from the worktree file | `never reads the work tree` and the malformed-file tests |
| hard reason lowered by the policy | `only raises a hard reason and never lowers it below its default` |
| matched secret text added to the evidence | `never puts the matched text into the reasons` |
| accumulation removed, counted over all reasons, or one reason too many | the accumulation tests, including the exact-threshold test |
| overlay takes the larger value | `takes the smaller of a number ...`, `leaves the project policy ...` |
| `core.autocrlf=false` removed | `records the bytes of the file even when the user configured line-ending conversion` (a first version of this test used a file already in the base and survived; it now uses a new file) |
| `--attr-source` removed, filter blanking removed, `core.hooksPath` removed | the `hostileConfig` tests |
| check environment not scrubbed | the environment tests |
| `size.run` counts superseded changesets | the `size.run` test |
| review ref overwritten | `refuses to overwrite an existing review ref` |
| repository comparison removed before the capture | the `repo.armed` tests |
| timeout kills the leader only | the timeout and cancel tests |

## What took long

The parser details (type change, matching blocks to `--raw` entries), the line-ending finding, and the survivors of the first mutation run. The isolation `toolCommand` for three providers was extra work beyond the task text, taken from 0041.

## Not verified

- A real `srt` run of a check: `toolCommand` for `srt` is checked as a command and a settings file only; whether `srt` accepts an empty `allowedDomains` list and still starts a process is not tried.
- A real container run of a check.
- The check against a repository with submodules, sparse checkouts or `git lfs`.
- `merge-tree` and the merge itself (w-manager's `Merger`) are not part of this slice.
- The capture with `GuardedGit` against git versions before 2.40 (`--attr-source`).
- A 20 MB file in the stored patch path was tested with 1.4 MB, not 20 MB, to stay inside the disk budget.

## Cleanup

Temporary files went under `/tmp/agide-w-capture/`. Removal with `rm -rf` was refused by the sandbox during the run; see the final report for what is left.
