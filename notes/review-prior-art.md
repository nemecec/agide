# Prior art for risk-based review of AI-generated changes (R19)

Date of research: 2026-11-17. Scope: what exists for scoring and escalating review of changes, so the design for R19 (risk assessment with reasons, escalation ladder, multi-level views, recorded outcomes) starts from known parts. Sources are primary vendor documentation and papers where fetched; secondary sources are marked. Nothing from candidate repositories was run.

## Measurements

| Measure | Value | Source |
| --- | --- | --- |
| Meta DRS gating fractions (weekend, yellow, red) | top 5%, 10%, 50% of diffs by score | arXiv 2410.06351 |
| Meta baseline logistic regression, SEVs captured at those gates | 18.7%, 27.9%, 84.6% | same, via search summary |
| DRS-OSS (Llama 3.1 8B classifier) | F1 0.64, ROC-AUC 0.89 | arXiv 2511.21964 |
| Kamei JIT dataset | 14 change features in 5 dimensions | Morita et al., SANER 2024 |
| Claude Code `ReportFindings` list limit | 32 findings | code.claude.com local review page |
| Auto mode pause thresholds | 3 consecutive or 20 total classifier blocks | code.claude.com permission-modes |
| Anthropic autonomy study, full auto-approve share | about 20% of sessions under 50 sessions of experience, over 40% by 750 | anthropic.com/research/measuring-agent-autonomy (secondary summary) |
| Ctrl-Z resampling result (BashBench) | attack success 58% to 7% at 5% usefulness cost | LessWrong/arXiv summary |

## 1. Risk scoring of changes in industry and research

**Meta Diff Risk Score (DRS).** Source: [Moving Faster and Reducing Risk: Using LLMs in Release Deployment](https://arxiv.org/html/2410.06351v1) (ICSE-SEIP 2025). A model estimates the chance that a diff causes a severe production incident (SEV). The earlier production model is a logistic regression over metadata; the newer one is an LLM fed the diff title, the test plan and the unified diff.

- Metadata signals: size of the change relative to file size, whether the diff only adds new files, number of files, number of authors, previous SEV in the file, whether the file sits in a high-criticality service, language, file complexity, whether the author created the file, how many diffs the author landed before.
- Use: gating during code freeze. Four zones: no gating, weekend, medium end-user impact, high end-user impact. Gated diffs wait until the freeze ends or a manager approves an escalation for a standard reason.
- Presentation in the review tool: the score, feedback buttons, an information section, the reasons the diff was flagged and suggested actions to lower the score. This matches R19's "stated reasons".
- Follow-up: [DRS-OSS](https://arxiv.org/pdf/2511.21964v2), an open fine-tuned classifier for open-source projects.
- Relevance: the threshold design (gate a fraction of the riskiest changes, with a named escalation path) transfers directly. The trained model does not: it needs a labelled incident history that a personal tool lacks. Start with rules and add history-based features (previous incident or revert in file) from the tool's own review record.

**Just-in-time defect prediction.** Source: [Kamei et al. EMSE 2015](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_EMSE2015.pdf) and [Morita et al. SANER 2024](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Morita_SANER2024.pdf). Fourteen change-level features: size (lines added, deleted), diffusion (modified subsystems, directories, files, entropy of change spread), purpose (fix or not), history (past changes and bug fixes in the touched files) and author experience. Size features are repeatedly reported as strong, and larger changes are more defect-prone. The stated aim is to let reviewers focus on the changed lines of the risky changes. Author-experience details were not verified from the fetched pages.

**DORA and change failure rate.** Change failure rate is the share of production deployments that need immediate intervention (rollback, hotfix, patch); there is no universal definition of failure. The 2025 DORA report on AI-assisted development is reported by secondary sources to link AI use with higher throughput and lower delivery stability, framing AI as an amplifier of existing practice. Figures in blogs (for example a 7.2% change failure increase) were not found in DORA material; treat them as unverified. Sources: secondary summaries from the search ([devops.com](https://devops.com/why-dora-metrics-look-different-when-ai-is-part-of-your-development-workflow/), [getdx.com](https://getdx.com/blog/what-is-change-failure-rate)). Relevance for R19: change failure rate is an outcome metric for calibrating the ladder over time (record which approved changes were later reverted or fixed), not a per-change signal. Low confidence on AI-specific claims.

## 2. Tools that review agent or pull request changes

| Tool | What it produces | Levels, labels, escalation | Source |
| --- | --- | --- | --- |
| Claude Code `/code-review` (local) | Findings from a background subagent; `--fix` applies them, `--comment` posts to GitHub or GitLab | Effort levels low to max (low reports only high-confidence findings), `ultra` escalates to a cloud review; `--max-findings` | [local review docs](https://code.claude.com/docs/en/code-review-local.md) |
| Claude Code in the desktop app | Host requests findings through the `ReportFindings` tool; list entry shows file location, one-sentence summary, optional category tag such as `correctness`; after fixes each is marked fixed, skipped or no change needed | The host receives structured data, so an app can render its own card. The tool exists in this session with a `level`, `verdict` (CONFIRMED or PLAUSIBLE) and `outcome` field | same page; tool schema |
| Claude Code managed Code Review (GitHub) | Several parallel agents, then a verification step that drops false positives, then dedup and ranking; inline comments, summary, check run | Review level Quick, Standard or Deep per repository; severity Important, Nit, Pre-existing; "Why this was flagged" reasoning; never blocks, check run is neutral; severity counts as JSON in the last line of check details for CI gating | [overview](https://code.claude.com/docs/en/code-review.md), [PR page](https://code.claude.com/docs/en/code-review-pull-requests.md) |
| GitHub Copilot code review | PR review comments with suggested changes; "Fix with Copilot" hands a comment to the cloud agent; reads AGENTS.md, skills and MCP servers | Policy enabled by the organization; no risk label found in the fetched material (search summary only, not opened) | [docs](https://docs.github.com/en/copilot/concepts/agents/code-review) |
| CodeRabbit | Walkthrough comment: summary, grouped changes table, sequence diagrams, effort estimate 1 to 5, merge risk Minimal to Critical with explanation, related issues and PRs, suggested reviewers and labels; the walkthrough page does not describe a layer view; it links to a separate Change Stack feature ("logical cohorts and layers"), low confidence | Effort and risk are config toggles; linked-issue assessment can become a required pre-merge check | [walkthroughs](https://docs.coderabbit.ai/pr-reviews/walkthroughs) |
| Cursor Bugbot | Inline comments with fix links, optional PR summary with `riskScore` toggle, status check | Effort low, default, high, smart; check is neutral by default and can fail on unresolved issues; autofix modes off, new branch, existing branch (max 3 attempts); rules from BUGBOT.md and learned rules; severity exists in the analytics API only | [docs](https://cursor.com/docs/bugbot) |
| Greptile | Top-level PR summary with confidence score 0 to 5, findings, per-file analysis and generated diagram | Score maps to action: 5 merge, 4 merge after small fixes, 3 address feedback, 2 rework, 0 or 1 rethink; no formula published; same score weighs more on a payments change | [docs](https://www.greptile.com/docs/code-review/first-pr-review) |
| Qodo (Qodo Review, formerly Merge) | Findings with category (bugs, rule violations, requirement gaps), severity High, Medium, Low, quality-impact label, evidence (rule, linked ticket), relevance stars from past handling, agent fix prompt | High means blocking before merge; grouped by severity in the summary; advisory, branch rules decide the merge. v1 `/review` also had effort score 1 to 5 and a security section; v1 is being sunset | [comment anatomy](https://docs.qodo.ai/code-review/comment-anatomy.md) |
| Graphite Agent (was Diamond) | Inline comments for logic bugs, edge cases, security, performance, leftover debug code, with committable suggestions | No severity or summary found in the docs; dashboard tracks acceptance rate and downvote rate | [docs](https://graphite.com/docs/ai-review-comments.md) |

Patterns worth reusing:
- A short, ordered label with a stated reason (CodeRabbit merge risk, Claude "Why this was flagged", Meta reasons list).
- Two scores for two questions: effort to review (CodeRabbit, Qodo v1) and confidence or risk of merging (Greptile, CodeRabbit). R19 needs both, because the ladder chooses who reviews (effort) and how deep (risk).
- A verification pass before a finding reaches the human (Claude managed review). Reduces false positives, which is the main cost for a swarm user.
- Feedback loops on the reviewer itself: acceptance and downvote rate (Graphite, Greptile), learned rules (Bugbot), relevance from history (Qodo).
- Machine-readable output for gating (Claude check run JSON line, Bugbot status values). A local app can store the same fields.
- All of these review one PR. None found aggregates a swarm or maps risk to a reviewer ladder across several agents. That layer is new work.

Limits of this section: Copilot and Graphite material is thin and partly from search summaries. Vendor benchmark claims found in search results were not used.

## 3. Oversight guidance and approval policy

**Provider and research guidance.**
- Anthropic, [Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy) (2026-02-18, read through search summaries): experienced users move from approving each action to full auto-approve plus active monitoring and interrupting; the report argues against rules that force a human to approve every action and calls for post-deployment monitoring infrastructure. Implication for the ladder: oversight by exception, with the exception rule visible and tunable.
- AI control line of work (Redwood Research; [Ctrl-Z, resampling](https://www.lesswrong.com/posts/LPHMMMZFAWog6ty5x/ctrl-z-controlling-ai-agents-via-resampling); [Evaluating Control Protocols for Untrusted AI Agents](https://arxiv.org/html/2511.02997)): a weaker trusted monitor scores a stronger agent's actions; suspicious actions are audited by a human, resampled or deferred. Trusted monitoring has a capability gap; untrusted monitoring (a second instance of a strong model) risks collusion. Prompt injection inside the agent's actions can subvert monitors ([arXiv 2510.09462](https://arxiv.org/pdf/2510.09462v2)). Mapping: monitor score thresholds select audit, resample or defer, which is the ladder in other words. These are adversarial-setting results from benchmarks; the personal tool faces mistakes, not scheming, so the numbers do not transfer. The structure does.
- [CriticGPT, LLM Critics Help Catch LLM Bugs](https://arxiv.org/html/2407.00215v1): model critiques are preferred over human critiques in most comparisons, critics hallucinate bugs, and a human plus critic team hallucinates less than the critic alone while catching a similar number. Supports the "independent reviewer agent, then human reads the summary" rung. Caveat from the authors: the bugs were inserted by humans.
- [Debate Helps Weak-to-Strong Generalization](https://arxiv.org/html/2501.13124v1): debate helps a weak judge separate reliable from unreliable content from a stronger model; evidence is from NLP benchmarks only. Supports a two-reviewer disagreement signal; low confidence for code.
- Not fetched, cited from memory and therefore unverified here: Anthropic's framework for safe and trustworthy agents (human control with transparency), Bowman et al. on scalable oversight. Open before relying on them.

**Approval policy in Claude Code** (primary: [permission modes](https://code.claude.com/docs/en/permission-modes), [permissions](https://code.claude.com/docs/en/permissions), [hooks guide](https://code.claude.com/docs/en/hooks-guide.md)). These are the approval mechanisms the app can configure per project, with the CLI as the engine (decision 0001).
- Modes: `default` (reads only without asking), `acceptEdits`, `plan`, `auto` (classifier reviews everything else), `dontAsk` (deny anything that would prompt, for CI), `bypassPermissions` (containers only).
- Rule order: deny, then ask, then allow, first match wins. Deny applies in every mode including bypass; allow has no effect in bypass; content-scoped `ask` always prompts, also in auto mode.
- Auto mode classifier blocks by default: download-and-execute, sending sensitive data out, production deploys and migrations, mass cloud deletion, granting IAM or repo permissions, force push and hard reset, destroy commands, merging pull requests no human approved. If it blocks 3 times in a row or 20 in total, auto mode pauses and prompting resumes. Stated boundaries in conversation count as block signals; deny rules are the hard guarantee.
- Protected paths: writes to `.git`, `.husky`, `.claude`, `.vscode`, package-manager configs, `.mcp.json`, shell startup files and similar prompt or are classified in every mode, and allow rules do not pre-approve them. These are ready-made "sensitive path" signals.
- Hooks: `PreToolUse`, `PermissionRequest`, `Stop` and other events run deterministic commands; prompt-based and agent-based hooks let a model judge. The spike probes show a `PermissionRequest` hook answers approvals in both `-p` and PTY mode and `--permission-prompt-tool stdio` carries `tool_name`, `input`, `tool_use_id` and `permission_suggestions` (`probes/RESULTS.md`). Precedence (from the hooks reference and the Agent SDK permissions page, via the review): across hooks deny > defer > ask > allow; a hook that returns allow does not skip deny or ask rules; a timed-out `PreToolUse` hook does not block. `can_use_tool` and `PermissionRequest` see only calls that would otherwise prompt.
- Review-as-hook: a `Stop` hook receives `last_assistant_message` (probe P1b), so an independent reviewer can run at turn end and its result can be recorded.

## 4. Review features of the candidate bases

From existing notes and a read of the candidate clones (read only, nothing run). Confidence is medium for all code-reading claims.

| Base | What exists | Gap against R19 |
| --- | --- | --- |
| Superset | `packages/shared/src/pull-request-detail/pull-request-detail.ts` queries GitHub GraphQL for PR detail including `reviewThreads`; PR routers in `packages/trpc/src/router/integration/github`; a Changes view in the right sidebar with status and diff stats on workspace rows; plan files for PR detection and link commands; per-turn changesets with per-file undo; GitHub-webhook automations in the hosted backend (`review-features-candidates.md`) | No risk label or ladder; reviewer runs only by webhook trigger. Review threads are read from GitHub; whether they are shown in a pane was not checked |
| Emdash | PR list, fork checkout, diff with PR comments, checks, create and merge present in code (`triage-emdash.md` R5, not run); diff line comments formatted as XML and pasted into the agent terminal (`src/core/primitives/line-comments`); PR plugin has GitHub and GitLab clients with check data | Per-line feedback to the agent exists; no risk model, no reviewer agent, no record of review outcomes |
| Nimbalyst | PR mode on `gh` with tracker overlay per PR and review sessions linked to it; accept or reject per edit through a `PreToolUse` tagging hook, file watcher and `MonacoDiffApprovalBar`; tree diff for Markdown; extension SDK for panels and MCP tools (`triage-nimbalyst.md`) | Accept or reject is per edit, a low level only. Review sessions give a place to attach a reviewer agent. No risk score or escalation |
| VS Code | GitHub Pull Requests extension: checkout, in-editor review comments; built-in diff (`triage-vscode.md`) | No PR data API for other extensions; no agent-review concepts |
| JetBrains Air | Line comments in the diff collected in a Comments tool and sent to the task in one batch; agentic review as a separate task with a fresh agent session, possibly a different agent or model than the implementer; JetBrains says it does not replace human review; Teams edition commits per turn so nothing is accepted. Source: [review changes](https://www.jetbrains.com/help/air/review-changes.html), [agentic review](https://www.jetbrains.com/help/air/agentic-review.html), search summary, pages not fully read | Closest published model of "reviewer agent as a task". No risk label or ladder found. Closed product, so a reference for UX, not a base |
| Conductor | Mac app with a worktree per agent, chats, terminals, diffs, checks, PR and archive flow (marketing pages and third-party comparisons only). Closed source | Reference only. Details on review features unverified |

Reading across: every base gives diff and comment loops (levels per hunk and per file). None gives risk assessment, escalation, a goal level view over many agents, or a stored review record per changeset; superset has a per-turn changeset view. R19 scores 1 for each on remaining work (the 0008 plain-diff cap applies only to vscode), and the work is the same additions on any base: risk engine, ladder policy, reviewer-agent runner, multi-level views, review log. Nimbalyst's sessions, tracker overlays and extension SDK and Emdash's line-comment injection are the nearest attachment points. This note does not score the bases; it feeds the scoring.

## 5. Computable risk signals

Each signal below is computable from the diff, the repository, the agent transcript or the app's own record. Columns: signal, how to compute, cheap or needs an agent. Weights are not proposed here; they belong in the policy decision.

**Diff and repository**
- Paths against sensitive areas: glob list per project (auth, billing, security config, infra, CI workflows, deploy manifests, protected paths in section 3). Cheap.
- Size: lines added and deleted, files changed, relative to file size, deletions of tests. Cheap. Strong in JIT research and in Meta DRS.
- Diffusion: number of top-level directories or modules touched, entropy of the spread. Cheap.
- Database and schema changes: migration files (Flyway or similar), schema, Avro or protobuf definitions, API specs. Cheap, project-specific globs.
- Dependency and build changes: lock files, manifests, build scripts, Dockerfiles, CI config, new dependency names. Cheap; new dependency name against a registry age or advisory lookup needs a network call.
- Secrets: pattern or entropy scan of added lines (gitleaks style), new `.env` or key files. Cheap.
- Permission and security surface: changes to auth checks, CORS, deserialization, shell execution calls found by pattern or a static analyser. Mixed.
- History in touched files: previous revert, hotfix or incident in the file or directory, churn rate, code owner not the author. Cheap with git, better with the app's own review record.
- Test coverage of the change: added or changed source lines without any test change in the diff; coverage delta if the project emits coverage. Cheap to moderate.
- Diff is generated or mechanical (rename, format): detect by similarity and tooling output to lower risk. Moderate.

**Run results**
- Build, lint, type-check, test results of the working tree at turn end, including tests added or skipped, flaky retries, tests disabled or assertions weakened in the diff. Cheap if the app runs a project-defined check command.
- Agent run telemetry: number of retries and tool errors, reverted edits, permission denials and classifier blocks (auto mode pauses at repeated blocks), duration and token cost against the budget, scope drift (files edited outside the files named by the task). Cheap from stream-json or hooks.
- Plan versus result: files in the plan against files changed. Moderate.

**Agent and reviewer judgement**
- Agent self-reported uncertainty: ask for a structured end-of-turn field (confidence, assumptions made, things not verified, decisions needing the human), or parse stated caveats. Needs an agent; calibration is unproven, so treat as a raise-only signal.
- Independent reviewer agent: verdict, severity and count of verified findings from a reviewer of another model (Claude Code review, `ReportFindings` fields `verdict`, `level`). Needs an agent. Verification step lowers false positives.
- Reviewer disagreement: two reviewers or implementer versus reviewer disagree on a finding or on the risk label. Needs two agent runs; the debate and control literature suggests disagreement is informative, low confidence for code.
- Unresolved review threads or open findings count. Cheap.

**Outward-facing actions** (R17 and R19)
- Actions through connectors or CLIs that leave the machine: Slack message, Jira transition or comment, GitHub comment, push, PR merge, Notion edit, email, deploy, any HTTP write. Detect by tool name, MCP server name or command pattern through the permission callback or hook. Cheap and reversible-or-not is a static table.
- Irreversibility class: force push, delete, production deploy, migration run, permission grant (the default-block list in section 3).
- Audience: public or customer-facing target against an internal one. Static per target.
- Data egress: secrets or customer data in outbound content. Pattern scan, cheap.

**Context**
- Project risk tier set by the user (a hobby script against a production service), branch target (protected branch, release branch), time of day or freeze windows, agent autonomy mode in force, and the user's recent override history (how often the user approved without reading, from the review record). Cheap.

Design implications for the later decision record:
- Combine rules into a score with named reasons; show reasons first, number second (Meta, CodeRabbit).
- Keep a hard-floor layer: some signals set a minimum rung regardless of score (secrets, irreversible outward action, sensitive path).
- Treat model-produced signals (self-reported uncertainty, reviewer output) as raise-only inputs, since they can be wrong or manipulated, and monitor prompts must not see untrusted content as instructions.
- Record every score, its reasons, the rung chosen, the reviewer and the outcome, so the policy can be calibrated against later reverts (the DORA-style outcome measure).

## Not verified or low confidence

- Copilot code review risk labels or levels: only the overview was seen through search; the reference pages were not opened.
- Graphite severity, summaries: none found in docs; may exist elsewhere.
- Qodo v2 `/review` fields: v1 docs describe effort and security sections; v2 reference not read.
- Greptile confidence formula: not published in the fetched page.
- Superset review pane behaviour and whether threads render in the UI; Conductor and Air internals beyond marketing and help pages.
- The desktop Code review card layout beyond the findings list (third-party description only).
- Meta DRS pairing of multipliers with models; numbers in the measurements table come from search summaries of the paper.
- AI-specific DORA claims; Anthropic autonomy figures read from secondary summaries.
- Anthropic safe-agents framework and scalable-oversight surveys (Bowman and others) were not opened.
- Web search is US-only and returned some third-party mirrors; those were not used as primary evidence.

## Review corrections

The independent review of R19 checked this note together with `review-ladder-design.md`. Changes made:

- CodeRabbit: the layer view is the separate Change Stack feature, low confidence; effort 1 to 5 and merge risk Minimal to Critical are confirmed.
- Hook and rule precedence is now stated from the docs (not probed).
- The report behind this note said `swarm-visibility.md` and a Superset triage note did not exist; both exist now (`triage-superset.md`).
- Superset has per-turn changesets and webhook-triggered agent runs (`review-features-candidates.md`); the 0008 cap applies only to vscode.
- Bugbot: its repo config overrides the dashboard, and only `autofix.mode` is limited to lowering.
