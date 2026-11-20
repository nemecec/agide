# 0033 Apps: integrations that feed and route the inbox

Status: proposed (requirement stated by the user; the answers of 2026-11-18 are applied; weight and the Slack and Google credentials await confirmation)
Date: 2026-11-18
Decided by: Neeme (idea and answers); the design direction is an agent proposal
Adds: R26 apps and routing (weight 2 proposed)
Extends: 0016 (inbox), 0020 (blocks), 0011 (collaboration tooling)
Amends: 0001 (Jira tokens)

## Context

The user receives notifications in Slack from GitHub (review requested, comments) and from Jira (ticket created, commented). The user wants them in the Agide inbox, attached to the relevant task or project, without mentally connecting threads with tasks. The idea: an app inside Agide that runs in the background, need not have a visible UI (it may have one), runs logic that can post to the inbox and use an agent for filtering and routing, and attaches each notification to a task or project with a deterministic rule first and an agent when the rule is not enough. Slack is one more app of the same kind, following chosen threads and channels. Later apps: Notion comments, Google Docs, possibly Gmail.

Facts from the research of 2026-11-18:

- GitHub: the REST notifications endpoints (list, mark read, mark done, thread subscription) are built for polling with `Last-Modified` and `If-Modified-Since` (a 304 leaves the rate limit untouched) and the `X-Poll-Interval` header. The `reason` field distinguishes `review_requested`, `mention`, `team_mention`, `assign`, `comment`, `author`, `state_change`, `ci_activity`, `approval_requested` and others. The docs say these endpoints accept personal access tokens (classic) with the `notifications` or `repo` scope; whether the token of the `gh` CLI works is not stated and is to be probed.
- Jira Cloud: webhooks exist for issue created, issue updated and comment created, but they need a publicly reachable HTTPS endpoint and dynamic webhooks expire, so they do not suit a desktop app. Polling with a JQL search on `updated` works with an API token or OAuth.
- Slack: a custom internal app in the user's own workspace keeps the normal rate limits for `conversations.history` and `conversations.replies`. Apps distributed commercially and not in the Marketplace are limited to one request per minute since March 2026. Reading as the user needs a user token with the history scopes. By default workspace members can install apps without approval; an owner can turn on app approval, after which members can install only pre-approved apps and can request others if the owner allows requests (Slack Help Center, "Manage app approval for your workspace"). Which setting the user's workspace has is for the user to check.
- Notion: the comments endpoints list open comments of a page or block (`block_id`) and need a connection with the read-comments capability that has access to the page. Comment webhook events (created, updated) are documented; a third-party source calls webhooks a public beta, and subscription details are not verified. No API for the user's own Notion notification inbox was found.
- Google: refresh tokens of an OAuth client in Testing status expire after about seven days (several third-party sources; Google's own page not read). Publishing the client removes that limit, and restricted Gmail scopes may need Google's verification (unverified). Polling Drive comments and changes was not researched.

## Decision

- Concept. An app is a package with a manifest and optional logic and optional UI. It is a block kind (0020: data source and policy, with an optional pane). It runs in a utility process while Agide runs, per profile. Its manifest declares the sources it polls or listens to, the network hosts it may reach, the secrets it may read, and the APIs it may call. The user approves the manifest, sees a health and activity view, and can stop it.
- Pipeline. Source, then normalize, then filter, then route, then inbox.
  - A source turns a service event into a normalized event: source, kind, actor, subject references (pull request URL, Jira key, Slack thread, Notion page), text, link, time, an external event id.
  - Filters are rules (kind, repository, project, actor, text patterns, quiet hours).
  - Deduplication merges the same event arriving twice by external reference and event id.
- Routing, deterministic first.
  - An index of external references maps pull request URLs, Jira keys, Slack thread links and Notion pages to tasks and folders. Task start (0028) fills it when a task begins from a pull request or a ticket; pasted links, a thread or page attached to a task and an agent proposal that the user accepts fill it too.
  - Mapping rules cover the rest: a repository, a Jira project key, a Slack channel or a Notion workspace area maps to a project folder.
  - When no rule places an event, an agent decides. A small-model call sees the event snippet and a short list of candidate tasks and projects (names and summaries) and returns a target, a confidence and a reason. Above the confidence threshold the item is attached and marks the routing reason. Below it, the item lands in a Triage list with the question "Attach to?"; the user's answer can create a rule so the same case is deterministic next time. Agent routing has a token budget per day and its use shows in the usage views (0019).
  - Every inbox item shows why it was routed there, and the user can move it.
- Sources: direct from each service, no aggregator. Slack is not used as a feed for GitHub or Jira.
  - GitHub: the notifications endpoints with the `gh` token if a probe shows it works, otherwise a classic token the user provides; the user accepted a classic token (answer of 2026-11-18).
  - Jira: REST polling with a JQL search on `updated` and a stored cursor, using an API token. The user decided that Agide may store Jira tokens (answer of 2026-11-18); 0001 is amended accordingly. The claude.ai Atlassian connector stays the path for Claude sessions.
  - Notion (later): an internal integration token created by the user, read-only with the comments capability; it sees only the pages and databases shared with it. Polling comments of watched pages and the changed pages by `last_edited_time`. Webhooks wait until they are verified and a reachable endpoint exists, which a desktop app lacks.
  - Google Docs (later): Drive comments and changes polling through the installed-app OAuth flow. The seven-day refresh token limit of a client in Testing status means weekly re-authorization, or a published client, or a Workspace internal client if the user's account allows it (unverified). Research before the build.
  - Gmail: the same framework fits (a source for new mail and labels). It carries the largest privacy question and the same Google OAuth constraint, and routing mail needs the agent more than other sources. It is later than Notion and Docs. Until then the claude.ai Gmail and Drive connectors serve on-demand lookups from a session.
  - Claude connectors in general: a short `claude -p` session with a connector serves on-demand lookups and enrichment. It costs a session per call and does not suit background polling.
- Credentials. Agide stores tokens per profile in the OS keychain through Electron's safe storage (answer of 2026-11-18): GitHub, Jira, Slack, later Notion and Google. An app reads only the secrets its manifest names.
- The Slack app is an Agide app that connects to Slack. Slack itself needs a small registration at api.slack.com, created by the user in the workspace: it holds the permissions and the tokens, and no code runs inside Slack. Agide either opens an outbound Socket Mode connection (no public endpoint) or polls with a user token; polling with `conversations.history` and `conversations.replies` is the simpler first version. The workspace may require administrator approval and may have a policy on third-party apps; the user checks that. The Agide Slack app watches threads linked to tasks (thread links in the reference index), channels mapped to projects and the user's direct messages, and shows a relevant thread as a `slack-thread` surface attached to its task (0006). Replies are drafts that follow the outward-action approval of 0010 and 0011: draft, then approve. If the workspace does not allow the registration, the fallback is the Slack web client in a browser tab (0026) and on-demand reads through the claude.ai Slack connector.
- Apps run only while Agide runs (answer of 2026-11-18: no background process outside Agide). Nothing is lost while Agide is closed: GitHub, Jira, Slack, Notion and Google keep their state and each app catches up on start from its cursor (`Last-Modified`, JQL `updated`, the Slack message timestamp, the Drive page token).
- Security and privacy. Event text is untrusted data: it is shown as text, never run, and reaches the routing agent as quoted data with a tool set that can only look up candidates. An app cannot see another profile. Network access is limited to the declared hosts. An activity log lists what each app fetched and what the routing agent saw.

## Consequences

- A rough guess is 12 to 18 working days for the app framework with manifest and approval, the GitHub and Jira sources, the reference index, routing with the agent fallback and the Triage list, and a first Slack slice; low confidence. Notion, Google Docs and Gmail are separate slices after it.
- Probes before the build: whether the `gh` token works for the notifications endpoints; Jira polling with an API token (rate limits, comment events through `updated` plus the comment list); the Slack registration in the user's workspace and the user-token scopes needed (the user's step); the routing agent's accuracy on recorded events; Notion comment polling on a test page.
- The reference index (`external_refs`) is a small addition to the tree and inbox stores (0021).
- Open question for the user: does the workspace allow members to install apps, or is approval required? The user checks by creating the app and pressing Install; the button states whether approval is needed.
