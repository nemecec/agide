# 0018 Pluggable agent isolation

Status: proposed (requirement stated by the user; providers and design await research)
Date: 2026-11-17
Decided by: Neeme (idea); the design direction is an agent proposal
Amends: 0008 (adds R23)

## Context

The user wants to isolate the environment where agents run, with NVIDIA OpenShell as one option, and to make it pluggable so a person can run agents, or a whole profile, in a Docker container or another form of isolation, including a remote machine.

OpenShell (https://github.com/NVIDIA/OpenShell, Apache-2.0) describes itself as a runtime for fleets of autonomous agents. From its README: each agent runs in a sandbox with kernel controls on files and system calls; every network connection passes a policy check; credentials are held by the runtime and added only to requests for approved endpoints; policy changes that grant new access wait for human review; a CLI and a local gateway, SDKs for Python, TypeScript, Go and Rust, compute drivers, middleware and interceptors; Docker, Podman or host virtualization on Linux and Apple Silicon macOS; Kubernetes deployment through Helm. The README does not list Claude Code as a supported agent, and it does not say how an interactive terminal session is attached. The project is at an early version and is moving to the CNCF.

Other options researched: Claude Code's own sandbox runtime (Seatbelt on macOS, bubblewrap on Linux), Docker Sandboxes, dev containers, microVM services (Firecracker based), SSH to a remote host, and local virtual machines (for example Tart or Lima).

## Decision

- R23 Pluggable isolation. Weight 2 is proposed. The application defines an isolation provider interface. A provider prepares an environment for a profile or for a single agent, starts a command inside it on a PTY, mounts or syncs the workspace, applies a network and filesystem policy, and tears the environment down. The default provider runs agents on the host with no isolation.
- The interface must solve the couplings that milestone 1 found:
  - the PTY attaches by running the provider's wrapper command in the PTY (for example a container exec, an OpenShell connect command or `ssh -t`);
  - hook events reach the app through a mounted events directory or through an HTTP endpoint, instead of a host-only file path;
  - the app's MCP server is reachable from the environment (host gateway address for containers, a reverse tunnel for a remote host) and keeps its per-session token;
  - the profile's Claude configuration directory exists inside the environment, so the login, skills, plugins and transcripts follow the profile, and the app can read transcripts for agent history (0009);
  - the workspace or worktree is mounted or cloned, and results come back through git;
  - tool credentials (GitHub, git) are injected per policy.
- The network policy of the provider serves the outward-action gate of 0010: the sandbox network allowlist is the provider's policy.
- OpenShell is a candidate first strong provider, to be confirmed by research and then a probe. Order of providers: the local provider first, then one container provider, then OpenShell.
- Subscription logins: for a profile on a Claude subscription, the login is completed inside the environment through Anthropic's own flow, so the app does not store or forward the OAuth token. A credential-injecting proxy is used for API keys and tool credentials. Whether a proxy may hold subscription credentials is unverified against Anthropic's legal page ("developers may not collect, store, or intermediate Claude.ai credentials") and is not assumed to be allowed.

## Consequences

- The interface lands in milestone 2 with the profile work (0017), so session launch goes through a provider from the start.
- A rough guess is 8 to 12 working days for the interface, the local provider and one container provider, and 5 to 10 more for OpenShell after a probe; low confidence.
- A probe of OpenShell installs third-party software and needs Docker or virtualization on the host. It runs only after the user agrees (0012 keeps third-party software off the host by default).
- Open questions: whether the interactive Claude Code TUI and its hooks run unchanged inside an OpenShell sandbox, how the subscription login behaves in a Linux environment without the macOS keychain, how OpenShell policies express a per-session MCP endpoint on the host, the cost and latency of sandbox start, and how remote profiles reach browser surfaces (they stay on the host: embedded browsers are not agent code).
