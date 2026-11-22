# Coverage of the container provider and the changeset view without Docker or srt

Start: 2026-11-22 00:30:54 UTC. End: 2026-11-22 01:01:32 UTC.

## Symptom

`pnpm coverage` failed in CI on commit 3c1b5c0:

```
ERROR: Coverage for lines (96.97%) does not meet "src/core/**" threshold (97%)
```

The macOS runner has neither Docker nor the sandbox runtime `srt`, so the tests gated on them skip. On a machine with both, the same suite reaches 97% or more.

## Cause

A line diff of the two coverage runs lists the lines that only the machine with Docker or srt covers:

- `ContainerProvider.ts`: `check()` after the docker binary is found (engine not running, image not local, ready), the listing and removal in `removeOrphans()`, and `terminate()` with SIGKILL (`docker kill`, then the signal to the client). The tests of these paths are in the block gated by `containerTestsUnavailable()`.
- `callerView.ts` line 18: `evidenceFor` returns a plain value (string, number, boolean, null) of reason evidence unchanged. The test file of the view has no evidence with a plain value, so the line is reached only through flows of other test files that start git.

The existing test of the view already covers the `repo.ref_moved` branch of `evidenceFor` (line 14), so that branch needed no new test. `ContainerProvider.ts` line 157, the read-only mount of the profile's tool files, was uncovered on every machine.

## Change

- `ContainerProvider.test.ts`: a `fakeDocker` helper writes a `#!/bin/sh` script into the temporary directory of the test. It appends its arguments to a log file, exits 1 for the subcommands the test names, and prints the given container ids for `ps`. Tests call it through `dockerBinary`:
  - `check()` is ready when `version` and `image inspect` succeed; reports a missing image and does not pull when `image inspect` fails; does not ask for the image when `version` fails.
  - `removeOrphans()` lists by the owner label and removes the listed containers with one `rm -f`; removes nothing for an empty list; makes no docker call without an owner; resolves when `ps` fails.
  - `terminate()` records the signals with a spy on `process.kill` instead of sending them. The client pid is above the process id range of any host, so a signal that got past the spy would find no process. Each recorded signal carries the docker calls that were logged before it. SIGTERM makes no docker call; SIGKILL runs `docker kill` of the container name first; a failing `docker kill` still signals the client; a SIGKILL without an attached client runs `docker kill` and signals nothing.
  - A profile tool file is mounted read-only and its path is not created as a directory.
- `callerView.test.ts`: reason evidence with strings, a number, a boolean and null passes through unchanged, and agent text in nested records and in lists is wrapped in tagged blocks. `evidenceFor` is not exported; `detailForCaller` reaches it, so the product code is unchanged.

No product file, threshold or existing test changed. The tests of the real Docker flow stay in place and still skip where Docker is missing.

## Measurements

CI-like environment: `PATH` holds only a symlink to `node`, `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`, so `docker`, `srt` and `claude` are not found.

```
env PATH=<dir with the node symlink>:/usr/bin:/bin:/usr/sbin:/sbin node node_modules/vitest/vitest.mjs run --coverage
```

| Run | Lines in `src/core/**` | `ContainerProvider.ts` lines | `callerView.ts` lines | Result |
| --- | --- | --- | --- | --- |
| Before, committed tree | 97.00% (11689 of 12050) | 81.03% (47 of 58) | 100% (28 of 28) | 5 git-heavy tests timed out; the machine was short of memory. The coverage report is written despite the failures, so the figure is a little low. |
| After | 97.10% (11701 of 12050) | 100% (58 of 58) | 100% (28 of 28) | 268 files passed, no `ERROR: Coverage` line |

In the before run, `callerView.ts` is fully covered by the full suite. The same file alone with its own tests leaves line 18 uncovered, which the new test closes.

The margin on the machine of the run is 12 lines: 97% of 12050 lines is 11688.5, and the run covers 11701. The failed CI job measured 96.97%, which is 4 lines below the threshold. The added tests cover 12 lines that CI did not cover, so the expected margin on CI is about 8 lines; the independent review measured 11 lines on this machine (11700 covered) and estimated about 8 on CI.

`pnpm typecheck`, `pnpm coverage` (Docker and srt present, 97.10% of the lines in `src/core/**`) and `pnpm check:colours` pass.

## Mutation checks

Each check copies the product file, breaks one branch, runs the test file and restores the file; `cmp` shows the restored file identical to the copy. Every mutation fails the test named.

| Broken branch | Failing test |
| --- | --- |
| `check()` reports ok for a missing image | the missing image test |
| `check()` returns not ready at the end | the ready test |
| `check()` pulls instead of inspecting | the ready and the missing image tests |
| `check()` goes on to the image after a failed `version` | the engine tests (old and new) |
| `removeOrphans()` without the owner guard | the no-owner test |
| `removeOrphans()` calls `rm` for an empty list | the empty list test |
| `rm` without `-f` | the removal test |
| `ps` filter on another label | the three listing tests |
| `removeOrphans()` rethrows a docker failure | the failing `ps` test |
| `terminate()` without `docker kill` | the three SIGKILL tests |
| `docker kill` after the signal | the ordering test |
| a failing `docker kill` propagates | the failing `docker kill` test |
| `docker kill` for every signal | the SIGTERM test |
| signal sent without an attached client | the no-client test |
| the client never signalled | the SIGTERM test and both SIGKILL tests with a client |
| tool files mounted writable | the tool file test |
| `evidenceFor` returns nothing for a plain value | the plain value test |
| `evidenceFor` does not visit list items | the plain value test |
| `evidenceFor` does not visit record values | the plain value test and the existing evidence test |
| `repo.ref_moved` keeps its evidence | the existing evidence test |

## Not verified

- A run on a real macOS runner of GitHub Actions. The CI-like run uses this machine's git and shell.
- Linux. The fake docker script needs `/bin/sh`, which every supported host has.
- A host whose temporary directory is mounted `noexec`: the fake docker script could not run there, and `check()` would report that Docker is not installed. GitHub-hosted runners do not mount it that way.
