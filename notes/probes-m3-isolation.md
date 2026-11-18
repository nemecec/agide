# Isolation probes I1 to I3 (milestone 3)

Date: 2026-11-17. Host: Apple Silicon Mac, Docker Desktop 4.97.0 with Docker Engine 29.9.2 (8 CPUs, 8 GiB in the VM), Node 22, Python 3.14, claude 2.1.326. Free disk at start 6.7 GiB, at the end about 6 GiB; no step came near the 3 GiB limit. Scripts and raw evidence: `probes/p16_srt.py`, `probes/p17_container.py`, `probes/p18_openshell.py`, `probes/hooks/srt_claude.sh`, `probes/fixtures/fake_claude.sh`, `probes/fixtures/hook_events.sh`, `probes/out/p16_*` to `p18_*`. `p16_report.json` holds only the last run (`basic`); the MCP and write-outside results of I1 are in the raw PTY logs `p16_mcp_*_raw.bin` and `p16_write_outside_raw.bin`. The Keychain check of I1 and the provider placeholder check and the live policy reload of I3 were manual steps outside the scripts, and no log of them was kept. A reviewer re-run of I2 is in `probes/out/m3-review/`.

## Outcome

| Probe | Result | Short finding |
|---|---|---|
| I1 srt | pass, with settings the docs do not list as needed | Filesystem and network policy enforce as configured. The real claude runs interactively under srt, hooks reach an allowed directory, the Keychain login works. Needs `allowPty` for the TUI, `allowLocalBinding` for the loopback MCP server, and a write allowance for the Claude temp directory. |
| I2 container | pass for the fake claude; real claude unverified | PTY, resize, Ctrl-C, events directory, host MCP with token, ownership, teardown all work. Needs a Linux claude build to say more. |
| I3 OpenShell | pass for the fake claude; real claude unverified | Installs without administrator rights from a checksummed release. Runs on local images only (about 33 MB pulled). Policy, host MCP through the policy, PTY through `sandbox exec --tty` and `sandbox connect`, credential placeholder all work. Real claude and the subscription login were not run. |

## Changes made to the host

Everything is under temporary paths unless listed.

| What | Where | State at the end |
|---|---|---|
| srt 0.0.83 (pnpm, `--ignore-scripts`, dependencies zod, commander, node-forge, a SOCKS5 server) | a `/tmp/agide-srt.*` prefix, pointer in `/tmp/agide-srt-prefix.txt` | kept, about 19 MB; lost at reboot |
| The same packages in the user's pnpm content store, and a link to the srt prefix in the store's `projects` directory (found by the reviewer) | `~/Library/pnpm/store/v11` | kept; not recorded by the probe |
| OpenShell 0.1.9 CLI and gateway from the GitHub release (SHA-256 of the CLI and gateway archives matched the published checksum files), state and generated certificates under one temporary directory | `/tmp/agide-osh.*` | removed |
| Docker images `ghcr.io/nvidia/openshell/supervisor:0.1.9` (79 MB) and `ghcr.io/nvidia/openshell/sandbox:0.1.9` (10 MB), pulled by the gateway | local Docker | removed |
| Test containers, OpenShell sandboxes, a provider and an imported provider profile | Docker, gateway database | removed with the gateway state; no container, volume or network left |
| One generic Keychain item with open access, used to test Keychain reads inside srt | login keychain | deleted in the same step; a later lookup finds nothing |
| Claude project directories for the temporary working directories of the real claude runs (`projects/*-agide-i1*` in the configuration directory), and folder-trust entries for those directories in the configuration's `.claude.json` | the Claude configuration directory | not removed: the deletion was denied by the permission system. The user can delete the project directories whose names contain `agide-i1`; the trust entries are the open item of 0025 |
| Directories named `agide-i1run.*` from the I1 runs, a few KB each (found by the cross-review; the probe did not record them) | the per-user temporary directory (`$TMPDIR`) | kept; the system clears that directory in time |
| Homebrew, launchd services, `~/.srt-settings.json`, `~/.config/openshell` | | not touched: the installer script of OpenShell installs a Homebrew formula and a launchd-backed gateway on macOS, so it was not run; the release archives were used instead |

The OpenShell installer was read before the decision: on macOS it requires Homebrew, creates a local tap, installs a formula and starts a `brew services` gateway. The probe replaced that with manual extraction and a gateway process started by hand with `OPENSHELL_TELEMETRY_ENABLED=false`.

## I1 Anthropic sandbox runtime

Configuration passed with `-s` (no home-directory settings file). `srt -s cfg -- claude ...` needs the `--` separator, otherwise srt's own `--settings` option consumes the claude argument.

Results:

- A write outside `allowWrite` fails with "Operation not permitted" (shell redirect and the agent's Bash tool). A write inside works.
- A domain outside `allowedDomains` fails at the proxy with a 403 on CONNECT; an allowed domain returns 200.
- The real claude runs in a PTY under srt (Haiku, empty directory), SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop hooks fire, and the hook script writes to the allowed events directory.
- Settings that the TUI needed, found by failure:
  1. `allowPty: true`. Without it the Seatbelt profile denies termios ioctls on the PTY, raw mode cannot be set, Enter arrives as a line feed and the folder-trust dialog cannot be confirmed (the TUI shows the dialog and does not react).
  2. `allowLocalBinding: true` for the app-style MCP server on `127.0.0.1`. With it false the MCP connection fails with EPERM although `127.0.0.1` is in `allowedDomains`. With it true the initialize, tools/list and tools/call requests reach `mcp_host.mjs`. The reason: srt sets `NO_PROXY` to loopback and private ranges, so the client connects to `127.0.0.1` directly and the proxy allowlist does not apply. On macOS this setting lets the sandboxed process bind and accept on any local port and connect to any loopback port (srt README), so it widens access to other local services.
  3. A write allowance for the Claude temp directory (`/private/tmp/claude-<uid>`). The Bash tool fails with EPERM on a mkdir without it. The srt README names `/tmp/claude` as writable by default; the CLI uses the per-user name.
  4. The configuration directory, `~/.claude.json` and `~/.claude` as write paths (login state, settings, transcripts).
- The status line "Auto-update failed" shows because the sandbox blocks the update write; harmless.
- Keychain. The login works under srt: the CLI found the subscription login in the Keychain with `CLAUDE_CONFIG_DIR` set. The Seatbelt profile does not block the `security` tool (the srt source allows `mach-lookup` for `com.apple.SecurityServer` and `com.apple.securityd.xpc`): a generic password item created with open access was readable inside the sandbox with `security find-generic-password -w`. So the agent inside can read what its own process can read. This matches `login: host-keychain` in 0022. The read of the Claude credential item itself was not attempted, to avoid printing it. A `denyRead` on the configuration directory does not cover the Keychain.
- A plain `-p` run with an `env -i` environment printed "Not logged in" with and without srt, so that run says nothing about srt; with the inherited environment (minus the injected `CLAUDE_CODE_*` variables) both worked.

Latency, mean of repeated runs on this host: `srt -c true` 0.20 s against 0.01 s for `true`; the claude PTY start to the SessionStart hook 6.6 to 6.9 s under srt and 6.6 s without (both include the trust dialog and a fixed 2 s settle in the helper), so srt adds about 0.2 s.

Reviewer re-run (shell only, no claude): a write outside `allowWrite` fails with "Operation not permitted", an allowed domain returns 200, a denied one gets `403 host is not on the allow list` on CONNECT, `curl --noproxy '*'` to an allowed domain fails at name resolution, and `srt -c true` takes 0.15 to 0.18 s.

Not verified: Linux (bubblewrap) and the Linux seccomp socket filter; a deny rule for the Keychain; the `--control-fd` live reconfiguration; proxy behaviour for tools that ignore proxy variables beyond the curl check above; MCP servers started by claude inside the sandbox; the Write tool outside the allowed directories (the kernel check is the same as for Bash).

## I2 Container (Docker, fake claude on alpine)

`fixtures/fake_claude.sh` runs on busybox: prints a ready line with the terminal size, runs hook commands (`FAKE_HOOK_CMD`) with the payload on stdin like a settings hook, traps WINCH, INT, TERM and HUP, writes its pid to the events directory, and calls the host MCP endpoint with `wget` and a bearer token. It is started with `docker run -it` inside a Python PTY.

| Check | Result |
|---|---|
| Start latency (container start to the ready line, image local) | 0.2 to 0.35 s over repeated runs |
| Hook events through a bind-mounted events directory | every hook event fired arrives on the host as JSON lines; the file is owned by the host user |
| Host MCP server through `host.docker.internal` with a per-session token | initialize succeeds with the token; a wrong token and a missing token get 401; the server on `127.0.0.1` is reachable through Docker Desktop. The Host header `host.docker.internal` is refused with 403 unless the server allows it (checked by the reviewer: "host not allowed" without `--allow-host`), so the app server needs an allowance per provider (`mcp_host.mjs` gained `--allow-host` and `--bind`) |
| Workspace and configuration directory bind mounts | run as `--user <host uid>:<gid>`: the container sees both owned by that uid and files created inside belong to the host user; run as root: files created inside also appear owned by the host user (Docker Desktop's file sharing maps ownership). On a Linux host without that mapping the explicit `--user` matters |
| PTY size | the initial size reaches the container; `TIOCSWINSZ` on the host PTY reaches the inner process as SIGWINCH within the run |
| Ctrl-C | the byte passes through the docker client and reaches the inner process as SIGINT |
| SIGTERM to the docker client | forwarded; the inner process ran SessionEnd and the client exited 143 in about 0.1 s |
| SIGKILL to the docker client | the container keeps running (confirms 0022); a `docker exec <name> kill -TERM <pid from the pid file>` then ends it and runs SessionEnd |
| Teardown | `--rm` and a label leave nothing; no container, volume or network remained |

A shell stand-in found one detail: a trapped signal interrupts `read` in busybox ash, so the loop must tell an interrupted read from end of input. The real claude has its own signal handling.

What a real claude would need as well, and what stays unverified:

- A Linux claude build (not available locally), its libc, `git`, `ripgrep`, certificates; image size over the 100 MB limit of this run.
- Login inside the container through the paste-code flow with `CLAUDE_CONFIG_DIR` on a bind mount, and whether the login survives container restarts (D3 of 0022).
- Hook commands must exist inside the image: the settings point at a script on a mounted read-only directory. Transcript and `cwd` paths in payloads are container paths; mounting at the same path as on the host keeps them equal.
- The `type: http` MCP client reaching `host.docker.internal` (the fake used `wget`), and the TUI behaviour as PID 1 (use `--init` so signals and zombie processes are handled).
- Network policy: a plain container has no egress policy; the outward-action gate would need a proxy container.

## I3 OpenShell 0.1.9

Install: the macOS release archives of the CLI (9.7 MB) and the gateway (38 MB) from the GitHub release, SHA-256 compared with the published checksum files, extracted into a temporary directory. No administrator rights. The gateway ran as a normal process with a TOML file:

- `compute_driver = "docker"`, `supervisor_network_mode = "bridge"` (the default host mode needs Docker Desktop host networking), `disable_tls = true` on `127.0.0.1`, and `allow_unauthenticated_users = true` (the gateway refuses to start without a user-auth choice). Plaintext with no authentication on loopback is acceptable for the probe only; every local process of the user can reach it.
- Docker sandboxes require launch signing: `openshell-gateway generate-certs --output-dir <dir>` plus `OPENSHELL_LOCAL_TLS_DIR` before the first create, or sandbox creation fails with "docker sandboxes require launch-scoped gateway authentication".
- Pulls: only the OpenShell runtime images (supervisor 28 MB compressed, 79 MB on disk; sandbox runtime 4.5 MB). The default workload image of the community base (1.1 GB) was not used: the workload image is `--from alpine:latest`, which is local. The probe checked registry manifest sizes before pulling.
- Quirk: `sandbox create ... --no-keep -- cmd` fails argument parsing; `--detach` or no `--no-keep` works.

| Check | Result |
|---|---|
| Gateway start | 9 s on the first start (driver initialization), under 1 s later |
| Sandbox create to Ready, local image | 1.0 to 1.9 s |
| `sandbox upload` of a small script | 1.1 to 2.5 s |
| Command with `sandbox exec` | 0.04 s |
| PTY through `sandbox exec --tty` in a Python PTY | ready in 0.13 s; resize reaches the inner process; Ctrl-C reaches it; the typed lines work |
| `sandbox connect` in a PTY | attaches to the sandbox's main process (a shell here); the PTY size is right and a resize works; Ctrl-D detaches |
| SIGTERM to the CLI client | the client dies at once (exit by signal); the inner process is gone afterwards (no leftover process) |
| Delete | 5.3 s; no container left |
| Filesystem policy | the workload runs as uid 1000; writes to `/etc` and `/usr` are denied, `/tmp` and `/sandbox` are allowed (Landlock with `best_effort`, the default; the policy file for a live update has to repeat every read-only path of the default, including `/proc`) |
| Network policy | default deny; the scripted run has a rule scoped to the binary `/bin/busybox` for the host MCP port: the MCP call passed, `example.com:80` and the gateway port were denied (`p18_report.json`). The probe author reports a manual step that added `example.com:80` with `policy set --wait` and then reached it (live reload); no log of that step was kept |
| Host MCP through the policy | `host.openshell.internal:<port>` reached the loopback-bound `mcp_host.mjs` with the bearer token; the server needs that name as an allowed Host. Only the policy-listed port works |
| Host environment | a canary `ANTHROPIC_API_KEY` and another variable set in the CLI process did not appear inside the sandbox |
| Provider credential | a provider imported from the `providers/claude-code.yaml` profile of the repository (an example, read before use) with a fake key (manual step, no log kept): inside the sandbox the variable holds a placeholder (`openshell:resolve:env:...`), not the key. This matches the documented design; the gateway holds the real value in its database |
| Hook events out of the sandbox | no host bind mount without the opt-in of 0022 (O3); events written inside `/sandbox` come back with `sandbox download`, which refuses paths outside `/sandbox`. An HTTP hook would use the same policy path as the MCP call |

Not verified: the real claude inside a sandbox (no Linux build, no API key used); the TUI over `connect` with a real Ink application; the subscription login inside (not attempted, and the placeholder property does not apply to it); bind mounts with the opt-in; Landlock `hard_requirement` on the Docker Desktop VM kernel; stdin ownership when two attachments exist; gateway as a long-running service; the version moves weekly.

## Effects on the design (for 0022 and 0025)

1. `srt` is the cheapest provider that enforces both policies on macOS and starts in about 0.2 s. The provider must set `allowPty`, `allowLocalBinding` (with the widening noted) and the Claude temp directory, and keep Keychain readable: the agent can read its own login.
2. The container provider works for the PTY, events, MCP and ownership couplings with the fake. The real-claude questions are the build, the login and the image size.
3. OpenShell works with local images and no administrator rights, with a signing bundle, a plaintext loopback gateway and `bridge` supervisor mode. Network policy is per binary, which suits `claude` at a known path in the image. The sandbox PTY works through `exec --tty`. Subscription logins are not covered by the placeholder; API-key profiles are.
4. Events leave a sandbox through `sandbox download` or an HTTP hook; a mounted events directory exists only for plain containers and srt.
