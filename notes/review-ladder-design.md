# Review ladder and outward-action approval (R19, R17)

Date: 2026-11-17. Inputs: decision records 0001, 0003, 0008; `notes/review-prior-art.md`; `notes/review-features-candidates.md`; `notes/collaboration-tooling.md` section 4; `notes/swarm-orchestration.md`; `probes/RESULTS.md` and `notes/probes.md`; the Claude Code hooks reference (fetched today, first part of the page only; the review read all of it). This note is design work for the later decision record that 0008 announces. Nothing here is built or run.

## 0. Units and terms

- **Run**: one agent session or subagent working on one task in its own worktree.
- **Changeset**: the unit of review. The diff of one run's worktree between the base commit and a checkpoint commit. The app makes the checkpoint commit when the run reaches a `Stop` or `SubagentStop` event, or when the user asks. The `Stop` payload carries `background_tasks`, and subagents can run in the background, so a checkpoint at `Stop` waits until `background_tasks` is empty, or the app snapshots per subagent at `SubagentStop`. Whether a subagent's isolation worktree still exists at `SubagentStop` is unverified. A run can produce several changesets; the review of a later changeset shows the diff since the last accepted one.
- **Outward action**: one tool call that leaves the machine (Slack post, Jira comment or transition, GitHub comment, review, push, merge, Notion edit). It is its own review unit with its own ladder (section 3.4).
- **Rung**: a level of the escalation ladder. Every changeset and every outward action gets exactly one current rung.
- **Review record**: an append-only log in the app's SQLite database. Every assessment, rung change, reviewer report, human view and decision is an event in it.

## 1. Levels of abstraction

The same work shows at five levels. Each level links down to the next and up to its parent. Risk reasons and the current rung show at every level, rolled up as the highest rung below.

| Level | What the UI shows | Drill-down | Recorded as "seen" |
|---|---|---|---|
| Goal and outcome | The goal text, the plan, the swarm tree with each run's state, the outcome summary (what was done, what was not, open questions), aggregated risk reasons, the outward actions taken and pending, the cost against budget, and the accept state of each changeset | Click a run | Summary opened and kept on screen for a minimum time set in policy, or "mark read" pressed. Stored with the hash of the summary text |
| Per agent (run) | Task, model and effort tier, the run's own end-of-turn report, a timeline of turns, tool errors, permission denials and classifier blocks, files touched against the task scope, changesets of the run with rung and reasons | Click a changeset, or open the transcript at a turn | Run report opened, as above |
| Per changeset | Rung, reasons list, check results (build, lint, tests, run by the app), reviewer findings with verdict and severity, a short changeset summary, list of files with per-file reasons and seen state | Click a file or a finding | Summary seen; decision (accept, reject, send back with comments, escalate, demote) |
| Per file | Diff of the file, file-level reasons (sensitive path, migration, test file weakened), findings anchored in it, history signals (prior reverts in the file) | Hunk navigation; findings jump to their hunk | File seen when every hunk in it is seen |
| Per hunk | The hunk in a diff editor, findings and reasons on its lines, a line-comment box whose comments go back to the agent as one batch | none | Hunk seen when it has been in the viewport for a minimum time, or "mark seen" pressed. Stored with the hash of the hunk content |

Rules for "seen":
- Seen marks bind to content hashes. If the agent changes a hunk after it was seen, the mark lapses and the hunk shows as unseen again.
- The record keeps who saw what, when, at which level and for how long. The app does not treat a summary view as a line review: at the line-by-line rung, approval stays disabled until every hunk in scope is seen.
- The user's approve-without-reading history (decisions made at the summary rung within seconds, or approvals at the line rung with short dwell times) is a context signal and shows on the user's own dashboard. It is information for the user, not a block.

Summaries at the goal, agent and changeset levels come from the reviewer agent's report and the working agent's report, shown side by side and labelled by author. The app does not show an agent-written summary without its author.

## 2. Risk assessment

### 2.1 Form: reasons, not a score

The assessment of a unit is a list of reasons. Each reason has:
- `id` (stable rule name, for example `path.sensitive`, `tests.weakened`, `checks.failed`),
- `source` (app rule, reviewer agent, working agent, user),
- `evidence` (file and line, check output excerpt, finding id),
- `min_rung` (the lowest rung this reason allows).

The resulting rung is the highest `min_rung` across reasons, with one accumulation rule: when the number of reasons at a given rung reaches the policy's `stack` threshold, the unit moves up one rung, and the UI shows "raised by accumulation" as its own reason. Nothing else combines the reasons. A user can read why a unit sits at its rung by reading the top reason. This follows the reasons-first presentation of Meta DRS and CodeRabbit (prior-art note section 1 and 2) and avoids an unexplained number.

Hard floors: secrets in added lines, writes to protected paths, an irreversible outward action and a schema migration set `min_rung` through the policy, and no other signal or reviewer verdict lowers it. Only the user can demote below a floor, with a typed reason that is recorded.

### 2.2 Who computes what

| Source | Signals | May lower the rung | Notes |
|---|---|---|---|
| App rules (deterministic, in the app process) | Paths against policy globs and Claude Code protected paths; size and diffusion; migrations, schema and contract files; dependency, lock, build and CI files; secret scan of added lines; tests deleted, skipped or with fewer assertions; source changed without test change; check results from the app's own run of the project check command; history (earlier reverts or rejected changesets in the file, from git and the review record); run telemetry (retries, tool errors, denials, classifier blocks, cost against budget, files outside task scope); outward-action class | Yes, it sets the base rung | Cheap, runs on every changeset. Reproducible: same inputs give the same reasons |
| Independent reviewer agent | Verified findings with severity; a verdict (accept, fix, rework); a risk label with reasons; disagreement with the working agent's report | No, raise only. An accept verdict closes the reviewer rung but does not lower a floor | Runs at the reviewer rung and above, and on audit samples |
| Working agent's own report | Confidence, assumptions, things not verified, decisions for the human, scope notes | No, raise only | Collected through an app MCP tool at turn end (section 5) |
| User | Manual escalate or demote | Yes, recorded with a reason | Section 3.5 |

### 2.3 Keeping the working agent from grading itself

- The assessment runs in the app, from inputs the app produces: `git diff` of the worktree, the app's own run of the check command in the worktree after the turn ends, the stream-json events or transcript, and the hook log. The agent's claim that "tests pass" is not an input; the app's check run is.
- The app reads the policy from the base commit or the main checkout, never from the run's worktree, so an agent edit to its own copy cannot lower the rungs of its own changeset (Bugbot reads its config from the PR's base branch for the same reason). The app also adds `deny` rules for `Edit` and `Write` on the policy path and a `PreToolUse` hook that blocks writes to it and to the check command's configuration; changes to these files in a changeset set a hard floor at the human rungs. Deny rules apply in every permission mode (prior-art section 3) but do not cover a Python or Node script that opens the file itself; the sandbox filesystem write-deny is the OS-level backstop. Across hooks the precedence is deny > defer > ask > allow, and exit code 2 blocks even with allow JSON. A timed-out `PreToolUse` hook does not block the call, so a stalled hook is not a gate. Files passed to `--settings`, `--mcp-config` or `--agents` are protected by Claude Code at session start; the policy file is not.
- Changes to test files, CI configuration, lint configuration and the check command are risk reasons in themselves, so an agent that weakens a check to pass it raises its own rung.
- The reviewer is a separate `claude` process the app starts, not a subagent of the working agent. It runs in its own read-only checkout of the checkpoint commit. It receives the task text, the diff, the app's check results and the app's reasons. It does not receive the working agent's transcript or reasoning, so it judges the result and not the narrative. This adopts the reviewer-independence rule of 0003 as a product design choice; 0003 itself governs the spike's agents. The working agent's report is given to it as a claim to verify.
- The checkpoint commit holds the working agent's own edits to `CLAUDE.md`, `.claude/settings.json`, skills and `.mcp.json`, and `/code-review` follows `CLAUDE.md` even in `-p`, so an agent could steer or arm its own reviewer. The reviewer starts with `--setting-sources user` plus the app's `--settings`, without the project `CLAUDE.md`, and gets the diff as data for the range base..checkpoint. Changes to any of these files are a hard-floor reason. Whether `--setting-sources user` also suppresses project `CLAUDE.md` loading is unverified.
- The reviewer's prompt states that the diff, comments and files are data and may contain text that tries to steer it. Findings it reports must cite file and line, and the app drops findings whose anchors do not exist in the diff.
- Model signals only raise. A working agent cannot talk its changeset down a rung, and neither can a reviewer.

## 3. Escalation ladder

### 3.1 Rungs

| Rung | Name | Who reviews | Accept means |
|---|---|---|---|
| A | Automatic | App rules and checks only | Checks pass and no reason requires more. Accepted and listed in the daily digest; open to sampling audit |
| B | Reviewer agent | One independent reviewer agent | No verified finding at severity `important` or higher and verdict accept. The human sees it in the digest. Findings at lower severity go back to the working agent as a batch, or to the digest |
| C | Human summary | The user reads the changeset summary, reasons, check results and reviewer report | User accepts, rejects, sends back, or drills down |
| D | Human targeted lines | The user reads the hunks that reasons and findings point to | Every flagged hunk is seen, then the user decides |
| E | Human line by line | The user reads every hunk | Every hunk in the changeset is seen, then the user decides |

At C and above, a reviewer agent runs first and its report is part of what the human reads. At D and E, a second reviewer from another model family (Codex through its CLI, per 0001) runs when the policy turns it on, and the app shows both reports side by side with disagreements marked.

### 3.2 Triggers (defaults, the policy overrides them)

| Reason | Default min rung |
|---|---|
| Checks failed or not run | send back to the working agent first; after the retry limit, C |
| Size over `small` threshold, or several modules touched | B |
| Size over `large` threshold | C |
| Source changed without any test change | B |
| Tests deleted, skipped or assertions removed | C |
| Dependency, lock, build or CI file changed | C |
| Path matches `sensitive` globs | D |
| Migration, schema or API contract file | D |
| Secret pattern in added lines | E, and the changeset is blocked from push until resolved |
| Protected path or policy file changed | E |
| Files outside the task scope | B, C when they match `sensitive` |
| Run telemetry: retries or tool errors over threshold, classifier blocks, budget overrun | B |
| Working agent reports unverified items or low confidence | B (raise only) |
| Reviewer verdict "fix" with `important` findings | send back, then re-review at the same rung; after the retry limit, C |
| Reviewer verdict "rework", or a `critical` finding | D |
| Two reviewers disagree on verdict | one rung up from the higher of the two |
| Earlier revert or rejected changeset in a touched file | one rung up |
| Accumulation: `stack` reasons at one rung | one rung up |

Changesets in a swarm are reviewed per changeset; the goal-level view rolls them up. The merge of a branch into a protected target is an outward action whose own rung is at least the highest rung of the changesets it carries, and the app refuses to approve the merge while any of those changesets lacks an accept event at its required rung.

### 3.3 Reviewer model tier and effort (0003)

| Use | Model | Effort |
|---|---|---|
| Reviewer agent at B | Most capable Claude model (`--model fable`; the model-config docs call Fable models the most capable), or `opus` if chosen for cost | high |
| Reviewer agent at C to E | Most capable Claude model (`fable`) | xhigh |
| Second reviewer at D and E (policy switch) | A model from another family through its CLI | its high setting |
| Summary for goal and agent levels from verified inputs | Capable model | medium |
| Mechanical work (diff stats, secret scan, path rules) | No model | none |

The choice between `fable` and `opus` is a cost trade-off the user makes (0010). The reviewer tier is never below the working agent's tier. The reviewer runs with `--max-budget-usd` and a turn cap from the policy. Review spend is expected to be the largest share of cost (a design choice taken from 0003); the policy sets a daily review budget, and when it runs out, units queue at their rung for the human and are not accepted automatically. Under the subscription login `--max-budget-usd` is a client-side estimate that spend can pass, so the daily budget is approximate; the app also tracks `rate_limit_event`.

### 3.4 Outward actions

Classes come from `collaboration-tooling.md` section 4. Each class maps to a mode:

| Mode | Behaviour |
|---|---|
| `allow` | Runs; logged in the record |
| `notify` | Runs; shows in the digest with a link |
| `draft` | The app intercepts the call, shows the exact payload (target, text, fields), lets the user edit text, then approves or rejects. The agent's call proceeds with the approved input |
| `approve` | Same as draft without editing, and shown at the top of the queue. Used for merges, pushes to shared branches, deletes, deploys |
| `deny` | Never runs |

Outward actions do not pass through the automatic or reviewer rungs: every `draft` or `approve` decision is human. The gate cannot rely on `can_use_tool` or the `PermissionRequest` hook alone: these only see calls that would otherwise prompt, and a call approved by a mode (auto, acceptEdits, bypass), an allow rule or the auto-mode classifier never reaches them (Agent SDK permissions page). The user's `defaultMode` is `auto`, and the P5 subagent approval probe ran in manual mode. The app therefore passes explicit `ask` rules for every outward tool class (ask rules still force a prompt in auto mode) and a `PreToolUse` hook, which runs for every call including auto-approved ones. A reviewer agent may comment on a draft (for example, check that a PR comment matches the diff), and its note shows next to the draft. Secrets or customer-data patterns in outbound text force `approve` with the match highlighted.

### 3.5 Sampling audits and manual moves

- Sampling: a policy fraction of units accepted at A goes to a reviewer agent, and a fraction of units accepted at B goes to the human summary rung, chosen at random by the app after acceptance. Audit results are recorded against the rule set and reviewer that accepted the unit.
- When an audit finds an `important` or higher finding, the app shows which rule or reviewer let it through, raises the sampling fraction for that project until a set number of clean audits follows, and suggests a policy change. It does not change the policy file itself.
- Later reverts and fixes of accepted changesets (from git history) count as misses of the rung that accepted them. This is the calibration measure, the local form of change failure rate.
- Manual moves: the user can escalate or demote any unit, a run, a path glob for the session, or the whole swarm. Escalation needs no reason. Demotion needs a short reason and cannot go below a hard floor without a second confirm. Both are events in the record. An agent cannot request a demotion; an agent can request an escalation (for example "please have a human look at this migration") through the app MCP tool, and that request is a raise-only reason.

## 4. Per-project policy file

Location: `.agide/review.yaml` in the project folder, committed with the project; the app reads it from the base commit (section 2.3). A user-level file can only tighten it (raise rungs, add globs, lower sampling thresholds). This is a design choice; Bugbot does not work this way (its repo config overrides the dashboard, and only `autofix.mode` is limited to lowering). Agents cannot write it (section 2.3).

```yaml
version: 1
project_tier: production        # hobby | internal | production

check_command: ./gradlew check --offline
retry_limit: 2

paths:
  sensitive: ["**/security/**", "**/auth/**", "infra/**", ".github/workflows/**"]
  migrations: ["**/db/migration/**", "**/*.avsc", "**/*.proto", "api/*.yaml"]
  ignore: ["**/generated/**", "docs/**"]   # still diffed, no size reasons

thresholds:
  small: { lines: 150, files: 8 }
  large: { lines: 600, files: 25 }
  stack: 3                       # reasons at one rung before raising

rungs:                           # override default min rung per reason id
  path.sensitive: D
  deps.changed: C
  tests.missing: B

reviewers:
  primary: { model: fable, effort: high }
  high_risk: { model: fable, effort: xhigh }
  second_family: { cli: codex, from_rung: D }
  daily_budget_usd: 20

sampling:
  automatic_to_reviewer: 0.10
  reviewer_to_human: 0.05

outward:
  slack.post: draft
  slack.react: notify
  jira.comment: draft
  jira.transition: draft
  jira.read: allow
  github.comment: draft
  github.review_submit: approve
  github.push: approve           # shared branches; own feature branch: notify
  github.merge: approve
  notion.edit_shared: draft
  notion.create_private: notify
  deploy: deny
```

The `outward` keys are app action classes. The app maps tool names to classes through a table it ships: claude.ai connector tools, named `mcp__claude_ai_<server>__<tool>` (from `mcp_status`, RESULTS finding 6), and command patterns for CLIs (`gh pr merge`, `gh pr comment`, `git push`). Command matching is the user-facing layer only: Bash rules do not match a program by path or inside `sh -c`, and a script can call the network itself (`gh api -X POST`, `curl` to Slack). The hard guarantee is the sandbox network allowlist. Unknown MCP write tools default to `draft`; telling writes from reads needs MCP `readOnlyHint` annotations or `requiresUserInteraction` for app-owned tools (not checked). Unknown commands that match network write patterns default to `approve`.

## 5. Claude Code primitives

| Part | Primitive | Probe status |
|---|---|---|
| Outward-action gate, `-p` path | `--permission-prompt-tool stdio`; the `can_use_tool` request carries `tool_name`, `input`, `tool_use_id`, `permission_suggestions`, `mcp_server` | Works (P1c) |
| Outward-action gate, PTY path | `PermissionRequest` hook passed with `--settings`, answering through `decision.behavior` | Works for allow and deny (P1c, P1b) |
| Draft editing (approve with changed text) | `PermissionRequest` hook `decision.updatedInput` on allow; the edited input is re-evaluated against deny and ask rules | From docs, not probed. `updatedInput` in the stdio `can_use_tool` response not confirmed. Fallback: deny with the edited text as the reason and let the agent resend |
| Force prompts for outward tools in every mode | `ask` permission rules for outward connector tools (`mcp__claude_ai_<server>__<tool>`), a `PreToolUse` hook for every call, explicit `--permission-mode` per launch, sandbox network allowlist for CLIs | Mode setting works (finding 4); ask rules force a prompt in auto mode and a hook allow does not skip deny or ask rules (docs, not probed) |
| Protect policy and hooks | Policy read from the base commit; `deny` rules on the policy path; `PreToolUse` command hook that blocks; sandbox filesystem write-deny | Deny rules and hook precedence from docs; not probed |
| Record edits and scope drift | `PostToolUse` hook (`tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`, `permission_mode`, `effort`), stream-json tool events, transcript JSONL | PostToolUse payload captured in the P5 PTY run |
| Turn end, checkpoint, trigger assessment | `Stop` and `SubagentStop` hooks with `last_assistant_message` and `agent_transcript_path`; `result` event in `-p` | Stop works (P1b); SubagentStop from docs and P5 |
| Send back for fixes | `Stop` hook returning `decision: "block"` with a reason, or a new user turn with the batched line comments | Block from docs only (capped at 8 consecutive continuations, with a `stop_hook_active` flag); new turn works (P1 multi-turn) |
| Working agent's report | App MCP tool `report_outcome` (confidence, assumptions, not verified, questions); `Stop` hook blocks once if it was not called, checking `stop_hook_active` | App MCP tools work (P3); the block-until-called loop not probed |
| Reviewer agent | Separate `claude -p` process, `--model fable --effort high`, `--setting-sources user` with app `--settings`, read-only checkout, `--permission-mode dontAsk` with allow rules for Read, Grep, Glob and the app tool, `--max-budget-usd` | `-p` launch works (P1); the reviewer configuration not probed |
| Reviewer output contract | App MCP tool `report_review` with a schema modelled on `ReportFindings` (file, line, summary, failure scenario, severity, verdict) | App MCP works (P3); whether `ReportFindings` itself is available to an app-launched session not checked |
| Reviewer engine | `/code-review` skill inside the reviewer session at the chosen effort, with an explicit range base..checkpoint (with no target it reviews against the upstream) and instructions to report through `report_review`; in `-p` it reports findings as text | Docs only; the engine plus output contract needs a probe |
| Telemetry signals | stream-json `result` (cost, usage), tool errors, denials; transcript JSONL in the PTY path | Works (P1 and P1b rows of the RESULTS outcome table) |
| Connector list for the action table | `mcp_status` control request | Works (finding 6) |
| Swarm units | Subagents, `system/task_*` events, `SubagentStop`; worktree isolation | Events work for parallel subagents in `-p` (P5); worktree isolation from docs only |

Swarm note from `swarm-orchestration.md`: subagents inherit the parent's permission mode and their requests that would prompt surface in the parent as `can_use_tool` with `agent_id`, so one approval handler sees the swarm's prompts; the ask rules and `PreToolUse` hook above cover calls that would not prompt. A host denial ends a subagent with `task_notification` status `completed`, so the record derives a `denied` outcome itself. Approval claims passed between agents carry no authority; only the app's handler decides.

## 6. Failure modes and mitigations

| Failure | Mitigation |
|---|---|
| Reviewer agrees with the implementer because it shares the model and sees the same framing | Reviewer gets no implementer transcript; the implementer's report is a claim to verify; strongest model at high effort; second family at D and E; sampling audits by the human measure the reviewer's miss rate |
| Two reviewers agree with each other on a wrong answer | Disagreement raises, agreement never lowers a floor; human audits sample reviewer-accepted units; reviewer findings need file and line anchors |
| Working agent games signals: splits a large change into small changesets, weakens tests, edits checks, moves code to unlisted paths | Size and diffusion also computed per run and per goal; test, CI and check-config changes are reasons; policy and hooks are protected; scope drift against the task; app runs checks itself |
| Prompt injection in diff content steers the reviewer | Reviewer prompt marks content as data; reviewer has no write or network tools; anchors validated; reviewer output only raises |
| Self-report used to lower risk | Raise only by construction |
| Alert fatigue: too much reaches the human | Default to digest for A and B; queue sorted by rung and reason; batch findings per changeset; track user dwell times and approve-without-reading; show the user which rules fire most and their audit hit rate so they can tune the policy |
| Fatigue in the other direction: user demotes everything | Demotions are recorded with reasons; floors need a second confirm; weekly summary shows demotions and later reverts of demoted units |
| Review spend runs away in a large swarm | Daily review budget; queued units wait for the human when it runs out; reviewer turn cap |
| Rules drift from the codebase (globs no longer match) | App reports globs that matched nothing in a period |
| Connector tool names change and slip past the action table | Unknown write tools default to `draft`; `mcp_status` diff at session start flags new tools |
| Auto-approved calls bypass the approval callback | Ask rules per outward tool and a `PreToolUse` hook; sandbox network allowlist for CLIs |
| A gating hook stalls or times out | A timed-out `PreToolUse` hook lets the call through; the ask rule and the sandbox carry the guarantee |
| The working agent arms its own reviewer through `CLAUDE.md`, settings, skills or `.mcp.json` in the checkpoint | Reviewer runs with user settings and app settings only, diff as data; changes to these files are a hard floor |
| Organization controls on connector tools override the app's gate | Shown as a connector state; outside the app's control |
| Seen marks gamed by scrolling | Dwell time per hunk and content hash; this is a record for the user, not a security control, since the user is the only reviewer |

## 7. First useful slice

One project, the `-p` launch path, one agent or a small swarm.

1. Outward-action gate: `can_use_tool` handler, action class table for Slack, Jira, GitHub and Notion connector tools and `gh`/`git push` patterns, draft and approve dialogs, events in SQLite.
2. Changeset capture at `Stop` with a checkpoint commit, app-run check command, and the app rules for paths, size, tests, dependencies and secrets, giving a reasons list and a rung.
3. Changeset, file and hunk views with seen marks bound to content hashes, and accept, reject and send-back actions.
4. Reviewer rung B as a separate `claude -p` process reporting through the app MCP tool.
5. Policy file parser for `paths`, `thresholds`, `rungs` and `outward`.

Later: goal and agent views, sampling audits and calibration, second-family reviewer, PTY path through the `PermissionRequest` hook, accumulation tuning, user-level overrides.

The slice estimate of about 9 days includes about 3 days of the outward gate that R17 already counts, so it holds about 6 days of R19 work.

## 8. Measurements and estimates (2026-11-17)

| Item | Value | Basis |
|---|---|---|
| Greenfield R19 effort to score 3 | 29 days | Sum of the rows below; one engineer plus agents; low confidence. 24 before the review added the rows marked (review) |
| Rule engine and reasons model | 3 days | Estimate |
| Review record schema, events, queries | 2 days | Estimate |
| Changeset, file, hunk views with Monaco diff and seen tracking | 5 days | Estimate |
| Goal and agent views with roll-up | 3 days | Estimate; depends on R16 tree |
| Reviewer runner, report tool, anchor validation | 3 days | Estimate |
| Ladder engine, policy parser, manual moves | 2.5 days | Estimate |
| Sampling, calibration from reverts, tuning dashboard | 2.5 days | Estimate |
| Second-family reviewer | 1 day | Estimate |
| Hardening and tests | 2 days | Estimate |
| Checkpoint commits and app-run check executor (timeouts, worktree handling) (review) | 1.5 days | Estimate |
| Digest and queue sorted by rung (review) | 1 day | Estimate |
| Goal and agent summary generation (review) | 1 day | Estimate |
| `report_outcome` tool with the `Stop`-block loop (review) | 0.5 days | Estimate |
| Merge gate that checks the review record (review) | 0.5 days | Estimate |
| Reviewer settings isolation (review) | 0.5 days | Estimate |
| First slice (section 7) | 9 days | Estimate: about 6 days of the above plus about 3 days of the outward gate |
| Outward-action gate and table | about 3 days | Counted in R17 (`collaboration-tooling.md`) |
| Default thresholds in the policy example | small 150 lines or 8 files, large 600 lines or 25 files, stack 3, sampling 0.10 and 0.05 | Starting values, untested; calibrate from the record |
| Hook prompt or agent timeout defaults | 30 s prompt, 60 s agent | Hooks reference |

## Not verified

- From docs, not probed: `updatedInput` on a `PermissionRequest` allow (re-evaluated against deny and ask rules); ask rules on `mcp__claude_ai_<server>__<tool>` names forcing a prompt in auto mode; a `PreToolUse` allow not skipping deny or ask rules.
- `updatedInput` in a stdio `can_use_tool` response.
- `Stop` hook `decision: "block"` loop, reviewer session in `dontAsk` mode, `/code-review` with an explicit range reporting through an app tool, availability of `ReportFindings` to app-launched sessions.
- Agent hooks are marked experimental in the reference (prompt hooks are not); the design gates with command hooks only.
- Whether `--setting-sources user` suppresses the project `CLAUDE.md` in the reviewer checkout.
- All effort numbers are estimates without a running prototype. Thresholds are guesses until the record supplies data.

## Review corrections

An independent review checked this note against the docs and the probe logs. Changes made:

- The outward gate: `can_use_tool` and `PermissionRequest` see only calls that would prompt. Ask rules per outward tool and a `PreToolUse` hook are required; the sandbox network allowlist is the guarantee for CLI writes.
- Policy file: read from the base commit; deny rules do not cover scripts; sandbox write-deny as backstop. The Bugbot precedent was misstated and is removed.
- Reviewer model: `fable` is the most capable alias; `opus` is a cost choice.
- The hooks reference has no "not a security boundary" statement; a timed-out `PreToolUse` hook does not block.
- Draft editing, `PreToolUse` precedence and connector tool names are answered by the docs (not probed). The `PostToolUse` payload was captured in P5.
- Worktree isolation, `SendMessage` and `stop_task` are docs only.
- Telemetry evidence cited the wrong RESULTS finding.
- Only agent hooks are experimental.
- Greenfield R19 effort 24 to 29 with the missing rows; every fork figure in `review-features-candidates.md` is now below it. The first slice holds about 6 days of R19 work.
- Added: reviewer settings isolation, `/code-review` output in `-p`, checkpoint timing with background tasks, the `Stop`-block cap, `readOnlyHint` for unknown tools, approximate budgets on a subscription, the derived `denied` outcome, 0003 as a design choice.
