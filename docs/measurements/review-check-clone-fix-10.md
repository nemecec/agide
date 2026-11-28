# Review of the tenth check-clone pass (review:check-clone-fix-10)

Start: 2026-11-27 23:10 UTC (`date -u`). End: 2026-11-27 23:35 UTC as `date -u` printed it; the mutation subset, the CI-like run and e2e ran in between, so the wall time was longer than the two readings suggest.

Independent review of the eighth, ninth and tenth passes in the working tree (the whole diff against HEAD). No product code or test was changed. Scratch probe tests were placed in the tree for single runs and removed afterwards; the diff of the tree was compared with a copy taken before the mutation run and after all runs (`cmp`, identical).

## What was checked

- The area tests of `src/core/isolation`, the session module test and the session provider test, with the real `srt` 0.0.83: all pass.
- Mutation entries `minimal:`, `tick:`, `persist:`, `local: the`, `db read:`, `dyld:`: 34 killed, none survived.
- The cost of one `find('git')` plus one `path()` (each lookup in its own turn), sibling rows: existing 0.62 / 3.32 / 15.17 ms and missing 0.84 / 8.41 / 44.94 ms at 10 / 200 / 1000 rows; a realistic mix (1000 launches below the task base with their inboxes, 30 sessions outside it) 1.83 ms with 39 rows in memory. The claim of the pass holds.
- Staleness with the real `srt` and planted `git`, `gh`, `docker`, `srt`, `node`: a row replaced by a link after the first lookup, and a program planted before its directory became a row, are both refused at the next turn; the failing check reads as failed and no stand-in ran.
- The database read with the real `srt`: direct read, a hard link into the workspace and a symbolic link are all refused.
- Process arguments: during a real `srt` session with derived values holding quotes, `$`, backticks, a newline, a leading dash and `=`, no value appeared in `ps -axww` over repeated samples, none was in the built arguments, and every value arrived unchanged.
- The spawn guard against new spellings (results in the review report).
- CI-like coverage run (PATH: a directory under `/tmp` holding only a `node` link, and the system directories): 283 files pass, 1 skipped; 3852 tests pass, 2 expected failures, 169 skipped; `src/core` lines 97.39 (threshold 97), `src/core/review` lines 98.61.
- Launcher and real-`srt` tests under a job-control terminal: 339 pass, 1 skipped.
- `AGIDE_HIDDEN=1 pnpm e2e`: 86 pass. `pnpm typecheck`: passes.

## Main results

- A session of the `local` provider outside the task base is no longer recorded, so with the Bash sandbox on (the check then runs under `srt`) a `srt` that the agent wrote into its workspace, on an absolute entry of the app PATH, starts unconfined and a failing check reads status 0.
- The session module records the working directories of all stored sessions when the profile now uses `srt` or `container`, also those that ran under `local`, so a profile with a session in the home directory is locked out of `srt` after the switch, and the documented `sqlite3` command does not help: the next start records the directory again.
- Smaller: a failed first read of the table trusts the earlier rows until a retry; an `srt` session that never starts still records its directory; the guard misses several spellings, among them the object literal `{ T: HostTools }` that the ninth review named.

## What took long

The mutation subset (about 25 minutes for 34 entries), during which no other test could run.

## Not checked

Docker (no engine). The full `pnpm mutation`. Other profiles' databases under a session of one profile were judged from the code only.

## Leftovers

`/tmp/agide-check-clone-fix-10/review/` (scratch probe tests, the diff copy, the mutation, CI and e2e logs) could not be removed: the permission system refused the removal, and it is left for the coordinator. The rest of `/tmp/agide-check-clone-fix-10/` (`nobin` and the files of the fix pass) was not created by this review and is left for the coordinator.
