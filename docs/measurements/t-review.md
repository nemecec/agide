# Review of the visual design system brief

Start: 2026-11-20T22:06:28Z (machine clock; the task date was 2026-11-18)
End: 2026-11-20T22:21:09Z

Reviewed: `docs/decisions/0035-visual-design-system.md` and `notes/visual-design-audit.md`. Verdict: accept with changes.

## What was checked

- Electron APIs against the docs in the `electron/electron` repository (`main`): `nativeTheme` (all properties the record uses, including `shouldDifferentiateWithoutColor` and `prefersReducedTransparency`), `systemPreferences.getAccentColor`, `accent-color-changed` (Windows and Linux only), `subscribeNotification` example events, `titleBarStyle`, `trafficLightPosition`, `vibrancy`, `visualEffectState`, `transparent`, `win.setVibrancy`, and the custom title bar tutorial. All claims hold. Traffic light offsets and double-click zoom are not in the docs, as the record says.
- CSS support from `@mdn/browser-compat-data` (`main`): `AccentColor` and `AccentColorText` are fixed values from Chrome 149 (crbug 40229450); `ui-monospace` is unsupported in Chrome; `system-ui` since 56.
- License files read from the repositories: Radix (MIT, 2022 WorkOS), Lucide (ISC, 2026 Lucide Icons and Contributors, Feather icons under MIT), primer/github-vscode-theme (MIT, 2020 Primer), catppuccin/vscode and catppuccin/catppuccin (MIT, 2021 Catppuccin), vscode-elements (MIT, 2026 Adam Bender), codicons (CC BY 4.0), dockview (MIT, 2021 mathuo, from the installed `LICENCE.md`).
- Open VSX: the Eclipse FAQ wording and the registry metadata of both theme extensions.
- VS Code keys: every colour key in both files against the key list of `api/references/theme-color.md` in the vscode-docs repository. All exist. The `--vscode-*` alias list of 0035 matches the variables in the `@vscode-elements/elements` 2.5.1 package exactly.
- dockview: every `--dv-*` name in both files exists in the installed 8.9.0 stylesheet (the record's `--dv-foo` is the example of an invalid name).
- Lucide names: every icon name in 0035 exists in `lucide-static` 1.77.0 `tags.json`.
- xterm 6.0.0 option and `ITheme` names in the installed typings.
- Contrast: an independent script (own WCAG relative luminance code, token values typed from table 1.1) reproduced every ratio in the record's tables, then checked pairs that components use and the table did not list.
- One screenshot of the latest `pnpm visual-check` run (the new session dialog), and the focus rules in the renderer stylesheets (read only).

## Findings and changes

See the structured report of the run. In short: missing pairs failed (`border.strong` on the light window, on the dark overlay); the System accent rule checked only content and sidebar, while links sit on raised and overlay surfaces too; the System selection rule let `danger.fg` drop under 4.5; the ported theme values failed several pairs of the record's own table; the highlighted menu item had no text colours; the focus statements did not match the `:focus-visible` rule for text fields; dockview sash, transition and structural variables needed corrections.

## Not done

- No application code, dependency, build or test was touched. Nothing was committed.
- The audit's probes were not run.

## Cleanup

- Removal of the scratch directory `t-review` under `/tmp` (scripts, the VS Code theme color reference, license headers, `lucide-static` tags) was denied by the permission system. It holds no repository content and can be deleted.
