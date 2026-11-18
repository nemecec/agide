# review-perm-probes

Start: 2026-11-17 21:08 UTC. End: 2026-11-17 21:23 UTC.

Independent review of the milestone 3 permission probes P20 to P24 (`notes/probes-m3-permissions.md`, the P20 to P24 section of `probes/RESULTS.md`).

What was done:

- Read the scripts and checked every table row against the stream logs, hook logs and reports in `probes/out/`.
- Re-ran the Bash cases of P20, selected P21 and P23 cases, the invalid `--permission-mode` value and the `-p` trust case on Haiku with the probe settings; outcomes matched. Added a check of `sandbox.network.strictAllowlist`, which refuses the per-command `allowed_domains` list. The original files in `probes/out/` were backed up and restored after the re-run, since the scripts write unreduced paths; a reduced summary is in `probes/out/m3-review/perm_rerun.json`.
- Checked the claims against the Claude Code permissions, hooks, sandboxing and environment variable docs, and the trust lookup and `CLAUDE_CODE_SANDBOXED` in the strings of the installed 2.1.326 binary.
- Corrected the note and RESULTS: the classifier approves per-command host lists in auto mode, `strictAllowlist` as a lever, git over SSH fails on `known_hosts` (not on name resolution), plan mode does not attempt the calls, Esc also prints the not-trusted message, the source of the trust-false entry is not in the logs, TUI coverage of the P21 rows, the `matched_ask_rule` observation, the documented bare `Bash` ask rule exception under sandbox auto-allow and the fail-open hook timeout.
- Changed the ssh command in `probes/p23_sandbox.mjs` so it presents no key (`-F /dev/null`, `IdentityFile=none`); checked with `ssh -G` only.

What took long: reading long doc pages in parts and separating the effect of the user's own hooks from the probe hook in the logs.

Not finished: the TUI cases and the P24 dialog cases were not re-run; the temporary backup and helper files under the OS temp directory could not be removed (the removal command was denied).
