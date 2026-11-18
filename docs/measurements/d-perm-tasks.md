# d-perm-tasks

Start: 2026-11-17T21:22:56Z. End: 2026-11-17T21:31Z (from `date -u`).

## Work

Wrote `docs/decisions/0028-permission-model-and-task-start-design.md` from the reviewed P20 to P24 notes, 0010, 0011, 0012, 0021, 0022, 0025 and the session launch, profile, isolation and inbox code. Part 1 covers the mode setting per profile and session, the action class table with its ask rules, the `PreToolUse` command inspector, inbox items for asks, denials and sandbox blocks, the Bash sandbox with `strictAllowlist` as the network default on `local` and its effect on git over ssh, bypass inside isolating providers, open probes and the first slice. Part 2 covers task start from a prompt, a pull request and a Jira key: sources, folder and leaves, worktrees, folder-trust handling, the composed prompt with untrusted-data framing, the new-task dialog, the `task_start` command and the first slice.

## What took long

- Reading the launch code and the earlier records to place each setting where the code already keeps related state (profile settings, the session row, the `--settings` JSON).
- Working out which mechanism is the guarantee for each class, given that a failing hook lets calls through and the classifier approves per-command host lists without `strictAllowlist`.

## Not finished

- No code, no probes run. The open probes Q1 to Q7 and the unverified items are listed in the record.
