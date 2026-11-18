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

# integrate, milestone 2

Start: 2026-11-17T17:22:07Z
End: 2026-11-17T17:40:44Z (about 19 minutes wall time)

## State at the start

`pnpm typecheck` and `pnpm test` passed. `pnpm e2e` failed in four tests: `integration.spec.ts` parsed `--mcp-config` as inline JSON (it is now a file path), and `profiles.spec.ts` found no colour strip and no rail, because the layout host had replaced `App.tsx` and nothing mounted the profile components.

## What was built

- Main process: the module order of 0023 was already in `modules.ts` (profile, tree, mcp, session, layout, inbox, then `mcp.start()`), and session launch already went through the provider with `profileLaunchSpec` over the profile settings. The dock badge was set twice, by the profile module and by the inbox module; the inbox module no longer sets it, so the count reaches the registry and the badge only through `inbox.unread_changed` and the profile module, as 0023 states. The `emitUnread` test hook is gone; the e2e test posts a real item instead.
- Layout: both presets place `agide/profile-rail` at the left edge and `agide/inbox` as a tab beside the surface host. The layout host hides the tab header of a group that holds only the rail, and shows the profile strip above the layout bar. `App.tsx` mounts the setup pane over the layout. The new-profile form is fixed-positioned so the pane frame does not clip it.
- Capture mask: the inbox and the rail are masked for folder-scoped callers next to the tree, since they show every folder and other profiles.
- Tests: `e2e/sessionMcp.ts` reads the session's MCP config file and connects as the session; `integration.spec.ts`, `inbox.spec.ts` and `profiles.spec.ts` use it. New: a 0600 config file test with no token in any argument; the rail badge of the other profile after `inbox_post` over MCP (with the dock badge and a registry entry without item text); `e2e/workspace.spec.ts` with the layout instances, a layout file edit and an MCP `layout_apply` that change the window and the Undo button that restores it, and a hook event that becomes an item in the inbox tab. Unit tests that indexed the preset arrangement now point at the shifted children.
- Real Claude: `scripts/lib/realClaude.mjs` holds the shared parts; `scripts/e2e-real-claude-inbox.mjs` (`pnpm e2e:real-claude-inbox`) is new and `scripts/e2e-real-claude.mjs` uses the library.
- `dockview-react` is an exact version like the other dependencies; `pnpm install --offline` updated the lockfile specifier.

## Real-Claude runs

Haiku, `--max-budget-usd 0.25`, `--strict-mcp-config`, `--setting-sources user`, app permission mode `default` (the CLI shows "manual mode on"), working directory `<tmpdir>/agide-smoke-cwd`.

- First inbox run: failed before SessionStart. The folder-trust dialog lists "No, exit" first and highlights it. The script moved the selection to "Yes", but its check matched an older frame in the output stream while a later frame showed "No, exit" again, so Enter ended the CLI ("didn't start because this folder isn't trusted"). This is the same failure w-provider saw.
- The trust answer now reads the selection marker of the latest frame and presses Enter only after two reads in a row show "Yes, I trust this folder"; it needed two Down moves in the passing run, so something moved the selection back once after the first move.
- Second inbox run: pass in 17.7 s, cost 0.0053 USD. Hooks SessionStart, UserPromptSubmit, PreToolUse, PostToolUse (ToolSearch), PreToolUse, PermissionRequest, PostToolUse, Stop; statuses idle, busy, waiting, busy, idle. The `mcp__app__inbox_post` call showed the CLI's approval dialog in the PTY ("Do you want to proceed? 1. Yes / 2. Yes, and don't ask again for app - InboxPost commands in <cwd> / 3. No"), with "Yes" highlighted, the session status `waiting` and `permission_mode` `default` in the hook payload. Enter in the terminal pane allowed it; the item (kind `status`, origin `mcp:inbox_post`, in the session's folder) was in the store 0.2 s later and in the inbox tab with "1 unread" 0.1 s after that. The MCP config file had mode 600, and the CLI read it from the file path.
- Folder run with the refactored script: pass in 8.8 s, cost 0.0048 USD, no trust dialog (the directory was trusted by the run before).
- Side effect: the passing trust answer added a trust entry for `<tmpdir>/agide-smoke-cwd` to the user's Claude config.

## What took long

Finding why the trust answer failed: the plain-text screen holds every frame since the dialog header, so a match anywhere in it is not the current selection.

## Not finished

- The rail width is a share of the window (about 60 px at the default width), not a fixed width; a narrow window makes it narrower.
- The inbox tab title shows no unread count; the own count shows on the dock badge and in the rail.
- In a run without profiles (`AGIDE_USER_DATA` only) the rail column stays empty.

# integrate, milestone 3

Start: 2026-11-17T23:23:53Z
End: 2026-11-17T23:43:15Z (about 19 minutes wall time)

## State at the start

The builders had left the module graph in the order of 0029, and `pnpm typecheck`, `pnpm test` and `pnpm e2e` all passed. The task start already created its session through `session_create`, so it used the profile's provider and the permission mode resolution. Some seams were still open: the network policy of the permissions module was always `unrestricted`, the browser module asked about every navigation outside loopback (`allowlisted` was always false), and browser permission requests reached the tab chrome only.

## What was built

- `core/permissions/hosts.ts`: `hostAllowed` (moved out of the inspector; host names now compare without case) and `originAllowed` for `https` origins, with tests.
- Permissions module: `networkPolicy` returns the profile's network allowlist. A provider that limits the whole process (srt) turns it into its allowed domains; `local` and the container ignore it.
- Browser module: it receives the permission service (`modules.ts` passes it). An agent navigation to an `https` origin on the allowlist runs without a question. Every permission request also posts an `approval` item (origin `browser:approval`, high urgency, linked to the tab, the agent's summary in the payload only); the answer, a timeout or the removal of the tab resolves it as approved, denied or expired.
- `e2e/milestone3.spec.ts` with `e2e/fixtures/fake-claude-m3.mjs` (records arguments, settings, the MCP config and every submitted prompt, a bracketed paste counting as one; runs hook and status line commands) and `e2e/fixtures/fake-srt.mjs`:
  - a pull request task from the new-task dialog with a fake `gh`: worktree as the session directory, `--permission-mode auto`, the `Bash(git push *)` ask rule, the inspector `PreToolUse` hook, the status line, the digest hook, `--no-chrome`, `--add-dir`, both MCP servers, the composed prompt without the pull request text, and a `github` tab for the pull request in the task folder;
  - a local page read and clicked over the `agide-browser` endpoint, a navigation to another origin that asks through the inbox and is denied, and observation off refusing the page tools and `surfaces_observe`;
  - subagent hook events as an agent node, the session in the usage ranking, plan usage from the status line, the plan threshold alert in the inbox, and a denied push as a `Blocked git.push` item;
  - srt chosen for the profile: the next launch runs `srt -s <settings> -- claude`, the settings carry a host added to the profile allowlist and `allowPty`; back on `local`, the next launch skips srt.
- `scripts/e2e-real-claude-m3.mjs` (`pnpm e2e:real-claude-m3`).
- README: the allowlist for navigation and for srt, the inbox item of a browser request, the new spec and script.

Mutation checks: the network policy set back to `unrestricted`, the inbox post of a browser request removed, and `allowlisted` set back to false each made unit or e2e tests fail; the files were restored.

## Real-Claude runs

Haiku, `--max-budget-usd 0.25`, `--strict-mcp-config`, `--setting-sources user`, profile default mode (auto), working directory `<tmpdir>/agide-smoke-cwd` with a git repository for the run (emptied afterwards), a bare origin in a temporary directory, a local page on `127.0.0.1`.

- Run 1: stopped before the prompt; the script waited for a session leaf in a collapsed folder. No model call.
- Run 2: the agent used ToolSearch, then the `agide-browser` tools with no permission dialog in auto mode, then `git push origin HEAD`, which showed the TUI dialog "Rule Bash(git push *) from command line arguments overrides auto mode … Do you want to proceed? 1. Yes 2. No". Escape interrupted the turn ("Interrupted · What should Claude do instead?"), no Stop hook ran, and the script timed out waiting for an idle status.
- Run 3 (the script now ends on the interrupted turn): pass in 20 s. Hooks: SessionStart, UserPromptSubmit, PreToolUse and PostToolUse for ToolSearch, `tabs_context_mcp`, `find`, `computer`, `get_page_text`, then PreToolUse for Bash and PermissionRequest. The click reached the page's server, the page read "saved at the button", nothing reached the origin. Access log: tree, act and text entries, all `ok` with the loopback origin. Inbox: an approval item "Approve: git.push to origin HEAD". The cost is not in the transcript (no `cost-state` row).
- After Escape the session stayed `waiting` and the approval item stayed open: refusing in the TUI produces no hook that clears them.

## What took long

Writing the integration fake claude so that a bracketed paste with newlines counts as one prompt, and finding that `claude auth status` (the profile login check under `AGIDE_ROOT`) launches the fake claude as well.

## Not finished

- The mode reported by hook payloads is not written back with `setPermissionMode`. The payload files sit in a directory the agent can write to, so a forged payload could change the mode of the next launch; this needs a source the agent cannot write.
- The session status and the approval item after a refusal with Escape (above).
- The real-Claude script under srt and the probes listed in the builders' reports were not run here.
- Empty `playwright-artifacts-*` directories from the test runs remain in the temporary directory.
