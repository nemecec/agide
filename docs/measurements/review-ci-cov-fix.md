# Review of the coverage fix for CI without Docker or srt

Start: 2026-11-22 01:02:50 UTC. End: 2026-11-22 01:08 UTC.

Verdict: accept.

## Coverage

CI-like environment: `PATH` holds only a symlink to `node`, `/usr/bin`, `/bin`, `/usr/sbin` and `/sbin`. `docker`, `srt` and `claude` are not found on it.

| Run | Lines in `src/core/**` | `ContainerProvider.ts` | `callerView.ts` | Result |
| --- | --- | --- | --- | --- |
| CI-like | 97.095% (11700 of 12050) | 100% | 100% | all test files pass, no `ERROR: Coverage` line, no timeout |
| `pnpm coverage` with Docker and srt | 97.095% (11700 of 12050) | 100% | 100% | all tests pass, no `ERROR: Coverage` line |

The threshold needs 11689 covered lines, so the CI-like run is 11 lines above it. The note of the fix reports 11701 covered lines and a margin of 12; the difference is one line between runs.

The log of the failed CI job shows `callerView.ts` line 18 and the `ContainerProvider.ts` lines that the new tests cover as uncovered there. 96.97% of 12050 is 11685 lines, 4 below the threshold. With the lines the new tests add, CI is expected at about 11697 lines (97.07%), about 8 lines above the threshold.

`pnpm typecheck` and `pnpm check:colours` pass.

## Scope

`git diff HEAD` changes only the two test files; the only removed lines are two import lines that the new imports replace. `vitest.config.ts` and the product files are unchanged. No test was removed, skipped or loosened.

## Independence from the host

The fake docker is a `/bin/sh` script in the temporary directory of the test, called by absolute path; it needs no Docker, srt, claude, network, home directory or uid. The `afterEach` hook removes it with the directory. The `process.kill` spy is installed before `prepare` and restored in `finally` after `terminate` resolves, so a throw before or during the test cannot send a real signal. The client pid 2147000000 is above the pid range of macOS and Linux; a real `kill` of it returns ESRCH, which `signalProcess` ignores. No process or temporary directory was left after the runs.

## Mutation checks

On the CI-like `PATH`, each mutation of `ContainerProvider.ts` or `callerView.ts` was run against its test file and the file restored; `cmp` and `shasum` show both files as before. Every mutation failed at least one test:

- `check()`: ready returns not ok, a missing image reported ok, `pull` in place of `image inspect`, `image inspect` without the image name, the fix text without "never pulls", the engine failure falls through to the image.
- `removeOrphans()`: no owner guard, label filter without the owner, a name filter, `rm` without `-f`, `rm` of the first id only, `rm` for an empty list, a docker failure rethrown.
- `terminate()`: no `docker kill`, `docker kill` not awaited, `docker kill` of the session id in place of the container name, a failing `docker kill` propagates, `docker kill` for SIGTERM, always SIGTERM, no signal, a signal without an attached client, the signal before `docker kill`.
- Tool files mounted writable or left out.
- `evidenceFor`: plain values dropped, turned into strings or null dropped, list items not visited or turned into strings, record values not visited, the wrong source tag.

## Findings

- Minor: the note says the failed CI job was "about 3 lines below the threshold". 96.97% of 12050 lines is 11685, which is 4 below 11689. The margin of 12 lines is from this machine; CI covers fewer lines, so the expected margin there is about 8.
- Minor: the tests need an executable temporary directory. On a Linux runner with `/tmp` mounted `noexec`, `check()` would report Docker as not installed and the fake docker tests would fail. GitHub-hosted runners do not mount it so.

## Not checked

A run on the GitHub Actions macOS runner.
