# w-session

Start: 2026-11-17T08:48:13Z
End: 2026-11-17T09:08:20Z
Wall time: about 20 minutes.

## Built

- `src/core/session`: `PtySessionService` (node-pty, one process per session), `launchArgs`, `hooks` (the `--settings` hook JSON and the command that appends payloads to the events file), `JsonlTail` (polls the events file), `status` (hook event to session status), `env` (environment scrub, `claude` binary lookup), `OutputBuffer` (recent output for renderer reload), `SessionStore` (memory and `node:sqlite` implementations), and a fake `claude` fixture with tests.
- `src/main/modules/session.ts`: wires the service to the tree, the MCP server and the event bus, and registers the `session_*` commands.
- `src/renderer/panes/TerminalPane.tsx` and `TerminalPane.css`: xterm.js with the fit addon.
- `scripts/smoke-real-claude.mjs` and `e2e/session.spec.ts`.

Behaviour:

- Launch: `--session-id <id>` for a new session, `--resume <id>` for a reopened one, `--permission-mode` on every launch (the app mode `default` is passed as `manual`, the CLI name), `--setting-sources user`, `--settings` with hooks for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, PermissionRequest, Stop, SubagentStart, SubagentStop and SessionEnd, then the arguments from the `extraArgs` hook point of the service options.
- The hook command is `{ cat; echo; } >> <file>`. It prints nothing, so it never answers a permission request and the TUI shows its own prompt.
- The tail starts at the end of the events file, so a resumed process does not replay old events. On exit the tail is drained before `session.exited`.
- Status: `starting`, then `idle` on SessionStart, `busy` on UserPromptSubmit, `waiting` on PermissionRequest, back to `busy` on the next PreToolUse or PostToolUse, `idle` on Stop, `exited` on PTY exit. A denied prompt stays `waiting` until the next tool call or Stop, because no hook reports the denial.
- Close sends SIGTERM and SIGKILL after a timeout. `shutdown` ends all processes and keeps the sessions (app quit); sessions persist in SQLite and come back as `exited`.
- `sendText` types the text and presses Enter after a delay; text with a newline goes in as one bracketed paste. Texts are serialized per session. The create prompt is typed after the first SessionStart with a delay.
- Commands: `session_create` (UI menu on tree nodes), `session_resume`, `session_close`, `session_write`, `session_resize`, `session_read_output`, `session_send_text`, `session_get`, `session_list`. Only `session_send_text`, `session_get` and `session_list` are MCP tools, scoped to the caller's folder. `session_create` is not an MCP tool, because an agent could start sessions with `bypassPermissions` in any directory.
- The terminal pane subscribes first, asks for the output snapshot, drops what arrived before the snapshot reply, then follows live output. Fit and a `ResizeObserver` drive `session_resize`.

## Results

- `pnpm typecheck`, `pnpm test` (all core tests), `pnpm e2e` pass. The session e2e test runs node-pty in the Electron 45 main process with the fake claude, through the real IPC and command path, including a renderer reload.
- Mutation checks (swapped `--resume`/`--session-id`, removed environment scrub, removed SIGKILL escalation): each made tests fail.
- Terminal pane: checked in a scratch harness (a Vite dev server page that mounted `TerminalPane`, run in Electron with Playwright, deleted afterwards). Typing reached the process, a window resize refit the terminal and the process saw the new size (160x49 to 86x29), a reload redrew the earlier output, `/exit` showed Resume and Resume returned the session to `idle`. No automated test covers the pane, because `App.tsx` does not pass a session id yet.
- Real Claude (`node scripts/smoke-real-claude.mjs`, haiku, `--max-budget-usd 0.25`, `--strict-mcp-config`, fixed empty directory under the temp dir): SessionStart, UserPromptSubmit, Stop in that order, statuses `idle`, `busy`, `idle`, `last_assistant_message` "pong", 4.3 to 9.4 s from create to Stop. Cost: the Stop payload has no cost field. The transcript gets `cost-state` rows (`totalCostUSD`, `modelUsage` per model) when the process ends, not at Stop: 0.0035 USD for the last run, with `message.usage` token counts on the assistant row. The Stop payload keys are `background_tasks`, `cwd`, `effort`, `hook_event_name`, `last_assistant_message`, `permission_mode`, `prompt_id`, `scratchpad_dir`, `session_crons`, `session_id`, `stop_hook_active`, `transcript_path`. `permission_mode` in the hooks was `default`.

## Findings about the CLI

- `--max-budget-usd` is documented as print-only; the interactive CLI accepted it. Whether it is enforced there is not tested.
- A directory the CLI has not seen shows a trust prompt before any hook fires, so no SessionStart arrives and a session stays `starting` until the user answers in the terminal. The cursor starts on "No, exit". The answer is stored per path in the Claude config, so the smoke script uses one fixed directory (`<tmpdir>/agide-smoke-cwd`) and the script answers the prompt on its first run. The smoke runs and one probe before them left trust entries for temporary paths in the user's Claude config.
- The TUI sends terminal queries (`ESC [ ? u`, `ESC [ c`); xterm.js answers them in the pane. The service alone has no terminal emulator, so the smoke script runs without those answers and still works.
- Arrow keys written as `ESC [ B` moved the trust prompt selection when sent 1.5 s after the prompt appeared; at 0.5 s the TUI did not take them.

## Contract changes and integration needs

No contract file was edited. The integration step needs to apply or decide:

1. `App.tsx` must pass the selected leaf's `surfaceId` to `<TerminalPane sessionId={...} />` when the leaf has `surfaceType` `claude-session`. Without it the pane shows the placeholder.
2. `PermissionMode` `default` maps to the CLI value `manual` in `launchArgs.ts`.
3. The session module passes `--mcp-config` from `mcp.grant` and `mcp.configFor`; when the stub throws it logs a warning and launches without the app server. It adds no `--allowedTools`, so app MCP tool calls show the TUI's approval prompt. Decide whether `mcp__app__*` should be allowed.
4. `PtySessionService` has methods beyond `SessionService`: `setFolder`, `readOutput`, `shutdown`. The module calls them on the concrete class; the renderer reaches output through the `session_read_output` command.
5. At init the module closes persisted sessions whose leaf is missing from the tree (their rows are deleted; the Claude transcripts stay). With a tree that does not persist, every session is dropped at restart.
6. `AGIDE_CLAUDE_BIN` overrides the `claude` path (used by the e2e test with the fake). Otherwise `~/.local/bin/claude`, Homebrew paths, then PATH.
7. The Electron-side `rescope` on a leaf move uses the leaf's new parent folder as the session folder.

## What took long

- The real-Claude smoke script: the trust prompt (two runs timed out waiting for Stop), then the cost row, which appears in the transcript only after the process ends.

## Not finished

- Sessions with `launchPath` `stream-json` are not implemented; `PtySessionService` ignores the value.
- PTY deny through the `PermissionRequest` hook, interrupt and image paste are not tested.
- No automated test of `TerminalPane`.
- The Electron app was not run with a real Claude session through the UI.
