# r19-fix-3: third fix step of the review ladder

Start: 2026-11-21 22:27 UTC (`date -u`). End: 2026-11-21 23:53 UTC.

## What was built

Findings of the review of the second fix step, the two majors first. Each fix has a test that fails without it; the mutation entries named below were run and killed (the changed source files were compared with `cmp` against copies taken before the run: identical).

### Major 1: the accept of a repository alert is bound to the content

- `repoSnapshot.ts`: `compareSnapshots` returns `armedContent` (the content hash now held by each changed category) and `userConfigContent`. The repository files (configuration files, the hooks directory, `info/attributes`) are hashed with the link-following walk of the user-level files (`hashFollowing`, now with per-walk limits for entries, depth and bytes: `USER_LIMITS`, `REPO_LIMITS`), through `hashFiles`; `hashPath` is gone. `takeSnapshot` lists `refs/replace` next to heads and tags.
- `GitCaptureService.ts`: `reasonsOf` puts `content` into the evidence of `repo.armed` and `reviewer.user_config_changed`, and `changesHash` (a hash of every ref change, not only the ones shown) into `repo.ref_moved`. `repoDifferenceHash` covers all three reasons (`ALERT_REASONS`). `acceptRepoChange` stores the user-level hash of the snapshot it compared, so an accepted alert clears a user-level change it showed and covers exactly its content.
- `ReviewInbox.ts` `describeRepoChange` names a user-level change and says that reviewers stay stopped until the accept.
- `main/modules/review.ts`: `review_accept_repo_change` catches a refused accept, calls `repositoryAlert` (which now returns what it posted) and rethrows a refusal that names the new change. `InMemoryReviewManager` gets the dependency `repositoryStopped`, called by `repositoryStopsReviewer`; the module passes `repositoryAlert`, so a reviewer that cannot start because of a repository or user-level change posts the alert.

### Major 2: the check under srt

- `checkEnv.ts`: `cacheEnvironment(directory)` (HOME, the XDG directories and the cache variables of npm, yarn, pnpm, pip, uv, cargo, gradle and go below one directory) and `checkCacheDirectory(dataDir, swarmId)`.
- `ProcessCheckExecutor.ts`: dependency `cacheDirectory`; a confined check (`enforcesNetwork`) gets the cache environment, the directory is created, and `writeDirs` are the temporary directory and the cache directory, nothing else. A setup that exits non-zero ends `not_run` with its exit code and no base run; a failed command of a confined check whose output shows a sandbox denial ends `not_run` with a reason that says so. The card shows the reason through `check.not_run`.
- `main/modules/review.ts`: `cacheDirectory` is wired to `review/<swarm id>/check-cache` below the data directory; the cache directory is removed when the manager emits `swarm.removed`.

### Minors

- `PersistentSwarmManager.ts`: the denial counts are reset in `continueAgent` when the agent was in an ended state (a new run), no longer in `launch`, so a resumed run keeps the denials of its first part.
- Refused accept: see Major 1 (`review.ts`). Reviewer stop alert: see Major 1 (`repositoryStopped`).
- User-level change: the alert now shows it with its content hash and the accept covers it.
- Links in the hooks directory, `info/attributes` and the configuration files are followed to their content (see Major 1).
- 0041: the `CaptureService` line and the accept line match `acceptRepoChange(swarmId, expectedHash)`; the counts in the fix and fix-2 reports and in the earlier prose were dropped.

## Changed files and functions

| File | Functions and values |
|---|---|
| `app/src/core/review/capture/repoSnapshot.ts` | `hashFollowing`, `newWalk`, `hashFiles`, `worktreeConfigs`, `takeSnapshot`, `compareSnapshots`, `SnapshotDifference`, `WalkLimits`, `USER_LIMITS`, `REPO_LIMITS`; `hashPath` removed |
| `app/src/core/review/capture/GitCaptureService.ts` | `acceptRepoChange`, `reasonsOf`, `repoDifferenceHash`, `ALERT_REASONS` |
| `app/src/core/review/capture/ProcessCheckExecutor.ts` | `CheckExecutorDeps.cacheDirectory`, `runTarget`, `toolCommand`, `SANDBOX_DENIAL` |
| `app/src/core/review/capture/checkEnv.ts` | `cacheEnvironment`, `checkCacheDirectory` |
| `app/src/core/review/capture/index.ts` | exports |
| `app/src/core/review/manager/ReviewInbox.ts` | `describeRepoChange` |
| `app/src/core/review/manager/InMemoryReviewManager.ts` | `InMemoryReviewManagerDeps.repositoryStopped`, `repositoryStopsReviewer` |
| `app/src/core/review/types.ts` | comment of `CaptureService.acceptRepoChange` |
| `app/src/main/modules/review.ts` | `review_accept_repo_change` handler, `repositoryAlert`, the manager construction, `pipelineServices` (`cacheDirectory`), the `swarm.removed` branch of the swarm subscription |
| `app/src/core/swarm/manager/PersistentSwarmManager.ts` | `launch`, `continueAgent` |
| `app/scripts/mutation-checks.mjs` | entries of the accept, snapshot, check, repo alert and telemetry areas (new, changed or removed) |
| Tests | `GitCaptureService.test.ts`, `ProcessCheckExecutor.test.ts`, `swarmIntegration.test.ts`, `review.test.ts` (module), `ReviewInbox.test.ts` |
| Docs | `docs/decisions/0040` (section 6, the snapshot table, section 17), `0041`, `0042`, `app/README.md`, `docs/measurements/fix.md`, `fix-2.md`, this file; `docs/parity.md` is rewritten by `pnpm parity` |

## Surface checked

Paths through which an agent could change what the user accepted after looking at it:

| Path | Result |
|---|---|
| Alert hash, same category, other content (config, hook added to a changed hooks directory) | covered by content hashes; tests |
| Alert hash, refs past the ones shown, a moved ref moving again | covered by `changesHash` and the old and new ids; tests |
| User-level Claude files changed after the alert | covered; test |
| Links to config, hooks, `info/attributes` | followed to content; tests |
| `refs/replace` | now listed; test |
| Tags and branches | listed since the earlier steps; tags keep the annotated object id |
| Accept racing a change | one snapshot is compared and stored (earlier step, test kept) |
| Check cache poisoning | a cache entry reaches the later checks of the same swarm only (design 0040 section 6) |

Not covered, by design or for lack of a safe signal: files named by `include.path` in the configuration (outside the snapshot); the `HEAD` file and `refs/remotes` of the main checkout (the user's own checkout and fetch change them); `info/exclude`; content past the walk caps of a linked directory (a link in the hooks directory to a very large directory is read up to the cap).

Left out of the findings: showing the changed configuration keys in the alert. The alert names the changed categories and the content hash decides the accept; the keys would need the configuration content in the stored snapshot.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm coverage` | all test files pass, thresholds hold |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | all specs pass |
| `pnpm parity` | ok |
| `pnpm check:colours` | pass |
| `pnpm mutation` | one full run at the end: every entry killed, none survived or skipped |

## What took long

The full mutation run (about an hour and a half on a busy machine). The rest was the scenario tests for the swarm denial counts and the executor.

## Not finished or not verified

- No real `srt` is installed on this machine: the check under a real sandbox was not run. The executor tests verify the launch the provider receives and the settings file that `srtToolEnvironment` writes.
- No real-Claude script was run.
