# w-import: VS Code import, ported themes, theme commands

Start: 2026-11-20 23:55 UTC. End: 2026-11-21 00:25 UTC (`date -u`).

## What was built

- `app/src/core/theme/vscode/`: tolerant JSON-with-comments parser, VS Code colour parsing and alpha compositing, the token mapping of 0035 6.1 (fallback orders, derived values, kind detection, `include` refusal, terminal palette, shadow colour), the contrast clamp of 6.2 with a list of adjustments, a zip reader and `.vsix` reader that open only `extension/package.json`, the theme files it names and the license file, license detection, the importer that builds a theme document, and the `--vscode-*` alias table.
- `core/theme/service.ts` and helpers: theme list, get, validate, preview with timer revert, apply with revision check, undo as a new revision, user theme files under `<data dir>/themes/`, history in `appearance.json`.
- Commands `theme_list`, `theme_get`, `theme_validate`, `theme_preview`, `theme_apply`, `theme_undo`, `theme_import`, and `theme_revert_preview` (added so the Revert button is a command). All are MCP tools; `docs/parity.md` lists them.
- Ports `github-dark-default.json` and `catppuccin-mocha.json`, produced by `app/scripts/port-vscode-theme.mjs` from the Open VSX packages with the importer. Both licenses are MIT (read again from the repositories and the packages; the texts match). `NOTICE` has an entry for each.
- Renderer: `theme/aliases.ts`, `theme/ThemeNotice.tsx` (preview bar with Keep, Revert and Escape; change bar with Undo), `panes/settings/ThemePicker.tsx`, `ImportThemeDialog.tsx`.
- Tests: mapping fixtures cut from the two themes (colours only), zip, vsix, importer, service, commands over the module graph with parity, aliases, appearance message, picker, notice, import dialog; Playwright `e2e/themeCommands.spec.ts`.

## Results

The mapping reproduces the 6.7 values for both ports, including every clamped value listed there. One difference from 6.7: `danger.fill` of GitHub Dark Default ends at `#bd534e` (it follows `danger.fg`, then moves away from white text). Both ports pass every pair of 1.8 through the existing contrast test.

## Open VSX

Not implemented. The audit's reading of the terms is unclear for use outside an editor, so import takes a file the user selects (`path`, or base64 `data` with `fileName` from the file input). `theme_import` has no Open VSX reference input.

## Decisions and deviations

- `theme_import` accepts `dryRun`, so the dialog shows license, source and adjustments before Keep saves. It also accepts `data` (base64) because the renderer has no file path.
- The theme schema gained an optional `vscode` field (original colours of alias keys, restricted to hex colour forms). Alias values for an imported theme read it unless the clamp moved the token behind the alias.
- `AppearanceMessage` carries optional `theme`, `revision`, `preview`, `change`. The preload cannot load zod, so `parseAppearanceMessage` checks shape only; the renderer validates the document.
- A preview limited to one window (`windowId`) is honoured by the appearance wiring; without it every window of the profile shows it. The UI caller does not pass a window id.
- Shared files touched with the smallest change: `main/modules.ts`, `main/context.ts` (theme service), `main/index.ts` and `main/appearanceIpc.ts` (wiring through the service), `core/theme/appearance.ts`, `core/theme/schema.ts` (`vscode` field), `core/theme/index.ts`, `core/theme/builtin/index.ts`, `renderer/theme/themeStore.ts`, `renderer/App.tsx`, `renderer/dialogs/SettingsPanel.tsx`, and tests `schema.test.ts`, `m3Modules.test.ts`, `e2e/theme.spec.ts` (expectations updated for the new themes, the new service and the revision field in `appearance.json`).
- `core/theme/themeSetting.ts` and its test are no longer used by the app (replaced by `themeChoice.ts`). Deleting them was denied by the sandbox policy, so they remain; the integration step can remove them.

## What took long

A first build ran with a blank window: the preload imported the schema module through `appearance.ts`, and the sandboxed preload cannot load zod. Fixed by checking shape only in the preload path.

## Not finished

- Hot reload of user theme files on disk with a danger Banner for an invalid file (the service has `rescan`; nothing watches the directory).
- Daily digest entry for an agent's `theme_apply`.
- A View menu entry for the theme commands.
- Duplicate-to-edit for built-in themes.
- An independent visual review; one screenshot of the picker with a preview running was checked by eye.

## Temporary files

`/tmp/agide-import-src` (downloaded packages, extracted files, probe scripts) was created by this run. Removal was denied, so it remains.
