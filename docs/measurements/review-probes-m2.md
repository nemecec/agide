# review-probes-m2

Start: 2026-11-17 15:25:15 UTC (date -u). End: 2026-11-17 15:38 UTC (date -u). Wall time about 13 minutes.

Independent review of the milestone 2 probes P11 to P15 (`notes/probes-m2.md`, the new section of `probes/RESULTS.md`, the scripts and the logs in `probes/out/`).

What I did: read the scripts and every report and hook log; re-ran P11, P12 `basic` and `atomic`, P13, P14 `nokey`, `esc_vs_allow` and `enter_vs_deny`, and P15 `log_only` and `accept` against the real CLI on Haiku in fresh directories under `probes/work/`; compared the claims with the hooks and status line docs and with 0009, 0014, 0016 and 0019; searched tracked and new files for absolute user paths. The re-run results reproduced. Re-run logs are in `probes/out/m2-review/`; the builder's logs stay directly under `probes/out/`. The temporary directories of the re-runs were removed.

Corrections made: the status line `refreshInterval` does not bring new rate-limit values; the status line cost includes subagent requests (inferred from P13 totals); transcript sums undercount the session because internal agents leave no file, and `cost-state` at exit carries the process total; background subagents end the main turn with `Stop` before their results return; the multi-block message in P13 had two tool_use blocks, not a text block; `exceeds_200k_tokens` is top-level; P13 runs in `acceptEdits`; the PTY runs have no budget cap; the trust answers add entries to the user's Claude config; the late `PostToolUse` did not reproduce; the P6 "no dialog" statement corrected in the stage 2 notes and in `RESULTS.md`; counts removed from prose; a dead line removed from `p13_transcript_usage.py`.

What took long: the P11 idle wait (about 80 s) and the P14 cases.

Not done: P12 `refresh` and `precedence` and P14 `timeout` were not re-run. A per-request check of the status line cost against subagent requests. The status line docs' cancellation of an in-flight command is not tested.

Sandbox: no step was blocked. Docs were fetched from the public Claude Code documentation site.
