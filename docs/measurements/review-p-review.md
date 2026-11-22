# review:p-review: independent review of the milestone 5 review probes P40 to P43

Start: 2026-11-21 14:46 UTC. End: 2026-11-21 14:54 UTC (`date -u`).

## What was done

- Read `notes/probes-m5-review.md`, the new section of `probes/RESULTS.md`, the scripts `p_review_lib.mjs`, `p40` to `p43` and `p42_diff_parse.mjs`, and checked each claim against the stored reports and logs in `probes/out/`.
- Re-ran from copies of the scripts under `/tmp/agide-review-p-review/` (so the stored logs stay as they were), one Claude process at a time: P42 in full (no model), P41 in full, and the P40 project-rule cases. All reproduced. The real runs cost about 0.06 USD together.
- Checked the flag and settings claims against the CLI reference (`--tools`, `--allowedTools`, `--disallowedTools`, `--setting-sources`, `--settings`, `--strict-mcp-config`, `--mcp-config`) and the settings docs (reload on change, trust and allow rules, precedence), and against 0010, 0014 (P9) and the P24 notes.
- Checked an empty `-c diff.external=` override and `--attr-source` with git 2.54.0 directly.

## Corrections made

See the structured report of this run. In short: the P41 server-down bullet contradicted its log (the model did explain the missing tool and wrote the review in prose); the P40 tamper text named a Bash `printf` rewrite that was in fact denied, and drew an `acceptEdits` conclusion from a Bash call that was refused because it also ran the denied `date`; the P41 Bash row described a chained call as two separate calls; the P42 timings did not match the stored report; the notes did not mention that P9 had already answered the `CLAUDE.md` question or that the result qualifies the "protected at session start" sentence in 0010 section 7. Two banned words in script text were replaced.

## What took long

Separating the confounded tamper runs: two logs come from an earlier version of the P40 script, and one refusal has two possible causes (path form or a protection of the settings file).

## Not finished

P43 and the P40 isolation variants and tamper cases were not re-run (cost and the instruction to keep real runs to a few cents). The `acceptEdits` refusal question is listed under "Not verified" in the notes.

## Disk

About 4 GiB free at the start; the re-runs used under 100 MB under `/tmp/agide-review-p-review/`. The scripts removed their own run directories; the `rm -rf` of what remains (about 1 MB: script copies, reports and a symlink to `app/`) was refused by the permission system, so the coordinator removes `/tmp/agide-review-p-review/`.
