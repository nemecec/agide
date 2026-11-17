# 0019 Token and plan usage visibility

Status: proposed (requirement stated by the user; weight and design await confirmation)
Date: 2026-11-17
Decided by: Neeme (swarms run on the subscription; usage must be easy to see); the design direction is an agent proposal
Amends: 0008 (adds R24)

## Context

Swarms run on the subscription login (0012), and Claude Code can start swarms by itself. The user wants an easy way to see token usage, especially which session is consuming tokens most actively.

Data the CLI already exposes (probes and the status line docs, https://code.claude.com/docs/en/statusline):

- stream-json `result` events carry usage and an estimated total cost (`probes/RESULTS.md`); `task_notification` carries usage for a finished background task (0009).
- The interactive session has no cost field in its output, but the transcript JSONL carries usage per assistant message, and subagent transcripts do the same.
- The status line command receives JSON on each update with `cost.total_cost_usd` (estimated client-side at list price, which can differ from the bill), token counts in `context_window`, and, for claude.ai Pro, Max and Ultra subscribers, `rate_limits.five_hour` and `rate_limits.seven_day` with `used_percentage` and `resets_at`. The rate limit fields appear after the first API response of a session. They are account-wide, so they belong to a profile (0017).

## Decision

- R24 Usage visibility. Weight 2 is proposed.
  - The app collects usage from three sources and normalizes it per session and per agent: transcript usage records (all launch paths, including subagents), stream-json results and task notifications, and a status line command that the app supplies through `--settings` and that writes the received JSON to the session's events directory.
  - Rates: tokens and estimated cost per minute over a sliding window, kept as ring buffers per session, agent, swarm and profile. The window length and the weighting of output, input and cache tokens are settings.
  - Views, all as blocks (R20): a ranking of the sessions and agents consuming most actively right now; a heat marker on each tree node and a rollup on folders, swarms and profiles; per-profile plan usage (5-hour and 7-day percentages with reset times) shown in the profile switcher (0017) and a forecast of when a window runs out at the current rate.
  - Alerts go to the inbox (R21): a session or swarm above a rate threshold, or a plan window crossing a threshold. The item offers actions: pause or stop the session or agent, or switch to a cheaper model tier (0003).
  - Labels state what a number is: cost is an estimate at list price, plan usage is a percentage of a window and not a token count.

## Consequences

- A rough guess is 5 to 8 working days after the event normalizer of 0009 exists; low confidence.
- Probes to run: the status line command through `--settings` in the interactive session and whether the user's own status line setting is replaced under `--setting-sources user`; how often the status line fires and whether `rate_limits` appears in the interactive session; usage fields in subagent transcripts; whether usage from a session-started workflow rolls up to the parent session or only appears in the workflow's agent transcripts.
- The concurrent-agent cap of 0012 defaults to 4 and is shown next to the usage ranking.
