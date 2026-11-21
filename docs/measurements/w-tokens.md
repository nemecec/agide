# w-tokens: step 1 of 0035, tokens and the System theme

Start: 2026-11-20 23:04 UTC. End: 2026-11-21 (see the last command times below; the final e2e run is recorded in the report).

## Built

- `app/src/core/theme/`: token catalogue, zod theme schema with the error codes and hints of 5.3, `agide-light.json`, `agide-dark.json` and `system.json`, colour arithmetic and the contrast module (the logic of `notes/scripts/token-contrast.mjs`), the System accent derivation, the theme resolver (tokens, CSS variables, xterm theme, dock overrides), the per-profile theme setting (`appearance.json` in the profile data directory, default System) and the colour-literal scanner.
- `app/src/main/appearance.ts` (adapter on `nativeTheme` and `systemPreferences`, one message per change, test override) and `appearanceIpc.ts` (channels `appearance:get`, `appearance:set-theme`, `appearance:changed`, the test hook). `app/src/shared/appearanceIpc.ts` and one line in the preload expose `window.appearance`.
- `app/src/renderer/theme/`: theme store that writes every `--agide-*` token to `:root`, `color-scheme` and flags to its attributes; terminal options and theme following; `main.tsx` starts the store before the first render.
- `styles.css`: old variables as aliases of tokens, system font stack, `font: inherit` on controls, focus ring from tokens (2 px offset, width from `focus.width`).
- `layout/dock-theme.css`, `layout/dockTheme.ts`: the `agide-dock` class replaces `themeDark` and `themeLight` in `LayoutHost.tsx`.
- `TerminalPane.tsx` and `SessionPeek.tsx` take their theme and options from the store (`minimumContrastRatio` 4.5).
- `app/scripts/check-colour-literals.mjs`, `colour-literal-allowlist.json`, `pnpm check:colours`.
- `app/scripts/lib/visual/phaseTheme.mjs` and the `theme` phase in `visual-check.mjs` (System light, System dark, increased contrast in both, a pink accent).
- Tests: contrast, accent derivation, schema, resolver, appearance parsing, theme setting, colour scanner, store, terminal options, main adapter, preload API, and `e2e/theme.spec.ts`.

## Deviations from 0035 that the build needed

- The table of 1.8 is a test target for every System accent, but rule 3 of 7.1 asks the accent text form for only 3 to 1 on the window, while the table asks `text.link` 4.5 to 1 there. `text.link` is derived separately from the text form, moved until it reaches 4.5 on the window. The text form values of the sample table are unchanged.
- Rule 4 of 7.1 checks primary text and the accent on `accent.subtle`; the table also checks secondary and tertiary text there (dark yellow failed at 4.23). The derivation now checks all four.
- Shared files touched: `app/src/preload/index.ts` (one line), `app/src/main/index.ts` (wiring and the `AGIDE_TEST_HOOKS=1` switch that installs the test hooks for a shown window), `app/package.json` (script `check:colours`), `app/scripts/visual-check.mjs` (registers the phase), `app/README.md` (two mentions).

## What took long

Waiting on Electron e2e runs (a full run takes several minutes), and finding where xterm 6 paints its background (the `.xterm-scrollable-element` node, not `.xterm-viewport`).

## Not finished or left for later steps

- The tree row ring of `TreePane.css` still shows after a mouse click (7.3); the file is another builder's. In the dark screenshots the focused row draws its ring in the accent colour.
- `docs/themes.md` and the JSON Schema checked by a unit test are not generated; `themeJsonSchema()` exists.
- `reducedTransparency` and `differentiateWithoutColour` set root attributes only; the CSS that reads them belongs to later steps.
- Increased contrast: hover doubling, the selected row outline and card outlines are not applied beyond the token overrides, the focus width and the `data-contrast` attribute.
- Dock splitter line of 2 px and the `.dv-sash` override are not done.
- The independent visual review of 8.2 was not run in this task. A before set was not captured; the after set is the `theme` phase output.
