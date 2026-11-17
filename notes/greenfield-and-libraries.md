# Greenfield macOS shell and shared library choices

Date: 2026-11-17. Research only. Nothing was installed, built, run or cloned. Sources are package registries (npm, crates.io), the GitHub API through `gh api` (read-only), repository files fetched as raw text, and vendor documentation. Version, date, license and activity numbers are in the measurements table near the end; the prose avoids them.

Constraints applied from decision 0001: personal tool, macOS only, unmodified `claude` CLI under the user's own login, no Agent SDK, Jira through the claude.ai Atlassian connector, Claude Code 2.1.326.

## Recommendations

| Area | Choice | Fallback |
|---|---|---|
| Shell | Electron, with React and Vite (electron-vite or Electron Forge) | Tauri 2 |
| Terminal | node-pty in a utility process or main, xterm.js in the renderer | none needed |
| App-hosted MCP server | `@modelcontextprotocol/sdk` Streamable HTTP on 127.0.0.1 in the Electron main process | none |
| Code editor and LSP | Monaco with monaco-languageclient, language servers spawned from main and bridged over a localhost WebSocket | CodeMirror 6 with `@codemirror/lsp-client` |
| TypeScript language server | `typescript-language-server` on TypeScript 6.0.x, or the native TypeScript 7 server | the other of the two |
| Kotlin language server | JetBrains `kotlin-lsp`, treated as a recorded risk | Serena's JetBrains plugin backend (paid), or Gradle and compiler output only |
| Agent LSP and AST | Serena for symbol navigation and rename; `ast-grep` CLI for structural rewrite; ast-grep MCP for read-only structural search | none |
| Markdown model | `unified` with `remark-parse`, `remark-gfm`, `remark-frontmatter`, mdast with source positions, `mdast-util-to-markdown` for generated output only | Milkdown or MDXEditor for WYSIWYG |
| Markdown diff | text diff with `diff` or Monaco's diff editor for the source, plus a small mdast tree diff written in the app | `markdown-ast-diff` after review |
| HTML preview | sandboxed `<iframe sandbox>` with `srcdoc` or a custom-protocol URL, no preload, strict CSP | `WebContentsView` in its own session partition |
| Annotation | Excalidraw embed, `exportToBlob` for PNG | none; tldraw is excluded by license terms |
| Other agents | ACP over stdio with `@agentclientprotocol/sdk`: `codex-acp`, `gemini --acp`, `kimi acp` | the agent's own CLI in a PTY |
| Claude | `claude` in a PTY (interactive) as the main path, `claude -p` stream-json as a second path, per the Phase 0 probes | none |
| Task tree | `@headless-tree/core` and `@headless-tree/react` | `react-arborist`, or Atlassian pragmatic-drag-and-drop with its tree hitbox package |
| Persistence | SQLite (`node:sqlite` if Electron's Node exposes it, else `better-sqlite3`), adjacency list with a fractional-index position column | JSON files per task |
| Jira | through the agent and the connector only | none |
| GitHub | `gh` CLI with `--json`, and `gh api` for inline review comments | none |

## Shell: Electron versus Tauri

Facts from sources:

- Electron bundles Node and Chromium. Release 45.3.3 carries Node 24.22.3 and Chromium 156 (releases.electronjs.org). Electron's docs describe `utilityProcess` as a way to run Node code in a child process that can talk to a renderer over `MessagePort`, which fits language servers and the MCP server.
- node-pty is MIT in npm (GitHub reports no SPDX id because the LICENSE file is the original BSD-style text). Version 1.1.0 ships darwin-arm64 and darwin-x64 prebuilds (`pty.node`, `spawn-helper`) in the package. The latest stable release is from December 2025; a 1.2.0 beta line is on the `beta` npm tag with releases through October 2026, and the repository's last commits in October and November 2026 are CI and dependency work. The README states node-pty tracks the Node version VS Code uses.
- xterm.js 6.0.0 (MIT), maintained under the `@xterm` scope, with a GitHub push in November 2026.
- Tauri 2 uses WKWebView on macOS, so the web engine follows the macOS version. Rust PTY options: `portable-pty` (last release February 2025) and the community `tauri-plugin-pty` (small, license shown as NOASSERTION on GitHub, last push July 2026). The official Rust MCP SDK `rmcp` is current. Node-based language servers need a Node binary bundled as a Tauri sidecar, which needs target-triple-named binaries and shell-plugin capability entries.
- Electron's docs advise against the `<webview>` tag and name `iframe` and `WebContentsView` as alternatives.

Reasoning for Electron (judgment, medium confidence):

- The pieces this tool is made of are TypeScript libraries: xterm.js, node-pty, Monaco, monaco-languageclient, Excalidraw, the MCP TypeScript SDK and the ACP TypeScript SDK. In Electron they run in a Node process and a Chromium renderer, with no second language and no bridge layer.
- Language servers, `claude` and `gh` are child processes. Electron main or a utility process spawns them directly. In Tauri the same work goes through Rust commands and a bundled Node.
- Monaco and Excalidraw are developed and tested against Chromium. WKWebView differences are a risk that costs time and that Electron does not carry.
- Tauri's advantages are bundle size and memory. A personal macOS-only tool does not need small bundles. Memory was not measured and stays unverified.
- Both frameworks need the same macOS environment work for child processes: a GUI app does not inherit the login shell's PATH, so the app resolves PATH from the user's login shell (fish here) once at start.

Recommend Electron. Tauri remains the fallback if Electron memory proves a problem in Phase 2 measurements.

Packaging for a personal tool needs no notarization; ad-hoc local signing is enough. Not verified in this spike.

## Claude launch paths and the app MCP server

- The CLI flags that matter are documented in the CLI reference: `--input-format stream-json`, `--output-format stream-json`, `--include-partial-messages`, `--replay-user-messages`, `--mcp-config`, `--strict-mcp-config`, `--permission-prompt-tool`, `--permission-prompts`, `--session-id`, `--resume`, `--settings`, `--bare`, `--bg`, `claude attach`.
- The MCP docs state that a JSON entry with `url` and no `type` is read as stdio and is a configuration error, so the app writes `"type": "http"`.
- `claude -p` cannot run MCP OAuth; sign-in happens once in an interactive session or with `claude mcp login <name>`.
- The MCP SDK's license file says the project is moving from MIT to Apache-2.0, with mixed licensing during the transition. The npm package reports MIT.
- Whether `--strict-mcp-config` excludes claude.ai connectors is not stated in the MCP page text read here. This stays a Phase 0 probe (P2).

## Code browsing

Monaco with monaco-languageclient:

- Monaco is MIT, with releases through September 2026 and pushes in November 2026.
- monaco-languageclient 11.x is MIT, from TypeFox. Since version 2 it depends on `@codingame/monaco-vscode-api`, which now spans many packages that move in lockstep with a given `monaco-editor` version (the project README lists the matching versions). The README's connection examples use WebSocket (through `vscode-ws-jsonrpc`) and web workers; MessagePort is not mentioned there.
- Consequence: language servers run in Electron main, speak stdio, and a small WebSocket bridge on 127.0.0.1 with a token connects each to the renderer. This is the documented pattern, so it carries the least risk.
- Cost: the version lockstep and the VS Code services layer are the main upgrade burden. Monaco brings hover, rename, references, peek, symbols, code actions and a diff editor.

CodeMirror 6 with `@codemirror/lsp-client`:

- The official client is MIT. Its source covers completion, definition, diagnostics, formatting, hover, references, rename and signature help. The `Transport` interface is three functions (`send`, `subscribe`, `unsubscribe`), so wiring to IPC is short.
- The CodeMirror and ProseMirror repositories on GitHub are archived mirrors; the READMEs say development moved to code.haverbeke.berlin. The npm packages continue to release (lsp-client in November 2026). A single maintainer leads both projects.
- It lacks document-symbol outline, code actions and call hierarchy in the source listing read here, so it covers less of "IDE-grade" than Monaco does.

Recommendation (judgment): Monaco for code and for text editing, with CodeMirror 6 as the fallback if monaco-vscode-api lockstep blocks upgrades. One editor keeps R9 and R11 on the same surface (Monaco's diff editor serves R5 and R11).

TypeScript as the pass gate:

- `typescript-language-server` 6.1.0 (Apache-2.0 on npm; GitHub shows NOASSERTION) is a thin LSP layer over `tsserver` and uses the workspace's TypeScript. Its dev dependency is TypeScript 6.0.3.
- npm `latest` for `typescript` is now the native 7.0.x package, whose `bin` lists only `tsc`. The `typescript-go` repository's README says its language service is in progress. Serena's docs say it installs the TypeScript 7 native server through npm under the language name `typescript_tsgo`. Which server binary the 7.0.2 package exposes for LSP, and whether `typescript-language-server` 6.1.0 runs on it, is not verified. Safe path for the gate: TypeScript 6.0.x with `typescript-language-server`.
- Gate test: open a multi-file TypeScript project in the app, go to definition across files, and see diagnostics update after an edit made by the agent.

Kotlin language servers:

- JetBrains `Kotlin/kotlin-lsp` is an official project in alpha, built on IntelliJ and proprietary Air and Fleet parts, so partly closed source. The repository is a read-only mirror (no contributions accepted). Supports Gradle and Maven JVM projects, experimental Android Gradle Plugin support; Kotlin Multiplatform is not yet supported. Features: completion, diagnostics, quick fixes, rename, organize imports, hover, call hierarchy, formatting.
- Build expiry is an open problem. Serena's Kotlin adapter says newer builds "keep expiring after a short period of time" and keeps the default at an older version until JetBrains ships a non-expiring build. The Kotlin LSP issue tracker has repeated reports titled "This build of intellij-server has expired" (the latest open one in November 2026 reports an expired JetBrains license message), and issues that RELEASES.md lists expired builds.
- The older community server `fwcd/kotlin-language-server` (MIT) has had no push since June 2025.
- For Kotlin and Gradle projects the LSP is therefore a recorded risk. It works only while a current build is available, and a stale build stops working on its own. The R9 score for Kotlin is capped by this.
- The license text in the repository is Apache-2.0; the binary's terms beyond that were not read.

## How an agent gets LSP and AST

Serena (`oraios/serena`):

- Mixed license: the Serena application is GPL-3.0-or-later and its `solidlsp` component is MIT; a combined distribution is GPL as a whole, and contributions require a CLA. Running Serena as a separate MCP server process that the app and `claude` talk to does not link it into the app. Check this with the license text before any distribution; for personal use it creates no obligation.
- Python tool installed with `uv tool install serena-agent`; it runs as an MCP server over stdio or HTTP. Its docs list clients and say Claude Code has a `claude-code` context and hooks for tool discovery, and they warn against installing it through marketplaces.
- Symbol tools in the source: get symbols overview, find symbol, find referencing symbols, find implementations, find declaration, get diagnostics for a file and for a symbol, replace symbol body, insert before and after symbol, rename symbol, safe delete symbol. Rename and the others use LSP, so quality depends on the language server. The JetBrains plugin backend adds move, inline and safe-delete and is paid.
- It collects anonymous usage data at start (version, OS, interface, backend, dashboard, context); `SERENA_USAGE_REPORTING=false` turns it off. The docs say no project data leaves the machine.
- Most commits come from a small maintainer group; pushes continue daily in November 2026.
- Kotlin goes through the JetBrains LSP above, so the expiry risk applies. TypeScript uses `typescript-language-server` by default or the native server.

ast-grep:

- The `ast-grep` CLI is MIT and actively released. `ast-grep run -p <pattern> -r <rewrite> -U` rewrites matches in place; `--json` gives structured matches; `--interactive` is a human mode. This is the AST refactor path for the agent: it calls the CLI from Bash with rewrite flags.
- `ast-grep/ast-grep-mcp` is MIT per GitHub (its README states no license) and calls itself experimental. Its tools are `dump_syntax_tree`, `test_match_code_rule`, `find_code` and `find_code_by_rule`. All of them search or inspect; none rewrite. It needs the `ast-grep` binary and `uv`. Recent commits are dependency updates.
- The README shows Cursor and Claude Desktop configuration; Claude Code setup is not covered but uses the same `mcpServers` shape.

The spike plan's check "agent renames a symbol through each" resolves as: Serena `rename_symbol` for LSP-backed rename, `ast-grep` CLI for pattern rewrite, ast-grep MCP not applicable for rewrite.

## Documents

Markdown document model:

- unified and the mdast ecosystem are MIT. `mdast-util-from-markdown` was released in October 2026 and `mdast-util-to-markdown` in November 2026; `remark` and `unified` core have been stable since 2023 and 2024. mdast nodes carry source positions, which allows edits as text patches by offset, so unrelated formatting survives.
- `mdast-util-to-markdown` normalizes output (list markers, emphasis, escapes). Use it for generated fragments only, and apply user and agent edits as text.
- ProseMirror (MIT) is the base of Tiptap and Milkdown. Tiptap's `@tiptap/markdown` (MIT in npm) parses with `marked`, and its docs call it an early release; comments are unsupported and table cells hold one child only. Milkdown (MIT, 7.23 in October 2026, push November 2026) is ProseMirror plus remark, so its model is mdast-backed. MDXEditor (MIT, 4.5.0 in November 2026) is Lexical plus mdast. Lexical (MIT, Meta) is still pre-1.0 (0.53) with frequent releases; `@lexical/markdown` uses transformer rules, not mdast.
- Recommendation (judgment): source in Monaco, mdast as the model for outline, links, front matter, checkbox state and structural features, rendered preview next to it. WYSIWYG is optional; if wanted, Milkdown or MDXEditor keep an mdast model. Round-trip fidelity of any WYSIWYG editor against the user's real Markdown files must be tested before use.

Structural diff of Markdown:

- No widely used npm library was found. Candidates: `markdown-ast-diff` (MIT, 1.0.2 in November 2026, uses a BULD tree diff, can run as a remark plugin; repository and maintenance not checked), `mddiff` (experimental, by its own description), `@tdurieux/dinghy-diff` (generic tree diff). Low confidence on all three.
- Plan: block-level diff keyed by heading path and block index over mdast, with the text diff inside changed blocks; about the size of the `pi-mdiff` approach found in search. Budgeted as app work in the scores.

HTML preview in a sandbox:

- Use `<iframe sandbox>` with `srcdoc` (no `allow-same-origin`, no `allow-scripts` by default, a toggle for scripts) or a `WebContentsView` in its own session partition with no preload, `nodeIntegration` off, and CSP. Electron docs recommend against `<webview>`. This was not exercised.

## Annotation

- `@excalidraw/excalidraw` is MIT. Latest stable on npm is 0.18.1 (April 2026), with `0.18.0-<hash>` builds under the `next` tag almost weekly, and the repository has many commits per week. Peer dependencies accept React 17, 18 and 19. Docs now live under plus.excalidraw.com (308 redirect from docs.excalidraw.com).
- `exportToBlob({ elements, appState, files, mimeType })` returns a PNG by default; `exportToCanvas` and `exportToSvg` exist; `appState.exportBackground`, `viewBackgroundColor` and `exportEmbedScene` control the output. Images enter the scene through the `files` map. The container needs non-zero size.
- By default fonts load from a CDN (esm.run). For a local tool, copy the `dist/prod/fonts` folder into the app and set `window.EXCALIDRAW_ASSET_PATH`, so no network request is made.
- tldraw: the repository license (LICENSE.md) allows use in development environments and forbids production use without a trial or commercial license. Its license page lists a 100-day trial, a commercial license, and a discretionary hobby license for non-commercial projects that requires a "made with tldraw" watermark; whether the hobby license is free is not stated. The page does not use the term "personal use". A personal tool would need a hobby license granted by tldraw, so it does not meet the "works today" test. Excluded.

## Agents and ACP

- ACP TypeScript SDK `@agentclientprotocol/sdk` is Apache-2.0. The docs recommend the fluent `client()` and `agent()` APIs; `ClientSideConnection` and `AgentSideConnection` are deprecated. A client registers `onRequest` and `onNotification` handlers and calls `connectWith(stream, ctx => ...)`, then `ctx.request(methods.agent.session.new, params)`. The default import is protocol v1; v2 entrypoints are marked experimental. The SDK publishes new minor releases about weekly, so the app locks its dependency versions in its lockfile and upgrades on purpose.
- Codex: `@agentclientprotocol/codex-acp` (Apache-2.0 in package.json and README; GitHub's license detector shows NOASSERTION). It starts the Codex App Server and bundles `@openai/codex`; `CODEX_PATH` overrides the binary. Auth by ChatGPT login or API key. It is active (push on 2026-11-16). The release notes text returned by the fetch tool for this repo matched the SDK's version number and may be mixed up; low confidence on release details.
- Gemini CLI: `gemini --acp` is documented in the Gemini CLI docs (stdio JSON-RPC, session modes, MCP extension, file-system proxy). Repository Apache-2.0, very active.
- Kimi: the Python `MoonshotAI/kimi-cli` is archived and points to `MoonshotAI/kimi-code` (MIT, TypeScript, release 2.6.2 on 2026-11-13). Kimi's docs describe `kimi acp`: JSON-RPC over stdio, login first with `/login`, sessions (new, load, resume, list, fork, close, prompt, cancel), file read and write, terminal control, permission requests, image prompts, and forwarding of client-declared MCP servers over HTTP, SSE and stdio. Gaps listed: no audio, blob resources dropped, `session/fork` ignores `cwd`. The ACP registry page links the archived repository, so link rot exists. Not tested by running.
- Claude ACP adapter `@agentclientprotocol/claude-agent-acp` (Apache-2.0; the Zed repository path redirects here) is built on `@anthropic-ai/claude-agent-sdk`, declared as an exact-version runtime dependency. The SDK's npm license field reads "SEE LICENSE IN README.md" and the license text was not extracted. The adapter runs a `claude` binary from `CLAUDE_CODE_EXECUTABLE`, from next to itself, or from the SDK's platform package, so it can drive an installed `claude`. It is still an Agent SDK integration. Decision 0001 says this tool does not use the Agent SDK, so Claude does not go through this adapter. Claude uses a PTY or `claude -p` stream-json.
- Through ACP the app passes its MCP server in `session/new` `mcpServers`, so Codex, Gemini and Kimi get the same UI tools as Claude (R8). Per Kimi's docs HTTP, SSE and stdio are forwarded; for Gemini and Codex this is not verified here.
- Fallback for any agent: run its own CLI in a PTY, which gives no structured events.

## Task tree and persistence

- `@headless-tree/core` and `/react` 1.8.0 (MIT) cover sync and async data loaders, selection, drag and drop (reparenting by horizontal offset, dragging in and out, keyboard drag and drop), renaming, search and virtualization per its docs. Single maintainer (`lukasbach`), moderate star count. The docs read here did not show the `onDrop` and ordering details; read them in the slice.
- `react-arborist` 4.0.1 (MIT, push 2026-11-15) is a ready tree with drag and drop, single maintainer.
- Atlassian pragmatic-drag-and-drop 4.0.0: npm says Apache-2.0; GitHub reports NOASSERTION. It is a drag and drop primitive with a tree hitbox helper, not a tree component.
- `@dnd-kit/react` is at 0.5.x, the older `@dnd-kit/core` has had no release since December 2024. Not recommended as a base for a tree.
- Persistence: SQLite fits a tree with order and moves. Node 24 documents `node:sqlite` as a release candidate (stability 1.2) with no flag; whether Electron 45's Node build exposes it is not verified. `better-sqlite3` 13.x (MIT, release in November 2026) is native and needs an Electron rebuild (`@electron/rebuild`). Schema: `node(id, parent_id, position, kind, title, session_id, source_ref, created_at)`, with `position` from the `fractional-indexing` package (CC0), so a move updates one row. Claude's own transcripts stay in `~/.claude/projects/...` and the app stores session ids only.
- A files option (one JSON file per task) is simpler and diff-friendly but needs its own consistency handling for moves; use it only if SQLite packaging causes trouble.

## Jira and GitHub

Jira:

- The app has no Jira client. Claude Code fetches claude.ai connectors itself in terminal, IDE and Agent SDK sessions, but only when the active auth method is a claude.ai subscription login. Connectors do not load when `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `apiKeyHelper`, a third-party provider, an Anthropic profile, or a `claude setup-token` token is active.
- OAuth for a connector runs in an interactive session (`/mcp`) or with `claude mcp login <name>`; `claude -p` cannot run it. The app should therefore launch `claude` with a clean environment (no API key variables) and provide a first-run screen that runs the login once in a PTY.
- Task start from a Jira key: the app starts a session whose first prompt names the key and tells the agent to read it through the Atlassian connector. A ticket picker or search inside the app would need a headless `claude -p` call per query (latency and usage cost) or a typed key only. The app cannot call connector tools directly. The Atlassian server on this machine reports its v1 endpoint as deprecated (removal 2027-03-01); the connector is re-added in claude.ai when needed.

GitHub:

- `gh pr view <number|url> --json ...` offers a field list that includes `files`, `reviews`, `latestReviews`, `reviewDecision`, `statusCheckRollup`, `comments`, `headRefName`, `baseRefName`, `mergeable`, `closingIssuesReferences`. `gh pr list --json`, `gh pr diff`, `gh pr checkout` and `gh pr checks` cover list, diff, checkout and checks. Inline review comments are not in `gh pr view --json`; read them with `gh api repos/{owner}/{repo}/pulls/{n}/comments`, and create reviews with `gh api`.
- `gh` is MIT and released frequently. It uses the user's existing login; the app stores no token.
- Starting a task from a PR: `gh pr view --json headRefName,...`, create a worktree for the branch with `git`, start the session there.
- Safety rule from the spike plan applies: never start `claude` in a PR checkout without `--setting-sources user --strict-mcp-config`.

## Scores for the greenfield base

Score 3 means the chosen libraries cover the requirement and the remaining work is wiring and UI. Effort is working days for one engineer plus agents to reach 3. Estimates come from documentation and source reading only; each has a wide margin, and R9 and R11 have the widest.

| Req | Score | Effort days | Basis |
|---|---|---|---|
| R1 desktop GUI | 3 | 4 | Electron, React, Vite, split panes, menus, layout persistence, local packaging |
| R2 attach context | 2 | 5 | Attachment tray, drag and drop, paste, agent output as a quoted item. How attachments reach the interactive TUI (an `@path` reference typed into the PTY, or an image path) is a Phase 0 probe; stream-json takes content blocks |
| R3 image annotation | 3 | 3 | Excalidraw embed, local fonts, `exportToBlob` to a file in the attachment tray |
| R4 agents | 2 | 10 | Claude in a PTY is direct. ACP client UI (message stream, permission dialog, plan, terminals) for Codex, Gemini and Kimi is the work; Kimi and codex-acp behavior untested |
| R5 GitHub PRs | 3 | 6 | `gh --json` lists and details, Monaco diff editor, checks, inline comments via `gh api` |
| R6 task tree and starts | 2 | 10 | headless-tree, SQLite, drag and persist, three start flows. Jira picker limited by the connector path |
| R7 reuse Claude features | 3 | 2 | The unmodified CLI loads its own skills, plugins, marketplace and connectors in interactive mode. Work is the clean-environment launch, first-run login and checks that `--strict-mcp-config` keeps what is wanted |
| R8 UI parity through MCP | 3 | 6 | One command registry drives both UI and MCP tools, so parity is by construction. Token, Origin check, `type: http` entry, ACP `mcpServers` pass-through |
| R9 LSP and agent AST | 2 | 12 | Monaco and monaco-languageclient with main-process servers (TypeScript about 5 days, Kotlin about 4 days with the expiry risk), Serena and ast-grep wiring about 3 days |
| R10 build tools by CLI | 3 | 2 | node-pty and xterm.js tabs, login-shell PATH, working directory per task. Weight 1 |
| R11 Markdown and HTML | 2 | 12 | Monaco source editing, rendered preview, sandboxed HTML preview, mdast outline, own structural diff. WYSIWYG is not included |

Baseline for forks: the sum of the effort column. Weighted score uses the plan's weights (R1, R2, R4, R5, R6, R7, R8 weight 3; R9 and R11 weight 2; R3 and R10 weight 1).

| Baseline (2026-11-17) | Value |
|---|---|
| Sum of effort_days | 72 |
| Weighted score | 68 |

Reading for the decision rule: no must-have scores below 2.

## Measurements (2026-11-17)

Source columns: npm = registry.npmjs.org latest tag; GH = GitHub API; "push" is `pushed_at`.

| Item | Version or tag | Release or push date | License | Other |
|---|---|---|---|---|
| electron | 45.3.3 | release 2026-11-14 | MIT | Node 24.22.3, Chromium 156.0.8078.100; GH stars 123942 |
| tauri | tauri-v2.12.6 | release 2026-11-16 | Apache-2.0 (GH; MIT dual not checked) | GH stars 112942 |
| node-pty | 1.1.0 (beta 1.2.0-beta.18) | 2025-12-22 (beta 2026-10-23); push 2026-11-02 | MIT (npm), NOASSERTION (GH) | stars 2062 |
| @xterm/xterm | 6.0.0 | 2025-12-22; push 2026-11-16 | MIT | stars 21358 |
| monaco-editor | 0.57.0 | 2026-09-24; push 2026-11-13 | MIT | stars 46979 |
| monaco-languageclient | 11.0.3 | 2026-10-15 | MIT | stars 1376 |
| @codingame/monaco-vscode-api | 39.0.4 | 2026-11-09 | MIT | stars 521; README of languageclient lists 37.6.0 for the editor api |
| @codemirror/lsp-client | 6.3.1 | 2026-11-16 | MIT | GH repo archived 2026-04, moved to code.haverbeke.berlin |
| @codemirror/view | 6.43.15 | 2026-10-19 | MIT | |
| @codemirror/merge | 6.12.3 | 2026-10-19 | MIT | |
| typescript-language-server | 6.1.0 | 2026-11-12 | Apache-2.0 (npm), NOASSERTION (GH) | stars 2603 |
| typescript (npm latest) | 7.0.2 | 2026-07-08 | Apache-2.0 | `bin` lists `tsc` only; TS 6.0.3 released 2026-04-16 |
| Kotlin/kotlin-lsp | v271.2085.0 | 2026-11-12; push 2026-11-17 | Apache-2.0 (LICENSE.txt), binary partly closed | alpha; stars 3546 |
| fwcd/kotlin-language-server | n/a | push 2025-06-02 | MIT | stars 2047 |
| Serena | v2.1.0 | 2026-10-19; push 2026-11-15 | GPL-3.0-or-later app, MIT solidlsp | stars 31459 |
| ast-grep | 0.51.3 | 2026-11-16 | MIT | stars 16604 |
| ast-grep-mcp | no tagged release found | push 2026-11-14 | MIT (GH) | stars 498 |
| lexical | 0.53.0 | 2026-10-28; push 2026-11-17 | MIT | stars 24029 |
| @tiptap/core and @tiptap/markdown | 3.34.0 | 2026-11-13 | MIT | stars 39054 |
| @milkdown/kit | 7.23.0 | 2026-10-27; push 2026-11-16 | MIT | stars 12068 |
| @mdxeditor/editor | 4.5.0 | 2026-11-02 | MIT | stars 3722 |
| mdast-util-from-markdown | 2.1.0 | 2026-10-03 | MIT | |
| remark | 15.0.1 | 2023-09-18 | MIT | |
| markdown-ast-diff | 1.0.2 | 2026-11-04 | MIT | maintenance not checked |
| @excalidraw/excalidraw | 0.18.1 | 2026-04-20; next-tag build 2026-11-16 | MIT | stars 135833 |
| tldraw | 5.6.1 | 2026-11-16 | custom LICENSE.md, dev use only without key | stars 51447 |
| @headless-tree/react | 1.8.0 | 2026-10-15 | MIT | stars 910 |
| react-arborist | 4.0.1 | 2026-10-11; push 2026-11-15 | MIT | stars 3717 |
| @atlaskit/pragmatic-drag-and-drop | 4.0.0 | 2026-09-24 | Apache-2.0 (npm) | stars 12793 |
| better-sqlite3 | 13.2.0 | 2026-11-14 | MIT | engines node >=22 |
| @modelcontextprotocol/sdk | 1.32.2 | 2026-10-23 | MIT (npm), MIT to Apache-2.0 transition (LICENSE) | stars 13774 |
| @agentclientprotocol/sdk | 2.7.0 | 2026-11-14 | Apache-2.0 | stars 270 |
| @agentclientprotocol/claude-agent-acp | 0.107.3 | 2026-11-16 | Apache-2.0 | stars 2783; depends on claude-agent-sdk 0.3.325 |
| @anthropic-ai/claude-agent-sdk | 0.3.326 | 2026-11-16 | "SEE LICENSE IN README.md" | bundles platform `claude` binary as optional dependency |
| @agentclientprotocol/codex-acp | 2.7.0 | push 2026-11-16 | Apache-2.0 | stars 580; bundles @openai/codex ^0.166 |
| google-gemini/gemini-cli | v0.68.0 | 2026-11-10; push 2026-11-17 | Apache-2.0 | stars 108888 |
| MoonshotAI/kimi-code | @moonshot-ai/kimi-code@2.6.2 | 2026-11-13; push 2026-11-17 | MIT | stars 8245 |
| MoonshotAI/kimi-cli (Python) | n/a | push 2026-09-22 | Apache-2.0 | archived |
| cli/cli (gh) | v2.104.0 | 2026-11-12 | MIT | |
| rmcp (Rust MCP SDK) | 3.10.0 | 2026-11-12 | NOASSERTION (GH) | stars 4118 |
| portable-pty | 0.9.0 | 2025-02-11 | not checked | |
| tauri-plugin-pty | 0.3.1 | 2026-07-08 | NOASSERTION (GH) | stars 22 |
| fractional-indexing | 4.0.0 | 2026-06-25 | CC0-1.0 | |

## Not verified and low confidence

- Nothing was run. Every "works" claim is from docs, package metadata or source reading.
- Electron memory against Tauri, WKWebView differences, and Electron start time.
- How attachments (images, file references) are accepted by the interactive `claude` TUI through a PTY.
- Whether `--strict-mcp-config` excludes claude.ai connectors (the MCP page does not say).
- Which TypeScript 7 binary serves LSP in the 7.0.2 package and whether `typescript-language-server` 6.1.0 runs on it.
- Kotlin LSP behavior on Gradle projects, and the current build's expiry date.
- monaco-languageclient inside an Electron renderer with this bridge (documented pattern, not exercised); the exact peer versions of monaco-vscode-api for the Monaco version chosen.
- Kimi and Gemini ACP behavior with this client; codex-acp release notes (possible mix-up in the fetch result); whether Codex and Gemini accept HTTP MCP servers passed through ACP.
- The text of the Agent SDK license in its README; the binary terms of the Kotlin LSP build.
- `markdown-ast-diff` repository, maintainers and quality; headless-tree drop and ordering callbacks.
- Whether Electron 45's Node build exposes `node:sqlite`.
- Tauri license field (GitHub shows Apache-2.0; dual license not checked).
- tldraw hobby license price.
- Effort estimates are code-reading estimates with wide margins, widest for R9 and R11.

## Sandbox and tool notes

- No sandbox block occurred. WebFetch followed no cross-host redirects automatically; the Excalidraw docs redirect to plus.excalidraw.com was fetched manually.
- Third-party repositories were read through the GitHub API and raw files only. No candidate was cloned for this note.

## Sources

- ACP agents and libraries: https://agentclientprotocol.com/overview/agents, https://agentclientprotocol.com/libraries/typescript, https://github.com/agentclientprotocol/typescript-sdk, https://github.com/agentclientprotocol/codex-acp, https://github.com/agentclientprotocol/claude-agent-acp
- Kimi: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html, https://github.com/MoonshotAI/kimi-code, https://github.com/MoonshotAI/kimi-cli
- Gemini CLI: https://github.com/google-gemini/gemini-cli (docs/cli/acp-mode.md)
- Claude Code docs: https://code.claude.com/docs/en/mcp, https://code.claude.com/docs/en/cli-reference
- Electron: https://releases.electronjs.org/releases.json, https://www.electronjs.org/docs/latest/api/webview-tag, https://www.electronjs.org/docs/latest/tutorial/process-model
- Tauri: https://v2.tauri.app/develop/sidecar/, https://v2.tauri.app/reference/webview-versions/
- node-pty, xterm.js: https://github.com/microsoft/node-pty, https://github.com/xtermjs/xterm.js, https://unpkg.com/node-pty@1.1.0/prebuilds/?meta
- Monaco and CodeMirror: https://github.com/TypeFox/monaco-languageclient, https://github.com/CodinGame/monaco-vscode-api, https://github.com/codemirror/lsp-client (moved to code.haverbeke.berlin)
- Language servers: https://github.com/Kotlin/kotlin-lsp, https://github.com/Kotlin/kotlin-lsp/issues (search "expired"), https://github.com/typescript-language-server/typescript-language-server, https://github.com/microsoft/typescript-go
- Serena and ast-grep: https://github.com/oraios/serena (README, LICENSE, docs, source), https://github.com/ast-grep/ast-grep-mcp, https://ast-grep.github.io/reference/cli/run.html
- Documents: https://github.com/syntax-tree/mdast-util-from-markdown, https://tiptap.dev/docs/editor/markdown, https://github.com/Milkdown/milkdown, https://github.com/mdx-editor/editor, https://github.com/facebook/lexical
- Annotation: https://plus.excalidraw.com/docs/sdk/excalidraw/api/utils/export, https://plus.excalidraw.com/docs/sdk/excalidraw/installation, https://github.com/tldraw/tldraw/blob/main/LICENSE.md, https://tldraw.dev/community/license
- Task tree: https://github.com/lukasbach/headless-tree, https://github.com/jameskerr/react-arborist, https://github.com/atlassian/pragmatic-drag-and-drop, https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- GitHub: https://cli.github.com/manual/gh_pr_view
