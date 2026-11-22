# p-review: milestone 5 review probes P40 to P43

Start: 2026-11-21 14:18 UTC. End: 2026-11-21 14:46 UTC (`date -u`).

## What was built

Four probe scripts and shared helpers in `probes/`, a notes file `notes/probes-m5-review.md` and a dated section in `probes/RESULTS.md`:

- `p_review_lib.mjs`: fresh directories under `/tmp/agide-p-review/`, a one-shot stream-json run, and a Streamable HTTP MCP server with `report_review` on the official SDK.
- `p40_settings_isolation.mjs`, `p41_report_tool.mjs`, `p42_diff_parse.mjs` with `p42_checkpoint_diff.mjs`, `p43_injection_anchoring.mjs`.

Claude Code 2.1.330, git 2.54.0, Haiku, budget cap 0.25 USD per call, at most three concurrent processes. All real runs together cost a few cents.

## What took long

- P40: the first allow-rule test used a rule that never applied because project `permissions.allow` is ignored in an untrusted workspace under `-p`; finding that turned the probe toward project rules, hooks and deny rules. The tamper test depends on what the model decides to do, so it needed several runs and its result is stated as possible, not as a rate.
- P41: the server-side counters were shared by concurrent scenarios in the first version (one server per scenario fixed it); the schema violation had to be provoked through a length limit because the model follows enum and type constraints.
- P43: the first aggregation counted the wrong things (a regex that matched ordinary comments); fixed and re-run.

## What could not be finished

See the "Not verified" section of `notes/probes-m5-review.md`: user-level `CLAUDE.md` under `--setting-sources user`, `/code-review` with a range, sandbox effect on the settings file, larger models and other injection placements.

## Disk

Free space on the data volume was 4 GiB at the start of P42 and showed 3 GiB at the end (other agents also write there); the probes' largest temporary data was a 20 MB file. The temporary directory `/tmp/agide-p-review/` was removed completely.
