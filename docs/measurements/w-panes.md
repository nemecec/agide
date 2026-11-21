# w-panes: pane-by-pane restyle and removal of the old variable aliases (0035 step 4)

Start: 2026-11-21 00:36 UTC. End: 2026-11-21 01:10 UTC (the time went into the visual-check runs and the Electron e2e run).

## Built

- Tree: 24 px rows with a 4 px inset, 14 px indent, a rotating Lucide chevron, a surface icon per node type (`ui/icons.ts` through `tree/treeIcon.ts`), the title as the flexible part with a tooltip that names the type, the "(empty)" line, a drag line with an open circle, the drop target and the focused or unfocused selection fill. The type label is gone. Container queries on the pane hide the rate and collapse the status chips to icons as the pane narrows.
- Agent rows: agent icon, status chip, detail, elapsed time and a danger-quiet dismiss IconButton that shows on hover and focus inside the pane. Session tallies are status chips. The heat marker is an SVG of three bars; the number of filled bars carries the level.
- Inbox: list rows with a fixed unread gutter, kind glyph and word (`KindLabel`), a "Needs answer" chip, a SegmentedControl for Open and Done, counts with a warning chip, empty states. The card has the kind, the title in the title step, a context list, a collapsed "Details" Disclosure for the raw request, a warning Notice where the card cannot answer, primary action by kind ("Open session to answer", "Open session" for a failure), Done, a Snooze menu, Mark seen or unread, and Peek. The peek has a quiet Back button, a status chip and a "read only" chip, and uses the terminal background token.
- Browser: a Radix Toolbar with IconButtons, an address field with the service chip, the observation control as a Popover with a RadioGroup, Open in Chrome and the tab menu. Agent request, acting, crashed and dialog states are Banners; Deny, Allow once and a More menu replace the plain buttons. The acting outline uses `warning.fg`.
- Terminal bar: a Toolbar with a status Chip and a quiet Resume button. The terminal host uses the terminal background token.
- Usage pane and history table use `Table` with right aligned numbers, a state column with icon and word, and empty states. History filters use `Select` and `Checkbox`.
- Dock tabs: `PaneTab` with a pane icon, the title (the bound node title for surface hosts), and an icon-only status chip while the shown session is busy, waiting or failed.
- Layout notices are Banners with a Disclosure and Dismiss and Undo buttons. Empty states use `EmptyState` in the tree, the surface host, the inbox, the usage pane, the history pane and the transcript pane.
- Settings and task dialogs were already on the components; their stylesheets read tokens only.
- `styles.css`: the old variables (`--bg`, `--fg`, `--pane-bg`, `--border`, `--muted`, `--accent`, `--focus`, `--danger`, `--warn`, `--ok`, `--select-bg`), `.btn-primary`, `.chip`, `.layout`, `.tree-pane` and `.placeholder` are removed. A search of `src`, `scripts` and `e2e` for `var(--bg)` and the other old names finds only the fixtures of `colourLiterals.test.ts`.
- The colour-literal allowlist is empty and `pnpm check:colours` passes.

## Shared files touched

- `ui/Banner.tsx`: optional `icon` prop (the agent glyph on the request and acting banners).
- `ui/SegmentedControl.tsx`: optional `testId` per segment.
- `scripts/lib/visual/phaseTheme.mjs`, `phaseAppearance.mjs`: return to the session through its tree row, because the tab no longer reads "Surface host".
- Tests moved with the markup: `ApprovalBar`, `ObservationControl`, `InboxPane`, `agentsPanes`. New tests: `HeatMarker`, `treeIcon`, `tabModel`, `sessionStatus`, a kind label test and a failure action test in `InboxPane.test.ts`.

## Results

- `pnpm typecheck`: passes.
- `pnpm coverage`, run twice: 178 test files pass, exit 0.
- `pnpm build`: passes. `pnpm parity`: ok. `pnpm e2e` with AGIDE_HIDDEN=1: 73 passed.
- `pnpm visual-check --hidden --out agide-restyle-stage-c`: the first full run failed the inbox phase (the peek crashed on a status value without a chip mapping; fixed and covered by `sessionStatus.test.ts`) and the appearance and theme phases (the scripts looked for the old tab text; fixed). Later runs of workspace, agents, browser, dialogs, appearance and theme finished without a failed phase. The full run was not repeated after the last two CSS changes; the changed phases were.
- Screenshots opened and judged: tree at 900, 1440 and 1920 px (workspace phase), agents, usage, inbox list and card, browser chrome and the agent request bar, session and inbox in System light and dark. Fixed after looking: session title shrunk to "Fix ..." by the status chips, wrapping token cells in the usage table, the peek crash.

## Not finished or open

- Dock tabs have no close button; no command removes a pane from the layout, so the close IconButton of 0035 3.3 is not built.
- The inbox header puts the counts on a second row under the title and the segmented control; one row does not fit in the 320 px list column.
- "Always allow this site" lost its explanatory tooltip when it moved into a menu.
- Settings and task dialogs were captured but not reopened as images after this step; browser and agents panes were judged in dark mode, the inbox in light and dark.
- Temporary files: none left outside `agide-restyle-stage-c` under the OS temporary directory, which holds the screenshots on purpose.
