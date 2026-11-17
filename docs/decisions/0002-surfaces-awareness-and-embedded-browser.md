# 0002 Surfaces, shared awareness and embedded browser

Status: accepted
Date: 2026-11-17
Decided by: Neeme
Amends: 0001 (requirement list and decision rule)

## Context

The first requirement list treated the tree leaves as agent sessions. The intended product is wider: a project folder holds several kinds of leaf, and the agent works with the user across them. Examples given: a Claude session, a browser tab (for example a Jira ticket), a Slack conversation or thread. More kinds (Discord and others) are expected later. The agent should see what the user is doing in the leaves of its project folder, and should be able to drive the UI to show the user something. Claude has a Chrome integration, and the same integration should ideally work in the embedded browser.

## Decision

Requirements R12 to R16 are added. R14 extends R8 and has no separate weight.

- R12 Surfaces. Every tree leaf is a surface of some type. Claude session, browser tab and Slack conversation are the first types. A new type (Discord, others) is added through an extension interface without changing the core application. A surface type provides: how it renders, how it is persisted in the tree, what the agent can observe, and what the agent can do to it.
- R13 Shared awareness. The agent of a project folder can observe what the user does in the surfaces of that folder: for a browser tab the URL, title, visible text, selection and a screenshot on request; for a Slack surface the visible conversation; for a session the other sessions' state. Observation is limited to the surfaces of the agent's own project folder, can be switched off per surface, and is shown in the UI while it is on.
- R14 Agent shows things (part of R8). The agent can open, focus, reveal, scroll and highlight in the UI and can navigate the embedded browser, using the same tool surface as the user's actions.
- R15 Claude in Chrome in the embedded browser. The tools of the Claude Chrome integration should work against tabs of the embedded browser. If that cannot work, the application hosts equivalent browser tools for the embedded browser and the record states which tool names carry over.

- R16 Visible swarms (added later on 2026-11-17). Agents in the tool can swarm: a session can run subagents and workflows, and the application lets the user or an agent start several agents. The tree shows each running agent as a child of the session that started it, with a status (running, waiting for approval, failed, done) and a count of running agents on the parent. A finished agent disappears from the tree automatically after a short delay. Its transcript stays reachable: a filter or history view lists finished agents by session and project and opens their transcripts read-only.

Weights in the decision rule of 0001: R12 and R13 are must-have (weight 3). R15 weighs 2. R16 weighs 3 after the amendment in 0008. A base that cannot host a browser tab as a first-class tree leaf scores at most 1 on R12.

## Consequences

- Every candidate base is re-scored for R12 to R15, including the VS Code extension and the greenfield shell.
- The greenfield estimate includes the surface interface and the embedded browser.
- Slack content can enter a surface by embedding the Slack web client in a browser tab, or by reading through the Slack connector and rendering natively. Both options are assessed for terms of service and feasibility before a choice is made.
- Observation data enters the agent's context, so the privacy controls above are part of the design and not a later addition.
