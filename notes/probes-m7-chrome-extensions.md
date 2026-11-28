# Chrome extensions in the embedded browser: probes P58 to P60

Date: 2026-11-28. macOS (Darwin 27, Apple silicon), Electron 45.3.3 (Chromium 156, Node 24.22.3), the Bitwarden browser extension 2026.1.0 (manifest version 3, id `nngceckbapebfimnlniiiahkandclblb`). No model was started. The probe never logged in, never typed or read a credential and used no account. The extension code directory was copied from the user's Chrome (the version folder of the extension only, nothing else of the Chrome profile) to a temporary directory and removed at the end. Another Chrome profile of the same user holds the later version 2026.10.2; the review rerun at the end of this note covers it.

## Question

The user wants at least the Bitwarden extension to work in the embedded browser of Agide (0026: one `WebContentsView` per tab, one persistent partition per service, no extension support today). 0006 judged the stock Claude in Chrome extension not feasible in Electron; Bitwarden needs far less of the browser (no `debugger`, no `tabGroups`). The probes measure what Electron 45 gives an unpacked extension, what is missing, and what that means for the agent tools that observe the same page.

## Method

| Script | Content | Evidence (`probes/out/`, not tracked) |
|---|---|---|
| `p58_ext_load.mjs` | An Electron main script. Two persistent partitions (`persist:ext-a`, `persist:ext-b`) in a throwaway `userData`; `session.extensions.loadExtension` into both; a local `node:http` server on `127.0.0.1` with a login form (a text input with `autocomplete="username"`, a password input with `autocomplete="current-password"`); a popup window (`chrome-extension://<id>/popup/index.html`) per partition; the fixture page in a `WebContentsView` of a `BaseWindow` (the shape of `ElectronViews.ts`); the debugger on that view for isolated worlds; the browser-level CDP port for the service worker target; storage markers per partition. Windows are never shown. Options: `--preload` registers a service-worker preload, `--lifetime` keeps only the worker alive for 65 s, `--phase=read` reloads the same `userData` | `p58_ext_load_base.json`, `p58_ext_load_shim.json`, `p58_ext_load_read.json`, `p58_ext_load_lifetime.json`, the popup and page screenshots of the base and shim runs (`_popup_a.png`, `_popup_b.png`, `_page.png`), `p58_stderr_base.txt`, `p58_stderr_shim.txt` |
| `p59_ext_static_apis.mjs` | A static census of the `chrome.<namespace>.<member>` references in the extension's scripts, grouped by entry (background, popup, content, offscreen) | `p59_ext_static_apis.json` |
| `p60_sw_shim_preload.cjs` | A service-worker preload with inert stubs for the namespaces Electron lacks and the background script touches at start. It installs them in the worker's main world through `contextBridge.executeInMainWorld` (the preload's own world has no `chrome` global) | used by `p58` with `--preload` |

Network containment: `app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost')` stops every name lookup except loopback, and `session.webRequest.onBeforeRequest` on both partitions cancels every http, https, ws and wss request to another host and records the host, the resource type and whether the request came from a page or from a worker or extension page. The only server the probe contacted is its own on `127.0.0.1`.

Run: `AGIDE_HIDDEN=1 app/node_modules/.bin/electron probes/p58_ext_load.mjs --ud=<dir> --ext=<unpacked extension> --out=<json> [--preload=probes/p60_sw_shim_preload.cjs] [--phase=write|read] [--idle=0] [--lifetime=1]`; `node probes/p59_ext_static_apis.mjs <extension dir> <json>`.

## Results per question

| # | Question | Result | Evidence |
|---|---|---|---|
| 1 | Does `session.extensions.loadExtension` load it in a partition session? | Yes. In both partitions, 8 to 31 ms over the recorded runs and the review rerun, name and version as in the manifest, manifest version 3, URL scheme `chrome-extension`, the id of Chrome. The `_metadata` folder of the Chrome copy did not matter. Warnings, printed once per session: `Permission 'contextMenus' is unknown`, and the same for `'webNavigation'`, `'notifications'` and `'privacy'`. No other manifest key is reported. The `commands`, `action`, `offscreen`, `alarms`, `idle`, `scripting` and `storage` entries load without a warning. Loading is per boot: the extension is not remembered, so the app must call `loadExtension` for each session at every start | `p58_ext_load_base.json` (`partitions.*.load`, `extensionEvents`), `p58_stderr_base.txt` |
| 2a | Does the background service worker start and stay alive? | Stock Electron: it starts and then dies at once. The script throws `Cannot read properties of undefined (reading 'onCommitted')` at top level (`chrome.webNavigation` is undefined) and the registration fails (`Service worker registration failed. Status code: 15`). The popup then spins forever on `Waiting for migrations to finish` because the state service waits for the worker. With the inert stubs of P60 the worker starts (`WASM SDK loaded`, `Retrieving application id`, `State version`), registers its alarms, answers messages, and is still running after 65 s with no popup, no page and no message from the probe (`--lifetime`), and after the 40 s idle check of the full run, where the popup and an offscreen document were open. Electron does stop idle extension workers: in the review rerun a minimal manifest 3 extension whose worker only logs a line went from running to stopped 30 s after start. So the Bitwarden worker stayed up through its own activity (which calls kept it busy was not identified), and a host must wake a stopped worker by delivering real events; inert stub events never fire | `p58_ext_load_base.json` (`serviceWorker`, `partitions.a.serviceWorkerConsole`), `p58_ext_load_shim.json`, `p58_ext_load_lifetime.json` |
| 2b | Which `chrome.*` APIs are undefined? | Table below. Missing namespaces: `windows`, `contextMenus`, `menus`, `webNavigation`, `commands`, `notifications`, `privacy`, `sidePanel`, `cookies`, `declarativeNetRequest`, `downloads`, `identity`, `tabGroups`, `browsingData`, `topSites`. Missing members: `runtime.connectNative`, `runtime.sendNativeMessage`, `tabs.create`, `tabs.remove`, `tabs.getCurrent`, `tabs.captureVisibleTab`, `tabs.executeScript` (an MV2 call), `management.getAll`, `extension.getURL`. Present although the Electron page does not list them: `action`, `alarms`, `idle`, `offscreen`, `permissions`, `i18n`, `storage.session`, `runtime.getContexts` | `p58_ext_load_base.json` (`popupInventory`), `p58_ext_load_shim.json` (`serviceWorker.inventory`) |
| 3 | Does the popup page render? | Yes, once the worker runs. With the stubs the popup shows the logged-out intro carousel: the Bitwarden logo, "Security, prioritized", the pager dots, the buttons "Create account" and "Log in", and a "pop out" button (screenshot read; body text recorded). In stock Electron it shows only the loading spinner. Console errors of the popup: `chrome.tabs.getCurrent is not a function` (also as `Unhandled error in angular`), `Unable to fetch ServerConfig from https://api.bitwarden.com`, and `Cannot read properties of undefined (reading 'create')` (a call into one of the missing namespaces, reported from `polyfills.js`) | `p58_ext_load_base_popup_a.png`, `p58_ext_load_shim_popup_a.png`, `partitions.a.popup` |
| 4 | Is the content script injected and does it react to the login form? | Injected in both runs, with or without the worker: the debugger reports an isolated world named after the extension (`Bitwarden Password Manager`, origin `chrome-extension://<id>`) next to the page's default context, in a `WebContentsView` of the partition. With the worker running: `chrome.scripting.executeScript` of `content/bootstrap-autofill.js` into the fixture tab succeeds, and `chrome.tabs.sendMessage(tab, { command: 'collectPageDetailsImmediately' })` returns the page details: the form, a field of type `text` with autocomplete `username` and a field of type `password` with autocomplete `current-password`, no values. So the content script, the messaging path and form collection work (in 2026.1.0; 2026.10.2 collects fields only once an account is logged in, see the review rerun). The page DOM did not change (no injected elements, no iframes, no attributes) and the screenshot after focusing the username field shows no overlay: with no account the extension has no vault state to offer, so the inline menu and the fill were not exercised | `contentScript.*` and `serviceWorker.autofillProbe` in `p58_ext_load_shim.json`, `p58_ext_load_shim_page.png` |
| 5 | What does the extension need that Electron does not give? | See "What the app must provide" | below |
| 6 | Do two partitions get separate extension storage? | Yes. A marker written through `chrome.storage.local` in the popup of partition a is read back there and is absent in partition b, and the reverse. The data lives under `Partitions/<name>/Local Extension Settings/<id>` in `userData`. After an app restart (`--phase=read`, same `userData`) both markers are still there. `storage.sync` is a separate local store per partition, `storage.managed` is empty. A vault login therefore exists once per partition and once per profile (a profile is its own `userData`, 0022) | `partitions.*.storage` in `p58_ext_load_shim.json` and `p58_ext_load_read.json` |

### The `chrome.*` surface, measured

| Namespace | Electron 45.3.3 | Used by Bitwarden (static census) |
|---|---|---|
| `runtime` | present; `connectNative` and `sendNativeMessage` undefined | `connect`, `sendMessage`, `getManifest`, `getPlatformInfo`, `getURL`, `onInstalled`, `onMessage`, `onConnect`, `reload`, `connectNative`, `sendNativeMessage` |
| `storage` | `local`, `session`, `sync`, `managed` work | `local`, `session`, `sync`, `managed`, `onChanged` |
| `alarms`, `idle`, `scripting`, `offscreen`, `permissions`, `i18n` | present and working in the calls tried (an alarm is stored, `offscreen.createDocument` creates a document, `idle.queryState` answers) | `alarms`, `scripting.executeScript`, `insertCSS`, `registerContentScripts`, `offscreen`, `permissions` |
| `action` | functions exist (`setBadgeText`, `setIcon`, `getPopup`, `openPopup`); there is no toolbar and no popup host | the manifest `action` with `popup/index.html` |
| `tabs` | `query`, `get`, `update`, `reload`, `sendMessage`, events work; `create`, `remove`, `getCurrent`, `captureVisibleTab` undefined. `query({})` lists every web contents of the session, extension popups included, and `query({ active: true, currentWindow: true })` returns none | `query`, `get`, `update`, `create`, `remove`, `getCurrent`, `captureVisibleTab`, `sendMessage`, `onActivated`, `onUpdated`, `onRemoved`, `onReplaced` |
| `webNavigation` | undefined | `onCommitted`, `onCompleted`, `getAllFrames`, `getFrame` |
| `windows` | undefined | `create`, `get`, `getAll`, `getCurrent`, `update`, `remove`, `onCreated`, `onFocusChanged`, `onRemoved` |
| `contextMenus` | undefined | `create`, `remove`, `removeAll` |
| `commands` | undefined | `getAll`, `onCommand` (shortcuts of the manifest: autofill login, autofill card, autofill identity, generate password, lock, open popup) |
| `notifications` | undefined | `create`, `clear`, `onClicked`, `onButtonClicked` |
| `privacy` | undefined | `services` |
| `webRequest` | present | `onAuthRequired`, `onBeforeRequest`, `onCompleted`, `onBeforeRedirect` (Electron's own `webRequest` takes precedence over the extension's listeners, so the extension's listeners do not fire while the app installs its own handler; documented, not measured) |

### What the extension tried to reach

With the worker running, the only host that any request named was `https://api.bitwarden.com` (the server configuration fetch, one request from the worker and one from the popup, in each partition, within the first second). Both were cancelled. In stock Electron the worker never ran, so nothing was requested. Cases that would add hosts and were not reached: vault and identity servers (login), icons, event upload (a 1-minute alarm exists), the installation page (`tabs.create`, a stub here).

### Opening the popup, shortcuts, native messaging

`chrome.action.openPopup()` resolved without an error; whether a window appeared was not checked, and Electron has no toolbar for it to anchor to. The extension needs a host that draws a toolbar button per extension, opens `popup/index.html` in a small window anchored to it, and gives that popup the tab context (`tabs.getCurrent`, `tabs.query` with an active tab). The shortcuts of the manifest need the `commands` API and a key handler in the app. Biometric unlock needs the optional `nativeMessaging` permission (`permissions.request` fails here with "must be called during a user gesture") and `runtime.connectNative`, which is undefined; Electron has no native messaging host support, so biometric unlock with the Bitwarden desktop app is not available.

## What works, what is missing

Works in stock Electron 45.3.3: loading the extension per partition, manifest 3 pages with WebAssembly (the SDK loads under `wasm-unsafe-eval`), storage per partition that survives restarts, content script injection into pages of the partition and the isolated world, `scripting.executeScript` and `tabs.sendMessage` into a tab, offscreen documents, alarms. Electron stops an extension worker after 30 s without events (measured with a minimal worker in the review rerun), as Chrome does.

Missing: `webNavigation` (the worker does not start without it), `windows`, `contextMenus`, `commands`, `notifications`, `privacy`, the tab calls `create`, `remove`, `getCurrent`, `captureVisibleTab`, an active tab, a toolbar and popup host, native messaging.

Not measured, because it needs an account: unlock, the inline menu (overlay) and its iframes, fill, the save-login notification bar, the generator, passkeys, sync, the vault timeout.

From the code, partly measured: `attachGuards` (`main/browser/guards.ts`) cancels every sub-frame navigation that `checkUrl(url, 'page')` refuses, and that function allows only http, https and `about:blank`. The overlay and notification bar of Bitwarden are `chrome-extension://` frames inside the page, so the guards would cancel them until the extension origin of a loaded extension is allowed for frames. The review rerun confirmed that Electron emits `will-frame-navigate` with `isMainFrame: false` for a `chrome-extension://<id>/overlay/menu-button.html` iframe inserted into the fixture page; the guard itself was not attached there. The manifest declares its overlay and notification pages as web-accessible resources with `use_dynamic_url: true`, so in Chrome their frames load from a per-session origin, not from `chrome-extension://<id>`; which host Electron gives them was not checked, and an allow rule keyed on the extension id may not match. The main-frame guard also refuses a `chrome-extension://` tab, so the popup cannot be a browser tab and needs its own surface.

## The library electron-chrome-extensions (read, not installed)

Sources: the repository README of `samuelmaddock/electron-browser-shell` (package folder `electron-chrome-extensions`) and the registry entry. Latest version 4.10.0, MIT, no peer dependencies; its only dependency is `debug`. The README names Electron 35 (35.0.0-beta.8) as the minimum and recommends the latest. It does not state the manifest versions it supports; the top-level roadmap of the repository ticks "Manifest V3 support" with the remark "pending" an Electron pull request, which Electron 45 has since passed (the worker of an MV3 extension ran in this probe without the library). The same roadmap leaves "Respect extension manifest permissions" and "Robust extension popup support" open, and ticks a `.crx` loader, a Chrome Web Store installer and automatic extension updates (the sibling package `electron-chrome-web-store` and the shell). The README marks each API with a checkbox; the table below lists what it ticks.

| API | README |
|---|---|
| `chrome.tabs` | `get`, `getCurrent`, `connect`, `sendMessage`, `create`, `query`, `update`, `reload`, `remove`, `executeScript`, `insertCSS`, zoom, `goBack`, `goForward`, `onCreated`, `onUpdated`, `onActivated`, `onRemoved`, `onZoomChange`; not ticked: `captureVisibleTab`, `onReplaced`, `move`, `discard`, `duplicate`, `highlight`. The host supplies `createTab`, `selectTab`, `removeTab` and registers each tab with `addTab(webContents, browserWindow)` |
| `chrome.windows` | `get`, `getCurrent`, `getLastFocused`, `getAll`, `create`, `update`, `remove`, events; the host supplies `createWindow` and `removeWindow` |
| `chrome.action` | title, icon, popup, badge, `openPopup`, `onClicked` (not `enable`, `disable`), with a `<browser-action-list>` custom element for the toolbar (needs its preload injected into the host page and a bundler step) |
| `chrome.contextMenus` | `create`, `remove`, `removeAll`, `onClicked`; not `update` |
| `chrome.notifications` | `create`, `clear`, `update`, `getAll`, `onClicked`, `onClosed`; not `onButtonClicked` |
| `chrome.cookies` | ticked in full |
| `chrome.commands` | listed with `getAll` and `onCommand` both not ticked |
| `chrome.webNavigation` | `getFrame`, `getAllFrames`, `onBeforeNavigate`, `onCommitted`, `onCompleted`, `onDOMContentLoaded` (top frame only), `onCreateNavigationTarget`, `onHistoryStateUpdated` |
| `chrome.runtime`, `chrome.storage` | listed; `storage.managed` and `storage.sync` fall back to `local` |
| Not listed | `privacy`, native messaging (`connectNative`, `sendNativeMessage`) |
| Limits | all background scripts are persistent (in stock Electron an idle worker stops after 30 s, review rerun); Electron's `webRequest` blocks the extension's `webRequest` listeners; no incognito or non-persistent sessions; service-worker preload scripts need the sandbox |

It would cover the namespace that stops the worker (`webNavigation`) and most of what step 5 lists: `windows`, `tabs.create`, `remove`, `getCurrent`, the toolbar and popup host, `contextMenus`, most of `notifications`. It would not cover `commands` (the keyboard shortcuts; the README lists the namespace with nothing ticked), `tabs.captureVisibleTab`, `tabs.onReplaced`, `notifications.onButtonClicked`, `privacy` (Bitwarden uses it to switch off the browser's own password saving; a stub is enough) or native messaging; the app would stub or implement those. Open risks that only an install shows: the README calls for a `BrowserWindow` per tab while Agide hosts tabs as `WebContentsView` children of a `BaseWindow`; the library's preload and IPC surface would sit in every partition that loads it; its roadmap does not yet enforce the manifest's permissions on the APIs it adds, so the app's own rules must stay the gate; its support of Electron 45 is not stated. The probe's own stubs (P60) show that the worker can be made to start with no library, but real `tabs`, `windows` and `action` implementations tied to the tree's tab model are what the library exists to provide.

## Alternatives

| Option | What it is | Bitwarden | Agent tools | Cost |
|---|---|---|---|---|
| A. Embedded, library | Load the extension into chosen partitions at every start; host `tabs`, `windows` and `action` through electron-chrome-extensions or an own shim | Works for the paths the probes reached (load, worker, popup, content script); the rest unverified; no biometrics, no native messaging | Same tools as today, with the redaction rule below | A spike, then a slice (estimate below); a new dependency |
| B. Open in the user's real Chrome | `openInChrome` (`main/browser/openInChrome.ts`) runs `open -b com.google.Chrome <url>`: the URL opens as a new tab in the Chrome window and profile that Chrome itself picks (not probed here; Chrome uses its last active window); the helper passes no profile argument and cannot choose one. It falls back to the default browser when Chrome is missing | Full, with biometrics and the user's own vault, nothing to maintain | None for that tab (outside observation and the tree) | Exists today |
| C. Drive the real Chrome with Claude in Chrome | The CLI's `--chrome` flag uses the stock extension in the Chrome profile where the user connected it; the user's Bitwarden in that profile fills the form | Full | The Claude in Chrome tool set, with that extension's own page access rules; Agide's redaction does not apply, and the extension's handling of a filled password was not examined here | Exists today (0006 option D, 0026 section 3 `--chrome` setting) |
| D. No extension; a token or CLI fill | Out of scope of the request; mentioned only because a vault CLI session key would be a secret in a process environment, which the rules of this project forbid | | | Not recommended |

Recommendation: keep B and C as the answer for sites where biometrics or full fidelity matter, and build A in two steps. Step 1 is a spike (1 to 2 days, needs the user's approval of the dependency): install electron-chrome-extensions in a throwaway branch, load Bitwarden into the `web` partition only, log in once with a throwaway Bitwarden account, and settle the unverified list above (unlock, overlay frames, fill, save-login bar, the guard exception, `BaseWindow` support, worker wake-up after the 30 s idle stop, the APIs the library leaves out such as `commands`). Step 2 is the slice, estimated at about 6 days with low confidence (units of 0005: working days for one engineer plus agents): the extension manager in `main/browser` (code store, per-profile and per-service enable setting, load at every start), the tab bridge to the tree, the popup surface and toolbar button, the frame and request exceptions, the credential rule below with mutation targets, tests with the fixture login page of P58, and the settings and docs. Writing the shim without the library is possible but ends as a smaller copy of it.

## Can the agent tools read a filled password?

Reading of `core/browser/PageSession.ts`, `core/browser/redaction.ts` and 0026 section 6. A password manager fills through its content script in the isolated world; the value then sits in the `value` property of the input in the page's main world, the world every agent tool sees.

| Tool | What it returns for a filled password input today |
|---|---|
| `read_page`, `find` | The accessibility tree line for the field has no value: the value is cleared when `protected` is set or `isSensitiveField` matches (type `password`, autocomplete `current-password`, `new-password`, `one-time-code`, `cc-*`, or a name or id containing `card`, `cvv`, `ssn`, `token`, `secret`, `passcode`). Only roles `textbox`, `searchbox`, `combobox` are checked. `find` never prints values, but it matches the query against each node's accessibility value (`findInLines` in `core/browser/axTree.ts`), so a hit or a miss tells whether a field's value contains the query; in the review rerun a `type=password` input exposed only bullets of the value's length, and a text input named `cvv` exposed its raw value |
| `get_page_text` | `innerText`, which holds no input values; then `maskSecrets` |
| `javascript_tool` | The page script runs and may return anything. After the run `maskSecrets` replaces each current value of a sensitive `input` (3 characters or longer) in the returned text by `[sensitive field]` and cookie values by `[cookie]` |
| `form_input`, `computer type` | Refused for sensitive fields ("the user must type this") |
| `computer` screenshot | Pixels; the field shows dots while its type is `password` |
| `read_console_messages` | Masked by `maskSecrets` |
| `read_network_requests` | No bodies; `Authorization`, `Cookie` headers and sensitive query values shown as `REDACTED` |
| Observation log and digest | No content, URLs without query and fragment |

So a value filled into a `type=password` input does not reach the model through the direct tools, and the log never holds it. The masking in `javascript_tool` is a scan of the output text for the values it can find, and the following gaps stay:

- The scan compares the raw value with the text of the result, and a result that is an object is `JSON.stringify`-ed first. A value with a double quote or a backslash is escaped there and is not found. Generated passwords of other managers contain such characters.
- Any transformation of the value inside the script (`btoa`, `split`, character codes, reversing) is outside the scan. The scan guards against accidents, not against a script that was written to get around it, such as one planted by a prompt injection.
- Only `input` elements of the main document are scanned. A password in a shadow root, in a same-origin frame, in a `textarea`, in a `contenteditable` element or in a text input after the page's own "show password" toggle without an autocomplete hint is not.
- `DEFAULT_SENSITIVE_NAMES` has no `password`, `pass` or `pwd`; only the type and the autocomplete hint catch those fields.
- `find` matches on accessibility values, including those of fields that `read_page` blanks, so repeated queries can confirm a value piece by piece for a sensitive field that is not of type `password` (a name-matched field, a revealed password). A password input still leaks its length through the bullets.
- A click on the page's reveal control, then a screenshot, shows the password in pixels.
- The extension's own overlay is an extension-origin frame in the page. A screenshot taken while the inline menu is open shows vault item names and user names. Its accessibility tree is probably not in the main frame's tree, which was not checked.
- The agent could click an item of the inline menu with `computer` (coordinate clicks are trusted input): the extension fills the form on the agent's action, without the user deciding.

### Proposed rule

1. Agent tools never return the value of a password field or of a field that an extension filled, and the observation log, digest and `surfaces_observe` never hold it. In main, before every result: compute the set of secret values of the tab from the document, its open shadow roots and same-origin frames (inputs of type `password`, the autocomplete and name hints, and every input that changed without a trusted user event), match the result by raw value and by its JSON-escaped, URL-encoded and base64 forms, and replace.
2. While a tab holds such a value, the tab is in a "credential present" state until the form is submitted, the field is cleared or the page navigates. In that state `javascript_tool`, `get_page_text`, `computer` screenshot and zoom, and console reads are refused with "the page holds a credential; wait for the user", and `computer` clicks and keys are asked as the always-ask category "entering sensitive information" of 0026. The state is short and ends at the submit the user presses; it costs the agent a pause on the login page only.
3. A coordinate click or key that lands in an extension-origin frame (the overlay, the notification bar) is refused for the agent ("the user must do this"); the check is a hit test of the point against the frame tree through CDP before the click.
4. The extension's pages and workers (popup, background, offscreen) are not leaves, are never attached to by the debugger and never appear in `tabs_context_mcp`, `surfaces_observe` or a capture.

The `maskSecrets` gaps above are existing behavior and belong in a follow-up of 0026 section 6 whether or not the extension is built: the escaped forms, shadow roots, frames, `textarea` and the value matching of `find` need tests and mutation targets (a removed password check, a skipped encoding).

## Design questions for the user

| # | Question | Recommendation |
|---|---|---|
| 1 | Login once per partition. A partition per service means a Bitwarden login per service and per profile, because the extension's storage lives in the partition | Load the extension into `web` first (generic sites), make other services opt-in in the profile settings; do not copy vault storage between partitions |
| 2 | Biometric unlock is not available (no native messaging) | Accept master password or PIN with a vault timeout; use option B or C where biometrics matter |
| 3 | What the site table grants. The table decides what the agent may do on a site; a fill is the user's action, and the extension reads and writes every page of its partition | A site grant never covers a credential fill; the fill stays with the user (rule 3); show the extension and its partitions in the tab's observation popover |
| 4 | Permissions of the extension: host access `http://*/*` and `https://*/*`, content scripts at `document_start` in all frames of every page, `tabs`, `webRequest`, `scripting`. It can read pages whose observation is `off` and pages of the blocked list | Enable it only in the partitions the user names, show its manifest permissions in the settings, and treat an update that adds a permission as a new approval |
| 5 | Update path of the extension code | A version folder per extension under the profile's data directory, with the manifest permissions and a content hash recorded at install; updates are fetched on the user's command (Chrome Web Store update endpoint, which the sibling package `electron-chrome-web-store` uses, or the vendor's release archive; neither probed), verified against the extension key (the id derives from it), never applied silently; the previous version stays for rollback |
| 6 | Where its code is kept | In the profile's `userData`, never in the repository and never in the app bundle; a copy of this version is about 57 MB including source maps, so strip the maps or accept the size |
| 7 | Network of the extension. Its requests carry no web contents id and pass the app's request policy (`ElectronViews.sessionFor` allows a request that has no matching tab entry). The off-origin guard covers page requests only | Add a per-extension allow list on the extension's origin (the Bitwarden servers, or the user's own server URL) and log blocked hosts in the observation log's neighbor table |
| 8 | Frame and popup handling in the guards | Allow the sub-frames of loaded extensions in `attachGuards` (keyed on the extension id, or on the dynamic origin that `use_dynamic_url` gives its web-accessible pages; the spike settles which); open the popup in a small separate window with the tab context, not as a tab |
| 9 | Third-party code in a process that holds cookies and sessions | Keep Bitwarden only (the user's request); no store of other extensions until a separate decision; versions fixed by hash as in question 5, never a mutable latest |
| 10 | Dependency approval for electron-chrome-extensions (MIT, one dependency) | Approve for the spike only, in a branch, and decide after its results |

## Review rerun

An independent review reran P58 with the app's Electron 45.3.3 in throwaway user data directories, on fresh copies of the extension's version folders, and compared the JSON with the probe's evidence. Every request outside loopback was again only `api.bitwarden.com`, cancelled.

| Run | Result |
|---|---|
| 2026.1.0, stock | as the probe: the worker throws on `webNavigation.onCommitted`, registration fails with status code 15, the popup body stays empty, the isolated world is injected |
| 2026.1.0, P60 stubs | as the probe: the worker runs, the popup shows the intro carousel (screenshot read), `executeScript` and `collectPageDetailsImmediately` return the form's two fields without values, storage is separate per partition, the worker is running after the 40 s idle check |
| 2026.1.0, `--phase=read` | both markers back, each only in its own partition |
| Minimal manifest 3 extension, `--lifetime` | the worker stops 30 s after start (`running-status-changed` to `stopping`, then `stopped`) |
| 2026.10.2, stock | the same failure; unknown permissions now also include `sidePanel` |
| 2026.10.2, P60 stubs | the worker runs and the popup shows the intro carousel; `collectPageDetailsImmediately` returns no fields, and the worker logs "Autofill monitoring disabled; the active account is logged out", so form collection in this version waits for a login |
| A separate check script | `will-frame-navigate` fires for an inserted `chrome-extension://` iframe; the accessibility tree gives a password input's value as bullets and a `cvv` text input's value in clear |

The documented run line used a relative `--preload` path, which `registerPreloadScript` refuses ("Preload script must have absolute path"); the script now resolves the path.

## Not run

A login, unlock, fill, the overlay and the save-login bar; passkeys; HTTPS pages and iframes in the fixture; a second extension; packed `.crx` files (Electron does not load them); the Windows and Linux hosts; the library itself; Electron's own handling of `chrome.webRequest` with the app's handler installed; a vault CLI.
