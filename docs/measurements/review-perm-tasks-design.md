# review-perm-tasks-design

Start: 2026-11-17 21:31 UTC. End: 2026-11-17 21:41 UTC (from `date -u`).

Independent review of `docs/decisions/0028-permission-model-and-task-start-design.md`.

What was done:

- Checked the permission claims against `notes/probes-m3-permissions.md`, `notes/probes-stage2.md`, `probes/RESULTS.md` and the Claude Code docs pages on permissions, permission modes, hooks, sandboxing and sessions.
- Checked the context section against the launch, hook, env, session module, text cleaner and profile tool-file code in `app/src`.
- Took the connector and built-in tool names from the `system/init` tool lists and tool names in `probes/out/` and compared them with the action class table.
- Checked `git worktree add -b <branch> -- <path> <commit>` and `git check-ref-format --branch` in a temporary repository (removed), and the `gh pr view --json` field names against gh's own field list.
- Edited 0028: added missing connector write tools and classes, writing `gh api` forms and other gh writes, package publishing, remote shell, outward built-in tools, an `mcp.other` class in line with 0010 section 6, documented answers for Q2, Q3 and Q6, the mod precedence caveat, the WebFetch allow rules in the strict allowlist, the wrapper list, PR data delivered as a file in place of typed text (the auto-mode classifier reads user messages), fetching the PR from the matched remote, validation of `<base>`, agent-text labelling in `task_start`, and the P8 misattribution.

What took long: reading the long docs pages for the classifier, mod and resume behaviour.

Not finished: no probes run; Q1 to Q7 stay open. Connector tool lists of other logins and later CLI versions were not checked.
