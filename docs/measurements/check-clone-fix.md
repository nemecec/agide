# check-clone-fix: per-run cache clones for the confined project check

Start: 2026-11-22 12:01:47 UTC (`date -u`). End: 2026-11-22 13:56 UTC.

## What was built

The user's decision of 2026-11-22 for the two majors of the review of the third fix step (0042, question 3): a confined check no longer has a cache directory that its runs share, and no longer has `HOME` pointed at an empty directory.

- Every check run, the checkpoint run and the base run alike, gets a directory of its own below `<task base>/review-check-caches/<profile id>/<run id>` with APFS clones of the cache subtrees of the tools it needs. Each tool is pointed at its clone through its own variable. The directory is removed when the run ends (pass, failure, timeout, cancel, clone failure), and the review module removes what a killed app left when it starts.
- `HOME` is the real home directory and stays readable; toolchains are used where they are.
- The tool table is data (`cacheTools.ts`) and each entry was run against the real tool under a real `srt` 0.0.83 (installed into a temporary prefix for this pass, found through `AGIDE_SRT_BIN`).
- A clone that cannot be made ends the run `not_run` with the reason; there is no copy and no shared cache instead.
- A failed check whose output shows an environment problem ends `not_run` instead of `failed` or `failed_on_base`.
- The check environment is built from a list of names, and the check may not read the app's data, logs and crash dumps, the profile's tool credentials and the credential locations of the home directory.

## Deviations and choices

- A run clones only the tools that its commands name or that marker files at the root of its checkout (and one directory below) point to. Cloning every tool on the host would add the pnpm store (about 104,000 files) and the Gradle module cache to every run. A tool that is not selected gets no redirection and its writes into the real home are refused.
- The Gradle wrapper distribution is cloned, one distribution only (the one `gradle-wrapper.properties` of the checkout names, read through a size-capped read that does not follow links). A read-only link to the real `wrapper/dists` does not work: `gradlew` fails with `Operation not permitted` on the `.lck` file in the distribution directory under `srt`.
- pnpm gets its metadata cache as a second clone: pnpm 11 checks even a frozen lock file against the package metadata and fails with `ERR_PNPM_NO_OFFLINE_META` without it. pnpm 11 reads `pnpm_config_store_dir` and ignores `npm_config_store_dir`, so both names are set.
- Gradle gets `GRADLE_OPTS=-Dorg.gradle.daemon=false`: without it a daemon stayed alive after the run, outside the process group (seen with the first manual run).
- Clones only for a confined check. An unconfined check (a profile without the Bash sandbox) has the rights of its agent and keeps the profile home and no redirection, as before.
- The executor reuses a stored base result only when it is `passed` or `failed`; a `not_run` or `timed_out` base is run again. The store returns the first base row of a commit whatever its outcome, so without this a transient failure of the environment would stay the base result of every later changeset. The store itself is not changed.
- The environment of the check is an allow list (`CHECK_ENV_NAMES`, `CHECK_ENV_PREFIXES`) in place of the whole profile environment minus credentials, because the profile environment is a copy of the app's environment (D4). A name that a project needs and that is not listed goes into `check.env` of its policy.
- The 401 and 403 patterns need an HTTP context (`status`, `code`, `http`, `error` near the number, or the words `Unauthorized` or `Forbidden` next to it), and the plain words `Unauthorized` and `Forbidden` match alone. A bare number is no evidence.
- The credential locations of the real home (`.ssh`, `.gnupg`, `.aws`, `.netrc`, `.git-credentials`, `.pypirc`, `.config/gh`, `.docker/config.json`) and the profile's `tools` directory are denied for reads in addition to the list of D7. Files that tools read by default (`~/.npmrc`, `~/.m2/settings.xml`, `~/.gradle/gradle.properties`) stay readable, since denying them can break the tool; the doc says so.
- Limits (D5): a subtree of more than 200,000 files is not cloned, and all clones of a run must finish within 120 s.
- `srtSettings.ts`: the denied reads of a tool launch are listed in both spellings (link and resolved), since Seatbelt matches resolved paths.
- `ModuleContext` (`main/context.ts`) gains the optional `protectedReadDirs` and `main/index.ts` sets it to the logs and crash dump directories; both are shared files with a one-line change.

## Routes checked

| Route | Result |
|---|---|
| A run writes into the cache that the base run or a later capture uses | No shared directory exists. Unit test with the fake provider and real `srt` test: a checkpoint run that writes an `.npmrc` with `script-shell` and a file in the cargo registry clone leaves the real directory listing (names, sizes, times) unchanged, the base run passes, and a second run sees the pristine cache. |
| The stored base result | Reused only for `passed` and `failed`; both come from a clone made from the real caches, which a check cannot write. |
| Symbolic links inside a clone | `cp -c` copies links; the walk after the clone removes every link, special file and excluded name before the tool starts (test with a fixture that holds links to a directory and a file, a FIFO and every excluded name). A link that the run makes itself in its clone cannot be written through: `srt` refused the write through a link to a real file. |
| Hard links | `cp -c` makes a file of its own, so a hard link in the real tree (the pnpm store) does not reach the clone's inode. A hard link that the run makes from a real file into its clone is refused by `srt` (`ln` fails with `Operation not permitted`; checked by hand). |
| The pnpm store | Cloned whole with its `index.db`; the real pnpm 11 installs from the clone offline under `srt` and the fixture store is unchanged afterwards. |
| A clone still being written while the next one starts | The process group is ended with SIGKILL after the leader exits, before the clone is removed. A process that left the group (a build daemon) keeps only the write rights of its own run; clone directories are named by a random run id, so no other run uses the directory. Removal that fails because such a process writes into the directory does not fail the check; the sweep at the next start removes the rest (unit test with an injected remover). Gradle's daemon is switched off. |
| A swarm removed while a check runs | The clone belongs to the run, not the swarm; the swarm.removed cleanup of the old cache directory is gone. The checkout is removed by the run as before. |
| Two captures at once | Each run has its own run id, checkout, temporary directory and clone directory; `maxConcurrentChecks` still limits the count. |
| A clone cancelled while it is made | `cp` is ended through the abort signal, the directory is removed, the run ends `not_run` with "the check was cancelled" (unit test). |
| The source of a clone is a link or on another volume | The clone starts from the resolved path; the device of the source and the clone directory must match and, on macOS, the volume must be APFS, else `not_run` with the reason (unit tests of the decision; the probe on this host sees two temporary directories on one APFS volume). A real second volume was not used for a clone: an HFS+ RAM disk was made and ejected again to read its `statfs` type and device number only. |
| Gradle wrapper properties written by the agent | Read only as a regular file under 64 KiB, never through a link, and the name must be a plain directory name; a name with `..` or a space is refused (unit tests). |
| Credentials in the clone or the environment | Excluded names are removed from every clone; the environment is an allow list; the `denyRead` list holds the data directory, logs, crash dumps, the profile's tools and the home credential locations. The module test reads the settings file that the real executor wrote for the check and finds them. |

## Changed files and functions

New, in `app/src/core/review/capture/`:

- `cacheTools.ts`: `CACHE_TOOLS` (gradle, maven, cargo, npm, pnpm, pip, uv, go: `parts`, `environment`), `selectTools`, `commandWords`, `gradleDistributionOf`, `readProjectFacts`, `EXCLUDED_FILES`, `EXCLUDED_DIRECTORIES`.
- `CheckClones.ts`: `CheckClones` (`create`, `sweep`), `cloneCommand`, `cloneWithCp`, `cloneRefusal`, `probeCloneable`, `prune`, `removeTree`, `CloneError`, `DEFAULT_CLONE_LIMITS`, `APFS_TYPE`.
- `environmentErrors.ts`: `ENVIRONMENT_PATTERNS`, `findEnvironmentProblem`, `environmentNotRunReason`.
- `checkDenyRead.ts`: `checkDenyRead`, `HOME_CREDENTIAL_PATHS`.
- Tests: `cacheTools.test.ts`, `CheckClones.test.ts`, `environmentErrors.test.ts`, `checkDenyRead.test.ts`, `ProcessCheckExecutor.srt.test.ts` (real `srt` and real tools; skipped without them).

Changed:

- `checkEnv.ts`: `cacheEnvironment` and `checkCacheDirectory` removed; `checkEnvironment(profileEnv, allowed, home)` builds the environment from `CHECK_ENV_NAMES` and `CHECK_ENV_PREFIXES`.
- `ProcessCheckExecutor.ts`: `CheckExecutorDeps.clones` replaces `cacheDirectory`; `Active.abort`; `run` (reuse of a stored base result only for `passed` and `failed`), `cancel` (aborts a clone in progress), `runTarget` (project facts, clone, environment, removal in `finally`, `not_run` for a failed clone and for an environment problem); the `SANDBOX_DENIAL` pattern is replaced by the table.
- `ProcessCheckExecutor.test.ts`: the cache tests are replaced by clone tests; new tests for the environment list, the stored base result, the environment patterns, the failed and cancelled clone.
- `checkEnvironment.ts`: comment only. `index.ts`: exports.
- `app/src/core/isolation/srtSettings.ts` (`buildToolSrtSettings`: denied reads in both spellings) and `srtSettings.test.ts`.
- `app/src/main/modules/review.ts` (`pipelineServices`: `checkDenyRead` for the `srt` settings, `CheckClones` with its sweep, `clones` for the executor; the `swarm.removed` cache cleanup and the `rm` import are removed) and `review.test.ts` (the cache cleanup test is replaced by the sweep test; new test of the denied reads in the settings file).
- Shared files, one-line changes: `app/src/main/context.ts` (`protectedReadDirs`) and `app/src/main/index.ts` (sets it).
- `app/scripts/mutation-checks.mjs`: the entries named above.
- Records: `docs/decisions/0040-review-ladder-design.md` (section 6: isolation, cache clones, tool table, what a clone holds, no clone, reads, environment, outcomes, base comparison; three rows of the security table; the not-verified line), `0041-milestone-5-architecture-and-contracts.md` (contract lines), `0042-milestone-5-results.md` (the review row, the slice row, the open rows, question 3), `app/README.md` (the check paragraphs).

## Clone timings measured

`cp -cR` into a fresh directory on this machine's APFS volume (the volume is 98 percent full, one run each, times in whole seconds; "removal" is `rm -rf` of the clone). The files are those of the real home of this machine.

| Subtree | Files | Clone | Removal |
|---|---|---|---|
| `~/.m2/repository` | 7,046 | 2 s | 1 s |
| Cargo `registry/cache` | 2,555 | under 1 s | under 1 s |
| Cargo `registry/index` | 1,520 | 1 s | under 1 s |
| npm `_cacache` | 14,516 | 4 s | 3 s |
| pip cache | 646 | under 1 s | under 1 s |
| Gradle `caches/modules-2` | 28,471 | 13 s | 9 s |
| one Gradle wrapper distribution | 719 | under 1 s | under 1 s |
| pnpm store | 104,076 | 19 s | 7 s |
| pnpm metadata cache | 1,867 | not timed alone | not timed alone |

The Gradle module cache measured 5 s in the design discussion and 13 to 15 s here; the rate is between about 2,000 and 6,000 files per second depending on the tree. A whole Cargo home (119,000 files) or the Gradle wrapper directory (167,000 files) is not cloned for that reason.

Real `srt` tests (`ProcessCheckExecutor.srt.test.ts`, one run each, including clone, run and removal):

| Test | Time |
|---|---|
| poisoned clones, real directories unchanged, base run clean, second run clean | 0.8 s |
| write into the home refused, `not_run` | 0.3 s |
| read of the data directory and of `.ssh` refused | 0.7 s |
| the environment of the app does not reach the check | 0.3 s |
| `cargo --version` and `cargo metadata --offline` through `rustup` with the `CARGO_HOME` clone | 2.0 s |
| `npm install --offline` from the cloned cache with the registry gone | 1.2 s |
| Maven resolves a parent POM from the cloned repository | 1.3 s |
| Gradle through `gradlew` and the cloned distribution, dependency from the cloned module cache | 33 s |
| pnpm install from the cloned store and metadata cache | about 8 s |
| pip and uv read their cloned caches | about 1 s each |

## Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage` (default environment, no `srt` on the path) | 273 test files pass, 1 skipped; 3231 tests pass, 26 skipped, 2 expected failures; statements 91.12, branches 83.09, functions 90.53, lines 93.44; `src/core` lines 97.14 (threshold 97) |
| CI-like `vitest run --coverage` (a directory with one symlink named `node`, `PATH=<it>:/usr/bin:/bin:/usr/sbin:/sbin`) | 273 files pass, 1 skipped; 3215 tests pass, 42 skipped, 2 expected failures; `src/core` lines 97.14, branches 86.40 (thresholds 97 and 85): a margin of 0.14 points on lines; `src/core/review` lines 98.32 (threshold 98) |
| Suites with `srt` found (`AGIDE_SRT_BIN` set) | the review, isolation and main suites pass, including the real `srt` and tool tests |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 passed |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | passes |
| New mutation entries, run alone | all killed (list below) |
| Full `pnpm mutation` (13:14 to 13:55 UTC, nothing else running beside it) | 372 killed, 0 survived, 1 skipped: the text of the entry "the leftover clones are not swept" no longer matched after the remover became injectable; the entry was corrected and killed in a filtered run |

New mutation entries in `scripts/mutation-checks.mjs`: the base run shares the clone directory of the checkpoint run; the clone directory stays after the run; HOME points into the clone directory again; a failed clone runs the check without a clone; the environment-error rule is removed; a stored base run that did not run is reused; an excluded credential file stays in a clone; an excluded directory stays in a clone; a link stays in a clone; a cache over the file limit is cloned; a cache on another volume is cloned; the volume of the cache is not compared; the leftover clones are not swept; the environment is not limited to the list; the data directory is readable by the check; the denied paths are not resolved; the review module does not sweep the clone root; the data directory is left out of the denied reads of the module. Five entries of the old cache directory design were removed (the cache directory not writable, HOME outside the cache directory, the cache environment for an unconfined check, the sandbox denial text, the cache directory kept after the swarm).

## What took long

Finding that `cp -c` falls back to a copy across volumes (the macOS man page says so), so the volume check had to come first; Node's `copyFile` with `COPYFILE_FICLONE_FORCE` returns `ENOSYS` on macOS and could not be used. The pnpm entry: pnpm 11 ignores the `npm_config_` store variable, needs the metadata cache, and is a corepack shim that lives below the real home, which is why the pnpm test uses the real home with a fixture store. A deadlock in my first npm test (a synchronous `npm install` blocked the process that served the registry). The Gradle wrapper and the daemon.

## What was not verified

- Go: the entry follows the documentation; Go is not installed. Yarn has no entry.
- Maven resolution of a dependency or a plugin: the local repository of this machine lacks the plugins of the installed Maven, so the test resolves a parent POM from the clone and shows that all writes go to the clone.
- pip and uv: the test shows that each reads its cloned cache through the variable; no package was installed. pnpm versions older than 11 were not run (they read the `npm_config_` names that the entry also sets).
- Gradle toolchain downloads (`~/.gradle/jdks`), Cargo `config.toml` mirrors and Maven `settings.xml` mirrors: not cloned or read in place, so a project that needs them may end `not_run`; not run.
- A check with `check.network: development` under `srt`; an unconfined check under the new environment list against a real project.
- The Linux path (`cp --reflink=always`) and a real clone across two volumes (the fallback of `cp -c` is from the man page, not observed). The default test suite tests the refusal decision by a pure function.
- A real run of the application with a worktree agent and a check through the clone (the end-to-end suite uses the default profile, which has no Bash sandbox and runs the check as a plain process; the module test uses a fake `srt`).
- Time and file limits were set from the timings above, not from a field run.

## Leftovers

Removal was denied by the permission system for `/tmp/agide-check-clone-fix` after its first removal attempt (a command that also named other paths) and again for single paths, so nothing below it was removed and no other form was tried. Everything of this pass that remains is under that directory, about 3.6 GB of logical size of which the clone directories are copy-on-write on the same volume:

- `/tmp/agide-check-clone-fix/srt` (19 MB, the `srt` 0.0.83 install used through `AGIDE_SRT_BIN`)
- `/tmp/agide-check-clone-fix/c1` (a clone of the Gradle module cache and of one wrapper distribution) and `/tmp/agide-check-clone-fix/m2c` (a clone of the Maven repository), made by hand in the first Gradle and Maven trials
- `/tmp/agide-check-clone-fix/g`, `gw`, `guh`, `m`, `pn`, `pn2`, `pnpmhome`, `hl`, `w`, `bench`, the settings files `s*.json`, `ci-bin` (a directory with one symlink named `node`, for the CI-like run) and the logs of the runs

The tests of this pass remove their own temporary directories (`agide-*` under the system temporary directory; a normal run leaves none). Leftover `agide-*` directories there are from earlier killed runs of other steps and from a vitest process that this pass had to kill after a deadlock in a first version of the npm test; they were not told apart from other agents' directories and were not removed.

The one Gradle daemon that the first manual run left (outside any process group) was ended by hand. A RAM disk made to read the `statfs` type of a second volume was ejected again. Free disk was 9.9 GiB at the start and 7.7 GiB at the end; it did not go below the 3 GiB floor.

## Second pass: check-clone-fix-2

Start: 2026-11-22 14:18:08 UTC (`date -u`). End: 2026-11-22 16:46 UTC.

The independent review of the first pass (`docs/measurements/review-check-clone-fix.md`) found one major and seven minors. This pass changes only what each finding needs.

### What was built

| Finding | Change |
|---|---|
| Major: a process that the checkpoint run detaches (`setsid`) survives the run, holds a loopback port and makes the base run fail with `Address already in use`, which reads as `check.failed_on_base` and is stored | Every run carries `AGIDE_CHECK_RUN=<run id>` and `AGIDE_CHECK_OWNER=<app pid>`. `ProcessSweep.ts` lists processes with `ps -axwwE` and the working directories with `lsof -d cwd`, ends the processes of a run when the run ends (before the checkout, the temporary directory and the clones go) and the processes of earlier runs when a run starts, and reads the attribution of the pid again right before each kill. A checkpoint run with survivors is not compared with the base; a base run with survivors, or a run whose process list cannot be read, ends `not_run`. |
| Same volume: `st_dev` is equal for the sealed system volume and the data volume | The filesystem that `df -P` names is compared as well (`filesystemOf`, `cloneRefusal`). |
| Missing JDK messages end `failed_on_base` | Patterns for `Unable to locate a Java Runtime`, no `java` command, an invalid `JAVA_HOME`, a pyenv version that is not installed and an nvm version that is not yet installed. |
| `denyRead` names only the current profile | `checkDenyRead` takes the app root (the parent of `profiles/`), which holds every profile's data, tools and Claude directories and the registry. |
| A killed app leaves checkouts, temporary directories and settings files | `sweepCheckLeftovers` (`checkLeftovers.ts`) ends the processes, then removes the clones, the checkouts below `review-checks/<profile id>` with their `-tmp` directories and the `srt` settings files; the executor waits for it (`ready`). The checkout root gained the profile id so that another profile's checkouts are not swept. |
| Bare words turn a real failure into `not_run` | The patterns for a refused connection, a failed lookup, a network that is unreachable, a 401 or 403 and `Unauthorized` or `Forbidden` have `needsBase`: the run stays `failed` (and is sent back) unless the base run fails with the same pattern, which ends both runs `not_run`. A stored base failure with such a word is not reused. The card shows the matched line (control and format characters removed, cut to 160 characters). The sandbox patterns stay immediate, as the instruction said. |
| `NVM_` lets `NVM_AUTH_HEADER` in; the check environment is not free of proxy credentials | The prefix is replaced by the four directory names (`NVM_DIR`, `NVM_BIN`, `NVM_INC`, `NVM_CD_FLAGS`); names that contain `AUTH` or `CREDENTIAL` or end in `_HEADER` or `_CREDENTIALS` are scrubbed; 0040 and the README now say that the check environment carries no credential of the user and that the proxy credentials of `srt` only authenticate to the run's own proxy and are random for each run. |
| The real-tool tests compare counts | Cargo (`registry/cache` and `registry/index`) and Gradle (the named wrapper distribution and the module entries of the dependency) compare names, sizes and times before and after. |

### Deviations and choices

- The environment of a process is not visible for every process. Probe on this host: `ps -E` shows the environment of `python3`, `node` and `bash` processes and none of `/bin/sh` and `/bin/sleep` (system programs with the `restricted` flag). A daemon that executes one of those escapes the marker. The second attribution, a working directory below the run's checkout, temporary or clone directory, covers a daemon that does not `chdir` away; a descendant that clears its environment and changes its directory is not found. This residual is in 0040 section 6, "Not verified", and in 0042.
- `lsof -p <pid>` prints every process when the pid does not exist (exit 1); `inspect` filters by pid.
- The sweep kills the process group of a survivor as well, but never the app's own process, its group or pid 1.
- A start sweep that finds processes of an earlier run ends only a base run `not_run`; a checkpoint run goes on and notes them in its log, since a failure that they cause there is `check.failed`, which is the conservative reading.
- No reason was added to the catalogue for a check that passes and leaves processes behind; the check record has no field for it and the note in the log is the evidence. A failed checkpoint shows the note at the head of its output tail, which `check.failed` copies.
- The clone is not strict beyond the volume test: `clonefile(2)` has no command that fails instead of copying, Node's `copyFile` with `COPYFILE_FICLONE_FORCE` returns `ENOSYS` on macOS, and a free-space check is noisy. A file that `clonefile` refuses inside one volume is copied by `cp -c`; the copy is a file of its own, so only the cost differs.
- The module sweep runs at module start; the review module tests have a 15 s wait (was 5 s) because every run now lists processes twice or more, about half a second each.
- `startAppModules` (shared test helper) takes an optional `profile`, one line, so the module test can use an app root that differs from the data directory.

### Routes checked

| Route by which a checkpoint run could influence the base run, a later capture, another swarm or the real directories | Result |
|---|---|
| A detached process that holds a port or a socket | Ended by the end sweep (marker or working directory) before anything is removed; real `srt` test with a Python daemon (`os.setsid()`, bound loopback port): dead after the run, port free, no base row, next run finds no survivor. Without the sweep the test fails (checked by removing both sweeps). |
| A process whose image hides its environment | Found by its working directory when that lies in the run's directories (real `srt` test with a daemon that executes `/bin/sleep`). Not found when it also changes directory (open). |
| A process that outlives the app | Found at the next start (module sweep) by marker or directory when its owner is gone; a process of an app that lives is left alone (real process test). |
| A process of another run in flight | Not touched: the start sweep skips live run ids, the end sweep selects one run id; unit tests with a fake table and real processes. |
| A pid reused between listing and kill | The marker or directory is read again for the pid right before the signal (unit test). |
| A listing that fails | The run ends `not_run`, or is not compared; never `failed_on_base` (unit tests). |
| A hostile process line that imitates a listing row | A kill needs the same pid to carry the marker when read again alone; a line printed by a process cannot make the app kill another pid. |
| Files in the checkout and temporary directories | Removed after the sweep; a run id is never reused. A survivor that was not found could recreate its directories; the sweep at the next start removes them. |
| `srt` settings files | Written by the app, one per launch key, released at the end of the run, outside the check's writable paths; the sweep at start removes the stale ones. |
| Clones | One directory per run, removed after the sweep; swept at start. |
| Another profile's data, tools, Claude directories and the registry | Denied for reads with the app root (real `srt` and module tests). |
| Another swarm's checkout or worktree below the task base | Readable by the check, as it is by the agent; not changed. |
| Processes started through launchd or LaunchServices (`open`, `launchctl`) | Not verified whether the `srt` profile allows them; such a process has no marker and no directory. |
| Stored base results | Only `passed`, or `failed` without a word of the environment, are reused; a base run with survivors is `not_run` and not stored as a result. |

### Changed files and functions

New, in `app/src/core/review/capture/`: `ProcessSweep.ts` (`CheckProcessSweep` with `endRun` and `endStale`, `systemProcessTable`, `parseMarkedProcesses`, `parseWorkingDirectories`, `runOfPath`, `environmentListing`, `sweepNote`, `CHECK_RUN_VARIABLE`, `CHECK_OWNER_VARIABLE`), `ProcessSweep.test.ts` (including real detached processes), `checkLeftovers.ts` (`sweepCheckLeftovers`), `checkLeftovers.test.ts`.

Changed:

- `ProcessCheckExecutor.ts`: `CheckExecutorDeps` (`processes`, `ready`), `run` (waits for `ready`; no base comparison after survivors; `usable` stored base; `compared`), `runTarget` split into `runTarget` and `execute` (live run ids, start sweep, marker in the environment, end sweep in `finally` before removal, notes at the head of the tail, a base result with survivors becomes `not_run`).
- `environmentErrors.ts`: `needsBase`, `findEnvironmentProblem` (strong patterns only), `findUnconfirmedProblem`, `matchedLine`, `environmentNotRunReason(pattern, output?, { sameOnBase? })`, three toolchain patterns.
- `CheckClones.ts`: `VolumeFacts`, `cloneRefusal`, `filesystemOf`, `probeCloneable`.
- `checkEnv.ts`: `isScrubbedName`, `CHECK_ENV_NAMES`, `CHECK_ENV_PREFIXES`.
- `checkDenyRead.ts`: `appRoot` in place of `dataDir`. `index.ts`: exports.
- `app/src/main/modules/review.ts` (`pipelineServices`: sweep of leftovers, `CheckProcessSweep`, per-profile checkout root, `appRoot` in the denied reads) and `app/src/main/appForTests.ts` (`profile` option, shared helper, one line).
- Tests: `CheckClones.test.ts`, `ProcessCheckExecutor.test.ts`, `ProcessCheckExecutor.srt.test.ts`, `environmentErrors.test.ts`, `checkDenyRead.test.ts`, `src/main/modules/review.test.ts`.
- `app/scripts/mutation-checks.mjs`: new entries and repaired texts (see below). Records: 0040 (section 6, security table, not verified), 0041, 0042, `app/README.md`.

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage` (default environment, no `srt` on the path) | 275 test files pass, 1 skipped; 3313 tests pass, 28 skipped, 2 expected failures; statements 91.19, branches 83.2, functions 90.6, lines 93.5; `src/core` lines 97.17 (threshold 97), branches 86.53, `src/core/review` lines 98.38 (threshold 98) |
| CI-like `vitest run --coverage` (a directory with one symlink named `node`, `PATH=<it>:/usr/bin:/bin:/usr/sbin:/sbin`) | 275 files pass, 1 skipped; 3297 tests pass, 44 skipped, 2 expected failures; `src/core` lines 97.18 (margin 0.18 points), branches 86.51 (85), `src/core/review` lines 98.41 (98) |
| Suites with `srt` found (`AGIDE_SRT_BIN=~/Library/pnpm/bin/srt`): `src/core/review`, `src/core/isolation`, `src/main` | 72 files, 1317 tests pass, including the real-tool tests |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 passed |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | passes |
| New and repaired mutation entries, run alone | all killed; the first run left the entry "the runs do not wait for the sweep of a killed app" alive, a module test with a slow first `lsof` was added and the entry is killed |
| Real `srt` regression test without the fix (end sweep and start sweep replaced by nothing) | the daemon test fails |
| Full `pnpm mutation` (15:29 to 16:41 UTC, nothing else running beside it) | 412 killed, 0 survived, 3 skipped: the texts of three older entries (the token variables of the check, the temporary directory in the environment, a failed setup) no longer matched after this pass changed the lines they replace; the entries were repaired while the run was in progress and killed in a filtered run |

Real `srt` tests added or changed (one run each, with the clone, the run and the removal):

| Test | Time |
|---|---|
| detached Python daemon with a bound port: ended, port free, no base row, next run clean | 3.4 s |
| detached process that executes `/bin/sleep`, found by its working directory | 2.6 s |
| read of the data directory, of another profile's data directory, of the registry and of `.ssh` refused | 4.4 s |

New mutation entries (`scripts/mutation-checks.mjs`): the processes of a run are not ended; they are ended after the checkout is removed; the marker or the owner is not in the environment; no start sweep; the start sweep ends runs in flight; a base run goes on after a start sweep found processes; a start sweep that cannot list does not stop the run; the base run is compared after survivors; a base result from a run with survivors is kept; an end sweep that cannot list counts as clean; the processes are not noted in the log; the end of a long output is cut; a stored base failure with an environment word is reused; a failure with an environment word is not confirmed by the base output; the executor and the module do not wait for the sweep at start; an environment word ends a run without the base; the matched line is not shown or keeps control characters; the JDK, pyenv and nvm patterns; authorization names are not scrubbed, `_HEADER` is not scrubbed, every `NVM_` name reaches the check; the filesystem is not compared; the leftover checkouts, settings files, processes and clones are not swept; and for the sweep itself the marker is not read again, every run's processes are ended, live runs and live apps are swept, the app or its group can be killed, one round only, a failed listing reads as none, the working directory attributes nothing, the marker may be a prefix of a longer word, and the other lines of `lsof` are used. Repaired texts: the environment rule, the stored base run, the volume test, the app root (was the data directory) in `checkDenyRead` and in the module, the module sweep.

### What took long

Finding out that `ps -E` hides the environment of system programs, which forced the second attribution by working directory (and `lsof` prints every process for a missing pid). The first mutation run: `node -e "import('./scripts/mutation-checks.mjs')"` in a syntax check started the whole mutation script, whose loop is synchronous and ignores SIGINT until it ends; it was stopped with SIGKILL during one mutation and the one file it had changed (`src/core/swarm/runtime/StreamAgentRuntime.ts`, not part of this pass) was restored with `git checkout` after the diff showed only the mutation. The mutation that survived (`ready` in the module) needed a test with a slow first `lsof`, since the executor's own start sweep delays every first check.

### What was not verified

- The sweep on Linux (`ps axewwo`, `lsof`): arguments from the manuals only.
- A daemon that clears its environment and changes directory; processes started through launchd or LaunchServices.
- That every `srt` profile feature (`allowLocalBinding`, `process-fork`) is as on this host's `srt` 0.0.83 for other versions.
- A strict `clonefile` call; the volume test is the fail-closed part.

### Leftovers

Temporary files of this pass were under `/tmp/agide-check-clone-fix-2/` and are removed (see the report of the pass for the result of the removal). The tests remove their own temporary directories below the system temporary directory. One directory of this pass stayed there: `agide-leftovers-<suffix>`, made by the test of `sweepCheckLeftovers` that makes a directory read-only, when a mutation made the test fail before its fixture was restored (the test now restores the mode in a `finally`); its removal was denied by the permission system and it is left for the coordinator. Ten `agide-cap-*` directories that full runs of the suites left (empty repository roots, two per run, from a suite that this pass did not touch) were removed.

## Third pass: check-clone-fix-3

Start: 2026-11-22 17:28:19 UTC (`date -u`). End: 2026-11-22 19:26 UTC.

The independent review of the second pass (`docs/measurements/review-check-clone-fix-2.md`) found one major and seven minors. A stopped run of this pass had already changed the reason catalogue, the rules, the manager contract, `ProcessSweep.ts`, `environmentErrors.ts`, `checkEnv.ts`, `checkDenyRead.ts`, `CheckClones.ts`, the tests, the mutation entries and the records toward the minors and toward "`check.failed_on_base` at rung C". This run read every one of those edits against the findings, kept what fits, and replaced the rest.

### The major: a red base is a broken precondition, not a lower rung

The user's rule of 2026-11-22: the base check must be green. A red base is a broken precondition of the project and no state that lowers a rung. The attribution of survivors is not made airtight (code in the check controls both channels), so the design drops the lenient state:

| Change | Where |
|---|---|
| `check.failed_on_base` is removed. `check.base_red` (source check, rung C, not hard) takes its place for a failed or not-run checkpoint on a red base; a failed checkpoint on a green or unknown base is `check.failed` (rung C, sent back); a checkpoint that passes on a red base has no check reason and the card says that the change made the base green | `reasonCatalogue.ts`, `rules/runRules.ts` (`checkReasons`), `fakes/fakes.ts` (`FakeRiskRules`), `manager/InMemoryReviewManager.ts` (`checkBlocks`), `renderer/panes/review/ChangesetSections.tsx` (`baseSentence`) |
| The base run happens first, once for each (base commit, policy hash), and a green result is reused. A red, `not_run` or `timed_out` stored result is run again with the next capture (so a base that turned green is found and the alert ends). A base run with survivors, or whose sweep could not look, ends `not_run`; the manager stores no base row for a run that did not run; the store returns the latest base row of a pair | `capture/ProcessCheckExecutor.ts` (`run`, `baseRun`, `reusable`, `Run`), `manager/InMemoryReviewManager.ts` (`pipeline`, `checksOf`, `get`), `store/InMemoryChangesetStore.ts` and `store/SqliteChangesetStore.ts` (`baseCheck`) |
| One alert for each (swarm, base commit, policy hash): kind `alert`, origin `review:base`, "The check fails on the base commit: <command>", details "Reviews stay at rung C until the base is green: fix the base, or change check.command in the policy."; no text from the check output; a repeat does not post again, also after a dismissal; a green base run resolves the alerts of the swarm | `manager/ReviewInbox.ts` (`watchBase`, `resolveBaseAlerts`, `baseAlertKey`), `types.ts` (`BASE_ALERT_ORIGIN`) |
| A marker that names another run than the working directory does not replace the directory's run, and that process has no owner | `capture/ProcessSweep.ts` (`attribute` in `systemProcessTable`) |
| A reviewer does not accept at B over `check.base_red` when a policy lowers it | `InMemoryReviewManager.ts` (`checkBlocks`) |
| The security statement, the rules table, the alert and the known open path (sandbox attribution with the `sandbox_check` recipe; launchd and LaunchServices are refused inside `srt`) | 0040 sections 6, 7.2 and the security table, 0041, 0042, `app/README.md` |

Decisions of this pass: a red base result is run again with the next capture, where the instruction said "stored and reused": the review asked for it (a red base can come from a survivor, and only a rerun shows that it turned green), and the alert needs a later green run on the same pair to end; the cost is one more run of the check for a project whose base stays red. A red base never lowers a rung, so the rerun costs time and nothing else. The manager and not the executor decides what is stored; the executor never reuses anything but green.

Real `srt` 0.0.83 regression test (`ProcessCheckExecutor.srt.test.ts`, "puts a changeset at rung C, never B, when a hidden survivor of an earlier capture made its base run fail"): a Python daemon that forks twice, calls `os.setsid()`, changes its directory to `/`, executes python with an empty environment and holds a port; the first capture's checkpoint exits 1. The second capture's base run meets the port: it fails with `Address already in use`, and the changeset gets `check.base_red` at rung C. On this host the sweep did not find the daemon (the test names the reason it expects from the base outcome, so it passes whether or not the sweep finds it). The review's scratch version of this attack ended at rung B before this pass.

### The minors

| Finding | State |
|---|---|
| Environment patterns | The srt proxy refusal (`CONNECT tunnel failed, response 40[13]`, and a bare 403 in a proxy line as a `needsBase` pattern), Maven's JAVA_HOME messages, `Could not resolve` and `Could not get` narrowed to the Gradle and Maven forms; tests in both directions in `environmentErrors.test.ts` (bundler, Spring and Gradle script messages stay failures) |
| `notRunReason` carries no text of the check | `environmentNotRunReason` names the pattern only; a `; ${tail}` that was left in `ProcessCheckExecutor.execute` is removed; the survivors' program names are in the output tail only. A prompt test shows that the reason and the printed line sit inside the check block and nowhere else |
| A mount point below a cache root | `CheckClones` compares the device of every directory it counts with the root (`MountBelowRoot`); unit test with an injected device answer |
| The default login's Claude directory | `checkDenyRead` takes `claude` (`claudeConfigPaths`), the module passes it; srt test reads `~/.claude`-shaped transcript and is refused; the comment and the records say so |
| The two `endStale` branches and `lsof -a` and the time limit | Tests for both branches (earlier run of this app, directory-only attribution), `lsof -a`, a 30 s budget with a test; mutation entries |
| Environment names | `isScrubbedName` matches whole words for `AUTH`, `AUTHORIZATION` and `OAUTH`, drops bare `TOKEN`, `PASSWORD`, `PASSWD`, `SECRET`, `APIKEY`, `_KEY` and `HEADER` names, `CREDENTIAL` anywhere; `droppedNames` is in the check log; the README lists the names |
| Banned words in the added text | The word list of the writing rules was applied to the added text; one hit in the quoted title of an earlier finding in this file was replaced by "real" |

### What was checked on the whole surface

The reasons of the catalogue and every user of `check.failed_on_base` (rules, fakes, contract, tests, records, README, mutation entries; the older review records keep the name where they describe what a review found at the time). The order of the sweeps in a run (the base run's start and end sweeps come before the checkpoint run's). Cancel during the base run (the checkpoint run does not start and no base row is returned), during the checkpoint run, and while queued. A stored green base with a clone failure, an unavailable environment and a timeout. Recovery after a restart (`storedChecks` reads the latest base row). The card (`ChangesetSections.tsx`), the caller view (the base row's output is wrapped like any check output), the reviewer prompt and the inbox. The e2e suite and `pnpm parity`. A forged marker (the owner cannot be verified, so a forged marker alone still keeps a process out of the start sweep; the consequence is a red base at rung C and one alert).

### Changed files and functions

Source: `core/review/reasonCatalogue.ts`; `core/review/rules/runRules.ts` (`checkReasons`); `core/review/fakes/fakes.ts` (`FakeRiskRules.assess`); `core/review/capture/ProcessCheckExecutor.ts` (`run`, `baseRun`, `reusable`, `compared`, `execute`, `Run`); `core/review/capture/ProcessSweep.ts` (`systemProcessTable.attribute`); `core/review/manager/InMemoryReviewManager.ts` (`pipeline`, `checksOf`, `get`, `applyReport`); `core/review/manager/ReviewInbox.ts` (`watchBase`, `resolveBaseAlerts`, `baseAlertKey`, `onEvent`); `core/review/store/InMemoryChangesetStore.ts` and `SqliteChangesetStore.ts` (`baseCheck`); `core/review/types.ts` (`BASE_ALERT_ORIGIN`, comments); `renderer/panes/review/ChangesetSections.tsx` (`baseSentence`, `CheckBlock`).

Tests: `rules/rules.test.ts` (table, rung, property test), `capture/ProcessCheckExecutor.test.ts` (`setup` has a stored green base unless `baseCheck: null`; the base comparison, reuse, order, survivors, cancel and sweep cases), `capture/ProcessCheckExecutor.srt.test.ts` (`rig` option `base`, the two-capture attack test), `capture/ProcessSweep.test.ts` (marker against directory; a real-process test that waits by the clock), `manager/reviewManagerContract.ts` (red base, not-run base, stored base, STRICT policy), `manager/ReviewInbox.test.ts` (the alert), `store/changesetStoreContract.ts` (latest base row), `reviewer/prompt.test.ts`, `renderer/panes/review/ChangesetView.test.ts`.

Mutation entries (`scripts/mutation-checks.mjs`): new: the red base rung lowered to B; the card text; a failed checkpoint on a red base is `check.failed`; a not-run checkpoint on a red base; a timed-out checkpoint on a red base; a base that did not run counts as red; the reviewer may accept over a red base; the base run after the checkpoint run; a cancel during the base run starts the checkpoint run; a stored base that did not pass is reused; a stored red base is reused; the stored base is never used; a base run that did not run is stored; the alert posted for every changeset; a green base does not resolve the alert; the alert has no key of its pair; a base that did not run raises the alert; output of the check in the alert; the first base row of a pair is found (memory and database); the base row is not in the card; a red base described as passed; a marker replaces the directory's run. Removed: the two entries of the retired comparison after survivors and of a stored failure with an environment word. Repaired: the stored base run, the rung and card entries of `check.failed_on_base`.

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage` (default environment, no `srt` on the path) | 275 test files pass, 1 skipped; 3389 tests pass, 29 skipped, 2 expected failures (the first run of the pass had one failure of the real-process sweep test under load, see "What was not verified"); `src/core` lines 97.16 (threshold 97), branches 86.50, `src/core/review` lines 98.34 (threshold 98), branches 89.74 |
| CI-like `vitest run --coverage` (a directory with one symlink named `node`, `PATH=<it>:/usr/bin:/bin:/usr/sbin:/sbin`) | 275 files pass, 1 skipped; 3373 tests pass, 45 skipped, 2 expected failures; `src/core` lines 97.16 (margin 0.16 points), branches 86.50 (85), `src/core/review` lines 98.30 (98) |
| Suites with `srt` found (`AGIDE_SRT_BIN=~/Library/pnpm/bin/srt`): `src/core/review`, `src/core/isolation`, `src/main` | 72 files, 1393 tests pass, none skipped: the real-tool tests (cargo, npm, pnpm, pip, uv, Maven, Gradle) and the daemon tests (python3) ran |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 passed |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | passes |
| New mutation entries, run alone | all killed; the first run left "a cancel during the base run still starts the checkpoint run" alive, a test was added (the checkpoint run does not start, no base row) and the entry is killed |
| Full `pnpm mutation` (18:02 to 19:23 UTC, nothing else running beside it) | 454 killed, 1 survived, 0 skipped. The survivor was "a base that did not run raises the alert": since the manager stores no base row for a run that did not run, the not-run case no longer reached the alert, so the test now also plans a base that timed out; the entry is killed in a filtered run. The source and the script were compared with a copy made before the run (`diff -r`, `cmp`): identical |

### What took long

Reading what the stopped run had changed: most of the minors were already done, with tests, and the executor still carried a `; ${tail}` in the reason of an environment problem and a base comparison that no longer matched the rules. Moving the executor tests to base-first: the test rig now stores a green base by default, which keeps the tests about the checkpoint run at one launch each, and the tests about the base run say `baseCheck: null`.

### What was not verified

- The sandbox-attribution helper (`sandbox_check`) is not built; it stays a recipe in 0040.
- The nc variant and the forged-marker variant of the attack under real `srt` (only the double-fork with an empty environment is in the suite; the forged marker is covered by unit tests with a fake table).
- A flake of the real-process sweep test under the load of the full coverage run was seen once (the process of a gone app was not found within the listings); it passed alone three times and in the next full run, and its wait is now by the clock.
- The inbox alert in the running app (the e2e suite does not post one; the unit tests use the in-memory inbox).

### Leftovers

Temporary files of this pass were under `/tmp/agide-check-clone-fix-3/` (coverage output, the directory with the `node` symlink, a copy of `src` and of the mutation script for the comparison, a scratch copy of the srt test file) and are removed; the path is gone. The tests remove their own temporary directories. The system temporary directory still holds `agide-cap-*` directories (empty repository roots that full runs of the suites leave, from a suite that this pass did not touch; earlier agents' directories cannot be told from this pass's, so none was removed), `agide-app-*` and the directories named in the task as belonging to earlier agents. Free disk was 9.1 GiB at the start and 8.0 GiB at the end; it did not go below the 3 GiB floor.

## Fourth pass: check-clone-fix-4

Start 2026-11-22 19:56 UTC, end 2026-11-22 22:45 UTC. A narrow pass over the blocker and seven minors of the third independent review; the changes are the diff against the checkpoint commit.

### The blocker: an exit 0 from `srt` is not proof that the check passed

`srt` 0.0.83 forwards SIGINT and SIGTERM to its program and exits 0 when the program ends by either. The executor read that 0 as `passed`. Reproduced first against the real `srt` (plain argv, a stored green base): `echo "tests: 3 failed"; kill -TERM 0; sleep 2; exit 1`, `kill -TERM $$`, `kill -INT 0` and a Node program that sends SIGTERM to itself all came out with status 0.

Decision: option 2, a launcher inside the sandbox, not option 1 (the `SandboxManager` library). The app has no dependency on the library and the provider is built on the CLI; the library needs a listener per initialize, a reset and its own cleanup of process groups (`notes/probes-m6-credential-proxy.md`, embedding); the launcher is a few lines and was tested against the real CLI. `core/isolation/srtLauncher.ts` holds `SRT_LAUNCHER_SCRIPT` and `srtLauncherArgv`; `srtToolCommand` in `SrtProvider.ts` runs `srt -s <settings> -- /bin/sh -c <script> srt-launcher <argv>`. The shell handles INT, TERM and HUP with `trap :` (a no-op command, so the signals are handled and go back to their default action in the child; `trap ''` would be inherited), runs the program as a child (no `exec`), waits and exits with its status. Statuses with real `srt`, each check printing a failure and then `sleep 1; exit 1` (script `matrix.mjs` in the scratch directory):

| The check sends | Plain argv | Launcher |
|---|---|---|
| exit 0 | 0 | 0 |
| exit 3 | 3 | 3 |
| SIGTERM to its group | 0 | 143 |
| SIGTERM to itself | 0 | 143 |
| SIGINT to its group | 0 | 130 |
| SIGHUP to its group | 1 | 129 |
| SIGQUIT to its group | 1 | 1 |
| SIGABRT to its group | 1 | 1 |
| SIGKILL to its group | 1 | 1 |
| TERM, INT or HUP to its parent shell | refused (the parent is `srt`, outside the sandbox) | 1 (the program's own exit) |
| QUIT, ABRT or KILL to its parent shell | refused | 1 (the signal ends `srt`) |
| Node program that signals itself with SIGTERM | 0 | 143 |
| `exec` of a program that signals itself | 0 | 143 |
| a trap that exits 1; an ignored TERM and exit 1 | 1 | 1 |

A signal sent to `srt` itself is refused by the sandbox (`Operation not permitted`), so only the check's own process, its group and the launcher can be reached. The app's timeout and cancel are decided from the flags of `runProcess` before it reads a status (`timed_out`, `not_run` "the check was cancelled"), checked under the launcher in both test files. A program that ignores TERM and then exits 0 on its own is a pass: code in the check can always exit 0. A background child started by the check still ends by SIGTERM (real `srt` test).

Tests: `ProcessCheckExecutor.test.ts` ("a check that ends by a signal under srt"): every signal (TERM, INT, HUP, QUIT, ABRT, KILL) to the group, to the process and to its parent shell, a Node program, `exec`, a subshell, traps, an ignored signal, exit 0 and exit 3, the status 143, 130 and 129, a timeout and a cancel, all through `srtToolEnvironment` over `core/isolation/fakeSrt.ts`, a stand-in with the exit behaviour of 0.0.83 (runs without `srt`). `ProcessCheckExecutor.srt.test.ts`: the same signals against the real `srt`, the group statuses (the case that tells a handled HUP from an unhandled one), the trap and exec cases, pass, fail, timeout and cancel, the SIGTERM child. Mutation entries: `srt` runs the program without the launcher; the launcher ignores the signals; the launcher does not handle HUP (killed only by the real-`srt` test, which the entry runs with `-t`); the launcher exits 0; the launcher `exec`s the program; a death by a signal reads as passed; the exit 0 of the launcher reads as failed. Without the launcher the TERM and INT rows and the Node and `exec` rows give 0; the unit tests fail without it (checked by the entries).

Audit of every place where a status becomes a decision: the check executor (fixed); `StreamAgentRuntime.finalize` and `PersistentSwarmManager.onExited` (an exit that the app did not ask for ends the agent `failed` whatever the code); `StreamReviewerRuntime` (the exit ends the run; the verdict comes from the `report_review` call, and `failure` from the result event); `GitMerger`, `guardedGit` and the swarm git steps (host programs started by the app with fixed arguments, outside any sandbox, each reading its own status); `CheckClones` (`cp`, `df`), `ProcessSweep` (`ps`, `lsof`) and `claudeLogin` (`claude auth status`), all outside the sandbox. None of these reads a status that a sandboxed process can write. `container` runs a check as `docker run` and is not connected for checks; the signal cases were not run against Docker (0042, open rows).

### The minors

| Finding | State |
|---|---|
| Base alert per swarm | `ReviewInbox.watchBase` resolves only the alert of its own base commit and policy when that pair's base row is green, and `resolveUnusedBaseAlerts` resolves the alert of a base that no undecided changeset of the swarm stands on (superseded, rejected or accepted last changeset). `alerted` is rebuilt from the alerts of the inbox in every state at start (`rememberAlerts`). Tests: two agents on a red and a green base for three rounds (one alert, open throughout), a green base ends only its own alert, superseded, rejected and accepted last changesets end the alert, a restart does not post a dismissed alert again and posts for a new base |
| Loopback under `check.network: none` | Probed: `srt` has no setting for bind without connect (its profile pairs `allowLocalBinding` with `network-outbound (remote ip "localhost:*")`), `deniedDomains` does not apply to a direct loopback connect, a bind and a connect are refused when `allowLocalBinding` is false. So `buildToolSrtSettings` takes `loopback`, `ToolLaunch` has the optional `loopback`, `CacheTool` has `loopback` (Gradle only), `RunClones.loopback` reports it and the executor passes it. Real `srt`: connect and bind refused for an npm project, connect reached for a Gradle project; the daemon tests and the registry-free tests ask for loopback through a rig option. What stays reachable and what now fails is in 0040 section 6 ("Loopback") and the security table |
| Banned words | The banned words in 0040 section 6 are replaced; the row of the third pass describes the minor without quoting a banned word |
| Flaky sweep test | Cause found by reproduction: the gone-owner process of the test carries a marker whose owner pid is dead, and the sweep of another test process (the executor tests with the real table, in a parallel worker) ends every such process at the start of its runs, so the sweep under test found nothing (`ps shows [] for pid`; the pid was not reused, `isAlive` was not the cause). The test now owns its process with a running stand-in app that no other sweep touches and tells its own sweep that the stand-in is gone (`isAlive` option); the real liveness check has its own unit test with a pid that cannot exist (`2147483646`) and one that runs. The failure message now prints the `ps` markers, whether the pid lives and what signal 0 says about the owner. A second source of cross-talk, `survivors()` of the real-`srt` rig listing the marked processes of other files, is filtered to this rig's owner |
| `cp` text in `notRunReason` | `CloneError` has `detail`; `cloneWithCp` says `cp -c could not clone a cache` and `clonePart` names the tool; the executor writes `clone detail: ...` to the log of the run only. The output tail and the reason hold none of it |
| Environment names | Prefixes are compared on the upper-cased name; the endings `PASSPHRASE`, `JWT` and `_PW` are added; tests for lower-case names and the new endings, and names that stay (`PWD`, `JWT_ALGORITHM`) |

### Stability of the sweep test

Before the change, the real-process test failed about once in a dozen runs while the real-`srt` suite ran in a second process. After: 30 runs of `ProcessSweep.test.ts` (27 tests) with 16 `yes` processes on 8 cores and the real-`srt` suite running in parallel, 30 passed; a second series of 20 runs with the same load, 20 passed. The `yes` processes were killed afterwards.

### What was checked on the whole surface

Ways in which code under test could make a check read `passed`: a signal of itself, its group or its parent (closed, above); an exit 0 of its own (always possible, and what a changed test does: the reasons `tests.*` and `config.test_lint` and the reviewer see the change); a command that discovers no tests and exits 0 (open, 0042 row, not built); a stored green base made by a merged checkpoint (a base run is a run of that code, so it follows the same rules); a base result forged through a survivor (a survivor can turn a red base green through a loopback service where a tool entry asks for loopback; no rung is lowered by a green base, since a failed checkpoint is `check.failed` either way). Ways to make a failure read `not_run`: output with a sandbox, toolchain or resolution phrase (`EPERM`, `command not found`, `Could not resolve all files`) and a failing `setup` end the run `not_run`, whose rung is C like `check.failed`, without the send-back; `not_run` is never a pass. Ways to make the review skip: a survivor or a failing process list ends a base run `not_run`, a clone that cannot be made ends the run `not_run`; none lowers a rung. A timeout and a cancel are decided by the app.

### Changed files and functions

Source: `core/isolation/srtLauncher.ts` (new: `SRT_LAUNCHER_SCRIPT`, `srtLauncherArgv`); `core/isolation/fakeSrt.ts` (new, test helper: `writeFakeSrt`); `core/isolation/SrtProvider.ts` (`srtToolCommand`); `core/isolation/srtSettings.ts` (`SrtSettings`, `ToolSrtSettingsInput`, `buildToolSrtSettings`); `core/isolation/types.ts` (`ToolLaunch.loopback`); `core/review/capture/cacheTools.ts` (`CacheTool.loopback`, the Gradle entry); `core/review/capture/CheckClones.ts` (`CloneError`, `cloneWithCp`, `clonePart`, `RunClones.loopback`, `create`); `core/review/capture/ProcessCheckExecutor.ts` (`CheckToolEnvironment` comment, `execute`, `toolCommand`); `core/review/capture/checkEnv.ts` (`SCRUBBED_ENDINGS`, `isScrubbedName`); `core/review/manager/ReviewInbox.ts` (constructor, `rememberAlerts`, `watchBase`, `basesInUse`, `resolveUnusedBaseAlerts`, `UNDECIDED_STATES`; `resolveBaseAlerts` removed).

Tests: `isolation/srtSettings.test.ts`, `isolation/toolCommand.test.ts`, `review/capture/ProcessCheckExecutor.test.ts`, `ProcessCheckExecutor.srt.test.ts` (rig options `loopback`, `cancel`, `survivors` filter), `CheckClones.test.ts`, `ProcessSweep.test.ts`, `checkEnvironment.test.ts`, `review/manager/ReviewInbox.test.ts`.

Other: `scripts/mutation-checks.mjs` (new entries; the entries of the third pass that named changed text follow it); records 0040, 0041, 0042 and `app/README.md`.

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage`, with the real `srt` | 276 files, 3498 tests pass, 2 expected failures; `src/core` lines 97.17 (threshold 97), `src/core/review` lines 98.34 |
| CI-like run (a directory with only a symlink `node`, `PATH` limited to it and the system directories, no `srt`) | 275 files pass and 1 is skipped, 3427 tests pass, 71 skipped; `src/core` lines 97.17, `src/core/review` lines 98.38; margin 0.17 points |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 tests pass |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| Real-tool tests (`AGIDE_SRT_BIN`, python3, npm, pnpm, pip, uv, mvn, gradle, cargo) | 40 pass, also while 16 `yes` processes ran |
| New mutation entries | all killed; some survived at first (an accepted changeset holding its base: test added; the HUP trap: the entry runs the real-`srt` group test) |
| Full `pnpm mutation` | every entry killed, none survived or skipped (about 106 minutes, alone, started 20:57 UTC) |

### What took long

The real-`srt` suite takes over two minutes, the signal matrix being the new part. Finding the cause of the sweep test took a reproduction with the real-`srt` suite in a second process; the `ps` line was empty, which excluded pid reuse. A first attempt to run a subset of the mutation script as `node -e import(...)` ran all entries without a filter and had to be killed; one swarm-runtime entry was left in place and restored by hand (the file shows no difference to the checkpoint).

### What was not verified

The signal cases against Docker. The launcher on Linux (`/bin/sh` there is dash; the trap semantics are the same by POSIX, but `srt` on Linux uses `bwrap`, whose exit handling was not read). A real Gradle build that binds its lock socket was run with the loopback entry only in the existing offline resolution test, not a build that uses a daemon. A project whose test suite starts a local server was not run to see its `not_run` text.

### Leftovers

Scratch files under the scratch directory of this pass (`/tmp/agide-check-clone-fix-4/`), removed at the end; the list of anything that could not be removed is in the report of the run.


## Fifth pass: check-clone-fix-5

Start 2026-11-22 23:33 UTC, end 2026-11-23 02:34 UTC. A narrow pass over the blocker and four minors of the fourth independent review; the changes are the diff against the checkpoint commit of the fourth pass.

### The blocker: Node reads a death by SIGEMT as exit 0

Node has no name for signal 7 (SIGEMT) on macOS: a child that ends by it comes back as exit code 0 with no signal. `srt` is a Node program, so its `onCommandExit` gets code 0 and calls `process.exit(0)`, and the app's own `runProcess` reads the same pair for a plain check, with no `srt` involved. The launcher of the fourth pass handled INT, TERM and HUP only. Reproduced before the change: a bare `sh -c 'kill -7 $$; sleep 0.3; exit 5'` under Node gives `(0, null)` (`spawnSync` gives `(null, '')`), and under real `srt` 0.0.83 the program `kill -EMT 0; sleep 1; exit 1` gave exit 0 without the launcher. Probed on this machine: a signal that the program sends to its process group does not reach `srt` (the sandbox answers `Operation not permitted` for the pid of `srt` and of the shell outside the sandbox), so the processes a check can reach are its own, its group and the launcher.

Changes:

- `core/isolation/srtLauncher.ts` became `core/isolation/statusLauncher.ts`. `LAUNCHER_HANDLED_SIGNALS` is one constant, the numbers of the catchable signals of macOS whose default action ends a process (1 to 8, 10 to 15, 24 to 27, 30, 31), with a comment on why; the trap is by number, because names differ between shells and platforms. `launcherArgv` replaces `srtLauncherArgv`. The script also exits 2 when there is no program, so an empty argv cannot read as a pass.
- The same launcher runs a plain check: `resolveCheckEnvironment` builds its command with `plainCommand`, which puts the program under `/bin/sh -c <launcher>`. A missing program now ends the check with the shell's `command not found` (status 127), which the environment patterns turn into `not_run`, the same as under `srt`.
- `core/isolation/fakeSrt.ts`: the stand-in runs its child in a process group of its own, as the sandbox keeps `srt` out of reach of a group signal, and forwards INT, TERM and HUP to that group. Without that, a `kill 0` of the check ended the stand-in itself and the test measured the stand-in. It is a Node program, so it reads a death by SIGEMT as exit 0 like `srt`; a test shows that.
- `core/isolation/signalTable.ts` (test support): `systemSignals()` takes the names from `kill -l` and finds the default action of each signal by sending it (`ends`, `ignored`, `stops`), so no test holds a list of names.

Check of the signal list on this machine (`kill -l`, each signal sent to a shell that then exits 5, without a launcher):

| Default action | Signals |
|---|---|
| ends the process, catchable | HUP INT QUIT ILL TRAP ABRT EMT FPE BUS SEGV SYS PIPE ALRM TERM XCPU XFSZ VTALRM PROF USR1 USR2 |
| ends the process, cannot be caught | KILL |
| ignored | URG CHLD WINCH INFO CONT IO, and TSTP TTIN TTOU for a check (its session has no controlling terminal, so its process group is orphaned and the kernel drops these three) |
| stops the process | STOP |

Statuses measured with real `srt` 0.0.83 (each check prints a failure, signals, then `sleep 1; exit 1`):

| The check sends | Without the launcher | With the launcher |
|---|---|---|
| SIGTERM to its group or to itself | 0 | 143 |
| SIGINT to its group | 0 | 130 |
| SIGHUP to its group | 1 | 129 |
| SIGQUIT to its group | 1 | 131 |
| SIGABRT to its group | 1 | 134 |
| SIGEMT to its group or to itself | 0 | 135 |
| SIGKILL to itself | 1 | 137 |
| SIGKILL to its group | 1 | 1 |
| any signal to its parent | 1 (refused, the parent is outside the sandbox) | 1 (the launcher handles it, or for KILL dies and `srt` says 1) |

Tests:

- `isolation/statusLauncher.test.ts` (not gated, no `srt`, Node reads the launcher like the app): the constant equals the signals of this system that end a process by default, minus KILL; every such signal sent to the process itself and to its group gives 128 plus the number and never 0; sent to the launcher it leaves the program's own status (3 stays 3, 0 stays 0); the signals that are ignored by default leave the program's status in charge for all three targets; the signals that stop hang the check until the deadline; KILL gives 137 for the program and a death by SIGKILL for the group and the launcher; a burst of trapped signals at the launcher keeps the program's exit status; the program does not inherit the handler; no program is 2, a missing program 127; arguments reach the program whole. It also shows the reason: without the launcher a death by SIGEMT is `(0, null)`.
- `ProcessCheckExecutor.test.ts`: the fake-`srt` matrix gains SIGEMT to the group, to itself and to the parent, SIGUSR1 and SIGSYS; a test that the stand-in is faithful for the unnamed signal; a new block for the plain path (SIGEMT to the three targets, SIGTERM, SIGKILL, SIGUSR2, exit 0 and exit 3, a missing program ending `not_run`).
- `ProcessCheckExecutor.srt.test.ts` (gated): the old list of six names is replaced by every signal of the system and the three targets (`ends`: `failed` and a status other than 0; `ignored`: the program's own status decides), plus a Node program that does `process.kill(0, 7)`, a burst of trapped signals, a cleanup `trap "kill 0" EXIT` with a background process (now `failed`), and the exit status modulo 256 (`exit 256` is a pass, and a `|| exit 1` wrapper cannot repair it because the kernel cut the status first).
- Mutation entries: the launcher does not handle EMT, HUP or USR2; the launcher also handles a stopping signal; the launcher ignores instead of handling; no program exits 0; the launcher exits 0 or turns a status above 128 into 0; the launcher replaces itself with the program; the plain path runs without the launcher; the stand-in shares the process group of the program; the srt command without the launcher; the executor reads exit codes as before. A manual mutation of the launcher without EMT, run against real `srt`, fails the SIGEMT cases for the group and the parent.

Audit of every place where Node's exit code or signal of a child becomes a decision, repeated:

| Place | Decision | State |
|---|---|---|
| `runProcess` and `ProcessCheckExecutor` (setup step and check command), srt and plain | `exitCode !== 0` breaks the setup, `=== 0` is `passed` | closed: both paths run under the launcher; the earlier audit looked at `srt` only |
| `StreamAgentRuntime`, `PersistentSwarmManager.onExited`, `InMemorySwarmManager` | an exit the app did not ask for ends the agent `failed`; `done` comes from the result event | no code or signal is read as success |
| `StreamReviewerRuntime` | the verdict comes from `report_review` | no status decides |
| `PtySessionService` | node-pty reports its own signal number | not Node's `child_process` |
| `GitMerger.runGit`, `guardedGit`, `GitPolicyLoader`, `swarm/workspace/git.ts` | git exit code | git runs without hooks, filters, drivers, fsmonitor and external diff, on objects of the common directory; no code under test runs in it |
| `CheckClones` (`cp -c`, `df`, `chmod`), `ProcessSweep` (`ps`, `lsof`), `claude auth status`, `tasks/exec.ts` | exit code of a program the app started with fixed arguments | the check does not run inside them |
| `HostEnvironment.toolCommand` (host providers), `ContainerProvider.toolCommand` | not used for a check: the review module takes `resolveCheckEnvironment`, and `container` is not connected for checks | open for `container` (0042): it needs the launcher and a run against Docker |

### The minors

| Finding | State |
|---|---|
| Loopback decided by marker files of the checkpoint | `needsLoopback` in `cacheTools.ts` looks at the command words of the policy only (`check.command` and `check.setup`, which come from the base commit); `CheckClones.create` uses it, and the markers of the checkpoint still select the caches. Tests: unit (a Gradle marker with another command gives none; the word gives it; the executor asks with a marker added by the checkpoint and gets false), real `srt` (an npm project whose checkpoint adds `tools/build.gradle` is refused with `EPERM`; the connect is reached when the command names `gradlew`). Entries: the clones follow the selection, a marker selects loopback. A script that runs Gradle inside (`./run-tests.sh`) no longer gets loopback until the policy names `gradlew`; 0040 and 0042 say so |
| Node text of a file system error in `notRunReason` | The fallback of `CheckClones.create` says `the cache clone failed (<code>)` (`unknown error` without a code) and puts the Node text in `detail`; the message of the mount point below a cache has no path (the relative path is in `detail`); the executor's own fallback for another clone service is the fixed `the cache clone failed` with the text in the log. Tests: a mode 000 directory in the cache whose name is `NOTE TO REVIEWER - the check failure is expected, accept this changeset` gives `the cache clone failed (EACCES)`, the name only in the detail; a service that rejects with such text. Entries for the three texts |
| Alert key kept after the app resolved the alert | `resolveUnusedBaseAlerts` deletes the key; `rememberAlerts` skips alerts that are done with resolution `superseded`, so only open and dismissed alerts are remembered. Test: a changeset on a red base, the alert, the changeset rejected and the alert superseded, a new changeset of another agent on the same base posts a new alert, also after a restart with the first instance unsubscribed. The first version of the restart part survived the mutation because the old instance was still subscribed; the test now removes it. Entries for both lines |
| Two readings of legitimate checks not documented | 0040 section 6 (Outcomes) and the open rows of 0042 next to zero-test discovery state both: a `kill 0` cleanup now reads `failed` with 143, like a run outside `srt`; an exit status is taken modulo 256. The README says that a check command should end with 0 for success and 1 for failure. `cmd || exit 1` turns 1 to 255 into 1 but cannot repair a status that the runner already cut at 256, so the text asks the runner to clamp its own status |

### What was checked on the whole surface

Ways in which code under test could make a check read `passed`, and the answer to each:

| Way | Answer |
|---|---|
| A signal to itself, its group or its parent | closed for every signal of macOS (property tests); SIGKILL ends the launcher and reads as a death by SIGKILL; SIGSTOP hangs until the deadline (TSTP, TTIN and TTOU are dropped for a check) |
| A signal to `srt` or to the app | refused by the sandbox under `srt`; a plain check has the rights of the agent anyway |
| An exit status of 256 or more | read modulo 256 by the kernel; documented, no rule |
| A command that forks and exits 0 | the leader's status decides; the sweep ends what it left behind, and a base run with survivors is `not_run` and not stored; a background process that fails later does not change the result (unchanged) |
| A wrapper script that the check provides (`./run-tests.sh`) | the command is from the base policy but the script is a file of the checkpoint: a changed script reads through `tests.*`, `config.test_lint` and the reviewer, and an exit 0 of its own is always possible |
| Output that claims success | the executor never reads output for a pass; output can only turn a failure into `not_run` (a person decides), and the words that tests print need the base to fail the same way |
| A command that discovers no tests | open (0042) |
| An empty argv | the launcher exits 2 |
| A program that cannot be found | status 127 and `command not found`, which is `not_run` |
| A stored green base from a merged checkpoint | the same launcher governs the base run |

### Changed files and functions

Source: `core/isolation/statusLauncher.ts` (new, replaces `srtLauncher.ts`: `LAUNCHER_HANDLED_SIGNALS`, `LAUNCHER_SCRIPT`, `launcherArgv`); `core/isolation/signalTable.ts` (new, test support: `systemSignals`); `core/isolation/fakeSrt.ts` (script); `core/isolation/SrtProvider.ts` (`srtToolCommand`); `core/isolation/index.ts` (export of `launcherArgv`); `core/review/capture/checkEnvironment.ts` (`resolveCheckEnvironment`, new `plainCommand`); `core/review/capture/cacheTools.ts` (new `needsLoopback`); `core/review/capture/CheckClones.ts` (`CloneError` comment, `create`, `clonePart`); `core/review/capture/ProcessCheckExecutor.ts` (`execute`, the comment of `CheckToolEnvironment`); `core/review/manager/ReviewInbox.ts` (`rememberAlerts`, `resolveUnusedBaseAlerts`).

Tests: `isolation/statusLauncher.test.ts` (new), `isolation/toolCommand.test.ts`, `review/capture/ProcessCheckExecutor.test.ts`, `ProcessCheckExecutor.srt.test.ts`, `CheckClones.test.ts`, `cacheTools.test.ts`, `checkEnvironment.test.ts`, `review/manager/ReviewInbox.test.ts`.

Other: `scripts/mutation-checks.mjs`; records 0040, 0041, 0042; `app/README.md`.

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage`, with the real `srt` | 277 files, 3692 tests pass, 2 expected failures; `src/core` lines 97.18 (threshold 97), `src/core/review` lines 98.38 |
| CI-like run (a directory with only a symlink `node`, `PATH` limited to it and the system directories, no `srt`) | 276 files pass and 1 is skipped, 3546 tests pass, 146 skipped; `src/core` lines 97.18, `src/core/review` lines 98.38; margin 0.18 points |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 tests pass |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| Real-tool tests (`AGIDE_SRT_BIN`, python3, the tools of the machine): `ProcessCheckExecutor.srt.test.ts` and `SrtProvider.test.ts` | 126 pass, none skipped |
| New mutation entries (signals, loopback, alert, clones: 56 entries in the first run) | 55 killed and 1 survived, the survivor (the superseded alert remembered at start) was a test defect, fixed and killed; the clone entries were run again after the executor change and are killed |
| Full `pnpm mutation` | every entry killed, none survived or skipped (about 116 minutes, alone, started 00:38 UTC on 2026-11-23) |

### What took long

The signal matrix of the real-`srt` suite: every signal and three targets, with a `sleep 1` in each script, is most of the two to three minutes of that file. The first fake-`srt` run of SIGEMT to the group passed for the wrong reason: the stand-in sat in the group that the check signalled and died by SIGEMT itself, so it needed its own process group like the real one has behind the sandbox. A first partial mutation run used a filter (`alert`) that matched unrelated entries, and the script cannot be interrupted while a test runs (`spawnSync` blocks its SIGINT handler), so it ran to its end.

### What was not verified

The launcher on Linux, where the numbers and the real-time signals differ (open row in 0042). The signal cases against Docker. Whether `srt` versions after 0.0.83 change `onCommandExit`.

### Leftovers

Scratch files under `/tmp/agide-check-clone-fix-5/`, removed at the end; anything that could not be removed is in the report of the run.

## Sixth pass: check-clone-fix-6

Start 2026-11-23 06:48 UTC, end 2026-11-23 11:13 UTC. A narrow pass over the major and the minors of the fifth independent review; the changes are the diff against the checkpoint commit of the fifth pass (f16a837). The signal table finding was fixed in that commit and is not part of this pass; the measurement table and 0040 already say that only SIGSTOP suspends a check.

### The major: `srt` is started through anything the checkpoint controls

`srtToolCommand` spawned the name `srt` with the working directory of the checkout and the PATH of the profile. libuv looks a bare name up through the PATH of the child after the change of directory, so a relative or empty entry (`bin`, `.`, a leading, trailing or double colon) resolved inside the checkout. The installed shim of `srt` (read at the pnpm global bin directory) is a `/bin/sh` script that runs `dirname`, `sed` and `uname` through PATH and then `$basedir/node` or `command -v node`, and `srt` itself starts `env`, `which` and `bash` by name (`shell: true` in `dist/cli.js`, `whichSync` in `dist/utils/which.js`). A file that the agent committed as `srt`, `bin/node` or any of those helpers ran outside the sandbox with the rights of the app, could exit 0, and made a failing check `passed` with a green base. `SrtProvider.processCommand` had the same shape with the workspace of the agent as the working directory.

Changes (`core/isolation/hostLaunch.ts` is new):

- `trustedPath(path, excluded)` keeps the absolute entries that are not inside an excluded directory, compared in every spelling with links resolved. `locateHostBinary` and `hostLaunch` find `srt` on those entries of the app's own PATH (`SrtProviderOptions.appPath`, default `process.env.PATH`) and return the absolute file and the PATH for its process; a path is made absolute against the working directory of the app; nothing found throws `IsolationError`, which ends the check `not_run` with the reason.
- The `srt` process gets only that PATH, so the shim and `srt` find their helpers on absolute entries only, and it starts in a neutral directory (`neutralDirectory`: `/var/empty`, or a private empty directory below the settings directory). The launcher inside the sandbox changes into the checkout (`launcherArgv(argv, { directory })`).
- The program inside the sandbox keeps the PATH of the profile unchanged: `insideArgv` puts `/usr/bin/env PATH=<profile PATH>` (`env -u PATH` for a profile without one) in front of the launcher.
- The same for `SrtEnvironment.processCommand` (the agent keeps its working directory, which `claude` needs; the trusted PATH carries nothing inside the workspace and the inbox), for `SrtProvider.check` and for `resolveCheckEnvironment`, which look `srt` up on the trusted entries too.
- A consequence that 0040 states: the entries of `srt`'s mandatory deny list that are anchored at its working directory now apply to the neutral directory and not to the checkout. The checkout is a git worktree whose `.git` is a file, the shared hooks and configuration are outside the writable paths, and the checkout is removed after the run. A workspace that holds the directories of `node` or `srt` (the home directory, for example) makes an agent session fail closed, because the agent could replace those files.

Reproduced before the change with the real `srt` 0.0.83 shim and the call shape of the old code (`spawnSync` with the checkout as working directory): a bare `srt` with a leading empty entry in PATH and a committed `srt` stub exits 0 and the stub writes its marker; the absolute shim with `bin` first in PATH and a committed `bin/node` stub exits 0 and that stub writes its marker, for a command that was `sh -c 'echo tests failed; exit 1'`. After the change the same two setups through `ProcessCheckExecutor` read `failed` with exit 1 and no marker.

Tests: `hostLaunch.test.ts` (new: the entries kept and dropped, links, siblings with the same prefix, the lookup, the neutral directory, `insideArgv`); `toolCommand.test.ts` and `SrtProvider.test.ts` (the command has the absolute file, the trusted PATH, the neutral directory and the profile PATH verbatim for a profile and an app PATH with relative, empty, `.`, checkout and linked entries; the launch is refused when only such an entry holds `srt`; `check()` does not find `srt` through a relative entry); `checkEnvironment.test.ts`; real `srt` in `ProcessCheckExecutor.srt.test.ts` (committed stubs named `srt`, `node`, `env`, `which`, `dirname`, `sed`, `uname` and `bash` in the root, in `bin` and in `node_modules/.bin`; four spellings of an unsafe profile PATH, and a bare `srt` with an unsafe app PATH and with no trusted `srt` at all: `failed` with exit 1 or `not_run`, and no marker).

### The minors

| Finding | State |
|---|---|
| A builtin as the first word of the command (`.`, `source`, `eval`, `exec`) runs inside the launcher shell | The launcher starts the program through `/usr/bin/env -- "$@"`, which finds no builtin; reproduced with the old script (exit 0, no signal) and gone with the new one. A first word with `=` would be an assignment of `env`, so the launcher refuses it with 127 and `command not found` (a shell would not have found such a program either). Missing program: 127 and `env: <word>: No such file or directory`, which the existing pattern turns into `not_run`. Tests: launcher rows for a list of builtins, a sourced file, `eval` and `exec`; the executor with the plain path and with real `srt` (first words `.`, `source`, `eval`, `exec` with a script that clears the trap and kills the launcher: never `passed`) |
| Clone refusal and failed `df` put a path into the reason | `probeCloneable` returns the refusal without the path; `clonePart` puts the path into `detail`; `filesystemOf` rejects with a fixed text and the path as `detail`; the reason is `the <tool> cache cannot be cloned: <cause>`. Tests assert that no part of the home or cache path is in the message and that the log has it |
| Loopback from every word of the command | `ProjectFacts.programs` (from `commandPrograms`) holds the program of each argv and the first word of each command of a `sh -c` script (after `env`, assignments, `exec`, `command`, `time` and `nohup`); `needsLoopback` reads it. `npm run test:gradle`, `sh -c 'echo skip gradle'`, `node scripts/gradle` and `mvn -Dgradle=no test` give none; `./gradlew test`, `gradle build`, `sh -c 'cd app && ./gradlew test'`, `env CI=1 gradlew` give it. A script file that runs Gradle inside needs the program in the command, as before |
| Missing tests of the review | SIGSTOP to the launcher, the group and the program under real `srt` (`timed_out`, nothing left); a program that traps TERM and exits 0 ends `timed_out` at the deadline and `not_run` on a cancel, under real `srt` and in the unit suite; the relative and empty PATH test; the clone refusal without a path |

### What was checked on the whole surface

Every place where the app starts a process with a name, a path, a PATH or a working directory that code under test or the checkpoint can influence:

| Place | Answer |
|---|---|
| `srtToolCommand` (the check under `srt`) | the major; fixed |
| `SrtEnvironment.processCommand` and `ptyCommand` (agent sessions under `srt`) | fixed in the same way, with the workspace as working directory |
| `SrtProvider.check`, `resolveCheckEnvironment` | look `srt` up on the trusted entries only |
| `plainCommand` (the check without a sandbox) | `/bin/sh` by absolute path; the program is the agent's own code with the rights of the agent, by the rule that a check never runs with less than the agent had; nothing to confine |
| `LocalProvider` | `claude` by name with the workspace as working directory and the PATH of the profile, no sandbox by choice of the profile |
| `ContainerProvider` | `docker` by name, workspace as working directory, PATH of the profile in the client environment: the same class of problem, not fixed (the container check is not connected, and the agent PATH is not forwarded to the container by name); open in 0042 |
| `GuardedGit` (`git`), `CheckClones` (`cp`, `df`), `ProcessSweep` (`ps`, `lsof`, `kill`) | started with the app's own environment, fixed arguments and no working directory from the checkpoint (`git` gets `--git-dir` and `-C` as arguments, with hooks, filters and the pager off); `cp` by absolute path on macOS |
| `new Git(undefined, () => launch().env)` of the reviewer checkouts and the swarm module's git | the PATH of the profile with `-C <path>`; a relative entry is the only way in; open in 0042 |
| The shim of `srt` | runs `dirname`, `sed`, `uname` and `node` through the PATH it gets, which is the trusted PATH |
| `srt` itself | starts `env`, `which`, `bash` and `rg` through its PATH (trusted) and uses `process.cwd()` for its mandatory deny list (the neutral directory) |
| `claude auth status`, the browser module, the profile launcher | outside the review and the isolation providers; not changed |

### Changed files and functions

Source: `core/isolation/hostLaunch.ts` (new: `findExecutable` moved here, `trustedPath`, `isWithinAny`, `locateHostBinary`, `hostLaunch`, `insideArgv`, `neutralDirectory`); `core/isolation/SrtProvider.ts` (`SrtProviderOptions.appPath`, `check`, `srtToolCommand`, `srtToolEnvironment`, `SrtEnvironment.processCommand`; `findExecutable` re-exported); `core/isolation/statusLauncher.ts` (`launcherArgv` with `directory`, `LAUNCHER_SCRIPT`, new `LAUNCHER_IN_DIRECTORY_SCRIPT`); `core/isolation/index.ts` (exports); `core/review/capture/checkEnvironment.ts` (`resolveCheckEnvironment`, `appPath`); `core/review/capture/CheckClones.ts` (`filesystemOf`, `probeCloneable`, `clonePart`); `core/review/capture/cacheTools.ts` (`ProjectFacts.programs`, `needsLoopback`, `commandPrograms`, `readProjectFacts`).

Tests: `isolation/hostLaunch.test.ts` (new), `isolation/statusLauncher.test.ts`, `isolation/toolCommand.test.ts`, `isolation/SrtProvider.test.ts`, `review/capture/checkEnvironment.test.ts`, `ProcessCheckExecutor.test.ts`, `ProcessCheckExecutor.srt.test.ts`, `CheckClones.test.ts`, `cacheTools.test.ts`.

Other: `scripts/mutation-checks.mjs`; records 0040, 0041, 0042; `app/README.md`.

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage`, with the real `srt` (`AGIDE_SRT_BIN`, `python3`) | 278 files, 3767 tests pass, 2 expected failures; `src/core` lines 97.18 (threshold 97), `src/core/review` lines 98.36. The first run had one failure in `StreamAgentRuntime.test.ts` (a pending control request that did not reject at once), a file this pass does not touch; it passed three times alone and in the second full run |
| CI-like run (a directory with only a symlink `node`, `PATH` limited to it and the system directories, no `srt`) | 277 files pass and 1 is skipped, 3607 tests pass, 160 skipped, 2 expected failures; `src/core` lines 97.19, `src/core/review` lines 98.39; margin 0.19 points. The new unit tests run against a stand-in `srt` on a PATH that the test sets |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 tests pass. The first run failed `milestone3.spec.ts` (`the isolation provider chosen for the profile`), which read the argv of the fake `srt`: it now starts with `/usr/bin/env PATH=<profile PATH>`; the test names that |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| Real-tool tests (`ProcessCheckExecutor.srt.test.ts` and `SrtProvider.test.ts`, real `srt` 0.0.83) | 143 pass, none skipped |
| Launcher tests under a terminal with job control (`script -q /dev/null bash -i -c '...'`) | `statusLauncher.test.ts` 118 pass; the real-`srt` rows for TSTP, TTIN, TTOU, SIGSTOP and `stops` 12 pass |
| New and changed mutation entries (host launch, launcher, clone refusal, loopback, timeout and cancel) | all killed. In the first run two survived: `empty PATH entries are kept` was an equivalent mutation (`isAbsolute('')` is false, so the `entry !== ''` test was redundant; the test and the entry are removed), and `the directory is read as an option` (`cd` for `cd --`) because the test gave a directory that does not exist; the test now enters a directory named `-dashed`. Two entries of earlier passes had to be updated for the new text of the source (a loopback entry and the srt-missing entry) |
| Full `pnpm mutation` | 522 killed, none survived, 1 skipped (`check env: srt missing still runs the check`: the text to replace had moved; the entry is updated and killed on its own run). About 176 minutes, alone, started 08:07 UTC on 2026-11-23 |

### What took long

The full mutation run, which grew with the entries of this pass and with the signal matrix of the launcher tests (about four minutes for each `signals:` entry). A first attempt to check the syntax of `scripts/mutation-checks.mjs` imported it, which ran the whole list: its `spawnSync` loop cannot take a SIGINT, so it had to be ended with SIGKILL, and the file it was mutating at that moment (`StreamAgentRuntime.ts`, which this pass does not own) was restored with `git checkout` and checked against HEAD. A second mistake of the same kind: a subset run that included the `signals:` entries ran for nearly an hour before it was ended the same way, and the one file it held mutated (`statusLauncher.ts`) was restored by hand. The syntax of the script is now checked with `node --check`. Two mutation survivors needed a changed test or a removed redundancy (see above).

### What was not verified

The launcher and `srt` on Linux. An agent session under the real `srt` with a hostile PATH in the profile (the command of `processCommand` is tested as a unit and the session launch through the real `srt` is tested with the fake `claude`; the planted-program test runs the check path only). The container provider and the PATH of the profile for the git calls of the reviewer checkouts, which keep their old shape (open in 0042). An app started with a PATH that lacks the directory of `node`, where the shim of `srt` fails with status 127 (`failed`).

### Leftovers

The fixture directories that killed runs left in the system temporary directory (`agide-cap-*`, `agide-check-home-*`, `agide-check-scratch-*`, `agide-fake-srt-*`, `agide-srt-settings-*`) were attributed (created during this pass, no process using them) and removed. The scratch directory `/tmp/agide-check-clone-fix-6/` (logs of the runs, the entries and reproduction scripts, two marker files of the reproduction, a symlink named `node` for the CI-like run) could not be removed: the removal was denied, so it is left for the coordinator.

## Seventh pass: check-clone-fix-7

Start 2026-11-26 06:51 UTC, end 2026-11-26 11:31 UTC. One structural change for the class that the sixth review found as two majors and five minors: a host-side lookup (a program name, a PATH, a working directory, an environment variable) that code written by an agent can influence. The changes are the diff against the checkpoint commit of the sixth pass (35baf87). The user's order of work (R18 done, R19, R21, notes, apps) is unchanged; this is the last pass of the hardening of R19.

### What was built

- `core/isolation/hostTools.ts` (new): the one module for every start on the host. `systemTool` and `systemExecFile` / `systemExecFileSync` start `df`, `chmod`, `ps`, `lsof`, `cp`, `env` and `open` by a fixed absolute path with a fixed environment in `/var/empty`. `HostTools` finds `git`, `gh`, `docker`, `srt`, `node` and `claude` on an explicit list (the absolute entries of the app's own PATH outside the agent-writable directories, then the system directories, Homebrew and the directory of Docker Desktop), keeps a found file and checks it again before each use, refuses a program that exists only in an excluded directory with a fixed reason and the path in `IsolationError.detail`, and starts programs (`execFile`, `execFileBuffer`, `run`) with the trusted PATH and `/var/empty` as the working directory. `requireAbsoluteFile` stands before the three spawns of a provider's command. `hostTools()` and `setHostTools` hold the instance of the profile process.
- `core/isolation/agentWritable.ts` (new): one source for the directories the agents of a profile may write. `sessionWriteAllowances` is what `buildSrtSettings` writes into `allowWrite`; `agentWritableDirectories` adds the defaults of `srt` (`/tmp/claude`, `/private/tmp/claude`, `~/.npm/_logs`, `~/.claude/debug`, read from `sandbox-utils.js` of 0.0.83) and the roots of the agents' workspaces. `profileHostTools.ts` builds the profile process's `HostTools` from it; the session module sets it for the process.
- `hostLaunch.ts`: the comparison of directories uses `realpathSync.native` (and the deepest existing parent for a path that does not exist yet), so a PATH entry in another letter case of an excluded directory is excluded on the default APFS volume; `hostLaunch()` and `neutralDirectory()` are gone (`HostTools.launch` and `hostDirectory`); `insideArgv` takes the variables for the program; `isLoaderVariable` and `splitLoaderVariables` name `NODE_OPTIONS`, `NODE_PATH`, `DYLD_*` and `LD_*`.
- `SrtProvider`: the lookup of `srt` and `node` goes through `HostTools` with the set of the provider (workspaces and Claude directories of its environments, the launch directories, `extraWritePaths`, `agentRoots`, the defaults of `srt`); the host-side environment has no loader variable and the program gets them through `env`; an agent session keeps the workspace as its working directory, a check starts in `/var/empty`. `ContainerProvider` finds `docker` through the module for the session, the tool command, `check()`, the orphan cleanup and the kill, with `/var/empty` as the working directory (the container's directory is `docker run -w`). `LocalProvider` finds `claude` through the module with the workspace and the working directory excluded; `resolveClaudeBinary` skips relative PATH entries.
- The other spawn sites: `guardedGit.ts`, `GitMerger.ts`, `tasks/exec.ts` (and with it the swarm `Git`, `GitWorkingDirectoryManager` and `GhPullRequestReader`) and `claudeLogin.ts` use `hostTools()`; `CheckClones.ts`, `ProcessSweep.ts`, `PersistentSwarmManager.ts` and the opener of the browser module use `systemExecFile`. `hostToolsGuard.test.ts` scans the non-test sources and fails for a file outside its allow-list that refers to `child_process`, a listed file that starts a program with another first argument, or a spawner passed on as a value.
- Small items: the launcher refuses a first word `.`, `..` or a word with a directory part that names a directory with 127 and the `command not found` line; `commandPrograms` skips the options of `env` (`-i`, `-u NAME`, `-P DIR`, `-S STRING`, `--`, `-`) and the shell keywords; the check executor writes `launch detail: <path>` to the log of the run and keeps it out of `notRunReason`; `IsolationError` has `detail`.
- Docs: 0040 section 6 has one bullet, "Host-side programs", with the rules, the set with the source of each part, the audit of the spawn sites and what the rules do not cover; the security rows, the loopback bullet (what `commandPrograms` cannot see) and the open items follow it; 0041, 0042 and `app/README.md` are updated; 0042 closes the four rows and has a row for this pass.

### What was checked on the whole surface

A text search over `src/core`, `src/main` and `src/preload` for `execFile`, `execFileSync`, `spawn`, `spawnSync`, `exec`, `fork` and `child_process`, and a read of every place that resolves a program name, a path, a PATH, a working directory or an environment variable that an agent, a checkpoint, code under test or a profile can influence. The list with the decision for each site is in 0040 section 6, "Host-side programs", item 7, and is the allow-list of the guard test. Beyond the starts:

| Place | Answer |
|---|---|
| `resolveClaudeBinary` | built a path from a relative PATH entry (`join('node_modules/.bin', 'claude')`, resolved against the working directory); it takes absolute entries only now |
| `LocalProvider` | started `claude` by name with the workspace as the working directory; found through the module now, with the workspace and the working directory excluded |
| `claude auth status` | looked `claude` up on the PATH of the profile; goes through the module now |
| The hook script of a session (`mktemp`, `cat`, `mv` by name) | runs inside the session: confined under `srt` and `container`, the user's PATH under `local`; cannot name absolute paths because of the image of the container provider; stated in 0040 as not covered |
| The inspector hook | its command names `process.execPath` and the script by absolute path; unchanged |
| `plainCommand` (a check without a sandbox) | `/bin/sh` by absolute path; the program is the agent's own code with the agent's rights |
| Environment variables | `AGIDE_CLAUDE_BIN`, `AGIDE_SRT_BIN` and the `dockerBinary` option go through the module; `NODE_OPTIONS`, `NODE_PATH`, `DYLD_*`, `LD_*` of the profile no longer reach the host-side process of `srt`; `git`, `gh` and `claude` get the environment of their caller with the PATH replaced (it comes from the profile or the app, not from an agent); `GuardedGit` still drops `GIT_*` |
| Working directories | every host-side start but an agent session gets `/var/empty`; an agent session keeps the workspace (`srt` anchors its mandatory deny list there, and `claude` needs it), with an absolute file, the trusted PATH and the filtered environment |
| A claude below the Claude configuration directory | refused as the host-side CLI of `claude auth status` when the profile uses the default login (`~/.claude/local`): the directory is writable by the agent; stated in 0040 |

### Changed files and functions

Source, new: `core/isolation/hostTools.ts` (`systemTool`, `systemExecFile`, `systemExecFileSync`, `hostDirectory`, `requireAbsoluteFile`, `HostTools` with `directories`, `path`, `find`, `shadowed`, `require`, `refuseHidden`, `launch`, `execFile`, `execFileBuffer`, `run`, `hostTools`, `setHostTools`); `core/isolation/agentWritable.ts` (`claudeTempDir` moved here, `srtDefaultWritePaths`, `sessionWriteAllowances`, `agentWritableDirectories`); `core/isolation/profileHostTools.ts` (`createProfileHostTools`); test helpers `core/isolation/caseProbe.ts` and `fakeDocker.ts`.

Source, changed: `core/isolation/hostLaunch.ts` (`nativePath`, `spellings`, `insideArgv`, new `isLoaderVariable` and `splitLoaderVariables`; `hostLaunch`, `HostLaunch` and `neutralDirectory` removed); `SrtProvider.ts` (`SrtProviderOptions.hostTools` and `agentRoots`, `SrtProvider.writable`, `check`, `prepare`, `hostStart`, `srtToolCommand`, `srtToolEnvironment`, `SrtEnvironment.writable`, `processCommand`, `toolCommand`); `ContainerProvider.ts` (options `appPath`, `hostTools`, `agentRoots`; `check`, `removeOrphans`, `prepare`, `ContainerEnvironment.dockerLaunch`, `dockerCommand`, `toolCommand`, `terminate`); `LocalProvider.ts` (`processCommand`, option `hostTools`); `srtSettings.ts` (`buildSrtSettings` reads `sessionWriteAllowances`); `types.ts` (`IsolationError.detail`); `defaultProviders.ts` (`ProviderSetup.hostTools` and `agentRoots`, `buildIsolatingProvider`); `statusLauncher.ts` (`REFUSE_DIRECTORY` in both scripts); `index.ts`; `session/env.ts` (`resolveClaudeBinary`); `session/PtySessionService.ts`, `swarm/runtime/StreamAgentRuntime.ts`, `review/capture/runProcess.ts` (`requireAbsoluteFile` before the spawn); `review/capture/CheckClones.ts` (`cloneCommand`, `cloneWithCp`, `filesystemOf`, `removeTree`), `ProcessSweep.ts` (`run`, `safePgid`), `guardedGit.ts` (`execGit`), `checkEnvironment.ts` (`CheckEnvironmentInput.srt.hostTools`, `resolveCheckEnvironment`), `ProcessCheckExecutor.ts` (`launchDetail`), `cacheTools.ts` (`startedProgram`, `SHELL_KEYWORDS`, `ENV_OPTIONS_WITH_VALUE`); `review/manager/GitMerger.ts` (`runGit`); `tasks/exec.ts` (`execFileNoShell`), `tasks/GhPullRequestReader.ts` (`ghMessage`); `profile/claudeLogin.ts` (`runWithExecFile`); `swarm/manager/PersistentSwarmManager.ts` (`systemProcesses.commandLine`); `main/browser/openInChrome.ts` (`OpenInChromeDeps.execFile`), `main/modules/browser.ts` (the opener), `main/modules/session.ts` (the profile's host tools: `createProfileHostTools`, `setHostTools`, the setup of the providers).

Shared files with the smallest change that the structure needs: `tasks/exec.ts`, `GhPullRequestReader.ts`, `PersistentSwarmManager.ts`, `StreamAgentRuntime.ts`, `PtySessionService.ts`, `main/modules/browser.ts`, `main/browser/openInChrome.ts`, `profile/claudeLogin.ts`, `review/manager/GitMerger.ts`, `session/env.ts`, `e2e/milestone3.spec.ts` and `e2e/fixtures/fake-srt.mjs` (the fake `srt` records the names of its loader variables, its working directory and its PATH, and the test asserts them).

Tests, new: `isolation/agentWritable.test.ts`, `hostTools.test.ts`, `hostSpawnSites.test.ts`, `hostToolsGuard.test.ts`. Changed: `hostLaunch.test.ts` (case variant, loader variables, `insideArgv`), `SrtProvider.test.ts` (stand-ins in each writable directory for a session and a check, the other environments' workspaces, the launch directories, the hidden `node`, the loader variables, a real-`srt` session under a hostile profile PATH), `toolCommand.test.ts` (checks with the profile's tools and a spawn of the command), `ContainerProvider.test.ts` (a fake `docker` file, relative and empty PATH entries, one fresh provider for each of the check, the cleanup and the kill), `providers.test.ts` (`LocalProvider` and the host tools), `isolationCommands.test.ts` (the setup reaches the providers), `statusLauncher.test.ts` (the first word `.`), `session/env.test.ts`, `review/capture/cacheTools.test.ts`, `checkEnvironment.test.ts`, `ProcessCheckExecutor.test.ts` (an absolute file; the detail in the log only), `ProcessCheckExecutor.srt.test.ts` (stand-ins in two writable directories under the real `srt`), `CheckClones.test.ts`, `tasks/GhPullRequestReader.test.ts`, `main/modules/review.test.ts` (the lookup of the module graph excludes `extraWritePaths` and the task base; the slow sweep through a mock of `systemExecFile`; the fake `srt` outside the task base).

Other: `scripts/mutation-checks.mjs` (entries for each decision, the changed entries of the earlier passes); records 0040, 0041, 0042; `app/README.md` ("Host-side programs").

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage` with the real `srt` (`AGIDE_SRT_BIN`, `python3`) | 282 files and 3847 tests pass, 2 expected failures, 17 skipped; `src/core` lines 97.32, `src/core/review` lines 98.50. One test is left out with `-t`: `resolves a dependency offline from the cloned module cache` (Gradle fails in its Groovy initialisation on the JDK of this machine; the same failure on a clean copy of the commit 35baf87, so it does not come from this pass; without the filter vitest writes no coverage report) |
| CI-like run (a directory with only a symlink `node`, `PATH` limited to it and the system directories, no `srt`, no Docker) | 281 files pass and 1 is skipped, 3701 tests pass, 163 skipped, 2 expected failures; `src/core` lines 97.32 against the threshold of 97 (margin 0.32 points, up from 0.19), `src/core` branches 86.81 (threshold 85), `src/core/review` lines 98.50, `src/main` lines 85.44 |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 tests pass. The first run failed `milestone3.spec.ts` (`the isolation provider chosen for the profile`): the Playwright worker puts `NODE_PATH` into the environment of the app, and it now stands between `PATH=` and `claude` in the argv of the fake `srt`, not in its environment. The test finds `claude` after the assignments and asserts that the process of the fake `srt` has no loader variable and a PATH of absolute entries only (the PATH of the end-to-end app starts with `./node_modules/.bin`) |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| Real-tool tests (`ProcessCheckExecutor.srt.test.ts`, `SrtProvider.test.ts` and the rest of the suite, real `srt` 0.0.83, `python3`) | in the run above: the real-tool tests run, the Docker tests are skipped (no engine or image here); the new real-`srt` tests pass: a session and a check with programs planted in the workspace and in `extraWritePaths` and below the Claude directory, under a hostile PATH, with no marker outside the sandbox and the failing check read as `failed` |
| Launcher and real-`srt` stop tests under a terminal with job control (`script -q /dev/null bash -i -c '...'`) | `statusLauncher.test.ts` and `toolCommand.test.ts` 137 pass; the real-`srt` rows for TSTP, TTIN, TTOU, SIGSTOP and `stops` 12 pass |
| New and changed mutation entries, run as a subset first | 96 entries of the first subset: 91 killed, 5 survived. `a host program may be started by a relative path` was dead code (`require` always returns an absolute file) and was removed with its entry. Four container entries survived because `HostTools` keeps the first found file, so a later call without the exclusion still gets the trusted file: the test now uses a fresh provider for the check, the cleanup and the kill, the cleanup shares one options object between its two calls, and a root of the agents' workspaces is tested for the client lookup; `forgets the workspaces it prepared` needed a second environment. All of them are killed. Eight entries for the wiring (the process's tools, the roots, the options, the providers' setup) were added and killed. Sources and the script restored byte for byte after every subset (`diff -r` against a copy) |
| Full `pnpm mutation` | 586 killed, one survived, none skipped (587 entries at the start of the run; about 167 minutes, alone, started 08:42 UTC). The survivor, `merge git: attributes are read in the merge`, is an entry of an earlier pass: its test changed the working directory of the test process to the repository so that git would read the work tree attributes, and git now starts in `/var/empty`, so the test no longer reached the attributes. The test sets `attr.tree` to `HEAD` in the shared configuration instead (the way an agent could make git read committed attributes), and the entry is killed on its own run; the run of that file passes. Sources and the script restored byte for byte after the run (`diff -r` and `cmp` against copies) |

### What took long

The full mutation run, which grew with the entries of this pass and with the signal matrix of the launcher tests; it ran alone. The first full unit run with the real tools took about ten minutes and looked stuck at its last files; it was only slow, and a `pkill` of the vitest processes was denied by the permission system and not repeated in another form, so the run ended by itself. The Gradle test that fails on this machine cost two comparisons to show that it fails on the checkpoint commit as well (a clean copy of the commit under `/tmp/agide-check-clone-fix-7/orig`, with `node_modules` linked, not copied). Moving the slow `lsof` of `main/modules/review.test.ts` from a stand-in on the PATH to a mock of `systemExecFile` was needed because the sweep now starts `lsof` by its fixed path.

### What was not verified

Linux: the paths of `lsof` and the opener, the `cp --reflink` call and the launcher signals are from the manuals only. Docker: no engine or image is available here, so the Docker tests of `ContainerProvider` did not run; the command, the check, the cleanup and the kill are tested against a `docker` that is a file of the test. The check under `container` is not connected. An app started from the Dock with a PATH that lacks the directory of `node` still reaches `node` only through Homebrew's directories (0040 section 6). A `claude` installed below `~/.claude` (the default login) is refused as the host-side CLI; no test runs it from there other than the unit tests of the exclusion. The hook script of a session names `mktemp`, `cat` and `mv` by name; under `local` that is the user's PATH (stated in 0040). The real Claude was not started: no step of this pass needed it.

### Leftovers

The scratch directory `/tmp/agide-check-clone-fix-7/` (logs of the runs, copies of the sources for the byte comparison, a clean copy of the checkpoint commit with a linked `node_modules`, the CI-like directory with a symlink named `node`) was removed at the end: the link was removed first, and the real `node_modules` is intact. Five `dbg-*` directories that my own debugging tests made in the system temporary directory were removed; three other `dbg-*` directories there (dated 14 and 21 November) are not from this pass and were left. No fixture of the new tests is left in the system temporary directory.

## Eighth pass: check-clone-fix-8

Start: 2026-11-26 12:55 UTC (`date -u`). End: 2026-11-26 14:27 UTC.

### What was built

The eighth and ninth passes are one commit. Where they differ (the route of the variables of the profile, `ProviderSetup`, a registry that keeps what it learns), the section of the ninth pass describes the code as committed.

The independent review of the seventh pass found two majors and four minors, all gaps in what the set of agent-writable directories holds and in what the lookup compares. The structure stayed (one module, one set, one guard); this pass closes them inside it.

- **One registry.** `AgentWritableRegistry` (`agentWritable.ts`: `add`, `directories`) holds the profile's set as it becomes known. `createProfileHostTools` returns `{ tools, writable }`; `HostTools` reads the registry through its `excluded` callback, which is now a required option. `SrtProvider`, `ContainerProvider` and `LocalProvider` lost their private `known` sets and `agentRoots` options: each `prepare` and each command adds the workspace, the working directory, the inbox, the mounts of a launch, the directories of a check launch and the Claude directory of the profile, and `ContainerProvider` adds its own Claude directory when it is built. The session module adds the working directories of the sessions in the store at start. `ProviderSetup` carries `hostTools` and `writable`. A directory is never removed.
- **Real path.** `HostTools.find`, `shadowed` and `refuseHidden` refuse a candidate whose real path, or whose cmd-shim target (`# cmd-shim-target=` of a file of at most 16 KiB, a relative target made absolute against the real directory of the shim), lies in the set. `refuseHidden('node')` checks the first `node` of the host-side PATH, which is the one the shell of the `srt` shim finds. `locateHostBinary` is removed. The installed pnpm shim of this host names `…/global/<hash>/node_modules/@anthropic-ai/sandbox-runtime/dist/cli.js`, which is a link into `~/Library/pnpm/store/…`: with that store in `extraWritePaths` the shim is refused. No seam exists to refuse an `extraWritePaths` entry that holds the code of `srt`, `node`, `git` or `docker` when the options are saved (`isolation_set_provider` takes no such field and the settings store keeps `isolation.options` as unvalidated data); the provider check that the command runs before it saves a choice refuses it, and a launch fails closed with the fixed reason. Written in 0040 section 6, items 6 and 9.
- **Allow-list environment of the host-side `srt`.** `splitHostVariables` and `isHostSideVariable` (`hostLaunch.ts`) replace `splitLoaderVariables`: the process of `srt` gets PATH, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LANGUAGE`, `TERM`, `LC_*`, the names `srt` 0.0.83 reads (`SRT_*`, `CLAUDE_CODE_TMPDIR`, `CLAUDE_TMPDIR`) and the names it sets or extends for the program (proxy and trust-store variables, `JAVA_TOOL_OPTIONS`, `GIT_CONFIG_*`, `GIT_SSH_COMMAND`); everything else goes through `/usr/bin/env` inside the sandbox. The names were read from `dist/sandbox/sandbox-utils.js`, `macos-sandbox-utils.js`, `parent-proxy.js` and `mitm-ca.js` of the installed package.
- **Spawn guard.** Flags an alias by assignment, `.call`, `.apply`, `.bind`, an optional call, a destructuring or an index of a namespace, the namespace handed on, `require` and `import()` of `child_process` and `node-pty` also in listed files (with a per-file exemption for the text of the stand-in `srt`), `require` or `import()` with a computed name, `getBuiltinModule`, `createRequire`, a spawn whose program is `command.file` of a `command` that is not declared in the form the entry allows, and a `HostTools` built outside the wiring. It scans `.mjs`, `.js` and `.cjs` (the stand-in programs of the tests are listed as fixtures). Strings are blanked for the value scan so a word in a message is not a use.
- **Reasons.** A refusal names the role and the base name (`the sandbox runtime (srt) exists only in a directory that an agent may write, or runs code that lies in one, so it was not started`), and the configured path goes to `IsolationError.detail`; a configured absolute path that is missing has the text `… is not an executable file at the configured path`. The provider checks (`srt`, local `claude`) name no path either. `GhPullRequestReader` reads the new text as "gh is not installed".
- **Launcher.** The 126 of a bare word that names a directory found through a relative or empty PATH entry is stated in 0040 and 0042, and a test checks it; the launcher is unchanged except for a comment. The sentence "ends 127" of 0042 now says which words end 127.

### Probes

- The review's two shell-variable probes were repeated: `env -i PATH=/usr/bin:/bin 'BASH_FUNC_uname%%=…' /bin/sh -c uname` and `SHELLOPTS=xtrace 'PS4=$(./x ps4)' /bin/sh -c true` both ran `./x` (a Node script that writes a marker). The real-`srt` test with both in the profile now finds no marker. A first version of that test made `./x` a shell script, which xtrace traced and which started itself through `PS4` without end: a fork bomb that stopped every `fork` of the machine for a few minutes until the background job was stopped (`TaskStop`); the test uses a Node script and a `spawnSync` timeout.
- With the real `srt` and the installed pnpm shim, a failing check with stand-ins for `git`, `gh`, `docker`, `srt` and `node` in a directory outside the task base on an absolute PATH entry reads `failed`, with a fresh and with a warm `HostTools`, and no stand-in runs.

### Surface checked

Launch paths: a session under `srt` (`SrtEnvironment.processCommand`, the PTY and the stream path both go through it), under the container provider (`dockerCommand`, `toolCommand`), under `local` (`LocalEnvironment.processCommand`); swarm agents and reviewers (they launch through the session service and the same providers; their worktrees, workspaces and `review-runs` checkouts are below the task base, which is a root of the registry); the project check (`srtToolEnvironment` through the review module: checkout, temporary directory and clones are below the task base; `SrtEnvironment.toolCommand` adds them to the registry as well); the reviewer checkouts and `new Git(undefined, () => launch().env)` (through the shared tools). Places where a directory becomes writable: the settings of `srt` (`buildSrtSettings`, `buildToolSrtSettings`), the container mounts, `extraWritePaths`, the defaults of `srt`, the Claude directories. The registry can miss: a directory that no launch and no stored session has made known yet (a program planted by an earlier run of another app process of the same user, or by the user); a profile process other than this one; `AGIDE_TASK_BASE` changed after the modules started; the directories that `srt` makes writable by another version than 0.0.83; the programs that the `srt` shim looks up by directory (`uname`, `dirname`, `sed`, `readlink`); a shim larger than 16 KiB; a package directory whose `node_modules` links into an excluded place while `cli.js` does not; a `local` session without the Bash sandbox, which writes whatever the user can.

### Changed files and functions

Source: `core/isolation/agentWritable.ts` (`AgentWritableRegistry`, `AgentWritableSource`), `hostTools.ts` (`HostToolsOptions.excluded` required, `shimTargets`, `runsExcludedCode`, `HostTools.usable`, `find`, `shadowed`, `refusal`, `require`, `refuseHidden`, the shared default instance), `hostLaunch.ts` (`splitHostVariables`, `isHostSideVariable`, `insideArgv` text; `locateHostBinary`, `isLoaderVariable`, `splitLoaderVariables` removed), `profileHostTools.ts` (`createProfileHostTools` returns `{ tools, writable }`, `ProfileHostTools`), `SrtProvider.ts` (options `writable`, `check`, `prepare`, `hostStart`, `srtToolCommand`, `srtToolEnvironment`, `SrtEnvironment.processCommand`, `toolCommand`), `ContainerProvider.ts` (options `writable`, constructor, `check`, `removeOrphans`, `prepare`, `dockerLaunch`, `dockerCommand`, `toolCommand`, `terminate`), `LocalProvider.ts` (options `writable`, `check`, `processCommand`), `defaultProviders.ts` (`ProviderSetup`, `hostToolOptions`, `ConfiguredProviders`), `providerRegistry.ts` (constructor type), `index.ts`, `statusLauncher.ts` (comments only); `review/capture/checkEnvironment.ts` (`appPath` removed); `main/modules/session.ts` (`createProfileHostTools` result, `writable`, the stored sessions); shared file with the smallest change: `tasks/GhPullRequestReader.ts` (`ghMessage` reads the new not-found text).

Tests, new: `isolation/agentWritableLaunch.test.ts`. Changed: `agentWritable.test.ts` (registry), `hostTools.test.ts` (real path, shim targets, reasons, shared default), `hostLaunch.test.ts` (allow-list), `hostToolsGuard.test.ts` (spellings, declarations, `.mjs` fixtures, `HostTools` builders), `SrtProvider.test.ts` (registry-sharing helper, allow-list environment, absolute `srt` reasons, the shell-function probe against the real `srt`), `ContainerProvider.test.ts`, `providers.test.ts`, `isolationCommands.test.ts`, `toolCommand.test.ts`, `statusLauncher.test.ts` (126), `isolationProviderContract.ts` (the started environment includes the `env` assignments), `review/capture/checkEnvironment.test.ts`, `ProcessCheckExecutor.srt.test.ts`, `main/modules/review.test.ts` (the sessions of the store, the check environment of the module), `e2e/milestone3.spec.ts` and `e2e/fixtures/fake-srt.mjs` (the fake `srt` reads its record path from the `env` assignments and records its variable names).

Other: `scripts/mutation-checks.mjs` (the entries of the replaced code removed, an entry for each decision added, two corrected after a first run); records 0040 (section 6 items 2, 3, 4, 6, 7, 9, the launcher row, the risk row), 0041, 0042 (the seventh review row closed, the eighth pass row, three rows of the open list); `app/README.md` ("Host-side programs").

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage` with the real `srt` (`AGIDE_SRT_BIN`), `python3`, one Gradle test left out with `-t` | 283 files, 3907 tests pass, 2 expected failures, 17 skipped; `src/core` lines 97.33 (threshold 97), branches 86.90 (85), `src/core/isolation` lines 99.10, `src/core/review` lines 98.50, `src/main` lines 85.45 |
| CI-like run (a directory under `/tmp` with only a symlink `node`, PATH limited to it and the system directories, no `srt`, no Docker) | 282 files pass and 1 is skipped, 3759 tests pass, 165 skipped, 2 expected failures; `src/core` lines 97.33 (margin 0.33 points), branches 86.88, `src/core/review` lines 98.50, `src/main` lines 85.51 |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass. The first run failed `milestone3.spec.ts` (the isolation provider): the fake `srt` read its record path from its own environment, which no longer holds a variable of the profile; it now reads it from the `env` assignments of its command, and the test checks that the process of the fake `srt` has only allowed names |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| Real-tool tests (real `srt` 0.0.83, `python3`) | in the coverage run above; `ProcessCheckExecutor.srt.test.ts` alone under a job-control terminal (`script -q /dev/null bash -i -c '…'`): 130 pass, 1 fails: `resolves a dependency offline from the cloned module cache` (Gradle fails in its initialisation on the JDK of this machine; the same on the unchanged tree) |
| Launcher tests under a job-control terminal | `statusLauncher.test.ts` and `toolCommand.test.ts`: 138 pass |
| Mutation entries of the areas changed (the script with a filter, not the full list): first subset (`registry:`, `real path:`, `reasons:`, `host env:`, `spawn guard:`, `host tools:`, `container:`, `local:`, `wiring:`, `writable:`, `launcher: a bare`) | 95 entries: 92 killed, 3 not: one broke the syntax of the source (a removal that left an empty `if`), one was run against a test list that lacked the file that kills it, one asserted a text that the mutation still satisfied; the entry or the test was corrected and the three were killed on a second run (3 of 3) |
| Second subset (`host launch:`, `launcher:`, `check env:`, `check: the path of a refused`, `check: the srt tool`) | 31 killed, 0 survived |
| Entries not rerun | the `signals:` group (the launcher changed by a comment only) and every entry of the other areas; the full `pnpm mutation` was not run. A dry run of the script against the final sources finds the text of all 624 entries exactly once, so every mutated file was restored |

### What took long

The mutation subsets (about 20 minutes and 12 minutes, alone) and the two coverage runs (about 6 minutes each). The fork bomb of the first real-`srt` probe test cost a few minutes of a machine that could not start a process.

### What was not verified

Docker: no engine or image here; the container tests that need one are skipped, and the container paths are tested against a `docker` that is a file of the test. Linux and the other versions of `srt`: the allow-list names are from 0.0.83 on macOS. A real `srt` check with `extraWritePaths` holding the pnpm store was not run (the unit tests plant a pnpm-style tree in a temporary directory). The review of this pass is open.

### Leftovers

`/tmp/agide-check-clone-fix-8/` (logs of the runs, a dry copy of the mutation script, the directory `nobin` with a symlink `node`, a probe directory `probe`; a few MB) was not removed: the permission system denied the removal of the probe directory and it was not repeated in another form. The coordinator removes the directory. A temporary directory of the fork-bomb test in the system temporary directory was removed. `review-module-base-*` directories in the system temporary directory date from earlier runs (some from 23 November) and were not made by this pass.

## Ninth pass: check-clone-fix-9

Start: 2026-11-26 19:24 UTC (`date -u`). End: 2026-11-26 21:40 UTC.

The eighth and ninth passes are one commit. The independent review of the eighth pass found two majors and six minors; this pass closes them inside the structure of the eighth pass and does not revert it.

### What was built

- **A registry that never forgets.** `AgentWritableRegistry` takes an optional `AgentWritableMemory`; `AgentWritableStore` (`agentWritableStore.ts`, module `agent_writable`, migration 1: table `agent_writable_directories (path, recorded_at)`) keeps it in the profile database, which no sandboxed agent or check may read or write. The registry loads the table when it is built, records each directory it learns (each `add`, and at each lookup what the profile says then: `extraWritePaths`, the Claude directory, the task base) and never deletes a row; `directories()` is the union. `SrtProvider` adds the `extraWritePaths` it was built with when it is built, since its sessions may write them whatever the profile says later. The session module builds the store over `ctx.db`. A row stays for the life of the profile database; 0040 section 6 item 6 and `app/README.md` give the `sqlite3` command that removes one after the app is quit.
- **No value of the profile is an argument.** `insideRoute` (`hostLaunch.ts`) puts every variable that the host-side `srt` must not have, the PATH of the profile included, into its environment as `AGIDE_INSIDE_<NAME>`, a prefix that no shell, Node, the loader or `srt` reads; the one argument `AGIDE_INSIDE_NAMES=A,B` lists the names. Inside the sandbox `insideArgv` (session: the shell exports and replaces itself with the program) and `launcherArgv(argv, { directory, inside })` (check: the exports run in a subshell that becomes the program, so the launcher keeps its traps) check each name again and export it with `eval "export NAME=\"\${AGIDE_INSIDE_NAME}\""`, which never parses the value, then remove the carrier. Names that are no shell identifier, names that bash 3.2 refuses as read-only or sets itself (measured on this host by exporting each and reading it back: `SHELLOPTS`, `EUID`, `PPID`, `UID`, `BASH_VERSINFO`, `BASH_ARGV`, `BASH_ARGC`, `BASH_LINENO`, `BASH_SOURCE`, `BASH_SUBSHELL`, `BASH_COMMAND`, `RANDOM`, `SECONDS`, `LINENO`, `HISTCMD`, `GROUPS`, `DIRSTACK`, `FUNCNAME`, `OPTIND`, `SHLVL`, `_`) and names of the route itself are dropped; `PtyCommand.dropped` lists them and the log of a check run names them. The container provider already passed `-e NAME` with the value in the environment of the client; a test now checks it with derived values.
- **Locale of the launcher.** The first full end-to-end run failed the isolation test of `milestone3.spec.ts`: the launcher checked each name with `[!A-Za-z_]`, and a bracket range follows the collation of the locale; under `et_EE.UTF-8` (the locale of this host, which the app passes on) `A-Z` leaves out `T` to `Y`, so `TMPDIR` or `TERM_PROGRAM` ended the session with status 2. The check uses `[:alpha:]` and `[:alnum:]` now, and a launcher test runs under `C`, `et_EE.UTF-8` and `en_US.UTF-8`.
- **The `node` beside the shim.** `HostTools.refuseBeside` refuses a `node` beside the real file of `srt` that lies in, or leads into, an excluded directory; `hostStart` calls it, since the pnpm shim runs `$basedir/node` first. The review's probe is a test.
- **The guard.** Flags a re-export of `child_process` or `node-pty`, `module.require` and `process.mainModule`, a `require` method that names the module, a template with an interpolation as the module name, `eval` and `Function` below `src/core` and `src/main`, a changed member of the `command` that a spawn reads (`command.file =`, `Object.assign`, `Reflect.set`), `HostTools` as a value outside the builder files (`new (HostTools)`, an alias, an argument, `Reflect.construct`, a subclass), and scans `.mts` and `.cts`. 0040 item 7 says that the scan stops accidental spellings.
- **Home Claude paths.** `agentWritableDirectories` always holds `~/.claude` and `~/.claude.json` (`defaultClaudePaths`).
- **Reasons.** `codeText` (`runProcess.ts`) names a system error by its code; a spawn failure of `srt` or `docker`, a launch that cannot be prepared (the settings file) and a failed checkout give fixed texts, and the message goes to the log of the run (`launch detail:`, `checkout detail:`).
- **Firmlinks.** `isWithinAny` also compares each spelling without a leading `/System/Volumes/Data`.
- **Coupling.** `ProviderSetup.host` is one `ProfileHostTools`, so `buildIsolatingProvider` gives a provider the tools and the registry together or neither.
- **Words.** The eighth account no longer uses a word of the banned list: the sentence about the launcher says that a test checks it.

### Surface checked

Where a value of the profile can leave the environment it started in: the arguments of `srt` (names only), of `sandbox-exec` that `srt` starts (it takes the argv after `--`: names only; checked with `ps` while a real program ran), of the launcher shell and of `/usr/bin/env` inside (names and the program's own argv), of `docker` (`-e NAME`, mounts, labels and `HOME=/tmp`), of `git`, `gh` and `claude auth status` (fixed arguments; the environment is passed as the environment), the srt settings file (no variables; under the data directory, which agents cannot read), the run log (names of dropped variables only), and the eval string of the launcher (names only). The value still is in the environment of the host-side `srt`, which only the user and root can read, and in the environment of the program inside, which is where it was meant to go; sandboxed code of the same user can read process environments (`KERN_PROCARGS2`), as before.

Where the registry could lose a directory: a closed session (recorded at launch), a restart (loaded), an `extraWritePaths` entry removed while the app runs (kept in the instance and recorded at the first lookup or when the provider is built), a moved `AGIDE_TASK_BASE` (recorded at the first lookup of each start), a changed Claude directory (recorded at lookup and at `prepare`). Not covered: a session closed before a build with the table ran; host-side lookups of modules that start before the session module sets the profile tools (`profile`, `tree`, `mcp`, `permissions`; none starts a program during its start); another profile process.

### Changed files and functions

Source: `core/isolation/agentWritable.ts` (`defaultClaudePaths`, `agentWritableDirectories`, `AgentWritableMemory`, `AgentWritableRegistry` constructor, `add`, `directories`), `agentWritableStore.ts` (new: `AgentWritableStore`, `agentWritableMigrations`, `AGENT_WRITABLE_MODULE`), `profileHostTools.ts` (`memory` input), `hostLaunch.ts` (`spellings`, `splitHostVariables`, `INSIDE_PREFIX`, `INSIDE_NAMES_ARGUMENT`, `insideRoute`; `insideArgv` moved), `statusLauncher.ts` (`STATUS`, `ENTER`, `TAKE_NAMES`, `IMPORT`, `LAUNCHER_INSIDE_SCRIPT`, `INSIDE_SCRIPT`, `insideArgv`, `launcherArgv`), `hostTools.ts` (`refuseBeside`), `SrtProvider.ts` (constructor, `hostStart`, `srtToolCommand`, `processCommand`), `defaultProviders.ts` (`ProviderSetup.host`, `hostToolOptions`, `ConfiguredProviders`), `types.ts` (`PtyCommand.dropped`), `index.ts`; `review/capture/runProcess.ts` (`codeText`, `spawnFailure`, `ProcessResult`), `ProcessCheckExecutor.ts` (`execute`: checkout failure, launch failure, the note of dropped names; `logName`); `main/modules/session.ts` (the store, `host`).

Tests: `agentWritable.test.ts`, `agentWritableLaunch.test.ts`, `hostLaunch.test.ts`, `hostTools.test.ts`, `hostToolsGuard.test.ts`, `statusLauncher.test.ts`, `SrtProvider.test.ts`, `toolCommand.test.ts`, `ContainerProvider.test.ts`, `isolationCommands.test.ts`, `isolationProviderContract.ts` (`startedEnvironment` reads the carriers), `review/capture/ProcessCheckExecutor.test.ts`, `checkEnvironment.test.ts`, `main/modules/review.test.ts`, `e2e/milestone3.spec.ts`, `e2e/fixtures/fake-srt.mjs`.

Other: `scripts/mutation-checks.mjs` (entries of replaced code rewritten, entries for each decision of this pass added), records 0040 (section 6 items 2, 3, 4, 6, 7, 8, 9, the isolation and exit-status bullets, the risk row), 0041, 0042 (the eighth review row, the row of the two passes, the open rows), `app/README.md`.

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage` with the real `srt` (`AGIDE_SRT_BIN`), `python3`, the Gradle test `resolves a dependency offline` left out with `-t` (it fails on the JDK of this host on the unchanged tree) | 283 files, 3960 tests pass, 2 expected failures, 17 skipped; `src/core` lines 97.35 (threshold 97), branches 86.91 (85), `src/core/isolation` lines 99.17, `src/core/review` lines 98.54, `src/main` lines 85.46 |
| CI-like run (`/tmp/agide-check-clone-fix-9/nobin` with only a link `node`, PATH limited to it and the system directories, no `srt`, no Docker) | 282 files pass and 1 is skipped, 3809 tests pass, 168 skipped, 2 expected failures; `src/core` lines 97.35 (margin 0.35 points), branches 86.91, `src/core/review` lines 98.58, `src/main` lines 85.46 |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | first run: 83 pass, 3 fail (the isolation test of `milestone3.spec.ts`, from the locale defect above; `swarm.spec.ts` "answers a deny from the inbox card", `swarm_send: ... takes no more input`; `tree.spec.ts` "renames a node inline", a `fill` timeout). After the fix the three files pass (10 tests) and the whole run passes: 86 pass |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| Real-tool tests under a job-control terminal (`script -q /dev/null bash -i -c '…'`, real `srt` 0.0.83): `statusLauncher.test.ts`, `toolCommand.test.ts`, `SrtProvider.test.ts`, `agentWritableLaunch.test.ts`, `ProcessCheckExecutor.srt.test.ts` | 333 pass, 1 fails: the Gradle test above |
| Mutation entries of the changed areas (`scripts/mutation-checks.mjs` with a filter: `inside:`, `durable:`, `shim node:`, `home claude:`, `firmlink:`, `reasons:`, `coupling:`, `spawn guard:`, `registry:`, `wiring:`, `host env:`, `host launch:`, `writable:`, `launcher:`, the `signals:` entries of the launcher, `check: the path`) | 139 entries: 129 killed, 10 survived. One had a test list without the file that kills it; one (`exec` left out of the session script) was equivalent, since bash 3.2 executes the last command of `-c` in place; one compared with `isWithinAny`, which resolves links too, and was equivalent; seven guard entries survived because the samples tripped other rules (an unlisted file, a missing declaration), so the guard test now checks that each new spelling fires its own rule. The entries and the test were corrected and the eleven were killed on a second run; six entries that plant the new spellings in real sources were added and killed |
| After the locale fix: `inside:`, `launcher:` and the launcher `signals:` entries again | 25 killed, 0 survived |
| Entries not rerun | every entry of other areas; the full `pnpm mutation` was not run. A dry check of the script finds the text of all 672 entries exactly once, and each mutated file was compared with a copy (`cmp`) after the reruns |

### What took long

The first mutation subset (about 50 minutes: the entries of the launcher and the check executor each run test files that take a minute) and the two pairs of coverage runs (about 6 minutes each). Finding the locale defect took one end-to-end rerun and a probe of `case` under `et_EE.UTF-8`.

### What was not verified

Docker (no engine here; the container commands are tested as built commands). Other versions of bash than 3.2 for the list of names the launcher cannot set (bash 4 adds `BASHOPTS` and `BASHPID`, which the list holds). The independent review of this pass is open.

### Leftovers

`/tmp/agide-check-clone-fix-9/` (logs, the patch of the eighth pass, a dry-check script, copies of mutated files, the directory `nobin` with a link `node`) is removed at the end of the pass; see the report for what could not be removed. The tests remove their fixtures in the system temporary directory; the read-only fixtures of the new tests get their mode back before removal.

## Tenth pass: check-clone-fix-10

Start: 2026-11-27 21:37 UTC (`date -u`). End: 2026-11-27 23:12 UTC.

The eighth, ninth and tenth passes are one commit. The independent review of the ninth pass found one major and six minors; this pass closes them inside the structure of the earlier passes and is the last pass of the hardening.

### What was built

- **A small registry with cheap lookups.** `AgentWritableRegistry` keeps in memory only the directories that no other one contains: a directory whose real path lies within a directory of the set adds no row (a workspace below the task base, a swarm agent, a check checkout, an inbox, a link into the set), and a new directory that contains rows takes their place in memory while their rows stay in the table; the load leaves out the rows that another row contains. A directory is recorded as spelled and as its real path at that moment. The session module records the directory of the hook inboxes (`<data>/session-events`) once. `isWithinAny` compares normalized absolute paths as text and computes the spellings of the directories of the set once per turn of the event loop (`directorySpellings`); the registry reads the profile once per turn. One `find('git')` plus one `path()` over a PATH of six entries, each lookup in a turn of its own, with sibling rows that none contains:

  | Rows | Existing, before | Existing, after | Missing, before | Missing, after |
  |---|---|---|---|---|
  | 10 | 2.6 ms | 0.5 ms | 5.0 ms | 0.7 ms |
  | 200 | 28.3 ms | 3.9 ms | 88.3 ms | 9.0 ms |
  | 1000 | 146.2 ms | 15.1 ms | 453.3 ms | 43.7 ms |

- **The `local` provider records nothing.** Its agent writes with the rights of the user whatever the Bash sandbox says (the Bash sandbox confines the Bash tool only), so a record protected nothing and a session in the home directory locked out every tool below it. The session module adds the working directories of the stored sessions only under `srt` or `container`. A program that a recorded directory holds is refused with the cause `… lies in a directory that an earlier agent launch made writable (such as the home directory)`; the status of the `srt` provider (for `srt` and `node`) and of the `local` provider (for the Claude CLI) names the directories and the `sqlite3` command that forgets them (`AgentWritableStore.forgetCommand`, the file from `databaseFile(db)`), and a check writes them to its log. No command in the app forgets a directory: it has to happen while no profile process holds the set, after the user looked at the directory, and a command would need a confirmation dialog and a restart of the profile process.
- **Persistence.** A write that fails keeps the directory in memory and in a set of unwritten directories, written again at a later lookup or launch at least 30 s later; a failed read at start is tried again the same way and its rows join the set; each kind of failure is reported once. The store creates its table with `CREATE TABLE IF NOT EXISTS` at every start and its constructor never throws.
- **Both shim directories.** `shimDirectories` gives the directory of the file as it is started and its real directory; `refuseBeside` checks a `node` in both, and a relative cmd-shim target is read against both. The review's probe (a configured `L/srt` linking to an old-form shim `S/srt`, `L/node` leading into an excluded directory, `L` not on the PATH) is a test.
- **The guard.** In a file whose entry allows a spawn of `command.file`: an untyped parameter that shadows the command (arrow, single parameter, method), a bracket assignment, the command under another name, `Object['assign']`. In any file: `Module._load`, `.binding(`, `._linkedBinding(`, `.execve(`, `process['binding']`, a `Worker` with `eval`, `node:vm`, `return HostTools`, `new` on a `.constructor`. 0040 keeps the claim that it stops accidental spellings.
- **The database read.** `buildSrtSettings` denies an `srt` session the read of the profile database and its journal files (`profileDatabase`, set by the profile process); a real-`srt` test shows the session still runs and writes its inbox, while the database, the WAL and the SHM file are unreadable and another file of the data directory is readable. The ninth account above says that no agent may read the database; that held for checks only.
- **`DYLD_` names.** `insideRoute(inside, platform)` drops them on macOS (the protected `/usr/bin/env` and `sandbox-exec` remove them), and the session service writes the dropped names of a session to the log of the app.

### Surface checked

The cost of a lookup as launches accumulate: rows below a recorded directory add nothing, so the set grows with the directories outside the task base only; each turn computes one real path per row and one settings read; `recordedHolding` reads the whole table, but only for a refused program. Where the registry could lose a directory or answer stale: a failed write (kept in memory, written again; lost only if the process ends before any write succeeds, stated in 0040 item 9), a failed read (retried), a dropped table (made again), a link changed after a record (the real path was recorded too), a row left out of memory (only when another row contains its text, which a later link cannot change), a change inside one turn (applies at the next turn, stated in 0040). Where a profile value could reach an argument again: the new texts (the forget command, the recorded directories, the dropped names) go to the provider status, the log of a check and the log of the app, never to an argument of a process; the database path goes into the settings file of `srt`.

### Changed files and functions

Source: `core/isolation/agentWritable.ts` (`AgentWritableMemory.forgetCommand`, `MEMORY_RETRY_MS`, `outermost`, `AgentWritableRegistry`: `add`, `directories`, `recordedHolding`, `readSource`, `insert`, `covers`, `sync`, `safeLoad`, `report`), `agentWritableStore.ts` (constructor, `forgetCommand`, the table made when missing), `hostLaunch.ts` (`spellings`, `realForms`, `contains`, `directorySpellings`, `isWithinAny`, `insideRoute`), `hostTools.ts` (`HostToolsOptions.recorded`, `RECORDED_CAUSE`, `shimDirectories`, `shimTargets`, `recordedFor`, `hidden`, `refusal`, `refuseHidden`, `refuseBeside`), `profileHostTools.ts`, `SrtProvider.ts` (`profileDatabase`, `NODE_INSTALL_FIX`, `check`, `refuseNode`, `hostStart`, the default tools), `srtSettings.ts` (`databaseFiles`, `buildSrtSettings`), `LocalProvider.ts` (no registry, `check`), `defaultProviders.ts` (`ProviderSetup.profileDatabase`), `core/session/PtySessionService.ts` (`launch`), `core/store/Store.ts` and `index.ts` (`databaseFile`), `main/modules/session.ts` (the inbox directory, the stored sessions under a confining provider, the database of the profile).

Tests: `agentWritable.test.ts`, `agentWritableLaunch.test.ts`, `hostLaunch.test.ts`, `hostTools.test.ts`, `hostToolsGuard.test.ts`, `SrtProvider.test.ts`, `srtSettings.test.ts`, `toolCommand.test.ts`, `isolationCommands.test.ts`, `session/PtySessionProvider.test.ts`, `main/modules/review.test.ts` (two tests follow the once-per-turn read and the confining-provider rule), `main/modules/sessionWritable.test.ts` (new).

Other: `scripts/mutation-checks.mjs` (entries of replaced code rewritten, entries for each decision added), 0040 section 6 items 2, 3, 4, 6, 7 and 9 and the risk row, 0041, 0042 (the ninth review row, the row of the passes as built, the open rows), `app/README.md`.

### Checks run

| Check | Result |
|---|---|
| `pnpm typecheck` | passes |
| `vitest run --coverage` with the real `srt` (`AGIDE_SRT_BIN`), `python3`, the Gradle test `resolves a dependency offline` left out with `-t` (it fails on the JDK of this host on the unchanged tree) | 284 files, 4004 tests pass, 2 expected failures, 17 skipped; `src/core` lines 97.37 (threshold 97), branches 87.00, statements 94.79, functions 95.57; `src/core/review` lines 98.58 |
| CI-like run (`/tmp/agide-check-clone-fix-10/nobin` with only a link `node`, PATH limited to it and the system directories, no `srt`, no Docker) | 283 files pass and 1 is skipped, 3852 tests pass, 169 skipped, 2 expected failures; `src/core` lines 97.38 (margin 0.38 points), branches 87.00, statements 94.78, functions 95.57; `src/core/review` lines 98.61 |
| `pnpm build` | passes |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |
| `pnpm parity` | ok, `docs/parity.md` unchanged |
| `pnpm check:colours` | no literal outside the allowlist |
| Real-tool tests under a job-control terminal (`script -q /dev/null bash -i -c '…'`, real `srt` 0.0.83): `statusLauncher.test.ts`, `toolCommand.test.ts`, `SrtProvider.test.ts`, `agentWritableLaunch.test.ts`, `ProcessCheckExecutor.srt.test.ts`, the Gradle test left out | 339 pass, 1 skipped |
| Mutation entries of the changed areas (filter `registry:`, `durable:`, `minimal:`, `tick:`, `persist:`, `local:`, `shim`, `real path:`, `reasons:`, `firmlink:`, `inside:`, `dyld:`, `db read:`, `spawn guard:`, `host tools:`, `wiring:`, `host launch:`, `coupling:`, `home claude:`, `host env:`) | first run 188 killed, 8 not killed: two entries were wrong (one equivalent mutation, one that broke the syntax), five showed tests that did not look (a relative path, a retry before the wait, a second report, the rows of the table that memory leaves out, the wiring of the cause in the profile tools), one showed a guard rule that missed `.binding(` behind a cast; after the fixes the 23 entries of those groups and the 43 `spawn guard:` entries were killed |
| Entries not rerun | every entry of other areas; the full `pnpm mutation` was not run. A dry check finds the text of all 721 entries exactly once; after the runs every mutated file equals a copy taken after the last rerun (`cmp`) |

### What took long

The first mutation subset (about 70 minutes for 196 entries). Two review-module tests read the settings or the stored sessions in the same turn, which the once-per-turn read and the `local` rule changed.

### What was not verified

Docker (no engine here). The independent review of the tenth pass is open.

### Leftovers

`/tmp/agide-check-clone-fix-10/` (the patch of the ninth pass, logs, the scratch measurement, a dry-check script, the snapshot of mutated files, the directory `nobin`) could not be removed by this pass: the permission system refused the removal, and it is left for the coordinator. The test suite leaves small `agents-tail-*` and `agide-cap-*` directories in the system temporary directory; the tests of this pass do not create them.
