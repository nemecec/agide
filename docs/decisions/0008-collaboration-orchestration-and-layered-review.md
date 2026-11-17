# 0008 Collaboration, orchestration and layered review

Status: accepted
Date: 2026-11-17
Decided by: Neeme
Amends: 0002 (adds R17 to R19, raises the weight of R16)

## Context

The product purpose, as stated: agents and humans collaborate around shared tooling such as Jira, Slack, GitHub and Notion. The tool makes it easy to orchestrate agent swarms and to see what they do. When a swarm produces work, the user cannot review every line, so review happens at several levels of abstraction, with a risk-based assessment and an escalation ladder.

## Decision

- R17 Collaboration tooling. Jira, Slack, GitHub and Notion are first-class. For each, the user can view the object in the tool (a surface, R12), the agent can read and act on it through a connector or command-line client (R7), a task can start from the object (R6), and the agent can direct the user to it (R8). Outward-facing actions an agent takes in these services (posting a message, commenting, changing a ticket, merging) follow the approval policy of R19. Weight 3.
- R18 Swarm orchestration. The user, and an agent through the application's own MCP server, can start a group of agents for a goal, give each a model and effort tier (see 0003), set a budget, steer or stop one agent or the group, and give each agent an isolated workspace. Weight 3.
- R19 Layered review with risk-based escalation. Each unit of agent work gets a risk assessment with stated reasons. An escalation ladder maps risk to who or what reviews it: automatic checks, an independent reviewer agent, a human reading a summary, a human reading the changed lines. The user chooses the policy per project. The UI shows the same work at several levels of abstraction (goal and outcome, per agent, per changeset, per file, per hunk) with drill-down. Every assessment, escalation and review outcome is recorded and reachable later. Weight 3.
- R16 (visible swarms, see 0002) weighs 3. It is the observation half of R18.

The ladder's levels, the risk signals and the policy format are design work for the research that follows, and are recorded in a later decision.

## Consequences

- Every candidate base is scored for R17 to R19. A base that lacks any review model beyond a plain diff scores at most 1 on R19.
- The greenfield estimate includes the risk model, the ladder, the multi-level review views and the review record.
- The decision rule of 0001 uses the updated weights: R12, R13, R17, R18, R19 and R16 weigh 3 together with the original must-have requirements.
