# Review of the eleventh check-clone pass

Start: 2026-11-28 10:37 UTC (`date -u`). End: 2026-11-28 11:19 UTC.

An independent review of the eleventh and last pass of the confined-check hardening (the diff against `bff24b9`). No product code or test was changed. Scratch probes ran in a test file that was removed afterwards; mutations were applied to copies and every file was restored and compared with `cmp`, and the changed files matched their checksums from before the runs (`shasum -c`).

## Verdict

Accept with fixes. The majors and the minors of the tenth review are closed: a `local` launch under the Bash sandbox is recorded, the stored sessions are no longer added at every start, a refused launch leaves no row, the unread table fails closed, the guard flags the named spellings, the databases of every profile are denied, the forget command survives an interactive zsh and bash, and the dropped names of stream agents are logged. The remaining findings are minor.

## Findings

| Severity | Where | Finding |
|---|---|---|
| minor | `agentWritable.ts`, the providers | A launch whose row cannot be written (a locked or full disk) still goes ahead; after a quit the row is lost, and the start-time add of stored sessions no longer covers it. Probe: memory whose `record` throws, an `srt` launch outside the task base, a restart over the same database: `find('srt')` returns the planted file of the workspace. 0040 item 9 does not list it. |
| minor | `hostTools.ts`, `LocalProvider.ts` | While the table cannot be read, every provider is unusable when the CLI lies outside the fixed directories (`~/.local/bin/claude`), also the default `local` profile without the Bash sandbox. The fix text promises a retry; a damaged table or a table of another shape never becomes readable, and no way out is named. |
| minor | `session.ts`, `agentWritableStore.ts` | The one-time add is triggered by the table being made. A database of the build `bff24b9` has the table, and that build did not record `local` launches under the Bash sandbox, so those sessions are never added; the add also skips `local` with the Bash sandbox on. |
| minor | `SrtProvider.ts`, `ContainerProvider.ts` tests | The refusal lists are tested for `srt` (srt) and `docker` (container) only: removing `git`, `gh`, `node`, the CLI or the configured programs from the `srt` list, and the configured programs from the container list, leaves every test green. |
| minor | `hostToolsGuard.test.ts` | Still missed: a computed member built from parts (`iso['Host' + 'Tools']`), `Object.values(iso)`, `Reflect.construct(Reflect.get(proto, 'const' + 'ructor'))`, a destructuring or `for…of` assignment target through a cast on `command`, `Reflect.get(globalThis.process, …)`, an alias of `process` with a computed member, `globalThis['process']`, a `Worker` from a blob URL, `node:inspector` and `node:wasi`. |
| minor (pre-existing) | `srtSettings.ts` | An `srt` session of one profile reads the `tools` directory (gh hosts, AWS credentials, npmrc), the Claude directory and `settings.json` of another profile (real `srt` 0.0.83). Only the databases are denied. |

## Measurements

| Check | Result |
|---|---|
| Tests of the changed areas with real `srt` | 31 files pass; 1 failure, the Gradle test `resolves a dependency offline`, which fails on this JDK on the unchanged tree |
| CI-like coverage run (`/tmp/agide-check-clone-fix-11/nobin` with only a `node` link, system directories) | 283 files pass, 1 skipped; 3895 tests pass, 169 skipped, 2 expected failures; `src/core` lines 97.37 (threshold 97), `src/core/review` lines 98.58 (threshold 98) |
| Launcher and real-`srt` tests under `script -q /dev/null bash -i` | 7 files, 386 pass, 1 skipped |
| `pnpm typecheck`, `pnpm build`, `pnpm check:colours`, `pnpm parity` | pass; `docs/parity.md` unchanged |
| Mutation entries of the changed areas (the filter of the fix report) | 138 killed, none survived |
| Reviewer mutations | the launch directories left out of `hostStart` and a `local` record before the refusal are caught; the `srt` list without `git`, `gh`, `node`, the CLI or the configured programs, the container list without the configured programs, `tableExists` counting an error as missing and a missing `bashSandbox` counting as on survive; the `local` list without the CLI survives but is equivalent (`require` refuses the launch before it is recorded) |
| Lookup cost (100 calls each) | 10 rows: `find` 0.05 ms, `refuseHolding` 0.5 ms; 200 rows: 0.22 ms, 1.6 ms; 1000 rows: 0.86 ms, 6.5 ms |
| Values in process arguments | a derived value in the profile environment of a real `srt` session reached the program and never appeared in `ps -axww -o args=` read every 50 ms |
| Real `srt`, another profile's database | direct read, hard link, symbolic link, copy and paths with `.` and `..` refused |
| Forget command in `/bin/sh` | names with a newline, a leading `-`, a quote with SQL, backslashes and `%` forget exactly the named rows |

## Not run

`AGIDE_HIDDEN=1 pnpm e2e`: free disk was 3.0 GiB after the build, at the floor the task sets. Docker: no engine on this host. The full `pnpm mutation`.

## What took long

The mutation runs (about 25 minutes together), during which no other test could run, and the job-control run with real `srt`.
