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
