# checks-design

Start: 2026-11-26T13:41:04Z (date -u). End: 2026-11-26T13:59:27Z (date -u).

## Built

- `docs/decisions/0045-check-followup-architecture-and-contracts.md` (proposed): the audit of the capture pipeline, the base store, `ReviewInbox`, the policy and the card; the scope and order; the base job (states, triggers, confirm rerun, merges, fix with an agent); report reading (sources, the checked open, saxes with limits, libtest blocks, test keys); the baseline and the failing sets; the zero-test rule; the opt-in lowering; the contracts (policy fields, types, migration 2 of the review module, reasons with their rungs, card and send-back text, commands with the parity rule, inbox items); the builder tasks with their files and order around the eighth hardening pass, 0043 and 0044; the test plan with mutation targets; the security table; estimates; risks; questions for the user.
- Probes P54 to P56 (no model): `probes/p_checks_lib.mjs`, `probes/p54_report_samples.mjs`, `probes/p55_xml_parsers.mjs`, `probes/p56_zero_tests.mjs`; results in `notes/probes-checks-design.md` and a section of `probes/RESULTS.md`; evidence in `probes/out/p54_*` to `p56_*` (sanitized: no host name, user name or home path).
- One row for 0045 in `docs/README.md`.

## Account

- Inputs read: 0041 and 0042 in full; 0040 sections 6 and the consequences; 0043 and 0044 for the shared files; the review code named in 0045 section 1.
- Checks run: vitest, cargo test, cargo nextest and Gradle (offline) on throwaway projects; the parser cases in separate Node processes, among them a generated 200 MB report; the zero-test cases of each tool. fast-xml-parser came from the local npm cache with `npm pack --offline`; sax was not in the cache and was not tested (saxes is its successor).
- Not available offline: pytest (not installed), Maven surefire (plugin not in the local repository), jest with `jest-junit`. Their formats are from the documentation.
- Longest step: the record. The Gradle run took about 14 s per case with `--no-daemon`.
- No app code changed, no test suite or build run, no git command that changes the tree, no model calls.
- Shared files: one section appended to `probes/RESULTS.md` (P54 to P56, after P50 to P53; P45 to P49 stay with the R21 run) and one row added to `docs/README.md`, each re-read right before the edit.
- Disk: 11 GiB free at the start and at the end. Gradle wrote its usual run files below the user's Gradle home (offline, no download).
- Leftover: `/tmp/agide-checks-design/` (about 257 MB: the throwaway projects, the generated 200 MB report and the unpacked fast-xml-parser) could not be removed: the permission system denied the removal. No process uses it. It needs removal by the coordinator.
- Not finished: no independent review from inside this run; the record is `proposed` and waits for the review and the user's answers.
