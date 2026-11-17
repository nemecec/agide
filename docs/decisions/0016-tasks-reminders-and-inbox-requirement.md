# 0016 Tasks, reminders and inbox

Status: proposed (requirement stated by the user; weight and design await confirmation)
Date: 2026-11-17
Decided by: Neeme (idea); the design direction is an agent proposal
Amends: 0008 (adds R21)

## Context

The user wants a tasks and to-do system with an inbox, possibly several inboxes attached to different folders or projects. The inbox is the main way to return to a long-running task that sends a status update or needs input. The user can also set recurring reminders and tasks for themselves, related to a session, project or folder.

Several earlier requirements already produce items that wait for the user: agents waiting for approval (R16, 0009), drafts of outward actions to approve (R17, 0011), escalations of the review ladder (R19, 0010) and swarm budget stops (R18, 0011).

## Decision

- R21 Tasks, reminders and inbox. Weight 3 is proposed.
  - One item model: type (status update, needs input, approval, review request, failure, reminder), source (session, agent, swarm, surface), folder scope, urgency, state (new, seen, snoozed, done) and a deep link that opens the exact place. An approval item shows the raw command or draft, not the agent's summary.
  - One store scoped by folder. A folder's inbox is its subtree and the root shows all. Several inboxes are saved filtered views, which are panes under R20.
  - A task is a small durable item with a state, an owner (user or agent), an optional due time or recurrence, and a link to a node. A reminder that fires creates an inbox item. External issues (Jira, GitHub) stay external objects that tasks link to (R17).
  - Agent tools on the app's MCP server: `inbox_post` (non-blocking update) and `inbox_ask` (question, with a timeout).
  - Sources in PTY sessions, to be verified by probes: the Notification, Stop, SubagentStop, PermissionRequest and Elicitation hooks. The app answers by sending text into the PTY or through the permission hook.
  - A per-project policy sets which events create items, batching and quiet hours. Items resolve automatically when the user has already viewed the session (observation data, R13). Status digests use the small model (0003).
  - Recurring human reminders are free. Recurring agent-run tasks are limited by the concurrent-agent cap and need approval.
  - The scheduler persists schedules and applies a catch-up policy on start, since reminders do not fire while the app is closed. Notifications use the macOS notification centre and the dock badge.
  - Context for every item, in layers the user opens step by step. The header shows the project name and summary and the session name and summary. The item shows a one-line message and a longer description that expands in place. Drill-down opens the session transcript at the point the message refers to, the diff, the linked ticket or pull request, and the browser surface when one is involved.
  - The original message stays reachable. Context opens in a peek beside the message card in a split, so the card stays visible. A back stack and a "Back to message" control return the user from deeper levels. The surface interface (0006) gains a read-only peek mount mode that does not take focus.
  - Text sources. The posting agent supplies the short message and the long description through `inbox_post` within length limits; the app builds them from the last assistant message for hook-derived items. The session summary comes from the small model (0003), generated lazily, cached, shown with its generation time and refreshable; it is not regenerated every turn. The project summary is edited by the user, and an agent can propose a draft. All of this text is untrusted and renders as plain text.

## Consequences

- The inbox is built early, in milestone 2 or 3 before the review slice, because swarms and approvals have no return path without it.
- The greenfield estimate grows. A rough guess is 10 to 15 working days; low confidence until a design record exists.
- The base decision is unchanged.
- Agent-written item text is untrusted: it renders as plain text and never triggers an action.
- Folder nodes need a description field and session nodes a summary field with a generation time; both are a small migration of the tree store (0013). The short message also supplies the macOS notification text.
- Open questions for the design record: whether the Notification hook distinguishes permission prompts from idle prompts in the PTY, how a blocking question is answered in the PTY and in stream-json sessions, noise limits, and how the agent's own task list (its to-do tool) is mirrored into the app as observed data.
