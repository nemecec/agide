# Visual design audit

Date: 2026-11-18 (the machine clock of the run read 2026-11-20)
Inputs: decision record 0032, `docs/decisions/0031-on-screen-check-results.md`, `notes/onscreen-check.md`, the renderer sources under `app/src/renderer`, the screenshots of the most recent `pnpm visual-check` runs (directories named `agide-visual-*` in the OS temporary directory) and `docs/images/agide-overview.png`, and the primary sources listed in each section.
Scope: facts for the restyle in 0032. No application code was changed. Every platform and license fact below was read from the cited source on the day of the run; statements marked "not verified" were not.

Versions the app uses (from `app/package.json`): Electron 45.3.3, which ships Chromium 156 (release list at https://releases.electronjs.org/releases.json), React 19.3.1, dockview-react 8.9.0, @xterm/xterm 6.0.0.

## 1. Inventory of the current UI

### 1.1 Where styling lives

The renderer is styled with plain CSS, a stylesheet per component. There is no preprocessor, no CSS module and no design token file. The root rules and the shared button, chip and focus rules are in `app/src/renderer/styles.css`. Each pane owns a stylesheet next to its component. The dock frame comes from dockview's stylesheet with the stock `themeDark` and `themeLight` objects chosen by a `prefers-color-scheme` listener in `layout/LayoutHost.tsx`.

| Stylesheet | What it styles |
|---|---|
| `styles.css` | Variables, root font, `.btn-primary`, `.btn-danger`, `.chip` and its tones, the focus ring, `.placeholder` |
| `layout/layout.css` | The bar with the layout select, `.pane-tab`, the layout notices, the capture mask, the layout select |
| `panes/TreePane.css` | Tree rows, twisty, selection, drop target, rename input, drag line, the context menu |
| `panes/ProfileRail.css` | Rail, profile entries, badge, new-profile form, profile colour swatches, the profile strip, the setup card |
| `panes/TerminalPane.css` | Terminal bar and host |
| `panes/browser/browser.css` | Browser chrome, address bar, buttons, service badge, banner, approval bar, observation popover, tab menu, live badge |
| `panes/inbox/InboxPane.css` | Inbox header, segmented filter, rows, dots, detail card, raw block, peek |
| `panes/agents/agents.css` | Agent rows, history table, usage ranking, heat markers, plan usage |
| `panes/settings/settings.css` | Settings panel sections, provider cards |
| `dialogs/dialogs.css` | Dialog layer, backdrop, dialog box, labels, actions |
| `dialogs/task/task.css` | New task fields |
| `panes/session/trustBanner.css` | Trust banner |

### 1.2 Element kinds

| Element kind | Where it is styled | State of the styling |
|---|---|---|
| Buttons, default | None. The browser default button shows, with `font: inherit` set in a few scoped rules (`styles.css`, `TerminalPane.css`, `InboxPane.css`) | The grey native bevel button appears in dialogs, the inbox, the agents pane, the layout notice, the setup card and the profile form. Its look differs from every other control |
| Primary button | `.btn-primary` in `styles.css` | Blue fill, white text, 5 px radius, 3 px by 12 px padding. White on the dark accent `#4da3ff` has a contrast of 2.63 to 1 |
| Danger button | `.btn-danger` in `styles.css` | Red text only, no fill |
| Chrome button | `.chrome-button` in `browser.css` | Ghost button with a 12 percent hover fill; used in the browser bar only. No icon set: glyphs are text arrows and a text ellipsis |
| Segmented control | `.inbox-segments` in `InboxPane.css` | A tablist made of buttons. Selected state is a blue fill with white bold text, which changes the text width |
| Text inputs, textareas | Browser default; `width: 100%` rules in `dialogs.css`, `task.css`, `ProfileRail.css`; own rules for the address bar and the tree rename input | Default inset border, default focus ring replaced by the amber 2 px outline from `styles.css` |
| Selects | Browser default; one styled rule in `layout.css` for the layout select | Native popup menu. Used in the layout bar, both dialogs, the settings panel and the history filters |
| Checkboxes, radios | Browser default | Native controls with the system accent colour, unrelated to `--accent` |
| Chips | `.chip` with `data-tone` in `styles.css` | 1 px outline pill, 11 px text. Used for session status and the "Jira issue" kind label |
| Badges | `.badge` (profile unread), `.service-badge`, `.observation-live`, `.inbox-needs-answer` | Unrelated shapes: a red filled pill, an outlined capitalised pill, a blue filled mini pill, an outlined amber pill |
| Status text | `.agent-waiting`, `.agent-failed`, `.inbox-waiting`, `.isolation-check` | Coloured text with no icon; colour is the only signal |
| Heat markers | `.heat-marker` in `agents.css` | Three red bars made of a text glyph with negative letter spacing; amber and orange variants use three further hard-coded colours |
| Tabs, dock | Dockview theme variables and `.pane-tab` | Text-only tabs, 35 px strip, no close button, no icons, no drag affordance. Ids appear as titles in some presets (R-23) |
| Tabs, inbox filter | `.inbox-segments` | See segmented control |
| Tree rows | `TreePane.css`, `agents.css` | 24 px rows, 12 px twisty glyph, type label ("Claude session", "Browser tab") on the right as grey text, rate text and heat markers further right. No file or session icons |
| Agent rows | `agents.css` | 22 px rows with a text glyph mark (filled circle, half circle, cross) and a "dismiss" native button |
| Cards | `.inbox-card`, `.isolation-providers > li`, `.setup-pane`, `.profile-form` | Different border, radius and padding recipes (6 and 8 px radii) |
| Tables | `.history-table`, `.usage-ranking` grid | Bare table with bottom rules and 2 px by 6 px cell padding |
| Dialogs | `.dialog` in `dialogs.css`, three bodies | 480 px box, 8 px radius, 28 percent backdrop. Fields stack with labels above, native controls |
| Settings panel | `.dialog.settings-panel` | A dialog that scrolls inside itself; sections separated by a rule |
| Menus | `.context-menu` in `TreePane.css`; `.browser-menu` in `browser.css` | Two separate recipes for the same thing; neither has icons, shortcuts or keyboard navigation |
| Popovers | `.observation-popover`, `.profile-form`, `.setup-pane` | Absolutely or fixed positioned boxes with an inline arrow-less look |
| Tooltips | Native `title` attributes in many components | Delay and look set by the OS; none in the dock tabs or profile rail beyond the profile name |
| Banners | `.layout-notice`, `.trust-banner`, `.browser-banner`, `.approval-bar` | One recipe each; the warm tints use `#ff6b00` and `rgba(255, 193, 7, 0.18)` |
| Empty states | `.placeholder`, `.inbox-empty`, `.tree-empty`, `.browser-placeholder` | Muted one-line text at the top-left of a large blank area. No illustration, no action |
| Profile rail | `ProfileRail.css` | 48 px column, 28 px letter squares, running dot, unread badge, "+" tile; the temporary profile shows a two-line text note instead |
| Profile strip | `.profile-strip` in `ProfileRail.css` | 20 px full-width colour bar with bold white 11 px name; the temporary profile uses `--muted` as a fill |
| Terminal pane | `TerminalPane.css`, `TerminalPane.tsx` | 6 px by 8 px padding around xterm, terminal bar with a chip and buttons; own two-colour theme in TypeScript |
| Browser chrome | `browser.css` | Back, forward, reload as text glyphs, service badge, address field, observation eye with optional "Live" pill, "Open in Chrome" as a bare ghost button, "..." as a text ellipsis |
| Scrollbars | Default Chromium | No styling found in the stylesheets |

### 1.3 Hard-coded colours, sizes and fonts

Colour variables in `styles.css`: `--bg`, `--fg`, `--pane-bg`, `--border`, `--muted`, `--accent`, `--focus`, `--danger`, `--warn`, `--ok`, `--select-bg`, with a dark variant under `prefers-color-scheme`. These tokens exist in a light and a dark set only. The rest of the colours are literals:

| Literal | File | Use |
|---|---|---|
| `#fff` | `styles.css`, `ProfileRail.css`, `InboxPane.css`, `browser.css` | Text on accent, badge, strip |
| `#d92d20` | `ProfileRail.css` | Unread badge and profile problem text; a second red next to `--danger` |
| `#0a84ff` | `TreePane.css` | Drop target fill and drag line; a second blue next to `--accent` |
| `#ff6b00` | `browser.css` | Acting outline, banner and approval bar tint |
| `rgba(255, 193, 7, 0.18)` | `trustBanner.css` | Trust banner, through an undefined `--bg-alt` variable |
| `#d90`, `#d33`, `#b90`, `#d60` | `agents.css` | Waiting mark and heat markers; not theme aware |
| `#1e1e1e` | `InboxPane.css` | Peek terminal background, fixed dark in a light window |
| `#1e1e1e`, `#e5e5e7`, `#ffffff`, `#1d1d1f`, `#b4d5fe` | `TerminalPane.tsx` | The two xterm themes, set in code and switched by a media query listener |
| `rgb(0 0 0 / 25%)`, `/ 28%`, `/ 35%` | `TreePane.css`, `dialogs.css` | Menu shadow, backdrop, dialog shadow, the same in light and dark |

Fonts: one family declaration on `:root`, `-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif`, at 13 px. Monospace is `Menlo, Monaco, 'Courier New', monospace` in the inbox raw block and in the xterm options (13 px). Form controls take the browser default font unless a scoped rule sets `font: inherit`; the screenshots show the dialogs' native controls in a larger system font than the surrounding labels.

Font sizes in the stylesheets, most used first: 12 px and 11 px (most rules), then 10 px, then 14, 13 and 15 px in a few rules each. Radii in use: 4, 5, 6, 8, 10 px and 50 percent. Row heights: 22 px (agents), 24 px (tree), 26 px line height (dock tab text), 35 px (dock strip, a dockview default). Spacing values are ad hoc (2, 3, 4, 6, 8, 10, 12, 14, 16 px) with no scale.

### 1.4 Inconsistent patterns

- Selected rows have three recipes: the tree and agent rows use a 16 percent accent fill with a 3 px inset accent bar; the history table row uses a 10 percent `--fg` fill; the segmented control uses a solid accent fill.
- Focus has two looks: an amber 2 px outline (`--focus`) on controls and rows, and the native ring on elements the rule does not list (checkboxes, radios, `summary`).
- The selection accent is blue, the focus ring is amber, the drop target is a second blue and the acting outline is orange; the roles of these hues are not stated anywhere.
- Status is expressed as text colour, a text glyph, an outlined chip and a heat marker, each with its own vocabulary and colours.
- Buttons come in several forms: native, `.btn-primary`, `.chrome-button` and `.inbox-link`. A "Cancel" is a native bevel button next to a flat blue "Start".
- Icons are Unicode characters and text (`▾`, `←`, `→`, `⟳`, `...`, `×`). The eye icon is the only drawn icon and it comes from `ObservationIndicator`.
- Two menus (`.context-menu`, `.browser-menu`) and two card-like overlays (`.profile-form`, `.setup-pane`) repeat the same border, radius and shadow with different values.
- Dark mode is a media query in the stylesheet; the layout host (for dockview) and the terminal each add their own listener, so the appearance is decided in three places.

### 1.5 Hand-made menus, dialogs and popovers

| Overlay | Component | Focus handling | Closing | Stacking |
|---|---|---|---|---|
| Dialogs (new session, new task, settings) | `dialogs/DialogHost.tsx`, `DialogFrame.tsx` | Focus moves to `data-autofocus` or the first focusable on open; a Tab handler wraps at the ends; focus returns to the opener on unmount. The `FOCUSABLE` selector list is hand maintained. No `aria-modal`; the content behind stays reachable by a screen reader. No inert background | Escape clicks the element marked `data-dialog-cancel`; the backdrop has `aria-hidden` and no click handler | Fixed, backdrop `z-index: 29`, box `z-index: 30`; native views are hidden behind stills through `useViewSuspension` |
| Tree context menu | `panes/ContextMenu.tsx` | Focus does not move into the menu; items are buttons in tab order; no arrow, Home, End or type-ahead keys; no focus return | Window `mousedown`, `keydown` for Escape and window `blur` | Fixed, `z-index: 10`, below the dialog layer; position clamped to the window by `clampToWindow` |
| Browser tab menu | `panes/BrowserPane.tsx` | No focus move, no keyboard handling in the menu | Item click; the toggle button; no Escape and no outside click handler found in `BrowserPane.tsx` | Absolute inside `.browser-chrome`, which has `z-index: 12` and so forms a stacking context; menu `z-index: 20` counts only inside it |
| Observation popover | `panes/browser/ObservationControl.tsx` | `role="dialog"` with no focus move and no trap | The toggle button only | Absolute, `z-index: 20`, same stacking context as the tab menu; holds the native view still through `useViewSuspension` |
| New profile form | `panes/NewProfileForm.tsx` in the rail | `autoFocus` on the name field | Form buttons | Fixed at `left: 72px; top: 56px`, `z-index: 10` |
| Setup card | `panes/SetupPane.tsx` | None | "Later" button | Fixed bottom right, `z-index: 20`; it covers the pane content and has no backdrop |
| Disclosures | native `<details>` in layout notice, task dialog, settings, inbox raw block, approval bar | Native | Native | In flow |
| Tooltips | native `title` | OS | OS | OS |

Findings from this table: the dialog is the only overlay with a trap and a focus return; most overlays have no keyboard model; the z-index values (2, 10, 12, 20, 29, 30 and 100 for the capture mask) are literals spread over several files; the stacking context of `.browser-chrome` is implicit. `useViewSuspension` (`panes/browser/suspension.ts`) hides native browser views behind stills while any dialog, menu or popover holds them. Any replacement overlay (Radix portals included) must call the same hook, because native `WebContentsView` children draw above the DOM.

### 1.6 What looks wrong, in design terms

Read from `03-layout-pair.png`, `04-new-task-dialog-jira.png`, `05-settings-top.png`, `06-browser-observation-popover-over-view.page.png`, `07-agents-running-waiting-failed.png`, `09-inbox-list.png`, `10-profiles-work-window-badge-and-setup.png`, `12-appearance-dark-session.png` and the committed overview.

Hierarchy
- Nothing is the focal point. Pane titles, tab labels, row titles and group labels share one weight and one size, so the eye has no entry. Bold appears only for the profile strip, dialog headings and unread inbox rows.
- The window stacks three rows of chrome above the content: the profile strip, the "Layout" bar and the dock tab strip, about 90 px at 1x before any content. The layout select is the only control in its bar and it floats left of an empty row.
- The grey strip for a temporary profile is the loudest element on the screen and it carries the least useful text.
- Dialogs open with the first field already carrying a thick amber focus box, which makes the focus ring the dominant visual on the dialog (04 and 05).

Spacing and density
- Spacing has no rhythm: 8 px gaps, 6 px gaps and 12 px blocks alternate within one dialog. Label, field and helper text blocks run together in the new session dialog and the settings panel; fields are the same width as the text above them with no group spacing.
- Tree rows are loose (24 px) while the information on the right is dense and small (11 px), so the type label, rate and heat marker crowd against the truncated title. The overview shows titles cut to "Fix upload ret..." while "Claude session" stays whole.
- The inbox list rows pack kind, path, time and title into 2 lines with 11 px grey text above 13 px bold text; there is no separation between metadata and message other than size.
- Large empty areas (the terminal below three lines, the inbox detail column, the surface host placeholder) have no resting state, so the app reads as unfinished.

Type
- A single 13 px system font with weight changes only; no type scale, no heading size steps, no monospace for paths and ids except the inbox raw block.
- The dock tab font is 13 px regular grey on grey; active and inactive tabs differ by a few percent of lightness only.
- Muted text uses `#86868b` on `#f5f5f7`, a contrast of 3.33 to 1, under the 4.5 to 1 needed for body size (table in 1.7).
- Native controls use a different font size and weight than the labels around them.

Colour
- The palette is two greys with a blue. The selected row, the selected tab, the Open filter and the primary button use the same blue at different intensities, so selection and action look alike.
- Amber is used for focus, for "waiting", for "Needs answer", for the trust banner and the isolation warning, and the same amber appears as a ring on a row the user has not asked for.
- Red appears as badge red, danger red and heat-marker red, from separate values.
- The dark theme is a flat grey (`#1e1e1e`, `#252526`); the surfaces differ by about 3 percent and the borders by 1.35 to 1, so panes do not separate. The terminal in the inbox peek is dark in a light window.
- Borders are 1 px at about 1.4 to 1 contrast against the pane they divide, a sound choice for dividers, but there is no other separation (no elevation, no tint steps), so every divider looks like a ruled form.

Iconography
- Almost no icons. Tree rows have no leading icon for folder, session or browser tab, so the row kind is read from a grey text label. Folder twisties are 12 px triangle glyphs.
- The browser bar uses arrow glyphs that sit on different baselines, a text ellipsis for the menu and the words "Open in Chrome" as an unstyled button.
- Status marks in the agents list are text glyphs (filled circle, half circle, cross) with colour as the only distinction between them.
- The profile rail uses a letter in a coloured square. It is a good pattern; the selected state is a thick dark outline that reads as a focus ring.

Components and finish
- Native controls (select, checkbox, radio, bevel button, scrollbar, `<details>` marker) sit next to custom flat ones. The mix is the single largest cause of the unpolished look.
- No elevation system: dialog, menu and popover use different shadows and none is adjusted for dark mode.
- No motion: nothing eases in or out; dialogs and popovers appear at once. Reduced-motion is therefore met by default and also cannot be tested.
- The window title bar is the default macOS bar with the profile strip beneath it, so the title text, strip and layout bar form three separate rows (see 2.5 for the inset title bar).

### 1.7 Contrast of current and candidate pairs

Computed with the WCAG 2 relative luminance formula in a standalone script; alpha colours were not composited except where stated.

| Pair (foreground on background) | Ratio |
|---|---|
| App light: `--fg` on `--pane-bg` | 15.46 |
| App light: `--muted` on `--pane-bg` | 3.33 |
| App light: `--muted` on `--bg` | 3.62 |
| App light: white on `--accent` (primary button, segmented fill) | 5.52 |
| App light: `--warn` on `--pane-bg` | 4.68 |
| App light: `--danger` on `--pane-bg` | 5.40 |
| App light: white on profile strip fill `--muted` | 3.62 |
| App light: white on badge `#d92d20` | 4.83 |
| App light: border `#d2d2d7` on `--pane-bg` | 1.38 |
| App dark: `--muted` on `--pane-bg` | 5.89 |
| App dark: white on `--accent` `#4da3ff` | 2.63 |
| App dark: border `#3a3a3c` on `--pane-bg` | 1.35 |
| GitHub Dark Default: `foreground` on `editor.background` | 16.02 |
| GitHub Dark Default: `tab.inactiveForeground` on `tab.inactiveBackground` | 5.51 |
| GitHub Dark Default: `descriptionForeground` on `editor.background` | 5.07 |
| GitHub Dark Default: white on `button.background` | 4.63 |
| GitHub Dark Default: white on `badge.background` | 4.63 |
| Catppuccin Mocha: `foreground` on `editor.background` | 11.34 |
| Catppuccin Mocha: `tab.inactiveForeground` on `tab.inactiveBackground` | 3.59 |
| Catppuccin Mocha: `button.foreground` on `button.background` | 9.23 |
| Catppuccin Mocha: `focusBorder` on `editor.background` | 8.07 |

Consequences for the token check in 0032: the current muted text and the dark primary button fail 4.5 to 1; one candidate theme (Catppuccin Mocha) fails it on inactive tabs in the theme's own colours, so an imported theme needs a per-pair adjustment or a warning, not a blind trust of its values.

## 2. Platform facts

All Electron facts were read from the docs of the `main` branch and checked against the `v45.3.3` tag for the pages marked "same at v45.3.3" (the heading lists of the nativeTheme and systemPreferences pages are identical, and `prefersReducedTransparency` is present at the tag).

### 2.1 nativeTheme

Source: https://www.electronjs.org/docs/latest/api/native-theme (file `docs/api/native-theme.md`, same at v45.3.3) and https://www.electronjs.org/docs/latest/tutorial/dark-mode.

| Item | Verified behaviour |
|---|---|
| `nativeTheme.themeSource` | `'system'`, `'light'` or `'dark'`; default `'system'`. Setting `system` removes the override. Setting `dark` or `light` changes `shouldUseDarkColors`, the `prefers-color-scheme` match, the UI macOS renders (menus, window frames) and emits `updated` |
| `shouldUseDarkColors` | Read only boolean: whether the OS or Chromium has dark mode on or is told to show dark UI. The docs say an app with its own dark mode should use it to choose its CSS |
| `updated` event | Emitted when something in the native theme changed, normally one of `shouldUseDarkColors`, `shouldUseHighContrastColors` or `shouldUseInvertedColorScheme`; the handler must read them to see which |
| `shouldUseHighContrastColors` | macOS and Windows, read only. True when the OS has high contrast on or tells the UI to be high contrast |
| `shouldUseInvertedColorScheme` | macOS and Windows, read only. True when the OS has an inverted scheme |
| `prefersReducedTransparency` | Present, read only, all platforms listed without a platform tag: the user chose reduced transparency in OS accessibility settings |
| `shouldDifferentiateWithoutColor` | macOS, read only: the user prefers differentiation other than colour; maps to `NSWorkspace.accessibilityDisplayShouldDifferentiateWithoutColor`. Relevant to the status vocabulary in 1.4 |
| `inForcedColorsMode` | Windows only. The docs state that Windows high contrast is the only system setting that triggers forced colours mode |
| `shouldUseDarkColorsForSystemIntegratedUI` | macOS and Windows; on macOS equal to `shouldUseDarkColors` |

Consequence: with `themeSource = 'system'` the renderer can keep reading `prefers-color-scheme` and the main process can read the three booleans on `updated`. Forced colours never applies on macOS by the Electron docs; `shouldUseHighContrastColors` is the macOS signal for increased contrast.

### 2.2 Accent colour and system colours

Source: https://www.electronjs.org/docs/latest/api/system-preferences (same headings at v45.3.3).

| Item | Verified behaviour |
|---|---|
| `systemPreferences.getAccentColor()` | Returns the user's system wide accent colour as an RGBA hexadecimal string without a leading `#` (`"aabbccdd"`). The method has no platform tag; the docs state it is available on macOS 10.14 or newer |
| `accent-color-changed` event | Tagged Windows and Linux only. It does not fire on macOS. |
| macOS accent change signal | The docs list `AppleColorPreferencesChangedNotification` (and `AppleAquaColorVariantChanged`, `AppleInterfaceThemeChangedNotification`) as example events of `systemPreferences.subscribeNotification`, which subscribes to `NSDistributedNotificationCenter` on macOS. This is the documented way to learn about an accent change on macOS; whether the notification fires for both the accent and the highlight colour was not tested |
| `getColor(color)` | Windows and macOS. The macOS names include `selected-content-background`, `selected-text-background`, `keyboard-focus-indicator`, `separator`, `window-background`, `control-background`, `label`, `secondary-label`, `tertiary-label`, `quaternary-label`, `link`, `placeholder-text`, `under-page-background`, `text-background`, `header-text`, `highlight`, `shadow` and others; returns `#RRGGBBAA`. Several names are macOS 10.14 and newer only |
| `getSystemColor(color)` | macOS. Colours that adapt to vibrancy and to Increase contrast and Reduce transparency |
| `getEffectiveAppearance()` | macOS; returns the appearance applied to the app |
| `accessibilityDisplayShouldReduceTransparency` | macOS, deprecated; use `nativeTheme.prefersReducedTransparency` |

### 2.3 CSS features in Chromium 156

Sources: MDN pages (https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme, https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme, https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast, https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion, https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency, https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors, https://developer.mozilla.org/en-US/docs/Web/CSS/system-color) and `@mdn/browser-compat-data` 8.1.10 (CC0 data, read from the npm tarball) for the Chrome versions. Electron 45.3.3 ships Chrome 156, newer than every version in the table.

| Feature | Chrome since | Notes that matter here |
|---|---|---|
| `color-scheme` property | 81 | Makes canvas, scrollbars and default form control colours, and the used values of system colours, follow the scheme. `:root { color-scheme: light dark }` is already set. Authors still need `prefers-color-scheme` for the rest of the elements |
| `prefers-color-scheme` | 76 | Follows `nativeTheme.themeSource` as Electron states |
| `prefers-contrast` | 96 | Values `more`, `less`, `custom`, `no-preference` per MDN. The MDN page does not name the macOS setting; Electron's `shouldUseHighContrastColors` is the documented macOS flag. That Chromium maps macOS Increase contrast to `prefers-contrast: more` was not verified here and needs a probe |
| `prefers-reduced-motion` | 74 | MDN lists macOS Accessibility, Display (Motion on newer releases), Reduce motion as the source |
| `prefers-reduced-transparency` | 118 | Flagged experimental on MDN. MDN names macOS System Settings, Accessibility, Display, Reduce transparency. Electron has the matching `nativeTheme.prefersReducedTransparency`, which is the safer source |
| `forced-colors` | 89 | Active only when the OS enforces a limited palette; Electron says only Windows high contrast does so. Not active on macOS |
| `AccentColor`, `AccentColorText` system colours | 149 | The compat data note: a fixed value (blue and white) unless used in installed web apps on a user's initial profile (crbug 40229450). The same fixed value applies to `accent-color: auto` from 149. In Electron 45 the CSS `AccentColor` therefore does not carry the macOS accent. The accent must come from `systemPreferences.getAccentColor()` through IPC. This corrects the sentence in 0032 that lists `AccentColor` as a source |
| `light-dark()` colour function | 123 | Usable for single-token pairs when `color-scheme` is set |
| `color-mix()` | 111 | Already used in the stylesheets |
| `font-family: system-ui` | 56 | Resolves to the OS UI font (SF on macOS) |
| `font-family: ui-monospace` | not supported (crbug 40194142), Safari 13.1 | The generic does not work in Chromium and so not in Electron. `ui-sans-serif`, `ui-serif` and `ui-rounded` are also unsupported |

Font stacks that follow from this: UI text `system-ui, -apple-system, 'Helvetica Neue', sans-serif` (the `-apple-system` name is Safari's alias and harmless; `system-ui` is the Chromium route). Monospace: `ui-monospace` is dropped, so the stack is `SF Mono, Menlo, Monaco, monospace`, set explicitly; SF Mono is installed only with developer tools, Menlo is on every macOS. Whether `system-ui` picks SF Pro Text or Display by size (optical sizes) in Chromium was not verified.

### 2.4 Window options: title bar

Sources: https://www.electronjs.org/docs/latest/api/structures/base-window-options (`titleBarStyle`, `trafficLightPosition`, `vibrancy`, `visualEffectState`, `transparent`) and https://www.electronjs.org/docs/latest/tutorial/custom-title-bar.

| Option | Verified behaviour |
|---|---|
| `titleBarStyle: 'hiddenInset'` | macOS. Hidden title bar with a full size content window and traffic lights slightly more inset from the window edge. The tutorial states it shifts the vertical inset of the traffic lights |
| `titleBarStyle: 'hidden'` | Hidden bar, traffic lights remain on macOS |
| `trafficLightPosition` | macOS, a point; sets a custom position for the traffic lights in frameless windows. The tutorial gives `{ x: 10, y: 10 }` as an example |
| Draggable region | A custom title bar needs the CSS `app-region: drag` on a region (the tutorial text; the compat data has no entry for the property) |
| `titleBarOverlay` | Enables Window Controls Overlay APIs and CSS environment variables for a custom bar; colour fields are Windows and Linux only |

Current state: `app/src/main/window.ts` creates the window with no `titleBarStyle`, `vibrancy` or `trafficLightPosition`; no use of `nativeTheme` or `getAccentColor` in `app/src/main` was found.

For the app, `hiddenInset` removes the native title bar row; the profile strip can then sit in the top 28 to 38 px beside the traffic lights, and the top row of the layout can be the drag region. The strip and the layout bar of 1.6 collapse into one row. The window title (the profile name, set in `createMainWindow`) is no longer drawn, so the profile name must appear in the web content.

### 2.5 Vibrancy, transparency and native views

Sources: base-window-options and the `BrowserWindow` page (https://www.electronjs.org/docs/latest/api/browser-window, `win.setVibrancy`), https://www.electronjs.org/docs/latest/api/web-contents-view, https://www.electronjs.org/docs/latest/api/view, https://www.electronjs.org/docs/latest/tutorial/custom-window-styles.

| Fact | Source statement |
|---|---|
| `vibrancy` values | `appearance-based`, `titlebar`, `selection`, `menu`, `popover`, `sidebar`, `header`, `sheet`, `window`, `hud`, `fullscreen-ui`, `tooltip`, `content`, `under-window`, `under-page` (macOS). The `win.setVibrancy` entry lists the same values without `appearance-based` |
| `visualEffectState` | macOS, must be used with `vibrancy`: `followWindow` (default), `active`, `inactive` |
| `win.setVibrancy(type, { animationDuration })` | Adds or removes vibrancy at runtime; `null` or an empty string removes it. The animation only fades in or out; animating between types is unsupported. So vibrancy can follow a settings toggle without a restart |
| `transparent: true` | Documented for windows: when a `View` is added to a `BaseWindow` the view's background must also be made transparent with `view.setBackgroundColor` and a transparent colour. The window styles page says transparent windows are not resizable on some platforms, show no native window shadow and are not transparent while DevTools is open; the `BrowserWindow` page says transparent windows can leave visual artifacts on macOS |
| `WebContentsView` | A `View` that shows a `WebContents`, added with `contentView.addChildView`; positioned with `setBounds` |
| Vibrancy with child views | Not documented. The docs say nothing about how a vibrancy window composes with `WebContentsView` children or with the renderer's opaque body. The browser tab views are opaque pages by construction; the renderer page must have a transparent body and transparent dockview regions for vibrancy to show. How dockview's drop overlays and the stills of `useViewSuspension` interact with a translucent window is not verified and needs a probe |

Practical reading for 0032: vibrancy is feasible for the sidebar region only if the renderer paints that region with a transparent background and the main process calls `setVibrancy('sidebar')` on the window. Native browser views and stills stay opaque; they sit in the content area, away from the sidebar. Reduced transparency (`nativeTheme.prefersReducedTransparency`) must switch the effect off. A probe is needed for window focus changes (`visualEffectState`), the live toggle and a drag of a dock tab across the translucent region.

## 3. Libraries and licenses

Package metadata from the npm registry (`https://registry.npmjs.org/<package>/latest`) and license files from the repositories. Versions are the latest at the time of the run.

### 3.1 Radix primitives

Repository https://github.com/radix-ui/primitives, `LICENSE`: MIT, copyright 2022 WorkOS. Every package below is MIT, has `sideEffects: false`, and declares peer dependencies on `react`, `react-dom` and the type packages with React 19 in the accepted range.

| Need | Package | Version |
|---|---|---|
| Dialog (new session, new task, settings; modal, focus trap, inert background, Escape, focus return) | `@radix-ui/react-dialog` | 1.3.1 |
| Dropdown menu (tab menu, "..." menu) | `@radix-ui/react-dropdown-menu` | 2.2.1 |
| Context menu (tree rows) | `@radix-ui/react-context-menu` | 2.4.1 |
| Popover (observation control, profile form) | `@radix-ui/react-popover` | 1.3.1 |
| Tooltip | `@radix-ui/react-tooltip` | 1.4.1 |
| Tabs (inbox filter as a tablist; not for the dock) | `@radix-ui/react-tabs` | 1.2.1 |
| Select (replaces native selects) | `@radix-ui/react-select` | 2.4.1 |
| Toggle group (segmented control, observation mode) | `@radix-ui/react-toggle-group` | 1.2.1 |
| Switch (setting toggles) | `@radix-ui/react-switch` | 1.4.1 |
| Umbrella | `radix-ui` | 1.8.1 |

The umbrella `radix-ui` package re-exports the primitives from one dependency. Radix primitives ship unstyled and offer a Portal part that renders outside the component tree. For native views each of Dialog, DropdownMenu, ContextMenu and Popover needs an open state that calls `useViewSuspension` (see 1.5). Radix menus and dialogs manage focus, arrow-key navigation, type-ahead, outside click and Escape; those behaviours are described in the Radix docs (https://www.radix-ui.com/primitives/docs/overview/introduction) and were not re-tested here.

### 3.2 Lucide icons

Repository https://github.com/lucide-icons/lucide, `LICENSE`: ISC, copyright 2026 Lucide Icons and Contributors. The file lists a set of icons derived from Feather that are additionally under the MIT license (copyright Cole Bemis); the notice must travel with the package for those icons. Package `lucide-react` 1.77.0 (ISC), peer `react` up to 19, `sideEffects: false`, no runtime dependencies. The published tarball is about 40 MB unpacked because it holds one module per icon; the package declares `sideEffects: false`, so with named imports a bundler can drop the icons that are not used (not measured here). Icons are SVG components; the package documentation describes colour and stroke width as props (not re-read here), which would let them follow text tokens.

### 3.3 Codicons

Repository https://github.com/microsoft/vscode-codicons. Package `@vscode/codicons` 0.0.46-24, license field `CC-BY-4.0`. The repository `README` states the documentation and other content (which includes the icon font and SVGs) are licensed under Creative Commons Attribution 4.0 (`LICENSE`) and the code under MIT (`LICENSE-CODE`, copyright Microsoft Corporation). It adds that the licenses grant no right to use Microsoft names, logos or trademarks. CC BY 4.0 requires attribution (credit, license link, indication of changes) for the icons, so the app's NOTICE needs an entry; the Lucide and Radix licenses need only the copyright notice. The package is an icon font and SVG set; `@vscode-elements/elements` takes it as a peer dependency for its icon element.

Choice: Lucide has the simplest terms (ISC, no attribution banner), a React package that tree shakes, and a style (outline, 24 px grid) that matches a neutral look. Codicons match the VS Code look and are the better pick only if the app adopts `@vscode-elements/elements` or wants VS Code parity; they carry the attribution duty.

### 3.4 @vscode-elements/elements

Repository https://github.com/vscode-elements/elements, `LICENSE`: MIT, copyright 2026 Adam Bender. Package `@vscode-elements/elements` 2.5.1 (MIT, about 2 MB unpacked, built on Lit), peer dependency `@vscode/codicons`. React wrapper `@vscode-elements/react-elements` 2.4.0, license field ISC (the repository `LICENSE` raw file was not found at the `main` path; the license comes from the package metadata only), peers `react` 17, 18 or 19, depends on `@lit/react` and on `@vscode-elements/elements` ^2.4.0.

Components in the 2.5.1 tarball: badge, button, button-group, checkbox, checkbox-group, collapsible, context-menu and item, divider, form-container, form-group, form-helper, icon, label, multi-select, option, progress-bar, progress-ring, radio, radio-group, scrollable, single-select, split-layout, tab-header, tab-panel, table (with body, cell, header, header-cell, row), tabs, textarea, textfield, toolbar-button, toolbar-container, tree, tree-item.

How it takes colours: each component's styles read `--vscode-*` custom properties with a literal fallback, for example `background-color: var(--vscode-button-background, #0078d4)`, `color: var(--vscode-button-foreground, #ffffff)`, `var(--vscode-focusBorder, #0078d4)`, `var(--vscode-foreground, #cccccc)`, `var(--vscode-list-activeSelectionBackground, #04395e)`, with font from `--vscode-font-family` and `--vscode-font-size`. The custom properties pierce the shadow DOM because custom properties inherit.

Does it render without VS Code: yes. The fallbacks give a working look, and the default font stack comes from the user agent string (`-apple-system, BlinkMacSystemFont, sans-serif` on a Mac). The fallbacks are one dark palette; there is no `prefers-color-scheme` handling in the sources, so a light appearance needs every `--vscode-*` variable the used components read to be defined. The `--vscode-*` alias layer of 0032 would define them from the tokens. Not tested: pixel output in Electron 45 and the focus behaviour of the form controls inside dialogs next to Radix focus management; both are open questions for the first slice.

### 3.5 dockview 8.9.0 theming

Package `dockview-react` 8.9.0, license MIT (`LICENCE.md`, copyright 2021 mathuo). Stylesheet `app/node_modules/dockview-react/dist/styles/dockview.css`.

- A theme is a class on the dock root that sets CSS custom properties. The bundled classes are `dockview-theme-dark`, `-light`, `-vs`, `-abyss`, `-dracula`, `-nord`, `-nord-spaced`, `-catppuccin-mocha`, `-catppuccin-mocha-spaced`, `-monokai`, `-solarized-light`, `-solarized-light-spaced`, `-github-dark`, `-github-dark-spaced` and `-github-light`.
- The theme object that the React component takes has these fields (from `dockview-core` 8.9.0 `dist/cjs/dockview/theme.d.ts`): `name`, `className`, `colorScheme`, `gap`, `edgeGroupCollapsedSize`, `dndOverlayMounting`, `dndPanelOverlay`, `dndTabIndicator`, `dndOverlayBorder`, `tabGroupIndicator` and a tab animation option. It is passed as the `theme` prop of `DockviewReact`, which the app already does with `themeDark` and `themeLight`.
- A custom theme is therefore: define `.agide-dock { ... }` with the variables below, then pass `{ name: 'agide', className: 'agide-dock', colorScheme: 'dark' }`. The stock `dockview-theme-dark` block is the template: one block of structural variables (sizes, radii, margins, sash colours) and a second block of colours.
- Colour variables a theme sets: `--dv-group-view-background-color`, `--dv-tabs-and-actions-container-background-color`, `--dv-activegroup-visiblepanel-tab-background-color`, `--dv-activegroup-hiddenpanel-tab-background-color`, `--dv-inactivegroup-visiblepanel-tab-background-color`, `--dv-inactivegroup-hiddenpanel-tab-background-color`, `--dv-tab-divider-color`, `--dv-activegroup-visiblepanel-tab-color`, `--dv-activegroup-hiddenpanel-tab-color`, `--dv-inactivegroup-visiblepanel-tab-color`, `--dv-inactivegroup-hiddenpanel-tab-color`, `--dv-separator-border`, `--dv-paneview-header-border-color`, `--dv-paneview-active-outline-color`, `--dv-drag-over-background-color`, `--dv-drag-over-border-color`, `--dv-edge-dock-indicator-color`, `--dv-icon-hover-background-color`, `--dv-sash-color`, `--dv-active-sash-color`, `--dv-scrollbar-background-color`, `--dv-tabs-container-scrollbar-color`, `--dv-context-menu-background-color`, `--dv-context-menu-color`, `--dv-floating-box-shadow`, `--dv-floating-border`.
- Structural variables: `--dv-tabs-and-actions-container-height` (35 px default), `--dv-tabs-and-actions-container-font-size`, `--dv-tab-font-size`, `--dv-tab-margin`, `--dv-tab-border-radius`, `--dv-border-radius`, `--dv-sash-border-radius`, `--dv-dropdown-border-radius`, `--dv-spacing-padding`, `--dv-transition-duration`, `--dv-overlay-z-index` (999), `--dv-floating-titlebar-height`, tab group colour and chip variables.
- Splitters: the stylesheet makes each sash 4 px wide and fills the whole sash with `--dv-sash-color` (transparent in the stock themes) and, on hover or drag after `--dv-active-sash-transition-delay` (default 0.5 s), with `--dv-active-sash-color`. The 1 px line between views is drawn from `--dv-separator-border`.
- Each variable can be set to a `var(--agide-...)` reference, so one token layer feeds the dock without a second palette. The `-spaced` variants exist for several themes; their exact effect was not rendered here.
- Panels draw inside the group view; dockview's `dv-` classes can be overridden for tab details (close buttons, header actions) with ordinary CSS.

### 3.6 xterm.js theme

Package `@xterm/xterm` 6.0.0, MIT. `ITheme` fields in `typings/xterm.d.ts`: `foreground`, `background`, `cursor`, `cursorAccent`, `selectionBackground`, `selectionForeground`, `selectionInactiveBackground`, `scrollbarSliderBackground`, `scrollbarSliderHoverBackground`, `scrollbarSliderActiveBackground`, `overviewRulerBorder`, and the sixteen colours `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white` and their `bright` variants. Setting `term.options.theme` at runtime restyles the terminal, which the app already does for the light and dark switch. The option `minimumContrastRatio` exists in the terminal options and lets the terminal lift text colours that fall under a ratio, a cheap guard for imported themes. The mapping from VS Code is direct (section 4.3). The current theme in `TerminalPane.tsx` sets only foreground, background, cursor and (light only) selection, so the sixteen ANSI colours are xterm's defaults in both modes.

## 4. VS Code theme data

### 4.1 Structure

Sources: https://code.visualstudio.com/api/extension-guides/color-theme (file `api/extension-guides/color-theme.md` in the vscode-docs repository), https://code.visualstudio.com/api/references/theme-color, https://code.visualstudio.com/api/references/contribution-points#contributes.themes, https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide, and the theme files themselves.

A colour theme file is JSON:

| Key | Content |
|---|---|
| `name` | Display name (present in the two candidates) |
| `type` | The guide's example shows `"type": "dark"`; Catppuccin Mocha sets it, GitHub Dark Default has none and its base comes from `uiTheme` in `package.json` |
| `colors` | Map of workbench colour id to a hex colour: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`; no alpha means opaque and `00` alpha means transparent (theme-color reference, "Color formats") |
| `tokenColors` | An array of TextMate rules (`scope`, `settings.foreground`, `fontStyle`), or a path string to a `.tmTheme` file as in the guide's example |
| `semanticHighlighting`, `semanticTokenColors` | Whether semantic highlighting is on and its token style rules |
| `include` | Not documented in the pages read here; some themes use it to extend another theme file. Not verified; importer should reject or resolve relative includes explicitly |

Real values from the candidates: GitHub Dark Default has colour keys and token rules and no semantic map; GitHub Dark (the older theme) has fewer colour keys; Catppuccin Mocha has more than twice the colour keys of GitHub Dark Default, plus token rules and semantic rules, and carries `type: "dark"`. Neither theme lists every key. Missing keys take defaults that VS Code derives per base theme (for example `terminal.background` is absent from both candidates, `menu.background` is absent from GitHub Dark Default, `list.focusOutline` is absent from GitHub Dark Default). An importer needs its own fallback chain per token (for example `terminal.background` to `panel.background` to `editor.background`; the defaults VS Code applies were not read, so the chain is a choice to verify by rendering), and must handle alpha colours (`#6e768166`, `#00000000`) by compositing over the surface they sit on.

### 4.2 Keys that map to an application UI

Key groups in the theme-color reference (section names): Base colors, Text colors, Action colors, Button control, Dropdown control, Input control, Scrollbar control, Badge, Progress bar, Lists and trees, Activity Bar, Side Bar, Editor Groups & Tabs, Editor colors, Editor widget colors, Panel colors, Status Bar colors, Title Bar colors, Menu Bar colors, Notification colors, Banner colors, Quick picker colors, Integrated Terminal colors, Settings Editor colors, Chart colors. Proposed mapping to Agide tokens:

| Agide token | VS Code keys, in order of preference |
|---|---|
| `surface.base` (terminal and content) | `editor.background` |
| `surface.sidebar` | `sideBar.background`, then `editor.background` |
| `surface.chrome` (layout bar, tab strip, profile rail) | `editorGroupHeader.tabsBackground`, `activityBar.background`, `titleBar.activeBackground` |
| `surface.raised` (dialog, menu, popover) | `editorWidget.background`, `menu.background`, `dropdown.background`, `notifications.background` |
| `text.primary` | `foreground`, `editor.foreground` |
| `text.secondary` | `descriptionForeground`, `tab.inactiveForeground`, `sideBar.foreground` |
| `border.default` | `sideBar.border`, `panel.border`, `tab.border`, `contrastBorder` |
| `focus.ring` | `focusBorder` |
| `accent` and primary button | `button.background`, `button.foreground`, `button.hoverBackground`; `activityBarBadge.background` |
| `button.secondary` | `button.secondaryBackground`, `button.secondaryForeground` |
| `input` | `input.background`, `input.foreground`, `input.border`, `input.placeholderForeground` |
| `badge` | `badge.background`, `badge.foreground` |
| `selection.list` | `list.activeSelectionBackground`, `list.activeSelectionForeground`, `list.inactiveSelectionBackground`, `list.hoverBackground`, `list.focusOutline` |
| `tab.active`, `tab.inactive` | `tab.activeBackground`, `tab.activeForeground`, `tab.inactiveBackground`, `tab.inactiveForeground`, `tab.activeBorderTop` |
| `link` | `textLink.foreground`, `textLink.activeForeground` |
| `status.danger`, `.warning`, `.ok` | `errorForeground`, `editorError.foreground`, `editorWarning.foreground`, `gitDecoration.addedResourceForeground`, `charts.green`, `testing.iconPassed` |
| `shadow` | `widget.shadow` |
| `scrollbar` | `scrollbarSlider.background`, `scrollbarSlider.hoverBackground`, `scrollbarSlider.activeBackground` |
| `sash` | `sash.hoverBorder` |
| Terminal | `terminal.background`, `terminal.foreground`, `terminalCursor.foreground`, `terminal.selectionBackground`, `terminal.ansiBlack` through `terminal.ansiWhite` and the `ansiBright*` sixteen keys |

Mapping to the xterm `ITheme` (3.6): `terminal.background` to `background`; `terminal.foreground` to `foreground`; `terminalCursor.foreground` to `cursor`; `terminal.selectionBackground` to `selectionBackground`; `terminal.ansiBlack`, `ansiRed`, `ansiGreen`, `ansiYellow`, `ansiBlue`, `ansiMagenta`, `ansiCyan`, `ansiWhite` to the eight base colours; the `terminal.ansiBright*` keys to the `bright*` colours. GitHub Dark Default defines all sixteen; Catppuccin Mocha defines them too.

The same keys, dots replaced by dashes, give the `--vscode-*` alias names (VS Code's own convention, which `@vscode-elements/elements` reads, for example `--vscode-button-background`, `--vscode-focusBorder`).

### 4.3 How themes are published

A theme is an extension. Its `package.json` has `contributes.themes`, an array of `{ label, uiTheme, path }`; `uiTheme` is one of `vs`, `vs-dark`, `hc-black` or `hc-light`, and `path` points to the theme JSON (contribution-points reference, `contributes.themes`). GitHub's extension (name `github-vscode-theme`, version 6.3.5, MIT, publisher GitHub) declares these themes: Light Default, Light High Contrast, Light Colorblind (Beta), Dark Default, Dark High Contrast, Dark Colorblind (Beta), Dark Dimmed, Light and Dark. Catppuccin (`catppuccin-vsc` 3.19.0, MIT) declares Mocha, Macchiato, Frappe and Latte. A `.vsix` file is a zip: the theme JSON sits under `extension/themes/` and the manifest at `extension/package.json`. Both were downloaded from Open VSX and unpacked for this audit (the layout above is what was read).

Repository layout for the sources: https://github.com/primer/github-vscode-theme holds the generator (`src`) and a `package.json`; the repository root listing shows no `themes` directory, while the published extension has one, so the built JSON is in the extension. https://github.com/catppuccin/vscode is a monorepo with `packages/catppuccin-vsc`; its built JSON was read from the published extension too. An import path that reads the `.vsix` or the published JSON gets the built files.

### 4.4 Open VSX

Sources: https://open-vsx.org/v3/api-docs (OpenAPI document of the registry, read), https://www.eclipse.org/legal/open-vsx-registry-faq/, https://www.eclipse.org/legal/termsofuse.php (the Eclipse.org Terms of Use, linked as `termsOfService` in the OpenAPI document), https://newsroom.eclipse.org/node/43620 (release of 3 March 2026).

REST API (from the OpenAPI document; no authentication needed for the calls tried):

| Purpose | Call |
|---|---|
| Latest version metadata | `GET https://open-vsx.org/api/{namespace}/{extension}` or `/api/{namespace}/{extension}/{version}` |
| A single published file | `GET /api/{namespace}/{extension}/{version}/file/{path}` (also with `{targetPlatform}` before the version) |
| Fields the metadata returns | `namespace`, `name`, `version`, `license`, `verified`, `publishedBy`, `timestamp`, `downloadCount`, and a `files` map with `download` (the `.vsix`), `manifest` (`package.json`), `license`, `readme`, `changelog`, `sha256`, `signature` and `publicKey` |
| Examples read | `GitHub/github-vscode-theme` latest is 6.3.5, license MIT, namespace verified; its `publishedBy` is the registry's own `open-vsx` account, so the package is a copy published by Open VSX, not by GitHub. `Catppuccin/catppuccin-vsc` latest is 3.19.0, license MIT, verified |

The registry exposes a `license` field per extension and a license file per version, so the app can show the license before keeping a theme, as 0032 requires. The registry also exposes `manifest` for reading `contributes.themes` without downloading the whole package.

What the terms say, as far as they could be read:
- The OpenAPI document names the Eclipse.org Terms of Use as the terms of service and the Eclipse Public License 2.0 as the license of the registry software.
- The Eclipse.org Terms of Use cover content on Eclipse sites generally: no warranty, no licenses beyond those stated or an applicable license, trademarks reserved. The text read does not mention Open VSX, and says nothing about automated access beyond the right to block an address.
- The Eclipse Open VSX FAQ says there are "no fees associated with publishing or consuming content", that all extensions must be licensed (not necessarily with an open source license) and that they are available subject to their own licenses. It says the registry is "integrated into multiple software applications that support VS Code extensions" and names Gitpod and VSCodium next to Theia. It does not address use by other tools, automated access, redistribution or mirroring.
- The 3 March 2026 release states that the registry is "implementing responsible rate limiting and traffic management" targeted at "sustained, high-volume automated traffic". The `open-vsx.org/terms-of-use` page is a script rendered page that returned no text to a fetch, so its own wording was not read.

Reading: the rights to a theme come from the license in the theme's own extension; Open VSX adds no restriction on reading it that the sources show, and no explicit grant for use outside an editor. Whether the registry's terms allow an application other than an editor to fetch and reuse extension content is not clear from the sources. A safe design is to download on explicit user action only (one request per theme), show the license, keep the license file and notice with the stored theme, send no personal data and cache the result. A written question to the Eclipse Foundation (the FAQ lists a license contact) would settle it.

VS Code Marketplace: the Microsoft Visual Studio Marketplace Terms of Use (last updated June 2021, read from the PDF) state that Marketplace Offerings are intended for use only with the in-scope Microsoft products and services and may be installed and used only with them. This confirms 0032's exclusion of the Marketplace.

### 4.5 Candidate theme licenses

| Theme | Source | License file | Result |
|---|---|---|---|
| GitHub Dark (GitHub Dark Default and the others in the extension) | https://github.com/primer/github-vscode-theme | `LICENSE` | MIT, copyright 2020 Primer. Extension `package.json` also says MIT, publisher GitHub. The extension packages read from Open VSX contain the same MIT text in `LICENSE.txt` |
| Catppuccin Mocha | https://github.com/catppuccin/vscode | `LICENSE` | MIT, copyright 2021 Catppuccin. The palette repository https://github.com/catppuccin/catppuccin carries the same MIT text. The Open VSX package contains `LICENSE.txt` with the MIT text |

Both permit use, copying, modification and redistribution with the copyright and permission notice kept. Porting a theme to Agide's token JSON is a modification and the notice has to travel with the ported file (a `license` and `source` field in the theme JSON, and an entry in `NOTICE`). Brand terms: the GitHub trademark is not licensed by the MIT text, so the built-in label can say "GitHub Dark (port)" with the notice, and the Catppuccin name carries no stated restriction in the license file read. Neither repository's `README` was read for extra terms.

Of the GitHub themes, "GitHub Dark Default" is the newer of the two (`#0d1117` as the editor background); "GitHub Dark" is the older one with `#24292e`. 0032 says "GitHub Dark"; the port should name which, and the newer Default is the likelier match to what a user expects.

## 5. Notes for 0032 from this audit

- Remove `AccentColor` from the list of sources in 0032: in Chromium 156 it returns a fixed blue. Take the accent from `systemPreferences.getAccentColor()` and refresh it from `AppleColorPreferencesChangedNotification` through `subscribeNotification`; `accent-color-changed` does not fire on macOS.
- Replace `ui-monospace` in any font plan with an explicit stack; Chromium does not support it. `system-ui` works for UI text.
- `nativeTheme.prefersReducedTransparency` exists in Electron 45; use it for the vibrancy rule instead of the CSS media feature alone (which MDN marks experimental).
- Forced colours do not occur on macOS in Electron; the contrast preference is `shouldUseHighContrastColors` and, to be probed, `prefers-contrast: more`.
- The native view stills (`useViewSuspension`) are a requirement on every replacement overlay, whichever library supplies it.
- The two token checks that need a decision: the muted text and dark primary button of the current palette fail 4.5 to 1; imported themes can fail it too (Catppuccin Mocha inactive tabs, 3.59 to 1). The import should clamp or flag.
- The `@vscode-elements/elements` fallbacks are one dark palette; with a light System theme every read variable has to be defined by the alias layer.
- Open VSX reuse by a non-editor application is not covered by the terms read. Treat it as unclear and ask before shipping an in-app theme browser; shipping the two ported themes inside the app avoids the question for the built-ins because both are MIT.

## 6. Probes the facts above leave open

| Probe | Why |
|---|---|
| Vibrancy `sidebar` on the main window with a transparent renderer region, native browser view open, dock drag across it, window blur and focus | Not documented for `WebContentsView` children |
| `prefers-contrast` under macOS Increase contrast in Electron 45 | MDN does not name the macOS setting; Electron names `shouldUseHighContrastColors` |
| `AppleColorPreferencesChangedNotification` fires on an accent change and `getAccentColor()` then returns the new value | Documented as an example event, not as the accent signal |
| `system-ui` optical size behaviour at 11 to 15 px | Not stated in the sources |
| `@vscode-elements/elements` inside a Radix dialog with the alias layer, light and dark | Focus handling and light fallback |
| Reduce transparency on and off with `nativeTheme.prefersReducedTransparency` | Confirms the event path through `updated` |

## 7. Sources

Electron (docs at the `main` branch and the `v45.3.3` tag):
- https://www.electronjs.org/docs/latest/api/native-theme
- https://www.electronjs.org/docs/latest/api/system-preferences
- https://www.electronjs.org/docs/latest/api/structures/base-window-options
- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/view
- https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
- https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- https://www.electronjs.org/docs/latest/tutorial/dark-mode
- https://releases.electronjs.org/releases.json

Chromium and CSS:
- MDN pages linked in 2.3
- https://github.com/mdn/browser-compat-data (package `@mdn/browser-compat-data` 8.1.10, CC0-1.0)

Libraries:
- https://github.com/radix-ui/primitives (LICENSE), https://www.npmjs.com/package/radix-ui
- https://github.com/lucide-icons/lucide (LICENSE), https://www.npmjs.com/package/lucide-react
- https://github.com/microsoft/vscode-codicons (LICENSE, LICENSE-CODE, README), https://www.npmjs.com/package/@vscode/codicons
- https://github.com/vscode-elements/elements (LICENSE, package tarball), https://github.com/vscode-elements/react-elements (package metadata), https://vscode-elements.github.io
- https://github.com/mathuo/dockview (package `dockview-react` 8.9.0 as installed: stylesheet, `LICENCE.md`, `dockview-core` typings)
- https://github.com/xtermjs/xterm.js (package `@xterm/xterm` 6.0.0 typings)

VS Code theme data and registries:
- https://code.visualstudio.com/api/extension-guides/color-theme
- https://code.visualstudio.com/api/references/theme-color
- https://code.visualstudio.com/api/references/contribution-points
- https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide
- https://open-vsx.org/v3/api-docs, https://open-vsx.org/swagger-ui/index.html
- https://www.eclipse.org/legal/open-vsx-registry-faq/, https://www.eclipse.org/legal/termsofuse.php, https://newsroom.eclipse.org/node/43620
- https://cdn.vsassets.io/v/M190_20210811.1/_content/Microsoft-Visual-Studio-Marketplace-Terms-of-Use.pdf
- https://github.com/primer/github-vscode-theme (LICENSE, package.json), https://github.com/catppuccin/vscode (LICENSE), https://github.com/catppuccin/catppuccin (LICENSE)
