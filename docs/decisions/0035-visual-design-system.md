# 0035 Visual design system

Status: accepted by the user on 2026-11-21 with the agent's defaults (the direction of this brief; System follows the macOS accent while Agide Light and Dark keep the Agide blue; the title bar shows the profile tile and a 2 px border without a tint; the two ports GitHub Dark Default and Catppuccin Mocha)
Date: 2026-11-18
Decided by: spike agents, pending user confirmation
Inputs: 0032 (direction: tokens, themes as data, System default, VS Code import, Radix, one icon set, theme commands); `notes/visual-design-audit.md` (inventory, platform facts, licenses, VS Code theme data); 0031 and `notes/onscreen-check.md` (defects V-01 to V-22 and R-01 to R-30); 0020 (layout commands, revision history, parity); the screenshots of the latest full `pnpm visual-check` run and `docs/images/agide-overview.png`; `notes/scripts/token-contrast.mjs` (the contrast check written for this record)
Refines: 0032. Corrects 0032 on the accent source (the CSS `AccentColor` is a fixed blue in Chromium 156; see the audit, section 2.3)

## Context

The user finds the UI ugly. The screenshots and the audit show why, in design terms:

- Native controls (bevel buttons, selects, checkboxes, `<details>` markers, scrollbars) sit next to flat custom ones. This mix is the largest single cause of the unfinished look.
- The window stacks rows of chrome before any content: the profile strip, the Layout bar with one select, and the dock tab strip.
- One size and one weight for every label, so nothing leads the eye. Muted text fails 4.5 to 1 in light mode (3.33). The dark primary button fails (2.63).
- Colour has no stated roles: blue means selection, action and the Open filter; amber means focus, waiting, needs answer and warnings; reds and blues exist as separate literals.
- Status is a text colour, a glyph or a chip, with colour as the only signal in several places.
- Almost no icons. The row kind is a grey text label that wins over the title when the tree is narrow.
- Overlays are made by hand, with different shadows, radii and keyboard models; only the dialog traps focus.
- Light and dark are decided in separate places (a media query in CSS, the dock host, the terminal), so the terminal stayed white in a dark window.

0032 set the direction. This record is the designer's brief that the build runs work from: concrete tokens and values, components, chrome, icons, the theme file format, the VS Code import, accessibility rules and the order of work.

Design goal: a calm, modern, dense developer tool that looks native on macOS by default. Calm means few hues with fixed roles, low-contrast dividers, one accent, no decoration. Dense means 24 px rows and 13 px body text, the macOS default sizes for list-heavy tools. Native means the system font, the system accent, the inset title bar, macOS menu and selection conventions, and the OS accessibility settings.

## Decision

### 1. Tokens

All colours, sizes and timings in the renderer come from CSS custom properties named `--agide-*` on `:root`. No stylesheet holds a colour literal after the migration, except the token files. A theme file names tokens with dotted keys (`surface.window`), which map one to one to the CSS names (`--agide-surface-window`).

Values are opaque hex in theme files. Translucent variants (hover fills, overlays) are computed from them in CSS with `color-mix()` (Chrome 111 and later; the app runs Chromium 156).

#### 1.1 Colour tokens and the values of Agide Light and Agide Dark

| Token | Purpose | Agide Light | Agide Dark |
|---|---|---|---|
| `surface.window` | Title bar, tab strips, toolbars, profile rail | `#ececef` | `#202023` |
| `surface.sidebar` | Tree and inbox list panes | `#f3f3f5` | `#252528` |
| `surface.content` | Terminal, browser frame, detail panes, dialog body under fields | `#ffffff` | `#1b1b1e` |
| `surface.raised` | Cards, dialogs, segmented control thumb | `#ffffff` | `#2a2a2e` |
| `surface.overlay` | Menus, popovers, select lists | `#ffffff` | `#303035` |
| `surface.inset` | Wells: code blocks, raw request, segmented track, address field (dark) | `#f5f5f7` | `#151517` |
| `surface.hover` | Row and quiet button hover, computed | `color-mix(in srgb, text.primary 6%, transparent)` | `color-mix(in srgb, text.primary 8%, transparent)` |
| `surface.pressed` | Row and quiet button press, computed | `text.primary` at 10% | `text.primary` at 12% |
| `surface.backdrop` | Dialog backdrop | `rgb(0 0 0 / 20%)` | `rgb(0 0 0 / 45%)` |
| `text.primary` | Body text, titles, icons in controls | `#1d1d1f` | `#ececf0` |
| `text.secondary` | Metadata, labels of lesser rank, inactive tabs, secondary icons | `#55555c` | `#b8b8c0` |
| `text.tertiary` | Placeholders, timestamps, shortcuts in menus, disabled labels | `#62626a` | `#a2a2ac` |
| `text.inverse` | Tooltip text (tooltips are inverted) | `#ffffff` | `#1b1b1e` |
| `text.link` | Links | `#0058c2` | `#6eb0ff` |
| `border.subtle` | Dividers inside a pane, menu separators, card outlines | `#e5e5ea` | `#2c2c31` |
| `border.default` | Pane separators, splitters, table rules | `#d2d2d8` | `#3a3a40` |
| `border.strong` | Field, checkbox and select outlines (3 to 1 against every surface, overlays included) | `#86868f` | `#7a7a84` |
| `accent` | Primary button fill, highlighted menu item, checked checkbox and switch | `#0062cc` | `#2f6fd0` |
| `accent.hover` | Primary button hover | `#0057b5` | `#2967c4` |
| `accent.active` | Primary button press | `#004c9e` | `#235aad` |
| `accent.subtle` | Drop target fill, selected segment in tinted contexts, info background | `#e6effa` | `#1e2d45` |
| `accent.text` | Accent used as text or as a thin mark: active tab line, focus ring, drag line, progress | `#0058c2` | `#6eb0ff` |
| `accent.on` | Text and icons on `accent` and on `danger.fill` | `#ffffff` | `#ffffff` |
| `success.fg` / `success.bg` | Done, passed, saved | `#1a7034` / `#e8f3eb` | `#5cc878` / `#1a2e21` |
| `warning.fg` / `warning.bg` | Waiting for the user, needs answer, trust and agent-acting banners | `#8a4f00` / `#fcf1de` | `#e6ab45` / `#352a15` |
| `danger.fg` / `danger.bg` | Failed, errors, destructive menu items | `#c0251a` / `#fceceb` | `#ff7a70` / `#3b1f1d` |
| `danger.fill` | Destructive primary button, unread badge | `#c0251a` | `#c2332a` |
| `info.fg` / `info.bg` | Busy, running, live observation, neutral notices | `#0058c2` / `#e6effa` | `#6eb0ff` / `#1e2d45` |
| `selection` | Selected row in the focused list | `#dbe7f8` | `#24395a` |
| `selection.inactive` | Selected row when its list does not have focus | `#e6e6ea` | `#313136` |
| `focus.ring` | Keyboard focus outline | `#0062cc` | `#6eb0ff` |
| `tooltip.bg` | Tooltip background | `#1d1d1f` | `#ececf0` |
| `scrollbar.thumb` | Overlay scrollbar thumb, computed | `text.primary` at 25% | `text.primary` at 30% |

Roles that the audit found mixed are fixed here:

- Selection is a pale tint (`selection`). Action is a solid fill (`accent`). They no longer look alike.
- Focus is the accent colour as a 2 px ring, never amber. Amber (`warning`) means "waiting for you" only.
- One red (`danger`), one blue (`accent` and `info`), one green, one amber. The drop target and the drag line use `accent.text`, not a second blue. The orange agent-acting outline becomes `warning.fg`.

#### 1.2 Terminal colours

Tokens `terminal.background`, `terminal.foreground`, `terminal.cursor`, `terminal.cursorAccent`, `terminal.selection`, `terminal.selectionInactive` and the ANSI colours `terminal.black` to `terminal.brightWhite`. The xterm `ITheme` is built from these tokens (section 3.7).

| Token | Agide Light | Agide Dark |
|---|---|---|
| `terminal.background` | `#ffffff` (= `surface.content`) | `#1b1b1e` (= `surface.content`) |
| `terminal.foreground` | `#1d1d1f` | `#e3e3e8` |
| `terminal.cursor` / `terminal.cursorAccent` | `#1d1d1f` / `#ffffff` | `#e3e3e8` / `#1b1b1e` |
| `terminal.selection` / `terminal.selectionInactive` | `#dde9f9` / `#e6e6ea` | `#233756` / `#313136` |
| black, red, green, yellow | `#1d1d1f`, `#c0251a`, `#1a7034`, `#805000` | `#4a4a52`, `#ff7a70`, `#5cc878`, `#e6ab45` |
| blue, magenta, cyan, white | `#0058c2`, `#8e3aa8`, `#00687a`, `#6c6c74` | `#6eb0ff`, `#d68cf0`, `#4fc8d8`, `#c8c8d0` |
| brightBlack, brightRed, brightGreen, brightYellow | `#5b5b62`, `#a31d14`, `#145c2a`, `#6b4300` | `#8a8a94`, `#ff9c94`, `#82dc98`, `#f2c46e` |
| brightBlue, brightMagenta, brightCyan, brightWhite | `#00479e`, `#75308b`, `#005564`, `#3a3a3f` | `#9cc8ff`, `#e5b0f6`, `#86dce6`, `#ffffff` |

In the light palette the "bright" colours are darker than the base colours, because on a white background more contrast means darker. ANSI black on the dark background is 1.96 to 1 by convention (programs use it as a background colour). The terminal sets the xterm option `minimumContrastRatio: 4.5`, which lifts any foreground that falls below the ratio when it is drawn, for built-in and imported palettes alike.

#### 1.3 Elevation, radii, spacing

| Token | Light | Dark | Use |
|---|---|---|---|
| `shadow.1` | `0 1px 2px rgb(0 0 0 / 6%), 0 0 0 1px rgb(0 0 0 / 5%)` | `0 1px 2px rgb(0 0 0 / 30%), 0 0 0 1px rgb(255 255 255 / 6%)` | Cards, secondary buttons, segmented thumb |
| `shadow.2` | `0 4px 14px rgb(0 0 0 / 12%), 0 0 0 1px rgb(0 0 0 / 8%)` | `0 6px 18px rgb(0 0 0 / 45%), 0 0 0 1px rgb(255 255 255 / 9%)` | Menus, popovers, select lists, tooltips |
| `shadow.3` | `0 12px 36px rgb(0 0 0 / 18%), 0 0 0 1px rgb(0 0 0 / 8%)` | `0 16px 44px rgb(0 0 0 / 55%), 0 0 0 1px rgb(255 255 255 / 10%)` | Dialogs, floating dock groups |

In dark themes a shadow does not separate a surface from the one below, so each shadow carries a 1 px light ring. Raised surfaces are also lighter than the surface below them in dark themes (`raised` and `overlay` step up in lightness).

| Radius token | Value | Use |
|---|---|---|
| `radius.xs` | 3 px | Checkbox, tree row inner focus |
| `radius.sm` | 4 px | Tree rows, menu items |
| `radius.md` | 6 px | Buttons, fields, tabs inside panes, tooltips, notices |
| `radius.lg` | 8 px | Cards, menus, segmented track |
| `radius.xl` | 12 px | Dialogs, popovers |
| `radius.full` | 999 px | Chips, badges, dots |

Spacing scale (`space.*`), on a 4 px grid with a 2 px half step for dense controls:

| Token | `space.0` | `space.0_5` | `space.1` | `space.1_5` | `space.2` | `space.2_5` | `space.3` | `space.4` | `space.5` | `space.6` | `space.8` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Value | 0 | 2 px | 4 px | 6 px | 8 px | 10 px | 12 px | 16 px | 20 px | 24 px | 32 px |

Rules: gaps inside a control use `space.1` to `space.2`; between related fields `space.3`; between field groups and sections `space.4` to `space.6`; dialog padding `space.5`.

Stacking tokens replace the scattered literals of the audit (2, 10, 12, 20, 29, 30, 100): `z.dock-overlay` 10, `z.pane-chrome` 20, `z.popover` 40, `z.menu` 50, `z.dialog` 60, `z.tooltip` 70, `z.capture-mask` 100. Radix portals render into one `#agide-overlays` root at the end of `body`, so the implicit stacking context of `.browser-chrome` no longer traps menus.

#### 1.4 Type

| Token | Value |
|---|---|
| `font.ui` | `system-ui, -apple-system, "Helvetica Neue", sans-serif` |
| `font.mono` | `"SF Mono", Menlo, Monaco, monospace` (no `ui-monospace`: Chromium does not support it; Menlo ships with every macOS) |
| `font.weight.regular` / `.medium` / `.semibold` | 400 / 500 / 600 |
| `font.numeric` | `font-variant-numeric: tabular-nums` for counts, rates, times and percentages |

| Step | Size / line height | Weight | Use |
|---|---|---|---|
| `type.caption` | 11 / 14 px | 400 or 500 | Chips, badges, column headers, time stamps. The smallest size in the app |
| `type.small` | 12 / 16 px | 400 | Metadata, tab titles, field labels, help text, menu shortcuts |
| `type.body` | 13 / 18 px | 400 | Default text, tree rows, menu items, buttons, fields |
| `type.body-strong` | 13 / 18 px | 600 | Unread inbox titles, card titles, section headings in panes |
| `type.title` | 15 / 20 px | 600 | Dialog titles, inbox card title, empty state title in large panes |
| `type.large` | 20 / 26 px | 600 | Settings page heading, first-run screen |
| `type.mono` | 12 / 16 px | 400 | Paths, ids, raw blocks. The terminal uses 13 px (section 3.7) |

13 px is the macOS body size for list-heavy apps. Nothing in the app goes under 11 px; the "no plan data" and "5 h: 1%" labels of the rail move to 12 px in the title bar. All form controls set `font: inherit`, so native and custom controls share one font. Headings use weight, not size, inside panes; size steps are for dialogs and empty states.

#### 1.5 Icon sizes

| Token | Value | Stroke width | Use |
|---|---|---|---|
| `icon.xs` | 12 px | 2 | Inside chips, disclosure chevrons |
| `icon.sm` | 14 px | 1.75 | Tab icons, inbox kind icons, inline status in rows |
| `icon.md` | 16 px | 1.5 | Default: buttons, tree rows, menus, toolbars |
| `icon.lg` | 20 px | 1.5 | Title bar actions, banners with a title |
| `icon.xl` | 32 px | 1.25 | Empty states |

Lucide draws on a 24 px grid at stroke 2. Thinner strokes at 14 to 20 px keep the line weight close to the 13 px text weight and give the calmer look. The `strokeWidth` prop is set per size and `absoluteStrokeWidth` stays off.

#### 1.6 Density

A profile setting. It changes heights only; type sizes stay.

| Token | Compact | Regular (default) | Comfortable |
|---|---|---|---|
| `density.row` (tree, inbox single line, menu item) | 22 px | 24 px | 28 px |
| `density.control` (button md, field, select) | 22 px | 26 px | 28 px |
| `density.control-sm` | 20 px | 22 px | 24 px |
| `density.tab` (dock tab strip) | 28 px | 30 px | 34 px |
| `density.toolbar` (pane toolbar, browser chrome) | 30 px | 34 px | 38 px |
| `density.pad` (card and list item padding) | 8 px | 12 px | 14 px |

The title bar stays 38 px in every density, because it holds the traffic lights.

#### 1.7 Motion

| Token | Value | Use |
|---|---|---|
| `motion.fast` | 100 ms | Hover and press colours, chevron rotation |
| `motion.base` | 160 ms | Menus, popovers, tooltips in and out |
| `motion.slow` | 240 ms | Dialogs, dock drop overlay, banner in |
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` | Moves and size changes |
| `ease.enter` | `cubic-bezier(0, 0, 0.2, 1)` | Things that appear |
| `ease.exit` | `cubic-bezier(0.4, 0, 1, 1)` | Things that leave (exit runs at 75% of the enter time) |

Motion is limited to opacity and a small scale (0.98 to 1) or a 4 px slide for overlays. No layout animation of rows; dockview's tab animation stays off.

Reduced motion (`prefers-reduced-motion: reduce`): every duration token becomes 0 ms except opacity fades, which become `motion.fast`; no transforms; the busy loader icon stops spinning and shows its static form; the xterm cursor stops blinking (`cursorBlink: false`); `--dv-transition-duration` becomes 0, set on the dock root and on `.dv-drop-target-container`, because dockview's stylesheet redefines it there (300 ms) for the drop overlay.

#### 1.8 Contrast table

The ratios below come from `node notes/scripts/token-contrast.mjs` (standalone, no dependencies, WCAG 2 formula). It exits with status 1 if any pair misses its target. Targets: 4.5 to 1 for text at body size (every text colour token appears at 13 px or smaller somewhere, so the large-text target never applies to tokens), 3 to 1 for non-text UI (focus ring, field borders, icons used without text, the accent as a thin mark). Status colours are checked at 4.5 because they are used as text and as icons beside text.

**Token pairs**

| Use | Foreground | Background | Target | Agide Light | Agide Dark |
|---|---|---|---|---|---|
| primary text | primary | window | 4.5 | 14.27 | 13.79 |
| secondary text | secondary | window | 4.5 | 6.27 | 8.25 |
| tertiary text | tertiary | window | 4.5 | 5.13 | 6.42 |
| primary text | primary | sidebar | 4.5 | 15.19 | 12.97 |
| secondary text | secondary | sidebar | 4.5 | 6.67 | 7.76 |
| tertiary text | tertiary | sidebar | 4.5 | 5.45 | 6.04 |
| primary text | primary | content | 4.5 | 16.83 | 14.58 |
| secondary text | secondary | content | 4.5 | 7.39 | 8.72 |
| tertiary text | tertiary | content | 4.5 | 6.04 | 6.79 |
| primary text | primary | raised | 4.5 | 16.83 | 12.13 |
| secondary text | secondary | raised | 4.5 | 7.39 | 7.25 |
| tertiary text | tertiary | raised | 4.5 | 6.04 | 5.65 |
| primary text | primary | overlay | 4.5 | 16.83 | 11.14 |
| secondary text | secondary | overlay | 4.5 | 7.39 | 6.66 |
| tertiary text | tertiary | overlay | 4.5 | 6.04 | 5.19 |
| primary text | primary | inset | 4.5 | 15.46 | 15.48 |
| secondary text | secondary | inset | 4.5 | 6.79 | 9.25 |
| tertiary text | tertiary | inset | 4.5 | 5.55 | 7.21 |
| primary text | primary | selection | 4.5 | 13.46 | 9.86 |
| secondary text | secondary | selection | 4.5 | 5.91 | 5.89 |
| tertiary text | tertiary | selection | 4.5 | 4.83 | 4.59 |
| primary text | primary | selectionInactive | 4.5 | 13.52 | 10.98 |
| secondary text | secondary | selectionInactive | 4.5 | 5.94 | 6.56 |
| tertiary text | tertiary | selectionInactive | 4.5 | 4.86 | 5.11 |
| link | link | window | 4.5 | 5.61 | 7.21 |
| link | link | content | 4.5 | 6.61 | 7.62 |
| link | link | sidebar | 4.5 | 5.97 | 6.78 |
| link | link | raised | 4.5 | 6.61 | 6.34 |
| link | link | overlay | 4.5 | 6.61 | 5.82 |
| text on fill | onAccent | accent | 4.5 | 5.80 | 4.88 |
| text on fill | onAccent | accentHover | 4.5 | 6.93 | 5.48 |
| text on fill | onAccent | accentActive | 4.5 | 8.31 | 6.69 |
| text on fill | onAccent | dangerFill | 4.5 | 5.96 | 5.53 |
| tooltip text | inverse | tooltipBg | 4.5 | 16.83 | 14.58 |
| accent text on subtle | accentText | accentSubtle | 4.5 | 5.70 | 6.14 |
| primary on accent subtle | primary | accentSubtle | 4.5 | 14.50 | 11.75 |
| secondary on accent subtle | secondary | accentSubtle | 4.5 | 6.37 | 7.03 |
| tertiary on accent subtle | tertiary | accentSubtle | 4.5 | 5.21 | 5.47 |
| status chip | successFg | successBg | 4.5 | 5.41 | 6.86 |
| banner and notice text | primary | successBg | 4.5 | 14.79 | 12.24 |
| status text and icon | successFg | window | 4.5 | 5.22 | 7.73 |
| status text and icon | successFg | content | 4.5 | 6.16 | 8.17 |
| status text and icon | successFg | sidebar | 4.5 | 5.56 | 7.27 |
| status text and icon | successFg | raised | 4.5 | 6.16 | 6.80 |
| status text and icon | successFg | overlay | 4.5 | 6.16 | 6.24 |
| status text and icon | successFg | selection | 4.5 | 4.92 | 5.52 |
| status text and icon | successFg | selectionInactive | 4.5 | 4.95 | 6.15 |
| status chip | warningFg | warningBg | 4.5 | 5.87 | 6.88 |
| banner and notice text | primary | warningBg | 4.5 | 15.05 | 11.93 |
| status text and icon | warningFg | window | 4.5 | 5.57 | 7.95 |
| status text and icon | warningFg | content | 4.5 | 6.56 | 8.41 |
| status text and icon | warningFg | sidebar | 4.5 | 5.92 | 7.48 |
| status text and icon | warningFg | raised | 4.5 | 6.56 | 6.99 |
| status text and icon | warningFg | overlay | 4.5 | 6.56 | 6.42 |
| status text and icon | warningFg | selection | 4.5 | 5.25 | 5.68 |
| status text and icon | warningFg | selectionInactive | 4.5 | 5.27 | 6.33 |
| status chip | dangerFg | dangerBg | 4.5 | 5.21 | 5.91 |
| banner and notice text | primary | dangerBg | 4.5 | 14.70 | 12.73 |
| status text and icon | dangerFg | window | 4.5 | 5.06 | 6.40 |
| status text and icon | dangerFg | content | 4.5 | 5.96 | 6.77 |
| status text and icon | dangerFg | sidebar | 4.5 | 5.38 | 6.02 |
| status text and icon | dangerFg | raised | 4.5 | 5.96 | 5.63 |
| status text and icon | dangerFg | overlay | 4.5 | 5.96 | 5.17 |
| status text and icon | dangerFg | selection | 4.5 | 4.77 | 4.57 |
| status text and icon | dangerFg | selectionInactive | 4.5 | 4.79 | 5.09 |
| status chip | infoFg | infoBg | 4.5 | 5.70 | 6.14 |
| banner and notice text | primary | infoBg | 4.5 | 14.50 | 11.75 |
| status text and icon | infoFg | window | 4.5 | 5.61 | 7.21 |
| status text and icon | infoFg | content | 4.5 | 6.61 | 7.62 |
| status text and icon | infoFg | sidebar | 4.5 | 5.97 | 6.78 |
| status text and icon | infoFg | raised | 4.5 | 6.61 | 6.34 |
| status text and icon | infoFg | overlay | 4.5 | 6.61 | 5.82 |
| status text and icon | infoFg | selection | 4.5 | 5.29 | 5.15 |
| status text and icon | infoFg | selectionInactive | 4.5 | 5.31 | 5.74 |
| focus ring | focus | window | 3 | 4.92 | 7.21 |
| focus ring | focus | sidebar | 3 | 5.24 | 6.78 |
| focus ring | focus | content | 3 | 5.80 | 7.62 |
| focus ring | focus | raised | 3 | 5.80 | 6.34 |
| focus ring | focus | overlay | 3 | 5.80 | 5.82 |
| focus ring | focus | inset | 3 | 5.33 | 8.09 |
| focus ring | focus | selection | 3 | 4.64 | 5.15 |
| focus ring | focus | selectionInactive | 3 | 4.66 | 5.74 |
| focus ring | focus | accentSubtle | 3 | 5.00 | 6.14 |
| field border | borderStrong | window | 3 | 3.06 | 3.83 |
| field border | borderStrong | sidebar | 3 | 3.26 | 3.60 |
| field border | borderStrong | content | 3 | 3.61 | 4.05 |
| field border | borderStrong | raised | 3 | 3.61 | 3.37 |
| field border | borderStrong | overlay | 3 | 3.61 | 3.09 |
| field border | borderStrong | inset | 3 | 3.31 | 4.29 |
| accent indicator | accentText | window | 3 | 5.61 | 7.21 |
| accent indicator | accentText | sidebar | 3 | 5.97 | 6.78 |
| accent indicator | accentText | content | 3 | 6.61 | 7.62 |
| accent indicator | accentText | raised | 3 | 6.61 | 6.34 |
| accent indicator | accentText | overlay | 3 | 6.61 | 5.82 |
| accent indicator | accentText | selection | 3 | 5.29 | 5.15 |

**Increased contrast overrides** (lowest ratio over every surface and both selection colours)

| Theme | Token | Value | Lowest | Target |
|---|---|---|---|---|
| light | primary | `#000000` | 16.80 | 7 |
| light | secondary | `#3a3a40` | 9.04 | 7 |
| light | tertiary | `#47474e` | 7.37 | 4.5 |
| light | borderDefault | `#7a7a83` | 3.40 | 3 |
| light | borderStrong | `#5e5e66` | 5.14 | 4.5 |
| light | focus | `#004c9e` | 6.65 | 4.5 |
| dark | primary | `#ffffff` | 11.62 | 7 |
| dark | secondary | `#d4d4dc` | 7.88 | 7 |
| dark | tertiary | `#c6c6d0` | 6.85 | 4.5 |
| dark | borderDefault | `#82828c` | 3.05 | 3 |
| dark | borderStrong | `#a4a4ae` | 4.70 | 4.5 |
| dark | focus | `#9cc8ff` | 6.70 | 4.5 |

**Profile colours** (step: how far the stored colour moved, in percent; then the ratio)

| Stored | Rail tile fill (white letter) | Mark on light window | Mark on dark window | Title bar text, light tint | Title bar text, dark tint |
|---|---|---|---|---|---|
| `#5b7fa6` | `#56779c` (6 %) 4.65 | `#5b7fa6` (0 %) 3.54 | `#5b7fa6` (0 %) 3.89 | 5.53 | 6.84 |
| `#b5651d` | `#ae611c` (4 %) 4.64 | `#b5651d` (0 %) 3.68 | `#b5651d` (0 %) 3.75 | 5.47 | 6.93 |
| `#4f8a5b` | `#4a8256` (6 %) 4.55 | `#4f8a5b` (0 %) 3.48 | `#4f8a5b` (0 %) 3.96 | 5.51 | 6.80 |
| `#a64f7e` | `#a64f7e` (0 %) 5.20 | `#a64f7e` (0 %) 4.41 | `#a64f7e` (0 %) 3.13 | 5.39 | 7.10 |
| `#7a5fb0` | `#7a5fb0` (0 %) 5.13 | `#7a5fb0` (0 %) 4.35 | `#7a5fb0` (0 %) 3.17 | 5.42 | 7.06 |
| `#b0453a` | `#b0453a` (0 %) 5.59 | `#b0453a` (0 %) 4.74 | `#b2493e` (2 %) 3.03 | 5.34 | 7.25 |
| `#2f8f9d` | `#2a818d` (10 %) 4.54 | `#2f8f9d` (0 %) 3.22 | `#2f8f9d` (0 %) 4.28 | 5.54 | 6.75 |
| `#8a7a2f` | `#84752d` (4 %) 4.60 | `#8a7a2f` (0 %) 3.63 | `#8a7a2f` (0 %) 3.80 | 5.50 | 6.88 |

**Terminal palettes** (against the terminal background and the terminal selection)

| Colour | Light value | On background | On selection | Dark value | On background | On selection |
|---|---|---|---|---|---|---|
| foreground | `#1d1d1f` | 16.83 | 13.70 | `#e3e3e8` | 13.43 | 9.37 |
| black | `#1d1d1f` | 16.83 | 13.70 | `#4a4a52` | 1.96 | 1.37 |
| red | `#c0251a` | 5.96 | 4.86 | `#ff7a70` | 6.77 | 4.72 |
| green | `#1a7034` | 6.16 | 5.01 | `#5cc878` | 8.17 | 5.70 |
| yellow | `#805000` | 6.85 | 5.58 | `#e6ab45` | 8.41 | 5.86 |
| blue | `#0058c2` | 6.61 | 5.39 | `#6eb0ff` | 7.62 | 5.32 |
| magenta | `#8e3aa8` | 6.32 | 5.15 | `#d68cf0` | 7.26 | 5.06 |
| cyan | `#00687a` | 6.44 | 5.24 | `#4fc8d8` | 8.66 | 6.04 |
| white | `#6c6c74` | 5.20 | 4.24 | `#c8c8d0` | 10.33 | 7.21 |
| brightBlack | `#5b5b62` | 6.74 | 5.48 | `#8a8a94` | 5.03 | 3.51 |
| brightRed | `#a31d14` | 7.66 | 6.23 | `#ff9c94` | 8.54 | 5.95 |
| brightGreen | `#145c2a` | 8.10 | 6.59 | `#82dc98` | 10.34 | 7.21 |
| brightYellow | `#6b4300` | 8.65 | 7.04 | `#f2c46e` | 10.55 | 7.36 |
| brightBlue | `#00479e` | 8.77 | 7.14 | `#9cc8ff` | 9.92 | 6.92 |
| brightMagenta | `#75308b` | 8.23 | 6.70 | `#e5b0f6` | 9.71 | 6.78 |
| brightCyan | `#005564` | 8.46 | 6.88 | `#86dce6` | 10.96 | 7.64 |
| brightWhite | `#3a3a3f` | 11.31 | 9.21 | `#ffffff` | 17.18 | 11.98 |

**System theme accent derivation** (sample macOS accents; step as above. The text form shows its lowest ratio over sidebar, content, raised and overlay; it also keeps 3 to 1 on the window and on the derived selection. Selection shows the mix percentage of rule 5 in 7.1)

| OS accent | Value | Fill for white text | Text form, light | Text form, dark | Selection, light | Selection, dark |
|---|---|---|---|---|---|---|
| blue | `#007aff` | `#0070eb` (8 %) 4.65 | `#006be0` (12 %) 4.53 | `#3d9aff` (24 %) 4.54 | `#d1e2f6` (14 %) | `#1c395c` (24 %) |
| purple | `#953d96` | `#953d96` (0 %) 6.20 | `#953d96` (0 %) 5.60 | `#bd87be` (38 %) 4.61 | `#e8ddea` (12 %) | `#472c49` (30 %) |
| pink | `#f74f9e` | `#cb4182` (18 %) 4.55 | `#bc3c78` (24 %) 4.67 | `#f861a8` (10 %) 4.54 | `#f4d9e7` (16 %) | `#532e42` (22 %) |
| red | `#e0383e` | `#dc373d` (2 %) 4.51 | `#ce3439` (8 %) 4.54 | `#e97478` (30 %) 4.52 | `#f1dddf` (12 %) | `#592a2e` (28 %) |
| orange | `#f7821b` | `#b25e13` (28 %) 4.66 | `#a85812` (32 %) 4.66 | `#f7821b` (0 %) 5.10 | `#f4dfce` (18 %) | `#473426` (16 %) |
| yellow | `#ffc600` | `#8f6f00` (44 %) 4.73 | `#8a6b00` (46 %) 4.53 | `#ffc600` (0 %) 8.33 | `#f5ebc9` (18 %) | `#3f3823` (12 %) |
| green | `#62ba46` | `#458231` (30 %) 4.68 | `#417b2e` (34 %) 4.62 | `#62ba46` (0 %) 5.40 | `#d9e9d6` (18 %) | `#2f3d2d` (16 %) |
| graphite | `#8c8c8c` | `#767676` (16 %) 4.54 | `#6d6d6d` (22 %) 4.67 | `#989898` (10 %) 4.55 | `#e0e0e2` (18 %) | `#38383a` (18 %) |

Result of the run: no checked pair below its target. The terminal table is reported, not checked: ANSI black on the dark background (1.96) and a few colours over the selection (lowest 3.51, dark bright black) are under 4.5 to 1, and the xterm option `minimumContrastRatio: 4.5` lifts them when drawn (section 1.2).

Accepted exceptions, by rule: decorative dividers (`border.subtle`, `border.default`) are under 3 to 1 on purpose; they separate regions that are also separated by surface colour and spacing, and WCAG 1.4.11 does not apply to them. Disabled controls are exempt by WCAG and use `text.tertiary` at reduced opacity. The press fill (`surface.pressed`) shows only while the pointer is down; `text.tertiary` and `danger.fg` on it measure 4.15 (light window) to 4.50, and this is accepted for that moment. The hover fill keeps both at 4.52 or more on the window, sidebar and content. Button fills are not checked against the surface below them because the label identifies the button.

### 2. Components

Each component is one React component in `app/src/renderer/ui/` with one stylesheet that reads tokens only. Panes use these components; they do not style buttons or menus themselves. Radix comes through the umbrella package `radix-ui` (MIT, React 19 in its peer range, audit 3.1). Every Radix overlay component (Dialog, DropdownMenu, ContextMenu, Popover, Select, Tooltip over a browser tab) wraps its open state in `useViewSuspension`, because native `WebContentsView` children draw above the DOM (audit 1.5).

| Component | Built on | Anatomy | Sizes |
|---|---|---|---|
| Button | Plain `<button>` | Optional leading icon (`icon.md`), label, optional trailing chevron; `space.1_5` gap | `sm`: `density.control-sm` high, padding 0 `space.2`, `type.small`. `md`: `density.control` high, padding 0 `space.3`, `type.body`. Radius `radius.md`. Weight 500 |
| IconButton | Plain `<button>` | One icon, required `aria-label`, Tooltip with the same name and the shortcut | `sm` 20 px square with `icon.sm`; `md` 24 px with `icon.md`; `lg` 28 px with `icon.lg` (title bar). Radius `radius.md` |
| Chip | Plain `<span>` | Leading icon `icon.xs`, label `type.caption` weight 500 | 18 px high, padding 0 `space.1_5`, `radius.full` |
| Badge | Plain `<span>` | Count in `type.caption` weight 600, or a dot | Count: 16 px high, min width 16 px, padding 0 4 px. Dot: 8 px. `radius.full`; ring 2 px in the surface colour behind it |
| Field (text, textarea) | Plain `<input>`, `<textarea>` with a `Field` wrapper | Label above (`type.small`, weight 500, `text.primary`), control, help or error line below (`type.small`) | Control `density.control` high, padding 0 `space.2`, textarea padding `space.1_5` `space.2`, min 3 rows. Label to control gap `space.1`; control to help `space.1`; field to field `space.3` |
| Select | Radix Select | Trigger styled as a Field with `chevron-down` (`icon.sm`) at the right; content styled as Menu | Same as Field |
| Checkbox, Switch | Radix Checkbox, Radix Switch | Box 14 px (`radius.xs`) with `check` icon; switch 26 by 15 px. Unchecked: `surface.content` box with 1 px `border.strong`; switch off: `border.strong` track with a `surface.raised` thumb. Checked: `accent` fill with `accent.on` icon or thumb. Indeterminate: `accent` fill with `minus` | Label to the right, `space.2` gap, click target the full row |
| RadioGroup | Radix RadioGroup | 14 px circle, 1 px `border.strong`; checked: `accent` fill with a 6 px `accent.on` dot. Where the options are short labels, a SegmentedControl or Select is preferred | As Checkbox |
| Disclosure | Plain `<button aria-expanded>` with a region | `chevron-right` `icon.xs` in `text.secondary`, rotated when open, then the label (`type.small` weight 500). Replaces every native `<details>` marker (layout notice, task dialog, settings, inbox raw block, approval bar) | Row `density.control-sm` high; focus ring inset |
| Table | Plain `<table>` | Header row `type.caption` weight 500 `text.secondary` on `surface.window` with a 1 px `border.default` bottom rule; body rows `type.body`, 1 px `border.subtle` rules; numbers right aligned with `font.numeric`; hover and selection as in the tree; a state column shows the status icon and word, never colour alone (failed history rows are red text today) | Row `density.row`, cell padding 0 `space.2` (history table and usage ranking) |
| SegmentedControl | Radix ToggleGroup (single) | Track `surface.inset`, 1 px `border.subtle`, `radius.lg`, 2 px padding; segments with label `type.small` weight 500 | Track `density.control-sm` + 4 px high; segment padding 0 `space.2_5` |
| Tabs (inside a pane) | Radix Tabs | Tab list with underline indicator | Tab 28 px high, `type.small` weight 500, indicator 2 px `accent.text` |
| Tree row | Plain, existing `role="tree"` model | See 3.5 | `density.row` |
| Card | Plain `<section>` | Header (title `type.body-strong`, meta `type.small` `text.secondary`), body, action row | Padding `density.pad`; radius `radius.lg`; `surface.raised`, 1 px `border.subtle`, `shadow.1` |
| Dialog | Radix Dialog | Title (`type.title`), optional description (`type.body`, `text.secondary`), body, footer with buttons at the right, primary last | Width 400, 480 or 640 px; padding `space.5`; radius `radius.xl`; `surface.raised`; `shadow.3`; backdrop `surface.backdrop` |
| Menu | Radix DropdownMenu and ContextMenu | Items with an optional 16 px icon column, label, shortcut at the right (`type.small`, `text.tertiary`), submenu chevron; separators; group labels (`type.caption`, `text.secondary`). The highlighted item (pointer or arrow keys) has the `accent` fill, and its label, icon, shortcut and chevron all switch to `accent.on` (`text.tertiary` and `danger.fg` measure under 2 to 1 on the fill). A destructive item is `danger.fg` at rest and highlights with `danger.fill` and `accent.on` | Item `density.row` high, padding 0 `space.2`, radius `radius.sm`; content padding `space.1`, radius `radius.lg`, `surface.overlay`, `shadow.2`, min width 180 px |
| Popover | Radix Popover | Optional title (`type.body-strong`), body, optional actions; no arrow | Padding `space.3`, radius `radius.xl`, `surface.overlay`, `shadow.2`, max width 320 px |
| Tooltip | Radix Tooltip | Text only | `type.small`, padding `space.1` `space.2`, radius `radius.md`, `tooltip.bg` with `text.inverse`, max width 280 px; open delay 600 ms, skip delay 300 ms |
| Banner | Plain, `role="status"` or `role="alert"` for danger | Tone icon `icon.md`, message (`type.body`), actions as `sm` Buttons, dismiss IconButton | Full width of its pane or of the dock, min height 32 px, padding `space.1_5` `space.3`, `tone.bg` background with a 1 px bottom border of `tone.fg` at 25% |
| Notice | Plain, inline | Tone icon `icon.sm`, text `type.small` | Padding `space.2` `space.2_5`, radius `radius.md`, `tone.bg`, no border |
| EmptyState | Plain | Icon `icon.xl` in `text.tertiary`, title (`type.body-strong`), one line of help (`type.small`, `text.secondary`, max 280 px), optional `sm` secondary Button | Centred horizontally, top at 30% of the pane height |
| Toolbar | Radix Toolbar | IconButtons and Buttons, separators 1 px by 16 px `border.subtle`; arrow keys move between items | `density.toolbar` high, padding 0 `space.1_5`, item gap `space.0_5` |

Button variants:

| Variant | Rest | Hover | Active | Use |
|---|---|---|---|---|
| Primary | `accent` fill, `accent.on` text | `accent.hover` | `accent.active` | The one main action of a dialog, card or banner |
| Secondary | `surface.raised`, 1 px `border.default`, `shadow.1` (light only), `text.primary` | Fill mixed with `text.primary` 4% | 8% | Every other action next to a primary |
| Quiet | Transparent, `text.primary` | `surface.hover` | `surface.pressed` | Toolbars, inline actions, "Show less" |
| Danger | `danger.fill`, `accent.on` text | Fill mixed with black 8% | 16% | Confirming a destructive action in a dialog |
| Danger quiet | Transparent, `danger.fg` text | `danger.bg` | `danger.bg` with 8% `danger.fg` | Remove, dismiss failed agent, in rows and menus |

States common to all interactive components:

| State | Treatment |
|---|---|
| Hover | Fill change per variant; no hover on touch-less disabled items; cursor stays the arrow (macOS controls do not use the hand cursor), links use the hand |
| Active | Press fill per variant; no transform |
| Focus | `:focus-visible` only: 2 px `focus.ring` outline at 2 px offset (1 px offset inside rows and menus, drawn inset). Buttons, rows, tabs and menu items show no ring after a mouse click. Text fields and text areas match `:focus-visible` whenever they have focus (Chromium treats elements that take typed input that way, and the current `styles.css` rule already uses `:focus-visible`), so a focused field always shows its ring, as macOS fields do. The ring in the accent colour, in place of amber, is what stops it dominating dialogs |
| Invalid | Fields, selects and checkboxes: 1 px `danger.fg` outline in place of `border.strong`, `aria-invalid`, and an error line below in `type.small` `danger.fg` that starts with `circle-x` (`icon.xs`), so the error does not depend on colour. The focus ring stays `focus.ring` |
| Read-only | Fields: `surface.inset` fill, no border, text stays selectable, no hover |
| Disabled | 40% opacity on the whole control, no hover, `aria-disabled` where the control must stay focusable to show its reason in a Tooltip (for example Save in the setup card) |
| Selected | Rows and menu-like lists: `selection` fill (`selection.inactive` when the list is not focused). Segments: `surface.raised` thumb with `shadow.1` and `text.primary` (weight stays 500, so the label does not change width). Tabs: underline |
| Loading | Button keeps its width; the leading icon becomes `loader-circle` (static under reduced motion); `aria-busy` |

Chips and badges:

| Chip | Tone | Icon | Label |
|---|---|---|---|
| busy | `info` | `loader-circle` (spins at 1 turn per second; static under reduced motion) | busy |
| waiting | `warning` | `message-circle-question-mark` | waiting |
| failed | `danger` | `circle-x` | failed |
| done | `success` | `circle-check` | done |
| idle | neutral (`surface.inset`, `text.secondary`) | `circle-dashed` | idle |
| exited | neutral | `square` | exited |
| needs answer (inbox) | `warning` | `hand` | Needs answer |
| live (observation) | `info` | `radio` | Live |

A chip is `tone.bg` with `tone.fg` text and icon. Where space is short (tree rows, tabs) the chip shows its icon only, keeps its label as `aria-label` and in a Tooltip. Unread badge: `danger.fill` with `accent.on` text; the profile running mark is a `success.fg` dot.

Inbox kind labels are not chips: a kind icon in the tone colour (`icon.sm`) followed by the kind name in `type.caption` weight 500 `text.secondary`. Kinds: approval (`shield-question-mark`, warning tone), reminder (`alarm-clock`, info), alert (`triangle-exclamation-point`, warning), failure (`octagon-x`, danger), update and status (`message-square-text`, neutral). The kind name always shows, so the colour adds to the word.

What stays plain: buttons, chips, badges, fields, cards, banners, notices, empty states, disclosures, tables and the tree. Radix brings keyboard and focus behaviour that the app lacks for overlays and composite widgets (dialog, menus, popover, tooltip, select, tabs, toggle group, toolbar, checkbox, radio group, switch); simple elements gain nothing from it. `@vscode-elements/elements` stays a later option, as 0032 says; the alias layer of section 6.3 keeps that door open.

### 3. Layout and chrome

#### 3.1 Title bar

- The window uses `titleBarStyle: 'hiddenInset'` with `trafficLightPosition: { x: 14, y: 13 }`, which centres the 12 px traffic lights in a 38 px bar (to be checked against a capture; the docs give no default offsets). Full screen hides the lights; the bar keeps its height and drops the left inset.
- The title bar is one 38 px row in `surface.window`, mixed with the profile colour (12% in light, 16% in dark). It replaces the profile strip and the Layout bar, which saves about 52 px of chrome. A 2 px bottom border in the profile mark colour (3.6) ends the bar.
- Left to right after an 80 px inset for the lights: the profile identity (3.2); the layout switcher, a quiet Button with `layout-dashboard`, the preset name and `chevron-down`, which opens a Menu of presets and "Edit layout file"; free space; the usage meter (`gauge` icon, "5 h 12%" in `type.small` `text.secondary`, Tooltip with the plan window and the caveat); the inbox IconButton (`inbox`, with the unread Badge); the settings IconButton (`settings`).
- Drag region: the bar sets `app-region: drag`; every control in it sets `app-region: no-drag`. Double-click on the free space zooms the window, the macOS default (to be checked in a probe; the Electron docs do not state it for custom drag regions).
- The window title (profile name) is still set for the Window menu, Mission Control and accessibility, even though it is not drawn.
- No `text.tertiary` in the tinted bar: secondary text on the tint measures 5.34 at the lowest (table 1.8, profile section), while tertiary falls to 4.36 on the light tint of `#b0453a`. The focus ring on the tint measures 4.19 at the lowest (light), above 3 to 1.

#### 3.2 Profile identity

The profile must be unmistakable at a glance and by name.

- Title bar: an 18 px tile (`radius.sm`) in the profile tile colour with the first letter in white (`type.caption`, 600), then the profile name in `type.body-strong`. The tint of the bar and its bottom border repeat the colour across the whole window width.
- Temporary profile: the tile has a 1 px dashed `border.strong` outline and no fill; the name reads "Default" and a neutral chip "Temporary" follows, with the Tooltip "This profile is not saved". The grey strip that was the loudest element is gone.
- The new profile form becomes a Popover anchored to the rail's `plus` tile, and the setup card becomes a Card in a Popover anchored to the profile identity in the title bar (dismissed with "Later" or Escape), so neither covers pane content without a keyboard model.
- Rail (52 px wide, `surface.window`): 32 px tiles (`radius.lg`) with the letter in `type.body` 600, white on the tile colour. The current profile has a 4 by 20 px `text.primary` bar at the left edge of the rail (the macOS and chat-app pattern), which does not look like a focus ring. Running: `success.fg` dot, 8 px, bottom right with a 2 px ring of `surface.window`. Unread: Badge top right. Tooltip and `aria-label`: name and state ("Work, 2 running, 1 unread"). The rail joins the Tab order (V-06).
- Tile colour: the stored profile colour, darkened in 2% steps toward black until white text reaches 4.5 to 1 (at most 10% for the current palette; table 1.8). Mark colour (dot, bottom border): the stored colour moved toward black on light windows or white on dark windows until it reaches 3 to 1 against `surface.window`.

#### 3.3 Dock theme

A custom dockview theme defined from tokens: class `agide-dock` in `layout/dock-theme.css`, theme object `{ name: 'agide', className: 'agide-dock', colorScheme: <current appearance>, gap: 0 }` passed as `theme` to `DockviewReact`, which replaces `themeDark` and `themeLight` and the media query listener in `LayoutHost.tsx`.

| dockview variable | Value |
|---|---|
| `--dv-tabs-and-actions-container-height` | `var(--agide-density-tab)` (30 px regular) |
| `--dv-tabs-and-actions-container-font-size`, `--dv-tab-font-size` | 12 px |
| `--dv-tabs-and-actions-container-background-color` | `surface.window` |
| `--dv-group-view-background-color` | `surface.content` |
| `--dv-activegroup-visiblepanel-tab-background-color` | `surface.content` |
| `--dv-activegroup-visiblepanel-tab-color` | `text.primary` |
| `--dv-activegroup-hiddenpanel-tab-background-color`, `--dv-inactivegroup-hiddenpanel-tab-background-color` | transparent |
| `--dv-activegroup-hiddenpanel-tab-color`, `--dv-inactivegroup-hiddenpanel-tab-color`, `--dv-inactivegroup-visiblepanel-tab-color` | `text.secondary` |
| `--dv-inactivegroup-visiblepanel-tab-background-color` | `surface.content` |
| `--dv-tab-divider-color` | transparent |
| `--dv-separator-border`, `--dv-paneview-header-border-color` | `border.default` |
| `--dv-sash-color` | transparent (dockview fills the whole 4 px sash with it; the visible line comes from `--dv-separator-border`) |
| `--dv-active-sash-color` | `accent.text` |
| `--dv-active-sash-transition-delay` | 150 ms (dockview default 0.5 s) |
| `--dv-drag-over-background-color` | `accent.text` at 14% |
| `--dv-drag-over-border-color` | `accent.text` |
| `--dv-paneview-active-outline-color` | `focus.ring` |
| `--dv-icon-hover-background-color` | `surface.hover` |
| `--dv-floating-box-shadow` | `shadow.3` |
| `--dv-context-menu-background-color`, `--dv-context-menu-color` | `surface.overlay`, `text.primary` |
| `--dv-scrollbar-background-color`, `--dv-tabs-container-scrollbar-color` | `scrollbar.thumb` |
| `--dv-border-radius`, `--dv-tab-border-radius` | `radius.md`, 0 |
| `--dv-transition-duration` | `motion.base` (0 under reduced motion); also set on `.dv-drop-target-container`, which redefines it as 300 ms |
| `--dv-edge-dock-indicator-color`, `--dv-floating-border` | `accent.text` at 60%, 1 px solid `border.default` |

The stock theme classes also set structural variables that the table does not change (`--dv-tab-margin`, `--dv-spacing-padding`, `--dv-sash-border-radius`, `--dv-dropdown-border-radius`, `--dv-tab-close-icon-size`, `--dv-floating-titlebar-height`, `--dv-edge-drop-strip-size`, the tab group colours and chip sizes, and others). Only some of them have a fallback in dockview's rules, so `agide-dock` starts from a copy of the first `.dockview-theme-dark` block of the 8.9.0 stylesheet and overrides it with the table above.

Tabs: leading surface icon (`icon.sm`), title (`type.small` weight 500), an icon-only status chip when the bound surface is busy, waiting or failed, and a close IconButton (`x`, 16 px) that shows on hover, on the active tab and on keyboard focus. Min width 80 px, max 220 px, ellipsis, Tooltip with the full title. The active tab of the focused group has a 2 px `accent.text` line at its top edge (inset shadow); the visible tab of an unfocused group has the content colour without the line. That shows which group holds focus without a heavy outline. Tabs get a `:focus-visible` ring drawn inset (V-06).

Tab titles: the bound node's title for surface hosts (for example "Fix upload retry"), otherwise the pane title from the block manifest ("Tree", "Inbox", "Usage", "Agent history"); never an id (V-11).

Splitters: 1 px visible line (`border.default`, from `--dv-separator-border`) over dockview's 4 px sash, which is the hit area; after 150 ms of hover or during a drag the sash fills with `accent.text` (dockview fills the whole sash, so the active line is 4 px; a 2 px line needs an override of `.dv-sash` in `dock-theme.css`). Drop targets: the dockview overlay tinted `accent.text` at 14% with a 2 px `accent.text` border and `radius.md`.

#### 3.4 Pane chrome

The dock tab carries the pane title. A pane that has actions shows a pane toolbar below the tab strip: `density.toolbar` high, `surface.content` with a 1 px `border.subtle` bottom line, Toolbar component. Examples: the terminal (status chip, then quiet buttons), the inbox (counts and the Open and Done SegmentedControl), the browser (3.6). Panes without actions show no toolbar.

#### 3.5 Tree

| Part | Value |
|---|---|
| Row height | `density.row` (24 px regular) |
| Row inset | 4 px from each pane edge; rows have `radius.sm` (macOS source list look) |
| Indent per level | 14 px |
| Disclosure | 16 px slot with `chevron-right` `icon.xs` in `text.secondary`, rotated 90 degrees when open (`motion.fast`; no rotation animation under reduced motion). Leaves keep the empty slot so icons line up |
| Icon | 16 px slot, `icon.md`, `text.secondary`, `space.1_5` gap to the title |
| Title | `type.body`, `text.primary`, takes the flexible width, ellipsis, Tooltip with the full title (V-05) |
| Trailing area | Status icon (icon-only chip, `icon.sm`), then the rate (`type.caption`, tabular, `text.secondary`), then the usage meter (3.5 below). The type label ("Claude session") is removed; the icon carries the type and the Tooltip and `aria-label` name it |
| Truncation order | Container queries on the pane: under 260 px the rate hides; under 200 px only the status icon stays. The title is never the first part to shrink |
| Hover | `surface.hover` |
| Selected | `selection` (focused tree) or `selection.inactive`; text stays `text.primary` |
| Focus | 2 px `focus.ring` inset ring, independent of the selection fill |
| Drop target (into a folder) | `accent.subtle` fill with 1 px `accent.text` outline |
| Drag line (between rows) | 2 px `accent.text` line with a 6 px open circle at its start, indented to the target level |
| Rename | Field inline, height = row height minus 2 px |
| Empty folder | "(empty)" becomes `text.tertiary` `type.small` without italics |

Usage meter: a row of 3 by 10 px bars with 1 px gaps, drawn in SVG. Level 1 fills one bar in `text.secondary`, level 2 fills two in `warning.fg`, level 3 fills three in `danger.fg`; `aria-label` "Usage: low, medium or high". The number of filled bars carries the level, so it does not depend on colour (V-12).

Agent rows below a session: `density.row` minus 2 px, `bot` icon `icon.sm`, name `type.small`, status chip with label when there is room, failure reason in `text.secondary`; dismiss becomes a Danger quiet IconButton (`x`) shown on hover and focus, inside the pane (V-01).

#### 3.6 Browser tab chrome

Pane toolbar (`density.toolbar`), left to right: IconButtons `arrow-left`, `arrow-right`, `rotate-cw` (becomes `x` while loading, labelled "Stop"); the address field (Field, `surface.inset` in dark and `surface.content` with `border.default` in light, `radius.md`) with the service chip inside it at the left (neutral chip with `globe` and "Web"), the host in `text.primary` and the rest of the URL in `text.secondary`; the observation control (IconButton `eye`, `eye-off` when off, plus the `info` chip "Live" when live); IconButton `external-link` named "Open in Chrome"; IconButton `ellipsis` for the tab menu (Radix DropdownMenu). The arrow glyphs on different baselines and the text ellipsis go away.

When an agent drives the tab: a 2 px `warning.fg` outline around the page area and a warning Banner above it with the `bot` icon, a single sentence ("An agent wants to open staging.example.test") and the actions Deny (secondary), Allow once (primary), and a menu button for "Allow for this session" and "Always allow this site" (V-13).

#### 3.7 Terminal

- The xterm theme is built from the terminal tokens: `background`, `foreground`, `cursor`, `cursorAccent`, `selectionBackground` (`terminal.selection`), `selectionInactiveBackground`, the ANSI colours, and `scrollbarSliderBackground`, `scrollbarSliderHoverBackground`, `scrollbarSliderActiveBackground` from `scrollbar.thumb` at rising strengths.
- Options: `fontFamily` = `font.mono`, `fontSize` 13, `lineHeight` 1.2, `minimumContrastRatio` 4.5, `cursorStyle` block, `cursorBlink` true except under reduced motion.
- The terminal reads the theme from one theme store in the renderer, the same store the CSS tokens come from. The media query listeners in `TerminalPane.tsx` and `SessionPeek.tsx` go away; the peek in the inbox uses the same theme as the window (V-08).
- Padding 8 px by 12 px inside the pane, `surface.content` around it, so the terminal and the pane are one surface.

#### 3.8 Dialogs

- Radix Dialog with `aria-modal`, inert background, focus trap, Escape and focus return; this replaces the hand maintained `FOCUSABLE` list (V-07).
- Initial focus goes to the first field, which shows its `focus.ring` ring (text fields always do while focused, 7.3); in the accent colour it reads as the macOS field focus ring.
- Fields stack, label above field, `space.3` between fields, `space.5` between groups. Long values (repository paths) use `type.mono` in the field.
- Footer: buttons at the right, Cancel (secondary) then the primary action, `space.2` gap; Enter triggers the primary action outside text areas. An error from the action shows as a danger Notice above the footer (V-15), and the dialog keeps the field values.
- Settings becomes a 640 px dialog with sections separated by `space.6` and a `type.body-strong` heading; each field has its own block (V-04). The body scrolls with a 1 px `border.subtle` line under the header and above the footer when there is more content, so the scroll is visible.
- Entry: opacity 0 to 1 and scale 0.98 to 1 in `motion.slow` with `ease.enter`; reduced motion: opacity only, `motion.fast`.

#### 3.9 Inbox

- List row: a two-line block in a `density.pad` by `space.3` padding. Line 1: an 8 px unread dot (`accent.text`) in a fixed left gutter, so rows do not shift when read (V-14); kind icon and kind name; the path in `type.small` `text.secondary` with ellipsis; the time in `type.caption` `text.tertiary` at the right. Line 2: the title in `type.body` (600 while unread, 400 once read). Hover, selection and focus as in the tree.
- Header: pane toolbar with "Inbox" in `type.body-strong`, the counts in `type.small` `text.secondary` ("7 unread · 1 needs an answer" with the needs-answer part as a warning chip), and the Open and Done SegmentedControl at the right on the same row (the empty inbox capture showed the buttons wrapping to a second row).
- Card (detail pane): Card component without the outer border, on `surface.content`. Header: kind label, title in `type.title`, meta line path and time. Body: `type.body` with a 72 character measure. Raw request: a collapsed "Details" disclosure (`chevron-right`) over a `surface.inset` block in `type.mono`, shown once (V-14). Actions: the primary action by kind (for an approval, "Open session to answer"; for a failure, "Open session"), then Done (secondary), then a "Snooze" Button with a menu of the snooze times, then "Mark unread" as quiet. Peek: side by side, with the terminal theme of the window.
- Empty: EmptyState with `inbox` icon, "Nothing waits for you", no action.

### 4. Icons

One set: Lucide (`lucide-react`, ISC; the Feather-derived icons carry an MIT notice, which goes into `NOTICE`). The audit found no problem with it. Names below were checked against the icon list of the 1.77.0 release (`lucide-static` `tags.json`); several older names (`alert-triangle`, `trash-2`, `history`, `help-circle`) do not exist in that release and are not used.

| Meaning | Icon |
|---|---|
| Folder, open folder | `folder`, `folder-open` |
| Claude session | `square-terminal` |
| Browser tab | `globe` (a site favicon may replace it later, at 16 px) |
| Agent | `bot` |
| Task | `list-todo` |
| Note | `sticky-note` |
| Inbox | `inbox` |
| Usage | `gauge` |
| Agent history | `rotate-ccw-clock` |
| Settings | `settings` |
| Layout switcher | `layout-dashboard` |
| Profile add | `plus` |
| Disclosure | `chevron-right`; menus and selects `chevron-down` |
| Busy, waiting, failed, done, idle, exited | `loader-circle`, `message-circle-question-mark`, `circle-x`, `circle-check`, `circle-dashed`, `square` |
| Approval, reminder, alert, failure, update | `shield-question-mark`, `alarm-clock`, `triangle-exclamation-point`, `octagon-x`, `message-square-text` |
| Banner tones info, success, warning, danger | `info`, `circle-check`, `triangle-exclamation-point`, `circle-exclamation-point` |
| Back, forward, reload, stop | `arrow-left`, `arrow-right`, `rotate-cw`, `x` |
| Observation on, off, live | `eye`, `eye-off`, `radio` |
| Open in Chrome, more | `external-link`, `ellipsis` |
| Close, dismiss | `x` |
| Remove | `trash` |
| Rename, copy, search, undo | `pencil`, `copy`, `search`, `undo-2` |
| Trust, permission mode | `shield-check`, `lock` |
| Theme light, dark, system | `sun`, `moon`, `monitor` |
| Theme picker | `palette` |

Rules:

- Sizes from 1.5; icons take `currentColor`, so they follow the text token of their context.
- Every icon is `aria-hidden` and sits next to visible text, or its control carries an `aria-label` and a Tooltip with the same words. No icon-only control without a name.
- No meaning by colour alone: each status has its own shape and, where room allows, its word. The selected row has a fill and, when the OS asks to differentiate without colour (`nativeTheme.shouldDifferentiateWithoutColor`), a 2 px `text.primary` bar at its left edge as well.
- Icons are imported by name (`import { Folder } from 'lucide-react'`), so the bundle holds the used icons only. One module, `ui/icons.ts`, maps meanings (surface types, statuses, kinds, actions) to icons, so a pane never picks an icon by itself and the mapping has one test.

### 5. Themes as data

#### 5.1 Theme file

```json
{
  "schema": 1,
  "id": "my-dark",
  "name": "My Dark",
  "kind": "dark",
  "extends": "agide-dark",
  "tokens": {
    "surface.window": "#1c1c1f",
    "text.primary": "#f0f0f4",
    "accent": "#2f6fd0"
  },
  "increasedContrast": { "text.secondary": "#d4d4dc" },
  "dock": { "--dv-tab-font-size": "12px" },
  "terminal": { "red": "#ff7a70" },
  "source": { "kind": "user" }
}
```

| Field | Rule |
|---|---|
| `schema` | Integer, 1. A newer number is refused with `schema_version_unsupported` |
| `id` | Lower case `[a-z0-9-]`, 3 to 48 characters, unique among built-in and user themes of the profile |
| `name` | 1 to 64 characters, shown in the picker |
| `kind` | `light`, `dark` or `system`. A `system` theme has `light` and `dark` objects, each with `tokens` (and optional `increasedContrast`, `dock`, `terminal`), in place of a single `tokens` |
| `extends` | Optional id of a built-in theme of the same kind (`agide-light` or `agide-dark`). Missing tokens come from it. Without `extends`, every required token must be present |
| `tokens` | Map from token key (section 1) to a colour (`#rgb`, `#rrggbb`), a length (`px`), a duration (`ms`) or a font stack, by key type. Computed tokens (`surface.hover`, `surface.pressed`, `scrollbar.thumb`) cannot be set |
| `increasedContrast` | Optional token overrides used when the OS asks for more contrast; without it, the built-in overrides of 7.2 apply |
| `dock` | Optional map of `--dv-*` variables to values; only the variable names listed in the dockview 8.9.0 stylesheet are accepted |
| `terminal` | Optional xterm `ITheme` fields; they override the `terminal.*` tokens |
| `license` | Required unless `source.kind` is `builtin` or `user` with no `source.url`: `spdx` (an SPDX id or `"LicenseRef-unknown"`), `copyright`, `text` (the full license text, kept with the theme) |
| `source` | `kind`: `builtin`, `user`, `vscode-file` or `open-vsx`. For imports also `name` (theme label in the extension), `extension` (`publisher.name`), `version`, `url`, `sha256` of the source file, `importedAt`, `importer` (Agide version) and `adjustments` (list of `{ token, from, to, reason }` from the contrast clamp) |

The schema is a zod schema in `app/src/core/theme/schema.ts` (electron-free core, like the layout schema of 0020). The same schema produces the TypeScript types, the JSON Schema that `theme_get` returns and a `docs/themes.md` reference checked by a unit test, as `pnpm parity` does for the parity table.

#### 5.2 Where themes live

- Built-in: `app/src/core/theme/builtin/` holds `system.json`, `agide-light.json`, `agide-dark.json`, `github-dark-default.json`, `catppuccin-mocha.json`. They ship inside the app and cannot be changed by the user or an agent; "Duplicate" makes an editable user copy.
- User: `<profile data directory>/themes/<id>.json`, one file per theme, license text inside the file. Imports write here.
- Choice: the profile setting `appearance.themeId` (default `system`), with `appearance.density` (default `regular`), `appearance.zoom` (default 100) and `appearance.vibrancy` (default off). Per profile, as 0032 decided.
- Hot reload: a change to a user theme file on disk is validated and applied like the layout file (0020); an invalid file leaves the current theme in place and shows a danger Banner with the errors.

#### 5.3 Validation errors

Every error has `code`, `path` (JSON pointer), `message` (one sentence) and `hint` (what to change), so an agent can fix the file without reading the source.

| Code | Example message and hint |
|---|---|
| `invalid_json` | "The file is not valid JSON at line 12, column 4." Hint: the parser message |
| `schema_version_unsupported` | "Theme schema 2 is newer than this app reads (1)." Hint: update Agide or use schema 1 |
| `missing_field` | "`/name` is required." |
| `unknown_token` | "`/tokens/surface.panel` is not a token." Hint: the closest token names (`surface.sidebar`, `surface.content`) |
| `computed_token` | "`/tokens/surface.hover` is computed from `text.primary` and cannot be set." |
| `invalid_value` | "`/tokens/accent` must be a hex colour; got `blue`." |
| `missing_token` | "`/tokens/text.primary` is required when `extends` is absent." |
| `unknown_dock_variable` | "`/dock/--dv-foo` is not a dockview 8.9 variable." |
| `id_conflict` | "A theme with id `agide-dark` exists." Hint: choose another id, or `theme_apply` the existing one |
| `license_missing` | "`/license` is required for an imported theme." |
| `include_unsupported` | "The VS Code theme uses `include`, which the importer does not read." Hint: import the included file, or a theme without `include` |
| `contrast_below_target` (warning) | "`text.secondary` on `surface.sidebar` is 3.46 to 1; target 4.5." Hint: the adjusted value the clamp would use. Built-in themes treat this as an error in tests |

#### 5.4 Commands

All are registry commands with `mcp: true`, so the parity rule of 0013 covers them: the theme picker in Settings and the View menu call the same commands, and `docs/parity.md` lists them. No UI action changes the theme without a command.

| Command | Input | Result and effect |
|---|---|---|
| `theme_list` | none | Themes of the profile: `id`, `name`, `kind`, `source.kind`, `license.spdx`, `active` |
| `theme_get` | `id` (default: active) | The document, the resolved token values for the current appearance and OS settings, the contrast report, and the JSON Schema |
| `theme_validate` | a document | Errors and warnings as in 5.3, and the clamp adjustments; changes nothing |
| `theme_preview` | `id` or a document, `windowId` (default: the caller's window) | Applies the theme to that window only, without saving. A notice bar shows "Previewing <name>" with Keep and Revert. The preview reverts on Revert, on Escape in the notice, on a window close or after 60 s without Keep. Returns a `previewId` |
| `theme_apply` | `id` or a `previewId`, `expectedRevision` | Saves `appearance.themeId` for the profile, as a new revision of the appearance settings (same revision and history model as layouts in 0020). Refuses a stale revision with `invalid_input`. Shows a notice with Undo. Returns the new revision and an undo reference |
| `theme_undo` | optional revision | Applies the previous revision as a new one, so an undo can be undone |
| `theme_import` | `path` of a VS Code theme JSON or `.vsix`, or an Open VSX reference `{ namespace, name, version, themeLabel }` | Runs the mapping of section 6, writes a user theme, returns it with the license and the adjustments. Open VSX access needs the user's approval in the UI (outward network action under 0028); the file route does not |

An agent proposes a theme with `theme_preview`; the user sees it in place and keeps it or not. `theme_apply` from an agent is a rung A change like a layout change (0020): validator, notice, undo, and an entry in the daily digest.

### 6. VS Code import

#### 6.1 Mapping

The importer reads only the `colors` map. Steps: resolve each token from the keys in order; composite any alpha colour over the surface it sits on (the "over" column); derive what is still missing; then run the contrast clamp (6.2). `content` is `surface.content`, `primary` is `text.primary`, "mix(a, b, n%)" is an sRGB mix of n% of b into a.

| Token | VS Code keys in order | Composited over | Derived when all are missing |
|---|---|---|---|
| `surface.content` | `editor.background` | | required: the import fails with `missing_token` |
| `text.primary` | `foreground`, `editor.foreground` | content | required |
| `surface.window` | `titleBar.activeBackground`, `activityBar.background`, `editorGroupHeader.tabsBackground` | content | mix(content, black, 4%) for light, mix(content, black, 15%) for dark |
| `surface.sidebar` | `sideBar.background` | content | content |
| `surface.raised` | `editorWidget.background`, `dropdown.background` | content | mix(content, primary, 4%) |
| `surface.overlay` | `menu.background`, `editorWidget.background` | content | raised |
| `surface.inset` | `input.background` | content | mix(content, black, 6%) |
| `text.secondary` | `descriptionForeground`, `tab.inactiveForeground` (a value equal to `text.primary` is treated as missing) | content | mix(primary, content, 30%) |
| `text.tertiary` | `input.placeholderForeground` | inset | mix(primary, content, 45%) |
| `text.link` | `textLink.foreground`, `focusBorder` | | `accent.text` |
| `border.default` | `panel.border`, `sideBar.border`, `contrastBorder` (a fully transparent value counts as missing) | content | mix(content, primary, 16%) |
| `border.subtle` | | | mix(content, primary, 8%) |
| `border.strong` | `input.border`, used only when it reaches 3 to 1 against content | content | mix(content, primary, 45%) |
| `accent` | `button.background`, `activityBarBadge.background`, `focusBorder` | content | Agide accent of the same kind |
| `accent.on` | `button.foreground`, `activityBarBadge.foreground` | accent | white or `#1d1d1f`, whichever has more contrast |
| `accent.hover` | `button.hoverBackground` | content | mix(accent, black, 8%) |
| `accent.active` | | | mix(accent, black, 16%) |
| `accent.text` | `textLink.foreground`, `focusBorder` | content | accent |
| `accent.subtle` | | | mix(content, accent.text, 14% light, 20% dark) |
| `focus.ring` | `focusBorder` | content | accent.text |
| `selection` | `list.activeSelectionBackground` | sidebar | mix(sidebar, accent, 25%) |
| `selection.inactive` | `list.inactiveSelectionBackground` | sidebar | mix(sidebar, primary, 10%) |
| `danger.fg` | `errorForeground`, `editorError.foreground`, `notificationsErrorIcon.foreground` | content | Agide value of the same kind |
| `warning.fg` | `editorWarning.foreground`, `notificationsWarningIcon.foreground`, `charts.yellow` | content | Agide value |
| `info.fg` | `editorInfo.foreground`, `notificationsInfoIcon.foreground`, `textLink.foreground` | content | Agide value |
| `success.fg` | `testing.iconPassed`, `gitDecoration.addedResourceForeground`, `charts.green` | content | Agide value |
| `*.bg` of each status | | | mix(content, status fg, 16%) |
| `danger.fill` | | | danger.fg, clamped for white text |
| `tooltip.bg` | `editorHoverWidget.background` | content | primary |
| `shadow.*` | `widget.shadow` for the colour part | | Agide shadows of the same kind |
| `kind` | theme `type`, else the extension's `uiTheme` (`vs` light, `vs-dark` dark, `hc-black` dark with `increasedContrast`, `hc-light` light with `increasedContrast`), else the luminance of `editor.background` (under 0.18 is dark) | | |

Terminal: `terminal.background`, then `panel.background`, then `editor.background` (neither candidate defines `terminal.background`); `terminal.foreground`, then `foreground`; `terminalCursor.foreground`, then the foreground; `terminal.selectionBackground` composited over the terminal background, then `selection`; `terminal.ansiBlack` to `terminal.ansiWhite` to the base colours and `terminal.ansiBrightBlack` to `terminal.ansiBrightWhite` to the bright colours; a missing ANSI colour takes the Agide value of the same kind. `minimumContrastRatio: 4.5` stays on for imported palettes.

This fallback chain is our choice. How VS Code itself fills missing keys was not read (audit 4.1); the importer's result is checked by rendering both ports in `pnpm visual-check` (section 8).

#### 6.2 Contrast clamp

After mapping, each checked pair of the contrast table is measured. A text or icon colour that misses its target moves toward white (dark themes) or black (light themes) in 2% steps until it passes against every surface of its rows, the selection colours included; an `accent` that fails with `accent.on` moves away from it in the same way. Each change is stored in `source.adjustments` and listed in the import dialog, with the original values one click away. The user can keep the original values; the theme then carries `contrast_below_target` warnings and the picker shows a "Low contrast" chip next to its name. Built-in themes, including the ports, must pass with no warnings.

#### 6.3 `--vscode-*` aliases

The theme layer publishes `--vscode-*` variables for `@vscode-elements/elements` and for any future webview content. For an imported theme each alias carries the original VS Code value when the key exists (after the clamp, if it moved), else the token below. For Agide themes the token value is used. This covers every variable the 2.5.1 package reads (read from its `dist` files):

| Alias | Token |
|---|---|
| `--vscode-font-family`, `--vscode-font-size`, `--vscode-font-weight` | `font.ui`, 13px, 400 |
| `--vscode-editor-font-family`, `--vscode-editor-font-size`, `--vscode-editor-font-weight` | `font.mono`, 12px, 400 |
| `--vscode-foreground`, `--vscode-editor-foreground`, `--vscode-icon-foreground`, `--vscode-menu-foreground`, `--vscode-sideBarTitle-foreground`, `--vscode-panelTitle-activeForeground`, `--vscode-settings-textInputForeground`, `--vscode-settings-dropdownForeground`, `--vscode-checkbox-foreground`, `--vscode-settings-checkboxForeground`, `--vscode-list-hoverForeground`, `--vscode-inputOption-activeForeground`, `--vscode-editor-inlineValuesForeground` | `text.primary` |
| `--vscode-panelTitle-inactiveForeground` | `text.secondary` |
| `--vscode-input-placeholderForeground` | `text.tertiary` |
| `--vscode-editor-background`, `--vscode-panel-background`, `--vscode-panel--background` (the double dash is how the 2.5.1 package spells it), `--vscode-keybindingTable-rowsBackground` | `surface.content` |
| `--vscode-sideBar-background`, `--vscode-sideBarSectionHeader-background`, `--vscode-keybindingTable-headerBackground` | `surface.sidebar` |
| `--vscode-menu-background` | `surface.overlay` |
| `--vscode-settings-textInputBackground`, `--vscode-settings-dropdownBackground`, `--vscode-settings-checkboxBackground`, `--vscode-checkbox-background` | `surface.content` (light), `surface.inset` (dark) |
| `--vscode-settings-textInputBorder`, `--vscode-settings-dropdownBorder`, `--vscode-settings-checkboxBorder`, `--vscode-checkbox-border`, `--vscode-settings-dropdownListBorder` | `border.strong` |
| `--vscode-editorGroup-border`, `--vscode-editorWidget-border`, `--vscode-menu-border`, `--vscode-settings-headerBorder`, `--vscode-contrastBorder` | `border.default` |
| `--vscode-menu-separatorBackground`, `--vscode-tree-indentGuidesStroke` | `border.subtle` |
| `--vscode-tree-inactiveIndentGuidesStroke` | `border.subtle` at 50% |
| `--vscode-focusBorder`, `--vscode-list-focusOutline`, `--vscode-list-focusAndSelectionOutline`, `--vscode-toolbar-hoverOutline`, `--vscode-menu-selectionBorder`, `--vscode-inputOption-activeBorder` | `focus.ring` |
| `--vscode-button-background`, `--vscode-progressBar-background`, `--vscode-menu-selectionBackground`, `--vscode-panelTitle-activeBorder`, `--vscode-sash-hoverBorder` | `accent` (the last two: `accent.text`) |
| `--vscode-button-foreground`, `--vscode-menu-selectionForeground` | `accent.on` |
| `--vscode-button-hoverBackground` | `accent.hover` |
| `--vscode-button-border`, `--vscode-button-separator` | transparent, `accent.on` at 40% |
| `--vscode-button-secondaryBackground`, `--vscode-button-secondaryForeground`, `--vscode-button-secondaryHoverBackground` | `surface.raised`, `text.primary`, `surface.raised` mixed with `text.primary` 4% |
| `--vscode-badge-background`, `--vscode-badge-foreground`, `--vscode-activityBarBadge-background`, `--vscode-activityBarBadge-foreground` | `accent`, `accent.on` |
| `--vscode-list-activeSelectionBackground`, `--vscode-list-activeSelectionForeground`, `--vscode-list-activeSelectionIconForeground` | `selection`, `text.primary`, `text.primary` |
| `--vscode-list-inactiveSelectionBackground` | `selection.inactive` |
| `--vscode-list-hoverBackground`, `--vscode-toolbar-hoverBackground` | `surface.hover` |
| `--vscode-toolbar-activeBackground`, `--vscode-inputOption-activeBackground` | `surface.pressed`, `accent.subtle` |
| `--vscode-list-highlightForeground`, `--vscode-list-focusHighlightForeground` | `accent.text` |
| `--vscode-inputValidation-errorBorder`, `--vscode-inputValidation-errorBackground` | `danger.fg`, `danger.bg` |
| `--vscode-scrollbarSlider-background`, `--vscode-scrollbarSlider-hoverBackground`, `--vscode-scrollbarSlider-activeBackground`, `--vscode-scrollbar-shadow` | `scrollbar.thumb` at rising strengths, transparent |
| `--vscode-widget-shadow` | the colour part of `shadow.2` |

#### 6.4 What is ignored

- `tokenColors`, `semanticHighlighting` and `semanticTokenColors`: Agide has no code editor today. They are kept unread in the stored source hash only; a later editor or diff view can read them.
- `include`: refused with `include_unsupported` (the key is not covered by the VS Code docs read for the audit).
- Workbench keys with no Agide counterpart (minimap, breakpoints, debug, merge, notebook, chat and others): ignored without warning.
- Icon themes, product icon themes and any extension code: never read. A `.vsix` is opened as a zip; only `extension/package.json` (for `contributes.themes`), the theme JSON named there and the license file are read.

#### 6.5 License and source

- The importer requires a license: the `license` file of the extension (`.vsix` or Open VSX `files.license`), or for a bare JSON file a license the user picks or types in the import dialog (`LicenseRef-unknown` is allowed for personal use and shows a chip "License unknown").
- The import dialog shows the license name, the copyright line and the full text in a scroll area before Keep. The theme picker shows the license and the source in the theme's detail line ("MIT · GitHub/github-vscode-theme 6.3.5").
- Ported built-in themes carry the full MIT text in `license.text`, and `NOTICE` gets an entry for each (copyright line, source repository, "ported to the Agide theme format, with contrast adjustments").
- Names: the label reads "GitHub Dark Default (port)", because the GitHub trademark is not licensed by the MIT text (audit 4.5). "Catppuccin Mocha" keeps its name.

#### 6.6 Open VSX route

- The VS Code Marketplace is excluded (its terms limit its content to Microsoft products; audit 4.4).
- Open VSX offers metadata (`GET /api/{namespace}/{extension}`), a `license` field and a license file per version, and file download. The sources read for the audit give no explicit rule on use by an application other than an editor. Until a written answer from the Eclipse Foundation (the FAQ lists a license contact) allows it, Agide does not ship an in-app theme browser. The import accepts an Open VSX reference only through an explicit user action in the import dialog: one metadata request and one package download per import, no personal data, no background refresh, and the result is cached in the profile. The default import route is a local file the user picked.
- The ported built-ins do not depend on Open VSX at run time; they ship as Agide theme files.

#### 6.7 The ported themes

Both are MIT (copyright 2020 Primer, and copyright 2021 Catppuccin), read from the `LICENSE.txt` in the extension packages (GitHub `github-vscode-theme` 6.3.5 and Catppuccin `catppuccin-vsc` 3.19.0 from Open VSX) and in the repositories (audit 4.5). The GitHub port uses "GitHub Dark Default" (`themes/dark-default.json`, editor background `#0d1117`), the newer of the GitHub dark themes. Values below are the output of the mapping in 6.1 on those files, with the clamp of 6.2. The first scratch run checked fewer surfaces; a review re-ran every pair of 1.8 on these values (the selection and the inset included), and the values marked "clamped" with a ratio are the ones that review moved. Unlisted tokens (`accent.subtle`, `danger.fill`, `tooltip.bg`, hover and active fills) follow the derivations of 6.1 and are checked by the unit test of 8.3.

| Token | GitHub Dark Default (port) | Catppuccin Mocha |
|---|---|---|
| `surface.window` | `#0d1117` | `#11111b` |
| `surface.sidebar` | `#010409` | `#181825` |
| `surface.content` | `#0d1117` | `#1e1e2e` |
| `surface.raised` | `#161b22` | `#181825` |
| `surface.overlay` | `#161b22` (no `menu.background`; from `editorWidget.background`) | `#1e1e2e` |
| `surface.inset` | `#0d1117` | `#313244` |
| `text.primary` | `#e6edf3` | `#cdd6f4` |
| `text.secondary` | `#949ba4` (clamped from `#7d8590`) | `#999fb9` (derived: `descriptionForeground` equals the foreground) |
| `text.tertiary` | `#949aa2` (clamped from `#6e7681`; the selection `#2d3239` sets the limit, so tertiary and secondary end up nearly the same colour; a lower selection tint in the port would keep them apart) | `#989bad` (clamped from `#cdd6f473` over the inset) |
| `text.link`, `accent.text` | `#2f81f7` | `#89b4fa` |
| `accent`, `accent.on` | `#238636`, `#ffffff` (GitHub's green primary button) | `#cba6f7`, `#11111b` |
| `accent.hover` | `#278638` (clamped from `#2ea043`, which carries white text at 3.37; it ends close to the rest fill, so hover on the GitHub primary button is hard to see, an open point for step 5) | `#dec7fa` |
| `focus.ring` | `#2c78ec` (clamped from `#1f6feb`, 2.79 on the selection) | `#cba6f7` |
| `border.default` | `#30363d` | `#585b70` |
| `border.strong` | `#6f747a` (derived; `input.border` is under 3 to 1) | `#797c91` (derived `#6d7187`, clamped: 2.61 on the inset; `input.border` is transparent) |
| `selection`, `selection.inactive` | `#2d3239` (from `#6e768166` over the sidebar) | `#313244` |
| `danger.fg`, `warning.fg`, `info.fg`, `success.fg` | `#f96d66` (clamped from `#f85149`, 3.85 on the selection), `#d29922`, `#599af9` (clamped from `#2f81f7`, 3.75 on the selection), `#3fb950` | `#f38ba8`, `#fab387`, `#89b4fa`, `#a6e3a1` |
| Status backgrounds (mix 16%) | `#332024`, `#2d2719`, `#19273b`, `#152c20` | `#402f42`, `#41363c`, `#2f364f`, `#343e40` |
| `terminal.background` | `#010409` (from `panel.background`) | `#1e1e2e` (from `panel.background`) |
| ANSI 0 to 7 | `#484f58 #ff7b72 #3fb950 #d29922 #58a6ff #bc8cff #39c5cf #b1bac4` | `#45475a #f38ba8 #a6e3a1 #f9e2af #89b4fa #f5c2e7 #94e2d5 #a6adc8` |
| ANSI 8 to 15 | `#6e7681 #ffa198 #56d364 #e3b341 #79c0ff #d2a8ff #56d4dd #ffffff` | `#585b70 #f37799 #89d88b #ebd391 #74a8fc #f2aede #6bd7ca #bac2de` |
| Primary on content | 16.02 | 11.34 |

The Catppuccin inactive tab pair the audit flagged (3.59 to 1) does not reach the screen: dock tabs use `text.secondary`, which the mapping and the clamp keep at 4.5 or more against every surface. The ports are dark only; GitHub Light Default and Catppuccin Latte can follow with the same mapping.

### 7. Accessibility and platform

#### 7.1 The System theme

System is the default theme (0032). It is Agide Light or Agide Dark, chosen by the OS appearance, with the OS accent and the OS accessibility settings applied. A small adapter in the main process (`app/src/main/appearance.ts`, macOS only today) reads the sources and sends one `appearance` message to every window; the renderer turns it into tokens. A Windows or Linux adapter would send the same message.

| Input | Source | Effect |
|---|---|---|
| Light or dark | `nativeTheme.shouldUseDarkColors` with `themeSource: 'system'`, re-read on `nativeTheme` `updated` | Base values of Agide Light or Agide Dark; `color-scheme` on `:root`; dock `colorScheme`. `themeSource` is one value for the whole app, so it stays `system`: a window whose profile picks a fixed light or dark theme sets `color-scheme` on its own `:root` (scrollbars and form controls follow), while native parts (window frame, traffic lights, native menus) keep following the OS |
| Accent | `systemPreferences.getAccentColor()` (`RRGGBBAA`, alpha dropped), re-read on `systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification')`. Not the CSS `AccentColor` (fixed blue in Chromium 156), not `accent-color-changed` (not emitted on macOS) | See the derivation below |
| Increased contrast | `nativeTheme.shouldUseHighContrastColors`; `prefers-contrast: more` also applies the rule if Chromium maps it (probe) | The overrides of 7.2 |
| Reduce transparency | `nativeTheme.prefersReducedTransparency` | Vibrancy off; overlays and the backdrop opaque, no `backdrop-filter` |
| Reduce motion | `prefers-reduced-motion: reduce` in the renderer | Section 1.7 |
| Differentiate without colour | `nativeTheme.shouldDifferentiateWithoutColor` | Selection bar of section 4; chips always show their label where it fits |

Accent derivation (checked by the script, table in 1.8):

1. `accent` = the OS accent moved toward black in 2% sRGB steps until white text reaches 4.5 to 1. `accent.on` is white.
2. `accent.hover` = `accent` mixed with black 8%; `accent.active` 16%.
3. `accent.text` = the OS accent moved toward black (light) or white (dark) until it reaches 4.5 to 1 on every surface that carries links or accent text (`surface.sidebar`, `surface.content`, `surface.raised`, `surface.overlay`) and 3 to 1 where it is only a mark (`surface.window` for the tab line, the derived `selection` for the unread dot and the focus ring). `focus.ring` and `text.link` use it. In dark themes the lighter `raised` and `overlay` set the limit: blue needs 24%, not the 6% that `surface.content` alone would ask.
4. `accent.subtle` = mix(`surface.content`, `accent.text`, 14% light, 20% dark), lowered in 2% steps until `text.primary` and `accent.text` keep 4.5 to 1 on it.
5. `selection` = mix(`surface.sidebar`, OS accent, 18% light, 30% dark), lowered in 2% steps until `text.tertiary` and every status foreground keep 4.5 to 1 on it (rows show status icons on the selection; with `text.tertiary` alone, `danger.fg` drops to 4.45 on the light red selection). It is computed before step 3. `selection.inactive` stays the neutral grey.
6. The status colours never take the accent. When the accent is too close in hue to a status colour (red to danger, orange or yellow to warning, green to success), nothing changes: status chips always carry their icon and word.
7. When `getAccentColor()` fails or returns the multicolour default, the Agide accent is used. How macOS reports "Multicolour" through `getAccentColor()` is not verified.

For the sample macOS accents the clamp moves the colour between 0% and 46% (yellow needs the most: `#ffc600` becomes `#8f6f00` as a fill with white text and `#8a6b00` as text on the light surfaces; it stays `#ffc600` as text on the dark surfaces).

Surfaces do not follow the OS accent, except through `selection` and `accent.subtle`; macOS tints window backgrounds with the wallpaper only when vibrancy is on.

#### 7.2 Increased contrast

Applied over any theme, built-in or imported, unless the theme defines its own `increasedContrast` block.

| Token | Light override | Dark override | Lowest ratio over every surface and both selection colours |
|---|---|---|---|
| `text.primary` | `#000000` | `#ffffff` | 16.80 / 11.62 |
| `text.secondary` | `#3a3a40` | `#d4d4dc` | 9.04 / 7.88 |
| `text.tertiary` | `#47474e` | `#c6c6d0` | 7.37 / 6.85 |
| `border.default` (and `border.subtle` takes the old `border.default`) | `#7a7a83` | `#82828c` | 3.40 / 3.05 |
| `border.strong` | `#5e5e66` | `#a4a4ae` | 5.14 / 4.70 |
| `focus.ring` | `#004c9e`, 3 px | `#9cc8ff`, 3 px | 6.65 / 6.70 |

Also: hover fills double their percentage; selected rows get a 1 px `border.strong` outline; cards, menus and popovers get a 1 px `border.default` outline in place of the soft ring; shadows stay.

#### 7.3 Focus

- One ring: `focus.ring`, 2 px (3 px under increased contrast), `outline-offset: 2px` on buttons and fields, inset (`-2px`) on rows, tabs and menu items, drawn with `outline` so it follows `border-radius`.
- `:focus-visible` only. The ring does not show for a mouse click on buttons, rows, tabs and menu items; text fields show it whenever focused (browser rule). Tree rows draw their ring today from a focused-row attribute under `:focus-within` of the list, which shows after a click too; they move to a rule that applies only after keyboard navigation (the tree sets the attribute from key events, or the ring keys off `:focus-visible` on the list). Inbox rows and history table rows already use `:focus-visible`.
- Focus and selection are separate: a row can be selected without focus (fill only), focused without selection (ring only) or both.
- Every interactive element has a visible focus state, including dock tabs, rail tiles, chips that act as buttons and the splitters (focusable with arrow keys to resize, a dockview feature to confirm; else a later item).
- Focus order is checked by `focus-order.json` of `pnpm visual-check` against an expected order: title bar, rail, panes in layout order.

#### 7.4 Transparency and vibrancy

Vibrancy is off by default. The setting `appearance.vibrancy` turns on `setVibrancy('sidebar')` for the window, and the renderer then paints the tree, inbox list and rail with a transparent background (the content area and native browser views stay opaque). The setting has no effect, and shows why, while Reduce transparency is on. It is not part of the first slices; it needs the vibrancy probe of the audit (native views, dock drags, window focus) first.

#### 7.5 Text size

macOS Dynamic Type does not reach Electron apps. The profile setting `appearance.zoom` (90, 100, 110, 125, 150 percent) sets `webContents.setZoomFactor` for the window, which scales text, icons and spacing together; the terminal font follows. View menu: Zoom In (Cmd and +), Zoom Out (Cmd and -), Actual Size (Cmd and 0), each a registry command (`ui_zoom_set`) under the parity rule. Density (1.6) is a separate setting for row and control heights.

#### 7.6 Other rules

- Content text reflows at 200% zoom without horizontal scrolling inside panes; tree and inbox rows truncate with Tooltips.
- Every pane has an accessible name (its tab title); dialogs have titles; banners use `role="status"` or `role="alert"`.
- Scrollbars: overlay style in Chromium follows the macOS "Show scroll bars" setting through `color-scheme`; the thumb colour is `scrollbar.thumb`.

### 8. Migration

#### 8.1 Order of work

| Step | What changes | Files |
|---|---|---|
| 1. Tokens and the System theme | Theme schema, built-in Agide Light, Agide Dark and System files, the appearance adapter in main, the theme store in the renderer that writes `--agide-*` to `:root`, the old variables (`--bg`, `--fg`, `--pane-bg`, `--border`, `--muted`, `--accent`, `--focus`, `--danger`, `--warn`, `--ok`, `--select-bg`) defined as aliases of tokens so every pane keeps working, `system-ui` and `font: inherit` on form controls, the dock theme class, the terminal theme from tokens | New `core/theme/`, `main/appearance.ts`, `renderer/theme/`; changed `styles.css`, `layout/LayoutHost.tsx`, new `layout/dock-theme.css`, `panes/TerminalPane.tsx`, `panes/inbox/SessionPeek.tsx` |
| 2. Primitives and shared components | `radix-ui` and `lucide-react` added; `renderer/ui/` with Button, IconButton, Chip, Badge, Field, Select, Checkbox, RadioGroup, Switch, SegmentedControl, Tabs, Disclosure, Table, Card, Dialog, Menu, Popover, Tooltip, Banner, Notice, EmptyState, Toolbar and `icons.ts`; `DialogHost` and `DialogFrame` on Radix Dialog; `ContextMenu.tsx` and the browser tab menu on Radix menus; all with `useViewSuspension` | `renderer/ui/*`, `dialogs/DialogHost.tsx`, `dialogs/DialogFrame.tsx`, `dialogs/dialogs.css`, `panes/ContextMenu.tsx`, `styles.css` (`.btn-*`, `.chip` removed) |
| 3. Title bar and profile identity | `hiddenInset`, the merged title bar, the rail restyle, the profile strip and Layout bar removed | `main/window.ts`, `layout/layout.css`, `panes/ProfileRail.css`, `panes/ProfileRail.tsx`, `panes/ProfileStrip.tsx`, `panes/NewProfileForm.tsx`, `panes/SetupPane.tsx` |
| 4. Pane by pane | Tree (icons, rows, meter, truncation), agents rows, inbox list and card, browser chrome and banners, settings and task dialogs, usage pane, empty states, layout notice | `panes/TreePane.css` and `.tsx`, `panes/agents/agents.css`, `panes/inbox/InboxPane.css`, `panes/browser/browser.css`, `panes/browser/ObservationControl.tsx`, `panes/settings/settings.css`, `dialogs/task/task.css`, `panes/session/trustBanner.css` |
| 5. Import and the ported themes | VS Code mapping, clamp, `.vsix` reader, the import dialog, the theme picker, the `--vscode-*` alias layer, the GitHub Dark Default and Catppuccin Mocha ports, `NOTICE` entries, theme commands | `core/theme/vscode/*`, `renderer/theme/aliases.ts`, settings pane, `NOTICE` |

Steps 1 and 2 can overlap; steps 3 and 4 depend on 2. Each step ends with no colour literal left in the files it touched (checked by a lint rule that allows hex only in `core/theme/builtin/` and in tests).

#### 8.2 Before and after

- Each step starts and ends with `pnpm visual-check` (no `--only`, so every phase is in both sets), writing to a named directory per side with `--out`. The theme phase is added in step 1: every state in System light, System dark and increased contrast, and from step 5 one ported theme. Increased contrast cannot be switched on from a test through Electron (`shouldUseHighContrastColors` is read only), so the appearance adapter gets a test hook for it, the same hook the accent case of 8.3 uses.
- An independent visual reviewer (an agent that did not write the change, as in 0031) opens the after images first, lists defects against this record, then compares with the before images. Its list goes into the step's measurement file.
- The contrast script runs on each step, and on the built-in theme files from step 5.

#### 8.3 Tests

| Test | Kind | What it checks |
|---|---|---|
| Contrast | Unit (Vitest), from the logic of `notes/scripts/token-contrast.mjs` moved into `core/theme/contrast.ts` | Every pair of the table in 1.8 for every built-in theme and the increased contrast overrides; fails on a miss |
| Token set | Unit | Every token of section 1 is defined by each built-in theme (directly or through `extends`); no stylesheet reads an `--agide-*` name that does not exist (grep of the CSS against the token list) |
| Schema | Unit | Valid and invalid fixtures for each error code of 5.3, with the JSON pointer and hint |
| System derivation | Unit | The sample accents give the fills and text forms of the table; failure and multicolour fall back to the Agide accent |
| VS Code mapping | Unit | Fixtures cut from the ported theme files (colours only): each token's fallback order, alpha compositing, the derived values, the clamp adjustments listed in 6.7, terminal mapping, `kind` detection, `include` refusal |
| Aliases | Unit | Every `--vscode-*` name of 6.3 is defined for light and dark themes |
| Commands | Unit and e2e | `theme_preview` reverts on timeout and on Revert; `theme_apply` refuses a stale revision; `theme_undo` restores; parity table lists the commands |
| Follows the OS | Playwright e2e | With the app running, the test sets `nativeTheme.themeSource` to `dark`, then `light`, through `electronApp.evaluate` (the documented way to change what `shouldUseDarkColors` and `prefers-color-scheme` report). It asserts without a reload that `--agide-surface-content` on `:root` changes, the dock root has the dark scheme, and the xterm theme background equals the token. A second case sends a fake accent through the adapter's test hook and checks `--agide-accent` |
| Focus | e2e | Dialog traps and returns focus; menus open with the keyboard and close with Escape; `:focus-visible` ring present on a tab after Tab, absent after a click |
| Visual | `pnpm visual-check` | Before and after sets per step (8.2) |

The real macOS events (an appearance change in System Settings, an accent change, Increase contrast) cannot run in CI. They are covered by the probes of the audit, section 6, run once by hand and recorded.

#### 8.4 First slice for the next build run

Step 1 only, with these outcomes:

- `core/theme/` with the zod schema, `agide-light.json`, `agide-dark.json`, `system.json`, the contrast module and its tests (the table of 1.8 must pass).
- `main/appearance.ts` with `themeSource: 'system'`, the `updated` listener, `getAccentColor()` and the `AppleColorPreferencesChangedNotification` subscription, sending one message per change.
- The renderer theme store writing the tokens to `:root`, the old variables as aliases, `font: inherit` on controls, and the System accent derivation.
- The `agide-dock` theme class replacing `themeDark` and `themeLight`; the terminal and the peek themed from tokens with `minimumContrastRatio: 4.5`.
- The Playwright test that the theme follows an appearance change.
- `pnpm visual-check` before and after, and the independent review. Expected visible change: no amber focus ring (amber stays for "waiting" only), focus rings on buttons, tabs and rows only on keyboard focus (the shared rule in `styles.css` already uses `:focus-visible`; the tree row ring in `TreePane.css` changes as in 7.3, so that file joins step 1), the terminal dark in a dark window, readable muted text, the dock tabs in the new heights and colours. The layout of panes does not change in this slice.

## Consequences

- The look changes in every pane, so steps 3 and 4 touch most renderer stylesheets. The old variable names stay as aliases until step 4 ends, so the work can land in pieces without a broken state.
- Rough effort, low confidence: step 1 one to two days, step 2 two days, step 3 one day, step 4 two to three days, step 5 two days. This fits the 5 to 8 days of 0032 at its upper end, because of the component layer.
- New dependencies: `radix-ui` (MIT) and `lucide-react` (ISC, with the MIT notice for Feather-derived icons). `NOTICE` gains entries for Lucide and the ported themes. No codicons, so no CC-BY attribution.
- The contrast targets bind every future token change and every built-in theme through the unit test. Imported themes may stay below target only when the user keeps the original colours, and the picker says so.
- The title bar change removes the window title from the drawn UI; the profile name must stay in the title bar row, the rail Tooltip and the window title for the OS.
- 0032 is refined: the accent comes from `getAccentColor()` and a distributed notification, not from the CSS `AccentColor`; the monospace stack is explicit; the GitHub port is "GitHub Dark Default"; `theme_validate` and `theme_import` join the command list for parity.
- Open questions for the user: confirm the direction of this brief (calm, dense, native) and the accent behaviour (System follows the macOS accent; Agide Light and Agide Dark keep the Agide blue); which themes the user already likes, beyond the ports; whether the title bar tint in the profile colour is welcome or too much (the fallback is the tile and the 2 px bottom border only).
- Unverified, to be settled by the audit's probes before or during the slices: the traffic light offsets for a 38 px bar; double-click zoom on a custom drag region; that the accent notification fires and `getAccentColor()` then returns the new value; how macOS "Multicolour" is reported; whether Chromium 156 maps Increase contrast to `prefers-contrast: more`; vibrancy with native views; whether `system-ui` picks optical sizes at 11 to 15 px; keyboard resizing of dockview splitters; whether xterm's `minimumContrastRatio` also applies to text over the selection colour. The sample macOS accent values in the contrast script are approximate sRGB values chosen to test the method, not values read from the OS.
