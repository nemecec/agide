# integrate

Start: 2026-11-17T09:24:43Z
End: 2026-11-17T09:31:48Z (about 7 minutes wall time)

## What was built

- The main process wiring was mostly in place from the builders: `modules.ts` initializes the SQLite tree, then the MCP server (which registers the `ui_*` tree commands and listens), then the PTY session service, which grants each session access and passes `--mcp-config` on every launch. The tree builder had already dropped its duplicate `ui_*` commands, and `pnpm typecheck` was clean at the start, so no contract mismatch was left to resolve.
- Session module: `cwd` of `session_create` is optional and defaults to `AGIDE_SESSION_CWD`, else the home directory. `AGIDE_CLAUDE_ARGS` (a JSON array of strings) adds arguments to every launch; scripts use it for `--model haiku --max-budget-usd 0.25 --strict-mcp-config`. Both readers live in `core/session/env.ts` with unit tests.
- Renderer: `App.tsx` owns the node list and the open node id. `TreePane` takes the nodes and an `onOpen` callback, called on click (headless-tree's primary action), on `ui.focus_node` and for a new session. The "New Claude session" menu entry calls `session_create` for the folder and opens the new leaf; it is offered inside folders only, because the session's MCP scope is its folder. A new session leaf does not start in rename mode: the terminal takes the focus and would end the rename. `SurfacePane` shows `TerminalPane` for a `claude-session` leaf and a placeholder for other surface types.
- `e2e/integration.spec.ts`: a folder tree and a session leaf survive a restart, and the session comes back exited and resumes with `--resume`; a folder created over MCP with the session's own `--mcp-config` appears in the tree without a reload, and a folder created in the UI is returned by `ui_list_tree` over MCP, while a folder outside the session's folder is not; a session leaf opens a terminal, typed input reaches the fake claude and the output is redrawn after switching leaves.
- `scripts/e2e-real-claude.mjs` (`pnpm e2e:real-claude`).
- README: the new environment variables, a short usage section and the real-Claude scripts.

## Real-Claude run

One run, haiku, `--max-budget-usd 0.25`, `--strict-mcp-config`, permission mode `default` (the CLI's `manual`), working directory `<tmpdir>/agide-smoke-cwd` (empty, the same fixed directory as the smoke script, already trusted, so no trust prompt appeared). Result: pass in 10.6 s, cost 0.0047 USD.

- Hooks: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse (ToolSearch), PreToolUse, PermissionRequest, PostToolUse, Stop. Statuses: idle, busy, waiting, busy, idle.
- The agent called ToolSearch, then `mcp__app__ui_create_folder`. The call showed the TUI approval dialog ("Do you want to proceed? 1. Yes / 2. Yes, and don't ask again for app - UiCreateFolder commands in <cwd> / 3. No"), with "Yes" selected. The PermissionRequest hook fired before the dialog and the session status was `waiting`. Enter pressed in the terminal pane allowed the call; the folder "from-session" appeared under the session's folder in the store and in the tree pane 0.3 s later. Final reply "done".
- The TUI line "running UserPromptSubmit hooks… 1/5" shows that the user's own hooks run in app sessions next to the app's hooks, since `--setting-sources user` loads user settings.

## What took long

Nothing took long. The first e2e run failed because the new session leaf started in rename mode and the terminal took the focus, which ended the rename; the session leaf now opens without rename mode.

## Not finished

- No `--allowedTools mcp__app__*`: every app tool call asks for approval in the terminal. Whether the app's own tools should be allowed by default is open.
- Renaming a session leaf changes the tree title only, not the session title.
- Expanded folders are still not persisted across restarts.
- The real-Claude run happened once; the parity check still covers only the built-in commands.
