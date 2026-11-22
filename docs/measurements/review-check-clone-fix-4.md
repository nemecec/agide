# Review of the fourth check-clone pass

Start: 2026-11-22 22:44 UTC. End: 2026-11-22 23:21 UTC.

Independent review of the uncommitted fourth pass on the confined project check (diff against the checkpoint commit, `docs/measurements/check-clone-fix.md`). No product code or tests were changed. Scratch tests ran from a temporary directory with their own vitest configuration against the real `srt` 0.0.83.

## What was run

| Run | Result |
|---|---|
| Process tree of a check under real `srt` | `srt` (Node) is the parent of the launcher shell; the outer `sh -c`, `env`, `sandbox-exec` and `bash -c` all `exec`, so the launcher's parent is `srt`, outside the sandbox |
| Signals from the program to the launcher shell (HUP, INT, QUIT, ILL, TRAP, EMT, FPE, KILL, BUS, SEGV, SYS, PIPE, ALRM, TERM, XCPU, XFSZ, VTALRM, PROF, USR1, USR2), then `exit 1` | `failed` for every signal except SIGEMT, which reads `passed` with exit 0 |
| SIGEMT to the process group, then `exit 1` | `passed`, exit 0 |
| The same with `EMT` added to the launcher's trap (scratch wrapper around the tool command) | `failed`, exit 135 or 1 |
| The plain (unconfined) check path with `kill -EMT $$` | `passed`, exit 0 |
| Node `child_process` for each signal 1 to 31 | a death by SIGEMT is reported as exit code 0 and signal null |
| Signals to `srt` and to the app (`$AGIDE_CHECK_OWNER`) | refused; `not_run` with the sandbox reason |
| A burst of TERM, INT or HUP at the launcher while the program exits 7 | `failed`, exit 7 in each run |
| `exit 256` (sh and node) | `passed`, exit 0 (kernel truncation) |
| SIGSTOP to the launcher | `timed_out`; SIGTSTP is ignored by the launcher |
| Program that traps TERM and exits 0, stopped by the timeout or the cancel | `timed_out`, `not_run` |
| `trap "kill 0" EXIT` in bash, exit 0 | `failed` 143 under `srt`; plain bash outside `srt` also ends by SIGTERM |
| npm project plus an added `tools/build.gradle` | loopback connect to a host server reached, `passed` |
| Clone of a cache with an unreadable directory whose name is a message | the name is in the `notRunReason` (`the cache clone failed: EACCES ... scandir '<path>'`) |
| A red base whose alert ended because its last changeset was rejected, then a new changeset on it | no alert; the changeset is at rung C |
| CI-like coverage (node only on PATH, no `srt`) | 275 files pass, 1 skipped; src/core lines 97.18 (threshold 97), src/core/review lines 98.38 (threshold 98) |
| `ProcessSweep.test.ts` 30 times under 12 `yes` processes on 8 cores with the real-`srt` suite running in parallel | 30 of 30 pass; the real-`srt` suite passed in each of its three runs |
| Mutation entries of the pass (filtered run) | 35 killed, 0 survived; every mutated file compared equal to its copy afterwards |

## What took long

The filtered mutation run (about 13 minutes) and the three runs of the real-`srt` suite under load.

## Not done

Linux, Docker and the Electron end-to-end tests were not run. The removal of the scratch directory `/tmp/agide-review-check-clone-fix-4/` was denied by the permission system and is left for the coordinator; no helper processes were left running.
