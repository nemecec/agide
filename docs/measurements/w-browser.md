# w-browser

Start: 2026-11-17T22:11:14Z
End: 2026-11-17T23:23:00Z
Wall time: about 1 hour 12 minutes.

## Built

- `src/core/browser` (pure, default test command): `addressPolicy` (address field input, scheme allow list, cross-service and `window.open` decisions, permission allow list), service table and recognizer for Jira, GitHub, Slack and Notion, `siteTable` (acting-call defaults, session and always grants, script grants, agent navigation asks), `tables` (tab numbers never reused, ref table with stale refs), `redaction` (URLs, headers, titles, sensitive fields, cookie and field values, blocked patterns), `results` (untrusted label, truncation), `digest`, `axTree`, `PageSession` (accessibility tree with refs, text, find, click, type, key, scroll, hover, drag, screenshot at the CSS-pixel frame, scripts with `replMode`, form input with the native setter, highlight, console and network buffers, dialogs, navigation) over a `CdpTransport` seam, `TabCatalog` (the leaves the module recorded), `BrowserTools` (the call pipeline of 0026 section 3 and `surfaces_observe`), `SqliteBrowserStore` (observation switches, access log, tab states, tab counter; the observation contract suite passes on it), `surfaceType` (`browser-tab` and its Slack variant).
- `src/core/surfaces/SurfaceTypeRegistry.ts`: the registry the browser module registers `browser-tab` and `slack-thread` in.
- `src/core/mcp`: `/mcp/<session>/browser` path in the request guard, the server name per endpoint in `HttpAppMcpServer`, a string tool result is returned as text (page content is not JSON-escaped), an image result carries its `untrusted` label as text.
- `src/main/browser`: `ElectronViews` (a `WebContentsView` per recorded leaf, hidden `BaseWindow` for views no pane shows, at most 8 live views, idle debugger detach after 5 minutes, `live` keeps it attached, downloads cancelled during and within 2 s after an acting call, crash and dialog events), `guards` (navigation, redirect, frame, `window.open` and webview policy, partition permission handlers), `cdpTransport`, `capture` (still overlay for window captures), `openInChrome`, `views` (the interface).
- `src/main/modules/browser.ts`: tab creation from a URL, restore after restart, forged-leaf rule, the hosted tools as `browser_<name>` commands on `agide-browser`, `surfaces_observe`, `surface_highlight`, `browser_open_in_chrome`, `ui_set_observation` (no MCP tool), the UI helper commands, the approval flow, the launch contributor (server entry with a `timeout` of 150 s, `--no-chrome`, the `UserPromptSubmit` digest hook and `digest.json`), the digest writer, blocked patterns from `browser-blocked.json`, the capture overlay.
- `src/main/windowCapture.ts`: `setCaptureOverlay` hook; `src/main/index.ts`: `ElectronViews`, the `web-contents-created` backstop, disposal.
- Renderer: `BrowserPane` (tab chrome, slot placement, approval bar, acting banner with "Stop agent", crash and dialog banners, still while views are suspended), `panes/browser/*` (indicator, observation control with the access log popover, tab state hook, drag suspension), `BrowserTabDecorations` (indicator on the tree row), `createLeaf` (browser tab creation through the module).
- `scripts/browser-checks.mjs` and the check table in `probes/RESULTS.md`.

## Tests

- `pnpm typecheck`: clean at the end of the run.
- `pnpm test` (Vitest): every file of this slice passes: address policy (schemes, normalisation, cross-service, `window.open`, permissions), redaction, site table and grants, tab numbers, refs, digest, labels, recognizer for Slack and Notion, page session against a fake CDP transport (tree, refs, find, click, type, key, form input, screenshot, scripts, console, network, dialogs, navigation), `BrowserTools` (scope, forged leaf, observation switch, acting calls and the site check, navigate policy, tab management, batch, highlight, access log content), the SQLite store on the shared observation contract, guards, partitions, debugger transport, capture overlay, Open in Chrome, the module in the real module graph with a fake view layer (including MCP over the `agide-browser` endpoint), the launch contribution and digest, the renderer logic. One test of the session module (`appModules.test.ts`, grant revoked on close) failed in some full runs and passes alone; it is outside this slice.
- Mutations that failed a test: `file:` added to the allow list, password check removed, ref invalidation removed, folder scope check removed, observation-off check removed, cookie masking removed, site check for service origins skipped.
- `pnpm coverage`: the repository thresholds are not met while the other builders' files are in their current state; the pure browser modules are between 81 and 100 percent of lines, `ElectronViews` is covered by the end-to-end tests only.
- Playwright (`e2e/browser.spec.ts`, hidden window, `node:http` fixture on 127.0.0.1, fake claude): a tab leaf from the tree menu with rename, an address typed in the chrome with a file address and free text refused; an agent over `agide-browser` reads the tree and text, finds a ref, clicks, types, takes a screenshot, reads console and network with the token redacted, and the password value is hidden in the tree and in a script result; a navigation to `file:`, `javascript:` and `data:` is refused from a tool call, and `location.href`, a file link and `window.open` to `file:` from the page leave the tab on its page; another folder's tab and a forged leaf are refused; observation off refuses the tools and `surfaces_observe` and makes `ui_capture_window` draw the grey mask in place of the page (pixel sampled), and on again restores both; the permission bar for an agent navigation to an origin outside loopback with Deny and Allow once; a drag hides the view behind a still and the end of the drag removes it. The existing `tree.spec.ts`, `app.spec.ts`, `layout.spec.ts` and `workspace.spec.ts` pass with the change.
- Electron checks: `scripts/browser-checks.mjs`, results in `probes/RESULTS.md`.

## Shared files edited

- `src/main/modules/m3Modules.test.ts`: the stub test for `openTab` now expects the folder error.
- `docs/parity.md`: regenerated by `pnpm parity`.
- `probes/RESULTS.md`: the check table appended.
- `app/README.md`: browser section and module map rows.

## What took long

- A first run of the check script hung because an ES module main with a top-level `await app.whenReady()` never reaches `ready`; the script runs its work in an async function now.
- A hidden `BaseWindow` that parks views kept the app from quitting after the app window closed (Playwright's `close` waited 30 s per test). The parking window is destroyed when the app window closes.
- `setVisible(false)` stops frames, so parking uses a second window (check result).
- The tree rename flow expects the new leaf in the next tree refresh, so `browser_new_tab` returns the node and the tree does not need a second call.

## Decisions and deviations

- A page that Electron's own dialogs would block is handled through `Page.javascriptDialogOpening`; with no debugger attached the dialog shows natively. The agent cannot answer dialogs.
- Slack tabs use the `browser-tab` leaf type with `service: slack`, so `SurfacePane` and the leaf decorations need no change; `slack-thread` exists in the registry as the type of that variant.
- The renderer polls `browser_tab_state` every 700 ms and refreshes on `browser.*` events, because the event union is a contract file and carries no approval or acting event.
- The access log writes `http://blank.invalid` as the origin of a tab with no http origin, since the log keeps an origin only.
- Permission requests are shown in the tab chrome only. The inbox `approval` item waits.
- The digest is kept per session; the hook marks it delivered on the `UserPromptSubmit` that reaches the hook inbox.

## Not built or not verified

- P16 (how long the CLI keeps an MCP call open with the entry `timeout` set) was not run, so the approval wait is 115 s.
- The profile setting "Also use Claude in Chrome" (`--chrome`): `ProfileSettings` is a contract file.
- Shortcuts forwarded from the page view (Cmd+L and the others), page zoom keys, a leaf shown in two panes (the second still), peek stills, `surface.focused` writes, per-origin prompts, downloads folder.
- Window captures are not logged per included tab, because the capture command does not pass the caller to the capturer.
- The network allowlist of the session is not read for agent navigation (`allowlisted` is false); every origin outside loopback asks once per session.
- The `agide/observation-log` pane stays a stub; the per-tab popover shows the log.
- The real-Claude browser script.
- No check of real Slack and Notion URLs.
