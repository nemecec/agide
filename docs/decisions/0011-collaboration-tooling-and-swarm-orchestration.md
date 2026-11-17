# 0011 Collaboration tooling and swarm orchestration: design

Status: proposed
Date: 2026-11-17
Proposed by: spike agents, pending user confirmation (0007)
Inputs: 0001, 0003, 0004, 0006, 0008 (R17, R18), 0009, 0010, `notes/collaboration-tooling.md`, `notes/swarm-orchestration.md`, and the review corrections in each

## Context

R17 (0008) makes Jira, Slack, GitHub and Notion first-class: the user views the object in the tool, the agent reads and acts on it, a task starts from it, the agent directs the user to it, and outward actions follow the R19 policy. R18 asks that the user, or an agent through the app's MCP server, can start a group of agents for a goal with a model and effort tier each, a budget, steering and stopping per agent or group, and isolated workspaces.

0001 limits the means: the unmodified `claude` CLI under the user's login, no Agent SDK, no stored Jira tokens. The reviewed research found that the agent half of R17 works on every base today through claude.ai connectors and `gh`, and that Claude Code offers most R18 primitives; the app adds the human views, the gate, the swarm definition and the budget accounting.

## Decision

### 1. Collaboration tooling per service

| | Jira | Slack | GitHub | Notion |
|---|---|---|---|---|
| Agent access | claude.ai Atlassian connector (read call probed in both launch paths; write tools listed, not exercised) | claude.ai Slack connector (not probed) | `gh` with the user's login; `gh api` for inline comments | claude.ai Notion connector (not probed) |
| Human view | browser surface on `<site>.atlassian.net/browse/KEY`, partition per service | Slack web client in a browser surface; no scripted reading of its page | browser surface on the PR, or a native PR screen from `gh --json` | browser surface on the page |
| Start task from object | key or URL; the prompt tells the agent to read the issue and its links | permalink; the prompt tells the agent to read the thread (URL format unverified) | PR URL: `gh pr view --json`, worktree for the head ref, PR text, threads and failing checks as context | page URL; the prompt tells the agent to fetch the page and comments (URL format unverified) |
| Observation | recognized key from the URL or title (0006 section 8) | off by default (0006 section 5); when the user switches it on, channel and thread from the URL, and the agent reads the text through the connector | owner, repo and number, or run and commit ids | page id from the URL |
| Outward-action approval (default mode, 0010) | comment, transition, assignee change, issue create in a shared project: draft; reads: allow | send and schedule: draft, always; reaction: notify | comment and review comment: draft; review submit, merge, push to a shared branch, release, workflow dispatch: approve | edit of a shared page, delete, move, comment with mentions: draft; private draft page: notify |

Common rules:

- Connectors are authorized in claude.ai; the launch path never authorizes one. The app reads `mcp_status` to show each connector's state and links to claude.ai connector settings. For servers configured in Claude Code itself, `claude mcp login <name>` works from the shell.
- The app writes no MCP entries for these services' endpoints: a Claude Code server at the same URL as a claude.ai connector hides the connector.
- Under an organization claude.ai account, admins can mark connector tools `blocked` or `ask`, enforced locally; this sits above the app's gate (question in 0007).
- Atlassian: the connector notice says the v1 endpoint is removed on 2027-03-01; Atlassian's support pages say v1 use then moves to v2 tools automatically and do not say the endpoint is removed (0004). The user replaces the v1 connector with the v2 connector before that date (0007). The v2 tool names are not verified, and the action table for Jira is rebuilt from the v2 tool list.
- Slack's draft tools say they draft and preview in the AI client; whether a draft is saved in Slack is not stated, so the app's own draft dialog is the approval point.
- Linear follows the Jira pattern when added; Discord stays outside the first release (0006).

### 2. Orchestration primitives

| Need | Primitive used | Status |
|---|---|---|
| Start one agent | a `claude -p` stream-json process per agent, started by the app | probed |
| Start a group inside a session | Agent tool (parallel calls); Workflow tool in `-p`, gated by `can_use_tool` | probed (P5) |
| Model and effort per agent | `--model`, `--effort` per process; subagent frontmatter; `CLAUDE_CODE_SUBAGENT_MODEL` with `_FORCE=1` for native subagents | docs |
| Budget | `--max-budget-usd` and `--max-turns` per process (client-side estimate that can overshoot); swarm total from `result` events | docs; per-call cap used in the probes |
| Steer | a user message on stdin of the agent's process; `SendMessage` and cross-session messaging (`crossSessionInbound=accept` in `--settings`) | stdin multi-turn probed; the rest docs only |
| Stop one or the group | interrupt control request or process kill; `TaskStop` and stop-task for native subagents | interrupt probed; the rest docs only |
| Isolated workspace | a git worktree per agent created by the app; subagent `isolation: worktree` branches from the default branch, not the parent HEAD | docs only |
| Observe | 0009 | probed |
| Approvals from a swarm | requests that would prompt reach the parent as `can_use_tool` with `agent_id`; the 0010 gate covers the rest | probed in manual mode |
| Background sessions | `claude --bg`, `claude agents` with `--model`, `--effort`, `--permission-mode`, `--mcp-config`; no `-p`, so no stream-json and no budget cap | docs only; fallback for long runs |

Agent teams are not used: experimental, interactive only, no per-teammate permission mode. Native workflows stay available inside sessions; individual workflow agents cannot be steered and stop only from the `/workflows` screen, so app swarms use process-per-agent.

### 3. The app's swarm definition

A swarm is a definition the user or an agent writes, stored in the app database with the project:

```yaml
goal: text
policy: <project review policy, 0010>
budget: { usd_total, usd_per_agent, max_turns_per_agent, wall_clock, review_allowance }
agents:
  - name: api
    role: worker          # worker | reviewer | merger
    tier: mid             # strong | mid | small
    prompt: text
    workspace: worktree   # worktree | shared-readonly
    owns: ["src/api/**"]
    depends_on: []
```

The app validates file ownership before start (overlapping `owns` sets are rejected or serialized with `depends_on`), creates the worktrees and starts each agent with `--model`, `--effort`, `--max-budget-usd`, `--max-turns`, `--permission-mode` from the policy, `--session-id`, the sandbox settings and an `--mcp-config` URL that carries the swarm and agent id. A swarm under `bypassPermissions` is refused unless the policy allows it.

App MCP tools, scoped by the caller's token: `swarm_start`, `swarm_status`, `swarm_send`, `swarm_stop` (one agent or the group), `swarm_result`, `swarm_budget`, and `swarm_merge`. Workers see only their own swarm's status and results. Start, stop and merge need the parent role, and `swarm_start` and `swarm_merge` from an agent pass the 0010 gate. Merge is not part of R18 as 0008 states it; it stays in the design because a swarm's changesets reach the user's branch only through it, after their 0010 review.

### 4. Tiers and budgets (0003)

| Tier | Model and effort | Default role |
|---|---|---|
| strong | most capable model (`fable`), high or xhigh | reviewers, mergers, hard design work |
| mid | a mid-tier model, medium | workers that read code and research |
| small | Haiku, low | mechanical work |

One app table maps tiers to model names, so a model change touches one place. Budgets:

- per agent: `--max-budget-usd` set below the real limit, `--max-turns`;
- per swarm: the sum of `total_cost_usd` from `result` events; between results the app estimates from token counts and a price table, since `task_progress` carries tokens only. At the cap the app refuses new starts and stops running agents;
- review allowance: a share of the budget that workers cannot spend, so reviews keep their place as the largest spend;
- subscription limits: dollar figures are estimates under a subscription, so the app also shows `rate_limit_event` data, pauses the group on a limit event and caps concurrent agents.

## Consequences

- R17 for greenfield is 1 / 17 days and R18 is 1 / 14 days in 0005 (low confidence); the R17 figure includes the layered outward gate from 0010.
- The tool depends on the user's claude.ai connectors and their authorization state; the app shows that state and cannot repair it.
- Parallel agents share one subscription's limits and can slow the user's own sessions. Anthropic's legal page says advertised plan limits assume ordinary, individual usage of Claude Code; whether an app-run swarm fits that is not stated there (user decision in 0007).
- Not verified: connector write calls; whether permission rules and `can_use_tool` match `mcp__claude_ai_*` names in a run; the Atlassian v2 connector's tool names; Slack and Notion URL formats; Google sign-in inside an Electron partition; Slack Acceptable Use Policy and the Atlassian, Notion and Discord terms on embedded browsing; `SendMessage`, stop-task and `isolation: worktree` in a run; subagent inheritance of the app server from `--mcp-config`; `claude agents` and `--bg` under the subscription; subscription rate-limit values.
