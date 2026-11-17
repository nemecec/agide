# 0001 Scope, constraints and decision rule

Status: accepted
Date: 2026-11-17
Decided by: Neeme (answers to the spike plan questions)

## Context

The goal is a desktop tool for agentic coding with a task tree, context attachment, image annotation, Claude plus optional other agents, GitHub PR and Jira integration, reuse of Claude connectors, skills and plugins, an agent that can drive the UI through MCP, IDE-grade code browsing, and Markdown/HTML editing with a document model. Research found no existing tool that meets all of it. The candidate bases are forks of Superset, Emdash and Nimbalyst, a greenfield Electron shell, and a VS Code extension. `docs/spike-plan.md` describes the comparison.

## Decision

- The tool is for personal use. Anthropic's legal page lets an end user sign in to the unmodified Claude Code binary with their own subscription, so a personal tool needs no commercial agreement. A team version needs a new decision and a conversation with Anthropic.
- The target platform is macOS only. Cross-platform support is out of scope and is not a reason to prefer a base.
- Jira access goes through the claude.ai Atlassian connector. The tool does not store Jira tokens.
- Claude runs as the unmodified `claude` CLI under the user's own login. The tool does not use the Agent SDK and does not handle claude.ai credentials.
- The spike uses Claude Code 2.1.326, the latest release on the npm `latest` tag on 2026-11-17. Probe results are valid for that version only.
- Candidate repositories are read as shallow clones in fresh directories under `candidates/`. They are not installed, built or run on the host during the spike's first stage. Running third-party code needs a separate decision, which the base decision record (0007) puts to the user.
- Other agents (Codex, Gemini, Kimi) connect through ACP adapters or their own CLIs.

## Decision rule for the base

Each requirement scores 0 (absent), 1 (major work), 2 (moderate work) or 3 (works). Weights: must-have requirements weigh 3 (GUI, context attachment, Claude, GitHub PRs, task tree and task start, reuse of connectors/skills/plugins, agent drives UI), code browsing and document editing weigh 2, annotation and extra models weigh 1.

A fork is chosen only if all of these hold:

1. Every must-have scores at least 2.
2. Its weighted score is at least the greenfield score.
3. Its estimated effort to reach full scope is at most 70% of the greenfield estimate.

Otherwise the base is greenfield. A VS Code extension follows the same rule and is judged on the slices it can host.

## Consequences

- Legal risk for the personal case is low. It becomes open again if the tool is shared with colleagues.
- Jira support depends on connector behavior in the chosen launch path. Probe results in 0004 decide how.
- Without running candidates, effort estimates rest on code reading. Estimates carry that uncertainty and the final record states it.
