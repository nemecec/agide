# Review of the eighth check-clone pass (review:check-clone-fix-8)

Start 2026-11-26 14:27 UTC, end 2026-11-26 14:52 UTC.

Independent review of the eighth pass on the confined project check: the registry of agent-writable directories (`AgentWritableRegistry`), the real-path rule for candidates and shim targets, the allow-list environment of the host-side `srt`, the widened spawn guard and the reasons without paths. The reference is the diff against 30115ac, `docs/measurements/check-clone-fix.md` and `docs/measurements/review-check-clone-fix-7.md`. No product code or test was changed. Scratch tests were written to `app/src/core/isolation/` for single runs and removed after each run; the mutation script restored every file it changed (compared with `cmp` against copies taken before the run).

## What ran

| Command | Result |
|---|---|
| CI-like coverage run (`env -u AGIDE_SRT_BIN`, PATH of a directory under `/tmp` that holds only a `node` link, then the system directories) | 282 files pass, 1 skipped; 3759 tests pass, 2 expected fail, 165 skipped; `src/core` lines 97.33 (threshold 97), `src/core/review` 98.54, `src/main` 85.45 |
| `vitest run src/core/isolation`, `checkEnvironment.test.ts`, `review.test.ts`, `src/core/tasks` with the real `srt` 0.0.83 | 27 files, 510 pass, 16 skipped |
| Launcher, tool command and real-`srt` check tests under `script -q /dev/null bash -i` (Gradle offline test left out, as in the pass) | 268 pass, 1 skipped |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |
| `node scripts/mutation-checks.mjs` for `real path:`, `host env:`, `reasons:`, the stored-session and registry-read entries of `registry:` and the native real path of `host launch:` | 30 killed, 0 survived, 0 skipped |
| Scratch probes over the real code paths (stand-ins planted in a session workspace, an `extraWritePaths` entry and next to a shim; the real `srt` for the argv probe) and direct calls of the exported guard `violations` with new spellings | see the findings of the review |

## Account

Most time went into tracing where a directory becomes writable and whether the registry keeps knowing it after the session, the setting or the process that made it writable ends. The full `pnpm mutation`, Docker (no engine here) and a second profile process were not run.
