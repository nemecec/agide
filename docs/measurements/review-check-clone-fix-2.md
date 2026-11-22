# Review of the second check-clone pass

Start: 2026-11-22 16:46:08 UTC (`date -u`). End: 2026-11-22 17:08:34 UTC.

An independent review of the second pass on the confined project check (`docs/measurements/check-clone-fix.md`, second-pass section). No product code or test was changed. Scratch tests ran from a temporary vitest root outside the repository that imports the app sources; scratch mutations copied the file first and were compared with `cmp` after the restore.

## What was attacked, under the real `srt` 0.0.83

| Attack | Result |
|---|---|
| Daemon (`setsid`, double fork) that keeps the marker and binds a loopback port | Ended; no base comparison |
| Same, ignores SIGTERM and renames its `argv[0]` | Ended (SIGKILL; the marker is in the exec-time environment) |
| Same, deletes `AGIDE_CHECK_RUN` from `os.environ` without an exec | Ended (`ps -E` shows the exec-time environment) |
| Daemon that execs with an empty environment and changes directory to `/` | Survives; base fails with `Address already in use`; result `failed` / `failed` (`check.failed_on_base`) |
| Daemon that execs `/usr/bin/nc -l` (environment hidden by `ps`) and changes directory to `/` | Survives; same result; no environment change needed |
| Daemon with a forged marker (another run id, `AGIDE_CHECK_OWNER=1`), directory `/` | Survives; same result |
| Same forged marker, working directory left in the checkout | Survives; the marker entry replaces the working-directory attribution |
| `sandbox_check(pid, "file-read-data", path)` from outside, on the escaped survivors, with a path only the check denies | Returns 1 for the survivors and 0 for ordinary processes: a per-run attribution that the process cannot remove |
| `launchctl submit` and `open -a` from inside the check | Both fail under `srt` |
| Startup sweep after a killed app (real processes) | Ends a directory-only process and a process whose owner is gone; a forged owner that is alive stays |
| Cache root with a volume mounted inside it | Passes the volume probe; `cp -cR` copies the nested volume |
| Cargo with a crate missing from the cache on both commits, network `none` | `failed` / `failed` (`check.failed_on_base`); the `srt` proxy answer (`CONNECT tunnel failed, response 403`) matches no pattern |

## Checks run

| Check | Result |
|---|---|
| CI-like `vitest run --coverage` (PATH with only `node`) | 275 files pass, 1 skipped; 3297 tests pass, 44 skipped, 2 expected failures; `src/core` lines 97.175 against 97; `src/core/review` lines 98.413 against 98 |
| `src/core/review`, `src/core/isolation`, review module test with `srt` found | 51 files, 1042 tests pass |
| `ProcessCheckExecutor.srt.test.ts` alone | 13 pass, none skipped |
| `mutation-checks.mjs` for the sweep, leftovers and base reuse entries | 27 killed, 0 survived; tree unchanged afterwards |
| Scratch mutations: no stale end for this app's own earlier runs; no stale end for directory-only processes | Both survive the unit tests |

## What took long and what was not done

Finding a working way to call `sandbox_check` from outside took a few attempts: Python `ctypes` gives wrong answers for the variadic call on arm64, a small C program works. Not checked: Linux, other `srt` versions, Gradle and Maven under a missing JDK end to end, the e2e suite, the full mutation run.
