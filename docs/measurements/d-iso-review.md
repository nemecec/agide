# d-iso-review

Independent review of `docs/decisions/0022-profiles-and-isolation-design.md` and `notes/profiles-and-isolation.md`.

- Start: 2026-11-17T15:11:04Z
- End: 2026-11-17T15:22:54Z

## Work

- Checked the milestone 1 launch claims against `app/src/main/index.ts`, `app/src/core/session/env.ts`, `launchArgs.ts`, `hooks.ts`, `app/src/core/mcp/requestGuard.ts` and `app/src/main/modules/session.ts`.
- Checked the Electron claims against the Electron 45.3.3 typings in `app/node_modules/electron/electron.d.ts` and the Electron 45.3.3 source of `App::RequestSingleInstanceLock` and `App::SetPath` (the lock is keyed to `userData`).
- Checked the Claude Code claims against the authentication, `.claude` directory, CLI reference, hooks, environment variables, settings reference, sandboxing, sandbox environments and legal and compliance pages, and against `probes/RESULTS.md` and the probe scripts.
- Checked the OpenShell claims against the repository README, the releases API, issue 531 and the documentation sources on `main` (sandboxes, runtimes, support matrix, providers, provider profiles, policy schema, network rules).
- Edited both files: split the profile definition into a shared definition and a private settings file, corrected the SSH identity handling, set tool location variables per profile, made the migration safe against concurrent starts, aligned the local provider's network capability with 0010 and 0012, recorded the credential terms reading for subscription logins, and updated the OpenShell and Claude Code facts that the documentation now settles.
- Typechecked the TypeScript blocks of 0022 with the app's `tsc --strict`.

## What took long

Reading the OpenShell documentation sources in the repository, since the published pages the survey cited differ from `main` in places.

## Not finished

- No probe was run; the design's probes stay open.
- The gh, git and OpenSSH manual pages were checked only for the points edited (`IdentitiesOnly` and `IdentityFile` in the local `ssh_config` manual).
- Removing the temporary download directory under `/tmp` was refused by the sandbox; it holds only public documentation copies.
