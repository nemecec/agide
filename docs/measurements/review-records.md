# review-records: independent review of the milestone 5 records

Start: 2026-11-21T22:11:17Z (`date -u`). End: 2026-11-21T22:25Z (`date -u` after the last edit).

Cross-model check of `docs/decisions/0040` to `0042`, `docs/README.md`, `app/README.md` and `notes/probes-m5-review.md`. No product code or test was changed.

## What was checked

- Every table of 0042 against the measurement files of the run, the code under `app/src/core/review`, `app/src/main/modules/review.ts`, the renderer review pane, `app/vitest.config.ts`, `app/scripts/mutation-checks.mjs`, the real-Claude scripts and `docs/parity.md`.
- The start and end times and every sum, rate and projection of the effort and re-estimate tables, recomputed from the measurement files and from 0039.
- The probe notes against `probes/out/p42_report.json`, `p43_report.json` and the `result` events of the stored `p40_*` to `p43_*` logs.
- Claims that decisions depend on, against the Claude Code docs (CLI reference, settings, permission modes): `--tools` and MCP tools, `--allowedTools`, `--disallowedTools`, `--strict-mcp-config`, `--setting-sources`, the UUID rule of `--session-id`, the settings reload, workspace trust and allow rules, `permissions.blockWritesOutsideWorkingDirectories`, the protected paths and what each permission mode does with a write to one.
- Consistency with 0010, 0037, 0039 and 0041 (section numbers, question numbers, the milestone 4 figures).
- The style rules and a scan for employer names, user paths, e-mail addresses and tokens in the reviewed files, the probe scripts and the milestone 5 measurement files: no hit.

## Commands run

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm test` | 268 files, 3056 tests pass, 15 skipped; the skipped tests are the ones that need a real `srt` |
| `npx vitest run src/core/isolation src/core/review/capture --reporter=verbose` | pass; shows the skipped tests by name and that the container provider's contract tests ran |
| `npx playwright test --list` | 86 tests in 24 files (listed, not run) |
| `pnpm check:colours` | pass |
| `pnpm parity` | ok; `docs/parity.md` unchanged by the run (same checksum) |

## Corrections made

See the structured report of this run and the new row of the findings table in 0042. In short: 0042 named question 8 where question 7 asks about the reviewer tier; it put the probe spend at a few cents and the total at about 0.1 USD, while the stored probe logs alone sum to about 0.17; it said every row of the 0040 security table has a test; it called the container suites skipped; it gave the per-day ratio to milestone 4 as about twice where the tables give about 2.4; it did not say that the application leaves `ReportDesk`, the effects table and `ReviewRunDriver` unused, nor that retention, the interdiff, the malformed-policy alert, the Retry action, the `report_outcome` sentence, the start dialog notes and the `quiet-result` and `removal` triggers of 0040 are not built. `app/README.md` listed `review_request_escalation` as a UI command, described the demotion confirmation and the check recovery imprecisely and did not say that the start dialog's Form tab sends a review share of 0. `docs/README.md` placed the restyle text of `w-ui.md` at the last commit. The probe notes gained the docs' rule for a `--settings` file as a protected path.

## Found and not fixed (code)

- `rules/protectedPaths.ts` is shorter than the protected paths of the permission-modes docs. Recorded in 0042 as open.
- The parts of 0040 named above are not built. Recorded in 0042 as open.

## What took long

Reading 0040 against the code for parts that 0042 did not mention, and summing the cost of the stored probe logs.

## Not done

- `pnpm coverage`, `pnpm e2e`, `pnpm mutation`, `pnpm visual-check`, `pnpm coverage:e2e` and the real-Claude scripts were not run (free disk was about 4.2 GiB, and the full mutation run takes about 45 minutes). The mutation result of 0042 was checked only against the number of entries in the script.
- The verdicts and finding counts of the step reports are not stored as files and could not be checked.
- The docs pages were read through a fetch tool that summarises; the protected-path list should be read again from the page when the rule is changed.

## Disk and cleanup

About 4.2 GiB free at the start and at the end. Temporary files went under `/tmp/agide-review-records/` (two logs and the test temporary directory, about 5 MB). The permission system refused its removal, so the coordinator removes it.
