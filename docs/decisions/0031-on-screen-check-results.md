# 0031 On-screen check results

Status: accepted
Date: 2026-11-18
Decided by: spike agents
Inputs: 0030 ("What remains open": no on-screen check of any milestone 2 or 3 UI); `notes/onscreen-check.md`; `docs/measurements/v-capture.md`, `v-review.md`, `v-fix.md`, `v-verify.md`, `v-record.md`, `v-cross-review.md`; the capture, review, fix and verification reports of the on-screen run (summarized here, not stored as files)

## Context

Every test before this run launched the app with a hidden window, so no milestone 2 or 3 screen had been looked at. This run looked at them in these steps:

1. Capture: a new script, `pnpm visual-check`, walks the UI states on fake data and writes one PNG per state. The capture agent opened a large share of the images and listed defects V-01 to V-22 in `notes/onscreen-check.md`.
2. Independent review: a second agent opened every distinct PNG and wrote its own list before it read the capture notes. Its list, R-01 to R-30, merges and re-rates the V items.
3. Fixes of the defects that sit in the renderer, styles, copy and small behaviour, with unit tests, one new Playwright spec and a second capture run.
4. Verification by a separate agent: the gates, a third capture run and a look at the after screenshots.
5. This record.
6. Cross-model review of this record, the notes and the README changes: the gates again, a look at the after screenshots of the verification run, and corrections. Its findings are marked "cross-review" below.

All data in the app was fake: folders such as "Project A", a fake `claude`, the fake `gh` of the task tests and a local test page. No step committed, pushed or opened a pull request.

## Decision

### What was captured and how

`pnpm visual-check` (`app/scripts/visual-check.mjs`, helpers in `app/scripts/lib/visual/`) runs these phases: empty, workspace, dialogs, agents, inbox, browser, profiles, errors, appearance and focus. Each run writes a new directory under the OS temporary directory (or under the directory given with `--out`), so runs before and after a change can be compared side by side. `--only` runs a subset and `--hidden` keeps every window off the screen. The cross-review found that `--out` was documented and not read by the script, and added it.

| Item | Value |
|---|---|
| Visible windows | The capture run showed the windows of the empty, workspace, browser, profiles and appearance phases on screen; the other phases ran hidden. The fix and verification runs used `--hidden`. |
| Window size | Fixed with `setContentSize`: 1440 by 900 by default, 900 by 900 and 1920 by 1080 for the tree, 900 by 700 for the profile windows. Images are twice that size (retina). |
| States | First launch; populated tree at 900, 1440 and 1920 px; Session and Pair presets; new-session and new-task dialogs; profile settings and the setup pane; browser tab with observation off, on demand and live, its popover, menus, a dialog over the view and the agent navigation bar; agent rows, removal, history; usage pane with heat markers and plan line; inbox list and cards with peek; a Default and a Work profile window with a badge; empty inbox, invalid layout, missing `claude`, missing provider runtime, long names; light and dark; keyboard focus with `focus-order.json`. |
| Run time | All phases: 2 min 56 s in the capture run, 3 min 21 s in the fix run, 3 min 34 s in the verification run (`sources.json` of each run). |

| Capture source | Result |
|---|---|
| `ui_capture_window` (the app's own capture, native views composed) | Works for every state; `<state>.png`. |
| `page.screenshot` of the renderer | Works; `<state>.page.png` for the browser states. Shows DOM layers, not native views. |
| macOS `screencapture` | Refused in the capture run ("could not create image from window"): the terminal host has no screen recording permission. The script tries it for visible windows until the first refusal; a run with `--hidden` does not try it. |

Not captured: OS-level pixels of the window, so the native browser view has no second source and what the user's screen shows under a dialog or popover is inferred from the app's capture and from the code (while a dialog, menu or popover is open the renderer hides the native views behind stills, `src/renderer/panes/browser/suspension.ts`); the dock badge and system notifications; focus stealing when a window opens; the real `claude` terminal (the fake prints a short banner); the macOS appearance setting (dark mode was emulated through the media query and the native theme); pixel diffs between runs.

Capture gaps found by the review: several files that should show different states were byte-identical (`05-settings-top`, `-network` and `-sandbox`; several `13-focus-main-*` shots and `13-focus-tree-arrow`; the many-nodes shot before and after scrolling); the provider-missing capture showed the `claude` error and not the srt section; the context menu "over view" opened inside the tree pane and never covered the browser view; dark mode and the 900 px width were captured for a few screens only; the dialog focus test stopped at Cancel; the approval answer path and the outcomes of the navigation bar were not captured. The profile strip and rail were empty in most populated captures because the strip was hidden for a profile that is not saved; that is defect R-05 and is fixed.

The verification run still has these gaps (cross-review, by checksum and by opening the files): the settings shots `-top`, `-network` and `-sandbox` are identical, the many-nodes shot is the same before and after scrolling, the context menu capture equals its renderer screenshot, and `11-provider-runtime-missing` shows the `claude` error with the srt section below the inner scroll.

`docs/images/agide-overview.png` is the Pair layout capture of the fix run (byte-identical to `03-layout-pair.png` of that run): a populated tree, a session terminal and a browser tab on the local test page, generic names only, a loopback address with a port, no metadata in the file. It still shows cut session titles in the narrow tree pane (R-09). The fix run's captures were taken about 50 minutes before the fix step ended; the tree and terminal area of the same capture in the verification run is identical.

### Defects from the independent review

The table lists the review's defects by severity (major, minor, nit). "V" names the capture agent's item where the review merged one.

| Id | Severity | Screen | Defect |
|---|---|---|---|
| R-01 | major | inbox approval card | No way to answer; Done reads like approve while the session stays waiting; the request is printed twice (V-14) |
| R-02 | major | inbox list | An approval looks handled once viewed; read items move to the top, so rows move under the pointer |
| R-03 | major | agent rows | The session tally counts a failed agent as finished and waiting as running; panes disagree on a failed turn |
| R-04 | major | browser observation | Live differs from On demand only by a filled eye; the popover explains nothing |
| R-05 | major | profile identity | No profile strip, empty rail and an unnamed settings heading in populated windows |
| R-06 | major | new-session dialog | "Outward actions listed below" with nothing below; Auto preselected here, "Profile default" in the task dialog; select without accessible name |
| R-07 | major | agent navigation bar | "Always allow this site" weighs the same as Deny; the asking session is not named (V-13) |
| R-08 | major | failed agent row | Action button cut at the pane edge (V-01) |
| R-09 | major | tree rows, narrow | Title cut or dropped while the type label stays whole; the first overview image showed this (V-05) |
| R-10 | major | new-session dialog | Fields run together on one line, no backdrop, buttons touch (V-03) |
| R-11 | major | profile settings | Host lists inside sentences, unclear Save scope, inner scroll, unsafe provider shown as "Ready." (V-04) |
| R-12 | major | main window focus | No visible focus on dock tabs and tree rows; inbox tab and rail not reached by Tab (V-06) |
| R-13 | major | dialogs | A dialog does not take focus when it opens (V-07, in part) |
| R-14 | major | capture over a browser tab | The composed capture drops dialogs and popovers above the native view (V-02) |
| R-15 | minor | tree markers | Outline and fill markers at once; the outline row decides the task dialog's parent folder (V-22, not dark-only) |
| R-16 | minor | inbox kinds | `rate_limit` is an Alert, `server_error` a Failure; one dot colour; mixed path depth; raw timestamps |
| R-17 | minor | usage pane | Folder rollup above the profile total; shares sum to 103 %; no column headers (V-12) |
| R-18 | minor | menus | Destructive items without separation; inconsistent ellipses |
| R-19 | minor | missing `claude` | Plain lower-case error naming an environment variable; Start stays enabled (V-15) |
| R-20 | minor | invalid layout | Raw JSON pointers, no dismiss; the select reads "custom" (V-16) |
| R-21 | minor | setup pane | Unlabelled fields, disabled Save without a hint, card placed low on the right (V-10) |
| R-22 | minor | profile rail | Letter-only buttons, unexplained dot, selection looks like a focus ring (V-09) |
| R-23 | minor | dock tabs | Internal ids as titles ("surface-host" twice); mixed-case preset names (V-11) |
| R-24 | minor | session status | Status only as plain text in the pane header and peek, none in the tree (V-20) |
| R-25 | minor | agent history | Failed rows not marked; "~$0.0000"; no start time; labels touch controls |
| R-26 | minor | dark appearance | Terminal stays white; selected inbox filter invisible (V-08) |
| R-27 | minor | inbox header | Buttons wrap; the empty message says the same thing twice (V-18) |
| R-28 | minor | browser leaf | The leaf reads "127.0.0.1" and not the page title (V-17) |
| R-29 | nit | task dialog | Repository path cut at the start, no folder picker, detected kind looks like a label |
| R-30 | nit | window chrome | Unstyled Layout select; empty folder shows no hint; arrow column shifts (V-21) |

Where the review disagreed with the capture agent:

| Capture item | Review position |
|---|---|
| V-13, V-14 rated minor | Major (R-07, R-01): the navigation bar invites "always allow" and the approval card cannot answer |
| V-22 dark-only | Also in light captures, and it decides the task dialog's parent folder (R-15) |
| V-07 "Tab leaves the dialog" | Not shown; only "no focus on open" is confirmed |
| V-19 folders collapse after a layout switch | Not visible in this capture set |
| V-17 page title "Sample page" | The page read "Sample dashboard" in that run. Cross-review: that is the heading; the title element of the test page is "Sample page", so the capture item stands |
| V-02 context menu above the page | That menu never covers the view; V-02 is a defect of the capture tool, and what the screen shows is unknown |
| Badge on the other profile's button | It sits on the window's own profile button |
| Provider-missing capture shows the srt section | It shows the `claude` error; the srt section is below the inner scroll |
| Empty rail only in the agents layout | Also empty in the Session and Pair presets (R-05) |
| V-12 heat markers look the same at every level | Identical where shown; low-cost rows show none |
| First overview image is fit for the public README | It showed a dropped title and duplicate tab ids (R-09); it was regenerated after the fixes |

### What was fixed

The fix step changed renderer components and styles, the agent tally in `src/core/agents/view.ts`, the capture stacking in `src/main/browser/capture.ts`, a `sessionTitle` field on browser approvals and the browser leaf title. Contract changes are in 0029 under "Changes after the on-screen check". New behaviour has unit tests (`DialogFrame`, inbox order, tally, profile identity, approval bar, observation badge, context menu clamp, tab title numbering, leaf title) and `e2e/onscreenFixes.spec.ts` (dialog focus, Tab trap, Escape and backdrop; profile strip; tree title width).

| Id | Change | After screenshot opened by |
|---|---|---|
| R-01 | "Answer in session" on approval cards, "Dismiss without answering", a note that the card cannot answer, the raw request collapsed (the card still prints the tool input under its title). No Allow or Deny on the card. | fix, verification: `09-inbox-card-0-approval-after-back` |
| R-02 | Stable order (open approvals, urgency, creation time); a "Needs answer" chip that stays after reading | fix, verification: same file |
| R-03 | Running, waiting, failed and finished counted apart; failed count in red | fix, verification: `07-agents-running-waiting-failed` |
| R-04 | Coloured "Live" badge in the tab chrome and the tree row; one line per option in the popover | fix, verification: `06-browser-tab-observation-live` |
| R-05 | Grey strip "Default (temporary profile, not saved)", rail note "Temporary profile", settings heading "Profile settings (temporary profile)"; a saved profile gets its name in the heading (code, not captured) | fix, verification: `02-tree-populated-1440`, `05-settings-top` |
| R-06 | The Auto sentence names pushes, comments and messages; "Auto (profile default)"; accessible names on the selects | fix, verification: `04-new-session-dialog` |
| R-07 | Session named, request stated once, Allow once primary, "Always allow this site" behind "More" | verification, cross-review: `06-browser-agent-navigation-bar` (the fix run captured it and the fix step did not open it) |
| R-08 | Row label and detail shrink first; the action stays in the pane | fix, verification |
| R-09 | Title takes the flexible width, type label shrinks first, title tooltip; new overview image | fix, verification: `03-layout-pair`; titles are still cut in the narrow pane |
| R-10, R-13 | Stacked fields, spaced buttons, backdrop and shadow; first field focused, Tab trapped, Escape closes, focus returns | fix, verification: `04-new-session-dialog`; Playwright spec |
| R-11 | One block per field, wide host lists, Save per section, taller panel (the provider list still needs the inner scroll), "Not isolated" chip beside an amber "Ready.", unavailable providers dimmed | fix, verification: `05-settings-top`; cross-review: `05-settings-isolation` for the dimmed srt provider |
| R-12 | Focus rings on buttons, inputs and tree rows, separate from selection. The ring on dock tabs was in the computed style and not in the image: the tab strip clipped it, and the dock-tab focus shots of the fix and verification runs equal the shots without it. The cross-review draws it inside the tab. | fix, verification: `13-focus-main-tab-02` (Layout select), `13-focus-tree-arrow` (tree row); cross-review: `13-focus-main-tab-01` and `-03` of its own focus run (dock tabs); tab order unchanged |
| R-14 | Capture stills drawn below dialogs, menus and popovers | fix, verification: `06-browser-dialog-over-view` |
| R-15 | One selection marker and a separate focus ring | fix, verification |
| R-16 | Coloured kind labels (approval and failure red, alert amber, reminder green, update grey; the unread dot keeps one colour); "Folder" label on the card | fix, verification: `09-inbox-card-0-approval-after-back` |
| R-17 | Column headers, thousands separators, "Started by Agide: n of m allowed" | verification only: `08-usage-pane-heat-plan` |
| R-18 | A line above the destructive item and red text, items left-aligned, consistent ellipses, menus kept inside the window | verification, cross-review: `06-browser-tab-menu-over-view` |
| R-20 | "Show what is wrong" disclosure and Dismiss | verification only: `11-invalid-layout-notice` |
| R-21 | Labelled Name and E-mail, hint beside the disabled Save | verification only: `10-profiles-work-window-badge-and-setup` |
| R-23 | Tab titles in words, numbered on collision; capitalised preset names | fix, verification |
| R-24 | Status chips in the terminal bar and the peek | fix, verification: busy chip above the terminal |
| R-25 | Failed history rows red, a Started column, "<$0.0001" | verification only: `07-agents-history-pane` |
| R-26 | Terminal follows the colour scheme while open; selected inbox filter filled | cross-review: `12-appearance-dark-session` (dark terminal, hollow cursor), `12-appearance-dark-inbox` (filled Open segment); the fix and verification steps opened light captures only |
| R-27 | Segmented Open/Done control; the empty state reads "No unread items" in the header and "No open items" in the list | fix, verification; cross-review: `11-empty-inbox` |
| R-28 | The leaf follows the page title until the user renames it | fix, verification: leaf reads "Sample page", the fixture's title in that run |
| R-29 | Tooltip on the repository field; detected kind as a chip | cross-review: `04-new-task-dialog-pull-request` shows the chip; the path is still cut at the start and a tooltip does not show in a still. No new unit test; the existing one checks the kind text. |
| R-30 | Styled Layout select, "(empty)" under empty folders, fixed arrow column | fix, verification |

### What was not fixed, with questions for the user

| Id | Open part | Question |
|---|---|---|
| R-01 | No Allow or Deny on the approval card | Waits for the `http` hook transport (0030, milestone 4 item 1). Is "Answer in session" enough until then? |
| R-03, R-24 | A session whose last turn failed is not marked; tree rows show no busy, idle or failed chip | Should the tree show a status per session, and from which feed? |
| R-12 | Tab does not reach every dock group, the inbox tab or the rail (dockview owns the order) | Roving focus across groups, or keyboard shortcuts per group? |
| R-15 | The task dialog's parent folder comes from the right-clicked row | Should it come from the selected row? |
| R-16 | `rate_limit` stays an Alert and `server_error` a Failure; path depth and raw timestamps in details | Keep the hook mapper's kinds, and what may the mapper write into details? |
| R-17 | Folder rollup above the profile total; shares sum to 103 % | Compute rollups and the total over one window, and force shares to sum to 100? |
| R-19 | Start stays enabled after a failure; the error names `AGIDE_CLAUDE_BIN` | Check for the binary when the dialog opens, and write a profile setting from "Choose claude binary…"? |
| R-20 | The Layout select reads "Custom" while the invalid-file notice is up | A layout manager change; wanted? |
| R-21 | The setup card sits low on the right | Move setup into the main area as a first-run screen? |
| R-22 | Ring as the selection marker; the unexplained dot on rail buttons | Should the running dot become a text label or go? |
| R-25 | Tree retention settings in the history pane; no session or parent column | Move retention to the settings panel? |
| R-29 | No folder picker | Needs a main-process dialog command; wanted in milestone 4? |

The tab menu already asked for confirmation before clearing site data, so only the visual separation of R-18 was added.

### Verification

| Command | Fix step | Verification step | Cross-review |
|---|---|---|---|
| `pnpm typecheck` | pass | pass | pass, before and after its changes |
| `pnpm coverage` | pass (one earlier run failed in `appModules.test.ts`, passed on rerun) | pass on two of three runs; one run had timeouts in `PtySessionService.test.ts` (resume) and `tasks.test.ts` (pull request guidance) | pass on the first and the last of four runs; the two between timed out in `appModules.test.ts` (grant revoked when the session closes), which passed alone three times |
| `pnpm build` | pass | pass | pass |
| `pnpm e2e` | full run with failures in `permissions.spec.ts` and `profiles.spec.ts`; both files passed alone | full run pass, hidden | full run pass, hidden, before and after its changes |
| `e2e/onscreenFixes.spec.ts` | pass; no mutation check | covered by the full run | covered by the full run |
| `pnpm parity` | "parity ok", warning that `src/main/modules/inspect.js` is missing | same | same; `docs/parity.md` unchanged |
| `pnpm visual-check --hidden` | all phases | all phases | focus phase, then empty and focus with `--out` |
| Scan of modified and untracked files for employer names, user paths, e-mail addresses and tokens | not run | no matches | no matches; the overview PNG has no metadata chunks |

The machine ran other work during the cross-review (load averages above 20), which may explain the timeouts; that was not tested.

The verification agent opened the after screenshots of the tree, Pair layout, new-session dialog, settings, live badge, dialog over the view, agents, usage, history, approval card, tab menu, navigation bar, invalid layout notice, setup card and the overview image, and saw the changes listed above. It did not open the dark captures, the observation popover, the task dialogs or the focus shots. Its screenshots were taken with hidden windows, so no fixed screen was looked at in a visible window. The `inspect.js` warning predates this run. It comes from the parity script, which loads the modules from the source tree, where the bundled inspector script does not exist; the built app has `out/main/inspect.js` (cross-review).

The cross-review opened, from the verification run: the tree at 1440 and 900 px, the new-session dialog, the pull-request state of the task dialog, the settings top and isolation shots, the live badge, the observation popover, the dialog over the view, the tab menu, the navigation bar, agents, usage, history, the approval card and its peek, the empty inbox, the invalid layout notice, the setup card, the provider-missing state, both dark captures and the focus shots; and the overview image. They show the changes of the table above with the corrections marked there. It changed the dock tab focus ring (`src/renderer/styles.css`), the `--out` option of `pnpm visual-check`, a comment in `src/main/browser/capture.ts` that described the native view as below the DOM layers, and a test name. Its own captures (the empty and focus phases, hidden) are the only ones taken after these changes.

### Measured effort

| Step | Measurement file | Start (UTC) | End (UTC) | Wall time |
|---|---|---|---|---|
| Capture and notes | `v-capture.md` | 06:25:38 | 06:43:27 | about 18 min |
| Independent review | `v-review.md` | 06:45:03 | 06:52:19 | about 7 min |
| Fixes | `v-fix.md` | 06:54:56 | 08:19:30 | about 85 min |
| Verification | `v-verify.md` | 08:19 | 08:32 | about 13 min |
| This record | `v-record.md` | 08:32:20 | 08:35:15 | about 3 min |
| Cross-review | `v-cross-review.md` | 08:35:43 | 08:54:00 | about 18 min |

Capture to the end of the verification took about 127 minutes elapsed; the steps ran one after another, so the summed agent time is close to that. The fix step took most of it. Token spend and user hours are not recorded.

## Consequences

- The open item of 0030 "No on-screen check of any milestone 3 UI" is narrowed, not closed: the states listed above were captured with the app's own capture and looked at as images, with the gaps listed above. 0030 asks for a visible-window run; the capture run showed windows, and the agents looked at captures, not at the screen. A packaged-app run, a visible-window look after the fixes and OS-level screen pixels remain open.
- `pnpm visual-check` stays as a tool, not a gate: it needs a build, shows windows unless `--hidden`, and leaves its screenshots in the OS temporary directory for a person or an agent to open.
- Earlier run directories and debug directories named `agide-visual-*` remain in the OS temporary directory; the capture agent's removal was denied. The directories of the fix and verification runs and of the cross-review's last run are kept for comparison; `notes/onscreen-check.md` names them.

### Recommendations for the next milestone

1. Run `pnpm visual-check` without `--hidden` once with the user present, and grant screen recording to the terminal host for that run, so the native browser view under dialogs and popovers is seen as the user sees it.
2. Fill the capture gaps: distinct scroll targets for the settings sections, a tree long enough to scroll, the srt section in the provider-missing state, a context menu over the browser view, dark and 900 px captures of the browser tab, settings, agent rows, usage and setup, and the dialog focus path to its end.
3. Add a pixel diff between two run directories, so a change can be reviewed by its differences.
4. Answer the questions above before the `http` hook transport, since R-01 and R-03 depend on it.
5. Have every visual fix step open each after screenshot it cites; in this run several fixes were first confirmed only by the verification step.
6. Give the parity script the path of the built inspector script or silence its warning, and look at the timeouts in `pnpm coverage` (`appModules.test.ts`, `PtySessionService.test.ts`, `tasks.test.ts`), which fail in some runs.
