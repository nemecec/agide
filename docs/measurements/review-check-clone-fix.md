# review:check-clone-fix: independent review of the per-run cache clones of the confined check

Start: 2026-11-22 13:57:57 UTC (`date -u`). End: 2026-11-22 14:16 UTC.

## What was done

- Read the change (`git diff`, the new files in `app/src/core/review/capture/`), 0040 section 6, 0041, 0042 and `docs/measurements/check-clone-fix.md`.
- Ran the capture, `srtSettings` and review module suites with a real `srt` 0.0.83: all pass, the real-`srt` tests included.
- Ran scratch attack tests under the real `srt` (removed afterwards; no product file or test was changed):
  - A run that writes an `.npmrc` with `script-shell` into its clone, a `cargo` shim into the `CARGO_HOME` clone, a changed file in the cargo registry clone, a write through a hard link that the real tree holds, a symbolic link to the real cache, a hard link from the real cache, a link in the checkout and a rename out of the real cache: the writes into the clone succeed, every write that reaches a real directory is refused, the real tree listing (names, sizes, times, link counts) is unchanged, the base run and a second run see the pristine caches, and no clone is left.
  - `cargo` and `rustc` through `rustup`, `node` from nvm and a JDK are found under confinement with the real home.
  - A process that the checkpoint run detaches with `setsid` survives the run and holds a loopback port; the base run then fails with `Address already in use`, so a real failure reads as `check.failed_on_base`.
  - With `PATH` without a JDK, the macOS `java` stub fails on both commits and reads as `failed_on_base`.
  - A cache on the sealed system volume passes the device check (its `st_dev` equals the data volume's while `statvfs` `f_fsid` differs; `clonefile` returns `EXDEV`), so `cp -c` copies it.
  - A timeout, a cancel and a fresh instance's sweep leave no clone; the data directory is unreadable in both spellings; the environment of the app does not reach the check.
- Ran 22 extra hand mutations of the clone, tool table, deny list, environment and pattern code (each file copied first, restored and compared with `cmp`): all killed. Ran the D8 entries of `scripts/mutation-checks.mjs`: 9 killed, 0 survived.
- CI-like coverage run (a directory with a `node` link only on `PATH`): 273 files pass, 1 skipped; `src/core` lines 97.15 (threshold 97, margin 0.15), branches 86.41; `src/core/review` lines 98.32.

## Not finished

- The removal of the temporary directory `/tmp/agide-review-check-clone-fix` was denied by the permission system; it is listed for the coordinator.
- No real kill of the app during a check; no `container`, Go, Yarn, `mvnw` or `check.network: development` run.
