# Review of the fifth check-clone pass (review:check-clone-fix-5)

Start 2026-11-23 02:35 UTC, end 2026-11-23 03:05 UTC. An independent review of the fifth pass: the SIGEMT blocker and the four minors of the fourth review. No product code or tests were changed. Scratch tests were added to `app/src/core/review/capture/` and removed after each run. One manual mutation of `app/src/core/isolation/statusLauncher.ts` was copied first and restored, and `cmp` confirmed the restored file.

## What was checked

- The launcher was run directly, under the real `srt` 0.0.83, under `/bin/sh` (bash 3.2), dash, zsh in sh mode and ksh. Cases: signals to the program itself, its group and its parent, a burst of every signal from a background process, a Node `process.kill` call, `exec` into a program that ends by EMT, stopping signals, `exit 256`, `exit -1`, a failing fork at the process limit, a timeout and a cancel through the real executor.
- Signals between two `srt` sandboxes: refused with `Operation not permitted`. A survivor of one run cannot signal the launcher of a later run.
- The mutation entries for alert, loopback and clones (32 entries): all killed. Manual mutation (the launcher without EMT), with only the executor and environment tests: 4 tests fail.
- CI-like coverage run (a node symlink only, a system `PATH`, no `srt`): exit 0. 276 files pass and 1 is skipped. `src/core` lines 97.19 against 97, and `src/core/review` lines 98.41 against 98.

## Findings

- Major, present before this pass: a relative or empty entry in the profile `PATH` lets a file in the checkpoint run outside the sandbox in place of `srt`, or in place of the `node` that runs `srt`. The check then reads `passed`.
- Minor: a shell builtin as the first word of the policy command (`.`, `source`, `eval`, `exec`) runs inside the launcher, and code of the checkpoint can then end the launcher by EMT.
- Minor: the signal table sorts TSTP, TTIN and TTOU by the process group of the test runner. In a terminal with job control they count as signals that stop the process, so the launcher tests fail for them.
- Nit: the reason for a refused clone still names the resolved path of the cache.
- Nit: any word `gradle` in the policy command turns on loopback.

## What took long

The mutation subset matched 32 entries because the filter `alert:` also matches entries for other alerts. It took about 25 minutes.

## Leftovers

The removal of `/tmp/agide-review-check-clone-fix-5/` was denied and was not retried. The coordinator removes it. It holds probe scripts, logs, the srt settings files of the probes, a fake checkout with two executable shell stubs, a node symlink directory and a launcher backup. None of these files holds a secret. The scratch tests in the tree were removed, and none is left.
