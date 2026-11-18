# On-screen check of the milestone 2 and 3 UI

Date: 2026-11-18. Tool: `pnpm visual-check` (`app/scripts/visual-check.mjs`, helpers in `app/scripts/lib/visual/`). Data is fake throughout: generic folder and session names, a fake `claude`, a fake `gh`, a local test page. Screenshots are not committed; one run wrote them to `$TMPDIR/agide-visual-4zqSBi/shots`. A new run writes a new directory, so runs before and after a change can be compared. The only committed image is `docs/images/agide-overview.png` (pair layout: tree, a session, a browser tab).

## Capture sources

| Source | Result |
|---|---|
| `ui_capture_window` (the app's own capture that composes native views) | Works for every state. Writes `<state>.png`. Size is twice the window size (retina). |
| `page.screenshot` of the renderer | Works. Written as `<state>.page.png` for the browser states. It shows DOM layers (dialogs, popovers) but not native views. |
| macOS `screencapture -l<window id>` | Fails: "could not create image from window" and "could not create image from display". The terminal host has no screen recording permission. The script tries once per run, notes the failure and skips it afterwards. |

The window size is set with `setContentSize` (1440 by 900, 900 by 900, 1920 by 1080). The 1920 wide capture was accepted at that size.

## Screens

Names are file names without the extension. "Seen" means the PNG was opened and looked at.

- `01-first-launch`: default profile, empty tree. Blue profile strip with the name, a Layout select, the rail with a "D" profile button, a "+" button and the text "no plan data". Tree pane shows "Right-click to add a folder or a surface.". Surface pane shows "Open a session or tab from the tree". Dock tabs read "tree", "surface-host", "inbox".
- `02-tree-populated-1440`, `-900`, `-1920`: nested folders (Project A with Backend, Frontend, Checkout flow; Project B with Research; Notes), session leaves with "Claude session" labels and a "waiting" marker, a browser tab leaf labelled with its host and an eye icon. At 900 wide the session titles are cut to "Fix uploa…" and "R.." while the "Claude session" label stays whole.
- `03-layout-session`, `03-layout-session-terminal`, `03-layout-pair`: Session preset shows tree, terminal and the inbox tab. Pair preset shows tree, terminal, and the browser tab with its page in the right pane. In the pair capture the narrow tree pane drops the title of "Review pull request" completely and leaves "Claude session waiting".
- `04-new-session-dialog`, `04-new-task-dialog-empty`, `-prompt`, `-pull-request`, `-jira`: dialogs float over the surface pane without a backdrop. The session dialog puts Title and Working directory on one line without a gap and cuts the placeholder. The task dialog is laid out as a column; the pull request state shows the kind line "Pull request", the optional instruction and a collapsed Preview.
- `05-settings-top`, `-network`, `-sandbox`, `-isolation`: profile settings with Permissions (mode select and sentence), a checkbox, the allowed and denied host text areas, Outward actions, the "runs as your user" note, Save, and Isolation with the local provider and the srt provider. The panel scrolls inside a fixed height; the top, network and sandbox captures are identical because the scroll target is already visible.
- `06-browser-tab-observation-on-demand`, `-off`, `-live`: tab chrome with back, forward, reload, service badge "Web", address with the host emphasised, eye control, "Open in Chrome" and a "..." menu. With observation off the page area is a dark mask with the text "not shared" and the eye is crossed out.
- `06-browser-observation-popover-over-view`, `06-browser-tab-menu-over-view`, `06-browser-context-menu-over-view`, `06-browser-dialog-over-view`: the context menu shows above the page in the composed capture. The observation popover and the new-session dialog do not: the composed capture shows only a sliver of the popover edge and no dialog, while the `.page.png` of the same state shows both above a still of the page.
- `06-browser-agent-navigation-bar`: a salmon bar above the page reads "An agent asks to open http://staging.example.test: navigate, Open http://staging.example.test" with Deny, Allow once, Allow for this session, Always allow this site.
- `07-agents-running-waiting-failed`: under the session row: running (filled dot), waiting (half dot, amber), failed (red cross, "failed (outcome derived by Agide)"). The failed row ends in a button that is cut at the pane edge. The session row shows "N running", "waiting" and "N finished".
- `07-agents-after-removal-delay`, `07-agents-show-finished`, `07-agents-history-pane`: after the delay the finished (done) row is gone from the tree and the tally remains; the failed row stays. Show finished brings rows back; the history pane lists finished agents.
- `08-usage-pane-heat-plan`: tree rows show estimated cost per minute and red three-bar heat markers; the usage pane lists "Profile", "App-started", a bullet "5 h: 12%", a caveat sentence and a ranking with cost, tokens, percent and age. The rail shows no plan figure in this layout because the rail pane is not part of the custom layout; `10-profiles-default-window` shows "5 h: 1%" under the "+" button.
- `09-inbox-list`, `09-inbox-card-*`: items of kinds alert, reminder, failure, alert, update (twice) and approval, each with a kind label, project and session path, "just now" and a bold message while unread. `09-inbox-card-5-status-expanded` shows the expanded long description with "Show less" and the action buttons (Done, Mark unread, Snooze 10 min, Snooze 1 h, Snooze to tomorrow 09:00, Peek at session). `09-inbox-card-6-approval-peek` shows the card beside a read-only terminal peek with "Back to message", "waiting" and "read only". The approval card shows the request twice (as formatted text and as RAW REQUEST) and has no approve or deny control.
- `10-profiles-default-window`, `10-profiles-work-window-badge-and-setup`: the Default (blue) and Work (green) profile windows, each with a rail of "D" and "W" buttons; the badge "1" sits on "D" in both windows. The Work window shows the floating setup pane: "Claude login (done)", "Git identity" with Name and E-mail fields, a disabled Save, the agent access note and "Later".
- `11-empty-inbox`: "Nothing waits for you", "No open items", "Select an item". The Open and Done buttons wrap to a second row.
- `11-invalid-layout-notice`: a dark red notice above the dock: "The layout file is invalid. The previous layout stays and the file is untouched." followed by JSON pointers and schema messages.
- `11-claude-binary-missing`: the new-session dialog shows "cannot start claude: … is not executable. Install Claude Code or set AGIDE_CLAUDE_BIN." as plain text.
- `11-provider-runtime-missing`: Isolation lists the srt provider unselectable with the install text and an "srt path" input. Not opened as a PNG separately; the same section is visible in `05-settings-isolation`.
- `11-long-name-and-many-nodes`, `-900`, `11-many-nodes-scrolled-to-end-900`: the long folder name is cut with an ellipsis; many group rows scroll in the tree.
- `12-appearance-light-*`, `12-appearance-dark-*`: dark mode follows the media query and the native theme. Panes, tree, inbox and dialogs turn dark; the terminal stays a white block.
- `13-focus-main-tab-01` to `-08`, `13-focus-tree-arrow`, `13-focus-dialog-tab-2`, `-4`, `focus-order.json`: the Layout select shows an amber ring; dock tabs and tree rows show no ring of their own.

## Defects

| Id | Severity | Category | Screen | Problem (from the image) | Evidence | Fix hint |
|---|---|---|---|---|---|---|
| V-01 | major | layout | agent rows | The failed agent row ends in a bordered button that is cut at the right edge of the tree pane; only its first letter shows. | `07-agents-running-waiting-failed.png`, `08-usage-pane-heat-plan.png` | Let the row wrap or shrink the label first; keep the action inside the pane. |
| V-02 | major | stacking | window capture over a browser tab | `ui_capture_window` leaves out dialogs and popovers that sit above a browser tab: the new-session dialog is missing and the observation popover is a sliver, while the renderer screenshot of the same moment shows them. An agent or a test that reads the composed capture cannot see them. The on-screen result could not be checked because screen capture is blocked. | `06-browser-dialog-over-view.png` against `.page.png`; `06-browser-observation-popover-over-view.png` against `.page.png` | Draw the stills of the composed capture below the DOM layers, or draw them only for the slot. Re-check on screen once screen recording is allowed. |
| V-03 | major | layout | new-session dialog | Title and Working directory sit on one line with no space between label and field; the placeholder "Default directory of the …" is cut; Start and Cancel touch each other. | `04-new-session-dialog.page.png`, `11-claude-binary-missing.png` | Stack the labels over the fields like the task dialog and add button spacing. |
| V-04 | major | layout | profile settings | The host text areas sit in the middle of a sentence ("Allowed hosts, one per line [box] Denied hosts, one per line"), labels wrap around the boxes, the folder-trust checkbox shares the line with the denied hosts box, and Save has no gap to the Isolation heading. The panel has a fixed height; the lower provider list is reachable only by an inner scroll with no visible hint. | `05-settings-top.png`, `05-settings-isolation.png` | Give each field its own block, add section spacing and a visible scroll area or a taller panel. |
| V-05 | major | text | tree rows at narrow width | When the tree pane is narrow the session title is cut first or dropped completely (`R..`, and an empty title for "Review pull request") while the "Claude session" type label and the status stay whole. No tooltip carries the full title (no `title` attribute in `TreePane.tsx`). | `02-tree-populated-900.png`, `03-layout-pair.png`, `11-long-name-and-many-nodes-900.png` | Give the title the flexible width and truncate the type label; add a title attribute to every row. |
| V-06 | major | focus | main window | Dock tabs have no focus ring (outline none), tree rows show only the grey selection box that also marks the selected row, and the Tab order walks the dock tabs and the Layout select in a cycle. The profile rail and the "inbox" tab never took focus. | `13-focus-main-tab-01.png`, `13-focus-main-tab-02.png`, `13-focus-tree-arrow.png`, `focus-order.json` | Add a `:focus-visible` ring to tabs and rows, separate it from the selected style, and put the rail in the tab order. |
| V-07 | major | focus | dialogs | A dialog does not take focus when it opens, and Tab leaves it: the first Tab after opening goes to a dock tab behind the dialog. | `focus-order.json` (dialog list), `13-focus-dialog-tab-2.png` | Focus the first field on open, trap Tab inside, restore focus on close. |
| V-08 | minor | contrast | dark appearance | The terminal stays a white block inside a dark window, with a hollow cursor. | `12-appearance-dark-session.png` | Theme the terminal from the colour scheme. |
| V-09 | minor | accessibility | profile rail | Profile buttons show only a letter; there is no visible name, and a small stray dot sits left of each button. "no plan data" and "5 h: 1%" are very small text under the "+" button. | `10-profiles-default-window.png`, `01-first-launch.png` | Add a tooltip and an accessible name with the profile name; explain or remove the dot; group the plan text. |
| V-10 | minor | layout | setup pane | Name and E-mail inputs have no visible labels and touch each other; Save is grey and disabled with no hint what is missing. "Claude login (done)" shows although the fake CLI reported a logged-out state through a file the profile process may not read, so the check may follow a different signal; not confirmed. | `10-profiles-work-window-badge-and-setup.png` | Add labels and spacing; say which field blocks Save. |
| V-11 | minor | text | dock tab titles | Tabs show internal names: "surface-host" (twice in the Pair layout), "usage-ranking", "agent-history", all lowercase. | `03-layout-pair.png`, `08-usage-pane-heat-plan.png` | Use the pane titles from the manifest (Surface, Usage, Agent history, Inbox) or the bound node's title. |
| V-12 | minor | text | usage pane | Token rates are raw numbers without separators (5765285 tok/min), the ranking has no column headers, the plan line is a bare bullet "5 h: 12%", and all heat markers look identical regardless of level. | `08-usage-pane-heat-plan.png` | Format numbers, add headers and a label for the plan window, vary the marker by level. |
| V-13 | minor | text | agent navigation bar | The sentence repeats the address: "An agent asks to open http://staging.example.test: navigate, Open http://staging.example.test". The four buttons are small and plain. | `06-browser-agent-navigation-bar.png` | Say once what the agent asks for; style Deny and Allow as primary and secondary. |
| V-14 | minor | state | inbox card | The approval card prints the request twice (formatted and under RAW REQUEST) and offers only Done, Snooze and Peek, so a reader may expect an approve control. "Show less" is a link style among boxed buttons. Rows move when an item is read. | `09-inbox-card-6-approval-peek.png`, `09-inbox-card-5-status-expanded.png` | Show the request once; say where the answer is given; use one button style. |
| V-15 | minor | state | claude binary missing | The failure text is plain black text between the sentence and the buttons and does not look like an error. | `11-claude-binary-missing.png` | Style `role=alert` text as an error and keep the dialog open with the fields intact. |
| V-16 | minor | text | invalid layout notice | The notice lists raw JSON pointers and schema messages and has no way to dismiss it or open the file. | `11-invalid-layout-notice.png` | Add a short summary line, a reveal-file action and a dismiss control. |
| V-17 | minor | text | browser tab leaf | The tree row keeps the host ("127.0.0.1") as its title while the page title is known ("Sample page"). | `02-tree-populated-1440.png`, `06-browser-tab-observation-on-demand.png` | Update the leaf title from the page title unless the user renamed it. |
| V-18 | minor | layout | inbox header | With nothing open the Open and Done buttons drop to a second row under the title, and their selected state differs only by font weight. | `11-empty-inbox.png`, `09-inbox-list.png` | Use a segmented control with a visible selected state. |
| V-19 | minor | state | tree after layout switch and reload | Expanded folders collapse after a layout switch and after a window reload; the first run showed the Pair layout with every folder closed. | seen in an earlier run of the same script (`03-layout-pair` of that run); the script now expands the tree explicitly after the switch | Keep the expansion state in the tree model, not in the pane. |
| V-20 | nit | layout | session pane header | A small plain "busy" label sits above the terminal with no styling. | `02-tree-populated-1440.png`, `03-layout-pair.png` | Style as a status chip or move into the tab. |
| V-21 | nit | layout | chrome | The Layout select is an unstyled native control at the top left, unlike the rest of the chrome. | every full-window capture | Style or move it into the dock header. |
| V-22 | nit | layout | dark appearance | A white outline box sits on the "Backend" row while the selected row is "Fix upload retry". | `12-appearance-dark-session.png`, `12-appearance-dark-inbox.png` | Check that focus and selection use different markers in dark mode. |

## What the screenshots do not show

- The dock badge, system notifications and focus stealing when a window is shown.
- OS-level pixels of native views (screen recording is not allowed for the terminal host); only the composed capture and the renderer screenshot exist.
- The real `claude` terminal (a fake CLI prints a short banner).
- The macOS appearance setting. Dark mode is emulated through the media query and the app's native theme; the system setting was not changed.
- Pixel diffs between runs; the directories are meant for side-by-side viewing.

## Fixes

The ids R-01 to R-30 are those of the independent review; `docs/decisions/0031-on-screen-check-results.md` lists them with the V items they merge. The sections above describe the capture run before the fixes.

Run after the fixes: `$TMPDIR/agide-visual-lfij26/shots` (hidden windows, same script). Screenshots are not committed; `docs/images/agide-overview.png` was regenerated from `03-layout-pair.png` of that run. The verification step ran the script again (`$TMPDIR/agide-visual-X9aLLz/shots`, hidden). The cross-review opened the files of the verification run and ran the empty and focus phases once more after its own change to the dock tab ring (`$TMPDIR/agide-visual-eJpbF6/shots`, hidden).

| Defect | Change | After screenshot |
|---|---|---|
| R-01 | Approval cards: "Answer in session" opens the session surface, "Done" reads "Dismiss without answering" with a tooltip, a note says the card cannot answer, the raw request is a collapsed block when the card already describes it. | `09-inbox-card-0-approval-after-back.png` |
| R-02 | The list order is stable: open approvals first, then urgency, then creation time. Reading an item does not move it. Open approvals carry a "Needs answer" chip and the header says how many need an answer. Unread line reads "No unread items" when none. | `09-inbox-card-0-approval-after-back.png` |
| R-03 | Session tally counts running, waiting, failed (red) and finished apart. | `07-agents-running-waiting-failed.png` |
| R-04 | Live shows a coloured "Live" badge in the tab chrome and the tree row. The popover explains each option and has no list numbering. | `06-browser-tab-observation-live.png` |
| R-05 | A temporary profile gets a grey strip "Default (temporary profile, not saved)", a rail note and the settings heading "Profile settings (temporary profile)"; a saved profile gets its name in the heading. | `02-tree-populated-1440.png`, `05-settings-top.png` |
| R-06 | The Auto sentence names the outward actions. The permission selects have accessible names and the task dialog shows "Profile default (Auto)". | `04-new-session-dialog.png` |
| R-07 | The bar names the session, states the address once for a navigation, makes Allow once the primary button and puts "Always allow this site" behind "More". | `06-browser-agent-navigation-bar.png` (captured in the fix run, first opened by the verification step) |
| R-08 | Agent rows shrink label and detail first and keep the action inside the pane. | `07-agents-running-waiting-failed.png` |
| R-09 | The title takes the flexible width, the type label shrinks first, every row has a title tooltip. New overview image. | `03-layout-pair.png` |
| R-10 | Stacked fields, spaced buttons, backdrop and shadow. | `04-new-session-dialog.png` |
| R-11 | One block per field, wide host lists, Save per section, taller panel, "Not isolated" chip, unavailable providers dimmed, backticks drawn as code, fix text no longer points at the screen it is on. | `05-settings-top.png`, `05-settings-isolation.png` |
| R-12 | Visible focus rings on buttons, inputs and tree rows. Focus (amber ring while the tree has focus) is separate from selection (tinted row with a bar). The dock tab ring was clipped by the tab strip and did not show in `13-focus-main-tab-01.png` of the fix and verification runs; the cross-review draws it inside the tab. | `13-focus-main-tab-02.png` (Layout select), `13-focus-tree-arrow.png` (tree row), `13-focus-main-tab-01.png` of the cross-review run (dock tab) |
| R-13 | Dialogs focus the first field, keep Tab inside, close on Escape and give focus back. | `04-new-session-dialog.png`; Playwright test |
| R-14 | Stills of the composed capture sit below dialogs, menus and popovers. | `06-browser-dialog-over-view.png` |
| R-15 | One selection marker and a separate focus ring (see R-12). | `07-agents-running-waiting-failed.png` |
| R-16 | Kind labels are coloured (approval and failure red, alert amber, reminder green, update grey); the card label for the parent folder reads "Folder". | `09-inbox-card-0-approval-after-back.png` |
| R-17 | Column headers, thousands separators, "Started by Agide: n of m allowed". | `08-usage-pane-heat-plan.png` |
| R-18 | Destructive menu entries are separated and coloured, menu items are left-aligned, "New Claude session…" has an ellipsis. Menus stay inside the window. | `06-browser-tab-menu-over-view.png` |
| R-20 | The layout notice has a "Show what is wrong" disclosure and a Dismiss button. | `11-invalid-layout-notice.png` (captured in the fix run, first opened by the verification step) |
| R-21 | Labelled fields and a hint beside the disabled Save. | `10-profiles-work-window-badge-and-setup.png` (captured in the fix run, first opened by the verification step) |
| R-23 | Tab titles are words ("Usage ranking", "Surface host 1" and "Surface host 2"); layout names start with a capital letter. | `03-layout-pair.png` |
| R-24 | Status chips in the terminal bar and the peek. | `02-tree-populated-1440.png` |
| R-25 | Failed rows in red, a Started column, small costs read "<$0.0001", labels spaced from controls. | `07-agents-history-pane.png` |
| R-26 | The terminal follows the colour scheme while it is open. The selected inbox filter is a filled segment. | `12-appearance-dark-session.png`, `12-appearance-dark-inbox.png` |
| R-27 | Header with a segmented control. | `09-inbox-list.png` |
| R-28 | The leaf takes the page title until the user renames it. | `02-tree-populated-1440.png` |
| R-29 | Tooltip on the repository field and a chip for the detected kind. | `04-new-task-dialog-prompt.png`, `04-new-task-dialog-pull-request.png` (the chip; a tooltip does not show in a still) |
| R-30 | Styled Layout select; "(empty)" under an empty folder; the arrow column keeps its width. | `02-tree-populated-1440.png` |

Not fixed or only in part: see "What was not fixed, with questions for the user" in `docs/decisions/0031-on-screen-check-results.md` (among them R-19, R-22, R-24 in the tree, the R-25 settings move, the R-17 totals and the R-15 parent folder).
