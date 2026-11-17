# 0022 Profiles and isolation design

Status: proposed
Date: 2026-11-17
Decided by: spike agents (design proposal; the user confirms)
Inputs: 0004 (amended by 0014), 0006, 0010, 0012, 0013, 0014, 0017, 0018, 0019; `notes/profiles-and-isolation.md` (documentation survey, nothing run); `probes/RESULTS.md`; the session launch code in `app/src/core/session` and `app/src/main`
Refines: 0017 (R22) and 0018 (R23)
Amends: 0013 security limits (the bearer token leaves the `claude` process arguments)

## Context

0017 asks for top-level profiles: one application process per profile, each with its own data directory, Claude configuration directory, browser partitions, app MCP server and tool credentials, plus a switcher rail with unread badges fed by a small cross-profile registry. 0018 asks for an isolation provider interface that runs agents on the host, in a container, in OpenShell or on a remote host, and that solves the couplings milestone 1 found between the session launch and the host.

The milestone 1 launch path today:

- `app/src/main/index.ts` sets `userData` from `AGIDE_USER_DATA` or uses Electron's default (`<appData>/agide`), takes `requestSingleInstanceLock()` with no data, and focuses the first window on `second-instance`.
- `PtySessionService` spawns the `claude` binary in node-pty with `buildLaunchArgs` (`--session-id` or `--resume`, `--permission-mode`, `--setting-sources user`, `--settings` with the hook JSON inline) and `extraArgs` from the session module, which adds `--mcp-config` with the JSON inline. The JSON carries the per-session bearer token, so the token is in the process arguments (0013 security limits, 0014 open item).
- `claudeEnv` removes variables injected by a parent Claude Code session and keeps everything else, including `CLAUDE_CONFIG_DIR` and any credential variable of the launching shell.
- Hooks are command hooks that write one file per payload into a per-session inbox directory under `<userData>/session-events/<sessionId>`; `HookInbox` watches that directory.
- The app MCP server binds 127.0.0.1 on a random port, accepts a `Host` of `127.0.0.1:<port>` or `localhost:<port>` only, and issues one token per session.

The survey found: Claude Code keys the login, transcripts, settings and `.claude.json` to `CLAUDE_CONFIG_DIR`, including the macOS Keychain entry; gh keyring storage and git's global credential helper can leak across profiles; Electron supports a data directory per process and a `second-instance` event with extra data, and its single-instance lock is keyed to the `userData` directory (Electron 45.3.3 source); OpenShell is pre-1.0, runs on Apple Silicon through Docker Desktop (the support matrix also documents a Podman driver and a MicroVM driver), documents API-key providers only, and documents `openshell sandbox connect` for an interactive terminal. Several facts are unverified and appear below as probes.

## Decision

### 1. Profile model

A profile is a directory with a definition file and a settings file. Every profile process reads the definition of every other profile, and nothing else of it. The definition holds only what 0017 lets cross profiles (name and colour) plus the id and creation time; paths, the git identity and provider options live in the settings file, which only the profile's own process reads.

```ts
/** Lowercase letters, digits and hyphens, starting with a letter, at most 32 characters. Never changes. */
type ProfileId = string;

/** `profile.json`: read by every profile process. */
interface ProfileDefinition {
  readonly schema: 1;
  readonly id: ProfileId;
  /** Display name, at most 40 characters, rendered as plain text. */
  readonly name: string;
  /** One of the palette colours, as `#rrggbb`. */
  readonly colour: string;
  readonly createdAt: string;
}

/** `settings.json`: read by the profile's own process only. */
interface ProfileSettings {
  readonly schema: 1;
  readonly claudeConfig: ClaudeConfigLocation;
  readonly tools: ToolCredentialMode;
  /** The provider sessions of this profile use unless a session names another. `local` by default. */
  readonly isolation: { readonly provider: ProviderId; readonly options?: unknown };
  /** Dock badge of this profile's own process. */
  readonly showBadge: boolean;
  /** Whether the unread count goes into the registry for other profiles' rails. */
  readonly shareUnread: boolean;
}

type ClaudeConfigLocation =
  /** Do not set CLAUDE_CONFIG_DIR: the CLI uses `~/.claude` and `~/.claude.json` and its default Keychain entry. */
  | { readonly mode: 'cli-default' }
  /** Set CLAUDE_CONFIG_DIR to this absolute path. */
  | { readonly mode: 'directory'; readonly path: string };

type ToolCredentialMode =
  /** Keep the tool variables of the environment the app started with. Only the default profile may use it. */
  | { readonly mode: 'inherit' }
  /**
   * Per-profile gh directory, git global file, SSH configuration and tool configuration files. `ssh` names the
   * profile's agent socket and the public key file of the key in that agent that the profile offers.
   */
  | {
      readonly mode: 'isolated';
      /** Absent until the setup pane (section 4) records it; `user.useConfigOnly` in the generated file then makes git refuse to commit. */
      readonly git?: { readonly userName: string; readonly userEmail: string };
      readonly ssh?: { readonly agentSocket: string; readonly publicKeyFile: string };
    };
```

Layout under the app root `<appData>/agide` (the milestone 1 `userData`):

| Path | Owner | Mode | Holds |
|---|---|---|---|
| `profiles/<id>/profile.json` | the profile's own process; the creating process once | 0600 | the definition |
| `profiles/<id>/settings.json` | the profile's own process; the creating process once with defaults | 0600 | the settings |
| `profiles/<id>/data/` | the profile's process | 0700 | Electron `userData`: `app.db`, session inboxes, session files, Chromium state and partitions |
| `profiles/<id>/claude/` | the Claude CLI | 0700 | `CLAUDE_CONFIG_DIR` of a new profile |
| `profiles/<id>/tools/gh/` | gh | 0700 | `GH_CONFIG_DIR` |
| `profiles/<id>/tools/gitconfig` | the app | 0600 | `GIT_CONFIG_GLOBAL` |
| `profiles/<id>/tools/ssh_config` | the app | 0600 | the file `core.sshCommand` passes to `ssh -F` |
| `profiles/<id>/tools/aws/`, `npmrc`, `docker/` | the tools | 0700 or 0600 | `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE`, `NPM_CONFIG_USERCONFIG`, `DOCKER_CONFIG` |
| `profiles/<id>/envs/<provider>/` | the provider | 0700 | provider state, for example a container's Claude directory |
| `registry/<id>.json` | the profile's process | 0600 | the registry entry (section 3) |
| `lastProfile` | any profile process, atomic write | 0600 | the id of the profile focused last |

The root directory is created 0700, or set to 0700 when milestone 1 created it. `profiles/` holds only profile directories; a directory without a valid `profile.json` is skipped, since it may be a creation in progress. Besides `profiles/`, `registry/`, `lastProfile` and the transient `migrate.lock` and `profiles.migrating/`, the app writes nothing at the root after the migration below.

Decisions inside the model:

- Data directory. `app.setPath('userData', profiles/<id>/data)` runs before `ready`, together with `sessionData`. The directory must exist first: Electron's typings say `setPath` throws for a directory that does not exist. The `AGIDE_USER_DATA` override of the tests stays and wins: it names the data directory of a single unnamed profile, so the existing e2e suites keep working. A second override, `AGIDE_ROOT`, replaces the app root, so the profile e2e test (section 8) runs profiles and a registry on a temporary root.
- Migration of milestone 1. On the first start of the profile build, when `profiles/` does not exist, the process creates `migrate.lock` at the root with an exclusive create and its pid inside. It builds the default profile in `profiles.migrating/` (moves `app.db`, its `-wal` and `-shm` files and `session-events/` into its `default/data/`, writes the default definition and settings) and renames `profiles.migrating/` to `profiles/` as the last step, then removes the lock. A process that finds the lock held waits until `profiles/` appears; a lock whose pid is dead is removed and the migration starts again from a cleared `profiles.migrating/`. The migration does not run while a milestone 1 process holds the root: Chromium's `SingletonLock` link at the root names a live pid, and the process then shows a notice and exits. Chromium files at the root are left in place: milestone 1 has no browser surface, so they hold nothing the user needs. The user has not used milestone 1 (0014), so the move carries test data at most.
- Default profile and the existing login. The default profile adopts the Claude login the app sees today. If `CLAUDE_CONFIG_DIR` is set in the environment at migration, the settings store `{ mode: 'directory', path }` with that value; otherwise `{ mode: 'cli-default' }`. The value is stored at migration because an app started from the Finder has no shell environment. The app never sets `CLAUDE_CONFIG_DIR` to `~/.claude` for a `cli-default` profile: the documentation says the variable moves `.claude.json` into the directory and keys the Keychain entry to it, so setting it to the default path could select a different, empty login (probe C1 settles it). The default profile uses `tools: { mode: 'inherit' }`, so milestone 1 behaviour is unchanged apart from the removal of Claude credential variables below.
- New profiles get `{ mode: 'directory', path: profiles/<id>/claude }` and `tools: { mode: 'isolated' }`. A new profile may instead point at an existing Claude directory the user names, for example a work directory already in use from the terminal; the app then shares that directory with the terminal and says so in the profile settings.
- Browser partitions. Partition names carry no profile id (`persist:jira`, `persist:github` and so on, as 0006 names them per service). Isolation comes from `userData`: each process stores its partitions under its own data directory. The browser module test asserts that `session.getStoragePath()` of every partition lies under the profile's data directory.
- Tool credential environment. The launch environment is built in one module, `profileEnv`, from the base environment and the settings:
  - Always removed: the variables `claudeEnv` removes today (which include `CLAUDE_CODE_OAUTH_TOKEN` and the `CLAUDE_CODE_USE_*` cloud provider selectors), and every other variable that selects a Claude credential (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`, `CLAUDE_CONFIG_DIR` unless the settings set it).
  - For `isolated` profiles also removed: `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GH_HOST`, `GH_CONFIG_DIR`, `GIT_CONFIG_*`, `GIT_ASKPASS`, `SSH_ASKPASS`, `SSH_AUTH_SOCK`, `GIT_SSH`, `GIT_SSH_COMMAND`, `AWS_*`, `NPM_CONFIG_USERCONFIG`, `DOCKER_CONFIG`; then set `GH_CONFIG_DIR`, `GIT_CONFIG_GLOBAL`, `AWS_CONFIG_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, `NPM_CONFIG_USERCONFIG` and `DOCKER_CONFIG` to the profile's `tools/` paths. Removing a variable alone sends the tool back to its shared default under the home directory, so each removed location variable is set again to a profile path.
  - The generated `gitconfig` sets `user.useConfigOnly`, `user.name` and `user.email` (once known), an empty `credential.helper` entry (which clears helpers from the system file, such as the macOS Keychain helper) followed by `!gh auth git-credential`, and `core.sshCommand` as `ssh -F <profile>/tools/ssh_config`. That file sets `IdentityAgent` to the profile's socket, `IdentityFile` to the profile's public key file and `IdentitiesOnly yes`. `IdentitiesOnly` alone is not enough: with no `IdentityFile`, ssh uses the default files `~/.ssh/id_*`, which every profile shares. Without an `ssh` entry the file sets `IdentityAgent none` and an `IdentityFile` path inside the profile that does not exist, so no key is offered and the profile uses HTTPS for git. `-F` also keeps the user's `~/.ssh/config` out.
  - gh logs in per profile with `gh auth login --insecure-storage` into the profile's `GH_CONFIG_DIR`, until probe G1 shows that keyring entries stay apart per directory. The file is under a 0700 directory.
  - A test asserts that no removed variable survives for each mode, and that an `isolated` environment holds no value from the base environment's credential variables.

### 2. Process model

- One Electron process per running profile. Every start carries `--profile=<id>`; a start without it opens the profile used last (`lastProfile` at the root, written on focus), else `default`. An unknown id opens `default` and shows a notice.
- Before `ready`, the process reads and validates `profiles/<id>/profile.json` and `settings.json`, creates `data/` if missing, sets `userData` and `sessionData`, then calls `app.requestSingleInstanceLock({ profileId, action })`. If the lock is held, the process exits; the running process of that profile gets `second-instance`, validates the `additionalData` shape, and focuses or restores its window. `argv` is not read, because Electron may reorder it.
- This relies on the lock being keyed to `userData`. The Electron 45.3.3 source confirms it: `App::RequestSingleInstanceLock` builds the process singleton from `chrome::DIR_USER_DATA`, the path `setPath('userData')` overrides (on Windows the app name is part of the key too). Probe E1 checks it on the target Mac. If E1 shows a lock per bundle, the fallback is a lock file per profile (`data/instance.lock`, exclusive create, with the pid and a stale check as in the registry) and a 0600 Unix socket `data/focus.sock` that a second process connects to with the focus request.
- Launcher. `openProfile(id)` in the main process: if `id` is the own profile, focus the window. Otherwise spawn `process.execPath` (plus the app path in development) with `--profile=<id>`, detached, stdin and stdout ignored, with the base environment the current process started with. The single-instance lock decides between focus and start, so the launcher reads no registry and keeps no state. A start failure shows a notice in the calling window.
- Switcher rail. An optional block (R20) at the window edge, on by default when more than one profile exists. It lists every definition in `profiles/`, ordered by creation, showing the colour, the initial, a running mark from the registry and the unread badge. Clicking an entry calls `openProfile`. A last entry opens profile creation.
- Window chrome and notifications. The window title is `<profile name> · Agide`; a colour strip in the title bar uses the profile colour; notifications name the profile.
- Dock. Each process has its own dock tile; `app.setBadgeCount` shows the own unread count when `showBadge` is set. A colour overlay on the dock icon waits until probe E2 shows how macOS groups the tiles.
- Quit. Each profile quits on its own. A clean quit removes the registry entry. "Quit all profiles" waits: it needs a channel into the other processes.

### 3. Registry

- Directory `registry/` under the app root, 0700. One file per profile, `<id>.json`, mode 0600, written only by that profile's process.
- Content, schema version 1:

```ts
interface RegistryEntry {
  readonly schema: 1;
  readonly profileId: ProfileId;
  readonly pid: number;
  /** Random per process start; a changed value means a restart. */
  readonly instanceId: string;
  /** Updated at least every 30 seconds while the process runs. */
  readonly updatedAt: string;
  /** Unread inbox items (R21). Omitted when `shareUnread` is off. */
  readonly unread?: number;
}
```

- It must not contain message text, session, project, folder or task names, paths, ports, tokens, account names or e-mail addresses, plan usage, or anything the renderer of another profile could act on. Name and colour come from the definitions, not from the registry. Plan usage in the rail (0019) shows the own profile only; showing it across profiles adds a field to the data that crosses profiles, which 0017 does not allow without the user's consent.
- Atomic writes: write `<id>.json.<random>.tmp` in the same directory with mode 0600, `fsync`, `rename` over the target. Writes happen on change and on the heartbeat.
- Readers: the main process only. It lists the directory, skips `*.tmp`, `lstat`s each entry and skips symbolic links, files of another uid and files over 4 KiB, parses with a zod schema (id pattern, non-negative integer counts, ISO time), and drops an entry whose `profileId` differs from its file name or names no existing definition. It watches the directory with `fs.watch` and polls every 5 seconds, since macOS watch events can coalesce. The renderer gets `{ profileId, running, unread? }` per profile through the event bus.
- Stale detection: an entry is running when `process.kill(pid, 0)` succeeds and `updatedAt` is younger than 90 seconds. A dead or old entry shows the profile as not running. Readers never delete another profile's file; the owner replaces its own file at start. A pid reused within the window shows a stopped profile as running, and clicking it still starts the profile through the lock.
- A lost or damaged registry file loses nothing durable: definitions live in `profiles/`, counts are recomputed by the owner.

### 4. Profile creation and login

1. The user opens "New profile" from the rail or the app menu, enters a name and picks a colour. The id is derived from the name and made unique.
2. The creating process claims the id with `mkdir profiles/<id>` (fails if it exists), creates the subdirectories with their modes, writes the settings with defaults and then the definition, both with the atomic write. Other processes skip the directory until `profile.json` is valid.
3. It calls `openProfile(id)`. The new process starts with no sessions and shows a setup pane with the steps that remain:
   - Claude login: the pane starts a terminal session (the normal session surface, local provider, in an empty directory under `data/`) running `claude` with the profile's `CLAUDE_CONFIG_DIR`. A fresh configuration directory runs the CLI's own onboarding and `/login` flow. The app does not read, store or forward the credential (0001, 0018). The pane marks the step done when `claude auth status` with the profile's environment exits 0; the CLI reference documents that exit code for a signed-in directory and a JSON output with `authMethod` and `configDirectory` (probe C4 confirms it on 2.1.326). The app reads only the exit code and `authMethod`, not the account fields.
   - Git identity: the user enters the name and e-mail; the app writes them into the settings and generates `tools/gitconfig`. Entering them here, in the new profile's own window, keeps them out of the creating profile.
   - GitHub: a terminal session running `gh auth login --insecure-storage` with the profile's `GH_CONFIG_DIR`. Optional.
   - SSH: the user names an agent socket path and the public key file of the key to offer, or skips; with no socket the profile uses HTTPS for git.
4. Each step can be done later from the profile settings. The first session in an unseen directory still shows the folder-trust prompt, since trust entries are stored per Claude configuration directory.

Deleting a profile waits (it removes logins and transcripts and needs a confirmation design).

### 5. IsolationProvider interface

Session launch goes through a provider from the start. The session service asks the provider for the command node-pty spawns; everything else in `PtySessionService` (output buffer, status, resume, close) stays.

```ts
type ProviderId = 'local' | 'fake' | 'srt' | 'container' | 'openshell' | 'ssh';

interface IsolationProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  /** Checks prerequisites (binary present, daemon up, host reachable) without changing anything. */
  check(): Promise<ProviderCheck>;
  /** Prepares or reuses the environment for a profile or one session. Idempotent per `key`. */
  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment>;
}

interface ProviderCapabilities {
  /** Whether the provider limits what the agent reads and writes outside the workspace. */
  readonly filesystem: 'host-user' | 'enforced';
  /**
   * Whether `NetworkPolicy` is enforced. `bash-allowlist`: Claude Code's own Bash sandbox enforces it for Bash
   * commands only (the CLI writes 0010 relies on), not for file tools, MCP servers or hooks. `allowlist`: the
   * whole agent process. 0010 treats `none` as "ask rules only" and shows it.
   */
  readonly network: 'none' | 'bash-allowlist' | 'allowlist';
  /** Where the Claude login lives and who can read it. */
  readonly login: 'host-keychain' | 'environment-file' | 'held-outside';
  readonly hookTransports: readonly HookTransportKind[];
  /** Transcripts readable as host files (bind mount, local) or only through `readFile`. */
  readonly transcripts: 'host-files' | 'remote';
}

type ProviderCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly fix?: string };

interface EnvironmentSpec {
  /** Profile id, plus a session id for a per-session environment. */
  readonly key: { readonly profileId: ProfileId; readonly sessionId?: SessionId };
  readonly profile: ProfileLaunchSpec;
  readonly workspace: WorkspaceSpec;
  readonly network: NetworkPolicy;
  /** The app's HTTP listener on the host (MCP and hook endpoints), always 127.0.0.1. */
  readonly appEndpoint: { readonly port: number };
}

interface ProfileLaunchSpec {
  /** Host directory of the profile's Claude configuration, or undefined for `cli-default`. */
  readonly claudeConfigDir: string | undefined;
  /** Output of `profileEnv`: scrubbed base plus the profile's tool variables. No secret values. */
  readonly env: Readonly<Record<string, string>>;
  /** Files the provider makes available read-only, such as the git global file. Host paths. */
  readonly toolFiles: readonly { readonly hostPath: string; readonly envVar: string }[];
}

type WorkspaceSpec =
  | { readonly mode: 'bind'; readonly hostPath: string }
  /** Remote providers: clone the repository and return results through git. */
  | { readonly mode: 'clone'; readonly remoteUrl: string; readonly ref: string };

type NetworkPolicy =
  | { readonly mode: 'unrestricted' }
  /** Anthropic API and OAuth hosts and the app endpoint are always added by the provider. */
  | { readonly mode: 'allowlist'; readonly allow: readonly { readonly host: string; readonly port?: number }[] };

interface AgentEnvironment {
  readonly id: string;
  readonly provider: ProviderId;
  /** Maps paths between host and environment. Identity for `local` and for bind mounts at the same path. */
  readonly paths: { toEnv(hostPath: string): string; toHost(envPath: string): string | undefined };
  /**
   * Writes a session file the CLI reads at start (MCP config, settings) with mode 0600 in a 0700 directory
   * the environment can read, and returns its path inside the environment. Removed by `releaseSession`.
   */
  writeSessionFile(sessionId: SessionId, name: 'mcp.json' | 'settings.json', content: string): Promise<string>;
  /** How hook payloads reach the app for this session. */
  hookDelivery(sessionId: SessionId, target: HookTarget): HookDelivery;
  /** The app MCP endpoint as the CLI inside the environment must address it. */
  mcpEndpoint(sessionId: SessionId): McpEndpoint;
  /** The host command node-pty spawns. Secrets never appear in `args`. */
  ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand>;
  /** Ends the agent process inside the environment; killing the host client is not enough for every provider. */
  terminate(sessionId: SessionId, signal: 'SIGTERM' | 'SIGKILL'): Promise<void>;
  /** Reads a file such as a transcript by its environment path. */
  readFile(envPath: string): Promise<Uint8Array>;
  releaseSession(sessionId: SessionId): Promise<void>;
  dispose(): Promise<void>;
}

type HookTransportKind = 'inbox-dir' | 'http';
type HookTarget = { readonly inboxHostDir: string; readonly httpPath: string; readonly token: string };
type HookDelivery =
  /** Command hook that writes one file per payload; `dir` is the inbox as seen inside the environment. */
  | { readonly kind: 'inbox-dir'; readonly dir: string }
  /** Hook that posts the payload to the app; the token goes into the 0600 settings file, never into args. */
  | { readonly kind: 'http'; readonly url: string; readonly token: string };

interface McpEndpoint {
  readonly url: string;
  /** Host header value the app server must accept for this session, in addition to its loopback names. */
  readonly hostHeader: string;
}

interface ClaudeLaunch {
  readonly sessionId: SessionId;
  readonly cwd: string; // host path; the provider maps it
  readonly args: readonly string[]; // from buildLaunchArgs, with file paths already mapped
  readonly cols: number;
  readonly rows: number;
}

interface PtyCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}
```

How each coupling of 0018 is solved:

| Coupling | Interface | local | container | ssh |
|---|---|---|---|---|
| PTY attach | `ptyCommand` returns what node-pty spawns; resize and keystrokes pass through the PTY | `claude` itself | `docker exec -it --env-file <0600 file> <ctr> claude …` | `ssh -tt -o ExitOnForwardFailure=yes -R … <host> -- claude …` |
| Process end | `terminate` | signal to the PTY child | signal to the agent inside the container through a pid file the wrapper writes (killing the `docker exec` client can leave the inner process running, probe D2) | closing the channel sends SIGHUP; `terminate` also signals the remote pid |
| Hook events | `hookDelivery` | `inbox-dir` on the host, as today | `inbox-dir` bind-mounted at the same path | `http` through the reverse tunnel |
| App MCP reachability | `mcpEndpoint` plus a per-grant `Host` allowance on the server | `127.0.0.1:<port>` | Docker Desktop host address (probe D1), `hostHeader` set to it | `127.0.0.1:<remote port>` through `-R`, one remote port per session |
| Token handling | `writeSessionFile` for `mcp.json` and `settings.json`, passed as `--mcp-config <path>` and `--settings <path>` | 0600 file in `data/sessions/<id>/` (0700) | same file, the directory bind-mounted read-only | written over the SSH control connection with `umask 077` under the remote profile directory, removed at release |
| Claude configuration directory | `ProfileLaunchSpec.claudeConfigDir` | the profile's directory | a separate host directory `envs/container/claude`, bind-mounted at the same path, with the login done inside the container; this departs from 0018, which asks for the profile's own directory inside the environment (see below) | a remote directory per profile, login done on the remote host |
| Workspace | `WorkspaceSpec` | host path | bind mount at the same absolute path, so transcript project keys and hook paths need no mapping | `clone`; results return by push to a branch the app fetches |
| Transcripts | `paths`, `readFile`, `capabilities.transcripts` | host files | host files through the bind mount | `readFile` over SSH on demand; the agent history index (0009) stores provider, environment id and environment path |
| Tool credentials | `ProfileLaunchSpec.env` and `toolFiles` | environment variables | env file and read-only file mounts; no host SSH agent by default | variables set in the remote command from a 0600 file; no agent forwarding by default |
| Network policy | `NetworkPolicy`, `capabilities.network` | `bash-allowlist`: the app's settings file turns on Claude Code's Bash sandbox (`sandbox.enabled`, `sandbox.network.allowedDomains`), which 0010 and 0012 already assume for CLI writes; on macOS it also breaks `git` over SSH inside Bash | not enforced in the first container provider; a proxy container later | not enforced by the app; the remote host's own rules apply |

Further rules:

- The app MCP server and hook endpoint share one HTTP listener on 127.0.0.1. The server gains `POST /hooks/<sessionId>` with its own per-session hook token, separate from the MCP token, so a hook credential cannot call tools. The `Host` check keeps loopback names and adds the `hostHeader` of the session's grant; requests with an `Origin` still get 403.
- Separate Claude directories for container and remote providers. 0018 asks that the profile's Claude configuration directory exist inside the environment. The design gives each such environment its own directory: the host login of a `cli-default` or `directory` profile sits in the macOS Keychain, which a Linux environment cannot read, and mounting the host directory would expose the transcripts of host sessions to the agent inside. The cost is that skills, agents, plugins and user settings of the profile do not follow into the environment, and agent history (0009) reads more than one directory per profile. Read-only mounts of selected subdirectories (`skills/`, `agents/`) are an option for the container provider; the user decides when that provider is built.
- The `http` hook transport uses the CLI's own HTTP hook type (`"type": "http"` with `url` and `headers`, documented in the hooks reference; the token sits as a literal header value in the 0600 settings file), or a command hook that runs `curl --data-binary @-` with the token read from a file if probe C3 shows that 2.1.326 lacks the type. A permission hook that waits for the app's answer (0010) needs `http`, since `inbox-dir` has no reply path.
- `--settings <path>` and `--mcp-config <path>` take file paths as documented (the CLI reference requires a regular file of at most 2 MiB for `--settings`); probe C2 confirms both in the PTY. The files are 0600 and readable by the same user and by the agent, which needs the token anyway. The change removes the token from `ps` output and from crash reports that list arguments; it does not protect against a same-user process (0013 limit stands otherwise).
- Every provider declares `login`. `host-keychain` and `environment-file` mean the agent can read its own login credential; only `held-outside` (API key behind a proxy) keeps it out. The profile settings show this per provider.
- The fake provider records every `prepare`, `ptyCommand`, `writeSessionFile` and `terminate` call, returns a configurable `PtyCommand` (the fake `claude` script of the session tests), and can be told to fail at any step. Contract tests run against `local` and `fake`.

### 6. Provider roadmap

| Order | Provider | Isolation | Login | Needs | Status |
|---|---|---|---|---|---|
| 1 | `local` | none; same user, host kernel | host Keychain per configuration directory | nothing new | first M2 slice |
| 2 | `srt` (Claude Code sandbox runtime around the whole process) | Seatbelt filesystem and network allowlist on the host | host Keychain (Keychain access under the Seatbelt profile is unverified); the configuration directory is writable inside | the `@anthropic-ai/sandbox-runtime` package; beta research preview | candidate; lowest cost to enforce `NetworkPolicy` on macOS; third-party install needs the user's consent (0012) |
| 3 | `container` (Docker or Podman) | Linux VM and container; workload network optional | `.credentials.json` 0600 in the per-profile container directory, readable by the agent | Docker Desktop or Podman on the host | after the user agrees; probes D1 to D3 |
| 4 | `openshell` | Landlock, seccomp, supervisor proxy with default-deny egress and credential placeholders | API key held outside through a provider; a claude.ai login only by logging in inside, which gives up the placeholder property | Docker Desktop (the macOS platform of the support matrix; Podman and MicroVM drivers are documented too), the OpenShell CLI and gateway, pre-1.0 | experimental, after probes O1 to O7 |
| 5 | `ssh` | separate machine | login on the remote host (paste-code flow) | an SSH host the user owns | after container; probes S1 to S3 |

OpenShell fits the interface as a provider whose `prepare` creates a sandbox with `openshell sandbox create --provider <name>` and whose `ptyCommand` runs either `openshell sandbox connect <name>` to a `claude` main process or `openshell sandbox exec -n <name> --tty -- claude …`. The sandbox documentation describes `connect` as attaching to the main process over SSH, with `Ctrl-C` passed to the foreground process, reattach after a dropped link and one attachment owning stdin at a time; which of the two keeps a usable PTY for the TUI is probe O1. Its `NetworkPolicy` maps to `network_policies` (with `landlock.compatibility: hard_requirement`; the schema documents that `best_effort` runs without filesystem rules when Landlock fails to build them), and its `login` is `held-outside` for API-key profiles. The gateway sends anonymous telemetry by default; the provider sets `OPENSHELL_TELEMETRY_ENABLED=false`, as the README documents. It is not a default for any profile.

Subscription logins and credential injection (0018). Anthropic's legal and compliance page for Claude Code, read on 2026-11-17, says that developers "may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow", and that this does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". A `claude setup-token` token is a claude.ai OAuth token from the same browser flow as `/login`. An OpenShell provider holding it, with the supervisor proxy substituting it into requests, stores and intermediates that token, so the app does not offer that route. A subscription profile in any provider logs in inside the environment through the CLI's own flow, and the agent can then read its own login (`login` is not `held-outside`). The credential-injecting proxy stays for API keys and tool credentials, which the same page leaves to the key owner. This is a reading of the published page, not legal advice; the user confirms it.

Probes, run only after the user agrees to install and run third-party software (0012, 0018):

| Id | Question |
|---|---|
| O1 | `sandbox connect` and `sandbox exec --tty` are documented. Does either run the TUI with resize, Ctrl-C and Esc passing through, and what does the app see when stdin is owned by another attachment? |
| O2 | Do the TUI, `--settings` hooks and `--mcp-config` run unchanged inside a sandbox with an API-key provider? |
| O3 | The documentation shows a sandbox workspace filled by `--upload`, and host bind mounts only with `enable_bind_mounts = true` and resource admission off, which it says can bypass the filesystem policy. Which mode keeps the policy and still returns results through git, and do hook payload paths then match the host? |
| O4 | The network rules documentation says a policy never authorizes a loopback destination and blocks private addresses by default except through an exact host name. Does an exact rule for Docker Desktop's host name reach the app's 127.0.0.1 listener, and with which `Host` header? |
| O5 | Cold gateway start, first create with and without a pulled image, second create, on the target Mac. |
| O6 | Does the placeholder reach the CLI for `ANTHROPIC_API_KEY`, and does a mismatch fail visibly in the TUI? |
| O7 | Can an HTTP hook deliver payloads from inside the sandbox? A bind-mounted inbox needs the bind-mount opt-in of O3. |
| D1 | Does Docker Desktop's host address reach a service bound to 127.0.0.1 on the host, and with which `Host` header? |
| D2 | Does ending the `docker exec -it` client leave `claude` running inside? |
| D3 | Does a Linux `claude` with `CLAUDE_CONFIG_DIR` on a bind mount complete `/login` and keep it across container restarts? |
| S1 | `ssh -R` to a loopback port with `ExitOnForwardFailure yes`: MCP calls and HTTP hooks through the tunnel. |
| S2 | `ssh -tt` resize and interrupt with the TUI; behaviour on a dropped link. |
| S3 | Login on a headless host through the paste-code flow. |

Probes that need no third-party software and run in the first slice or before it:

| Id | Question |
|---|---|
| E1 | The source says the single-instance lock is keyed to `userData`. Two processes with distinct `setPath('userData')` values both get the lock, and a third with a repeated value does not, on the target Mac. |
| E2 | How does macOS show dock tiles of several processes of one bundle? |
| C1 | Does an explicit `CLAUDE_CONFIG_DIR=~/.claude` select the same login as an unset variable? Checked on a throwaway directory by the user, since it touches the real login. |
| C2 | `--mcp-config <path>` and `--settings <path>` in the PTY on 2.1.326. |
| C3 | The hooks reference documents `"type": "http"`. Does 2.1.326 accept it through `--settings`, including a `PermissionRequest` decision in the response body? |
| C4 | The CLI reference documents `claude auth status` (exit 0 when signed in, 1 when not; JSON with `authMethod` and `configDirectory`). Does 2.1.326 behave so for a fresh and a signed-in directory? |
| G1 | Do distinct `GH_CONFIG_DIR` values with keyring storage keep separate tokens? Run by the user with a throwaway account or skipped in favour of `--insecure-storage`. |

### 7. Security properties and threats

Properties the design gives:

- Profiles do not share Claude logins, transcripts, settings, browser cookies, gh tokens, git identity or app data, as long as each profile uses its own Claude directory and `isolated` tools.
- Only definitions (id, name, colour, creation time) and registry entries (pid, liveness, unread count) cross profiles, and only the main process reads them. Settings, with paths and the git identity, stay with the owning process. Liveness and the pid add to the name, colour and count that 0017 lists.
- No session receives a credential variable from the launching shell or another profile.
- The MCP and hook tokens are not in process arguments.

Limits the design states:

- With the `local` provider an agent runs as the user and can read every profile's files, the registry and the session files. Profiles separate accounts and mistakes, not an adversarial agent. Containment needs a provider with `filesystem: enforced`.
- A forged registry file changes a badge or a running mark; validation keeps it from reaching anything else.
- An agent inside any provider can read its own Claude login unless `login` is `held-outside`.
- `inherit` tools on the default profile keep today's shared gh, git and SSH credentials.
- `isolated` tools cover gh, git, SSH, AWS, npm and Docker. Other files that tools read from the real home directory stay shared, for example `~/.netrc`, which git over HTTPS can read through curl, and Anthropic profiles under `~/.config/anthropic`: an active profile there with `oidc_federation` mode outranks `/login` in every profile, and a Console sign-in without an API key is stored there, so two such sign-ins do not stay apart (authentication documentation).
- Managed settings can set `CLAUDE_CONFIG_DIR` through their `env` block (environment variables reference); on a machine with such a policy the profiles share whatever directory it names.

| Threat | Mitigation |
|---|---|
| A session picks up another account through an inherited variable | `profileEnv` scrub with tests per mode |
| git uses the macOS Keychain helper shared by all profiles | empty `credential.helper` entry in the profile's global file before the gh helper |
| SSH offers keys of another identity | `ssh -F` with the profile's file: its agent socket, its public key file and `IdentitiesOnly yes`, or no agent and no key |
| Removing a tool's location variable falls back to the shared home file | each removed location variable is set to a profile path |
| Two processes run the milestone 1 migration at once | `migrate.lock` with pid, build in `profiles.migrating/`, one rename at the end |
| gh keyring entries shared across directories | `--insecure-storage` per profile until G1 |
| A second process opens a profile's database | single-instance lock per `userData`; fallback lock file (E1) |
| Concurrent creation of the same profile id | `mkdir` claim |
| Symlink or foreign file in the registry or profiles directory | `lstat`, uid check, size cap, schema, file name equals id |
| Renderer of one profile shows data of another | the renderer gets sanitized registry data only; names render as plain text |
| A container reaches the app server through an unexpected `Host` | per-grant `Host` allowance; tokens per session; Origin rejected |
| Hook endpoint used to forge status | separate hook token per session; the session module acts only on its own session id |
| Token in `ps` output or crash reports | 0600 session files passed by path |
| Stale session files keep tokens on disk | removed at release, exit and close; the directory is cleared at profile start |
| `docker exec` client killed, agent keeps running | `terminate` signals inside the environment |
| Reverse tunnel port on a shared remote host | per-session token; `ExitOnForwardFailure yes`; a host the user owns |
| OpenShell `best_effort` Landlock starts without file rules | the provider sets `hard_requirement` and fails otherwise |

### 8. First M2 slice

Builds:

1. `core/profiles`: types and zod schemas, the path layout, `ProfileStore` (list definitions, read the own settings, create with the `mkdir` claim, update by the owner with atomic writes), `profileEnv`, the milestone 1 migration. Unit tests with temporary directories, including the scrub per mode, a concurrent create of one id, a directory without a definition, a symlinked definition, and two processes that start the migration at once.
2. `core/profiles/registry`: `RegistryWriter` (atomic write, heartbeat, removal on clean quit) and `RegistryReader` (watch plus poll, validation, staleness). Tests for partial `*.tmp` files, symlinks, oversized files, a mismatched id, a dead pid and an old `updatedAt`.
3. Main process: profile resolution from `--profile` before `ready`, `userData` and `sessionData` per profile, the lock with `additionalData`, `second-instance` focus with a shape check, `openProfile`, window title and colour strip, dock badge from the own unread count. The unread count comes from an `UnreadCounter` interface that returns 0 until the inbox (R21) exists; tests use a fake counter.
4. Renderer: the switcher rail block and the profile creation dialog; the setup pane that opens the login terminals. Commands `profile_list`, `profile_open` and `profile_create` with `mcp: false` and an exemption reason (agents do not manage profiles; 0017 allows no cross-profile tool).
5. `core/isolation`: the interface above, `LocalProvider`, `FakeProvider`, contract tests for both.
6. Session launch through the provider: `PtySessionService` takes an `AgentEnvironment` and spawns `ptyCommand`; `terminate` replaces the direct kill; `buildLaunchArgs` takes the settings and MCP file paths; the session module writes `mcp.json` and `settings.json` through `writeSessionFile` with 0600 in a 0700 directory and removes them on exit and close. A test asserts that no spawned argument contains the token, and that the files have mode 0600.
7. Probes E1, C2 and C3 as scripts outside the default test command (C2 and C3 with Haiku, `--max-budget-usd 0.25`, an empty temporary directory, `--setting-sources user`, `--strict-mcp-config`). E2 by hand with the user. The real-Claude e2e script runs under the default profile and checks that the MCP tool call works with the file-based config.
8. An e2e test that starts profiles A and B on a temporary root, checks separate data directories, focus through a second start of the same profile, and the badge of one profile in the other's rail.

Waits: the `srt`, container, OpenShell and SSH providers and their probes; network policy enforcement, including the Bash sandbox settings of the `local` provider; the `http` hook transport (designed above, built with the first provider that needs it or with the waiting permission hook of 0010); whole-profile isolation (a profile whose every session runs in one environment); per-profile SSH agent management; a secret store for API keys and tokens; dock icon colour; profile deletion, rename of the id and export; plan usage in the rail; "Quit all profiles"; the C1, C4 and G1 checks that touch real logins, which the user runs.

## Consequences

- Milestone 1 data moves once into `profiles/default/data`; the default profile keeps the current Claude login and tool credentials, so nothing changes for the user until a second profile is created, apart from Claude credential variables of the launching shell, which no session receives any more.
- 0013 security limits change: the token leaves the process arguments. The folder scope still protects against mistakes only.
- 0018's provider order gains `srt` as a candidate between `local` and `container`, subject to the user's consent for the package.
- 0010's outward-action gate reads `capabilities.network`. With `local` the guarantee of 0010 and the network allowlist default of 0012 come from Claude Code's Bash sandbox (`bash-allowlist`), which covers Bash commands only; until those settings are built the value is `none` and the UI says so.
- 0018's container and remote providers get their own Claude directory per profile, not the profile's host directory (section 5); skills, plugins and settings do not follow without further work.
- 0017's list of data that crosses profiles grows by the pid and a running mark; the git identity and paths stay in the per-profile settings file.
- Subscription logins are never held by a credential-injecting proxy (section 6); OpenShell protects credentials only for API-key profiles.
- 0009's agent history index stores the provider and environment id with each transcript path.
- 0017's estimate of 3 to 6 working days covers items 1 to 4 and 8; items 5 to 7 fall under 0018's estimate for the interface and the local provider. Low confidence.
- Open questions for the user: whether new profiles may point at an existing Claude directory used from the terminal; whether plan usage of other profiles may appear in the rail; consent for the third-party probes (container runtime, OpenShell, sandbox runtime); whether the default profile should move to `isolated` tools later; whether the reading of Anthropic's credential terms in section 6 holds; whether container profiles should see the profile's skills and agents through read-only mounts.
