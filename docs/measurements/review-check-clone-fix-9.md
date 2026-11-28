# Review of the eighth and ninth passes of the check-clone change

Start: 2026-11-26 21:38 UTC. End: 2026-11-26 22:34 UTC.

An independent review of the uncommitted eighth and ninth passes (the registry of agent-writable directories in the profile database, the route of the profile variables through `AGIDE_INSIDE_<NAME>` carriers, the node beside the shim, the spawn guard, the firmlink spelling, the reasons by error code). No product code or test was changed. Scratch probes ran from a temporary directory with a vitest configuration of their own and were removed.

## What was run

| Command | Result |
| --- | --- |
| vitest over `src/core/isolation`, `src/core/review/capture` and `review.test.ts` with the real srt | passed, except the known Gradle test |
| CI-like `vitest run --coverage` with an empty environment and a PATH of a `node` link below `/tmp` and the system directories | passed; `src/core` lines 97.36 against 97, statements 94.73 against 94; `src/core/review` lines 98.61 against 98 |
| launcher, tool command, SrtProvider, registry launch and srt executor tests under `script` and `bash -i`, real srt | passed |
| `mutation-checks.mjs` with the entries `inside:`, `durable:`, `shim node:`, `home claude:`, `firmlink:`, `reasons:`, `coupling:`, `spawn guard:` | all killed |
| own scratch mutations (copied and restored, compared with `cmp`) | see below |
| `AGIDE_HIDDEN=1 pnpm e2e` | all passed |
| `pnpm typecheck` | passed |

Own mutations: removing the registry additions of the local provider, the container provider, the session module, `SrtProvider.prepare` and `toolCommand`, removing `unset PATH` from the launcher and carrying `SHELLOPTS` were all caught. Stripping the data-volume prefix only from the spelling as given (not from the resolved one) survived: no test has a link whose target is spelled through `/System/Volumes/Data`. The code handles that case (probe).

## Probes with the real srt

- Values: a session and a check with derived values in `GH_TOKEN`, `NPM_TOKEN`, `AWS_SECRET_ACCESS_KEY` and an arbitrary name, and with quotes, `$(...)`, backticks, line breaks, a leading dash, an empty value and a value of 200 000 characters. `ps -axww -o pid=,args=` read every 50 ms while both ran never showed a value. A Node program inside received every value unchanged, no carrier was left, and the names that are not shell identifiers, the names of the route and `SHELLOPTS` were listed in `dropped`.
- Host side: `BASH_ENV`, `ENV`, `PS4`, `SHELLOPTS`, `CDPATH`, `IFS`, `NODE_OPTIONS`, `NODE_PATH`, `DYLD_INSERT_LIBRARIES`, `LD_PRELOAD` and exported functions in the profile environment ran nothing outside the sandbox (marker directory that only a host-side process could write stayed empty). `DYLD_*` does not reach the program inside and is not listed in `dropped`: the protected `/usr/bin/env` drops it.
- Registry: a registry over a database file, closed and opened again in a new process with another Claude directory, another task base and no `extraWritePaths`, still excluded the earlier workspace, entry, task base and Claude directory.
- Gaps: a dropped table makes the store throw at start; a write that fails (a locked database) keeps the directory in memory and never records it; a session whose working directory is the home directory excludes every tool below it for the life of the database; an older pnpm shim form reached through a link runs the `node` beside the link; a sandboxed session can read the profile database.
- Cost: one `find` and one `path` take about 3 ms with 10 rows, 36 ms with 200 rows and 196 ms with 1000 rows of existing directories (longer for missing ones), on the thread that calls them.

## What took long

The mutation entries and the real-srt tests. Free disk fell from 4.3 GiB to 3.6 GiB during the run, mostly from other work on the machine; it stayed above the floor.

## Not done

The full mutation run, Docker with an engine, real Claude.
