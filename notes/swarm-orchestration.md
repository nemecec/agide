# R18 swarm orchestration

Date: 2026-11-17. Claude Code 2.1.326 for probes. Docs read: code.claude.com sub-agents, agent-teams, cli-reference (fetched today). Candidate code read from `candidates/` with Read and Grep only. Confidence is high where a probe or a doc page states the fact, medium for code reading, low where marked.

## 1. What Claude Code gives a host

| Need | Primitive | Source and confidence |
|---|---|---|
| Start a group | Per-session `Agent` tool (parallel calls in one message), `claude --bg` background sessions with `claude agents` (agent view), agent teams (experimental, env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, interactive only, not in `-p`) | Docs, high. P5 probe: two parallel subagents in `-p` stream-json, high |
| Per-agent model | Subagent frontmatter `model`, per-call `model` alias, `CLAUDE_CODE_SUBAGENT_MODEL` (+`_FORCE=1`), `--model` for a session, `--model` for dispatched sessions in `claude agents` | Docs, high |
| Per-agent effort | Subagent frontmatter `effort`, `--effort` (low to max) per session | Docs, high |
| Budget | `--max-budget-usd` (print mode only; spend from subagents counts toward it; estimate is client side and can overshoot), `--max-turns`, subagent `maxTurns` (output marked partial, resumable) | Docs, high. No per-subagent dollar cap found (medium) |
| Steer a running agent | `SendMessage` to an agent by id or name (also resumes a finished or stopped subagent in the background); in teams the lead and teammates message each other and the user can message a teammate | Docs, high. Not probed |
| Stop one agent | `TaskStop` tool, `stop_task` request in SDK-style streams, `claude stop <id>` for background sessions, interrupt control request (P1) | Docs, high; P1 interrupt probed, `stop_task` not probed |
| Isolate workspaces | Subagent `isolation: worktree` (temporary worktree from the default branch, not the parent HEAD, removed when unchanged; Bash and git commands that reach the main checkout are blocked), `claude --worktree <name or PR URL>` at `<repo>/.claude/worktrees/<name>` | Docs, high. Branch base and cleanup behavior with changes not probed |
| Collect results | Subagent result returns to the caller; `system/task_notification` events; `SubagentStop` hook with `last_assistant_message` and `agent_transcript_path`; transcripts under `<session>/subagents/agent-<id>.jsonl`; teams add a shared task list and mailbox files | P5 probe and docs, high |
| Observe | Stream-json events `system/task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed` (across the P5 runs; `p5_report_stream.json` has no `task_progress`, the approval and workflow runs do); in the PTY path hooks `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted`; `claude agents --json` lists background sessions | P5 for the first two groups, high. `claude agents --json` from docs only |
| Approvals from a swarm | Subagent permission requests surface in the parent; in stream-json they arrive as `can_use_tool` control requests, answerable by the host | P5 approval probe, high. Teammate prompts bubble to the lead, docs |
| Schedules | Cron tools (`CronCreate`), `/loop`, routines (cloud) | Tool list in this session; docs not read, low |
| Workflow tool | Runs in `-p` stream-json: the P5 probe ran two parallel agents, the host answered a `can_use_tool` request for `Workflow`, and `task_progress` carried `workflow_progress` with per-agent `agentId`, `model`, state and times. The workflows doc does not mark it experimental; it is on all paid plans, in `-p` and in the Agent SDK. Limits: no mid-run input to agents (no steering of one workflow agent), 16 concurrent agents by default, 1,000 per run, per-agent model set by the script, stop of one agent or the run only from the `/workflows` TUI, no usage-limit pause in `-p` | P5 probe, high; workflows doc (review), high |
| Cross-session messaging | A `claude -p` session binds an inbox socket (`messaging_socket_path` in init), appears in `ListAgents` and receives `SendMessage` from other sessions when started with `crossSessionInbound=accept` in `--settings`. Default inbound rules hold messages between bypass and non-bypass sessions | Docs (cross-session-messaging, via review), not probed |
| Background sessions | `claude agents` takes `--model`, `--effort`, `--permission-mode`, `--agent` and `--mcp-config` as defaults for dispatched sessions; `claude attach`, `claude logs`, `claude stop` manage them. `--bg` cannot combine with `-p`, so no stream-json and no `--max-budget-usd` | cli-reference (via review), not probed |

Measurements, 2026-11-17:

| Item | Value | Source |
|---|---|---|
| Default subagent nesting depth | 3 (env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`) | sub-agents doc |
| Default concurrent subagents | 20 (env `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) | sub-agents doc |
| Finished subagent stays listed | about 30 s | sub-agents doc |
| Suggested team size | 3 to 5 teammates | agent-teams doc |
| Max parallel subagent probe | 2 | p5_report_stream.json |

Constraints that shape the host design:

- Permission mode is inherited. Teammates start in the lead's mode, per-teammate modes cannot be set at spawn, and `bypassPermissions` propagates. Subagents can set `permissionMode`, but the parent's `acceptEdits`, `auto` or `bypassPermissions` overrides it. The app sets the mode explicitly (probe finding 4) and treats a swarm as running in the parent's mode.
- Agent teams do not run under `-p`. The app's `-p` launch path gets subagents and background tasks only. Teams need the interactive PTY path, and the host sees them through hooks and transcript files, not typed events (medium: the docs say so, the spike did not run teams).
- Messages between agents carry no user consent. The classifier treats an approval claim relayed by another agent as untrusted. The app's own approval flow (R19) stays the only approval authority.
- Subagent MCP scope: in-process teammates load MCP servers from project and user settings, so the app MCP server reaches swarm agents only if it is in the session's `--mcp-config`. Subagents inherit the MCP tools of the main conversation, filtered, and background subagents keep every MCP tool (sub-agents doc, via review). The doc does not name `--mcp-config`, so inheritance of the app server stays unverified, at lower risk.
- `--max-budget-usd` works only with `-p`. In the PTY path there is no cost field (P1b), so a cap there needs the app to read usage from transcripts and stop the session itself.

## 2. What the app adds

### Swarm definition

A swarm is a file the user or an agent writes, stored with the project and recorded in the app database:

```
goal: text
policy: ref to R19 policy (risk ladder)
budget: { usd_total, usd_per_agent, max_turns_per_agent, wall_clock }
agents:
  - name, role (worker | reviewer | merger)
    tier: strong | mid | small          # maps to model + effort through one table (0003)
    prompt, tools allow-list
    workspace: worktree | shared-readonly
    depends_on: [names]
```

The tier table is app configuration: strong maps to the most capable model at high effort for reviews, mid to a mid-tier model at medium effort for reading and research, small to Haiku at low effort for mechanical work. Changing a model name touches one table.

### Launch mapping

- Each agent is its own `claude -p` stream-json process (or PTY session) started by the app, in its own worktree, with `--model`, `--effort`, `--max-budget-usd <per-agent>`, `--max-turns`, `--permission-mode` set from the policy, `--session-id` chosen by the app, and `--mcp-config` pointing at the app server with the swarm and agent id in the URL (as the Nimbalyst design does per session).
- One process per agent gives the app exact control: per-agent budget, stop by process or `control_request` interrupt, steer by writing a user message to stdin (P1 multi-turn) and cost from each `result` event. Native subagents inside a session remain available to the agent for its own helpers and appear as grandchildren.
- Native teams are not the base mechanism. They are experimental, interactive only, share the lead's permission mode and cannot carry per-agent budgets.

### App MCP server tools (ties to R8 and R16)

Names follow the area prefix style of the existing app server design (`surface_*`, `workspace_*`):

| Tool | Effect |
|---|---|
| `swarm_start(definition)` | Validates against budget and policy, creates worktrees, starts the agents, returns swarm id |
| `swarm_status(id)` | Per-agent state (running, waiting approval, failed, done), spend, turns, changed files |
| `swarm_send(id, agent, message)` | Steering message to one agent |
| `swarm_stop(id, agent?)` | Stop one agent or the group |
| `swarm_result(id, agent?)` | Final message, branch, diff summary, risk assessment |
| `swarm_merge(id, strategy)` | Merge worktree branches in dependency order (below) |
| `swarm_budget(id)` | Remaining budget and projected spend |

Calls from an agent are scoped by the session id in the URL. A worker agent gets `swarm_status` and `swarm_result` for its own swarm only. Starting, stopping or merging requires the parent role, and `swarm_start` and `swarm_merge` from an agent go through the R19 approval flow like any outward-facing action.

### Tree presentation (R16)

- Each swarm is a folder node; agents are its children, each with status, spend and a running count on the parent. A native subagent inside a session appears under that session's node, built from `task_started` and `task_notification` events (stream-json) or `SubagentStart` and `SubagentStop` hooks (PTY). Finished nodes fade out after a short delay and stay in a history view that opens transcripts read-only from `agent_transcript_path` or the app's own log.
- Nimbalyst already models this (parent and manager columns, `descendantCount`, subtree archive); see section 4.

### Merging

- Workers write to separate worktrees and branches. Conflicts are avoided by file ownership declared in the definition (agent teams docs say overlapping files get overwritten) and checked by the app before start: two agents claiming the same path set are rejected or serialized with `depends_on`.
- `swarm_merge` merges in dependency order into an integration branch, runs the project's checks, and on conflict starts a merger agent (strong tier) with both diffs. The merged changeset gets its R19 assessment before it reaches the user's branch. Nothing merges to the default branch without the policy's escalation level.

## 3. Cost control (follows 0003)

| Control | Enforced by |
|---|---|
| Tier to model and effort | App tier table; app passes `--model` and `--effort`. For native subagents it sets `CLAUDE_CODE_SUBAGENT_MODEL` and, to stop a stray agent upgrading itself, `_FORCE=1` |
| Per-agent cap | `--max-budget-usd` and `--max-turns` on each process. The cap is a client-side estimate and can be exceeded, so the app sets it below the real limit |
| Swarm cap | The app sums `total_cost_usd` from each agent's `result` event, refuses new starts at the cap and stops running agents past it. `task_progress` usage has only `total_tokens`, `tool_uses` and `duration_ms`, so a running agent's spend in dollars is not observable mid-run; between results the app estimates from tokens and a price table |
| Reviews on strong, mechanical on small | Definition roles: reviewer agents default to strong, workers to mid, collection and formatting to small |
| Review share | Reviews are the largest spend by design (0003), so the budget has a separate review allowance that workers cannot spend |
| Subscription, not dollars | On a subscription the dollar figure is an estimate. The app tracks it as a relative meter and also tracks rate-limit events (stream-json carries `rate_limit_event`, seen in P5) |

Probe calls in the spike use Haiku with a per-call cap of 0.25 USD, so the pattern is already proven for one agent. The per-swarm sum is design only.

## 4. Candidate bases

- Superset: MCP tools `workspaces_create` (`checkout: worktree | local`, cloud workspace without `hostId`) and `agents_create` (agent preset, `prompt`, `model`, `effort`, `resumeSessionId`, host) exist in `packages/mcp/src/tools`; plus `agents_list`, `workspaces_list/update/delete`, tasks, hosts. `terminals_send` steers a running agent by the session id that `agents_create` returns, `terminals_close` stops it, `terminals_read` reads its screen; `workspaces_create` also takes an `agents` list. Budget, a group concept and group stop are missing. Every call, including calls for local host workspaces, goes through the vendor relay with an organization id and a bearer token (`packages/mcp/src/workspace-service-target.ts`). Whether the desktop app exposes a local MCP route is open.
- Emdash: tasks each own a git worktree (workspaces table, `compile-worktree-git-plan.ts`), several runtimes (ACP, TUI agents), parallel tasks are the product's headline. The app hosts no MCP server, so an agent cannot start or manage anything through the app (triage-emdash, section 6).
- Nimbalyst: host MCP endpoint with `create_session`, `spawn_session`, `send_prompt`, `list_queued_prompts`, `get_session_status`, `get_session_result`, `list_spawned_sessions`, `list_worktrees`, `consume_session_inbox`, `respond_to_prompt`, `notify_user`. Hierarchy columns `parent_session_id`, `created_by_session_id`, `worktree_id`, a manager that receives completion reports, per-manager spawn capacity reservations, a `blitz` container for parallel sessions across worktrees. It launches `claude` with `--model`, `--settings`, permission mode. `spawn_session` takes `model` (or `inheritModel`), `effortLevel`, `useWorktree`, `isolated`, `besideCaller` and `reporting` (`metaAgentServer.ts`); `send_prompt` with `interrupt: true` stops a child's current turn, but not for terminal-backed CLI sessions. No budget cap and no tool that kills a session or a group.
- VS Code: terminals via `createTerminal`, extension-owned tree and an extension-hosted MCP server (triage-vscode). Worktree creation and everything else are new code. No swarm concepts.
- Greenfield: all of section 2 is new, but the launch paths, the stream events and the app MCP server are proven by probes.

## 5. Scores

| Base | R18 | Effort to 3 (days) | Reason |
|---|---|---|---|
| superset | 2 | 7 | Start (`agents_create`, `workspaces_create` with agents), model and effort, steer (`terminals_send`), stop one (`terminals_close`), observe and worktree isolation exist. Missing: budget, group start and stop, and replacing or bypassing the vendor relay that every MCP call depends on. Low confidence |
| emdash | 1 | 15 | Worktree per task is solid, but no app MCP server (about 3 days alone, overlapping the R8 estimate), no spawn-from-agent path, no group or budget |
| nimbalyst | 2 | 6 | Closest: spawn with model, effort and worktree, send with interrupt, status, result, worktree list, manager relation, capacity limit exist. Missing: swarm definition, budget meter and caps, a session and group kill tool. Low confidence |
| vscode | 1 | 16 | Terminals and an MCP server are possible; all orchestration, worktree handling and tree state are new |
| greenfield | 1 | 14 | Everything new. Stream events, hooks, the app MCP server and the Workflow tool under `-p` are probed; worktree isolation, `SendMessage` and `stop_task` are docs only. Cost is highest on the process manager and budget meter. Low confidence |

Merge is outside R18 as 0008 states it and is not counted in these efforts; it stays in the design (section 2). The app MCP server cost is shared with R8.

## 6. Limits and risks

- Rate limits on one subscription: all agents share one login. Parallel agents drain the same limits, and a swarm of mid and strong agents can stall the user's own sessions. Mitigation: cap concurrent agents, prefer the small tier, surface `rate_limit_event` data in the swarm view, pause the group on a limit event. The exact limit values for the plan were not found in a primary source (not verified).
- Runaway loops: nested spawning (depth limit 3 and 20 concurrent by default for native subagents), agents that keep retrying, reviewer and worker ping-pong. Mitigation: per-agent turn and budget caps, a swarm-level cap on rounds of review, depth rule in the app (agents of a swarm cannot call `swarm_start` unless the definition allows it), wall-clock limit.
- Conflicting edits: separate worktrees prevent overwrites but not semantic conflicts. File ownership check before start and a merger agent after. Shared files such as lockfiles and generated code get a single owner.
- Permission inheritance: a swarm started under `bypassPermissions` runs all agents unchecked. The app refuses that mode for swarms unless the policy says so.
- Unreviewable volume: more agents produce more diff than the user can read, which is the case R19 covers. R18 hands each agent's result with a risk assessment to R19 and does not report a swarm as done before that exists.
- Experimental surfaces: agent teams and `--teammate-mode` change between releases. The app's own process-per-agent design depends on the stable parts (stream-json, hooks, MCP).
- Orphaned processes and worktrees after a crash: the app keeps a swarm record and reconciles on start. `claude --bg` has a supervisor that survives the app (`claude daemon status`, `claude stop`), which is an alternative for long runs (docs only, not probed).

## 7. Not verified

- Whether native subagents inherit an app `--mcp-config` server and whether a subagent can call `swarm_*` tools.
- `stop_task` and `SendMessage` against a real running subagent, and cost accounting per subagent in `-p`.
- Agent view and `claude agents --json` output shape; `claude --bg` under a subscription login in a PTY-less app.
- Worktree behavior of `isolation: worktree` when the repository has uncommitted changes or the default branch differs from the user's branch.
- Whether a workflow `agent()` call accepts effort or isolation options.
- A local Superset MCP route that bypasses the relay; anything about emdash automations as a swarm trigger.
- Real subscription rate limit values and how parallel `claude` processes share them.

## Review corrections

An independent review checked this note against the clones, the probe logs and the docs. Changes made:

- Superset has steer (`terminals_send`), stop one (`terminals_close`) and read (`terminals_read`); every MCP call depends on the vendor relay and account. Effort 9 to 7.
- Nimbalyst `spawn_session` takes model, effort and worktree; `send_prompt` interrupt gives a partial stop. Effort 8 to 6.
- Greenfield effort 18 to 14: merge is outside R18, the Workflow tool is probed under `-p`, background sessions take model, effort and `--mcp-config`, and the app MCP server is shared with R8. Isolation, `SendMessage` and `stop_task` are docs only.
- The Workflow tool is not experimental; its limits are listed in section 1.
- `task_progress` usage carries no dollars; the swarm cap sums `result` costs only.
- `p5_report_stream.json` has no `task_progress` event; the claim holds across the P5 runs.
- Added from the review: cross-session messaging, background-session defaults, subagent MCP inheritance from the docs, the worktree branch base.
- Also added: a `Workflow` launch goes through normal permission evaluation in `-p`, so the R19 gate can hold a swarm start; a Workflow agent's prompt is not user consent in auto mode.
- Teammates can have different models and in-process teammates take the definition's effort; the absence of per-teammate permission modes and of `-p` support still holds.
