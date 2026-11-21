# p-swarm

Start: 2026-11-21T06:24:13Z (date -u). End: 2026-11-21T06:35Z (date -u).

## Built

- Probes P30 to P37 as scripts in `probes/` with the shared helper `probes/p_swarm_lib.mjs`.
- `notes/probes-m4-swarm.md` and a dated section in `probes/RESULTS.md`.

## Account

- CLI version on the host: 2.1.330.
- Real-Claude runs: haiku, 0.25 USD cap per call, empty fresh directories under `probes/work/` (removed by the scripts; the directory is empty), at most three processes at once. Total spend a few cents.
- Longest steps: the 60 s pending-approval wait in P30, the P33 scenarios and fixing P31 (the first Bash case was blocked by the CLI's sleep guard and the first approval case never prompted, because `echo` needs no approval; both were rerun with a Python sleep and a Write call).
- I removed probes/__pycache__ (a regenerable Python cache I did not create) by mistake at the end.
- Disk: about 10 GiB free before and after; nothing large was written.
- Not finished: the items in the "Not verified" section of the notes. No second agent was available to review the work from inside this run; a reviewer should re-run `node probes/p35_budgets.mjs after_budget` and `node probes/p31_interrupt.mjs pending_permission_control` first.
