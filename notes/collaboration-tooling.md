# R17 Collaboration tooling: Jira, Slack, GitHub, Notion

Date: 2026-11-17. Research only. Nothing from the candidate repositories was run. Confidence tags: H read from a primary source or an earlier note that cites one, M secondary or partial, L general knowledge or inference. Related notes: `surfaces-and-browser.md` (embedded browser, Slack and Discord surfaces), `probes.md` and `../probes/RESULTS.md` (connector behavior in the CLI), `triage-*.md`, `greenfield-and-libraries.md`, decision 0008 (R17 to R19).

## 1. Summary

- The agent side of R17 does not depend on the base. The unmodified `claude` CLI reaches Jira, Slack and Notion through the user's claude.ai connectors and GitHub through `gh`. The Atlassian connector answered a read call in `-p` and in the PTY (RESULTS.md); no write tool was called. The base decides the human side: a surface that shows the object, task start from the object, observation of the viewed URL, agent-driven navigation, and the approval gate for outward actions.
- Connector use needs a claude.ai subscription login. A claude.ai connector is authorized in claude.ai, not in the CLI: unconnected connectors can be connected only from claude.ai settings (https://code.claude.com/docs/en/mcp, H). The launch path never authorizes a connector. Servers configured in Claude Code itself are authorized through `/mcp` or from the shell with `claude mcp login <name>`. The app reads `mcp_status` to show which connectors are connected or in `needs-auth` (RESULTS.md finding 6) and links to claude.ai connector settings; for self-added servers it can run `claude mcp login`.
- Recommended shape: connectors and `gh` for the agent; embedded browser tabs (persistent partition) for the human view of Jira, Slack, GitHub and Notion; URL patterns as the key for observation and for task start; every outward write goes through the R19 permission gate (`can_use_tool` or a `PermissionRequest` hook, RESULTS.md findings 2 and 3), with draft-then-approve for messages and ticket comments.

## 2. Per service

### Jira (Atlassian)

Agent access:
- The claude.ai connector `claude.ai Atlassian` is connected on this machine and ran a read call in `-p` and the PTY (RESULTS.md, H). Its instructions carry a deprecation notice: the v1 endpoint "will be removed" on 2027-03-01 and the user must re-add the official connector (or recreate a custom one with `https://mcp.atlassian.com/v2/mcp`) and authorize again. The two primary sources differ (below). The agent is told to say this after its first call. Atlassian's support page confirms v2 as the current endpoint and says that on 2027-03-01 existing v1 use automatically starts to expose and use v2 tools, and that only incompatible clients must clear cached client ids (https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/, H). Two further entries (`Atlassian MCP`, `Atlassian Rovo`) are in `needs-auth`; whether they use v2 was not tested.
- Only the read call `atlassianUserInfo` ran in a probe; write tools are listed, not exercised (M for writes). Tools seen in this session, read: `getJiraIssue`, `searchJiraIssuesUsingJql`, `getTransitionsForJiraIssue`, `getJiraIssueRemoteIssueLinks`, `getVisibleJiraProjects`, `lookupJiraAccountId`, `fetch`, `search`, Confluence reads, Teamwork Graph reads. Write: `createJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `transitionJiraIssue`, `createIssueLink`, `addWorklogToJiraIssue`, Confluence page create and update and comments.
- Auth: OAuth 2.1 acts as the user with the user's permissions; an API token option exists (H). Authorization happens once in claude.ai; whether a re-add is needed at the v1 cutover depends on which source above holds. The decision 0001 rule is that the app stores no Jira token, so the app cannot call Jira itself.

Human view:
- Embed `https://<site>.atlassian.net/browse/KEY-123` in a browser surface with a persistent partition. Atlassian Cloud sets frame-blocking headers (L), which do not matter for a top-level `WebContentsView` or `<webview>` (`surfaces-and-browser.md` section 4). Login persists in the partition. If the site signs in through Google or another identity provider that rejects embedded browsers, login can fail (L, not tested). Atlassian's terms on a user viewing the site in an app browser were not read (unverified).
- Native rendering from connector data is possible only through the agent (the app cannot call connector tools), so it costs a model call per view. Not recommended for the first version.

Start a task from a ticket:
- Parse the key or URL in the app (pattern `[A-Z][A-Z0-9]+-\d+`; Emdash has `JIRA_KEY_PATTERN`, `triage-emdash.md`). Seed the first prompt: read the issue with `getJiraIssue` (summary, description, status, comments, links, subtasks), follow remote links to PRs and Confluence. A ticket picker needs a headless `claude -p` JQL call per query, so a typed key or a pasted URL is the first version (`greenfield-and-libraries.md`).

Observation and navigation:
- Viewed object: `/browse/KEY-123` in the tab URL, or the `selectedIssue=KEY-123` query parameter on board and backlog URLs (L). The tab title also starts with the key.
- Agent-driven navigation: the app tool `surface_open`/`browser_navigate` with the browse URL.

Outward actions:
- Create issue, edit fields, transition: reversible by a second edit, but visible to watchers and can trigger automation and notifications. Comment: visible and notifies; deletion is possible by the author but notifications are already sent. Worklog and issue links: reversible. Confluence page update: version history exists.
- Draft-then-approve: comments, transitions to Done or a customer-visible state, assignee changes, issue creation in a shared project. Auto-allowed: all reads.

### Slack

Agent access:
- The claude.ai Slack connector is available here. Tools seen: read `slack_read_channel`, `slack_read_thread`, `slack_read_canvas`, `slack_read_file`, `slack_read_user_profile`, `slack_search_public`, `slack_search_public_and_private`, `slack_search_channels`, `slack_search_users`, `slack_search_emojis`, `slack_list_channel_members`, `slack_get_reactions`; write `slack_send_message`, `slack_send_message_draft`, `slack_schedule_message`, `slack_add_reaction`, `slack_create_canvas`, `slack_update_canvas`.
- Slack's official MCP server is at `https://mcp.slack.com/mcp` (Streamable HTTP), acts with user tokens through confidential OAuth, and is limited to Marketplace-published and internal apps; rate limits are per tool and the same as the Web API (https://docs.slack.dev/ai/slack-mcp-server/, H). Slack also ships a Claude Code plugin and documents direct `claude mcp add` use, with OAuth completed through `/mcp` and possible admin approval (M, from search summaries). Interactive authorization is needed; whether the workspace admin has approved the connector was not checked.
- The docs say the server can "draft, format, and preview messages directly within AI clients"; whether a draft is saved in Slack is not stated (L, inference). The draft tool is therefore a natural fit for draft-then-approve, but it does not by itself stop `slack_send_message`.

Human view:
- Embedded web client in a browser surface with a persistent partition: technically open (`surfaces-and-browser.md`). Terms: the User Terms (https://slack.com/terms-of-service/user, H) do not address automated access and incorporate an Acceptable Use Policy that sits in a Salesforce PDF; its text was not read in this pass, so scripted reading of the logged-in web client is unverified. Manual viewing in an embedded browser carries the same exposure as any browser (L). Observation by reading the page text of the web client is the scripted case; the connector route avoids it.
- Native rendering: the Web API route for non-Marketplace commercial apps is limited to one request per minute and 15 messages per request for history calls, and internal customer-built apps are exempt (`surfaces-and-browser.md`, M). A personal internal app needs workspace admin approval (not verified for this workspace). Native rendering through the agent works with the connector tools at the cost of a model call.
- Recommendation: embedded web client for viewing, connector for the agent's reads and writes, observation limited to the URL and title unless the user switches text reading on per surface (R13).

Start a task from a thread:
- Input: a Slack permalink (`https://<workspace>.slack.com/archives/<channel>/p<ts>`, with `thread_ts` for replies, L) or the current tab URL. Seed the prompt with channel id and thread timestamp and tell the agent to call `slack_read_thread`, then read linked Jira keys and PR URLs from the messages. Nothing to pull in the app itself.

Observation and navigation:
- Viewed object: `app.slack.com/client/<team>/<channel>[/thread/<channel>-<ts>]` (L, not re-verified). Navigation: load the same URL or the deep link `slack://channel?team=<id>&id=<id>` (L) in the tab.

Outward actions:
- Send message: not reversible in effect (the message can be edited or deleted, but notifications and reads already happened; edit history and retention may be visible to admins). Scheduled message: reversible until it fires. Reaction: reversible and low risk. Canvas create or update: reversible through canvas history (L). Public channels and DMs to people other than the user are the highest outward exposure of the four services.
- Draft-then-approve: every send and schedule, always, with the exact text and channel shown. Reactions can be a lower tier. Reads of private channels and DMs are a privacy issue for observation (R13), so they follow the folder scope.

### GitHub

Agent access:
- `gh` with the user's existing login; the app stores no token (`greenfield-and-libraries.md`). `gh pr view --json` fields include `files`, `reviews`, `latestReviews`, `reviewDecision`, `statusCheckRollup`, `comments`, `headRefName`, `baseRefName`, `mergeable`, `closingIssuesReferences`, `author`, `body` (https://cli.github.com/manual/gh_pr_view, H). Inline review comments need `gh api repos/{owner}/{repo}/pulls/{n}/comments`. List, diff, checkout, checks and review creation are available through `gh pr list|diff|checkout|checks` and `gh api` (`greenfield-and-libraries.md`). No interactive authorization once `gh auth login` is done; scope limits follow the token. A GitHub MCP server is an alternative, not needed.
- Local rule from the spike plan: do not start `claude` in a PR checkout without `--setting-sources user --strict-mcp-config`, since the checkout is untrusted code.

Human view:
- Embedded web view of `github.com/<owner>/<repo>/pull/<n>` in a persistent partition (GitHub sends frame-blocking headers, L, irrelevant for top-level views), or a native PR screen built on `gh --json` as Nimbalyst, Emdash and the VS Code PR extension already do (`triage-*.md`). The GitHub Terms of Service (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service, H) restrict abusive or excessive API requests (section H) and do not prohibit a personal user from viewing the site in a browser; automated scraping of web pages is not addressed in the passages read.

Start a task from a pull request:
- Parse owner, repo and number from the URL, map to a local project by remote, run `gh pr view --json headRefName,baseRefName,title,body,files,reviews,statusCheckRollup,closingIssuesReferences,isCrossRepository`, create a worktree for the head ref (fork-aware; Emdash has this plan in `compile-worktree-git-plan.ts`), start the session there with the PR description, review threads and failing checks as context. Issue start: `gh issue view --json`. Already implemented in part: Emdash (PR combobox, not URL paste) and Nimbalyst (`canonicalPrUrl`, review sessions, tracker overlay) (`triage-emdash.md`, `triage-nimbalyst.md`).

Observation and navigation:
- Viewed object: `/pull/<n>`, `/pull/<n>/files`, `/issues/<n>`, `/actions/runs/<id>`, `/commit/<sha>`. Navigation: open the URL in the tab, or open the native PR screen.

Outward actions:
- Comment and review comment: editable and deletable, notifications sent. Review submit (approve, request changes): can be dismissed, visible. Push: reversible only by force push or revert, and can trigger CI and deployment. PR create: closable. Merge: not reversible without a revert commit, and may trigger release or deployment; closing a PR and branch deletion are partly restorable. Workflow dispatch and release creation: effects outside GitHub.
- Draft-then-approve: merge, review submit, approve, PR comments, issue comments, pushes to shared branches, release and workflow actions. Pending reviews on GitHub are a built-in draft state (create review leaves it pending until submitted); the user's `gh-create-pr-review` skill already works this way.

### Notion

Agent access:
- The claude.ai Notion connector is available here with a large tool set. Read: `notion-search`, `notion-fetch`, `notion-get-comments`, `notion-query-data-sources`, `notion-list-recent-pages`, `notion-list-page-backlinks`, `notion-get-users`, `notion-view-version`. Write: `notion-create-pages`, `notion-update-page`, `notion-create-comment`, `notion-create-database`, `notion-update-data-source`, `notion-move-pages`, `notion-duplicate-page`, `notion-create-suggested-edit`, `notion-delete-pages`, `notion-delete-databases`, `notion-delete-comment`, calendar write tools, and session tools (`notion-spawn-session`, `notion-send-message-to-session`).
- Notion's hosted MCP is `https://mcp.notion.com/mcp`; OAuth acts as the signed-in user with the user's permissions; workspace guests cannot connect; workspace owners on Business and Enterprise plans can issue an MCP token for bearer-token use without a browser (https://developers.notion.com/guides/mcp/get-started-with-mcp, H). Claude Code setup in the docs is `claude mcp add --transport http notion https://mcp.notion.com/mcp` plus OAuth in `/mcp`. Rate limits are referenced to an FAQ page that was not read (unverified).

Human view:
- Embedded web client at `notion.so` or the workspace domain in a persistent partition (L; Notion's terms on embedded browsers not read, unverified). Native rendering from `notion-fetch` is possible (it returns enhanced Markdown, L) and fits a document surface in a base with a Markdown editor (Nimbalyst), but the app cannot call the tool itself; it goes through the agent.

Start a task from a page:
- Input: a page URL (`https://www.notion.so/<workspace>/<title>-<32 hex id>` or `?p=<id>`, L). Seed the prompt with the URL and tell the agent to `notion-fetch` it, including comments through `notion-get-comments`, and linked Jira keys and PRs. Databases: `notion-query-data-sources` for a task board.

Observation and navigation:
- Viewed object: the 32-character page id at the end of the path, or the `p=` parameter with `pm=s` for side peek (L). Navigation: load the URL in the tab.

Outward actions:
- Create and update pages: reversible through page history and `notion-restore-pages` and `notion-restore-version` (tools exist in the connector; behavior not tested). Comments: deletable. Delete pages or databases: go to trash, restorable for a retention period (L). Edits to shared pages are visible to others in real time and can notify mentioned users. `notion-create-suggested-edit` is a built-in draft form for edits to someone else's page.
- Draft-then-approve: edits to pages the user does not own, deletes, moves, comments that mention people. Creating a private draft page (the connector's `creation_mode: draft`) is low risk and can run unattended.

## 3. Linear and Discord, briefly

- Linear: official MCP server `https://mcp.linear.app/mcp` (Streamable HTTP, read and write), a read-only endpoint `/mcp/readonly`, OAuth 2.1 or a bearer token (OAuth access token or API key); the older `/sse` endpoint is deprecated (https://linear.app/docs/mcp, H). The claude.ai connector for Linear is listed in this session as needing authorization. Same pattern as Jira: connector for the agent, `linear.app/<team>/issue/<KEY>` as the object URL (L). Emdash already has a Linear issue plugin with token auth (`triage-emdash.md`), which conflicts with the no-token rule unless limited to a read-only key.
- Discord: no connector found in this session. The user-token route is prohibited by Discord (`surfaces-and-browser.md`, section 4); the bot route needs a bot added to a server the user administers. Embedded web client for manual viewing only. Object URL `discord.com/channels/<guild>/<channel>[/<message>]` (L). Outside the first release.

## 4. Approval policy input for R19

| Class | Examples | Default |
|---|---|---|
| Read | get issue, read thread, fetch page, `gh pr view` | allow, logged |
| Private-scope read | private channels, DMs, other people's pages | allow only within the folder's declared scope, logged |
| Reversible write by the user only | private Notion draft, own PR comment edits, reactions | allow with notice |
| Visible write, hard to retract | Slack send, Jira comment or transition, GitHub review submit or comment, Notion edit of shared page | draft-then-approve with exact text shown |
| Effects outside the service | merge, push to shared branch, release, workflow dispatch, delete pages | approve every time, shown at the highest ladder level |

Mechanism: the app receives `can_use_tool` (stream-json) or a `PermissionRequest` hook (PTY) with `tool_name` and `mcp_server` (RESULTS.md findings 2 and 3), maps the tool name to the class above, and shows the draft in the app. Both see only calls that would otherwise prompt; a call approved by a mode, an allow rule or the auto-mode classifier never reaches them, so the app also passes explicit ask rules for every outward connector tool (ask rules force a prompt in auto mode) and a `PreToolUse` hook (`review-ladder-design.md`, review corrections). Connector tools are named `mcp__claude_ai_<server>__<tool>`, for example `mcp__claude_ai_Slack__slack_send_message` (permissions docs and this session's tool list); a connector can also be blocked by server name in `deniedMcpServers`. Whether permission rules and `can_use_tool` match these names in a run is not probed.

Organization controls: under an organization claude.ai account, admins can mark connector tools `blocked` or `ask`, and Claude Code enforces this locally. These controls sit beside the app's gate, can override it, and may be outside the user's control.

Precedence trap: a server configured in Claude Code takes precedence over a claude.ai connector at the same URL, and the connector is then hidden. A base that writes Atlassian or Notion MCP entries can shadow the user's connectors (Emdash catalog: `https://mcp.atlassian.com/v1/mcp/authv2`, `https://mcp.notion.com/mcp`; Nimbalyst preset: `mcp.atlassian.com/v1/sse`). Whether these URLs match the connector endpoints was not checked (L).

## 5. Scores for R17 per base

Common to all bases: agent access works through the CLI today (score 3 on that half). Differences are in the human surface, task start, observation, navigation and the gate. R17 weighs 3. Effort is days to reach 3 for one engineer plus agents, excluding the shared R19 machinery but including the tool-name policy table.

| Base | Score | Effort days | Rationale and evidence |
|---|---|---|---|
| nimbalyst | 2 | 14 | App-hosted MCP with `display_to_user`, browser tools (open, navigate, get_page_info, screenshot) as extension tools and `notify_user` (`surfaces-candidates.md`, `triage-nimbalyst.md`); GitHub PR mode on `gh` with PR URL parsing (github.com only) and tracker overlay. Gaps: no Jira code (a preset runs `mcp-remote` against the v1 SSE URL, which the notice makes obsolete), no Slack or Notion surface, browser is an editor tab and not a tree leaf. `browser.get_page_info` already gives the agent the viewed URL. Work: Jira key start (about 1.5), Slack permalink and Notion URL start (about 1.5), replace the obsolete Atlassian v1 preset (about 0.5), Slack, Notion and Jira surface types over the browser extension with URL observation (about 5), navigate and open tools for these (about 2), connector policy table and approval UI hookup (about 3). Medium confidence. |
| emdash | 1 | 18 | Integration plugins for Jira, Linear, GitHub, Notion and others (also Asana, Forgejo, GitLab, Monday, Plain, Plane, Trello, YouTrack) exist, but they use stored tokens, which 0001 excludes. An MCP catalog (`core/primitives/mcp/api/catalog.ts`) adds OAuth remote MCP servers without storing tokens, which 0001 permits; the PR flow and fork-aware worktree plan are solid (`triage-emdash.md`). Browser is a task tab, no app-hosted MCP and no agent-facing open or focus API, so navigation and observation are new (`surfaces-candidates.md`). Work: PR URL start (about 2), Jira key start (about 1.5), Slack permalink and Notion URL start (about 1.5), app MCP with navigate and observe (about 5), service tabs and URL observation (about 4), policy table (about 3), minus reuse of the Notion and Linear plugins if token use is later allowed. Scored 1: its effort exceeds the greenfield effort. Medium confidence. |
| superset | 1 | 17 | Scored from `surfaces-candidates.md` and a file listing of `candidates/superset`, low confidence. Embedded browser pane with persistent partition and CLI browser control (`superset browser open|navigate|screenshot|eval`) usable by Claude from a terminal; its MCP server has no browser or pane tools. The Slack, Notion and Linear integrations live in the hosted backend (`apps/api/src/app/api/integrations/`), run an agent through the Anthropic SDK and hold service tokens on the server, so none is reusable under 0001. Work: URL start flows for PR, Jira and Notion, tool exposure for navigation, observation of pane URLs, policy table. Pane registry is a fixed list, so new service types touch core. |
| vscode | 1 | 19 | Integrated Browser exists as an editor tab with chat tools, GitHub Pull Requests extension covers PR browse and review UI, but no PR data API was found (`triage-vscode.md`, `surfaces-candidates.md`). Reading the URL and title of an integrated browser tab from an extension, and opening URLs in it, were not verified; a custom webview cannot show Slack or Jira reliably (L). Work: extension-hosted MCP with open and observe tools (about 5), Jira, Slack and Notion tab handling through the unverified browser APIs or webviews (about 6), PR start through `gh` and worktrees (about 2), Jira, Slack and Notion task start (about 2), approval UI in a webview (about 4). Pages the agent opens in the Integrated Browser use isolated ephemeral sessions, so they are not logged in unless the user shares a tab, and its browser chat tools belong to VS Code's own chat agents, not to the `claude` CLI. Low confidence on the browser API. |
| greenfield | 1 | 17 | Nothing exists, but nothing conflicts. Work over the R12 browser surface: service presets and partitions for Jira, Slack, GitHub and Notion (about 2), URL observer and object recognition per service (about 2), open and navigate tools for service objects (about 1.5), start dialog for PR URL with worktree (about 2), Jira key (about 1.5), Slack permalink (about 1) and Notion URL (about 1), connector status from `mcp_status` (about 1), policy table and approval UI with draft dialogs (about 3), ask rules per connector tool, a `PreToolUse` command inspector and a sandbox network allowlist (about 2). Libraries: `gh --json`, connector through the CLI, Electron `WebContentsView` (`greenfield-and-libraries.md`, `surfaces-and-browser.md`). Scored 1 because no part is built. The itemization was added after the review, low confidence. |

Overlap: 0001 counts GitHub PRs (R5) and task start (R6) as separate must-haves, so R17 effort for PR and Jira start may be counted twice in combined totals.

Reading the table: the forks save little on R17 because the agent half is base-independent and the human half is surface and tool work that each fork either lacks or implements in a form (token plugins, fixed pane lists) that needs changes. Nimbalyst has the most useful pieces (app MCP, browser tools, `gh` PR flow, extension SDK).

## 6. Measurements (dated)

| Date | Item | Value | Source |
|---|---|---|---|
| 2026-11-17 | Claude Code version | 2.1.326 | `probes/RESULTS.md` |
| 2026-11-17 | Atlassian connector v1 date | 2027-03-01 (removal per the connector notice; automatic exposure of v2 tools per Atlassian) | connector instructions, Atlassian support page |
| 2026-11-17 | Slack history limit, non-Marketplace commercial apps | 1 request per minute, 15 messages | `surfaces-and-browser.md`, M |

## 7. Not verified

- Slack Acceptable Use Policy text (Salesforce PDF) on automated access; Notion, Atlassian and Discord terms on app-embedded browsing or scripting.
- Whether Google-based SSO works inside an Electron partition for Atlassian and Slack.
- Frame-blocking headers of Atlassian, Slack, GitHub and Notion (irrelevant for top-level views, not read).
- Slack and Notion URL formats and Slack deep-link scheme (general knowledge).
- Notion restore tools and canvas history behavior; Notion MCP rate limits.
- Whether permission rules and `can_use_tool` match claude.ai connector tool names in a run (the shape was proven for app MCP tools only).
- The status of the `Atlassian MCP` and `Rovo` entries.
- Superset's R17 score is low confidence.
- Connector write tools (no probe called one).
- Linear and Discord connectors were not exercised.

## 8. Sources

- https://code.claude.com/docs/en/mcp
- https://docs.slack.dev/ai/slack-mcp-server/
- https://slack.com/terms-of-service/user
- https://slack.com/acceptable-use-policy
- https://developers.notion.com/guides/mcp/get-started-with-mcp
- https://developers.notion.com/guides/mcp/mcp-supported-tools
- https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/
- https://linear.app/docs/mcp
- https://cli.github.com/manual/gh_pr_view
- https://docs.github.com/en/site-policy/github-terms/github-terms-of-service

## Review corrections

An independent review checked this note against the docs, the clones and the probe results. Changes made:

- Atlassian writes are listed, not exercised; only a read call ran.
- Connector authorization happens in claude.ai; `claude mcp login` covers servers configured in Claude Code. "Connector OAuth in the PTY path" is no longer a base gap.
- The Atlassian v1 date: the connector notice says removal, Atlassian says v1 use moves to v2 tools automatically. Both are cited.
- Slack draft tools: whether a draft is saved in Slack is not stated (L).
- Superset's Slack, Notion and Linear integrations are in the hosted backend with the Anthropic SDK and server-held tokens; not reusable under 0001. Superset R17 2 / 15 to 1 / 17 (low confidence).
- Emdash R17 2 / 16 to 1 / 18: its effort exceeds greenfield; Slack and Notion start added; the MCP catalog noted.
- Nimbalyst 2 / 12 to 2 / 14: Slack and Notion start, Atlassian preset replacement.
- VS Code 1 / 17 to 1 / 19: three more start flows; agent-opened pages are ephemeral sessions.
- Greenfield 1 / 15 to 1 / 17, itemized: the R19 review adds ask rules per connector tool, a `PreToolUse` command inspector and a sandbox network allowlist to the gate.
- Connector tool names follow `mcp__claude_ai_<server>__<tool>`; only matching in a run is unverified.
- Added: organization controls on connector tools, the precedence trap for same-URL servers, the overlap with R5 and R6.
