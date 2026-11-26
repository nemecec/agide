# Review of the seventh check-clone pass (review:check-clone-fix-7)

Start 2026-11-26 11:32 UTC, end 2026-11-26 12:11 UTC.

Independent review of the seventh pass on the confined project check: one module for every host-side start (`core/isolation/hostTools.ts`), one set of agent-writable directories (`agentWritable.ts`), loader variables moved inside the sandbox, and a guard test against bare names. The reference is the diff against 35baf87, `docs/measurements/check-clone-fix.md` and `docs/measurements/review-check-clone-fix-6.md`. No product code or test was changed; scratch tests and scratch edits were removed or restored byte for byte.

## What was done

- Read 0040 section 6 ("Host-side programs"), 0041, 0042 and the diff of every changed source file.
- A grep of `src` and `scripts` for every way to start a process (`child_process`, `node-pty`, `execFile`, `spawn`, `fork`, `exec`, `shell.openExternal`), with a decision for each site.
- A scratch test (removed afterwards) over the real code paths and the real `srt` 0.0.83, with stand-ins of `srt`, `node`, `env`, `git`, `docker`, `gh`, `which` and `sh` in a session workspace below the task base, a session workspace outside it, an `extraWritePaths` directory, a directory below the Claude configuration directory, relative, empty and dot PATH entries and a case variant of an excluded directory, for an agent session and a check, with `NODE_OPTIONS`, `NODE_PATH`, `DYLD_INSERT_LIBRARIES`, `BASH_ENV`, `ENV`, `CDPATH` and `IFS` in the profile.
- Probes of the host-side `/bin/sh` (bash 3.2) for variables that make it run code, and of the launcher with first words that name a directory.
- Mutations of the guard test (copies first, `cmp` after each), one wiring mutation of the review module, and the mutation entries of the pass for `host tools:`, `writable:`, `wiring:`, `spawn guard` and `host launch:`.
- Regression runs: typecheck, the CI-like coverage run, the launcher tests under a job-control terminal, the real-`srt` check tests and the e2e run.

## Results

Verdict: accept with fixes. The module, the absolute system tools, the loader split and the guard work for the cases they test, and every mutation of the pass is killed. The class is not closed: the excluded set misses workspaces outside the task base, and the lookup checks the directory of a program, not the file it runs.

| Finding | Severity | Evidence |
|---|---|---|
| The shared excluded set (`createProfileHostTools`, read by git, gh, docker, `claude auth status` and the `srt` of a check) holds the task base, the Claude directory, `extraWritePaths` and the `srt` defaults, but not the workspace of a session that runs outside the task base (`session_start` takes any `cwd`; `AGIDE_SESSION_CWD`; `AGIDE_TASK_BASE` moves the task base away from `~/Agide/<folder>`), nor the Claude directory that the container provider mounts writable. The providers keep their own `known` set, which the shared instance does not read. | major | Scratch test with the real `srt`: app PATH `<session workspace>/bin:<srt dir>:<node dir>:/usr/bin:/bin`, a session prepared in that workspace. The session's `srt` was the real one. `tools.find('git' / 'gh' / 'docker')` returned the stand-ins of the workspace; a capture call (`execGit`) ran the stand-in git; a check (`sh -c 'echo tests failed; exit 1'`) through `srtToolEnvironment` with a fresh profile instance started the stand-in `srt` and ended with status 0; with a warm instance the real shim ran the stand-in `node` of the workspace and the check also ended with 0. `pnpm exec` puts `<repo>/app/node_modules/.bin` on the PATH as an absolute entry, so `pnpm dev` plus a session on the same repository reaches this. |
| `HostTools.find` for a name checks the directory of the candidate, not the file: a link in a trusted directory into an excluded one is accepted, and so is a shim whose code lies in an excluded directory. The installed `srt` is a pnpm shim that runs `node <pnpm store>/…/cli.js`; with the pnpm store in `extraWritePaths` (what `pnpm install` inside `srt` needs) an agent replaces the code of `srt`. | major | Scratch test: `trusted/srt -> <excluded>/bin/srt` was returned by two calls of `find('srt')`; a `HostTools` that excludes `~/Library/pnpm/store` returned the shim `~/Library/pnpm/bin/srt`, whose `cli.js` resolves to `~/Library/pnpm/store/v11/links/@anthropic-ai/sandbox-runtime/0.0.83/…/dist/cli.js`. A name with a directory part is checked with its real path, a name is not. |
| The host-side `srt` shim is `/bin/sh` (bash 3.2) and gets the profile's environment except the loader variables, in the workspace for a session. Bash imports exported functions (`BASH_FUNC_uname%%`) and runs `PS4` under `SHELLOPTS=xtrace`; both run `./x` of the working directory. | minor | Probe: `env -i PATH=/usr/bin:/bin 'BASH_FUNC_uname%%=() { ./x func; }' /bin/sh -c uname` and `env -i SHELLOPTS=xtrace 'PS4=$(./x ps4)' /bin/sh -c true` both wrote their markers. `BASH_ENV`, `ENV`, `PROMPT_COMMAND` and `BASHOPTS` did not. Needs the user's environment to hold such a value, as the sixth review's loader-variable minor did. |
| The guard test misses spellings: an alias by assignment (`const s = nodePty.spawn`), `spawn.call`, `spawn?.(`, `require` and `import()` of `child_process` in an allow-listed file, destructuring from a namespace, a `command.file` of any object, `process.getBuiltinModule` with a computed name, and `.js` / `.mjs` files. It does not constrain how a `HostTools` is built: passing the profile PATH as `appPath` in `main/modules/review.ts` builds one that excludes nothing, and no test failed. | minor | Mutations G1 to G11 and a wiring mutation, each restored and compared with `cmp`; see the table below. |
| A refusal names the configured program in its reason: `` `${purpose} (${binary}) exists only in …` `` with an absolute `srtBinary`, `AGIDE_SRT_BIN`, `dockerBinary` or the absolute `claude` of `resolveClaudeBinary` puts a path below the home directory into the session error or `notRunReason`; the "not found on the trusted PATH" text is also given for an absolute path, which is not looked up on a PATH. | minor | `hostTools.ts` `require` and `refuseHidden`; `LocalProvider.processCommand` passes the absolute `claudeBinary`. |
| The launcher gives 126 (`env: src: Permission denied`), read as `failed`, for a bare first word that names a directory found through a `.`, empty or relative entry of the profile PATH; 0042 says a word that names a directory ends 127. | minor | Launcher probe: `src` with `PATH=.:/usr/bin:/bin` and `PATH=:/usr/bin:/bin` gave 126; `./src`, `src/` and `.` gave 127 with the `command not found` line; `-i`, `--` and `source` gave 127. |

### Guard mutations

| Mutation | Guard |
|---|---|
| G0 control: `execFile('git')` in `tasks/exec.ts` | fails (caught) |
| G1 `const start = nodePty.spawn; start('git')` in `PtySessionService.ts` | passes (missed) |
| G2 `spawn.call(undefined, 'git', [])` in `runProcess.ts` | passes (missed) |
| G3 `require('node:child_process').execFileSync('git')` in `runProcess.ts` | passes (missed) |
| G4 `import('node:child_process').then((cp) => cp.execFile('git'))` in `runProcess.ts` | passes (missed) |
| G5 `const { spawn: s } = nodePty; s('git')` in `PtySessionService.ts` | passes (missed) |
| G6 `spawn?.('git', [])` in `runProcess.ts` | passes (missed) |
| G7 `process.getBuiltinModule('child' + '_process').execFileSync('git')` in `tasks/exec.ts` | passes (missed) |
| G8 a `.js` file in `src/main` with `execFile('git')` | passes (missed) |
| G9 destructured `require` in `tasks/exec.ts` | fails (caught) |
| G10 `spawn(...argv)` in `runProcess.ts` | fails (caught) |
| G11 `const command = { file: 'git' }; spawn(command.file)` in `runProcess.ts` | passes (missed) |
| Wiring: `appPath: launch().env['PATH']` in the check environment of `main/modules/review.ts` | review, checkEnvironment, guard and spawn-site tests pass (missed) |

### Runs

| Run | Result |
|---|---|
| `node scripts/mutation-checks.mjs 'host tools:\|writable:\|wiring:\|spawn guard\|host launch:'` | 62 killed, 0 survived, 0 skipped; checksums of `src`, `scripts` and `e2e` identical before and after |
| `pnpm typecheck` | passes |
| CI-like coverage run (PATH of a directory with a `node` link and the system directories, no `AGIDE_SRT_BIN`) | 281 files pass, 1 skipped; 3701 tests pass, 2 expected failures, 163 skipped; `src/core` lines 97.32 (threshold 97), branches 86.81; `src/core/review` lines 98.50; `src/main` lines 85.44 |
| Launcher tests under `script -q /dev/null bash -i` | 137 pass |
| Area tests with the real `srt` (srt, isolation, check executor, cache tools) without the Gradle test | 508 pass, 5 skipped |
| `ProcessCheckExecutor.srt.test.ts` with the real `srt` | 130 pass; the Gradle test fails as the fix report says (JDK of this machine) |
| `AGIDE_HIDDEN=1 pnpm e2e` | 86 pass |

### Confirmed

- Relative, empty and dot entries of the app PATH, stand-ins in a workspace below the task base, in an `extraWritePaths` directory (also spelled in upper case), and below the Claude configuration directory are not used for the `srt` of a session or a check; the session with the real `srt` ended with the status of its program (3).
- `NODE_OPTIONS`, `NODE_PATH` and `DYLD_INSERT_LIBRARIES` do not reach the host-side `srt`; a `--require ./x.cjs` in the workspace did not run.
- `df`, `chmod`, `ps`, `lsof`, `cp`, `env` and `open` start by fixed paths; git, gh, docker, claude and srt go through the module in every non-test site of `src/core`, `src/main` and `src/preload`. Remaining direct starts are test support, the app itself (`process.execPath`), `/bin/sh` for the signal table and the commands of the providers after `requireAbsoluteFile`. `shell.openExternal` takes http(s) addresses only.
- A refused `srt` for a check ends `not_run` with a fixed text in `resolveCheckEnvironment`, and the path goes to the log as `launch detail:`.

### What took long and what was not done

The mutation subset and the e2e run took most of the time. Not done: Docker (no engine), Linux, a full `pnpm mutation`, a clean-copy rerun of the Gradle test, real Claude (not needed).

### Temporary files

Everything was under `/tmp/agide-review-check-clone-fix-7/` and was removed at the end. The scratch test lived in `src/core/isolation/` only while it ran; the source checksums of `src`, `scripts` and `e2e` match the ones taken before the first edit.

End 2026-11-26 12:11 UTC.
