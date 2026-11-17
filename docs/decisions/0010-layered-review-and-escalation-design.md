# 0010 Layered review and risk-based escalation: design

Status: proposed
Date: 2026-11-17
Proposed by: spike agents, pending user confirmation (0007)
Inputs: 0003, 0008 (R17, R19), 0009, 0011, `notes/review-prior-art.md`, `notes/review-ladder-design.md`, `notes/review-features-candidates.md`, `notes/collaboration-tooling.md` section 4, and the review corrections in each

## Context

R19 (0008, weight 3) asks for a risk assessment with stated reasons per unit of agent work, an escalation ladder from automatic checks to a human reading the lines, a policy per project, views of the same work at several levels with drill-down, and a record of every assessment, escalation and outcome. R17 adds that outward-facing actions in Jira, Slack, GitHub and Notion follow the same approval policy.

Prior art (Meta's Diff Risk Score, just-in-time defect prediction, CodeRabbit, Greptile, Qodo, Bugbot, Claude Code review, the AI control literature) labels single PRs; none aggregates a swarm or maps risk to a reviewer ladder. No candidate base has a per-changeset risk model or a policy-driven ladder (0005). The design below is checked against the Claude Code docs and the probe logs. An approval callback alone misses every call that auto mode approves, so the gate in section 6 has layers.

## Decision

### 1. Units and levels of abstraction

The unit of review is a changeset: the diff of one run's worktree from its base commit to a checkpoint commit the app makes at turn end. The app waits until the `Stop` payload's `background_tasks` is empty before the checkpoint, or snapshots per subagent at `SubagentStop`. An outward action (a post, comment, transition, push, merge, page edit) is its own unit.

| Level | Shows | Seen when |
|---|---|---|
| Goal and outcome | goal, plan, swarm tree, outcome summary, rolled-up reasons, outward actions, spend, accept state per changeset | summary kept on screen for the policy minimum, or marked read |
| Agent (run) | task, tier, the run's own report, timeline, errors, denials, files against task scope, its changesets | run report opened, as above |
| Changeset | rung, reasons, app-run check results, reviewer findings, summary, files | summary seen; decision recorded |
| File | diff, file reasons, findings, history signals | all its hunks seen |
| Hunk | the hunk with findings and a line-comment box that returns comments to the agent in a batch | in view for the policy minimum, or marked seen |

Each level rolls up the highest rung below it. Seen marks bind to content hashes and lapse when the agent changes the content. Every summary shows its author (reviewer agent or working agent).

### 2. Risk: reasons and signals

An assessment is a list of reasons, each with `id`, `source`, `evidence` and `min_rung`. The unit's rung is the highest `min_rung`, plus an accumulation rule: a policy number of reasons at one rung raises the unit by one rung, shown as its own reason. No score hides the reasons.

Signals, computable without a model unless marked:

- paths against policy globs and Claude Code protected paths; migrations, schema and contract files; dependency, lock, build and CI files;
- size and diffusion, also per run and per goal, so split changes do not hide;
- tests deleted, skipped or weakened; source changed without test change; app-run check results;
- secrets in added lines;
- history: earlier reverts or rejected changesets in touched files;
- run telemetry: retries, tool errors, denials, classifier blocks, spend against budget, files outside task scope;
- changes to `CLAUDE.md`, `.claude/settings.json`, skills, `.mcp.json`, test, lint or CI configuration, and the review policy;
- outward-action class, audience and reversibility, and secrets or customer data in outbound text;
- model-produced, raise-only: the working agent's report (confidence, unverified items), the reviewer's verdict and findings, disagreement between reviewers.

Hard floors: secrets, protected or policy paths, migrations and irreversible outward actions set a minimum rung that only the user can lower, with a recorded reason and a second confirm.

### 3. Who computes risk, and how self-grading is prevented

- Deterministic app rules set the base rung from inputs the app produces: `git diff`, its own run of the project's check command, stream-json or transcript telemetry, the hook log. An agent's claim that tests pass is not an input.
- The independent reviewer and the working agent can only raise the rung.
- The app reads the policy from the base commit or the main checkout, never from the run's worktree. Deny rules on the policy path and a blocking `PreToolUse` hook stop the built-in tools; the sandbox filesystem write-deny stops scripts that open the file themselves.
- The reviewer is a separate `claude -p` process in a read-only checkout of the checkpoint. It starts with `--setting-sources user` and the app's `--settings`, without the project's `CLAUDE.md`, so the working agent cannot steer or arm it through files in its own changeset. It gets the task, the diff of base..checkpoint as data, the app's check results and reasons, and the working agent's report as a claim to verify. It does not see the implementer's transcript. Findings must anchor to lines in the diff; others are dropped.
- Reviewer independence and review as the largest spend are product choices adopted from 0003, which governs the spike's own agents.

### 4. Escalation ladder

| Rung | Who reviews | Accept means |
|---|---|---|
| A automatic | app rules and checks | checks pass and no reason asks for more; listed in the daily digest; open to sampling |
| B reviewer agent | one independent reviewer agent | verdict accept and no finding at `important` or above; in the digest |
| C human summary | the user reads summary, reasons, checks and reviewer report | the user decides |
| D human targeted lines | the user reads the hunks that reasons and findings point to | every flagged hunk seen, then the user decides |
| E human line by line | the user reads every hunk | every hunk seen, then the user decides |

At C and above a reviewer runs first. From D a reviewer of another model family (Codex CLI) runs when the policy enables it, with disagreements marked. Default triggers (policy overrides): size or missing tests to B; dependency, CI or weakened tests to C; sensitive paths and migrations to D; secrets and policy or protected paths to E; reviewer disagreement and an earlier revert in a touched file raise one rung; failed checks and a "fix" verdict send the work back until the retry limit, then C. A merge into a protected branch is an outward action at least as high as the changesets it carries, and the app refuses it while any of them lacks an accept at its rung.

Reviewer tier: the most capable Claude model (`fable` per the model-config docs) at high effort on B and xhigh on C to E, or `opus` on B for cost (user decision in 0007). The reviewer is never below the working agent's tier. A daily review budget applies; when it runs out, units queue for the human and are never accepted automatically. Under the subscription login the budget is an estimate, so the app also tracks `rate_limit_event`.

Sampling: a policy fraction of A-accepted units goes to a reviewer and of B-accepted units to the human. A miss is attributed to the rule or reviewer that accepted the unit, raises sampling for a while, and produces a suggested policy change. Later reverts of accepted changesets count as misses. The user can escalate freely and must give a reason to demote; an agent can request escalation through the app MCP server, never demotion.

### 5. Per-project policy

A policy per project sets the tier, check command, retry limit, path globs, thresholds, rung overrides per reason id, reviewers, sampling and the outward-action modes. A user-level policy can only tighten it. Where it lives (a committed file or an app-side store) is a user decision in 0007; a committed file is read from the base commit. Example:

```yaml
version: 1
project_tier: production
check_command: ./gradlew check --offline
retry_limit: 2
paths:
  sensitive: ["**/auth/**", "infra/**", ".github/workflows/**"]
  migrations: ["**/db/migration/**", "**/*.avsc", "**/*.proto"]
thresholds: { small: { lines: 150, files: 8 }, large: { lines: 600, files: 25 }, stack: 3 }
rungs: { path.sensitive: D, deps.changed: C }
reviewers: { primary: { model: fable, effort: high }, second_family: { cli: codex, from_rung: D }, daily_budget_usd: 20 }
sampling: { automatic_to_reviewer: 0.10, reviewer_to_human: 0.05 }
outward: { slack.post: draft, jira.comment: draft, github.merge: approve, notion.create_private: notify, deploy: deny }
```

The thresholds are untested starting values.

### 6. Approval of outward-facing actions

Each action class has a mode: `allow`, `notify`, `draft` (the user sees and can edit the exact payload, then approves), `approve` (no edit; merges, pushes to shared branches, deletes, deploys) or `deny`. Outward actions skip rungs A and B; every draft or approve decision is human. Secrets or customer data in outbound text force `approve`. Unknown MCP write tools default to `draft`.

The gate has layers, because `can_use_tool` and the `PermissionRequest` hook see only calls that would otherwise prompt, and the user's default mode is `auto`:

- explicit `ask` rules for every outward tool, which force a prompt in auto mode; connector tools are named `mcp__claude_ai_<server>__<tool>`;
- a `PreToolUse` hook that runs for every call, maps it to a class and records it;
- `can_use_tool` (stream-json) and the `PermissionRequest` hook (PTY) to show the draft or approval dialog; an edited draft returns through `updatedInput`, which Claude Code re-evaluates against deny and ask rules;
- the sandbox network allowlist as the guarantee for CLI writes, since command patterns (`gh pr merge`, `git push`) miss programs called by path, inside `sh -c` or from scripts.

Per-service classes are in 0011.

### 7. Claude Code primitives used

`--permission-mode` per launch; `ask` and `deny` permission rules; `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop` and `SubagentStop` hooks from `--settings`; `can_use_tool` over stdio; `Stop` with `decision: "block"` to send work back (capped at 8 consecutive continuations; checks `stop_hook_active`); app MCP tools `report_outcome` (working agent) and `report_review` (reviewer, schema modelled on `ReportFindings`); `/code-review` in the reviewer with an explicit range; stream-json `result` events for cost; `mcp_status` for the connector list; the sandbox for filesystem and network limits. Files passed with `--settings` and `--mcp-config` are protected by Claude Code at session start.

### 8. Failure modes

| Failure | Mitigation |
|---|---|
| Reviewer agrees with the implementer | no transcript sharing; report treated as a claim; second family from D; human sampling of reviewer accepts |
| Agent games signals (splits changes, weakens tests, edits checks or policy) | size per run and goal; test and config changes are reasons; policy from the base commit; app runs checks |
| Agent arms its own reviewer through project files | reviewer with user and app settings only; those files are hard-floor reasons |
| Auto-approved calls bypass the approval callback | ask rules, `PreToolUse` hook, sandbox allowlist |
| A gating hook times out | a timed-out `PreToolUse` hook lets the call through; ask rules and the sandbox carry the guarantee |
| Prompt injection in diffs | content marked as data; reviewer without write or network tools; anchors validated; raise only |
| Alert fatigue, or a user who demotes everything | digest for A and B; queue by rung; dwell times and demotions shown to the user; per-rule audit hit rates |
| Review spend runs away | daily budget; queue for the human when spent |
| Organization controls on connector tools override the gate | shown as connector state; outside the app's control |

### 9. First useful slice

One project, the stream-json path: the outward gate with the class table, ask rules, `PreToolUse` hook and draft dialogs; changeset capture at turn end with app-run checks and rule reasons; changeset, file and hunk views with hash-bound seen marks and accept, reject and send-back; a rung B reviewer process reporting through `report_review`; a policy parser for paths, thresholds, rungs and outward modes. About 9 days, of which about 3 are the outward gate counted under R17. Goal and agent views, sampling, the second-family reviewer and the PTY path come later.

## Consequences

- Greenfield R19 is 1 / 29 days in 0005 (low confidence); the figure includes the checkpoint and check executor, digest and queue, summary generation, the `report_outcome` loop, the merge gate and reviewer settings isolation.
- The gate depends on behaviour documented and not probed: ask rules on connector tool names in auto mode, `updatedInput` through the hook (and, unconfirmed, through `can_use_tool`), `PreToolUse` precedence. The permissions and hooks docs state each of them (an ask rule prompts in auto mode, shown there with a Bash rule, and after a hook `allow`; `updatedInput` is re-evaluated against deny and ask rules; a timed-out `PreToolUse` hook does not block). Stage 2 probes them before the gate is relied on (0007).
- Ask rules and the action table match on tool names. A connector whose tools change, or that exposes one generic execute tool, needs the class decided from the call input in the `PreToolUse` hook; the Atlassian v2 connector may be such a case (0004).
- The sandbox becomes part of every agent launch the app makes.
- Not verified: `/code-review` with an explicit range reporting through an app tool; whether `--setting-sources user` suppresses the project `CLAUDE.md`; MCP `readOnlyHint` as the read/write signal for unknown tools; whether a subagent's isolation worktree exists at `SubagentStop`; the Codex CLI as second reviewer.
