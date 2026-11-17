# Prior art for composable, user-assembled interfaces (R20)

Input to the block model and layout format design record (0015, milestone 2). Sources were read on 2026-11-17. A statement marked "general knowledge" was not on a page read for this note and needs a check before it enters a decision record. The Agide-specific results (plugin validation behaviour) were run against `claude` 2.1.326.

## Short answer on R7

Agide blocks can be distributed as Claude plugins and can reuse the Claude marketplace for discovery, install, update and trust prompts. A block package is a Claude plugin directory with an Agide sidecar. Agide blocks cannot be built as Claude mods: mods draw only in Claude's own terminal, Desktop and VS Code interfaces, and a `claude -p` session draws nothing. Details are in the last section.

## What each system contributes

### VS Code

Sources: https://code.visualstudio.com/api/references/contribution-points, https://code.visualstudio.com/api/references/when-clause-contexts, https://code.visualstudio.com/api/extension-guides/webview, https://code.visualstudio.com/api/extension-guides/custom-editors

- Contribution points are declared statically in `package.json`: `views`, `viewsContainers`, `commands`, `menus`, `customEditors`, `keybindings`, `configuration`, `walkthroughs`, `viewsWelcome`. The host reads them without running extension code, so it can list, place and enable a contribution before activation.
- Context keys are values the host sets as state changes (`editorFocus`, `resourceExtname`, `config.*` for settings). A `when` clause is a boolean expression over them with `!`, `&&`, `||`, `==`, `!=`, numeric comparison, `=~` and `in`. Extensions add their own keys with the `setContext` command. The same expression language gates commands, menus, keybindings and views. This is the closest existing match to the shared context channel in 0015.
- Webview views render in a sidebar or panel container, webview panels open as editor tabs, custom editors use webviews bound to a file. The docs call webviews resource heavy and tell authors to use them only when native APIs fall short.
- Webview security: scripts are off by default (`enableScripts`), `localResourceRoots` limits local file access, authors are told to set a CSP that starts at `default-src 'none'`. Messaging is `postMessage` in both directions; the page gets the VS Code API once through `acquireVsCodeApi()`.
- Webview state: a hidden webview loses its page and is rebuilt from its HTML. `getState`/`setState` hold small JSON state; a `WebviewPanelSerializer` restores panels after restart; `retainContextWhenHidden` keeps the page alive at high memory cost.
- Custom editors: `CustomTextEditorProvider` uses the standard `TextDocument` as model; `CustomEditorProvider` brings its own `CustomDocument` and must implement backup. `selector` globs and `priority` (`default` or `option`) decide which editor opens a file.
- Lessons: declarative manifest plus lazy activation; one expression language over a shared context; a webview is a separate page that talks over messages and restores from small state.

### Obsidian

Sources: https://docs.obsidian.md/Plugins/User+interface/Views, https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines

- A view extends `ItemView` with `getViewType()`, `getDisplayText()`, `onOpen()`, `onClose()`. `registerView(type, factory)` runs in plugin load; the factory may be called several times and must not have side effects.
- Views live in workspace leaves. Plugins find instances with `getLeavesOfType()` and are told not to keep view references. Guidelines say not to detach leaves on unload, to register events and commands through the plugin so they clean up, and not to set default hotkeys.
- The guidelines tell authors to avoid `innerHTML` with user input and to style with CSS variables, so a block inherits the theme.
- Not read from the sources: view state serialization (`getState`/`setState`), the workspace layout file, manifest fields (`minAppVersion`, `isDesktopOnly`), and the review process. General knowledge: Obsidian plugins run with full access to the vault and Node APIs, with no sandbox.
- Lessons: the host owns instances (leaves) and plugins register types; types are looked up by string id; instance references are not kept by plugins.

### Eclipse Theia

Source: https://theia-ide.org/docs/widgets/

- `ReactWidget` base class with `render()`; `WidgetFactory` bound under an id; `WidgetManager.getOrCreate` creates or returns widgets; `AbstractViewContribution` adds the widget to the View menu with an open command and default placement (`area: 'left'`). Services are injected with `@inject`; wiring happens in a frontend module.
- Shell areas: left and right side bars, main, bottom, secondary windows.
- Not covered on the page read: layout state store and restore (`StatefulWidget`).
- Lessons: id-to-factory registry, a contribution object that ties factory, command and menu entry together, placement as data. Theia extensions are trusted code compiled into the app (general knowledge), so it offers no sandbox model to copy.

### Nimbalyst Extension SDK (candidate clone, read only)

Files read: `docs/EXTENSION_ARCHITECTURE.md`, `docs/EXTENSION_PANELS.md`, `docs/EXTENSION_SDK_RELEASE_REVIEW.md`, `packages/extension-sdk/src/types/extension.ts`, `packages/extension-sdk/src/manifestValidation.ts`, `packages/marketplace/README.md`. License is MIT.

- A manifest (`manifest.json`) declares `contributions`: custom editors by file type, `panels` (`id`, `title`, `icon`, `placement` of `sidebar`, `fullscreen` or `floating`, `aiSupported`, `activationEvents`, `order`), `settingsPanel`, AI tools served over MCP, slash commands, themes, `backendModules` and `claudePlugin`.
- The host passes a typed host object to each block: `EditorHost` (load, save, dirty, file-change, theme and diff callbacks) and `PanelHost` (identity, workspace path, services). All editors, built-in ones included, go through the same contract. A `useEditorLifecycle` hook removes the subscription boilerplate. This matches the R20 rule that first-party features are blocks.
- Blocks tell the agent chat what is selected through `setEditorContextItems` (id, label, description, optional JSON data capped at 32 KiB and off by default). This is a shared-context channel from block to agent.
- AI tools declare a document access mode (`filesystem`, `editor-read`, `editor-write`) so the host knows whether to mount an editor.
- Permissions: a closed set of ids (`workspace-files`, `nimbalyst-database-read`, `nimbalyst-database-write`, `secrets-read`, `mcp-server-register`, `ai-sessions`); ids that never enforced anything were deprecated and are dropped with a warning. A first-use consent prompt shows the declared permissions for non-built-in extensions.
- Backend modules declare a runtime: `utility-process` or `worker-thread` (`KNOWN_RUNTIMES` in `manifestValidation.ts`).
- The architecture doc states that the browser host's capability table "is an API contract, not a sandbox", that a bundle there shares one window, origin and module graph with the host, and that an iframe or Worker boundary with `postMessage` is a precondition for loading any bundle the host did not build. Declaring permission fields does not approximate that boundary. Agide should treat this as the main warning.
- Their own SDK review (2026-03-07) found the docs, the published types and the runtime contract had drifted apart (renamed fields, missing contributions, a documented API that was removed, `apiVersion` optional in types but warned about in the dev server, no stated compatibility policy). Lesson: generate docs, types and validation from one schema.
- Distribution is their own registry: a Cloudflare Worker serving `registry.json` and `.nimext` zip downloads from a bucket. They bundle Claude plugins as one contribution kind (`claudePlugin`: a path to a plugin directory inside the extension, with display name and a documentation list of commands and agents). The nesting is extension-contains-plugin, and the marketplace is their own, so there is no reuse of the Claude marketplace.

### Claude Code mods and plugins

Sources: https://code.claude.com/docs/en/plugins/mods/overview.md, https://code.claude.com/docs/en/plugins/mods/admin.md, https://code.claude.com/docs/en/plugins/mods/reference.md, https://code.claude.com/docs/en/plugins/mods/interface.md, https://code.claude.com/docs/en/plugins/manifest-reference.md, https://code.claude.com/docs/en/plugins/marketplace-reference.md, https://code.claude.com/docs/en/plugins/security.md

Mods:

- A mod is a plugin whose hooks module (`hooks/hooks.json` with `modules`, plus an ES module exporting `register(on)`) registers event handlers. A handler observes, rewrites or answers an event. Events include `tool.call`, `prompt.submit`, `session.*`, `ui.render`, `plugin.register`, and a `classic.<Event>` form for settings hooks.
- All access beyond the handler goes through the mods API `$`: `$.fs`, `$.process`, `$.http`, `$.env`, `$.settings`, `$.mcp`, `$.model`, `$.prompt`, `$.session`, `$.store`, `$.ui`, `$.theme`. Because every effect is a named call, `claude plugin validate <dir>` lists the events (`hooks:`) and the calls (`calls:`) without running the code, and Claude Code refuses to load a mod that uses `$` in a way the command cannot read. A policy mod can receive the same list in a `plugin.register` event and refuse or strip another mod. This is the model for the Agide pre-install listing: a block's declared commands, events, context reads and permissions, shown before install.
- Mods are not sandboxed. They run with the user's permissions, see every prompt and tool call, and can approve calls. A built-in guard (`sec-default`) loads when managed settings exist or a Team or Enterprise login is in use; `allowManagedModsOnly` stops user mods.
- Drawing: a mod returns an element tree for a render site (`Pane`, `AbovePrompt`, `Backdrop`, `ToolUse`, `Spinner`, and others). The reference tables mark which sites and elements each app draws. Hooks run in every session kind that loads the plugin, including `claude -p` and the Agent SDK, but what a mod draws appears only in the terminal, the Desktop Code tab and the VS Code chat panel. `claude -p` draws nothing.
- Mods work from Claude Code 2.1.286/2.1.287 on; the CLI used here is 2.1.326.

Plugins and marketplaces:

- A plugin is a directory with `.claude-plugin/plugin.json` and component directories: skills, commands, agents, hooks, monitors, themes, output styles, workflows, `bin/`, plus `.mcp.json` and `.lsp.json`. There is no component kind for a graphical block.
- `plugin.json` fields include `name` (kebab-case, reserved prefixes such as `claude-` and `cc-plugin-` are errors), `version`, `dependencies`, `userConfig` (typed prompts with `sensitive` values kept in secure storage), `defaultEnabled`, a free-form `metadata` object that Claude Code does not read, and directory-listing fields. An unknown top-level key is stripped with a warning.
- A marketplace is `.claude-plugin/marketplace.json` with `name`, `owner` and `plugins[]`. Plugin sources are a relative path, `github`, `url`, `git-subdir`, `npm` (install scripts never run), `archive` (with `sha256`) and `command`. `sha` fixes a git source to a commit. A marketplace is added with `claude plugin marketplace add` or the `extraKnownMarketplaces` setting; plugins install with `claude plugin install <name>@<marketplace>`; administrators restrict sources with `strictKnownMarketplaces` and `blockedMarketplaces`.
- Trust: the docs say a plugin can run arbitrary code with the user's privileges. Hooks, monitors, MCP and LSP server processes and mod processes run outside Claude's sandbox. `claude plugin details` and the `/plugin` details pane show a component inventory before install. When auto-update is on for a marketplace, Claude Code updates its plugins in the background, so the reviewed files can change on disk; auto-update is set per marketplace.

### Home Assistant dashboards and cards

Sources: https://www.home-assistant.io/dashboards/, https://contributors.home-assistant.io/frontend/custom-ui/card/

- A dashboard is views of cards. View layout types are Masonry, Panel, Sections (default) and Sidebar. Users assemble dashboards with a visual editor; cards can be themed per card; stacks and grids nest cards.
- A custom card is a custom element (`customElements.define`, used as `type: custom:<tag>`). The host calls `setConfig(config)` on creation and on change (throwing on invalid config), sets the `hass` property on every state change, and asks for size through `getCardSize()` or `getGridOptions()` (12-column grid, 56-pixel rows). The card file is registered as a JavaScript module resource.
- Not on the pages read: `getStubConfig`, `window.customCards` registration, HACS distribution. General knowledge: custom cards run in the page with full access.
- Lessons: a block instance is a type plus a config object that the block validates; the host pushes state through one entry point; blocks declare size hints; a stub config lets the editor add a block with defaults.

### Zed extensions

Source: https://zed.dev/docs/extensions/developing-extensions

- An extension is a git repository with `extension.toml` (`id`, `name`, `version`, `schema_version`, `authors`, `repository`). It can provide languages, debuggers, themes, icon themes, snippets and MCP servers. Code is Rust compiled to WebAssembly (`wasm32-wasip2`) and is needed only for language server, context server and debugger extensions.
- The page lists no custom UI panel contribution and does not describe a sandbox or a registry process.
- Lesson: the extension surface stays declarative data plus narrow WebAssembly hooks; the host does not let extensions draw.

## Layout engines for React

Versions, dates, licenses and peer ranges come from the npm registry on 2026-11-17. The other columns come from each repository README as read on the same day.

| Engine | Latest on npm (date) | License | React peer range | Serialization | Drag and drop | Popout and float | Notes |
|---|---|---|---|---|---|---|---|
| dockview (`dockview-react`) | 8.9.0 (2026-11-08) | MIT; `dockview-enterprise` is a separate proprietary package | 16.8 to 19 | Listed as a feature with full layout management; the `dockview-core` 8.9.0 type declarations name `toJSON()` and `fromJSON(data, options?)` (checked in the review of 0020) | Tabs and groups, touch listed | Floating groups and popout windows | Zero-dependency core; React, Vue and Angular bindings; about 3.5k stars |
| FlexLayout (`flexlayout-react`) | 0.11.2 (2026-11-16) | MIT | 18 and 19 | `Model.fromJson`, `model.toJson`; JSON has `global`, `layout`, `borders`, `subLayouts`; a `save` node event lets components add data | Tabsets, edges, external drag to add tabs, tab groups | Popout to floating panels or new windows | ESM only; pre-1.0 version; about 1.4k stars; only dependency is React |
| rc-dock | 4.1.0 (2026-09-30) | Apache-2.0 | 18 and later | `saveLayout`/`loadLayout`; tabs saved as `{id}` references, `saveTab` adds fields; controlled and uncontrolled | `dockMove`, drag layers, tab `group` restricts where tabs can go | Popup panel demo | Dependencies: lodash, classnames, rc-new-window, three `@rc-component/*` packages; a migration guide for v5 exists; about 815 stars |
| golden-layout | 2.6.0 (2022-09-26) | MIT | none declared; no React binding on the README | Load and save listed | Listed | Not listed in the read | No release since 2022; the `dev` branch for 3.0 is described as unstable and not backward compatible; about 6.7k stars |

Reading: dockview and FlexLayout are current, MIT, support React 19 by declared peer range, and serialize to JSON. golden-layout is stale for React use. rc-dock carries more dependencies and the Apache license.

Risks to test in a spike (not yet run):

- React 19.3.1 (the version in `app/`) under each engine's peer range, in the Electron renderer, with the React compiler and strict mode as configured.
- Save, edit and load of a layout that references a block type that is not installed. The engine must keep the placeholder and its state.
- The browser surface (0006) is a native `WebContentsView` layered above the renderer's DOM. Docking drop zones and drag previews drawn in the DOM would sit under it. General knowledge, to confirm: the view must be hidden or replaced by a snapshot during a drag, and its bounds must follow the pane through a resize listener.
- Popout windows from the engine open a new renderer window, which a block with a bridge to the main process must also handle.

## Sandboxing user-written UI in Electron

Sources: https://www.electronjs.org/docs/latest/tutorial/security, https://www.electronjs.org/docs/latest/api/web-contents-view, https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe

Electron checklist items that apply to untrusted UI: no Node integration in any renderer or `WebContentsView` that loads untrusted content; context isolation on; process sandbox on (turning off context isolation or enabling Node integration also disables the sandbox); `ses.setPermissionRequestHandler()` for every session loading remote content, because Electron approves by default; a restrictive CSP (`script-src 'self'`) by header or meta tag; `will-navigate` handlers that compare parsed origins; serve local pages through `protocol.handle` instead of `file://`; no `allowpopups` or `disablewebsecurity` on `webview`.

`WebContentsView` is a main-process view that hosts a `WebContents`, takes its own `webPreferences`, is placed with `setBounds` and added with `win.contentView.addChildView`. The page does not describe process isolation or session partitions (general knowledge: each view is its own renderer process and can use a separate `partition`).

Iframe `sandbox`: an empty attribute applies every restriction. `allow-scripts` without `allow-same-origin` gives the frame an opaque origin, so it cannot reach the parent or storage and talks only through `postMessage`. The two tokens together let a same-origin frame remove its own sandbox, so the docs call the combination strongly discouraged. `srcdoc` plus `sandbox` is the documented way to show untrusted content. The `csp` attribute adds a policy for the framed document. Check `event.origin` on received messages (the page labels this general advice).

Options for the block tiers in 0015:

| Tier | Mechanism | Boundary | Cost |
|---|---|---|---|
| First-party and composed blocks (declarative) | React components in the main renderer, or data interpreted by first-party components | None needed; data only | Lowest; no isolation for code |
| Code block, moderate | Sandboxed iframe served from a custom protocol, `allow-scripts` only, CSP, `postMessage` bridge | Opaque origin inside the app renderer; a renderer-level escape reaches the app | Cheap; sits in the DOM so docking and theming work |
| Code block, strong | One `WebContentsView` per block, `sandbox: true`, context isolation, own session partition, permission handler denying by default, narrow preload bridge, navigation guard | Separate process | Native layer above the DOM, bounds sync, memory per block |
| Block backend logic | Utility process or the app MCP server, reached through the command registry | Process boundary plus a permission check on each command | Needs a protocol and lifecycle |

A permission manifest is only a declaration unless the main process enforces it on the bridge: the handler checks the sender's frame or `webContents` against the block's granted set on every call. Nimbalyst's closed permission list, deprecation of ids that enforced nothing, and first-use consent prompt are the pattern to copy. Their warning that a declared permission is not a boundary applies directly.

## Layout file formats and migration practice

- Grafana dashboards: a JSON model with `uid`, `title`, `panels[]` (each with `type`, `gridPos` on a 24-column grid, `datasource` as `type` plus `uid`) and the integers `schemaVersion`, which rises when Grafana changes the schema, and `version`, which counts saves. A newer resource model wraps the document in an envelope with the fields under `spec`. The page read does not describe how migration runs (general knowledge: the loader applies ordered migrations up to the current `schemaVersion`).
- FlexLayout: JSON model with named sections, a `save` event so components add their own data. rc-dock: tabs saved as ids with optional extra fields; ships a migration guide between majors. VS Code webviews: the extension owns its state format and a serializer restores it, so state versioning is the block's job.
- Practice to adopt, drawn from the above and from the per-module store migrations already in `app/src/core`:
  - The layout file carries an integer `schemaVersion` and a separate `version` or revision. Ordered migration functions run on load and write the result back only after the user saves.
  - The layout engine's own serialization is stored as one opaque field inside Agide's file, next to Agide's own `blocks[]` table (instance id, block type, block version range, config, bindings). Swapping the engine then changes one field, not every file. (0020 changes this: Agide's own arrangement is authoritative and the engine's serialization is only a cache.)
  - A block instance is `type` plus `config`. The block type declares a config schema and its own config migrations; the layout migration does not edit block configs.
  - A block type that is missing, disabled or of an incompatible version keeps its instance as a placeholder with its config and state intact. Opening the layout does not delete data.
  - Layouts shipped as examples and layouts written by the agent go through the same validator, with a diff and undo as in 0015.
  - The block manifest has its own `apiVersion` with a stated compatibility policy (Nimbalyst shipped without one and flagged it in review).

## Can Agide blocks ship as Claude plugins and reuse the marketplace (R7)?

Yes for packaging, distribution and trust prompts. No for rendering through the mods interface.

Verified here with `claude` 2.1.326, `claude plugin validate`, on throwaway plugin directories:

| Plugin | Result |
|---|---|
| `plugin.json` with a top-level `agide` key and an `agide/block.json` file | Warning `Unknown field 'agide'. Claude Code ignores it at load time.` The `--strict` run exits with status 1. The skill in the same plugin is listed as provided. |
| `plugin.json` with `metadata.agide` pointing to `./agide/block.json` | No warning about the field or the sidecar directory. The `--strict` run exits with status 0. |

Both runs also printed plugin-directory submission checks (README, license, icon) that apply to a submission to Anthropic's directory and not to a private marketplace.

What the packaging gives:

- One artifact can hold a block (the sidecar), a skill that teaches the agent how to use the block's commands, an MCP server for the block's data source, and commands or agents. This fits the R20 rule that the agent helps build and use the UI.
- Install, update, scope, `dependencies` between blocks, `userConfig` with secure storage for tokens, version fixing by `sha` or `sha256`, `strictKnownMarketplaces` allowlists and `/plugin` listings all exist and work from the shell (`claude plugin marketplace add`, `claude plugin install <name>@<marketplace>`). Agide can drive them as subprocess calls under the user's login, which matches decision 0001 (no handling of credentials).
- The unmodified Claude Code ignores an Agide sidecar, so a block plugin installs and loads in plain Claude Code without harm.

What it does not give:

- `claude plugin validate` does not check the sidecar. Agide needs its own validator and its own pre-install listing, modelled on the `hooks:` and `calls:` output: commands provided, events emitted and consumed, context read, permissions requested.
- Mods cannot be the block runtime. A mod's element tree targets Claude's own render sites and elements. Under the launch path of 0004 (`-p` stream-json) mod handlers run but nothing is drawn, and Agide receives no drawn output. A mod installed from the same marketplace still runs in every Agide-launched session with the user's permissions, unsandboxed. Agide should show the mod in its trust prompt. The documented switches that stop installed mods reach further: `disableAllHooks` also stops settings hooks, which Agide's status relies on, and `--safe-mode` disables other customizations; `allowManagedModsOnly` is a managed setting. Disabling the one plugin stops its mod.
- The plugin's trust level is the worst component. A plugin that holds a hook, an MCP server or a `bin/` file runs unsandboxed code in Claude sessions regardless of how well Agide sandboxes the block's UI. The block's permission manifest says nothing about those components. The trust prompt must list both.
- Plugin names beginning with `claude-`, `anthropic-`, `anthropics-` or `cc-plugin-`, and the names `claude`, `anthropic`, `anthropics`, `claude-code` and `claude-mods`, are validation errors; marketplace names have a longer reserved list. Block packages follow the same naming.

Design consequences for the design record:

1. Define the block manifest as a file inside the plugin, located by `metadata.agide` in `plugin.json` (no validator warning), with its own `apiVersion`. Keep the top-level `agide` key out.
2. Use the Claude marketplace format and commands as is. Do not build a second marketplace.
3. Agide validates the sidecar with a schema that also produces the types and the documentation, so they cannot drift.
4. Code blocks run in the strong or moderate sandbox tier above, never in the main renderer's own document and script context (the moderate tier's iframe sits in the renderer with an opaque origin). First-party blocks are the only code in that context.
5. Agent-written blocks are plugins in a local marketplace of type `directory` or a `--plugin-dir` load, which Claude Code already supports for development.

## Not verified

- How Agide should find installed plugins: `claude plugin list` output format (JSON flag), and the cache location when `CLAUDE_CONFIG_DIR` is set. The security page names `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` for the default config directory only.
- Whether a mod handler's work shows up in `-p` stream-json output, and whether a session can start with mods disabled while keeping skills and MCP servers (`--safe-mode` also disables other customizations).
- Whether the sidecar survives each marketplace source type unchanged (`git-subdir`, `npm`, `archive`). The relative-path and directory cases are the ones tested above, and only through `validate`, not through an install.
- Docking engine behaviour in this app: React 19.3.1 compatibility, round trip with a missing block, drag over a native `WebContentsView`.
- The general-knowledge statements marked in the sections above.
