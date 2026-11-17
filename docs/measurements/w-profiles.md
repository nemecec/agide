# w-profiles

Start: 2026-11-17 15:59 UTC. End: 2026-11-17 16:39 UTC.

## Built

- `src/core/profile`: file store (`FileProfileStore`), file registry (`FileProfileRegistry`), atomic 0600 writes in 0700 directories (`fsio.ts`), the milestone 1 migration (`migration.ts`), profile selection (`resolveProfile.ts`), generated git and ssh files (`toolFiles.ts`), the isolated mode of `profileEnv`, partition naming (`partition.ts`), the `claude auth status` check (`claudeLogin.ts`).
- `src/main`: `profileBoot.ts` (profile, data directory and settings before `ready`), `profileLauncher.ts` (`openProfile`), `profileHost.ts` (seam between the module and the Electron process), `modules/profile.ts` on the file implementations, `index.ts` (`userData` and `sessionData` per profile, the lock with `additionalData`, focus on `second-instance`, `lastProfile`, test hooks of hidden runs), `window.ts` (title option).
- Renderer: `ProfileRail`, `NewProfileForm`, `ProfileStrip`, `SetupPane`, `useProfiles`, `profileModel`, `ProfileRail.css`.
- Commands: `profile_list`, `profile_open`, `profile_create`, `profile_set_git`, `profile_setup_status`; none is an MCP tool. `docs/parity.md` regenerated with `pnpm parity`.
- Tests: Vitest for the model, store, registry (atomicity by inode, stale entries, modes, symlinks, size, id mismatch, no content fields), migration, selection, env scrub per mode, tool files, partition helper, boot, launcher and the module; Playwright `e2e/profiles.spec.ts`.

## Test results

- `pnpm test` over `src/core/profile` and `src/main/profileMain.test.ts`: all pass.
- `pnpm e2e` (`playwright test`): the three profile tests pass (separate data directories, trees, Claude directories and titles; second start of one profile exits 0 and the first receives the focus request; a click in the rail focuses the running profile; a count emitted in one profile shows as a badge in the other rail and as the dock badge).
- Failures that are not in this slice: two tests in `e2e/integration.spec.ts` read `--mcp-config` as inline JSON and now get a file path (w-provider's change); the full Vitest run showed failures in the hook list test, the layout preset order, the PTY launch arguments test and a session exit test, and `tsc` errors in `src/core/layout/layout.test.ts` and `src/main/modules/layout.test.ts`. These belong to the other builders.

## Edits to shared files

- `src/main/index.ts` (owned): rewritten for profile resolution.
- `src/main/window.ts`: `title` option and `page-title-updated` prevention.
- `src/renderer/App.tsx` (w-layout owns it): wrapped the layout in `app-root` and `app-body`, mounted `ProfileStrip`, `ProfileRail` and `SetupPane`. w-layout replaces this with the layout host; the three components need a place there.
- `app/README.md`: environment variables `AGIDE_ROOT`, `AGIDE_PROFILE`, module map line.
- `docs/parity.md`: regenerated.

## Deviations and decisions

- The rail shows whenever the profile store is file backed, not only with more than one profile, so the first extra profile can be created from it. The in-memory profile of tests shows no rail.
- Migration copies the milestone 1 files and removes the originals after the final rename, so a crash cannot lose them.
- The profile commands are registered by the module. The module reaches the Electron process through `profileHost` (installed by `index.ts`), because `ModuleContext` is a contract file.
- Hidden runs expose `globalThis.__agideTestHooks` (`focusRequests`, `emitUnread`) for the e2e tests; the unread count otherwise comes from `inbox.unread_changed`.
- `AGIDE_USER_DATA` without `AGIDE_ROOT` keeps the milestone 1 behaviour: one unnamed in-memory profile, no registry, the plain single-instance lock.

## Not finished

- The login terminal in the setup pane starts a session through `session_create` in the profile's data directory; it uses the profile's Claude directory only once w-provider wires `profileEnv` into the launch. Not run against a real login.
- Probe E1 as a script: the e2e test shows two profiles with different `userData` run together and a second start of one profile exits, which is the lock behaviour E1 checks; no separate script.
- GitHub and ssh steps of the setup pane are text only; no command writes the ssh settings.
- Dock icon colour, profile deletion, "Quit all profiles" and plan usage wait, as in 0022.
- The window title, colour strip and dock badge were checked in hidden runs only, not visually on screen.
