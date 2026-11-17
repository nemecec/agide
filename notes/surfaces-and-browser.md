# Surfaces, shared awareness and embedded browser (R12 to R15)

Date: 2026-11-17. Base-independent research; scores are for a greenfield Electron shell. Confidence: H high, M medium, L low. Items not read or not verified are listed at the end.

## Summary

- The Claude in Chrome extension cannot run inside Electron: it depends on native messaging and the Chrome Web Store build, and Electron supports neither (H for Electron's side, M for the extension's internals, which were not inspected). The app hosts equivalent browser tools instead, over `webContents.debugger` (CDP), and exposes them through the app's own MCP server.
- Claude in Chrome tool names are listed below from this session's tool list (H). Most carry over by name and intent; `tabs_*`, `browser_batch`, `gif_creator`, `switch_browser`, `select_browser` and `list_connected_browsers` need app-specific meaning.
- R13 delivery: pull through an MCP tool is the economical default and works today. Push has several routes with limits: hook `additionalContext` (10,000 character cap, tied to hook events), channels (research preview, interactive mode only, development flag), and MCP resource subscriptions (not acted on by Claude Code, M).
- Slack: reading through the claude.ai Slack connector or the Slack API and rendering natively is the lower-risk route. Embedding the web client is technically open (a persistent partition logs in like a browser), with terms questions that were not resolved from the primary text. Discord: user-token automation is prohibited by Discord's support statement (H).

## 1. Claude in Chrome

Sources: https://code.claude.com/docs/en/chrome (H), tool list of this session (H).

How it works:
- A Chrome Web Store extension ("Claude in Chrome", version 1.0.36 or later) plus a native messaging host manifest that Claude Code writes on first enable: `com.anthropic.claude_code_browser_extension.json` under the browser's `NativeMessagingHosts` directory (macOS Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`). Chrome reads it at startup.
- Claude Code detects the extension and connects; other Chromium browsers (Edge, Brave, Arc, Vivaldi, Opera) read the same file from their own directories. The docs also name `bridge.claudeusercontent.com`; the extension must be signed in to the same claude.ai account and organization as the CLI. A relay through that host is implied by the error table (M); the wire protocol is not documented.
- Requires `/login` with a claude.ai plan (API key or setup-token turns it off); `--chrome` or `/chrome` "Enabled by default" turns it on; a project settings file cannot turn it on (`CLAUDE_CODE_ENABLE_CFC` is ignored there).
- Site permissions are managed in the extension. Enabling by default raises context use because tool definitions are always loaded.
- Tools (server `claude-in-chrome`, names as `mcp__claude-in-chrome__<tool>`): `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`, `navigate`, `computer`, `read_page`, `find`, `get_page_text`, `form_input`, `javascript_tool`, `read_console_messages`, `read_network_requests`, `resize_window`, `upload_image`, `file_upload`, `gif_creator`, `browser_batch`, `list_connected_browsers`, `select_browser`, `switch_browser`.

Electron feasibility (https://www.electronjs.org/docs/latest/api/extensions, H):
- `session.loadExtension(path)` takes an unpacked directory only, persistent sessions only, per launch; `.crx` does not work; arbitrary Chrome Web Store extensions are not supported and full Chrome compatibility is a non-goal.
- Supported APIs: `runtime`, `tabs` (partial), `scripting`, `storage`, `webRequest`, `devtools.*`, `management`, `extension`, `system.storage`. The page lists neither native messaging (`runtime.connectNative`) nor `chrome.debugger`.
- Consequences: the Claude Code side has no native messaging host to find in an Electron app, and the extension's own transport and any `chrome.debugger` use (M, not inspected) have no support. An app that wrote the host manifest and impersonated the host would depend on an undocumented protocol and on the extension's own sign-in and bridge. Not recommended; effort and stability unknown (L).
- Name collision: whether an app MCP server named `claude-in-chrome` coexists with the built-in registration when `--chrome` is off was not tested.

Hosting equivalent tools:
- CDP through `webContents.debugger` (https://www.electronjs.org/docs/latest/api/debugger, H): `attach`, `sendCommand` with optional `sessionId`, `message` and `detach` events. Opening DevTools on the same webContents detaches the debugger. Multiple-client behavior is not documented.
- chrome-devtools-mcp (https://github.com/ChromeDevTools/chrome-devtools-mcp, Apache-2.0, H): Puppeteer-based; officially supports Chrome and Chrome for Testing only; its README states usage statistics are on by default (opt out flags exist) and the performance tools may send trace URLs to a Google API. It connects to a running browser through a remote debugging endpoint (flag names are in its advanced guide, not read here). Needs a debugging port, see section 2.
- Playwright MCP (https://github.com/microsoft/playwright-mcp, Apache-2.0, H): `--cdp-endpoint` attaches to an existing Chromium-family browser; snapshots are accessibility trees; tools include `browser_navigate`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_snapshot`, `browser_take_screenshot`, `browser_evaluate`, `browser_console_messages`, `browser_network_requests`, `browser_tabs`, `browser_file_upload`, `browser_highlight` (devtools cap). Whether it attaches to Electron's webContents targets through a port was not tested (L).
- Superset (changelogs, now redirected to paradev.com, M): design mode lets the user pick an element in the browser pane and sends DOM, styles, React component info and a cropped screenshot with a note to an agent. A separate "desktop automation" set of MCP tools lets Claude Code operate the app UI (screen capture, activate elements, enter text, read page structure). The changelog does not say whether agents control the in-app browser, and does not name tools. Implementation not inspected.
- Claude desktop app (https://code.claude.com/docs/en/desktop, H for what is stated): the Browser pane lets Claude start a dev server, take screenshots, inspect the DOM, click and fill forms, using "preview tools"; the same tools read external pages (managed setting `browserExternalPageTools`). No tool names are documented.

Matching Claude in Chrome (own implementation over CDP, effort in section 8):

| Claude in Chrome tool | Match in app | Note |
|---|---|---|
| `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp` | Yes | Tab group becomes the project folder's browser surfaces; scoped to the calling session's folder. |
| `navigate` | Yes | `Page.navigate`, back and forward. |
| `read_page` | Yes | `Accessibility.getFullAXTree` or `Page.captureSnapshot` with element refs. |
| `get_page_text` | Yes | `Runtime.evaluate` on `innerText`, or a readability pass. |
| `find` | Partial | Natural-language element search needs a model or a text and role matcher. |
| `computer` | Yes | `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Page.captureScreenshot`, scroll. |
| `form_input`, `file_upload`, `upload_image` | Yes | `DOM.setFileInputFiles`, `Input.insertText`. |
| `javascript_tool` | Yes | `Runtime.evaluate`. |
| `read_console_messages`, `read_network_requests` | Yes | `Runtime.consoleAPICalled`, `Network.*` buffers, started on attach. |
| `resize_window` | Yes | View bounds or `Emulation.setDeviceMetricsOverride`. |
| `gif_creator` | Partial | Screenshot frames plus an encoder; extra work. |
| `browser_batch` | Yes | Loop over actions in the app. |
| `list_connected_browsers`, `select_browser`, `switch_browser` | Not needed | One embedded browser. |

Permissions: the CLI prompts through its normal permission flow for MCP tools; per-site allow lists would be app work (the extension keeps its own).

## 2. Embedded browser building blocks in Electron

- `WebContentsView` (https://www.electronjs.org/docs/latest/api/web-contents-view, H): constructed with `webPreferences` or an existing `webContents`; attached to a `BaseWindow` with `contentView.addChildView`; positioned with `setBounds`. The page does not document partition options; the partition goes through `webPreferences.partition` or `session` (from the WebPreferences structure, M). Electron's webview documentation advises against `<webview>` (carried from `greenfield-and-libraries.md`).
- It is a native view layered over the window, so it does not take part in DOM layout: the renderer reports bounds for each tab slot and main applies them. Overlays (menus, highlights) in the app's React layer sit under the view; highlights inside a page therefore come from CDP-injected overlay nodes (`Overlay.highlightNode` or a script).
- Session isolation: one persistent partition per account or per project folder keeps Jira and Slack logins across restarts. Whether one partition per folder or one shared partition suits the user is a design choice; a shared partition keeps a single login (M).
- Per-tab debugger: `webContents.debugger.attach('1.3')` per surface, detached when observation is off. DevTools opening detaches it (documented), so the app reattaches or avoids DevTools on observed tabs.
- Remote debugging port (`--remote-debugging-port`): any local process can drive every tab, including logged-in sessions, unless bound and secured. Prefer in-process `webContents.debugger` behind the app MCP server with its token and Origin check (probe host in `probes/mcp_host.mjs`). Use a port only if an external tool such as chrome-devtools-mcp is wanted, bound to 127.0.0.1; it has no token (CDP HTTP and WebSocket endpoints are unauthenticated, M, general knowledge not re-verified here).
- Navigation guards: `setWindowOpenHandler` to route popups into new surfaces, `will-navigate`, permission handler denial, no preload, `contextIsolation`, no `nodeIntegration`.

## 3. Observation (R13)

Observable per browser tab through CDP and webContents events (M, standard CDP domains; not exercised here): `did-navigate`, `did-navigate-in-page`, `page-title-updated`; `Accessibility.getFullAXTree`; `DOM`/`Runtime` for `innerText` and `window.getSelection()`; `Page.captureScreenshot`; focus and visibility from view state; selection changes through an injected `selectionchange` listener (a `Runtime.addBinding` callback) kept in the app's world, not the page's.

Delivery to the agent, by what Claude Code supports (docs):

| Route | Status | Token cost and limits |
|---|---|---|
| Pull: app MCP tool such as `surfaces_observe` | Works today (probe P3 shows app MCP tools reach the CLI; tools are deferred behind ToolSearch, H) | Cost only when called; MCP output warns above 10,000 tokens and caps at 25,000 by default; text over 50,000 characters goes to a file (H). |
| Hook `additionalContext` on `UserPromptSubmit`, `PostToolUse`, `PostToolBatch`, `Stop` | Works today (H) | Injected every turn or tool batch; cap 10,000 characters per hook output; over the cap only the first 2,000 characters and a file path reach the agent (H). Hooks come from `--settings`, which the probes show applies in `-p` and PTY. Keep it to a one-line digest (current URL, title, change flag) and let the agent pull the detail. |
| Channels (`notifications/claude/channel`) | Research preview; custom channels need `--dangerously-load-development-channels`, interactive mode only (ignored with `-p`); org policy can block (H) | Events queue and arrive between turns as `<channel>` tags; Claude Code does not acknowledge delivery. Suited to "user navigated to X" notices, not to bulk text. Stdio server spawned by the CLI, so it would be a second MCP server next to the HTTP one. |
| MCP resources with subscriptions | Claude Code does not refresh context on `notifications/resources/updated`; `@` resource lists did not refresh on `list_changed` in reports (M, issue trackers, resolution of one issue not confirmed) | Not a dependable route. |

Recommendation: pull as the primary route plus a small hook digest scoped to the folder; channels as an optional later addition. Token trade-off: digest of a few hundred characters per turn versus full text only on request.

Scoping and switches (app design, no external dependency):
- The app MCP server is started per session with the session's folder id in its URL (as in the Nimbalyst notes); `surfaces_observe` and the hook script resolve only surfaces of that folder.
- Per-surface observation state `off | on-demand | live`, stored with the surface in the tree, default `on-demand`; `off` detaches the debugger and the tool returns "observation off" with no content.
- A visible indicator on the tab and tree row while observed; a log of what was handed to the agent (surface, kind, size) viewable in the UI.
- Redaction: skip password fields and configured URL patterns; observed text is untrusted data for the agent (prompt-injection exposure from web pages), so tool output is labelled as page content.

## 4. Slack and Discord as surfaces

Slack:
- Embedding the web client in a browser surface: a persistent partition signs in as in any browser; the current thread comes from the URL (`app.slack.com/client/<team>/<channel>/thread/<channel>-<ts>`; format from general knowledge, L, not re-verified here) and the title. Slack Work Objects docs show Slack requires other sites to allow Slack in `frame-ancestors`, which concerns the opposite direction; Slack's own headers were not checked. A `WebContentsView` is a top-level browsing context, so frame-blocking headers do not apply.
- Terms: the User Terms of Service incorporate an Acceptable Use Policy that sits in a Salesforce PDF; its text on automated access was not read, so the position on scripted reading of a logged-in web client is unverified.
- Reading through the claude.ai Slack connector: the agent already has `slack_read_thread`, `slack_read_channel` and related tools through the user's connector (listed in this session). The app gets no direct access to them (the CLI calls them), so a native-rendered thread would need the agent to fetch and the app to display, or the app to call the Slack API itself.
- Slack API: for commercially distributed apps not in the Marketplace, `conversations.history` and `conversations.replies` are limited to 1 request per minute and 15 messages per request (https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps, existing installs moved March 2026 per the FAQ, M); internal customer-built apps are exempt. A personal internal app in the workspace needs workspace admin approval and a user or bot token (not verified for the user's workspace).
- Native rendering is more work (messages, threads, files, emoji, mentions) than a web tab.

Discord:
- Terms (https://discord.com/terms, H for quoted points): scraping "without our written consent" is barred, as are unauthorized software that modifies the services and reverse engineering. Discord's support statement on automated user accounts says automation of normal user accounts is prohibited outside bot accounts and can end in account termination (https://support.discord.com/hc/articles/115002192352, via search result summary, M). Using a user token in the app, or scripting the web client, falls under that. Embedding the web client unmodified for manual use is not addressed in the terms text (H that it is silent); scripted reading of it is the risky part.
- Bot route: a bot account added to a server the user administers, through the Developer Terms. Claude Code's own Discord channel plugin uses this model (https://code.claude.com/docs/en/channels-reference, H).

Risk statement: manual use inside an embedded tab with the user's own login carries the same terms exposure as any browser. Automated reading of Slack or Discord web clients, and any use of a Discord user token, carries account-action risk for the user's work and personal accounts. The connector or official API route does not.

## 5. Surface extension interface

Prior art (docs and earlier notes):
- VS Code: custom editors and webview views with `postMessage`, `CustomEditorProvider` owning document and save (`notes/triage-vscode.md`).
- Nimbalyst Extension SDK: manifest `contributions.customEditors` and `panels`, `EditorHost` and `PanelHost`, `aiTools` per extension served at `/mcp/ext/<id>`; no extension point for the session tree in Agent mode (`notes/triage-nimbalyst.md`).
- Theia widgets, Obsidian plugin API (views registered by type, `getViewType`, `getState`/`setState`) and MCP Apps were not read for this note; named from general knowledge only (L).

Sketch (TypeScript, main-process registry with an optional renderer component):

```ts
interface SurfaceType<State extends object = object> {
  id: string;                       // "claude-session" | "browser-tab" | "slack-thread"
  label: string;
  icon: string;
  create(input: SurfaceCreateInput): Promise<State>;     // from URL, ticket, prompt
  title(state: State): string;
  serialize(state: State): unknown;                      // stored with the tree node
  restore(saved: unknown): State;
  mount(host: SurfaceHost<State>): SurfaceInstance;      // owns a view
  observe?: ObserveSpec<State>;
  tools?: SurfaceTool<State>[];
  actions?: SurfaceAction<State>[];
}

interface SurfaceInstance {
  focus(): void; reveal(): void; dispose(): void;
  setBounds?(r: Rect): void;
}

interface ObserveSpec<State> {
  modes: ("off" | "on-demand" | "live")[];
  snapshot(state: State, opts: { kind: "summary" | "text" | "screenshot" }): Promise<ObservedContent>; // pull
  onChange?(state: State, emit: (digest: string) => void): Disposable;                                 // push digest
  redact?(c: ObservedContent): ObservedContent;
}

interface SurfaceTool<State> {   // registered on the app MCP server as surface_<type>_<name>
  name: string; description: string; inputSchema: JsonSchema;
  run(state: State, args: unknown, ctx: { folderId: string }): Promise<ToolResult>;
}

interface SurfaceAction<State> {  // same registry feeds menus, commands and MCP tools
  id: string; run(state: State, args?: unknown): Promise<void>;
}

interface SurfaceHost<State> {
  state: State; setState(s: Partial<State>): void; setTitle(t: string): void;
  folderId: string; openSurface(type: string, input: SurfaceCreateInput): Promise<string>;
}
```

- Core tools stay type-independent: `surfaces_list` (folder-scoped), `surfaces_observe`, `surface_open`, `surface_focus`, `surface_reveal`, `surface_highlight`. Type tools add behavior: `browser_*` for tab control, `slack_open_thread` and so on. Observation and tools are gated by the folder id and the per-surface switch in the core, not in each type.
- Slack type via embedded web client: state `{ url }`; `mount` is a browser surface with a Slack partition; `observe` reads the URL, channel and thread ids and, if allowed, text through the browser type; no new core code. Via native rendering: state `{ channelId, threadTs }`; `snapshot` reads through the Slack API or asks the agent to fetch.
- Discord type: same shape. Embedded web client reuses the browser type with a URL pattern and no scripted reading; a bot-token type is a native renderer plus the bot API.
- Packaging: first-party types compiled in, third-party types loaded as Node modules in a utility process (the Nimbalyst backend module pattern) is later work; the interface keeps data and views serializable to allow it.

## 6. Agent drives the UI (R8, R14)

- The app hosts a Streamable HTTP MCP server on 127.0.0.1 with token and Origin check; probes show `"type":"http"` entries work in `-p` and PTY, tool errors reach the agent, and the tools are deferred behind ToolSearch (`probes/RESULTS.md`, H).
- Claude desktop docs describe behavior without tool names (section 1); no public naming convention to follow. Nimbalyst names its host server tools by area (`workspace_open`, `create_session`, `display_to_user`) per `notes/triage-nimbalyst.md`.
- Naming proposal: `<area>_<verb>` with an `mcp__app__` server prefix, matching the unprefixed Claude in Chrome names for browser tools (`navigate`, `read_page`) under a server named `browser`, so skills written for Claude in Chrome transfer with a prefix change. UI parity: every UI command registers once in a command registry and is exposed as a tool; R14 tools are `surface_open`, `surface_focus`, `surface_reveal`, `surface_highlight` (CSS overlay for browser, scroll and flash for other types), `browser_navigate`, `file_open`, `tree_reveal`.
- Instructions for the agent about what the user currently views arrive through the MCP server `instructions` string and the hook digest.

## 7. Scores, greenfield Electron shell

| Req | Score | Days | Basis |
|---|---|---|---|
| R12 surfaces | 2 | 8 | Registry and interface, with session, browser and Slack types (Slack as browser or native), persistence in the tree. |
| R13 shared awareness | 2 | 9 | Pull tool, hook digest, per-surface switch, indicator, access log, redaction. |
| R14 agent shows things (under R8) | 3 | 3 | Command registry as MCP tools, CDP highlight overlay; the MCP host path is probed. |
| R15 Claude in Chrome tools | 2 | 9 | Extension cannot be hosted; CDP tool set with matching names, screenshots and input, per-site permission UI; `find` and `gif_creator` extra. |

Effort numbers are estimates for one engineer plus agents; they exclude the task tree itself (R6) and the session surface (R4). Low confidence on R15 and on Slack native rendering.

## 8. Not verified

- Internals of the Claude in Chrome extension (use of `chrome.debugger`, the bridge protocol, the host's socket path); whether the CLI discovers a host manifest outside Chrome-family directories.
- Whether an MCP server named `claude-in-chrome` can coexist with the built-in.
- Electron `WebContentsView` partition option names, multiple CDP clients on one webContents, Playwright MCP or chrome-devtools-mcp attach to Electron targets (nothing executed).
- Slack Acceptable Use Policy text and Slack web client headers; Slack URL format; Discord Developer Terms text.
- Current Claude Code behavior for resource subscriptions (only issue-tracker reports read).
- Obsidian, Theia and MCP Apps APIs.
- Hook documentation pages beyond the first 100,000 characters, MCP page sections on resources.

## Sources

- https://code.claude.com/docs/en/chrome
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/channels-reference
- https://code.claude.com/docs/en/desktop
- https://www.electronjs.org/docs/latest/api/extensions
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/debugger
- https://github.com/ChromeDevTools/chrome-devtools-mcp
- https://github.com/microsoft/playwright-mcp
- https://docs.slack.dev/changelog/2025/05/29/rate-limit-changes-for-non-marketplace-apps
- https://discord.com/terms
- https://support.discord.com/hc/articles/115002192352
- https://paradev.com/changelog/2026-08-23-pull-requests-multi-window-design-mode
- https://paradev.com/changelog/2026-02-16-browser-linux-improvements
