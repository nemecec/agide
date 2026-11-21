# cross-review

Start: 2026-11-17 10:03:08 UTC (date -u). End: 2026-11-17 10:42:25 UTC (date -u). Wall time about 39 minutes.

Cross-model review of `docs/decisions/0013-stage2-architecture-and-contracts.md` and `0014-milestone-1-results.md` against the code in `app/`, the test output, the measurement files and the probe output in `probes/out/`. No source file in `app/` is changed.

## Commands run

- `pnpm typecheck`, `pnpm test`, `pnpm e2e` in `app/`: all pass, at the start and again at the end.
- `pnpm e2e:claude-mcp` and `pnpm e2e:real-claude` once each (haiku, 0.25 USD cap): both pass. Costs 0.0042 and 0.0046 USD.
- A mutation run over the unit tests: one rule removed at a time, `vitest run`, file restored and compared by checksum. The source tree is identical before and after.
- A temporary Playwright spec with three folder levels and a leaf below them (drag across levels, rejected cycle drop, restart): passes. The spec is deleted.
- Two instances of the built app on one data directory, hidden: the second exits with code 0 after about a quarter of a second. An instance on another data directory runs next to the first.
- The hook command of `core/session/hooks.ts` under `fish -c`, `zsh -c`, `bash -c` and `/bin/sh -c` with an inbox path that holds spaces and a quote: each stores its payload.
- One `claude -p` call (haiku, 0.25 USD cap, empty temporary directory, `--setting-sources user`, `--strict-mcp-config`, tools off, cost 0.0007 USD) with a `UserPromptSubmit` hook that records its own interpreter: the CLI started it as `/bin/sh -c <command>` with `claude` as the parent, `SHELL` was `/bin/zsh`, and the model reported no text from the hook.
- `pnpm view` for `typescript-eslint`, `typescript` and `better-sqlite3` (public registry, package names only).

## Findings

Errors corrected in the records:

- P6: the records and the notes said that no approval dialog shows when the `PermissionRequest` hook answers. The raw PTY output of all P6 cases holds the dialog text; the hook's answer closes the dialog without a keypress. 0014 now says so and lists a waiting hook as untested.
- P9b and P9 were mixed: the controlled comparison is `-p` only; the PTY result comes from single P9 runs.
- P8: the two sizes next to the limit ran in `-p` only.
- 0014 said the app "refuses a second instance" under "what is shown" and S1 "at three levels and deeper"; neither had a test. Both are now stated with their evidence (manual run, temporary spec).
- The re-estimate concluded that the total "points below the 168 days". The measurements are agent minutes with no user hours, so they give no total in engineer days. The paragraph now states what the measurements show.
- The token column is empty and 0012 asks for tokens; now an open item.
- 0013: `pnpm test` also covers `src/main`; the `ui_*` commands were written by the MCP builder; no renderer builder ran; the revoke after a failed launch applies to `session_create` only; node-pty's install script can build with node-gyp.

Mutation results (all listed in 0013 under "Rules without a test"):

- Fail a test: both forged-leaf guards, scope of `ui_create_leaf` and of the moved node, session scope, revoke on exit, revoke on a top-level move, rescope on move, startup cleanup, bypass confirmation, migration version check, listener error handling, 413, `OutputBuffer` trim, inbox reset, parity exemption rule.
- Pass every test: revoke on close (the exit before it revokes), revoke after a failed `session_create` launch, withheld grant for a resumed session whose leaf is outside its folder, `busy_timeout`, the 500 handler.
- `UNION ALL` in `isWithin`: the stored-cycle test never returns. The run timed out after 240 seconds and left one test worker spinning, which I stopped.

Supported as written: the toolchain versions, the Node and SQLite versions inside Electron, the contracts in 0013 against the code, P7, P10, the P9 table, the wall times and their sums, the 0005 and 0007 figures, and the arithmetic of the projection.

## What took long

The mutation run: the `UNION ALL` case hung until its timeout.

## Not finished

- `notes/probes-stage2.md` and `probes/RESULTS.md` still say that no dialog appears in P6. They are outside the two records; 0014 names the discrepancy.
- 0004 is not edited (as before).
- Not checked: the reports of the builder, integration, review and fix steps that 0014 summarizes (not stored as files), the statement that the reviews rejected the integrated code, and the flake fix beyond the two e2e runs of this review.
- The shell guard refused the removal of my scratch files: `/tmp/agui-review-mut`, `/tmp/agui-review-hookshell` and the `/tmp/agui-review-*.log` files. They hold a mutation script, checksum lists, the hook probe script and test logs.
- No token count is available to me.

## Cross-review of milestone 2

Start: 2026-11-17 19:01:24 UTC (date -u). End: 2026-11-17 19:30:12 UTC (date -u). Wall time about 29 minutes.

Scope: 0020 to 0024, the root README, `app/README.md`, `docs/README.md`, and their claims about `app/`, checked against the code, the test runs and the probe logs in `probes/out/`.

### Commands run

- `pnpm typecheck`: passes (also after my edits).
- `pnpm coverage`: 61 files, 597 tests pass, thresholds met. Per-area figures computed from `coverage/coverage-summary.json`.
- `pnpm e2e`: 26 pass, twice; 27 pass with the test I added.
- `pnpm parity` and `pnpm blocks-docs`: `docs/parity.md` and `docs/blocks.md` come out with the same checksums.
- `pnpm e2e:claude-mcp`, `node scripts/smoke-real-claude.mjs`, `pnpm e2e:real-claude`, `pnpm e2e:real-claude-inbox`, once each on Haiku: the first three pass (0.0042, 0.0036 and 0.0047 USD); the inbox script failed, and passes after my fix (0.0048 USD).
- `pnpm coverage:e2e` four times: see the findings.
- A search of every tracked and untracked file outside the ignore rules for employer names, user directory paths, e-mail addresses, token shapes and long identifiers, and a search of the docs and the code for the words the style rules exclude.

### Findings and what I changed

- `scripts/e2e-real-claude-inbox.mjs` failed since the fix step: it read the mode of `mcp.json` after `SessionStart`, when the app has removed the file. The script reads the mode right after the launch and checks at the end that the file is gone. 0024 said that all real-Claude scripts pass at the end of the fix step; the row now says which ran when.
- `e2e/coverageHook.ts` put the process environment back under the environment a spec passes, so `CLAUDE_CONFIG_DIR`, which `profiles.spec.ts` removes, came back under `pnpm coverage:e2e` and the two-profiles test failed. The hook uses the spec's environment as it is. This is the failure that the quality step saw and the fix step could not reproduce with `pnpm e2e`.
- After that fix, two of three `pnpm coverage:e2e` runs failed in one inbox test each, with the load average of the machine near 18, and the failing test ran far past its timeout. The fourth run passed. Listed as open in 0024.
- 0024 said the `BEFORE DELETE` trigger was checked in the Electron e2e runs; no e2e test removed a folder. I added one to `e2e/inbox.spec.ts`; it passes inside Electron 45. It is not mutation-checked.
- 0024: coverage tables replaced by figures measured after the fixes; the re-estimate uses unrounded rates (the per-day rates 21.5 and 27.5 were rounded down, which moved the hour ranges); the comparison with milestone 1 names the probe step that took longer than the fix step; the registry entry is described by its real fields; the open list gains the probes C3, C4 and the `--settings` path half of C2, the unwritten probe scripts, the `proposed` status of 0020 to 0022 and the coverage-run flake; the question about the README commit is corrected, because the last commit, made two minutes before the run, holds README changes.
- 0023: amendments for the inline `--settings`, the unwritten `settings.json` session file and probe scripts, and the two settled "Not verified" items.
- Root README: continuous integration also runs the parity check, and on pushes to `main` only. `app/README.md`: what crosses profiles (definitions and the registry entry fields).
- Style: one comment in `src/core/layout/diff.ts` used an excluded phrase. Three measurement files held a date in the locale format of the machine; they now use the ISO form.
- The search for employer names, user directory paths, e-mail addresses and tokens found nothing in tracked or untracked files. The author's name stands in `NOTICE` and in the "Decided by" lines of records the user committed; I left it. `probes/out/` and `probes/work/` hold absolute user paths and are ignored by git.

Supported as written: the probe statements of 0021, 0023 and 0024 about P11 to P15 against the builder and reviewer reports (delays, payload keys, the waiting-hook cases, the elicitation answers, the atomic write test), the wall times and their sums, the estimates quoted from 0005, 0007 and 0014 to 0019, the constants and rules named in 0023 and 0024 where I looked them up in the code (file modes, the staleness time, the daily occurrence limit, the reminder limit, the message length, the resize tolerance, the timer cap, deny rules, the refused working directory, `onLaunchFailed`, the module order, the environment variables of the README).

### What took long

The `pnpm coverage:e2e` runs: one failing inbox test kept a run going for more than five minutes.

### Not finished

- Not checked: the verification step's two clean-copy runs and the mutation checks of the quality and review steps (no file records them); the 572-test figure of the quality step; the `cost-state` totals quoted in `notes/probes-m2.md` beyond the status line cost in the report; most of the body of 0020 to 0022 beyond their probe statements, estimates and style.
- The cause of the inbox test failures under `pnpm coverage:e2e` and of the long run after a failure.
- The effect of the deny rules in a real session, and everything 0024 lists as not checked on screen.
- The real-Claude runs wrote transcripts for `agide-smoke-cwd` to the user's Claude config, as the earlier runs did.
- No token count is available to me.

## Cross-review of milestone 3

Start: 2026-11-18 01:17:07 UTC (date -u). End: 2026-11-18 01:36 UTC (date -u). Wall time about 19 minutes.

Scope: 0026 to 0030, the root README, `app/README.md`, `docs/README.md`, `notes/probes-m3-permissions.md`, `notes/probes-m3-isolation.md`, the milestone 3 sections of `probes/RESULTS.md`, and their claims about `app/`, checked against the code, the test runs, the probe logs in `probes/out/`, the measurement files and the host state.

### Commands run

- `pnpm typecheck`: passes, at the start and after my edits.
- `pnpm coverage`: 131 files, 1413 tests pass, thresholds met, at the start and after my edits. Per-area figures computed from `coverage/coverage-summary.json`.
- `pnpm e2e`: 55 pass. `pnpm coverage:e2e`: 55 pass.
- `pnpm parity` and `pnpm blocks-docs`: `docs/parity.md` and `docs/blocks.md` come out with the same checksums.
- `pnpm mutation`: see the findings. Source checksums are identical before and after.
- `node --experimental-strip-types scripts/real-claude-gate.mjs` and `node scripts/e2e-real-claude-m3.mjs` on Haiku, once each: both pass (the gate script 0.0040 USD per run; the m3 script reports no cost).
- `pnpm coverage` and `pnpm e2e` with Docker off the `PATH`, and for the coverage run `AGIDE_SRT_BIN` pointing at a missing file, to stand in for the continuous integration runner.
- srt 0.0.83 from the probe prefix with a shell script as the inner process and a settings file shaped like the provider's: writes to the protected names of a writable configuration directory.
- Host checks: `df`, the srt prefix and its version, Docker containers, images, volumes and networks by name and creation time, OpenShell paths, the pnpm store's project links, the Claude project directory names and trust entries the records name, the temporary directories, the install link of the CLI.
- A search of every tracked and untracked file outside the ignore rules for employer names, user directory paths, e-mail addresses, token shapes and long identifiers, and a search of the docs and the code for the words the style rules exclude.

### Findings and what I changed

- `pnpm mutation` failed after the fix step (50 killed, 2 skipped, exit code 1): the fix step had changed the source lines that the entries for the fragment redaction and the blocked path prefix replace. `scripts/mutation-checks.mjs` has the two entries corrected and one added for the normalised path comparison; 53 mutations are killed. 0030 said the script was not re-run; it now says what the run found.
- `pnpm coverage` failed on a host without srt and Docker (functions of `src/core` 93.7 against 94), which is the state of the continuous integration runner. `ptyHarness.ts` and `testRuntimes.ts` in `src/core/isolation` are helpers of the srt and container tests and were measured as source. `vitest.config.ts` excludes them like the other test helpers; the run without the runtimes then passes with a margin of 0.2 on that threshold. 0030 has the figures and lists the margin and the missing run on the real runner as open.
- The CLI updated itself from 2.1.326 to 2.1.327 at 23:52 UTC, during the quality step. The probes, the builders and the integration ran on 2.1.326; the real-Claude scripts of the verification, the fix step and this review ran on 2.1.327. 0030 now states this and lists that no probe was repeated on 2.1.327.
- The `denyWrite` fix for srt had a unit test of the generated settings only. Under the real srt the listed names cannot be overwritten, created, renamed or linked inside the writable directory, and `.claude.json` stays writable. 0030 records the check; no test keeps it.
- 0030: the "Not fixed" sentence said that real srt and Docker runs were not checked, while the unit suite runs both on this host; the re-estimate said the fix step "again took longer than most builder steps", which the times of neither milestone support (40 minutes against 37 to 72; 32 against 39 to 81 in milestone 2); the coverage table now holds the figures after the exclusion, with the end-to-end coverage after the fixes; the tests table says which runs the cross-review repeated; a cross-review step and row are added.
- 0030 open items: Claude project directories left by the gate script, links in the pnpm store to removed verification copies, `agide-i1run.*`, `agide-checks-*`, `agide-app-*` and `agide-dbg-*` in the per-user temporary directory (about 25 MB), and `/tmp/verify-app.b3ZC4d`, a copy of the app with `node_modules` from the milestone 1 verification (about 965 MB). `notes/probes-m3-isolation.md` gains the `agide-i1run.*` row.
- 0029 was stale against the build in these places: the contract suite runs srt against the real `srt`, not a fake; `terminate` under srt is implemented and tested (SIGTERM with the real srt, SIGKILL of the process group without it); bypass is offered on srt with asks turned into denials, not hidden until Q2; the recognizer also returns Slack and Notion objects; no contract suite is pending and `m3Modules.test.ts` runs the modules, not stubs (its title is corrected too).
- `docs/measurements/integrate.md`: the milestone 3 wall time is 19 minutes by its own time stamps.
- The search for employer names, user directory paths, e-mail addresses and tokens found nothing in tracked or untracked files. The author's name stands in `NOTICE` and in the "Decided by" lines of committed records (0030 asks the user about them). Test fixtures use made-up home paths and addresses under reserved domains. `probes/out/` is ignored by git; one report there quotes the name of a user-level hook command. The style search found no excluded word in the milestone 3 files.

Supported as written: the wall times of every step and their sums, the rates and the hour ranges of the re-estimate, the estimates quoted from 0005, 0009, 0014, 0018, 0019, 0024 and 0028, the test and file totals, the per-area unit coverage within 0.1 outside the excluded files (the branch figures of `src/main` and `src/main/modules` move by up to 0.4 between runs), the probe statements of 0028, 0029, 0030 and the two notes against `p16` to `p24`, `pb1` and the reviewer re-runs in `probes/out/`, the real-Claude outcomes of the gate and m3 scripts, and the constants and rules I looked up in the code (mode resolution and the bypass conditions, the ask and sandbox settings, `denyWrite`, the container mounts and the unavailable inspector, the approval and MCP timeouts, the agent cap, removal delays, usage defaults, the status snapshot name, the task directories, the base-branch `CLAUDE.md` read, the module order, events only to app-page windows, DevTools off when packaged, no dependency added).

Host state against the isolation probe notes: srt 0.0.83 in the `/tmp/agide-srt.*` prefix (19 MB) with its pointer file; no OpenShell binary, configuration, image, container, volume or network; no container with an `agide` label; Docker Desktop 4.97.0 with engine 29.9.2; the `agide-i1` project directories and trust entries and the two `p24-` entries are present as the notes say. Free disk space is 12 GiB at the end (11 GiB at the start).

### What took long

The mutation run and the repeated coverage runs.

### Not finished

- Not checked: the verification step's clean-copy runs and the review steps' own mutation runs (no file records them); the 1356-test figure; the manual probe steps without logs (the Keychain item, the OpenShell policy reload and provider placeholder); the body of 0026 and 0027 beyond their probe statements, estimates and style; the smoke, MCP and inbox real-Claude scripts after the fixes.
- No run on the real continuous integration runner; the simulated host still had `gh` and `claude`.
- No probe was repeated on CLI 2.1.327.
- Everything 0030 lists as not checked on screen.
- The removal of `/tmp/agide-xreview` (my logs and the srt check directory, under 1 MB) was denied. Each of my gate script runs left a Claude project directory named after its removed `agide-gate-` temporary directory; I did not remove them.
- No token count is available to me.

## Cross-review of milestone 4

Start: 2026-11-21 10:25:11 UTC (date -u). End: 2026-11-21 10:52 UTC (date -u). Wall time about 27 minutes.

Scope: 0037 to 0039, the root README, `app/README.md`, `docs/README.md`, `notes/probes-m4-swarm.md`, the milestone 4 section of `probes/RESULTS.md`, the milestone 4 measurement files, and their claims about `app/`, checked against the code, my own test runs and the probe reports and logs in `probes/out/`.

### Commands run

| Command | Result |
|---|---|
| `pnpm typecheck` | passes |
| `pnpm coverage`, two runs | 216 files, 2203 tests pass, 15 skipped, thresholds met, both runs |
| `pnpm e2e` | 79 pass with hidden windows, 2.1 minutes |
| `pnpm parity`, `pnpm check:colours` | ok; no colour literal outside the allowlist |
| `pnpm mutation`, the whole list, after the two repairs below | every mutation killed, none survived, none skipped, about 15 minutes |
| `node scripts/e2e-real-swarm-runtime.mjs`, `e2e-real-swarm-mcp.mjs`, `e2e-real-swarm-dialog.mjs` (Haiku, 0.25 USD per process, claude 2.1.330) | all pass; agents' reported cost 0.0010, 0.0103 and 0.0082 USD |

### Findings and what I changed

- `app/scripts/mutation-checks.mjs`: the fix steps changed the source text of two entries (the launch that ends before its first line in `StreamAgentRuntime.ts`, the working directory in a status in `callerView.ts`), so the script would have skipped both and ended with exit code 1. I gave both entries the text of the current code; both are killed. The second entry now removes only the stripping of the working directory, which is what its name says.
- 0039, coverage: the branch figures of `src/main` and `src/main/modules` came out 0.3 to 0.4 higher in both of my runs than in the record; the table now gives both values. The gap sentence named the `src/main` branch threshold as the narrow one; the narrow one is `src/main/modules`.
- 0039, findings and open items: the field errors of the agents table were listed as not fixed, while the fix step built them with a test (`AgentsEditor.test.ts`). Moved to the fixed rows and taken out of the open list.
- 0039, items of 0037 that are not built and were not listed: raising a budget and the buttons for the actions of the swarm alerts, the inspector record on approval items, the approval buttons on the agent's node, the plan windows in the pane header, and `GitWorkingDirectoryManager` left unchanged. Added to the 0037 table and the open list.
- 0039, leftovers: `/tmp/rev-swarm-ui` was missing from the list. An Electron process of the app, started by Playwright at 23:01 UTC on 2026-11-20 and now without a parent, still runs; I did not end it and listed it.
- 0039, spend: added that the opus and sonnet reviewer runs of the integration and record steps are outside the run's rule for real-Claude calls.
- 0039, re-estimate: the sentence that the once-per-milestone steps took about the same time as in milestone 3 now has its sums in the totals table (about 161 against about 147 minutes).
- 0039, tests: the srt and container suites are the skipped tests; srt is not installed on the host now and the container test image is not local, so these suites did not run in milestone 4. Stated in the table and the open list. The mutation and real-script rows now hold my runs.
- 0038: a paragraph under "Changes after the review" for what was built differently from the slices (the cap counted in two places, the swarm's own `Git` class, approval answers on the card only).
- `docs/measurements/review-fix-m4.md`: a finding quoted a word of the banned list; reworded.
- `docs/README.md`: the milestone 4 section of this file is named.

Supported as written: the probe statements of the notes and of `probes/RESULTS.md` against the P30 to P37 reports (request fields, deny and changed input, the 60 s pending request, interrupt timings and terminal reasons, the cancel request, SIGINT, a sample of the control request answers, the session id reuse error, resume from another directory and while live, the P34 table, the budget and turn limit results, the worktree results, `--bare` and the `auto` mode from the user settings); `fable` in the `initialize` models list; the CLI version 2.1.330; the wall times of every step with a measurement file and their sums; the rates and hour ranges of the re-estimate; the milestone 3 figures quoted from 0030; the test counts; every other coverage cell; the constants the records name (line limit, control timeout, stop waits, retry delay, queue alert, calibration limits, settings defaults, tiers); the git guard flags; the commands, exemption and permission class; the cap in the end-to-end test.

Privacy and style: no employer name, user directory path, e-mail address or token in tracked or untracked files (test fixtures use reserved domains and made-up paths; `probes/out/` holds absolute paths and is ignored by git). `notes/probes-m4-swarm.md` names the plan type of the login; left as it is. No word of the banned list in the files of the milestone after the rewording.

Host state: free disk 4.9 GiB at the end (5.1 at the start). No process of this step remains.

### What took long

The mutation run. A SIGINT sent to the script's own process did not end it: the run loop is synchronous, so the handler does not run until the loop ends. I let the run finish and kept a copy of the files it edits while it ran; the sources had the same checksums before and after.

### Not finished

- Not checked: the verification step's clean-copy run and its times (no file records them); `pnpm coverage:e2e`; the real-Claude scripts of the earlier milestones after the fixes; the review steps' own mutation and revert checks; the body of 0037 beyond its probe statements, the items compared with the build, the estimate and style; the P37 statement that the tool list length differed between two runs (one report is kept).
- `PersistentSwarmManager.ts` has about 1300 lines, against the rule of small modules; not changed and not listed in 0039.
- The app README says the mutation script restores its file on Ctrl-C. It restores after every run, but a signal to the script alone does not stop it; not changed.
- My edit of `mutation-checks.mjs` and my edits of the records have no review by another agent: this step has no tool to start one.
- No token count is available to me.
- Temporary files: my logs and scripts were in `/tmp/xrev-m4`; the directory is removed. The real-Claude scripts removed their own temporary directories; the trust entries and project directories the CLI keeps for them in the Claude configuration directory were not checked.
