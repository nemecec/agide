# review-swarm-probes

Start: 2026-11-21T06:35:15Z (date -u). End: 2026-11-21T06:41Z (date -u).

## Done

- Independent review of `notes/probes-m4-swarm.md` and the milestone 4 section of `probes/RESULTS.md` against the reports and logs in `probes/out/`, the scripts, the headless docs, the permission-mode docs and the SDK approval docs, and decisions 0011, 0012 and 0025.
- Re-ran, one process at a time: `node probes/p37_bare.mjs`, `node probes/p35_budgets.mjs after_budget`, `node probes/p31_interrupt.mjs pending_permission_control`. All three reproduced the recorded results. The re-runs replaced the matching files in `probes/out/`.
- One extra haiku run in a directory under `probes/work/` whose name held `_`, `.` and a space, to check the session-file directory rule; the directory, the matching project folder in the config dir and the temporary script were removed afterwards.
- Corrections in both files: the session-file directory rule, the budget-crossing behaviour, the plain-json budget statement, the P31 pending-approval tool result, the P34 cost column (cumulative), the decision cited for the pause rule, the user-settings `defaultMode` effect on `-p`, an unprobed auto-mode gap and the review status.

## Account

- Real-Claude spend of the review: about one cent.
- Disk: about 10 GiB free throughout.
- Not checked: P32, P33, P34 and P36 were not re-run (checked against their logs only); P34 needs three concurrent processes.
