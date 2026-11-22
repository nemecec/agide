# review:check-clone-fix-3: third review of the confined project check

Start: 2026-11-22 19:25 UTC (`date -u`). End: 2026-11-22 19:46 UTC.

An independent review of the third pass of the check-clone change (uncommitted in the working tree). No product code or test was changed. Scratch test files and scratch mutations were used; every mutated file was copied first, restored and compared with `cmp`, and `src` was compared with a copy taken before the mutations (`diff -r`: identical). The scratch test files were removed.

## What was done

| Step | Result |
|---|---|
| CI-like `vitest run --coverage` (`PATH` of a directory with one `node` link and the system directories) | 275 files pass, 1 skipped; 3373 tests pass, 45 skipped, 2 expected failures; `src/core` lines 97.18 (threshold 97, margin 0.18 points), statements 94.52 (94), branches 86.52 (85); `src/core/review` lines 98.37 (98) |
| `src/core/review`, `src/core/isolation`, `src/main` with the real `srt` 0.0.83 | 1392 of 1393 pass; the real-process test "ends the process of an app that is gone" in `ProcessSweep.test.ts` failed once more under load and passed alone three times |
| Scratch mutations of the base rule, the store, the reviewer block, the sweep branches, `lsof -a`, the time limit, the environment patterns and names, the Claude directory and the nested volume | all killed |
| Scratch tests under the real `srt` | a check that sends SIGTERM or SIGINT to its own process group, or to itself, and would exit 1 reads as `passed` (`srt` exits 0 when its child ends by SIGINT or SIGTERM); one sandbox cannot signal a process of another sandbox or of the app; a check under `network: none` can connect to a loopback TCP server of the host; Unix sockets and writes outside the run are refused; a real APFS image mounted below a cache root is refused |
| Scratch test of the inbox | two agents of one swarm on different bases: the red base posts its alert again on every event after the green base of the other agent resolves it |
| `pnpm typecheck` after the scratch files were removed | passes |

## What took long

Finding why a SIGTERM made a failing check pass: the cause is in the exit handling of the `srt` command line.

## Leftovers

Temporary files are under `/tmp/agide-review-check-clone-fix-3/` (a copy of `src`, logs, the coverage output, the mutation helper); its removal was denied by the permission system and it is left for the coordinator. Free disk went from 8.0 GiB to 7.4 GiB during the review (the earlier agents' directories in the system temporary directory were not touched).
