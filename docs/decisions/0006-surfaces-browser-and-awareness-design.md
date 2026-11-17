# 0006 Surfaces, embedded browser and shared awareness: design

Status: proposed
Date: 2026-11-17
Inputs: `notes/surfaces-and-browser.md`, `notes/surfaces-candidates.md`, their reviews in this run, `probes/RESULTS.md`, 0002, 0004, 0005
Updated: 2026-11-17, section 8 and consequences from the reviewed R16 and R17 findings (`notes/collaboration-tooling.md`, `notes/swarm-visibility.md`)

## Context

0002 makes every tree leaf a surface (Claude session, browser tab, Slack thread first; Discord and others later) added without changing the core (R12). The agent of a project folder observes the user's activity in that folder's surfaces, scoped, switchable and visible (R13). The agent can open, focus, reveal and highlight to show the user something (R14, part of R8). The Claude in Chrome tools should work in the embedded browser, or the app hosts equivalents (R15).

0005 shows that no candidate has a browser tab as a left-tree leaf today, or observation that is scoped to a project folder and switchable per surface. VS Code's "Share with Agent" consent covers its integrated browser only, and its docs name no Claude harness for it (`notes/surfaces-candidates.md`). The design below assumes the greenfield Electron base chosen in 0007; it carries over to a fork only through that fork's core.

## Decision

### 1. Surface interface

A main-process registry of surface types. Each type provides creation, persistence, rendering, observation and actions:

```ts
interface SurfaceType<State extends object = object> {
  id: string;                    // "claude-session" | "browser-tab" | "slack-thread"
  label: string; icon: string;
  create(input: SurfaceCreateInput): Promise<State>;   // from URL, ticket, prompt
  title(state: State): string;
  serialize(state: State): unknown;                    // stored with the tree node
  restore(saved: unknown): State;
  mount(host: SurfaceHost<State>): SurfaceInstance;    // owns a view; focus, reveal, dispose, setBounds
  observe?: ObserveSpec<State>;                        // modes, snapshot (pull), onChange digest (push), redact
  tools?: SurfaceTool<State>[];                        // registered on the app MCP server
  actions?: SurfaceAction<State>[];                    // same registry feeds menus, commands and MCP tools
}
```

- The tree stores surface instances (type id plus serialized state) under folders. The core owns the tree, folder scoping, the per-surface observation switch, the indicator and the access log. A type cannot bypass them.
- Core tools are type-independent: `surfaces_list` (folder-scoped), `surfaces_observe`, `surface_open`, `surface_focus`, `surface_reveal`, `surface_highlight`. Types add their own tools.
- One command registry drives menus, keyboard commands and MCP tools, so every UI action has a tool (R8 parity by construction). Tool names follow `<area>_<verb>`.
- First-party types are compiled in. Loading third-party types as Node modules in a utility process (the Nimbalyst backend-module pattern) is later work; the interface keeps state and views serializable to allow it.
- Discord or any later type is a new module implementing this interface, with no core change.

### 2. Embedded browser

- Each browser surface is a `WebContentsView` attached to the window, with a persistent session partition per service (logins survive restarts; partitions keep services apart).
- The app attaches `webContents.debugger` in process and exposes browser tools on its own MCP server. No remote-debugging port is opened. Opening DevTools detaches the debugger, and the tools report that state.
- Highlights inside pages come from CDP overlays or injected script, because the view is a native layer above the app's DOM.
- Page content returned to the agent is labelled as untrusted page content.

### 3. Claude in Chrome (R15)

| Option | Feasibility | Effect |
|---|---|---|
| A. Load the stock extension into Electron | Not feasible as documented. The extension needs `debugger` and `tabGroups` permissions (Anthropic support page, via search summary; manifest not read), and Electron's supported extension APIs include neither, nor native messaging. Claude Code writes a native messaging host manifest into the configuration directories of Chromium browsers, and its docs name `bridge.claudeusercontent.com` as a host the connection needs; the wire protocol is not documented. Impersonating the native host relies on that undocumented protocol. | – |
| B. Superset's extension host | Superset loads Web Store extensions and emulates native messaging from Chrome's host manifest directories. No `chrome.debugger` shim was found, so page tools may fail. Not run. | Only relevant on a Superset base; undetermined |
| C. App hosts equivalent tools over CDP | Feasible. Most tools map to CDP calls. | R15 2, about 9 days (low confidence) |
| D. Browser leaf tracks a tab in the user's real Chrome | Feasible; Claude in Chrome works unmodified today. Not verified as a design. | R15 3 for those leaves; the tab is not embedded, so it does not meet R12 for browser leaves |

Recommendation: C as the default, with D as a per-leaf option ("open in Chrome") for sites where the stock extension's behaviour matters. The app's browser server cannot be named `claude-in-chrome` (reserved; Claude Code skips it). Working name: `browser`, not yet checked against reserved built-in names.

Tool names that carry over in option C, with semantics to match:

| Claude in Chrome tool | Hosted equivalent | Notes |
|---|---|---|
| `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp` | same names | tab ids are surface ids; scoping is the folder in place of a tab group |
| `navigate`, `resize_window` | same | |
| `read_page`, `get_page_text`, `find` | same | `read_page` element references must be stable and shared with `computer` and `form_input`; `find` is partial |
| `computer` | same | screenshot-to-coordinate scaling must match the extension |
| `form_input`, `file_upload`, `upload_image` | same | |
| `javascript_tool`, `read_console_messages`, `read_network_requests` | same | |
| `browser_batch` | same | |
| `gif_creator` | partial | recording from screenshots |
| `list_connected_browsers`, `select_browser`, `switch_browser` | not provided | one embedded browser |

Matching names alone does not let skills written for Claude in Chrome transfer; input schemas and semantics must match too. The schemas are available from a session's tool list and were not compared in this run. A per-site permission prompt is part of the work.

### 4. Observation and delivery to the agent (R13)

What a browser surface can report: URL, title, visible text, selection, accessibility tree, and a screenshot on request (CDP and webContents events; not exercised). A session surface reports status and last message from hooks or stream events (0004). A Slack surface reports channel and thread ids from the URL.

| Route | Status | Use |
|---|---|---|
| Pull: `surfaces_observe` on the app MCP server | The route works: P3 shows app MCP tools reach the CLI in both launch paths. The tool itself is not built | Primary. Output warns above 10,000 tokens and caps at 25,000 by default |
| Hook digest: `additionalContext` from `UserPromptSubmit` (also `PostToolUse`, `PostToolBatch`, `Stop`) | Documented, not exercised in a probe | A short digest per turn: which surfaces in the folder changed, with URL and title. Worded as data, not instructions. Cap 10,000 characters |
| Channels | Research preview; interactive only with a development flag; ignored with `-p`; Team and Enterprise organisations must enable them | Not used |
| MCP resource subscriptions | `list_changed` refreshes resources only in interactive sessions; `resources/updated` handling not documented | Not used |

Recommendation: pull as the main route and a hook digest as the notice that something changed. Full text and screenshots go to the agent only when it calls the tool.

Scoping: the app MCP server URL carries the session's folder id and token. `surfaces_list` and `surfaces_observe` resolve only surfaces of that folder. Another folder's surfaces are invisible to that agent.

### 5. Privacy controls

- Per-surface state `off`, `on-demand` or `live`, stored with the surface. Default `on-demand` for browser tabs and Claude sessions, `off` for Slack and Discord surfaces. `off` detaches the debugger and the tool returns "observation off" with no content.
- A visible indicator on the tree row and on the tab while observation is on, and a stronger mark while live.
- An access log in the UI: which surface, which kind (summary, text, screenshot), size, which session, time. Observed content itself is not stored.
- Redaction: password fields never leave the page; a user list of URL patterns (banking, HR, personal mail) is always `off`.
- Observation of Slack and Discord content is read through the connector or official API, not scraped from the web client (section 6).

### 6. Slack and Discord

| Option | Feasibility | Terms-of-service risk | Recommendation |
|---|---|---|---|
| Slack: web client in a browser surface, ids from the URL, agent reads the thread through the claude.ai Slack connector (`slack_read_thread`) | Feasible; URL format from general knowledge, not verified | Manual use in a browser; no scripted reading of the client | Recommended first type |
| Slack: scripted reading of the web client DOM | Feasible technically | The Acceptable Use Policy text on automated access was not read; undetermined | Not recommended |
| Slack: native rendering through the Slack API with an internal app | Feasible; internal customer-built apps are exempt from the non-Marketplace rate limits; more UI work; the app stores a Slack token; an internal app needs workspace admin approval, not verified for the user's workspace | Supported API | Later, if the web client is not enough |
| Discord: web client in a browser surface, manual use only | Feasible | Terms bar scraping without consent and unauthorized software; manual viewing in a browser is not addressed in the terms text | Viewing only; no observation of content |
| Discord: user token automation | Feasible technically | Prohibited by Discord; account termination risk | Excluded |
| Discord: bot on a server the user administers | Feasible | Supported route under the Developer Terms (text not read) | Recommended when Discord is added |

### 7. Agent shows things (R14)

`surface_open`, `surface_focus`, `surface_reveal` (tree and editor), `surface_highlight` (tree row, editor range, page element through CDP overlay) and `browser_navigate` come from the command registry. App actions an agent takes are shown in the access log next to observations.

### 8. Service objects in browser surfaces (R17)

Jira, GitHub, Slack and Notion objects show in browser surfaces, one persistent partition per service, and the agent reads and writes through connectors and `gh` (`notes/collaboration-tooling.md`, 0011). The browser surface type carries a service recognizer: URL patterns that map the current URL to `{service, kind, id}` (Jira issue key, PR owner/repo/number, Slack channel and thread timestamp, Notion page id). The recognizer feeds these uses:

- observation: `surfaces_observe` reports the recognized object with URL and title, so the agent can fetch the object through its connector without reading page text;
- task start: "start task from this tab" seeds the prompt from the recognized object (0011);
- outward actions: the approval dialog links the target object to its open surface, if any.

The Jira and GitHub patterns come from primary sources; the Slack and Notion URL formats are general knowledge and unverified. Agent subagents shown under a session (R16, 0009) are tree nodes owned by the session surface, not surface instances: they have no view of their own except the read-only transcript viewer.

## Consequences

- The surface interface, the browser surface with CDP tools and the observation switch are core work in stage 2, not later additions (0002).
- R15 depends on matching tool schemas and semantics; until that is done, skills written for Claude in Chrome do not carry over.
- Browser leaves opened in real Chrome (option D) are outside the app's observation and highlight tools; Claude in Chrome covers them.
- Slack observation depends on the claude.ai Slack connector; if it is removed, the Slack surface shows the thread but the agent cannot read it. Under an organization claude.ai account, admins can mark connector tools `blocked` or `ask`, and Claude Code enforces that locally, so the same holds when an admin blocks the read tools.
- A Claude Code MCP server configured at the same URL as a claude.ai connector hides the connector. The app never writes MCP entries for Atlassian, Slack, GitHub or Notion endpoints; it relies on the user's connectors.
- Not verified: Electron partition option names and Overlay behaviour in a `WebContentsView`; several CDP clients on one webContents; attach of Playwright MCP or chrome-devtools-mcp to Electron targets; Slack AUP and Discord Developer Terms text; Slack web client frame headers; the reserved-name status of `browser`; the Claude in Chrome extension manifest (the `debugger` and `tabGroups` permission claim in option A has no source in `notes/`).
