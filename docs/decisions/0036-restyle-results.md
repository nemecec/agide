# 0036 Restyle results

Status: accepted
Date: 2026-11-21
Decided by: spike agents
Inputs: 0035 (the visual design brief, accepted by the user with the agent's defaults); 0032; `notes/visual-design-audit.md`; `notes/scripts/token-contrast.mjs`; 0031 and `notes/onscreen-check.md`; `docs/measurements/r-before.md`, `w-tokens.md`, `w-ui.md`, `integrate-a.md`, `w-chrome.md`, `w-import.md`, `integrate-b.md`, `w-panes.md`, `r-after.md`, `r-review.md`, `r-fix.md`, `r-record.md`; the reports of the verification step (summarized here; that step wrote no measurement file); the cross-model review of this record (`r-cross-review.md`)

## Context

The user accepted 0035 with the agent's defaults: the direction (calm, dense, native); the System theme follows the macOS accent and appearance while Agide Light and Agide Dark keep the Agide blue; the title bar shows the profile tile and a 2 px border without a tint; the ported themes are GitHub Dark Default and Catppuccin Mocha. This run built the migration of 0035 section 8 in these stages:

1. A before capture with `pnpm visual-check --hidden` after `pnpm build`.
2. Stage A: step 1 (tokens and the System theme) and step 2 (primitives and shared components) by parallel builders, then an integration step.
3. Stage B: step 3 (title bar and profile identity) and step 5 (VS Code import and the ported themes) by parallel builders, then an integration step.
4. Step 4 (pane by pane) by one builder.
5. An after capture, an independent visual review against 0035 and the before set, fixes of the review's defects, and a verification by a separate agent.
6. This record, then a cross-model review of it against the code, a new run of the tests and the screenshots (`docs/measurements/r-cross-review.md`); its corrections are in the text below.

All data in the app was fake (folders such as "Project A", a fake `claude`, the fake `gh` of the task tests and a local test page). No step committed, pushed or opened a pull request. The screenshot directories stay in the OS temporary directory, outside the repository: `agide-restyle-before` (before), `agide-restyle-stage-a`, `-stage-b`, `-stage-c` (per stage), `agide-restyle-after` (after, reviewed), `agide-restyle-final` (after the fixes) and `agide-restyle-verify` (verification).

## Decision

### What was built per step

| Step of 0035 8.1 | Built | What the screenshots show |
|---|---|---|
| 1. Tokens and the System theme | `core/theme/` (zod schema, token list, scale defaults, colour maths, contrast module, accent derivation, resolver, built-in `system`, `agide-light`, `agide-dark` files, the colour-literal scanner); `main/appearance.ts` (`themeSource: 'system'`, the `nativeTheme` `updated` listener, `getAccentColor()` and the `AppleColorPreferencesChangedNotification` subscription, a test hook for accent and increased contrast) with the `appearance` IPC; the renderer theme store that writes `--agide-*` to `:root` before the first render; the `agide-dock` theme class; terminal and peek themed from tokens; the per-profile theme choice in `appearance.json` of the profile data directory; `pnpm check:colours` with its allowlist; the `theme` phase of `pnpm visual-check`; `e2e/theme.spec.ts` | `14-theme-system-light-*`, `-system-dark-*`, `-contrast-light-*`, `-contrast-dark-*`, `-accent-pink-light-*`: light and dark coherent, the pink accent on the active tab line, the focus ring and the unread dots while info and busy stay blue, a 3 px focus ring where the regular one is 2 px (darker in light, lighter in dark) and stronger pane separators under increased contrast (sampled from the capture pixels). Only `14-theme-system-light-session` shows the terminal (light in a light window); the `-session` captures of the later modes show the inbox pane (see the capture gaps). The dark terminal shows in `03-layout-*` and `12-appearance-dark-session` |
| 2. Primitives and shared components | `radix-ui` and `lucide-react`; `renderer/ui/` (Button, IconButton, Chip and StatusChip, Badge, Field, Select, Checkbox, RadioGroup, Switch, SegmentedControl, Tabs, Disclosure, Table, Card, Dialog, Menu, Popover, Tooltip, Banner, Notice, EmptyState, Toolbar, `icons.ts`), overlays in `#agide-overlays`; `DialogHost` and `DialogFrame` on Radix Dialog; `ContextMenu` and the browser tab menu on Radix menus; the dialogs and the trust banner migrated; `dialogs.css` and `trustBanner.css` removed; `e2e/uiFocus.spec.ts` | `04-new-session-dialog`, `04-new-task-dialog-*`, `05-settings-*`, `06-browser-context-menu-over-view`, `06-browser-tab-menu-over-view`: custom selects, checkboxes, radios and disclosures in place of native controls, labels above fields, Cancel then a filled Start, destructive menu entries set apart in red |
| 3. Title bar and profile identity | `hiddenInset` window with a 38 px title bar (profile tile, name, Temporary chip, layout switcher, usage meter, inbox and settings buttons), a 2 px bottom border in the profile colour and no tint; the rail at 52 px with 32 px tiles, a current-profile bar, running dots and unread badges; the setup card as a popover from the profile identity; the profile strip and the Layout bar removed; tile colours in `core/theme/profileColour.ts`; `e2e/titleBar.spec.ts` | `02-tree-populated-*`, `03-layout-*`, `10-profiles-default-window` (blue tile and border), `10-profiles-work-window-badge-and-setup` (green tile and border, setup popover); the chrome above the dock is 38 px where the strip and the Layout row took 54 px, and pane content starts about 20 px higher (measured in the captures; the saving of about 52 px that 0035 3.1 expects does not hold) |
| 4. Pane by pane | Tree (Lucide icons, type shown by icon with the type in the tooltip, flexible title, status chips that collapse to icons through container queries), agent rows, inbox list and card, browser chrome and banners, observation control, terminal bar, usage pane, history table, empty states, layout notices, dock tab titles; the old variable aliases, `.btn-primary` and `.chip` removed from `styles.css`; the colour-literal allowlist empty | `07-agents-*`, `08-usage-pane-heat-plan`, `09-inbox-*`, `06-browser-*`, `11-*`: icon plus word for status, tabular numbers in the usage pane, the Snooze menu, the inset address field with the bold host |
| 5. Import and the ported themes | `core/theme/vscode/` (JSONC reader, `.vsix` reader, kind detection, mapping, clamp, license handling, the `--vscode-*` alias table); the theme service and the commands `theme_list`, `theme_get`, `theme_validate`, `theme_preview`, `theme_revert_preview`, `theme_apply`, `theme_undo`, `theme_import`; user themes in `<profile data directory>/themes/`; the theme picker and import dialog in Settings; the preview notice with Keep and Revert and the change notice with Undo; `github-dark-default.json` and `catppuccin-mocha.json` ported with `scripts/port-vscode-theme.mjs`; `NOTICE` entries for Lucide and both ports; `e2e/themeCommands.spec.ts` | `05-settings-top`: System, Agide Light, Agide Dark, GitHub Dark Default (port) and Catppuccin Mocha with kind chips, license and source lines and an Import VS Code theme button. No capture shows a ported theme applied to the UI or the import flow |

The integration steps joined the builders' work. Stage A renamed the badge's local setting to `--ui-badge-ring`, added `core/theme/tokenUsage.test.ts` (no stylesheet reads an `--agide-*` name that no built-in theme defines; 0035 8.3 asks for it), removed literal fallbacks after tokens and set the dock overlay z-index to `z.dock-overlay`. Stage B removed the `appearance:set-theme` channel, so the picker changes the theme only through `theme_preview` and `theme_apply` (0035 5.4), added `core/theme/vscode/aliasTable.test.ts`, held the rail at 52 px with dockview group constraints (`fixedWidth` in `layout/hostModel.ts`; before, the preset share gave the rail about 100 px), and deleted the unused `themeSetting.ts` and `PlanUsage.tsx`.

Deviations from 0035:

| Item | 0035 | Built |
|---|---|---|
| `text.link` | Uses `accent.text` (3 to 1 on `surface.window` is enough as a mark) | Derived on its own and moved until it reaches 4.5 to 1 on the window, because the table of 1.8 is a test target for every accent |
| `accent.subtle` (rule 4) | `text.primary` and `accent.text` keep 4.5 to 1 | Also `text.secondary` and `text.tertiary` |
| GitHub port `danger.fill` | Follows the derivation | Ends at `#bd534e`: it follows the clamped `danger.fg`, then moves away from the white text on it |
| Theme choice | Profile setting `appearance.themeId` | `appearance.json` in the profile data directory, with a revision, read and written through the theme commands |
| Open VSX | One metadata request and one download per import, on a user action | Not built; import takes a file the user selects |
| Dock tab close button (3.3) | IconButton on each tab | Not built: no command removes a pane from the layout |
| Inbox header | One row | Title and Open/Done on the first row, counts on a second row; one row does not fit the 320 px list column |
| Picker source line | "MIT · GitHub/github-vscode-theme 6.3.5" | "MIT · GitHub.github-vscode-theme 6.3.5" (the extension id) |
| Title bar tint (3.1) | `surface.window` mixed with the profile colour | No tint, by the user's default; the 2 px border and the tile carry the profile colour |
| `lucide-react` release age | Not covered | `app/pnpm-workspace.yaml` lists `lucide-react@1.77.0` under `minimumReleaseAgeExclude`, because the release was younger than pnpm's release age gate when step 2 added it. Neither new package has an install script; question below |

### Before and after evidence

The before set (`r-before`) and the after set (`r-after`) each ran every phase with hidden windows. The before run used the light system appearance and the after run the dark one, so the default captures of phases 01 to 11 compare light with dark; the `12-appearance-*` and `14-theme-*` captures give both.

Screenshots added to the repository, each opened and checked for fake data only (the overview shows a loopback address with a port and no other address). Each file holds the chunks IHDR, iCCP, IDAT and IEND: no text, time or EXIF chunk, and the iCCP chunk is the generic colour profile that Chromium writes:

| File | Source capture (verification run) | Shows |
|---|---|---|
| `docs/images/agide-overview.png` | `03-layout-pair` | Pair layout in dark: title bar, rail, tree with icons, a session terminal with the busy chip, a browser tab on the local test page |
| `docs/images/agide-settings-themes.png` | `05-settings-top` | Settings dialog with the theme list and the Import button |
| `docs/images/agide-inbox-light.png` | `14-theme-system-light-inbox` | System light: tree, inbox list with the Needs answer chip, empty detail state |

`04-new-task-dialog-jira` and `04-new-task-dialog-pull-request` show a temporary run path in the Repository field and stay out of the repository.

The independent review opened captures of every phase, zoomed crops and `focus-order.json` of both runs, listed defects against 0035, then compared with the before set.

Improvements it confirmed:

| Area | Before | After |
|---|---|---|
| Chrome | Grey "Default (temporary profile, not saved)" strip, a Layout row with a native select, then the dock tabs | One title bar with tile, name, Temporary chip, layout switcher, usage gauge, inbox button with badge, settings button |
| Profile identity | A title strip filled with the profile colour; coloured letter tiles in a rail about 100 px wide, with an outline on the current tile, a text bullet for running and an unread badge; a temporary profile showed text only | 32 px tiles in a 52 px rail, 2 px border in the profile colour under the title bar, dashed tile for a temporary profile, current bar, green running dots, unread badge |
| Icons | Text glyphs and small triangles; grey "Claude session" and "Browser tab" labels that won over the title at 900 px | Lucide line icons in tree, tabs, title bar, inbox kinds, browser toolbar and menus; at 900 px the tree reads "Fix upload retry" where it read "Fix upload ret... Claude ..." |
| Status | Text colour, a plain chip or a text glyph with a word; name and state of a failed history row in red | Icon plus word for busy, waiting, failed, done, Live and Needs answer; the history state column has icon and word |
| Light and dark | Colours set in separate stylesheets and in the terminal options; the terminal was already dark in a dark window since 0031 | One token set drives the window, the terminal and the peek; surfaces step as specified |
| Focus | Amber ring `rgb(184,110,0)` | 2 px accent ring `rgb(61,154,255)`; IconButtons show a tooltip on focus |
| Controls | Native selects, checkboxes, `<details>` markers, bevel buttons | Radix-based Select, Checkbox, RadioGroup, SegmentedControl, Disclosure; quiet, secondary and primary buttons |
| Dialogs | The task and settings dialogs both 480 px wide, settings content cut at the lower edge | 480 px for the forms and 640 px for settings, large radius and shadow, a footer with Close in settings, start error as a danger Notice inside the dialog (the Notice is not in a capture) |
| Inbox | Mixed dot and label colours, three snooze buttons | Unread-dot gutter, kind icon and name, a Snooze menu, Mark as unread and Peek as quiet buttons |
| Browser tab | Text buttons and a bordered address field; the main capture with live observation showed a blank page area, the pair and approval captures showed the page | IconButton toolbar, inset address field with Web chip and bold host, eye icon and Live chip, the page visible in the pair and live captures; agent banner as Deny, Allow once, More. The approval capture is blank in the final and verification runs and shows the page inside the amber frame in the cross-review run, so the composed capture of the page is intermittent in both sets |
| Themes | One look | Settings lists the built-in and ported themes with license and source; increased contrast and the pink accent visibly change the UI |
| Usage pane | Right-aligned numbers under a header rule, heat bars in a column without a heading, the plan line as a bullet | The Table component with a header row, row rules and a Level heading over the heat bars; no bullet. The change is small |

Regressions it found: the session row's aggregate chips squeezed the title to "Fix up..." and clipped "1 finished" at the pane edge (Q-01); agent rows repeated their status word after the chip (Q-02); the theme list put a primary "Use" button on every row (Q-03).

Defects and what the fix step did:

| Id | Severity | Defect | Outcome |
|---|---|---|---|
| Q-01 | major | Session row chips take the row; title truncated, last chip clipped | Fixed: tallies are icon plus count with the words as accessible name and tooltip; under 320 px only the worst tally stays |
| Q-02 | major | Agent rows say their status twice | Fixed: the outcome shows only when it differs from the chip; the basis moved to the row tooltip |
| Q-03 | major | A primary "Use" on every theme row | Fixed: "Use" is a secondary button |
| Q-04 | major | Rail and profile identity not in the Tab order; focus order does not follow the visual order | Fixed: the temporary-profile tile and the title-bar identity take focus with accessible names; the focus phase starts from the top of the document. Confirmed from `focus-order.json`, the focus shots were not reopened |
| Q-05 | minor | "1 finished" stays after the finished agent's row is removed | Not changed; question below |
| Q-06 | minor | No 2 px warning outline around the page while an agent acts; banner text all semibold | Fixed: a frame around the browser slot (view inset 2 px) while the agent acts or an approval is open; regular weight with the session name emphasised. Verification saw the amber frame |
| Q-07 | minor | Failure kind icon looks like the failed status icon | Source already mapped `octagon-x`; a test was added. At 16 px it still reads round |
| Q-08 | minor | Card header baselines differ; raw JSON in the body font; long body lines | Fixed: JSON in an inset mono block, header aligned, body capped |
| Q-09 | minor | Menus reserve an empty icon gutter or mix items with and without icons | Fixed: the gutter goes when no entry has an icon; tree and tab menu entries got icons |
| Q-10 | minor | Native textarea resize grips; browser-default list bullets | Fixed in CSS; not inspected in a screenshot |
| Q-11 | minor | Half-cut text above a faint footer divider in Settings | Fixed after the last capture run; checked by tests and e2e only |
| Q-12 | minor | Flat hierarchy in the setup popover; "(done)" in parentheses | Fixed: title, a Done chip, section heading |
| Q-13 | minor | Read state and action names differ between cards | Fixed: one dwell rule; "Mark as read" and "Mark as unread" |
| Q-14 | nit | Prose placeholders in monospace | Fixed: placeholders in the UI font; not inspected in a screenshot |
| Q-15 | nit | Empty states centred; redundant empty inbox messages; "Surface host" tab title | Fixed in part: 30% spacer, one message in the empty inbox, the unbound tab reads "No surface". The tree empty state still sits near the top, and the tab's accessible name still reads "Surface host" |
| Q-16 | nit | Title-bar badge and tooltips touch the window edge | Fixed: badge offset, tooltip collision padding |
| Q-17 | nit | "(port)" on one ported theme name only | Not changed; question below |

The verification agent opened the System light and dark session, dialog and inbox shots and the dark browser approval shot of its own run, and judged the System theme clearly better than the before set. It noted: the focused tree row and the selected browser row carry similar blue marks side by side; "Projec..." is cut next to the Needs answer chip in the inbox; the empty detail pane leaves a large blank area; the sample page does not render under the approval bar in hidden mode. The cross-review ran the browser phase again with hidden windows: there the page renders under the approval bar inside the amber frame, so the blank area is a capture that sometimes misses the page, not a state of the app.

### Tests and coverage

Final results, from the fix and verification steps. The cross-review ran typecheck, the colour check, coverage, e2e, parity, the contrast script and the browser phase of the visual check again and got the same results:

| Command | Result |
|---|---|
| `pnpm typecheck` | pass (node and web projects) |
| `pnpm check:colours` | pass; the allowlist is empty. The command is not part of `pnpm check` or of continuous integration |
| `pnpm coverage` | pass in each run of the verification: 179 files, 1755 tests passed, 15 skipped, thresholds met; no flake |
| `pnpm build` | pass |
| `AGIDE_HIDDEN=1 pnpm e2e` | 73 passed in 2.0 min |
| `pnpm parity` | parity ok; the theme commands are MCP tools; the run prints a warning about the missing `src/main/modules/inspect.js`, which predates this run |
| `pnpm visual-check --hidden` | every phase ran |
| Grep for hex, `rgb()` and `hsl()` in `src` outside `core/theme/builtin` and tests | No stylesheet or component under `src/renderer` holds a literal. Hits are in non-UI code: `core/theme` logic, the profile palette and migration default, a capture mask style in `main/browser/capture.ts` |
| Leak scan of text files | Only fake fixtures; the PNG files were checked by eye for this record |

Coverage figures reported per step: `renderer/ui` 97.6% lines (step 2, with a threshold for `src/renderer/ui/**` added), `core/theme/vscode` 94.6% statements (step 5), `profileColour.ts` 100% lines (step 3). In the cross-review run: `renderer/ui` 99.3% lines, `core/theme` 97.5% lines, `core/theme/vscode` 94.6% statements, `renderer/theme` 99.2% lines. Along the way a full coverage run failed once in `ui/Menu.test.ts` under load (fixed in the test) and the `src/main/**` function threshold was missed while `appearanceIpc.ts` had only e2e coverage (excluded from unit coverage).

New tests of 0035 8.3: contrast (every pair of 1.8 for every built-in theme including the ports and the increased contrast overrides), token set and token usage, schema error codes, System derivation for the sample accents and the fallback, VS Code mapping on fixtures cut from the ported files, `--vscode-*` aliases, theme commands (unit and e2e), following the OS (`e2e/theme.spec.ts`: `themeSource` dark and light without a reload, accent and increased contrast through the test hook, the saved choice across a restart), focus (`e2e/uiFocus.spec.ts`).

### Contrast

`node notes/scripts/token-contrast.mjs` reports no pair below target. The script holds its own copy of the values of 0035; every colour of its checked pairs equals the value in `agide-light.json` and `agide-dark.json`. The System accent derivation table is at or above 4.5 to 1 for text. The terminal table is reported, not checked: ANSI black on the dark background (1.96) and some colours over the selection (lowest 3.51, dark bright black) are under 4.5 to 1, and the xterm option `minimumContrastRatio: 4.5` lifts them when drawn (0035 1.2). The unit contrast test passes for Agide Light, Agide Dark, both ports and the increased contrast overrides. The review judged contrast on zoomed crops by eye; it could not sample pixel colours. The cross-review sampled the focus ring and separator pixels of the `14-theme-*` captures only.

### Measured effort

| Step | Measurement file | Start (UTC) | End (UTC) | Wall time | 0035 estimate |
|---|---|---|---|---|---|
| Before capture | `r-before.md` | 23:01 | 23:05 | about 4 min | |
| 1. Tokens and System | `w-tokens.md` | 23:04 | not recorded; before 23:45 | about 40 min | one to two days |
| 2. Primitives | `w-ui.md` | 23:04 | about 23:50 | about 46 min | two days |
| Integration A | `integrate-a.md` | 23:44:55 | 23:54:48 | about 10 min | |
| 3. Title bar | `w-chrome.md` | 23:55 | 00:25 | about 30 min | one day |
| 5. Import and ports | `w-import.md` | 23:55 | 00:25 | about 30 min | two days |
| Integration B | `integrate-b.md` | 00:24:50 | 00:36:20 | about 12 min | |
| 4. Pane by pane | `w-panes.md` | 00:36 | 01:10 | about 34 min | two to three days |
| After capture | `r-after.md` | 01:11 | 01:20 | about 9 min | |
| Independent review | `r-review.md` | 01:15 | 01:20 | about 5 min | |
| Fixes | `r-fix.md` | 01:21 | 01:37 | about 16 min | |
| Verification | none (report only) | 01:37 | about 01:45 | about 8 min | |
| This record | `r-record.md` | 01:44 | see the file | | |

The before capture started 2026-11-20 and verification ended 2026-11-21: about 2 h 45 min elapsed. Parallel builders ran in stages A and B, so summed agent time is higher than the elapsed time. The 0035 estimates were written for a person; the agents built steps 1 to 5 in about 3 h, with less than 0035 asks (see below) and with the machine under heavy load for part of the run. Token spend and user hours are not recorded. What took long: Electron e2e runs and visual-check runs; the interaction of the Radix menus with the tree's focus model (the context menu closed itself on a focus change); finding where xterm 6 paints its background.

### Not done or not verified

Not done:

- Per-step before and after sets and per-step independent reviews (0035 8.2): one before set, one after set and one review covered the whole migration.
- `docs/themes.md` generated from the schema and its unit test (5.1).
- Hot reload of user theme files with a danger Banner (5.2), "Duplicate" for built-in themes, a View menu, the daily digest entry for an agent's `theme_apply` (5.4), a preview limited to one window from the UI (the command takes `windowId`; the picker does not pass it).
- Open VSX import (6.6): the audit's reading of the Open VSX terms is unclear, and 0035 asks for a written answer from the Eclipse Foundation first.
- Vibrancy (7.4), zoom with `ui_zoom_set` (7.5) and a density setting; tokens resolve with the regular density.
- Under increased contrast, step 1 reported the selected-row outline, card outlines and the 2 px dock sash as not done; this record did not recheck them.
- The dock tab close button; a keyboard route to the tree context menu; reading pane manifests' `preferredWidth` (only the rail has a fixed width).

Not verified:

- The real macOS events: an appearance change in System Settings, an accent change, Increase contrast, Reduce transparency and Differentiate without colour. Tests used `nativeTheme.themeSource` and the adapter's test hook. How macOS reports Multicolour through `getAccentColor()` is unknown.
- The traffic light offset `{ x: 14, y: 13 }`, double-click zoom on the drag region and the full-screen inset: hidden windows do not draw the native lights.
- Hover and press states, a highlighted menu item, the layout switcher menu, drag lines and drop targets, reduced motion.
- A ported theme applied to the UI, the import dialog with a real `.vsix`, and the preview notice in a capture.
- Floating dock groups under a dialog with the new overlay z-index; the rail width after a splitter drag or in a layout where the rail shares a group.
- Capture gaps carried over from 0031: `05-settings-network` and `-sandbox` show the top of the dialog; the scrolled many-nodes shot equals the unscrolled one; `11-provider-runtime-missing` does not show the srt message.
- Capture gaps of the `theme` phase: after the first mode the `-session` captures show the inbox pane, because the script clicks the session row while the Inbox tab is in front, and a click on a tree row does not bring the surface tab forward. No capture shows the terminal under increased contrast or with the pink accent, and none shows it in System dark inside the theme phase. Whether a click on a tree row should bring its tab forward is a question below.
- The composed capture of a browser page is sometimes blank in hidden runs (the live observation capture of the before set, the approval capture of the final and verification runs).

### Questions for the user

| Topic | Question |
|---|---|
| Q-05 finished tally | Keep the trace of agents that finished inside the removal delay (record 0027; the tooltip now says "finished in the last minute"), or count only visible rows? |
| Q-17 theme names | Keep "GitHub Dark Default (port)", which 0035 6.5 asks for because the MIT text does not license the GitHub trademark, or drop the suffix and rely on the source line? |
| Q-07 failure icon | `octagon-x` still reads round at 16 px. Use another glyph for the Failure kind? |
| Open VSX | Ask the Eclipse Foundation about use by an application other than an editor, or keep file import only? |
| Inbox header | Accept the counts on a second row, or widen the list column? |
| Browser approval | "Always allow this site" lost its explanatory tooltip when it moved into the More menu. Add a line of text in the menu? |
| GitHub port hover | The clamped `accent.hover` sits close to the rest fill. Accept, or move hover away from white text contrast? |
| Themes | Which other themes does the user like, beyond the ports? |
| `lucide-react` release age | Keep `lucide-react@1.77.0` under `minimumReleaseAgeExclude`, or remove the entry once the release is older than the gate (or use an older release until then)? |
| Tree row and its tab | Should a click on a session or browser row in the tree bring the surface tab in front of the Inbox tab? Today the Inbox tab stays in front. |
| Colour check in the gate | Add `pnpm check:colours` to `pnpm check` and to continuous integration? |

## Consequences

- 0035 is built in every step, with the parts listed above left out. The renderer holds no colour literal. `pnpm check:colours` fails on a new one; nothing runs it automatically yet (question above).
- The look is now set by tokens: a change to a token value or a new built-in theme must pass the contrast unit test.
- `docs/images/agide-overview.png` is replaced by the after overview; `agide-settings-themes.png` and `agide-inbox-light.png` are new.
- The screenshot directories, some temporary logs and a crop directory of the review stay in the OS temporary directory; removal was denied to several agents. `/tmp/agide-import-src` holds the extension packages downloaded for the ports.

### Recommendations for the next milestone

1. Run the macOS probes of the audit, section 6, by hand once with the user present: appearance, accent, Increase contrast, Reduce transparency, traffic light position, double-click zoom and full screen. Record the results in this record's successor.
2. Run `pnpm visual-check` once without `--hidden`, with screen recording granted to the terminal host, to see the title bar with the traffic lights and the native browser view under overlays.
3. Add captures for a ported theme applied to every view, the import dialog with a real package, the preview notice, hover and highlighted menu states, and fix the settings section and scroll capture gaps.
4. Capture before and after sets in the same system appearance, and add a pixel diff between run directories.
5. Build `docs/themes.md` with its test, user theme hot reload, zoom and the density setting; then vibrancy after its probe.
6. Answer the questions above, then settle the dock tab close command and the keyboard route to the tree context menu.
7. Run per-step reviews for the next visual change, so regressions such as Q-01 surface at the step that adds them.
