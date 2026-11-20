# Visual design audit

Start: 2026-11-20T21:41:41Z (machine clock; the task date was 2026-11-18)
End: 2026-11-20T21:51:31Z

## Work

- Read decision records 0032 and 0031 and the renderer sources: all stylesheets, the dialog frame, the context menu, the browser chrome and observation popover, the tree, rail, strip, terminal and layout host.
- Opened screenshots from the most recent visual-check run: Pair layout, new task dialog, settings, inbox list, observation popover, profile window with setup card, dark session, agents pane.
- Read the Electron docs (nativeTheme, systemPreferences, base window options, BrowserWindow, WebContentsView, View, custom title bar, custom window styles, dark mode) from the main branch and compared the nativeTheme and systemPreferences pages with the v45.3.3 tag.
- Read MDN pages and the browser compat data package for the CSS features and the Chrome versions; matched Electron 45.3.3 to Chromium 156 from the release list.
- Read npm metadata and license files for Radix, Lucide, codicons, vscode-elements and its React wrapper, dockview, xterm.js; read the vscode-elements component styles from the published package.
- Read the dockview stylesheet and theme typings, the xterm typings, the VS Code theme docs, the Open VSX OpenAPI document, FAQ, release note and the Eclipse terms, and the Marketplace terms PDF text.
- Downloaded the GitHub theme and Catppuccin extensions from Open VSX into a temporary directory and read their manifests and theme JSON; computed contrast ratios with a standalone Node script.
- Wrote `notes/visual-design-audit.md`.

## Not done

- No application code, dependency or build was touched. Nothing was committed.
- The Open VSX terms-of-use page returned no text to a fetch; the note says so.
- The probes listed in section 6 of the note were not run.

## Cleanup

- The temporary directory with the downloads and scripts is removed in the last step of the run.
