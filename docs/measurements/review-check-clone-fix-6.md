# review:check-clone-fix-6: independent review of the sixth pass on the confined project check

Start: 2026-11-23T11:13:16Z. End: 2026-11-23T11:45Z.

## Scope

The uncommitted diff against f16a837 (`hostLaunch.ts`, the `SrtProvider` launch paths, the launcher through `/usr/bin/env`, the clone refusal texts, the loopback programs) and the sixth-pass section of `check-clone-fix.md`. Product code and tests were not changed.

## Runs

| Command | Result |
| --- | --- |
| `AGIDE_SRT_BIN=<srt 0.0.83> vitest run src/core/isolation src/core/review/capture` | all pass, real-srt rows included |
| launcher tests and the real-srt STOP, TSTP, TTIN, TTOU and builtin rows under `script -q /dev/null bash -i -c ...` | all pass |
| CI-like coverage (PATH: a directory with a link named `node`, then the system directories) | all pass; `src/core` lines 97.18 (threshold 97), `src/core/review` lines 98.36 (threshold 98) |
| `node scripts/mutation-checks.mjs` with the new and changed entries | every entry killed; each source file compared with a copy taken before the run (`cmp`): identical |
| one extra mutation by hand (`locateHostBinary` without its final check of the excluded directories) | killed; the file was restored and compared with `cmp` |

## Scratch checks

A scratch test in `src/core/isolation` (removed afterwards) showed that `hostLaunch` takes `srt` from a directory that the sandboxed agent may write, when that directory is on the PATH of the app: a directory of `extraWritePaths`, a directory below the Claude configuration directory, and for a check any directory that the agent session may write. A stub `srt` there ran outside the sandbox, wrote a marker and exited 0 for a failing check.

The launcher was run from Node with these first words: `.`, `source`, `eval`, `exec`, `trap`, `set`, `cd`, `command`, `builtin`, `type`, `hash`, `alias`, a word with `=`, `-S`, `-i`, `-u`, `--`, `-`, an empty word and a program path with a space. No builtin runs inside the launcher. `.` ends with 126 and `Permission denied`; `cd`, `command`, `type`, `hash` and `alias` run as the external wrappers in `/usr/bin`.

A relative `NODE_OPTIONS=--require ./x.cjs` makes the real `srt` shim load `x.cjs` from its working directory, which is the workspace of an agent session.

## Not finished

Linux, an agent session under the real srt with a hostile PATH, and the configuration that git reads from a worktree were not checked.
