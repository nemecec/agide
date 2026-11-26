# decisions-amend

Start: 2026-11-26T18:48:45Z
End: 2026-11-26T19:33:00Z

## What this run did

Turned the user's answers of 2026-11-26 to the questions of 0043, 0044 and 0045 into accepted records:

- 0043: status accepted; a section "Decisions of the user" (B1 to B8, A1 as an input) and open questions. Amendments: the reminder when a held hook approval goes back to the terminal (section 4.2); session summaries on the session's row in the tree, out of the inbox card and `inbox_context` (sections 3, 4.7, 4.9); loopback for hooks under the CLI's Bash sandbox with the accepted risk, the per-profile switch and per-port loopback as later hardening (sections 2, 3, 4.1, 7, 9, 10, 11); the shared access request mechanism (section 4.10: types, store, grants, flow, scopes, commands, card, chip, builder w-access, tests, security rows); new estimates; c-m6 adds the slots that 0044 needed; the start waits for the ninth hardening pass.
- 0044: status accepted; decisions C1 to C7 and open questions. Amendments: `note_edit` in the first slice with base revisions, the rebase rule and `stale`; `agentWrites` is `apply`, `review` or `none`; access requests for note reads, changes and removals and for mount reads and writes; `mount_write` with the user's read-write switch left alone; the adaptive watcher with two tiers, the entry count and hysteresis; tests, security, risks, estimates; the builder order aligned with 0043.
- 0045: status accepted; decisions D1 to D6, all as recommended; the start-dialog offer of the fix swarm that the recommendation of D5 named (`review_base_verdict`, `BaseChecks.verdictsOfCommit`); the references to the hardening pass moved to the ninth pass.
- `docs/README.md`: the rows of 0043 to 0045.
- Probe P57 (node only, no model): costs and latencies of the adaptive watcher; a section in `notes/probes-m6-notes.md` with the script, and a summary in `probes/RESULTS.md`.
- The changed SQL of 0043 (`access_requests`) and 0044 (`agent_writes`, the `edit` proposals) was checked against `node:sqlite` in Node 22.

## What took long

- Fitting one access request mechanism to the existing pieces (browser approvals, `inbox_ask` delivery, folder scope, parity) and deciding, per action, which scopes make sense and which refusals no request may lift.
- Keeping the three records consistent: every sentence about the file transport for Bash-sandbox profiles, summaries in the inbox, the deferred `note_edit`, the removal guard that refused, and the fixed watcher timings.

## What is not done or not verified

- The temporary directory `/tmp/agide-amend/` (the P57 script, three result files, the SQL check script, an empty `work/`) is left for the coordinator: the permission system denied its removal.
- The P57 script is not in `probes/` (this run could add files only under `docs/measurements/`); it is reproduced in the notes.
- `docs/README.md` outside the rows of 0043 to 0045 still says "P50 to P53 in `../notes/probes-m6-notes.md`" in the probe paragraph; it should name P57 as well.
- Not verified: whether the CLI merges `allowedDomains` of a `--settings` file with the user's list; whether a sandboxed command reaches loopback directly or only through the sandbox's proxy; the port form `127.0.0.1:<port>` under the CLI's own sandbox. These are listed in 0043.
