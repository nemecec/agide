# Triage: VS Code extension as the base

Date of research: 2026-11-17. Reviewer scope: docs and samples only. Nothing from the samples repository was installed, built or run. microsoft/vscode was not cloned.

## Verdict in short

A VS Code extension hosts most of the requirements with stock parts: the editor, language features, diff, Markdown preview, the integrated terminal, tasks and the GitHub Pull Requests extension. It does not host a task-first layout. The task tree fits in a tree view with drag and drop, but each running session lives in a terminal or an editor tab outside that tree, and the user can rearrange the workbench. The Anthropic extension exposes no documented API to other extensions, so a task-tree extension starts its own `claude` processes in terminals. Reuse of connectors, skills and plugins comes with the unmodified CLI. The agent-drives-UI requirement needs an extension-hosted HTTP MCP server, because the `vscode.lm` MCP provider feeds VS Code's own chat and not the `claude` CLI.

## Evidence by area

### 1. Tree view with drag and drop

Sources:
- Sample: `candidates/vscode-extension-samples/tree-view-sample/src/testViewDragAndDrop.ts` and `tree-view-sample/package.json`
- API: [vscode.d.ts 1.100 types](https://unpkg.com/@types/vscode@1.100.0/index.d.ts), [Tree View guide](https://code.visualstudio.com/api/extension-guides/tree-view), [contribution points](https://code.visualstudio.com/api/references/contribution-points)

What the sample shows:
- The view is created with `window.createTreeView(id, { treeDataProvider, canSelectMany: true, dragAndDropController, showCollapseAll: true })`.
- The controller declares `dropMimeTypes = ['application/vnd.code.tree.testViewDragAndDrop']` and `dragMimeTypes = ['text/uri-list']`. `handleDrag` stores the dragged nodes in the `DataTransfer` under the tree's own MIME type. `handleDrop(target, sources, token)` reads them back, reparents them and fires `onDidChangeTreeData` with the old parents and the target.
- The sample tree is nested six levels deep, held in an in-memory object, and has no persistence. `getParent` is implemented, which `TreeView.reveal` needs.
- `TreeItem.id` keeps selection and expansion state across refreshes (doc comment in the typings: unique across the tree).

Limits found in the typings and docs:
- `handleDrop` receives the target element and the transferred data. It receives no insertion index, so manual ordering among siblings needs a convention (for example, drop onto a sibling means insert after it). This is my reading of the signature.
- `target` is `undefined` when the drop lands on the empty root area.
- `reveal` takes `select`, `focus` and `expand`; `expand` accepts a level count with a documented maximum.
- A row is a label, description, tooltip, icon, optional checkbox and a view-level badge. Actions are menu contributions (`view/title`, `view/item/context`, `inline` group). The docs I read describe no inline text editing, so rename goes through an input box. Medium confidence.
- Nested user-defined folders, persistence and sibling order are the extension's own data model. Natural storage is `ExtensionContext.globalState` or `workspaceState` (the MCP sample uses `globalState` for its list) or a JSON file under the extension's storage URI.
- `viewsWelcome` shows buttons in an empty tree, which suits "New task" entry points.

Placement:
- The contribution-points reference lists `activitybar` and `panel` for `viewsContainers`. The [UX guidelines](https://code.visualstudio.com/api/ux-guidelines/sidebars) say extensions cannot contribute views directly to the Secondary Side Bar by default and that users can drag views there.
- The Anthropic extension manifest (version 2.1.326, [Open VSX package.json](https://openvsx.eclipsecontent.org/Anthropic/claude-code/darwin-arm64/2.1.326/package.json)) declares a `secondarySidebar` view container guarded by a `when` clause on its own context key, next to `activitybar` containers. A `secondarySidebar` container is therefore accepted by current builds. The minimum VS Code version and the official documentation for it were not found. Medium confidence.
- A task tree in the Activity Bar works with documented parts. A tree in the Secondary Side Bar works as a user drag, or by the `secondarySidebar` contribution above.

### 2. How the Claude Code extension launches Claude and what it exposes

Sources: [Claude Code VS Code docs](https://code.claude.com/docs/en/vs-code), [IDE integrations](https://code.claude.com/docs/en/ide-integrations), [Open VSX listing](https://open-vsx.org/api/Anthropic/claude-code/latest), [manifest](https://openvsx.eclipsecontent.org/Anthropic/claude-code/darwin-arm64/2.1.326/package.json), [reverse-engineered protocol notes](https://raw.githubusercontent.com/coder/claudecode.nvim/main/PROTOCOL.md), [issue 30417](https://github.com/anthropics/claude-code/issues/30417).

Launch:
- The docs state the extension "bundles its own copy of the CLI" for the chat panel. Settings: `useTerminal` (graphical panel or terminal), `claudeProcessWrapper` (executable that launches the Claude process; the bundled binary path is passed as an argument), `environmentVariables`.
- The docs do not name the transport. Issue 30417 quotes extension log lines "Spawning Claude with SDK query function". A search over issue reports returned command lines with `--output-format stream-json --input-format stream-json` run against `resources/native-binary/claude`. The extension is closed source ("All rights reserved"), so the exact argument list is not verified. Medium confidence that the chat panel uses stream-json and not a PTY.
- Terminal mode runs the CLI in a terminal.

The `ide` MCP server:
- The extension runs a local WebSocket MCP server named `ide`: `ws://127.0.0.1`, random port in 10000-65535 (not configurable), token in `~/.claude/ide/<port>.lock` (0600 in a 0700 directory), header `X-Claude-Code-Ide-Authorization`. `CLAUDE_CONFIG_DIR` moves the lock directory.
- Model-visible tools: `mcp__ide__getDiagnostics` (Problems panel, read-only) and `mcp__ide__executeCode` (Jupyter, behind a Quick Pick). The remaining IDE tools are internal RPC for the CLI's own UI. The chat panel has a separate in-process server `claude-vscode` with `mcp__claude-vscode__getDiagnostics` from extension v2.1.285.
- The community protocol notes list IDE-to-CLI notifications `selection_changed` and `at_mentioned`, plus tools such as `openFile`, `openDiff`, `getOpenEditors`, `getWorkspaceFolders`, `getCurrentSelection`. Environment variables `CLAUDE_CODE_SSE_PORT` and `ENABLE_IDE_INTEGRATION`. This is not an official specification.

Context attach:
- Automatic selection and open-file context (`attachSelection`, `attachOpenFile`), Alt+K / Option+K inserts `@file#lines`, `@`-mentions of files, folders and `@terminal:name`, pasted images, Shift-drag of files into the prompt box.
- Files matching `files.exclude`, `search.exclude` or git-ignored paths send only the path in the chat panel.

Hooking from a second extension:
- No documented API. The manifest declares no `languageModelTools`, `chatParticipants` or `extensionDependencies`. Whether the extension returns an `exports` object from `activate` cannot be read from the manifest.
- The commands exist and are callable through `commands.executeCommand`: `claude-vscode.editor.open` (issue reports give the arguments session id, initial prompt, view column; the prompt is pre-filled and not submitted), `claude-vscode.sidebar.open`, `claude-vscode.insertAtMention`, `claude-vscode.terminal.open`, `claude-vscode.newConversation`. Issue reports describe `openLast` and `primaryEditor.open` failing with "command not found", and `insertAtMention` stealing focus. These are an unsupported contract.
- A URI handler `vscode://anthropic.claude-code/open?prompt=...&session=...` is documented. It pre-fills a prompt and does not submit it.
- The documented way to join the IDE bridge from elsewhere is a `claude` process in VS Code's integrated terminal, which connects to the extension's `ide` server automatically, or `/ide` from an external terminal.
- Consequence: a task-tree extension starts its own `claude` in a terminal it creates. The Anthropic extension's sessions list in the Activity Bar is Anthropic's UI and is not extensible.

VS Code's own Claude integration is separate. See area 7.

### 3. Extension-hosted MCP server and registration

Sources: [MCP extension guide](https://code.visualstudio.com/api/extension-guides/ai/mcp), sample `mcp-extension-sample/src/extension.ts`, [Claude Code MCP docs](https://code.claude.com/docs/en/mcp), [tjx666/vscode-mcp](https://github.com/tjx666/vscode-mcp).

- `vscode.lm.registerMcpServerDefinitionProvider(id, provider)` with `contributes.mcpServerDefinitionProviders` registers stdio or Streamable HTTP definitions. The guide says eligible definitions are forwarded to Copilot sessions and that the extension is not available in a standalone runtime. Nothing in the guide says the `claude` CLI reads these registrations. The sample returns `McpStdioServerDefinition` objects fetched from gists. The sample's `package.json` declares `engines.vscode ^1.101.0`; the source comment mentions proposed API but the code uses `vscode.lm` directly.
- For `claude`, the registration path is the CLI's own configuration: `claude mcp add --transport http <name> <url>` or a JSON file passed with `--mcp-config`. An HTTP entry needs `"type": "http"`; an entry with `url` and no type is skipped with an error. `Authorization` headers and `${VAR}` expansion are documented. Credential-looking variables such as `ANTHROPIC_API_KEY` expand to empty in remote `url` and `headers`, so a per-session token goes under a custom variable name.
- The extension host is a Node process, so it can listen on 127.0.0.1 (plan rule: per-session token, Origin check). Hosting an HTTP server in the extension host is not described in the docs; this is a design inference from the runtime.
- Calling `vscode.commands.executeCommand` from a tool handler is allowed by the API ("Commands from other extensions and from the editor itself are accessible to an extension"). Prior art: `tjx666/vscode-mcp` ships an `execute_command` tool, `open_files`, `get_diagnostics`, `rename_symbol`, `get_references`, using a Unix socket between an MCP server and a VS Code extension. Its license is the Anti 996 License. Open file maps to `vscode.open`. Reveal in the tree maps to `TreeView.reveal` held by the extension, which no built-in command reaches.
- Connectors: Claude Code fetches claude.ai connectors in terminal and VS Code sessions when the active login is a claude.ai subscription. They are not loaded when `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, a third-party provider or a `setup-token` credential is active. A `claude -p` run cannot run the OAuth flow, so sign-in happens in an interactive session. Whether `--strict-mcp-config` excludes connectors is not stated in the part of the page I read.

### 4. Webviews, custom editors, Markdown, HTML

Sources: [Webview guide](https://code.visualstudio.com/api/extension-guides/webview), [Custom editors guide](https://code.visualstudio.com/api/extension-guides/custom-editors), [Markdown extension guide](https://code.visualstudio.com/api/extension-guides/markdown-extension), [Markdown in VS Code](https://code.visualstudio.com/docs/languages/markdown), samples `custom-editor-sample`, `webview-sample`, `webview-view-sample`.

- Webviews: scripts need `enableScripts`; a CSP is expected; local files load through `asWebviewUri` from `localResourceRoots`; the page talks to the extension by `postMessage`; workers load only from `data:` or `blob:` URIs; `retainContextWhenHidden` has high memory cost; state is lost on destroy unless saved. Webviews can sit in the editor area (panel or custom editor) or in a sidebar or panel (`WebviewViewProvider`).
- Excalidraw: an existing custom editor, `pomdtr.excalidraw-editor` from [excalidraw/excalidraw-vscode](https://github.com/excalidraw/excalidraw-vscode), opens `.excalidraw` files. Annotating an existing image and exporting a PNG for attachment needs a new editor: a `CustomEditorProvider` for image files that loads the image into Excalidraw, exports PNG through a blob or data URI, and writes it with `workspace.fs`. Not built or tested here.
- Custom editor model: `CustomTextEditorProvider` uses VS Code's `TextDocument`; VS Code handles save, backup and hot exit and the webview applies `WorkspaceEdit`s (see `catScratchEditor.ts`). `CustomEditorProvider` owns its document, undo/redo events, save and backup (see `pawDrawEditor.ts`). The docs I read do not describe diff for custom editors.
- A document model (mdast, ProseMirror or Lexical) lives inside the webview. VS Code offers no Markdown AST API; the only parser hook is the markdown-it instance passed to `extendMarkdownIt` for the preview.
- Built-in Markdown: preview side by side with scroll sync, outline from headings, link validation (opt-in), image drop and paste with copy into the workspace, and an opt-in rendered diff through `workbench.diffEditorAssociations`. Preview default security level blocks script execution.
- HTML preview: no built-in local HTML preview was found in the pages I read. A sandboxed preview in a webview is possible but its fit (CSP, relative assets) was not tested. Low confidence.

### 5. LSP and AST

Sources: [built-in commands](https://code.visualstudio.com/api/references/commands), [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference), search results for [Serena](https://mcp.directory/blog/serena-mcp-complete-guide-2026) and VS Code MCP bridges.

- Code browsing, go to definition, references, symbol search, rename, call hierarchy and diagnostics are built in for languages with an installed extension.
- Commands an MCP bridge can call: `vscode.executeDefinitionProvider`, `vscode.executeReferenceProvider`, `vscode.executeDocumentSymbolProvider`, `vscode.executeWorkspaceSymbolProvider`, `vscode.executeHoverProvider`, `vscode.executeImplementationProvider`, `vscode.executeCodeActionProvider`, `vscode.executeFormatDocumentProvider`, `vscode.executeDocumentRenameProvider` (returns a `WorkspaceEdit`; the bridge applies it with `workspace.applyEdit`), `vscode.prepareCallHierarchy`, `vscode.provideIncomingCalls`, `vscode.provideOutgoingCalls`.
- The Anthropic extension's model-visible IDE tools cover diagnostics and notebook execution only.
- Claude Code reads language servers from plugins (`lspServers`, `.lsp.json`, with optional diagnostics pushed after edits), independent of the editor.
- Serena works as a stdio MCP server with its own language servers. Setup notes for VS Code come from third-party guides; I did not check the Serena repository.
- Community VS Code extensions already expose these commands as MCP tools (listings found: `tjx666/vscode-mcp`, `CJL.lsp-mcp`, `aaddrick/vscode-mcp-language-server`). Not read in depth.
- Kotlin language support in VS Code depends on an extension. Not checked.

### 6. Jira and GitHub

- Jira: the claude.ai Atlassian connector reaches `claude` sessions started in terminals through the connector fetch described in area 3. The tree extension supplies the key and an initial prompt; the model fetches the ticket. A tree label with the ticket title needs a model-side step or a later rename. Not tested.
- GitHub: the [GitHub Pull Requests extension](https://github.com/microsoft/vscode-pull-request-github) provides PR checkout, in-editor review comments and issue actions. The API file in its repository (`src/api/api.d.ts`) declares a Git provider API, `getRepositoryDescription` with an optional pull request (title, url, number, id), and title/description and reviewer-comment provider registration. I found no query API for PR lists or review threads. Whether the extension contributes language model tools was not found. An agent reads PRs through `gh` or a GitHub MCP server. A task from a PR URL is `gh pr checkout` into a worktree plus a `claude` terminal.

### 7. What the UI forbids and 2026 changes

Sources: [Agents window](https://code.visualstudio.com/docs/agents/run/agents-window.md), [Choose an agent harness](https://code.visualstudio.com/docs/copilot/agents/third-party-agents), [Manage agent sessions](https://code.visualstudio.com/docs/chat/chat-sessions), [Agent Host architecture](https://code.visualstudio.com/blogs/2026/08/26/agent-host-architecture), [UX guidelines for sidebars](https://code.visualstudio.com/api/ux-guidelines/sidebars), [using proposed API](https://code.visualstudio.com/api/advanced-topics/using-proposed-api).

- Window chrome and layout: the extension API pages I read contain no call to restyle the title bar or window, or to set layout. Views are placed by contribution and the user moves them. Workbench commands are reachable through `executeCommand`, but I did not find a list that covers layout. A task-first layout is therefore a convention the extension proposes, not one it enforces.
- Terminal: `createTerminal` options and `sendText` are stable. `Terminal.shellIntegration.executeCommand` is used in `shell-integration-sample` with no API proposal enabled. `window.onDidWriteTerminalData` sits behind the `terminalDataWriteEvent` proposal in `terminal-sample`. Proposed APIs run only in Insiders or with `--enable-proposed-api` and cannot be published to the Marketplace. Reading the TUI output of `claude` in a stock terminal is therefore not available in stable. Session state for the tree would come from Claude Code hooks or transcript files. That design was not tested.
- Extension-owned PTY: `extension-terminal-sample` creates a terminal over a `Pseudoterminal`. Whether `node-pty` can be bundled in the extension host was not checked.
- Agents window: a separate VS Code window with Primary Side Bar (sessions across projects, Automations, Customizations), session grid and Secondary Side Bar (Files, Changes, Search, Browser). The docs describe no extension API to add views or agent types to it. Claude and Codex harnesses are disabled when enterprise-managed settings apply. Codex sessions from the OpenAI extension run in the main window. Local harness sessions run in the main window only. Local harness is listed as deprecated.
- VS Code's built-in Claude harness runs on the Claude Agent SDK through the Agent Host, billed through Copilot or a bring-your-own key, and without GitHub sign-in uses an API key. It is not the user's Claude subscription through the unmodified CLI. For this tool it is a neighbouring product.
- Agent Host Protocol: open, with client libraries listed for Rust, TypeScript, Kotlin, Go and Swift, and `code agent host` for a standalone host. That is relevant to other bases and not to the extension option.
- Chat sessions docs say Claude Code and other external local sessions can be opened in either interface through an "External" filter. The Anthropic extension is not named there.
- Restrictions on third-party Claude integrations in the VS Code docs: none found for extensions starting `claude`. Anthropic's [legal page](https://code.claude.com/docs/en/legal-and-compliance) allows an end user to sign in to the unmodified binary with their own subscription, including on a platform that hosts it. The Anthropic extension license is "All rights reserved".

## Scores and effort

Scores follow the 0-3 scale from the plan. Effort is working days for one engineer plus agents to reach 3. These estimates rest on reading, not on running code.

| Req | Score | Effort days | Basis |
| --- | --- | --- | --- |
| R1 Desktop GUI | 3 | 0 | VS Code is the desktop GUI. Layout limits are scored in R6. |
| R2 Attach context | 2 | 4 | Anthropic extension attaches files, selections, images, terminal output. A tree-owned `claude` terminal needs its own attach: `sendText` of `@path` references, files for agent output, own `at_mentioned` over the ide protocol is optional. |
| R3 Image annotation | 2 | 5 | Webview with Excalidraw and PNG export to the workspace; no existing editor annotates an arbitrary image. |
| R4 Agents | 3 | 0 | `claude` runs unmodified in a terminal under the user's login. Codex, Gemini and Kimi CLIs run in terminals. Kimi through ACP not found. Session tracking is scored in R6. |
| R5 GitHub PR | 2 | 3 | PR extension covers browse, checkout and review UI. No PR data API found; task start from a PR needs `gh` and worktree glue. |
| R6 Task tree | 2 | 10 | Tree view with drag and drop and nested folders is documented and sampled. Persistence, sibling ordering, session-to-terminal mapping, resume, status from hooks and the start paths from prompt, PR and Jira are new code. No task-first layout. |
| R7 Connectors, skills, plugins | 3 | 0 | Unmodified CLI in a terminal. Subscription login required for connectors. |
| R8 UI parity through MCP | 2 | 6 | Extension-hosted HTTP MCP with token and Origin check; tools map to commands and tree operations. Prior art has a generic `execute_command` tool. The `vscode.lm` provider does not serve `claude`. |
| R9 Code browsing and agent AST | 2 | 3 | Browsing is built in. Agent access needs a bridge over the `vscode.execute*Provider` commands, or Serena and ast-grep as MCP servers. Kotlin server not checked. |
| R10 Build tools by CLI | 3 | 0 | Integrated terminal and tasks. |
| R11 Markdown and HTML | 2 | 8 | Preview, side-by-side editing and opt-in rendered diff exist. Document model, WYSIWYG editing and HTML preview are webview work. |

Sum of effort days is in the measurements table.

## How an agent task tree would work

- Activity Bar container "Tasks" holding a tree view. Folder nodes and task nodes with `contextValue` for menus. Drag and drop moves nodes. State in `globalState` or a JSON file. `viewsWelcome` buttons: new task from prompt, PR URL, Jira key.
- Starting a task creates a terminal (`createTerminal` with `cwd`, name and environment) running `claude` with a per-task `--mcp-config` pointing at the extension's local HTTP server, and optionally `--resume <id>` for a stored session id. For a PR, a worktree is created first. For a Jira key, the initial prompt names the key.
- The terminal appears in the panel or editor area. The tree stores the terminal handle and reveals it on selection. Status (idle, waiting for permission, done) arrives through Claude Code hooks posting to the extension's local server. Not tested.
- The MCP tools expose folder create, move, rename, open file, reveal, start task, attach context and the LSP bridge. A parity table of UI actions to tools is the S3 slice.

## Not verified

- No code was run or built; sample behaviour is from reading source.
- Tree drag and drop with files dragged from Finder into the tree, and exact `TreeViewOptions` text (the typings fetch did not reach that block; use in the sample is confirmed).
- Inline rename in a tree row.
- Minimum VS Code version and official docs for `secondarySidebar` containers.
- Argument list of the Anthropic extension's `claude` spawn; closed source.
- Whether the Anthropic extension returns exports from `activate`.
- `createTerminal` editor-area location option, `node-pty` bundling, and `--strict-mcp-config` with connectors.
- Whether the GitHub Pull Requests extension contributes language model tools.
- Local HTML preview options (a Live Preview extension was not checked).
- Kimi CLI, ACP adapters for Kimi, Serena repository details, Kotlin language server support.
- VS Code release notes for 1.128 through 1.133 were read only through search summaries, not the notes themselves.
- Telemetry and auto-update behaviour of VS Code and of the Anthropic extension.
- Rendering, memory and start-time measurements for a webview-heavy extension.

## Measurements (dated 2026-11-17)

| Item | Value | Source |
| --- | --- | --- |
| vscode-extension-samples HEAD commit date | 2026-09-04 (65c1c44) | shallow clone |
| vscode-extension-samples license | MIT | `LICENSE` in clone |
| Anthropic extension version | 2.1.326, published 2026-11-16 | Open VSX |
| Anthropic extension `engines.vscode` | ^1.94.0 | Open VSX manifest |
| Anthropic extension license | All rights reserved | Open VSX |
| `ide` server port range | 10000-65535 | Claude Code docs |
| MCP sample `engines.vscode` | ^1.101.0 | sample `package.json` |
| tjx666/vscode-mcp | 105 stars, 19 forks, 237 commits, Anti 996 License | GitHub page |
| excalidraw-vscode | about 399 stars; 500,000+ installs for the editor extension (third-party aggregator) | search result, low confidence |
| VS Code 1.128 / 1.129 / 1.133 release dates | 2026-07-08 / 2026-07-15 / 2026-08-12 | trade-press search results, low confidence |
| Local harness removal | February 2027 | VS Code chat sessions docs |
| Effort days to reach 3, summed over requirements | 39 | table above (overlap between requirements not removed) |
