# w-provider

Start: 2026-11-17 15:59 UTC
End: 2026-11-17 16:38 UTC

## What was built

- `PtySessionService` launches through an `IsolationProvider`: provider check, `prepare` with the profile launch inputs, hook delivery, MCP endpoint, a 0600 session file for the MCP config, `ptyCommand`, `attach` of the PTY pid, `terminate` on shutdown, `releaseSession` on exit and on a failed launch, `dispose` on service shutdown. Without a provider option it builds a `LocalProvider`, so milestone 1 behaviour and the existing tests are unchanged.
- `LocalProvider` and `FakeProvider` build the process environment in `core/isolation/launchEnv.ts`. `ProfileLaunchSpec` gained `ghConfigDir` and `extraEnv`; with `claudeConfigDir` and `toolFiles` these are the hook points `w-profiles` fills. `core/session/profileLaunch.ts` turns profile settings and `profileEnv` into that spec; `session.ts` passes it through `profileLaunch`. A repeated `prepare` replaces the spec of its key, so changed profile settings apply to the next launch.
- Milestone 1 finding closed: the MCP bearer token is no longer in the process arguments. The config JSON is written to `<data>/sessions/<sessionId>/mcp.json` (file 0600, directory 0700) and `--mcp-config` receives the path. The file is removed when the process exits.
- Milestone 1 finding closed: the permission mode is explicit per session. `--permission-mode` is passed on every launch. The default for sessions that name no mode is `default` (the CLI's prompting mode, every tool call asks), settable with `AGIDE_PERMISSION_MODE` (`default`, `acceptEdits`, `plan`, `auto`; `bypassPermissions` only per session with confirmation). 0012 names the user's auto mode with ask rules as the target; the default stays conservative until the user chooses, so `auto` is one variable away.
- Tests: launch arguments with the config path, environment and permission mode parsing, `launchEnv`, `profileLaunchSpec`, and `PtySessionProvider.test.ts` (token absent from arguments, file modes, config removed on exit, permission defaults, provider call order, provider failure, failed check, profile directories in the process environment). The shared provider contract suite runs against `LocalProvider` and `FakeProvider` (already in `providers.test.ts`). The fake `claude` records the file named by `--mcp-config`.
- Docs: `app/README.md` (variable, module map), the bullet about the token in `core/mcp/types.ts`.

## What took long

- Test runs of the whole tree overlapped with edits of other builders (`hooks.ts` gained `StopFailure`, the tree version moved, `profileEnv` changed), so some full runs failed or hung for reasons outside these files.

## Not finished or not verified

- `scripts/e2e-real-claude.mjs` ran once and failed before `SessionStart`: the working directory `agide-smoke-cwd` showed the folder-trust dialog, the script's Down plus Enter answer ended on "No, exit", and the CLI exited with "didn't start because this folder isn't trusted". The launch itself reached the CLI. A run past the trust dialog, and so the CLI reading `--mcp-config` from a file path, is not verified against the real CLI.
- `http` hook delivery is rejected by the service; only the inbox directory is wired.
- The permission mode has no profile setting or UI; it is an environment variable and a `session_create` input.
