# Review: milestone 2 main process, preload, renderer, session and end-to-end tests

Start: 2026-11-17 17:57:46 UTC
End: 2026-11-17 18:06:19 UTC

## Work

An independent review of `app/src/main` (entry, window, IPC, modules, profile launcher, focus request), `app/src/preload`, the renderer layout host and panes (profile rail, inbox, setup pane, terminal), `app/src/core/session` with the local isolation provider, and `app/e2e`. Checked against 0004, 0014, 0017 and 0022.

- Ran `pnpm typecheck`, `pnpm test` and `pnpm e2e` with `CLAUDE_CONFIG_DIR` set in the shell. All pass. The profiles spec now removes `CLAUDE_CONFIG_DIR` from the environment it passes to Electron.
- Mutation pass: single mutations, each applied alone, the related Vitest files run, and the file restored and compared by checksum. Covered: sender trust (subframe), web permission handler, Claude and tool credential scrub, `SSH_AUTH_SOCK`, `GH_CONFIG_DIR`, inherited `CLAUDE_CODE_*` variables, session file mode, session file removal on release and on exit, grant revocation on exit, bypass confirmation, the `manual` CLI mode, the launcher environment and own-profile branch, the focus request check, the hook command quoting, the token in the arguments, terminal size checks. Every mutation failed a test except removing the grant cleanup after a failed launch in the session module.
- A node-pty script checked whether a background child of the PTY process survives a SIGKILL of that process: it did not, because the terminal hangup reaches the foreground process group.

## Findings in short

- The login terminal of the setup pane runs in the profile's data directory, which holds the MCP config files of every running session. 0022 asks for an empty directory under `data/`. Sessions started from the tree run in the home directory by default, which also encloses those files.
- The grant cleanup after a failed launch uses a set shared by concurrent creates, does not cover a failed resume and has no test.
- The focus of another profile's window on macOS is checked only as a received request, not as a window brought to the front.
- `useInbox` can show the result of the previous filter after a quick filter change.

## What took long

Reading the profile environment and launch path end to end, from `bootProfile` to the PTY command.

## Not finished

No on-screen check of the second-instance focus; no real-Claude run; no check of what the CLI reads without a prompt in the home directory.
