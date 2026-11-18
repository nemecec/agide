# Browser tools mapping: Claude in Chrome to CDP in a WebContentsView

Date: 2026-11-17. Documentation and source survey for the embedded browser surface (0006, sections 2, 3, 4 and 5). Nothing was executed against Electron; CDP behavior is stated from the protocol as commonly documented and marked M where it was not re-read here. Confidence: H read from a primary source in this run, M standard protocol knowledge not re-verified, L inference.

## Summary

- The tool list and input schemas of the Claude in Chrome tools below come from the tool definitions of a live Claude Code session with the extension connected (H). The docs page https://code.claude.com/docs/en/chrome names no tool schemas; it names the capabilities, the permission model and the troubleshooting cases.
- Every page tool maps to a small set of CDP calls through `webContents.debugger`. The hard parts are not the calls but the semantics that skills depend on: element reference ids shared between `read_page`, `find`, `computer`, `form_input` and `file_upload`; screenshot coordinate frames; truncation limits; console and network buffering rules; and the permission prompt per site.
- A `WebContentsView` is a native layer above the renderer's DOM. The renderer reports a slot rectangle and main applies it with `setBounds`. Anything in the app's DOM that must appear over a page (menus, drag previews, dialogs) needs the view hidden or shrunk.
- Superset solved most of these problems for `<webview>` panes (source read, not run). The pieces worth copying are the scheme allowlist enforced on both `will-navigate` and CDP `Page.navigate`, the cookie refusal filter on CDP, the wake mechanism for hidden panes, the single-debugger-per-webContents guard, and secret redaction in design-mode payloads.
- Tests run against a local HTTP server that serves fixture pages, with hidden windows.

## 1. Claude in Chrome: tools and semantics that matter

Sources: https://code.claude.com/docs/en/chrome (H, capabilities, permissions, tab group, troubleshooting); tool definitions of the running session (H, schemas). Names have the form `mcp__claude-in-chrome__<tool>`.

Session-level behavior from the docs page:
- The extension collects tabs Claude opens in a Chrome tab group tied to the session. `/clear` closes the group unless work that survives the clear still runs; other endings close it only if it holds nothing but empty new tabs.
- Site permissions are managed in the extension. In auto mode, when the classifier approves a browser call to a site, the extension skips its own per-site check for that call, unless a permission rule denies any site to Claude in Chrome.
- Plan mode prompts before recording a GIF or opening a new tab; `tabs_context_mcp` with `createIfEmpty` and `browser_batch` calls that include those actions prompt too.
- A blocking JavaScript dialog (alert, confirm, prompt) stops browser events and the tools stop responding until the dialog is dismissed. A hosted version has to handle `Page.javascriptDialogOpening` itself.
- File upload: Claude Code reads the file and sends the content to the browser; the file must be readable under the session's permission rules; one call is limited to 10 MB in total; files with several hard links and files under credential-like names (`.env`, `.pem`, `.key`, `.ssh`) are refused.
- The recording captures everything visible, including account details.

### Tool table

| Tool | Input schema (required first) | Semantics to match |
|---|---|---|
| `tabs_context_mcp` | `createIfEmpty?: boolean` | Must be called once before other tools. Returns the tab ids of the session's group. With `createIfEmpty` and no group it creates a new window with a group and one empty tab. |
| `tabs_create_mcp` | none | Creates an empty tab in the group. The agent closes tabs it created. |
| `tabs_close_mcp` | `tabId: integer` | Closes only tabs of the session's group. Closing the last tab removes the group. |
| `navigate` | `url: string`; `tabId?: number` | `url` may omit the protocol (defaults to https) or be `"forward"` or `"back"`. `tabId` is optional only for standalone URL navigation; it is required for back and forward and inside a batch. Standalone without a tab calls `tabs_context_mcp{createIfEmpty:true}` and appends its result. |
| `computer` | `action`, `tabId`; `coordinate?: [x, y]`, `start_coordinate?`, `text?`, `ref?`, `region?: [x0, y0, x1, y1]`, `scroll_direction?`, `scroll_amount?` (1 to 10, default 3), `duration?` (0 to 10 s), `repeat?` (1 to 100, `key` only), `modifiers?`, `scale?` (0.1 to 1), `save_to_disk?`, `action_summary?` | Actions: `left_click`, `right_click`, `double_click`, `triple_click`, `type`, `screenshot`, `wait`, `scroll`, `key`, `left_click_drag`, `zoom`, `scroll_to`, `hover`. Click actions accept `ref` in place of `coordinate`. `key` takes space-separated keys and shortcuts with `cmd` on macOS; page zoom shortcuts return an error. `modifiers` is a `+`-joined string of ctrl, shift, alt, cmd or meta, win or windows. `zoom` captures a region in viewport pixels. `scale` shrinks only the returned image: coordinates always stay in the full-resolution frame, which the result reports. `action_summary` is required in practice for click, drag, key and type and is what a permission prompt shows. |
| `read_page` | `tabId`; `filter?: "interactive" or "all"`, `depth?` (default 15), `max_chars?` (default 50000), `ref_id?` | Accessibility-tree text with a `ref_N` id per element. Default includes non-visible elements. Over the limit it truncates at a line boundary and says the full size. `ref_id` returns that element and its children. |
| `find` | `query: string`, `tabId` | Natural-language search returning up to 20 matches with refs; says so when more exist. Needs a model or a matcher. |
| `form_input` | `ref`, `value: string, boolean or number`, `tabId`, `action_summary?` | Sets a form element by ref: boolean for checkboxes, option value or text for selects. |
| `get_page_text` | `tabId` | Plain text, prioritizing article content. |
| `javascript_tool` | `action: "javascript_exec"`, `text`, `tabId` | REPL semantics: top-level `await`, the value of the last expression is returned, no `return`. Runs in the page's context (main world). |
| `read_console_messages` | `tabId`; `pattern?` (regex), `onlyErrors?`, `limit?` (default 100), `clear?` | Console messages of the current domain only; the tool text insists on a pattern. |
| `read_network_requests` | `tabId`; `urlPattern?` (substring), `limit?` (default 100), `clear?` | Requests of the page including cross-origin; cleared on navigation to a different domain; the filter matches the URL as listed, with auth values shown as REDACTED. |
| `resize_window` | `width`, `height`, `tabId` | Resizes the browser window of the tab. |
| `file_upload` | `paths: string[]`, `ref`, `tabId` | Sets files on a file input by ref without opening the native picker. |
| `upload_image` | `imageId`, `tabId`; `ref?` or `coordinate?`, `filename?` | Uploads an earlier screenshot (id valid a few minutes) to a file input by ref or by drag and drop at a coordinate. |
| `gif_creator` | `action: start_recording, stop_recording, export, clear`, `tabId`; `download?`, `filename?`, `options?` | Frames come from the session's actions; export adds click indicators, drag paths, action labels, a progress bar and a watermark; all switchable, `quality` 1 to 30. A screenshot right after start and right before stop frames the recording. |
| `browser_batch` | `actions: {name, input}[]` | Runs sequentially and stops on the first error; cannot nest; each item's permission check runs on its own; coordinates refer to the screenshot taken before the batch. |
| `list_connected_browsers`, `select_browser`, `switch_browser` | `select_browser` takes `deviceId` | Choose among several Chrome instances. Not needed with one embedded browser. |

### Semantics that decide whether skills carry over

- Element refs: `ref_N` ids are issued by `read_page` and `find` and consumed by `computer` (`ref`, `scroll_to`), `form_input`, `file_upload` and `upload_image`. The host needs a per-tab ref table: ref to a `backendNodeId` (from the accessibility tree) or an `objectId`, invalidated on navigation, and a clear error for a stale ref. Behavior of stale refs in the extension was not observed (L).
- Screenshot frame: the agent works in the coordinates of the returned image at `scale` 1. If the host downsizes the image for the model, the click coordinate must be mapped back. Device pixel ratio matters: `Page.captureScreenshot` returns device pixels unless `clip.scale` or an emulation override sets it, while `Input.dispatchMouseEvent` takes CSS pixels. Choose one frame (CSS pixels at scale 1) and convert once.
- Output limits and truncation text must match, because agents react to them (`read_page` 50,000 characters by default, 20 `find` matches, 100 console messages and requests by default).
- Tab ids are integers; surface ids in the app are strings. Map them per folder.
- `tabs_context_mcp` first: the extension demands it. The hosted tools can accept calls without it, but returning the same group description keeps prompts and skills identical.
- Tool errors are the agent's feedback channel: "No tab available" and the like are error messages agents already know (docs table).

## 2. Mapping to CDP through `webContents.debugger`

Sources: https://www.electronjs.org/docs/latest/api/debugger (H: `attach([protocolVersion])`, `isAttached`, `detach`, `sendCommand(method, params, sessionId)`, events `detach` and `message`; the session ends and `detach` fires when DevTools opens for the attached webContents or the webContents closes; a command sent right after `attach()` before navigation may not resolve until navigation; an empty result resolves to `{}`; whether several clients can attach to one webContents is not documented). Superset's source states one debugger per webContents and a second attach throws (H for the source comment, `candidates/superset/apps/desktop/src/main/lib/browser/browser-manager.ts`, `attachCdp`). CDP method behavior below is M.

| Tool | CDP calls | Notes |
|---|---|---|
| `tabs_*` | none (app surface registry) | Tab id is an integer the app assigns to each browser surface (surface ids are strings; 0026 calls it `tabNumber`), resolved within the caller's folder; create and close go through the tree and the view registry. |
| `navigate` | `Page.navigate`; back and forward by `Page.getNavigationHistory` plus `Page.navigateToHistoryEntry`, or `webContents.navigationHistory` | `will-navigate` does not fire for CDP navigations (Superset comment, H), so the scheme check runs in the tool itself. Wait for `Page.loadEventFired` or `Page.frameStoppedLoading` with a timeout. A navigation that turns into a download or an error page returns `errorText` in the `Page.navigate` result. |
| `read_page` | `Accessibility.enable`, `Accessibility.getFullAXTree` (or `getPartialAXTree` for `ref_id`) | Nodes carry `backendDOMNodeId`; that id is the ref target. `interactive` filter: roles button, link, textbox, checkbox, radio, combobox, option, menuitem, slider, tab, switch, searchbox and focusable nodes. `depth` is applied on the app side. Non-visible elements need box checks via `DOM.getBoxModel`, which fails for hidden nodes. Cross-origin iframes need `Target.setAutoAttach` with `flatten` and a sessionId on each call; Superset notes the guest debugger answers `Target.*` with a process-wide list (H for the comment), so verify in Electron. |
| `find` | `read_page` tree plus a matcher | Role and text matching in code, or a small model call on the tree. Return up to 20 refs. |
| `get_page_text` | `Runtime.evaluate` of `document.body.innerText`, or `DOM.getDocument` plus `DOM.getOuterHTML` and a readability pass | Main-frame only by default; same-origin iframes need a walk. |
| `javascript_tool` | `Runtime.evaluate` with `awaitPromise: true`, `replMode: true`, `returnByValue: true` | `replMode` gives top-level await and last-expression value (M, verify in the bundled Chromium). Convert `exceptionDetails` to the error text. |
| `computer` screenshot | `Page.captureScreenshot` (`format`, `quality`, `clip`, `fromSurface`) | A hidden or `visibility: hidden` view gets no frames and the call hangs or fails; Superset parks panes at `opacity: 0` and disables background throttling, and serves default viewport shots through `webContents.capturePage` (H, source comments). The same applies to a view with `setVisible(false)`: verify (L). |
| `computer` zoom | `Page.captureScreenshot` with `clip` in CSS pixels and `scale` | |
| `computer` clicks, hover, drag | `Input.dispatchMouseEvent` (`mouseMoved`, `mousePressed`, `mouseReleased`, `button`, `buttons`, `clickCount`, `modifiers`) | Double click is two press and release pairs with `clickCount` 1 then 2; triple click ends at 3. Hover is `mouseMoved`. Drag is press, several moves, release. Coordinates are in CSS pixels of the view's viewport. A `ref` click resolves the center with `DOM.getContentQuads` after `DOM.scrollIntoViewIfNeeded`. |
| `computer` type | `Input.insertText` for text, or `Input.dispatchKeyEvent` per character | `insertText` is fast and bypasses keydown handlers; pages that listen to key events need `dispatchKeyEvent` with `text`. Choose per call or fall back on a failed check. |
| `computer` key | `Input.dispatchKeyEvent` (`keyDown`, `keyUp`, `key`, `code`, `windowsVirtualKeyCode`, `modifiers`, `commands` for editing shortcuts) | Mac shortcuts such as select all need `commands: ["selectAll"]` or the page-level handler (M). Page zoom keys return an error as in the extension. |
| `computer` scroll | `Input.dispatchMouseEvent` type `mouseWheel` with `deltaX`, `deltaY` at the coordinate | A tick is a fixed delta chosen by the host; the extension's value was not observed. |
| `computer` scroll_to | `DOM.scrollIntoViewIfNeeded` with `backendNodeId` | |
| `computer` wait | host timer | Maximum 10 s as in the schema. |
| `form_input` | `DOM.resolveNode` then `Runtime.callFunctionOn` that sets `value` or `checked` and dispatches `input` and `change`; selects match by value or text | Frameworks that track values need the native setter (`HTMLInputElement.prototype.value` descriptor) before the events. Password fields: see section 7. |
| `file_upload` | `DOM.setFileInputFiles` with `backendNodeId` | The file checks (permission, size, hard links, credential names) run in the app MCP server before the call. |
| `upload_image` | screenshot id table in the host, then `DOM.setFileInputFiles` with a temp file, or a dispatched drop event for coordinates | Needs the host to keep screenshots by id for a few minutes. |
| `read_console_messages` | `Runtime.enable` and `Log.enable`; events `Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded` | A per-tab ring buffer started at attach, so earlier messages are lost: attach at surface creation when observation is on, or accept the gap and say so. Filter, limit and `clear` in code. |
| `read_network_requests` | `Network.enable`; events `requestWillBeSent`, `responseReceived`, `loadingFailed`, `loadingFinished` | A per-tab buffer cleared on cross-domain navigation. Header redaction: see section 7. Bodies are not part of the tool; `Network.getResponseBody` stays unexposed. |
| `resize_window` | `Emulation.setDeviceMetricsOverride`, or `view.setBounds` | The view's slot belongs to the layout; emulation changes the viewport without moving the slot. Prefer emulation and a visible "emulated size" marker. |
| `gif_creator` | repeated `Page.captureScreenshot` per action, GIF encoder in main | Frames from the tool calls like the extension; overlays drawn in main. Large memory use; cap frame count. |
| `browser_batch` | loop in main with the same permission check per item | |
| dialogs | `Page.javascriptDialogOpening`, `Page.handleJavaScriptDialog` | Not a Claude in Chrome tool, but a blocked page is a documented failure; report the dialog in the next tool result. |

Attach lifecycle: attach with `"1.3"` when the first tool call or a live observation needs it; enable domains lazily; detach when observation is `off`; on the `detach` event with reason `target closed` or a DevTools open, mark the surface "debugger detached" and have tools return that state. Opening DevTools on an observed surface is a user action and the tool result says so.

## 3. WebContentsView facts for this app

Sources: https://www.electronjs.org/docs/latest/api/web-contents-view and https://www.electronjs.org/docs/latest/api/view (H), https://www.electronjs.org/docs/latest/api/session (H).

- Construction: `new WebContentsView({ webPreferences, webContents })`; `webContents` adopts an existing one; one webContents sits in one view at a time. The module is usable after `ready`.
- Bounds: `view.setBounds({ x, y, width, height })`, relative to the parent view; `getBounds()`; the `bounds-changed` event fires when layout changes them; `setBounds` takes an optional animation (duration and easing). The renderer cannot lay out a native view, so the layout module sends the slot rectangle in window DOM coordinates (CSS pixels, content area) and main applies it. Round to integers; apply on resize, on tree changes and on sidebar drags.
- Z-order: children draw in list order; `addChildView(view, index)` inserts at an index, and adding an existing child moves it to the top (H). The renderer's own content is the window's root web contents, below added children. A view therefore always covers DOM that sits in its rectangle, whatever its `z-index`. Consequences: context menus, tooltips, drag previews, the observation indicator and any in-app dialog that overlaps a browser slot are hidden by the view. Options: draw those overlays in a transparent `WebContentsView` of their own above the browser views (the overlay is a second renderer), use native menus (`Menu.popup`), or hide the browser view while the overlay is open. The indicator and the log of observation belong outside the slot.
- Hiding: `setVisible(false)` hides the view (H). `getVisible()` does not say whether it is on screen (H). A hidden or zero-size view stops producing frames; a tab that is not current should be detached from the content view or hidden, and a hidden view cannot be captured without the wake handling in section 2. During a drag of a split divider or a tree row, the renderer sends "drag start" and main hides all views in the window (or replaces them with a captured still), then restores on "drag end"; otherwise the drag events go to the native view and stop reaching the renderer. Mouse events over a native view never reach the renderer DOM, so drop targets must not sit under a view while dragging.
- Border radius: `setBorderRadius` clips drawing, but "the area cutout of the view's border still captures clicks" (H).
- Focus: a click in the view focuses its webContents; `webContents.focus()` moves keyboard focus; the renderer's shortcuts do not see keys typed in the view unless main forwards them (`before-input-event`).
- Partitions: `session.fromPartition(name)`; a `persist:` prefix gives a persistent session shared by all pages with that partition, no prefix gives an in-memory session; options cannot be changed after creation (H). A view picks its session with `webPreferences.partition` or `webPreferences.session` (WebPreferences structure, M). One persistent partition per service (Jira, GitHub, Slack, Notion) keeps logins separate and across restarts (0006). Superset uses a single `persist:` partition for all panes (H, source). Clearing a service's data is `ses.clearStorageData({ origin, storages })`.
- Permission handlers (H): Electron approves all permission requests by default. Set `setPermissionRequestHandler` and `setPermissionCheckHandler` on every browser session; deny by default, with an allowlist keyed on permission type and a parsed URL origin; `setDevicePermissionHandler` for hid, serial and usb. `media` and `display-capture` have their own handling. Deny notifications, geolocation, clipboard-read, camera and microphone until the UI asks the user.
- `setWindowOpenHandler(details)`: return `{ action: 'deny' }` and open the URL as a new browser surface in the same folder and partition when it is an http or https URL, so `window.open` and `target=_blank` become tabs. OAuth popups that need `window.opener` fail under this; allow those through `{ action: 'allow' }` with a popup window only for a known sign-in host list (Superset keeps popup windows and applies the same navigation guard to them: `popup-window.ts`, H for file existence, not read in full).
- `will-navigate` and `will-redirect`: preventDefault when the parsed protocol is outside an allowlist (http, https, about) (Superset `ALLOWED_GUEST_SCHEMES`, H). Do not use `startsWith` on URL strings (Electron checklist, H). Custom app protocol links are cancelled and handed to the app. `will-navigate` does not fire for CDP navigations or for `loadURL` from main, so the tool layer checks too.
- `webRequest`: header and CSP changes per session; a hub that multiplexes handlers is needed because only one handler per event can be set (Superset `web-request-hub.ts`, file name only, M).

### Security checklist (Electron tutorial, https://www.electronjs.org/docs/latest/tutorial/security, H)

| Item | Application to the browser view |
|---|---|
| No Node integration with remote content; `contextIsolation` on; sandbox on | `webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }` and no preload. |
| Permission handlers on every session loading remote content | See above; deny by default. |
| `setWindowOpenHandler` and `will-navigate` | See above; register once on `web-contents-created` so views created later are covered. |
| `shell.openExternal` only with vetted URLs | Protocol allowlist (http, https, mailto); no untrusted input. |
| Do not disable `webSecurity`, no insecure content, no experimental features | Defaults. |
| No `<webview>` and no `allowpopups` | Superset uses `<webview>`; this app uses `WebContentsView` per 0006. |
| IPC sender validation | Browser views get no preload and no IPC (the ipc policy of milestone 1 already states this). |
| Fuses: disable `runAsNode` and `nodeCliInspect` | Applies to the packaged app. |
| No remote debugging port | Not in the checklist; a port exposes every tab with logins to any local process (0006). `webContents.debugger` stays in process. |

Additional rules for an agent-driven view (from Superset's source, H unless marked):
- Refuse cookie access over CDP: methods `Network.getAllCookies`, `getCookies`, `setCookie`, `deleteCookies`, `Storage.getCookies` and the like, and cookie and `Set-Cookie` headers in `Network.*` and `Fetch.*` payloads (`cdp-cookie-guard.ts`). The tool set exposes no raw CDP, but `javascript_tool` can still read `document.cookie` for non-HttpOnly cookies; an app policy decides whether to block it (M).
- Never forward `Emulation.setDeviceMetricsOverride` or `Emulation.setVisibleSize` to a crashed renderer (a main-process segfault in Superset's tracker).

## 4. How existing notes and Superset solved the same

| Problem | Earlier note or source | Use here |
|---|---|---|
| Can the stock extension run in Electron | `notes/surfaces-and-browser.md` section 1 and 0006 section 3: no, because native messaging and `chrome.debugger` are not in Electron's extension APIs (H for the Electron side). | Host equivalent tools (option C). |
| Where the tools live | `notes/surfaces-and-browser.md` sections 1, 2 and 6: in-process `webContents.debugger` behind the app MCP server with token and Origin check, server name `browser`, no remote debugging port. | Same, except the name: 0026 chose `agide-browser` after probe PB1. The name `claude-in-chrome` is reserved (0006; PB1 shows the CLI drops it without an error). |
| Tool table | `notes/surfaces-and-browser.md` section 1 table and 0006 section 3 table list names and a few calls. Schemas were not compared there. | This note adds the schemas and the semantics column above. |
| Observation | 0006 section 4 and 5: pull `surfaces_observe`, hook digest, `off`, `on-demand`, `live`, indicator, access log, redaction. | Costs and redaction in sections 6 and 7. |
| Pane CDP exposure | Superset `browser-manager.ts` `attachCdp`: one debugger per pane, a WebSocket per pane, a target shim that presents the pane as one page target to browser-level clients (`cdp-target-shim.ts`), the guest's `Target.*` answers describe the process-wide target list. | The app does not expose CDP to clients, so the shim is not needed; the finding that `Target.*` is process-wide matters for iframe handling. |
| Hidden pane screenshots | Superset `acquireAgentWake`: background throttling off, pane parked at `opacity: 0` instead of `visibility: hidden`, `capturePage` in place of `Page.captureScreenshot` for plain viewport shots because the latter waits for a frame that a parked pane may never produce. | Test early; a `WebContentsView` in a hidden window or hidden view may behave the same. |
| Navigation policy | `ALLOWED_GUEST_SCHEMES` on `will-navigate`, `will-redirect` and CDP `Page.navigate`; popups get the same guard. | Copy the rule, in a pure module with tests. |
| Cookies | `cdp-cookie-guard.ts` refuses cookie methods and headers over CDP; the user imports logins instead. | Same posture for the tool set. |
| Element picking for the agent | Superset design mode: an injected script reports selector, attributes (secret-looking attributes become `[redacted]`), computed style subset and a cropped screenshot, clamped by budgets in main (`design-mode-script.ts`, `design-mode-payload.ts`). | Model for the selection signal and for redaction; budgets are enforced in main, not in the page. |
| Agent drives browser from a shell | Superset CLI `browser list/open/navigate/screenshot/eval/console/cdp` (`notes/surfaces-candidates.md`). Nimbalyst `BrowserSessionService` attaches `webContents.debugger` for input. | Tools on the app MCP server instead of a CLI. |

## 5. Observation signals and their cost

Cost means work in the app per signal and tokens if the signal reaches the agent. The digest and the pull tool follow 0006 section 4.

| Signal | Source | App cost | Agent cost | Notes |
|---|---|---|---|---|
| URL, load state | `did-navigate`, `did-navigate-in-page`, `did-start-loading`, `did-stop-loading`, `did-fail-load` on webContents | Negligible; no debugger needed | A line in the digest | History API changes need `did-navigate-in-page`. Redirect chains fire `did-redirect-navigation`; report the final URL only. |
| Title | `page-title-updated` | Negligible | A line | Titles often carry unread counts that change every few seconds; debounce and report only on a URL change or a settled title. |
| Visible text | `Runtime.evaluate` of `innerText`, or the accessibility tree | One evaluate per pull; the AX tree on large pages takes noticeable time and memory | Large; the MCP output warns above 10,000 tokens and caps at 25,000 by default (0006). | Pull only. Never in the digest. |
| Selection | page script with `selectionchange` and a `Runtime.addBinding` callback, or on pull `window.getSelection().toString()` | The listener runs on every selection move; debounce in the page; needs the debugger attached | Short text, bounded | A binding is visible to page script as a function on `window` unless created in an isolated world with `Page.createIsolatedWorld`; use an isolated world so the page cannot call or spoof it. Superset keeps extension code in separate worlds (`cdp-extension-worlds.ts`, name only). |
| Focus and active element | `Runtime.evaluate` on pull | Low | Short | Password fields are skipped (section 7). |
| Mutation digest | `MutationObserver` in an isolated world, reporting a hash and a count of changed nodes, not content | Moderate on busy pages (feeds, charts); throttle to one report per second per tab | A flag "page changed" at most | The agent calls `read_page` or `get_page_text` for content. Streaming pages would flip the flag constantly; the digest reports only "changed since your last read". |
| Screenshot | `Page.captureScreenshot` | Moderate; needs a frame | Image tokens; only on request | Shrink with `scale`; set a size cap. |
| Console errors, failed requests | `Runtime.exceptionThrown`, `Network.loadingFailed` | Low once attached; buffer growth to cap | A count in the digest, not the text | Useful for the "my dev page broke" case. |
| Service object recognizer | URL patterns (0006 section 8) | Negligible, pure function | One line: service, kind, id | Jira key, PR owner/repo/number and similar. |
| Download, dialog, crash | `will-download`, `Page.javascriptDialogOpening`, `render-process-gone` | Negligible | One line | A dialog or crash explains why tools stall. |

Switch behavior: `off` detaches the debugger and the URL and title signals stop too; `on-demand` attaches for a pull and detaches after an idle timeout; `live` keeps the debugger and the listeners. Webcontents events cost no debugger, so the indicator and the access log can still show "URL read" in `on-demand`.

## 6. Observation digest and pull: budgets

- Digest per surface: URL (query string and fragment removed unless allowlisted), title cut to a fixed length, a changed flag, a `dialog` or `crashed` flag. No page text. Worded as data about the user's browser.
- Pull outputs carry a leading line that the content is untrusted page content, a truncation note when cut, and the URL it came from. They go through the redaction in section 7 before they reach the access log or the agent.
- The access log records surface, kind, size, session and time; never the content.

## 7. Redaction needs

| What | Where it can leak | Rule |
|---|---|---|
| Password fields (`input[type=password]`) | `read_page` (AX value), `get_page_text` (no, values are not text), `javascript_tool`, `form_input` reads, selection, screenshots | AX nodes with role textbox and `protected` or a password input: report the field and no value. `form_input` into a password field is refused with a message that the user must type it, matching the repository's rule against passwords in agent-entered fields. Typed text through `computer type` into a focused password field is the same case: check the focused element's type before `Input.insertText`. |
| Other sensitive inputs | Fields with `autocomplete` of `cc-number`, `cc-csc`, `one-time-code`, `current-password`, `new-password`; names matching card, cvv, ssn, token, secret | Same treatment as password. Superset's `SECRET_PATTERNS` approach (substring check on attribute values) is a starting point; the list is configurable. |
| Form values in general | `read_page` shows values of inputs | Default: report values for non-sensitive inputs; a per-surface setting can mask all values. |
| URL patterns | Banking, HR, personal mail | A user list of patterns that force `off`; on a match the debugger detaches, tools return "observation off", the screenshot tool refuses. Match on parsed origin and path, not substrings of the whole URL. |
| URL contents | Query strings and fragments with tokens (OAuth `code`, `access_token`, magic links) | Strip query and fragment in digests and logs; in `read_network_requests` mask values of common token keys and the `Authorization`, `Cookie` and `Set-Cookie` headers, as the extension shows auth values as REDACTED (H, schema text). |
| Cookies and storage | `Network.getCookies`, `document.cookie`, `localStorage` through `javascript_tool` | No raw CDP. Decide whether `javascript_tool` results are scanned for cookie-shaped or token-shaped strings; at minimum the docs say tool output is untrusted page content, not a vault. |
| Screenshots | Show everything visible, including password managers' overlays and autofill | Refuse on `off` surfaces; no storage of images beyond the call; `save_to_disk` writes only under the project's session output folder. |
| Network bodies | `Network.getResponseBody` | Not exposed. |
| Prompt injection | Page text instructs the agent | Label every pull; the digest is data; outward actions stay behind the approval gate (0010). |
| GIF recording | Captures account details (docs, H) | Requires explicit start by the agent and shows the indicator; export asks the user. |

Redaction runs in main, on the data returned by CDP, before the MCP result and before the log; page-side scripts are not trusted to redact (Superset enforces budgets and redaction in main for design mode: `clampDesignModePayload`, H by name in a source comment).

## 8. Test strategy: local HTTP server

Rules from the task: Electron tests with hidden windows; no real accounts; no external network.

Layers:
1. Pure unit tests (no Electron): URL scheme allowlist, origin parser for permissions, URL pattern matcher, redaction functions, ref table, tool input schemas (zod), digest builder, token masking in URL and headers, AX-tree filter for `interactive`, `find` matcher, output truncation. These carry most of the behavior and run in the default test command.
2. Tool tests against a fake CDP transport: a stub with `sendCommand` and `message` emission that replays recorded responses, to test call order (for example `Input.dispatchMouseEvent` press then release with `clickCount`), error mapping and detach handling.
3. Electron integration tests, `show: false`, with a `node:http` server on `127.0.0.1` and an ephemeral port started in the test, closed after:
   - `/form`: text input, password input, checkbox, select, file input, a submit that posts to `/submit` (the server records what arrived, so tests assert that `form_input` and `computer type` changed real state).
   - `/long`: tall content with a button below the fold, for `scroll`, `scroll_to` and click by `ref`; a fixed element to catch coordinate errors.
   - `/console`: logs, warns, an uncaught error, a failed `fetch` to `/missing`, and an XHR to `/api/items` with an `Authorization` header, for `read_console_messages` and `read_network_requests`, including a navigation to a second origin (`localhost` against `127.0.0.1`) to test the clear-on-domain-change rule.
   - `/popup`: `window.open` and `target=_blank` links, for the open handler; a link to `file:` and a `javascript:` URL for the scheme guard; a redirect (`302`) to a blocked scheme target, for `will-redirect`.
   - `/dialog`: `alert` on click, for the dialog report.
   - `/frames`: a same-origin iframe and one served from the second origin, for tree walking and `Target.setAutoAttach`.
   - `/dynamic`: a node updated by a timer, for the mutation digest and its throttle.
   - `/download`: a `Content-Disposition` response, for `will-download`.
   - `/csp` and permission requests: a page that calls `navigator.geolocation` and `Notification.requestPermission`, to check the deny handler.
4. View tests: create a `BaseWindow` with `show: false`, add a `WebContentsView`, set bounds, read `getBounds`, toggle visibility and call the screenshot path while hidden, to settle the open item on frames for hidden views (section 3). Two partitions load the server's cookie setter and read back: the cookie set in one partition is absent in the other; a persistent partition keeps it across a new session object (use a temporary `userData` path).
5. Screenshot checks compare size and a few pixel colors of fixture elements (a solid-colored div at known coordinates), not image files, so the test does not depend on fonts. The click-coordinate test clicks the center of a colored button found from a screenshot and asserts the server saw the click.
6. Mutation checks (the project's rule for tests): flip the allowlist, drop the password check, drop the ref invalidation on navigation, and confirm tests fail.
7. A Real-Claude script outside the default command (model haiku, empty temporary working directory, budget limit, scrubbed environment as in `probes/lib.mjs`): a session with the app's browser MCP server reads `/form`, fills it and reports; asserts on the server-side record, not on the model text.

Hidden-window caveat: Chromium may not paint a view of a window that is not shown. Superset hit this for `visibility: hidden` webviews (H, source comments). The view tests settle whether `show: false` with `backgroundThrottling: false` produces frames; if not, the tests use a shown window positioned off-screen or the `capturePage` path and record the result here.

Port and cleanup: bind to port 0, record the port, close all servers and destroy windows in `afterAll`; no files outside a temporary directory.

## 9. Open items

- Run the CDP calls against Electron's bundled Chromium: `Runtime.evaluate` `replMode`, `Accessibility.getFullAXTree` on a `WebContentsView`, `Target.setAutoAttach` for iframes, frame production in hidden views and windows, `Page.captureScreenshot` while `setVisible(false)`.
- Whether several debugger clients can share one webContents (Electron docs silent; Superset says one at a time).
- Extension behavior not visible in schemas: ref staleness errors, scroll tick size, screenshot downscaling rule, how `type` sends text (insert or key events), `find`'s ranking model.
- Whether `session.setPermissionRequestHandler` also covers requests from popups opened with `window.open` that share the partition.
- Drag handling: whether hiding every view on drag start causes visible flicker at the layout module's frame rate; a captured still per view is the alternative.
- Overlay view above browser views: cost of a second transparent renderer, and its focus behavior.
- Slack, Discord and service recognizers: unchanged from 0006.

## Sources

- https://code.claude.com/docs/en/chrome
- Tool definitions of the Claude in Chrome MCP server in the survey session (schemas)
- https://www.electronjs.org/docs/latest/api/debugger
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/view
- https://www.electronjs.org/docs/latest/api/session
- https://www.electronjs.org/docs/latest/tutorial/security
- `notes/surfaces-and-browser.md`, `notes/surfaces-candidates.md`, `docs/decisions/0006-surfaces-browser-and-awareness-design.md`
- `candidates/superset/apps/desktop/src/main/lib/browser/` (`browser-manager.ts`, `cdp-cookie-guard.ts`, `cdp-target-shim.ts`, `design-mode-script.ts`, `design-mode-payload.ts`, `pane-session.ts`), read only
- Chrome DevTools Protocol domains Page, Input, DOM, Accessibility, Runtime, Network, Log, Emulation, Target (https://chromedevtools.github.io/devtools-protocol/), named from general knowledge, not re-read in this run (M). A later review checked that the methods and parameters named here exist in the protocol types of the app's `playwright-core` dependency (`Runtime.evaluate` `replMode`, AX `backendDOMNodeId`, `Overlay.highlightNode` `backendNodeId`, `Overlay.highlightRect`, `Page.createIsolatedWorld`, `Input.insertText`, `DOM.setFileInputFiles`, `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, `Emulation.setDeviceMetricsOverride`, `Page.javascriptDialogOpening`, `Page.handleJavaScriptDialog`, `Page.navigateToHistoryEntry`); their behaviour in Electron's Chromium stays unverified.
- Electron API names were checked against `electron.d.ts` of Electron 45.3.3 in the app's dependencies by the same review. `backgroundThrottling` is a `webPreferences` option (and `webContents.setBackgroundThrottling`), not a window option.
