# Profiles and isolation survey (R22, R23)

Research for requirement records 0017 (profiles) and 0018 (pluggable isolation). Sources are public documentation read on 2026-11-17. Each claim is marked as read in a document, or as unverified where only a secondary source or an inference supports it. Nothing here was run or installed; no keychain, account directory or process list was inspected.

## Summary

- OpenShell runs on Apple Silicon macOS through Docker Desktop (the support matrix also documents a Podman driver and a libkrun MicroVM driver), enforces policy with Landlock, seccomp and a supervisor proxy, and hides credentials behind placeholders that its proxy replaces on approved endpoints. Its documented Claude path is an API key. A claude.ai subscription login is not documented. The version line is 0.1.x with weekly stable releases. It is usable as an experimental isolation driver, not as a default.
- Claude Code keeps the login credential, settings, transcripts and `.claude.json` under `CLAUDE_CONFIG_DIR`. On macOS the Keychain entry is keyed to that directory, so each profile directory has its own login. This matches the assumption in 0017.
- gh with keyring storage and git's global credential helper can leak across profiles. Per-profile `GH_TOKEN`, `GH_CONFIG_DIR`, `GIT_CONFIG_GLOBAL` and an explicit `SSH_AUTH_SOCK` are all needed, and gh keyring entries need a check before the design relies on `GH_CONFIG_DIR` alone.
- Electron supports one process per profile: set `userData` before `ready`, take the single-instance lock per process (the Electron source keys it to `userData`), and use the `second-instance` event to focus a running profile. The dock badge is per process, so cross-profile counts need the registry.
- The registry fits one small file per profile, written by its owner with temp-file and rename, in a user-only directory, with a pid and heartbeat for stale detection.

## 1. NVIDIA OpenShell

### What it is

A runtime that runs each agent in a sandbox with kernel-level controls, a declarative policy, and a gateway that injects credentials. Apache License 2.0. Source: [repository](https://github.com/NVIDIA/OpenShell), [overview](https://docs.nvidia.com/openshell/latest/about/overview.html).

### Maturity and releases

- Version line 0.1.x. The repository README refers to a "stable release cadence" and an upgrade guide for 0.1.0. A release listing showed v0.1.8 published 2026-11-10 and a rolling `dev` prerelease built from `main`. Source: [GitHub releases API](https://api.github.com/repos/NVIDIA/OpenShell/releases?per_page=5) (the listing was truncated, so older tags were not read).
- Channels: dev (every passing commit on `main`), pre-release (nightly, `X.Y.Z-pre.N`), stable (promoted after qualification, weekly when there are changes). Security fixes cover the latest minor and the previous minor. Stable interfaces stay compatible across patch releases; experimental interfaces may change in any patch. Source: [support matrix](https://docs.nvidia.com/openshell/about/support-matrix).
- The README says the project is moving to the CNCF and the `ai-openshell` organization. Windows support is limited and WSL 2 is experimental. Source: repository README.
- Some documentation pages carry an AI-generated notice, for example the Claude Code page at [NVIDIA perspectives](https://perspectives.nvidia.com/nvidia-openshell/agent-sandbox-works-claude-code-out-of-box/). Treat those as hints, not specification.

### Platform requirements

Source: [support matrix](https://docs.nvidia.com/openshell/about/support-matrix).

- macOS Apple Silicon: supported, arm64 only, through Docker Desktop. Landlock and seccomp run inside the Docker Desktop Linux VM, not on the macOS kernel. The CLI, policy prover, packaged gateway and a standalone gateway binary for aarch64 macOS are supported.
- Docker Desktop or Engine 28.0 or later for Docker-backed gateways. Podman 5.x for Podman. Kubernetes 1.29 or later with a CNI that enforces NetworkPolicy. A MicroVM driver uses Hypervisor.framework on macOS with a libkrun-based runtime.
- Install: `curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh` installs the CLI and a local gateway (repository README).

### Architecture and compute drivers

Source: [architecture](https://docs.nvidia.com/openshell/about/architecture).

| Component | Role |
| --- | --- |
| Gateway | Control plane: sandbox lifecycle, identity, records, policy delivery, provider attachment, session relay |
| Supervisor | Trusted side: checks requests against policy, supplies allowed credentials, resolves DNS, opens approved outbound connections |
| Sandbox | Untrusted side: launches the agent, provides exec, terminal and signal handling, forwards TCP and DNS to the supervisor, makes no policy decisions |
| Compute driver | Creates the sandbox, starts supervisor and workload, builds the network fence |

| Driver | Supervisor placement | Egress blocking |
| --- | --- | --- |
| Docker | Own container | Workload container has networking disabled |
| Podman | Own container | Workload container has networking disabled |
| Kubernetes | Own pod | NetworkPolicy allows only the supervisor service |
| VM | Host process | Guest has no network device |

The architecture page does not describe SSH. Interactive access runs through the sandbox protocol: one HTTP/2 connection carrying independent streams for exec, terminal, signals and DNS. The sandboxes page in the repository (`docs/how-it-works/sandboxes/overview.mdx` on `main`, read in review on 2026-11-17) documents `openshell sandbox connect <name>`: it attaches to the sandbox's main process over an SSH session, replays up to 1 MiB of recent output, lets one attachment own stdin at a time, passes `Ctrl-C` to the foreground process, detaches with `Ctrl-D` or `Ctrl-P Ctrl-Q`, and reattaches after a dropped link for up to 60 seconds. `openshell sandbox exec -n <name> --tty -- <command>` starts an independent command with a TTY.

### Sandbox create

From the [first-agent page](https://docs.nvidia.com/openshell/about/run-your-first-agent):

```
openshell sandbox create --name my-agent --from <image> --provider <name> -- <command>
```

The default image is minimal Ubuntu with no agent installed. A tutorial runs OpenCode. The providers page in the repository says a provider is attached only when named with `--provider`; when no provider of that name exists and the name matches an imported profile id such as `claude-code`, the CLI creates one from local discovery (`ANTHROPIC_API_KEY`), and it does not derive a provider from the trailing command. An earlier search summary that said the CLI offers a provider for recognized trailing commands does not match this page.

Workspace: the documentation shows a sandbox workspace (`/workspace` in its examples) filled with `--upload <host>:<sandbox path>`, which cannot yet be combined with a trailing main command. Host bind mounts exist in the Docker, Podman and MicroVM driver configuration, but need `enable_bind_mounts = true` and resource admission turned off, and the runtimes page warns that they "can bypass workspace isolation and filesystem policy".

### Policy format

Source: [policies overview](https://docs.nvidia.com/openshell/how-it-works/policies/overview) and [schema](https://docs.nvidia.com/openshell/how-it-works/policies/schema).

```yaml
version: 1
filesystem_policy:
  include_workdir: true
  read_only: [/usr, /lib, /etc]
  read_write: [/tmp]
landlock:
  compatibility: best_effort   # or hard_requirement
process:
  run_as_user: sandbox         # root is rejected
network_policies:
  <rule-name>:
    endpoints:
      - host: <host or wildcard>
        port: <port>
        protocol: rest         # also websocket, graphql, mcp, json-rpc, tcp
        rules: [...]
    binaries:
      - path: <executable or glob>
```

- Filesystem, landlock and process sections are fixed at sandbox creation. Network policy hot-reloads on a running sandbox. Outbound traffic is denied unless a network rule allows it, and rules are bound to the calling binary.
- `landlock.compatibility: best_effort` is the default: if Landlock cannot be applied the sandbox starts without filesystem rules. An isolation driver for this project should set `hard_requirement`.
- A policy advisor and prover review proposed policy changes; the advisor is off by default.

### Credential providers and "agents never see real credentials"

Source: [providers overview (v0.1.6)](https://docs.nvidia.com/openshell/v0.1.6/how-it-works/providers/overview.md).

- Credentials are stored as named providers. At sandbox start each credential in the agent environment is replaced by a placeholder. The page states: "The agent process inside the sandbox never sees real credential values." The supervisor proxy resolves a placeholder only while forwarding an HTTP request, and only when network policy allows the calling binary and destination and the credential binding covers the host, port and path. A mismatch returns HTTP 403 `credential_endpoint_mismatch`.
- Placeholders can be rewritten in headers, Basic auth, query parameters, URL paths, request bodies and WebSocket text messages when the endpoint opts in, and in AWS SigV4 signing. Cookies, response content and WebSocket binary frames are not rewritten. Non-HTTP tunnels and `tls: skip` are opaque.
- Provider types come from imported profiles. `claude-code` reads `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` with `--from-existing`. `anthropic` uses base URL `https://api.anthropic.com`. Others include openai, github, pypi and aws.
- The page says `ANTHROPIC_API_KEY` is "not a subscription token": subscription users need a separate Console API key.
- A third-party article describes a workaround: a custom provider profile that carries the long-lived token from `claude setup-token` as `CLAUDE_CODE_OAUTH_TOKEN`, so the sandbox sees a placeholder. Source: [Classmethod article](https://dev.classmethod.jp/en/articles/reona-openshell-claude-code-codex/) (secondary, not verified). The same article raises a terms question about subscription tokens outside Claude Code. Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance), read in review on 2026-11-17, says developers "may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow", and that an end user may sign in to the unmodified Claude Code binary with their own subscription. A gateway that stores a `setup-token` and a proxy that substitutes it into requests store and intermediate such a token, so the route does not fit an app feature; API keys stay with the key owner under the same page.
- Implication for an OAuth login: the interactive `/login` flow stores a refreshable credential under `CLAUDE_CONFIG_DIR`. If that directory is mounted into the sandbox, the agent can read the real token, so the "never sees credentials" property does not hold for it. Only the API-key or `setup-token` routes keep the secret outside. A setup token is model-requests only: it cannot establish Remote Control sessions or fetch claude.ai connectors ([authentication](https://code.claude.com/docs/en/authentication)).
- `GetProviderCredentials` exports real values outside endpoint enforcement; only mTLS operators can call it. The StackOne write-up says placeholder resolution is scoped by endpoint (the v0.1.6 page says the calling binary is also checked), so the exact scope should be re-read against the version in use. Source: [StackOne](https://www.stackone.com/blog/nvidia-openshell-agent-credentials/).

### Claude Code and interactive terminals

- Claude Code is named as a supported agent in the [overview](https://docs.nvidia.com/openshell/latest/about/overview.html), and `openshell sandbox create -- claude` is the documented shape (secondary page, flagged as AI-generated).
- `sandbox connect` and `sandbox exec --tty` are documented (see the architecture section). Whether the Claude Code TUI runs well through them (resize, Esc, stdin ownership) is unverified and needs a spike before 0018 commits to a terminal-in-sandbox surface.
- The gateway collects anonymous telemetry by default; `OPENSHELL_TELEMETRY_ENABLED=false` turns it off (repository README).

### Start latency

No official figure. A Linux write-up reports a first create under 10 seconds including the base image pull ([computingforgeeks](https://computingforgeeks.com/?p=177487), secondary). An early-version bug report on an Apple M3 describes gateway start taking 1 to 2 minutes and exceeding a hard-coded timeout ([issue 531](https://github.com/NVIDIA/OpenShell/issues/531), closed 2026-03-21, CLI v0.0.12, probably outdated). The Docker Compose tutorial says first image pulls can take minutes. A measurement on the target Mac is required: cold gateway start, first create with and without a pre-pulled image, second create.

### Fit with R23

- Good: declarative filesystem, network and process policy; default-deny egress; credential placeholders for API keys; several drivers; SDKs for Python, TypeScript, Go and Rust to talk to a gateway.
- Concerns: Docker Desktop dependency on macOS; pre-1.0 interfaces; OAuth login not covered; no documented path for reaching a host MCP server. The network rules page says a policy never authorizes a loopback destination and blocks private addresses by default, except where an exact host name resolves to one; whether an exact rule for Docker Desktop's host name reaches the app's 127.0.0.1 listener is unverified. Host bind mounts for the project need a gateway opt-in that bypasses the filesystem policy (see the workspace note above).

## 2. Claude Code sandbox runtime (Seatbelt)

Sources: [sandboxing](https://code.claude.com/docs/en/sandboxing), [sandbox environments](https://code.claude.com/docs/en/sandbox-environments).

- Built-in sandboxed Bash tool: off by default, enabled with `/sandbox` or `sandbox.enabled`. macOS uses Seatbelt; Linux and WSL2 use bubblewrap and socat. Built on the open source `@anthropic-ai/sandbox-runtime`.
- Writes are limited to the working directory, a per-user temp directory and added directories. Reads are allowed across most of the machine by default, including credential files such as `~/.ssh`, unless `denyRead` is set. Network goes through a local proxy with an `allowedDomains` list that starts empty. Settings include `credentials` with `deny` and `mask` modes; masking needs `network.tlsTerminate`.
- The Bash sandbox does not cover built-in file tools, MCP servers, hooks or the status line. For those, run the whole process under the runtime: `srt claude`, with settings in `~/.srt-settings.json` or `--settings`. The runtime is a beta research preview whose configuration format may change.
- Write grants needed for the whole-process case: the project, `~/.claude` and `~/.claude.json` (so the profile's `CLAUDE_CONFIG_DIR`), and the temp directory (`/private/tmp` on macOS). Network: `api.anthropic.com`, plus `claude.ai` and `platform.claude.com` for OAuth sign-in and refresh.
- Known gaps: plain `ssh`, docker, most database drivers and UDP tools do not work inside; on macOS `git` over SSH fails; localhost access needs `allowLocalBinding`, which matters for reaching the app MCP server on loopback.
- The documentation recommends a container or VM for stronger isolation. The runtime is the lowest-cost driver for R23 and needs no Docker, but it shares the host kernel and the login credential stays readable inside the allowed `CLAUDE_CONFIG_DIR`.

## 3. Docker Sandboxes and dev containers

### Docker Sandboxes (`sbx`)

Sources: [Claude Code page](https://docs.docker.com/ai/sandboxes/agents/claude-code.md); secondary overviews from a web search (unverified): [Docker blog](https://www.docker.com/blog/untrusted-autonomous-workload-ai-sandboxes), [Arm install guide](https://learn.arm.com/install-guides/sbx/).

- `sbx run claude <dir>` starts Claude Code in a local microVM with its own kernel and Docker daemon. The default startup command is `claude --dangerously-skip-permissions`.
- Authentication: `sbx secret set anthropic` stores an API key outside the sandbox. If no key is set, `/login` inside Claude Code signs in through OAuth. Host `~/.claude` is not available inside; only project-level configuration is.
- Secondary sources: Apple Silicon macOS supported, Docker Desktop not required, workspace in direct or clone mode, outbound traffic through a host proxy. Not verified against the Docker documentation.
- Fit: a ready microVM driver with a Claude Code path. Questions for a spike: terminal attach for an embedded terminal, mounting a per-profile config directory, reaching the app MCP server from the VM, start latency.

### Dev containers

Source: [development containers](https://code.claude.com/docs/en/devcontainer).

- Claude Code installs through the Dev Container Feature `ghcr.io/anthropics/devcontainer-features/claude-code`. Authentication persists by mounting a volume at `~/.claude` and setting `CLAUDE_CONFIG_DIR` to the same path so `.claude.json` also lands in the volume.
- The reference container adds a default-deny iptables firewall with `NET_ADMIN` and `NET_RAW`.
- The page warns that with `--dangerously-skip-permissions` a malicious project can exfiltrate anything reachable in the container, including the Claude credentials in `~/.claude`. Avoid mounting `~/.ssh` or cloud credential files. This is the same limit as for any OAuth login stored inside the sandbox.
- A plain container driver (Docker or Podman) with a per-profile named volume mirrors this and needs no extra product.

## 4. SSH to a remote host

### Claude Desktop SSH sessions

Source: [SSH remote sessions (third-party deployments page)](https://claude.com/docs/third-party/claude-desktop/ssh-remote-sessions.md). This describes Claude Desktop, not the claude CLI, and is a beta feature.

- The UI stays local; the Claude Code engine runs on the remote host and is installed under `~/.claude/remote/` in the SSH user's home. No root is needed. Host needs OpenSSH-compatible server, a POSIX shell, git, about 1 GB free, and `MaxSessions` above 1 for the built-in client.
- The inference credential is passed by the app and sits in the engine's process environment while the engine runs. The engine ignores host credentials and copies no credential files.
- The session connection ignores `ForwardAgent`, port forwards and `RemoteCommand`. The engine keeps running through dropped links and app quits, and the server buffers the latest 16 MiB of output while disconnected.
- Linux hosts: with `KillUserProcesses=yes` a disconnect ends the engine.

### Plain CLI over SSH (what this app would use)

The app is not Claude Desktop, so it would spawn `claude` through `ssh -tt <host>` or hold its own SSH channel. Notes from the OpenSSH manual ([ssh_config](https://man.openbsd.org/ssh_config)):

- Reverse tunnel for the app MCP server: `RemoteForward` accepts a TCP form or a Unix socket path (any argument with `/`). Claude Code configures MCP servers as stdio, HTTP or SSE, so the remote side needs a TCP loopback port: `ssh -R 127.0.0.1:<remote-port>:127.0.0.1:<local-port> <host>`. Unix sockets as MCP endpoints are not documented, unverified.
- `ExitOnForwardFailure yes` makes ssh exit when a forward cannot be set up, which the app should treat as a failed launch. A Unix-socket forward needs `StreamLocalBindUnlink yes` to survive a stale socket file; `StreamLocalBindMask` defaults to `0177` (owner only).
- A loopback port on a shared remote host is reachable by other local users there, so the MCP endpoint needs the per-session bearer token the app already issues, and a distinct remote port per profile.
- `ControlMaster auto` with a `ControlPath` in a directory other users cannot write to shares one connection for terminal, tunnel and file operations; agent and X11 forwarding then use the master's settings.
- Agent forwarding: `ForwardAgent` exposes the local agent to the remote host's root. Use a dedicated per-profile `IdentityAgent` (overrides `SSH_AUTH_SOCK`) and `IdentitiesOnly yes`.
- Login on the remote host: the credential lives in the remote `~/.claude` (or `CLAUDE_CONFIG_DIR` there). On a headless host, macOS Keychain is irrelevant, and `.credentials.json` with mode 0600 is used. The browser login uses the paste-code fallback described in [authentication troubleshooting](https://code.claude.com/docs/en/troubleshoot-install.md#oauth-login-fails-in-wsl2-ssh-or-containers) (referenced from the dev container page; not read in full). A `claude setup-token` token can be passed as `CLAUDE_CODE_OAUTH_TOKEN` instead.

## 5. What Claude Code stores per CLAUDE_CONFIG_DIR

Sources: [.claude directory](https://code.claude.com/docs/en/claude-directory), [authentication](https://code.claude.com/docs/en/authentication), [multiple accounts](https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts). Documentation only; no account directory or keychain was inspected.

- With `CLAUDE_CONFIG_DIR` set, every `~/.claude` path lives under that directory, and `.claude.json` (account details, per-project trust, personal MCP servers) moves inside it too.
- Contents: `settings.json`, `CLAUDE.md`, `skills/`, `agents/`, `commands/`, `plugins/`, `projects/<project>/<session>.jsonl` transcripts and auto memory, `history.jsonl`, `file-history/`, `stats-cache.json` (token and cost totals behind `/usage`), `sessions/` (one small file per running session), `backups/`, `jobs/` and `daemon/` (background sessions), and `.credentials.json` where used.
- Login credential: on macOS the encrypted Keychain; if the Keychain write fails (locked, for example in an SSH session) it falls back to `.credentials.json` with mode 0600, the Linux behaviour. With `CLAUDE_CONFIG_DIR` set, the file lives under that directory "and keys the macOS Keychain entry to that directory too, so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry." The exact Keychain service name is not documented and was not inspected.
- Exceptions: a Console login without an API key is stored as an Anthropic profile under `~/.config/anthropic` (or the platform equivalent), outside the config directory, so two Console sign-ins of that kind do not stay apart. API-key and claude.ai logins follow the directory. `ANTHROPIC_PROFILE` and federation variables select credentials that outrank `/login`.
- Credential precedence (first match wins): cloud provider variables, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, Anthropic profile, then the `/login` subscription credential. A launcher must scrub these variables from the inherited environment so a profile does not pick up another profile's credential.
- `CLAUDE_CONFIG_DIR` cannot be set from project or local settings, only from the environment, user settings or managed settings. Setting it at spawn time is correct.
- Sign-in check: the [CLI reference](https://code.claude.com/docs/en/cli-reference) documents `claude auth status`, which prints JSON with `authMethod` and `configDirectory` and exits 0 when signed in and 1 when not. The [hooks reference](https://code.claude.com/docs/en/hooks) documents an HTTP hook type (`"type": "http"`, `url`, `headers`, `allowedEnvVars`) whose response body uses the command hooks' JSON output.
- Probe results for the claude CLI 2.1.326 are in `probes/RESULTS.md`; this survey adds no new probe. To verify before building: two directories hold two logins on macOS, connectors and plugins follow the directory, and `/status` shows the right account. The probe uses an empty temporary directory and no real login.

## 6. gh, git and SSH credentials per profile

- gh: `GH_CONFIG_DIR` sets the config directory (default `$XDG_CONFIG_HOME/gh`, then `$HOME/.config/gh`). `GH_TOKEN` (or `GITHUB_TOKEN`) takes precedence over stored credentials for github.com; `GH_ENTERPRISE_TOKEN` for other hosts. Source: [gh environment help](https://cli.github.com/manual/gh_help_environment).
- gh stores tokens in the system credential store by default and falls back to plain text; `--insecure-storage` forces plain text. Source: [gh auth login](https://cli.github.com/manual/gh_auth_login). The pages do not say what the keyring entry is keyed on. Secondary reports say copying a config directory does not copy the account and that `gh auth switch` changes shared keyring state across terminals ([hackernoon write-up](https://hackernoon.com/a-three-layer-setup-for-multiple-github-accounts-on-one-machine)). Unverified. Safe options: `GH_TOKEN` injected per profile launch, or `gh auth login --insecure-storage` into a per-profile `GH_CONFIG_DIR` with a 0700 directory. Verify on the target Mac before choosing.
- git: `GIT_CONFIG_GLOBAL` replaces the global config file, `GIT_CONFIG_SYSTEM` the system one, `GIT_CONFIG_NOSYSTEM` skips it, and `GIT_CONFIG_COUNT` with `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>` add runtime entries that override files but not `git -c`. Source: [git-config](https://git-scm.com/docs/git-config). A profile gets its own global file with `user.name`, `user.email` and `credential.helper`. A helper such as `!gh auth git-credential` then uses the profile's gh configuration or `GH_TOKEN`. Without it, git uses the macOS Keychain helper, which is shared across profiles.
- SSH: set `SSH_AUTH_SOCK` to the profile's agent socket, or use `IdentityAgent`, `IdentityFile` and `IdentitiesOnly yes` in a per-profile config passed as `GIT_SSH_COMMAND="ssh -F <profile ssh_config>"`. Without `IdentitiesOnly`, ssh offers every key the agent holds, so the wrong identity can authenticate first. With `IdentitiesOnly` but no `IdentityFile`, ssh uses the default files `~/.ssh/id_*`, which all profiles share; the `ssh_config` manual says `IdentityFile` together with `IdentitiesOnly` selects which agent identities are offered, so the profile names the public key file of its key.
- Also scrub or replace per profile: `HOME`-derived dotfiles read by tools, `AWS_PROFILE`, `NPM_CONFIG_USERCONFIG`, `DOCKER_CONFIG`, and any token variables inherited from the launching shell. Removing a location variable such as `DOCKER_CONFIG` sends the tool back to its default file under the real home, so isolation needs the variable set to a profile path, not only removed. Changing `HOME` is the strongest lever and also moves `~/.claude`, gh and git defaults, but it breaks tools that expect the real home; use it only inside isolation drivers.
- In the sandbox runtime, plain `ssh` and macOS `git` over SSH fail, so a sandboxed profile should push over HTTPS with a token ([sandboxing](https://code.claude.com/docs/en/sandboxing)).

## 7. Electron multi-instance patterns

Sources: [app API](https://www.electronjs.org/docs/latest/api/app), [session API](https://www.electronjs.org/docs/latest/api/session), [dock API](https://www.electronjs.org/docs/latest/api/dock).

- `app.setPath('userData', dir)` overrides the data directory; the directory must exist or an error is thrown. Call it at the top of the main process, before `ready`. `sessionData` can only be changed before `ready`. The `--user-data-dir=<dir>` switch is the Chromium equivalent.
- `app.requestSingleInstanceLock(additionalData?)` returns `false` when another instance holds the lock. The first instance then gets `second-instance` with `(event, argv, workingDirectory, additionalData)`, guaranteed after `ready`. `argv` may be reordered, so pass exact values in `additionalData`. On macOS and Linux the message is capped at 32 MB. On macOS the system single-instance mechanism is bypassed for command-line launches, so the lock call is still required.
- The documentation does not state that the lock is keyed to `userData`, but the source does: in Electron 45.3.3, `App::RequestSingleInstanceLock` in `shell/browser/api/electron_api_app.cc` reads `chrome::DIR_USER_DATA` and builds the `ProcessSingleton` from it (on Windows together with the app name), and `app.setPath('userData')` overrides that same path key. A short spike with two distinct `userData` values and one repeated value confirms it on the target Mac. The design in 0017 relies on this.
- Focus-or-start for a profile: the switcher spawns the app executable with `--profile=<name>`, detached. If that profile runs, the child fails the lock and exits; the running instance receives `second-instance` and focuses its window. If it does not run, the child becomes the instance. No registry lookup is needed to decide between focus and start. A start request from a profile that is not running goes through `child_process.spawn(process.execPath, [...])` or `open -n -a <bundle> --args --profile=<name>`.
- Session partitions: `session.fromPartition('persist:<name>')` gives persistent cookies shared by pages with that partition; no prefix gives an in-memory session. With one process per profile and its own `userData`, the default session and any `persist:` partitions already live under that profile's directory, so partition names do not need the profile in them. `ses.getStoragePath()` reports where a session persists. Partition options apply only when the session is first created.
- Badges: `app.setBadgeCount(n)` (macOS and Linux) shows a count on the dock icon; 0 hides it; omitted on macOS shows a dot. `app.dock.setBadge(text)` sets a string. Both need notification permission on macOS. `app.dock.bounce('informational'|'critical')` returns an id and works only when the app is unfocused. Each profile process has its own dock icon and its own badge; the profile rail inside a window needs counts from the other processes, which come from the registry.
- Processes share the bundle identity, so notification permission is granted once. Dock icons of several processes of one bundle show as separate tiles only while running; naming the profile in the window title and in a per-profile dock icon overlay (colour) helps. Unverified how macOS groups them; check on the target Mac.

## 8. Cross-process registry in a per-user directory

Design notes for 0017's registry (profile name, colour, unread count only).

- Location: a directory under the per-user application support directory of the app (outside every profile's `userData`), created with mode 0700. Do not use `/tmp` or a shared temp location.
- One file per profile, `<profile-id>.json`, written only by that profile's process. No shared file means no write lock and no lost update. Content: profile id, display name, colour, unread count, pid, process start time, `updatedAt`, schema version. No message text, session or project names.
- Atomic write: write `<id>.json.<random>.tmp` in the same directory with mode 0600, flush, then `rename` over the target. `rename` within one directory on APFS replaces atomically, so readers see the old or the new file and never a partial one. Readers ignore `*.tmp`.
- Reading: list the directory, parse each file, skip files that fail to parse (they may be mid-rename on another filesystem or corrupt). Watch the directory with `fs.watch` for changes and fall back to a slow poll, since directory watch events on macOS can coalesce or drop.
- Stale entries: an entry is live when its pid exists (`process.kill(pid, 0)`) and the recorded start time matches the process start time (guards pid reuse), or when `updatedAt` is within a heartbeat window. A clean exit deletes the file; a crashed profile leaves one, so readers treat dead pids as "not running" and show the profile greyed, without deleting other profiles' files. The owner removes its own stale file at next start. A profile definition (name, colour) belongs to the profile's own directory; the registry file is a cache of it, so losing a registry file loses nothing durable.
- Permissions and trust: create files with mode 0600 and the directory 0700, `lstat` each entry and ignore symlinks and files not owned by the current uid, cap file size, and validate with a schema (colour as a fixed hex pattern, count as a non-negative integer) before use. The renderer never reads the registry directly; the main process does and sends sanitized data.
- Opt-out and hiding: a profile with the badge hidden omits the count field. Agents in an isolation driver cannot reach the directory because it is outside the mounted paths and outside the sandbox policy (R23).
- Alternatives considered: one shared JSON file needs a lock and loses updates under contention; a local socket or XPC needs a broker process; the NSDistributedNotificationCenter or a Unix datagram socket adds wake-up latency gains but not durability. Files plus `fs.watch` are enough for a count that changes a few times a minute.

## 9. Recommendations for 0017 and 0018

1. Profile launcher: one process per profile, `userData`, `CLAUDE_CONFIG_DIR`, `GH_CONFIG_DIR`, `GIT_CONFIG_GLOBAL`, `SSH_AUTH_SOCK` and a scrubbed environment derived from the profile id. Keep a launch-environment builder in one small module with a test that asserts no inherited credential variable survives.
2. Verify on the target Mac with throwaway profiles: Electron lock keyed by `userData`; Claude Keychain entry per `CLAUDE_CONFIG_DIR`; gh keyring behaviour with two `GH_CONFIG_DIR` values.
3. Isolation drivers in order of cost: none, Claude sandbox runtime (`srt`), container or Docker Sandboxes microVM, OpenShell, SSH host. Every driver must declare how it handles the login credential: mounted config directory (readable by the agent), API key held outside (placeholder or proxy), or login performed inside the environment. A setup token held by a proxy is left out because of Anthropic's terms on intermediating claude.ai tokens (providers section).
4. Treat OpenShell as an optional driver behind the interface, gated on a spike for: terminal attach, Claude with an API key through a provider, project mount, host MCP reachability, cold and warm start latency on Apple Silicon.
5. For SSH, spawn `claude` through the system `ssh` with `-R` loopback forwarding for the app MCP server, a per-session token, `ExitOnForwardFailure yes`, a per-profile `IdentityAgent`, and a login performed or a setup token supplied on the remote.

## Unverified items

- Whether the Claude Code TUI runs through `openshell sandbox connect` or `sandbox exec --tty` with resize and Esc intact.
- OpenShell start latency on Apple Silicon; which workspace mode keeps the filesystem policy; host MCP reachability from the Docker Desktop VM under the loopback and private-address rules.
- OpenShell with a claude.ai subscription login inside the sandbox (the setup-token route is out per Anthropic's published terms, see the providers section).
- Docker Sandboxes details beyond the Claude Code page.
- The Electron single-instance lock per `userData` on the target Mac (the source confirms the keying).
- What the gh keyring entry is keyed on; the Claude Keychain service name.
- macOS dock grouping of several processes of one bundle.
- Unix sockets as MCP endpoints in Claude Code.
