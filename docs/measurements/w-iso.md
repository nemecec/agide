# w-iso

Start: 2026-11-17 22:11 UTC
End: 2026-11-17 22:48 UTC

## What was built

- `SrtProvider` runs `srt -s <settings> -- claude <args>`. `srtSettings.ts` builds the per-session settings from probe I1: `allowPty`, `allowLocalBinding`, write access to the workspace, the hook inbox, the Claude configuration (the profile directory, or `~/.claude` and `~/.claude.json` for the CLI default login) and the CLI temp directory, and an allowlist of the Anthropic hosts, loopback and the policy hosts. srt has no allow-everything entry, so an `unrestricted` policy maps to the Anthropic hosts plus source hosting and package registry hosts. `terminate` sends SIGTERM to srt, which reaches the inner process; SIGKILL goes to the process group, because killing srt alone leaves `claude` running (both checked).
- `ContainerProvider` runs `docker run -it --rm --init` with labels, `--name agide-<session>`, `--user`, the host alias with `host-gateway`, and same-path mounts for the workspace, the session's own directory (read-only), the inbox and the provider's Claude directory. Variables enter by name (`-e NAME`), so values travel in the docker client's environment and no value is an argument; the host `HOME`, `PATH` and credentials stay out. The check reports Docker missing, engine down and image absent, and never pulls. `removeOrphans` removes containers of its owner label left by a crash. `terminate('SIGKILL')` runs `docker kill` first.
- `HostEnvironment` is the shared base of the local, srt and container environments; `LocalProvider` now extends it with unchanged behaviour. `SessionFiles.writePrivate` writes provider-owned files with the same modes.
- `capabilityStatement.ts` holds what each provider isolates, leaves open, whether bypass is allowed (from `qualifiesForBypass`) and whether a real claude ran in it. The container is listed and not offered.
- Commands `isolation_status` (providers with check and statement, options tried without saving) and `isolation_set_provider` (saved only after the check passes). Neither is an MCP tool. `IsolationProviders.reset` rebuilds a provider after its options change.
- `IsolationSection` in the settings panel: radio per provider, check message with the fix, path or image field, statement, bypass answer.

## Tests run

- `pnpm vitest run src/core/isolation src/renderer/panes/settings`: contract suite on Local, Fake, srt and container, unit tests for settings, docker arguments, statements, commands and the section, srt tests under the real runtime (write policy, proxy 403, loopback, PTY, SIGTERM, a session launch), container tests on Docker with `alpine:latest` (user, mounts, session directory read-only, hook payload through the inbox, host MCP server with the token and Host header, SIGTERM and SIGKILL teardown, orphan cleanup by owner).
- `pnpm exec playwright test e2e/isolation.spec.ts` (hidden window): not-installed message with a disabled choice; choosing srt stores it in the profile.

## Latency from these runs

| Measure | Result |
|---|---|
| Container start to first output, alpine, image local | 152 ms |
| Session create to idle with the fake claude, local provider | 165 ms and 110 ms |
| Session create to idle with the fake claude, srt | 257 ms and 315 ms |

## Shared files edited

- `docs/parity.md` regenerated with `pnpm parity`: it also lists the commands of other builders that were registered at that moment, besides `isolation_set_provider` and `isolation_status`.
- `app/README.md`: the isolation row of the module map.
- `src/core/isolation/index.ts`, `providerRegistry.ts`, `defaultProviders.ts`, `LocalProvider.ts`, `SessionFiles.ts`, `providers.test.ts`: inside the w-iso area. `types.ts` and the contract suite are unchanged.

## Not finished or not verified

- No real claude ran under srt with a profile Claude directory (only the I1 probe settings with the default login); the settings follow 0029, which allows the profile directory instead of `~/.claude.json`.
- No real claude in a container: the provider is not offered for sessions. The container has no network policy and the app MCP listener is on loopback, which Docker Desktop reaches and a Linux engine does not.
- The Anthropic host list for srt beyond the I1 hosts is a guess (`claude.ai`, `platform.claude.com`).
- srt does not restrict reads; `extraDenyRead` is an option, with no default.
- Full `pnpm test` shows failures in `tasks.test.ts` and `m3Modules.test.ts` that belong to other builders' unfinished work; the isolation and renderer settings tests pass. The `real-Claude under srt` script of 0029 was not written.
