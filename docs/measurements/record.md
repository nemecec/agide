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
