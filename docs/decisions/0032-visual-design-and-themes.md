# 0032 Visual design and themes

Status: proposed (the user asked for a better look; the direction is an agent proposal)
Date: 2026-11-18
Decided by: Neeme (request); spike agents (direction)
Adds: R25 visual design and themes (weight 2 proposed)

## Context

The user finds the UI elements ugly and asks whether ready-made styling packs exist for Electron apps and for VS Code, and whether Agide can reuse them.

The renderer is styled with a small amount of plain CSS and a handful of colour variables (`--bg`, `--fg`, `--pane-bg`, `--border`, `--muted`) with a dark variant. The layout engine dockview 8.9.0 ships its own themes for the dock frame only (tabs, splitters, drop targets): `vs`, `dark`, `light`, `abyss`, `dracula`, `monokai`, `nord`, `solarized-light`, `catppuccin-mocha`, `github-dark` and `github-light`, and `-spaced` variants of several (read from its bundled stylesheet). They do not style the panes' content.

What exists elsewhere, from the research of 2026-11-18:

- Electron has no skin format. Look comes from the web layer: a design system or component kit, plus window options on macOS (`vibrancy`, `titleBarStyle`).
- VS Code themes are data: a JSON file with a `colors` map (keys such as `editor.background`, `sideBar.background`, `terminal.ansiRed`) and `tokenColors` for code. Converters exist for Monaco themes (`monaco-themes`, MIT) and for terminal schemes. No package maps the `colors` keys to CSS custom properties; that mapping is ours to write.
- Microsoft's `@vscode/webview-ui-toolkit` is deprecated and archived (January 2025). Its successor in practice is `@vscode-elements/elements`, a web component set with a React wrapper. Its components take their colours from VS Code's `--vscode-*` CSS variables; that comes from the library's design and is not verified here.
- Component kits for a custom look: Radix primitives (headless, MIT), shadcn/ui (source copied into the project, Tailwind based), Mantine (packaged, CSS modules), Fluent UI (Microsoft look, Windows-oriented effects).
- The VS Code Marketplace terms restrict use of its content to Microsoft's products. Open VSX (Eclipse) is the open registry. Its terms and each theme's own license are not verified here.

## Decision

- Tokens first. Replace the colour variables with a semantic token layer (`--agide-*`: surfaces, text, borders, accents, status colours, selection, focus ring, elevation, radii, spacing, type scale, motion) and `--vscode-*` aliases for the keys that map. Light, dark and automatic follow the system appearance. A script checks token pairs for contrast (4.5 to 1 for body text, 3 to 1 for large text and icons).
- Themes are data. A theme is a JSON file with the token values; built-in themes ship with the app and a user theme lives in the profile's data directory. The choice is per profile. Built-ins: Agide Light and Agide Dark (default, a quiet macOS-like look with the system font stack), plus ports of two widely used VS Code themes whose licenses allow it (candidates: GitHub Dark and Catppuccin Mocha; license check first). The dock frame uses the matching dockview theme or a custom one built from the tokens.
- Import of VS Code themes. The app reads the `colors` map of a theme JSON that the user selects or that comes from Open VSX (never the Marketplace), maps it to tokens and `--vscode-*` variables, derives the terminal's colours from `terminal.ansi*` and `terminal.background`, and shows the theme's license before it is kept. Themes are data: no extension code runs.
- Components. Radix primitives for dialogs, menus, tabs, tooltips and popovers (they also fix focus handling and stacking), and one icon set with a permissive license (Lucide). No full kit for now. `@vscode-elements/elements` is a later option for form controls once the `--vscode-*` aliases exist. On macOS the window uses an inset title bar; vibrancy for the sidebar is a setting that is off by default.
- Agents assist. Theme commands on the app MCP server (`theme_list`, `theme_get`, `theme_apply` with a preview and undo), under the same rules as layout changes (0020), so an agent can propose a theme and the user sees it before it is kept.
- Process. The work uses `pnpm visual-check` for before and after screenshots, an independent visual reviewer, the contrast check and tests for the token and import code.

## Consequences

- A rough guess is 5 to 8 working days for the tokens, the restyle of every pane, three to four themes, the picker and the import; low confidence.
- The restyle starts after the on-screen check run finishes, because both change the same stylesheets and the check produces the before screenshots.
- Unverified before the work starts: that `@vscode-elements/elements` renders correctly from our `--vscode-*` aliases, the Open VSX terms for reuse, the license of each candidate theme and of the icon sets (VS Code's codicons carry an attribution license), and how Electron's vibrancy behaves with the layout engine's native views.
- Open questions for the user: whether the default should look like VS Code, like a native macOS app, or like neither; which themes the user already likes (a name is enough to port it if its license allows).
