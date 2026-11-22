# record

Start: 2026-11-17 09:58:52 UTC (date -u). End: 2026-11-17 10:02:40 UTC (date -u). Wall time about 4 minutes.

## Built

- `docs/decisions/0014-milestone-1-results.md`: what milestone 1 built and shows against R1, R4, R6 and R8; the probe and build findings that amend 0004, statement by statement; review findings with their fix status; wall times per step from `docs/measurements/*.md` with a token column to fill from the workflow notification; comparison with the 0005 estimates and a re-estimate of the remaining greenfield effort; open items; milestone 2 recommendations; questions for the user.
- `docs/README.md`: rows for 0012 to 0016, a section for the app repository and its commands, the other documents in `docs/`, `notes/probes-stage2.md`, and the P6 to P10 scripts.
- Ran `pnpm typecheck` and `pnpm test` in `app/` to confirm the state the record describes; both pass.

## What took long

Nothing. Reading the inputs took most of the time.

## Not finished

- Token totals per step are not recorded by the agents; the 0014 table has a placeholder column.
- 0004 itself is not edited; 0014 lists the statements that need amendment.
- The re-estimate rests on a judged share of the 0005 rows built in milestone 1.

## Milestone 2 record

Start: 2026-11-17 18:54:07 UTC (date -u). End: 2026-11-17 19:00:41 UTC (date -u). Wall time about 7 minutes.

### Built

- `docs/decisions/0024-milestone-2-results.md`: what milestone 2 built and shows against R20 to R23; the milestone 1 findings it closed; the probe and build results that amend 0004, 0019 and 0021, statement by statement; review findings with their fix status; tests and coverage per area from the quality and fix reports; wall times per step from `docs/measurements/*.md` with a token column to fill from the workflow notification; the re-estimate; open items; recommendations for milestone 3; questions for the user.
- `docs/README.md`: rows for 0020 to 0024, the new commands, `blocks.md`, the milestone 2 notes and the P11 to P15 scripts.
- `README.md`: status. `app/README.md`: profiles, inbox, tasks and reminders, layout details, the changed default of `AGIDE_SESSION_CWD`, `AGIDE_E2E_COVERAGE_DIR`, the new main-process files.
- Ran `pnpm typecheck` and `pnpm test` in `app/` to confirm the state the record describes; both pass (61 files, 597 tests).

### What took long

Reading the reports and the probe notes, and matching the 0021 statements against what the build did.

### Not finished

- Token totals per step are not recorded by the agents; the 0024 table has a placeholder column.
- 0004, 0019 and 0021 are not edited; 0024 lists the statements that need amendment.
- The verification step left no measurement file, so its times are approximate in 0024.
- The coverage figures per area predate the fix step; `pnpm coverage` and `pnpm coverage:e2e` were not run again for this record.
- No commit was made. The relayed user request asked for a commit of the README changes; the computed task for this step forbids commits, and the question is in 0024.

## Milestone 3 record

Start: 2026-11-18 01:07:20 UTC (date -u). End: 2026-11-18 01:16:30 UTC (date -u). Wall time about 9 minutes.

### Built

- `docs/decisions/0030-milestone-3-results.md`: what milestone 3 built and shows against R12, R13, R15, R16, R17 (the permission gate), R24 and S2; what the srt, container and OpenShell probes and providers show; the statements of 0004 and 0028 that change, and what the build adds to the 0029 amendments of 0010, 0011, 0019 and 0022; review findings with their fix status; tests and coverage per area; wall times per step with a token column to fill from the workflow notification; the re-estimate; open items with the host changes and leftovers; milestone 4 recommendations; questions for the user.
- `docs/README.md`: rows for 0025 to 0030, the amendment pointers, the new commands and scripts, the milestone 3 notes and probe scripts.
- `README.md`: status after milestone 3.
- `app/README.md`: environment variables of the tasks, srt and browser tests; the folder-trust handling and the mode after Shift+Tab; browser consent rules; sections on task start, agents and usage, and isolation providers; module map rows.
- Ran `pnpm typecheck` (pass) and `pnpm coverage` (131 files, 1413 tests, thresholds met) in `app/` to confirm the state and compute coverage per area from `coverage/coverage-summary.json`.

### What took long

Reconciling the builder reports, written while other builders were still changing files, with the state after the fix step, and placing each amendment in the right earlier record without repeating the 0029 tables.

### Not done

- The judged days built are a judgement; no measurement gives them.
- The m3 and gate real-Claude scripts, `pnpm e2e`, `pnpm mutation` and `pnpm coverage:e2e` were not re-run for this record; their figures come from the fix, verification and quality reports.
- The temporary log files of this step were removed. Leftovers of other steps are listed in 0030 and were not touched.

## Milestone 4 record

Start: 2026-11-21 10:14:29 UTC (date -u). End: 2026-11-21 10:24:31 UTC (date -u). Wall time about 10 minutes.

### Built

- `docs/decisions/0039-milestone-4-results.md`: what milestone 4 built and what each slice shows against R18 (cap, queue, stages, steering, budgets, approvals from the inbox card, worktrees, tools, UI, usage, isolation); the statements of 0004, 0011, 0027 and 0037 that the probes and the build change; review findings with their status; tests and per-area unit coverage; measured effort per step and a re-estimate; what remains open; recommendations for milestone 5 (R19, then R21, notes and mounts, apps); questions for the user.
- `docs/README.md`: rows for 0037 to 0039, the amendment summary, the milestone 4 measurement files, `notes/probes-m4-swarm.md`, the P30 to P37 scripts, the swarm real-Claude scripts and the CLI versions.
- `README.md`: swarms in the status list and the milestone 4 results record.
- `app/README.md`: links to 0038 and 0039; the Swarms section (shared cap with `task_start`, definition fields, budgets, approvals, Resume for paused swarms, no removal yet, the `swarm` settings with defaults); the swarm unit and end-to-end tests.

### Commands run

- `pnpm typecheck`: pass. `pnpm coverage`: 216 files, 2203 tests pass, 15 skipped, thresholds met; per-area figures computed from `coverage/coverage-summary.json` with a one-off `node -e` script.
- A read-only `claude -p` reviewer (sonnet, effort medium, tools Read, Grep and Glob, `--max-budget-usd 1.5`, `--setting-sources user`, `--strict-mcp-config`, cost about 0.36 USD) checked the record and the READMEs against the records, notes, measurement files and code. Its findings were applied: this section was missing, the test counts needed their source, and sums were in prose (moved into tables).
- A grep for the banned words and for user paths, e-mail addresses and employer names in the written files: none, apart from a quoted finding that was reworded.

### What took long

Collecting the start and end times from the measurement files, and matching the statements of 0004, 0011, 0027 and 0037 against the probe notes and the step reports.

### Not done

- The `w-ui.md` start time of the swarm UI step reads 05:38, before the milestone started; the record assumes 07:38, when the builders started.
- `docs/measurements/w-ui.md` of the restyle was overwritten by the swarm UI step; the record lists it as open and did not restore it (not this step's file).
- `pnpm e2e`, `pnpm mutation` and the real-Claude scripts were not run by this step.
- Temporary files of this step were removed. The reviewer ran in the project directory, so the CLI may have added a session file under the project entry of that directory in the Claude configuration directory (not checked).

## Milestone 5 record

Start: 2026-11-21T22:01Z (`date -u`). End: 2026-11-21T22:12Z (`date -u`).

### Built

- `docs/decisions/0042-milestone-5-results.md`: what milestone 5 built against 0010 and the slice of 0040, the real-Claude runs, the probe results, the amendments to 0010, 0037 and 0040, the review findings and fixes, tests and coverage, measured effort and spend, the re-estimate, open items, recommendations and questions.
- Status lines: 0041 accepted; 0040 stays proposed and names the sections the build confirmed.
- `docs/README.md`: index rows for 0040 to 0042, the milestone 5 measurement files, the P40 to P43 scripts and notes.
- `app/README.md`: the Review section (the pane, the inbox card, the policy file with an example, the `review` settings, the commands and tool sets), the review tests, the visual-check phases, the module map and the init order.

### Commands run

- `pnpm typecheck`: pass. `pnpm test`: 268 files, 3056 tests pass, 15 skipped.
- The policy example of `app/README.md` parsed with `reviewPolicySchema` through a small script under `/tmp/agide-record/`.
- A scan of the new and edited docs for the banned words and user paths: none.

### What took long

Reading the measurement files and the reports, and working out the effort totals.

### Not done

- No real-Claude script and no full `pnpm mutation`, `pnpm coverage` or `pnpm e2e` run in this step; 0042 cites the step reports for them.
- No independent review of this record.
- Temporary files of this step under `/tmp/agide-record/` were removed.
