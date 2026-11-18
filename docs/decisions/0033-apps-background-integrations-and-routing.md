# 0033 Apps: background integrations that feed and route the inbox

Status: proposed (requirement stated by the user; weight, sources and credentials await confirmation)
Date: 2026-11-18
Decided by: Neeme (idea); the design direction is an agent proposal
Adds: R26 apps and routing (weight 2 proposed)
Extends: 0016 (inbox), 0020 (blocks), 0011 (collaboration tooling)

## Context

The user receives notifications in Slack from GitHub (review requested, comments) and from Jira (ticket created, commented). The user wants them in the Agide inbox, attached to the relevant task or project, without mentally connecting threads with tasks. The idea: an "app" inside Agide that runs in the background, need not have a visible UI (it may have one), runs logic that can post to the inbox and use an agent for filtering and routing, and attaches each notification to a task or project with a deterministic rule first and an agent when the rule is not enough. A similar app for Slack should let the messages of relevant Slack threads be handled inside Agide.

Facts from the research of 2026-11-18:

- GitHub: the REST notifications endpoints (list, mark read, mark done, thread subscription) are built for polling with `Last-Modified` and `If-Modified-Since` (a 304 leaves the rate limit untouched) and the `X-Poll-Interval` header. The `reason` field distinguishes `review_requested`, `mention`, `team_mention`, `assign`, `comment`, `author`, `state_change`, `ci_activity`, `approval_requested` and others. The docs say these endpoints accept personal access tokens (classic) with the `notifications` or `repo` scope; whether the token of the `gh` CLI works is not stated and is to be probed.
- Jira Cloud: webhooks exist for issue created, issue updated and comment created, but they need a publicly reachable HTTPS endpoint, so they do not suit a desktop app. Polling with a JQL search on `updated` works; it needs credentials (an API token or OAuth). Record 0001 says Agide does not store Jira tokens and reaches Jira through the claude.ai Atlassian connector, which only a Claude session can use.
- Slack: a custom internal app in the user's own workspace keeps the normal rate limits for `conversations.history` and `conversations.replies`. Apps distributed commercially and not in the Marketplace are limited to one request per minute since March 2026. Reading as the user needs a user token with the history scopes. Whether the workspace administrator must approve the app is not verified.
- The user already routes GitHub and Jira notifications into Slack, so the Slack feed carries them.

## Decision

- Concept. An app is a package with a manifest and optional logic and optional UI. It is a block kind (0020: data source and policy, with an optional pane). It runs in the background in a utility process while Agide runs, per profile. Its manifest declares the sources it polls or listens to, the network hosts it may reach, the secrets it may read, and the APIs it may call. The user approves the manifest, sees a health and activity view, and can stop it.
- Pipeline. Source, then normalize, then filter, then route, then inbox.
  - A source turns a service event into a normalized event: source, kind, actor, subject references (pull request URL, Jira key, Slack thread), text, link, time, an external event id.
  - Filters are rules (kind, repository, project, actor, text patterns, quiet hours).
  - Deduplication merges the same event arriving from two sources (the direct GitHub poll and the Slack message of the GitHub app) by external reference and event id.
- Routing, deterministic first.
  - An index of external references maps pull request URLs, Jira keys and Slack thread links to tasks and folders. Task start (0028) fills it when a task begins from a pull request or a ticket; pasted links, a Slack thread attached to a task and an agent proposal that the user accepts fill it too.
  - Mapping rules cover the rest: a repository, a Jira project key or a Slack channel maps to a project folder.
  - When no rule places an event, an agent decides. A small-model call sees the event snippet and a short list of candidate tasks and projects (names and summaries) and returns a target, a confidence and a reason. Above the confidence threshold the item is attached and marks the routing reason. Below it, the item lands in a Triage list with a question "Attach to?"; the user's answer can create a rule so the same case is deterministic next time. Agent routing has a token budget per day and its use shows in the usage views (0019).
  - Every inbox item shows why it was routed there, and the user can move it.
- Sources, with the credentials question open.
  - A. Direct sources: GitHub notifications through the `gh` token or a classic token held in the profile's secret store; Jira through REST polling with an API token (needs a change to 0001).
  - B. Slack as the aggregator: a Slack app reads the channels and direct messages where the GitHub and Jira apps post and parses their messages. One credential, no Jira token, and it also feeds the Slack surface; it depends on the workspace allowing the app and on the message formats of those bots.
  - C. Claude connectors: a short `claude -p` session with the Atlassian or Slack connector for on-demand lookups and enrichment (fetch this ticket or thread). It costs a session per call and does not suit background polling.
  - Recommendation: A for GitHub, B for Jira and Slack, C for enrichment. A Jira REST source waits for the user to lift the 0001 limit.
- The Slack app. It watches threads linked to tasks (thread links in the reference index), channels mapped to projects and the user's direct messages, and shows a relevant thread as a `slack-thread` surface attached to its task (0006). Replies are drafts that follow the outward-action approval of 0010 and 0011: draft, then approve.
- Security and privacy. Event text is untrusted data: it is shown as text, never run, and reaches the routing agent as quoted data with a tool set that can only look up candidates. Secrets live in the OS keychain through Electron's safe storage, per profile, and an app reads only the secrets its manifest names. An app cannot see another profile. Network access is limited to the declared hosts. An activity log lists what each app fetched and what the routing agent saw. A work Slack workspace or Jira site may have its own policy on third-party apps; the user checks it before installing.
- When Agide is closed nothing is polled. Missed GitHub and Jira events are fetched on start with the `Last-Modified` and `updated` cursors. A login item that keeps apps running without a window is later work.

## Consequences

- A rough guess is 12 to 18 working days for the app framework with manifest and approval, the GitHub source, the reference index and routing with the agent fallback and the Triage list, and a first Slack slice; low confidence.
- Probes before the build: whether the `gh` token works for the notifications endpoints; the formats of the GitHub and Jira app messages in Slack; Slack app creation and approval in a work workspace (the user's call, outside the repository); the Slack user-token scopes needed; the routing agent's accuracy on recorded events.
- The reference index and the `external_refs` table are small additions to the tree and inbox stores (0021).
- Open questions for the user: may Agide hold tokens in the OS keychain per profile (GitHub and Slack)? Is a Jira API token acceptable, or does Jira stay behind the connector and the Slack feed? May a Slack app be created in the workspace that carries the notifications? Should apps keep running when Agide is closed?
