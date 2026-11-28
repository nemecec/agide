import type { ProfileId, ProviderId } from '../profile/types';
import type { SessionId } from '../session/types';

export type { ProviderId } from '../profile/types';

/**
 * Isolation providers (0018, design 0022 section 5). The session service asks the provider's environment for
 * the command node-pty spawns; output buffering, status, resume and close stay in the session service.
 */
export interface IsolationProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  /** Checks prerequisites (binary present, daemon up, host reachable) without changing anything. */
  check(): Promise<ProviderCheck>;
  /** Prepares or reuses the environment for a profile or one session. Returns the same environment for the same key. */
  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment>;
}

export interface ProviderCapabilities {
  /** Whether the provider limits what the agent reads and writes outside the workspace. */
  readonly filesystem: 'host-user' | 'enforced';
  /**
   * Whether `NetworkPolicy` is enforced. `bash-allowlist`: Claude Code's Bash sandbox enforces it for Bash
   * commands only. `allowlist`: the whole agent process. `none`: ask rules only, and the UI says so.
   */
  readonly network: 'none' | 'bash-allowlist' | 'allowlist';
  /** Where the Claude login lives and whether the agent can read it. */
  readonly login: 'host-keychain' | 'environment-file' | 'held-outside';
  readonly hookTransports: readonly HookTransportKind[];
  /** Transcripts readable as host files (bind mount, local) or only through `readFile`. */
  readonly transcripts: 'host-files' | 'remote';
  /**
   * Whether the `PreToolUse` inspector command, which runs the app's executable as Node, can run where the CLI
   * runs. Absent means it can. A provider whose CLI cannot reach that executable says `unavailable`.
   */
  readonly inspectorHook?: 'host-executable' | 'unavailable';
}

export type ProviderCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string; readonly fix?: string };

export interface EnvironmentSpec {
  /** Profile id, plus a session id for a per-session environment. */
  readonly key: { readonly profileId: ProfileId; readonly sessionId?: SessionId };
  readonly profile: ProfileLaunchSpec;
  readonly workspace: WorkspaceSpec;
  readonly network: NetworkPolicy;
  /** The app's HTTP listener on the host (MCP and hook endpoints), always 127.0.0.1. */
  readonly appEndpoint: { readonly port: number };
}

export interface ProfileLaunchSpec {
  /** Host directory of the profile's Claude configuration, or undefined for the CLI default. Becomes `CLAUDE_CONFIG_DIR`. */
  readonly claudeConfigDir: string | undefined;
  /** Host directory of the profile's gh configuration, or undefined to leave gh on its default. Becomes `GH_CONFIG_DIR`. */
  readonly ghConfigDir?: string | undefined;
  /** The base launch environment of the profile (`profileEnv` output). No secret values. */
  readonly env: Readonly<Record<string, string>>;
  /** Variables added on top of `env`, for example per-profile tool locations. They win over `env`. */
  readonly extraEnv?: Readonly<Record<string, string>>;
  /** Files the provider makes available read-only, such as the git global file. Host paths. */
  readonly toolFiles: readonly { readonly hostPath: string; readonly envVar: string }[];
}

export type WorkspaceSpec =
  | { readonly mode: 'bind'; readonly hostPath: string }
  /** Remote providers: clone the repository and return results through git. */
  | { readonly mode: 'clone'; readonly remoteUrl: string; readonly ref: string };

export type NetworkPolicy =
  | { readonly mode: 'unrestricted' }
  /** Anthropic API and OAuth hosts and the app endpoint are always added by the provider. */
  | { readonly mode: 'allowlist'; readonly allow: readonly { readonly host: string; readonly port?: number }[] };

/**
 * Files the CLI or the app's hook commands read inside the environment: the MCP config, the settings file of
 * the `http` hook transport, the permission inspector's gate file (0028) and the per-turn digest (0026).
 */
export type SessionFileName = 'mcp.json' | 'settings.json' | 'gate.json' | 'digest.json';

export const SESSION_FILE_NAMES: readonly SessionFileName[] = ['mcp.json', 'settings.json', 'gate.json', 'digest.json'];

export interface AgentEnvironment {
  readonly id: string;
  readonly provider: ProviderId;
  /** Maps paths between host and environment. Identity for `local` and for bind mounts at the same path. */
  readonly paths: { toEnv(hostPath: string): string; toHost(envPath: string): string | undefined };
  /**
   * Writes a session file the CLI reads at start with mode 0600 in a 0700 directory the environment can read,
   * and returns its path inside the environment. Removed by `releaseSession`.
   */
  writeSessionFile(sessionId: SessionId, name: SessionFileName, content: string): Promise<string>;
  /** Removes one session file, for one the CLI has read at start. A file that does not exist is not an error. */
  removeSessionFile(sessionId: SessionId, name: SessionFileName): Promise<void>;
  /** How hook payloads reach the app for this session. Throws when no transport of `target` is supported. */
  hookDelivery(sessionId: SessionId, target: HookTarget): HookDelivery;
  /** The app MCP endpoint as the CLI inside the environment must address it. */
  mcpEndpoint(sessionId: SessionId): McpEndpoint;
  /** The host command node-pty spawns. Secrets never appear in `args`. */
  ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand>;
  /**
   * The host command for a process without a terminal (stream-json swarm agents, 0037 section 2.1). Secrets never
   * appear in `args`. `local` and `srt` return what `ptyCommand` returns; `container` runs `docker run -i` without
   * `-t`. A provider that cannot run without a terminal throws `IsolationError('unsupported')`.
   */
  processCommand(launch: ProcessLaunch): Promise<PtyCommand>;
  /**
   * The host command for a program of the user's project that no agent runs, such as the project check of the review
   * ladder (0040 section 6): confined like the agent's own commands, never with more power. `srt` limits writes to
   * `writeDirs` and the network to `network`; `container` mounts `cwd` and `writeDirs`; `local` runs it on the host.
   */
  toolCommand(launch: ToolLaunch): Promise<PtyCommand>;
  /** Tells the environment the host pid of the spawned PTY child, so `terminate` can reach it. */
  attach(sessionId: SessionId, pid: number): void;
  /** Ends the agent process inside the environment; killing the host client is not enough for every provider. */
  terminate(sessionId: SessionId, signal: 'SIGTERM' | 'SIGKILL'): Promise<void>;
  /** Reads a file such as a transcript by its environment path. */
  readFile(envPath: string): Promise<Uint8Array>;
  /** Removes the session's files and forgets its process. */
  releaseSession(sessionId: SessionId): Promise<void>;
  /** Releases every session of the environment. */
  dispose(): Promise<void>;
}

export type HookTransportKind = 'inbox-dir' | 'http';

export interface HookTarget {
  readonly inboxHostDir: string;
  readonly httpPath: string;
  readonly token: string;
}

export type HookDelivery =
  /** Command hook that writes one file per payload; `dir` is the inbox as seen inside the environment. */
  | { readonly kind: 'inbox-dir'; readonly dir: string }
  /**
   * Hook that posts the payload to the app; the token goes into the 0600 settings file, never into args. `dir` is the
   * hook directory of the `SessionStart` and `SessionEnd` command hooks, which stay on files (P45). `loopbackInSandbox`
   * says whether the launch adds the loopback entry, in the port form or the host form, to the CLI's Bash sandbox
   * allowed hosts (0043 section 4.1).
   */
  | { readonly kind: 'http'; readonly url: string; readonly token: string; readonly dir: string; readonly loopbackInSandbox: boolean };

export interface McpEndpoint {
  readonly url: string;
  /** Host header value the app server must accept for this session, in addition to its loopback names. */
  readonly hostHeader: string;
}

export interface ClaudeLaunch {
  readonly sessionId: SessionId;
  /** Host path; the provider maps it. */
  readonly cwd: string;
  /** From `buildLaunchArgs`, with file paths already mapped into the environment. */
  readonly args: readonly string[];
  readonly cols: number;
  readonly rows: number;
  /** Variables for this launch on top of the profile environment (launch contributions). No secrets. */
  readonly env?: Readonly<Record<string, string>>;
}

/** A launch without a terminal: `ClaudeLaunch` without the terminal size. */
export interface ProcessLaunch {
  readonly sessionId: SessionId;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** A program without an agent: no Claude arguments, no session files. `env` is the complete environment of the program. */
export interface ToolLaunch {
  /** Names the launch's settings files; unique per run. */
  readonly key: string;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** `none` allows no hosts, `development` the development hosts of the provider. */
  readonly network: 'none' | 'development';
  /** Host directories the program may write besides `cwd`. */
  readonly writeDirs: readonly string[];
  /** The program binds a loopback port or connects to one. Under `srt` that also reaches every loopback service of the host. */
  readonly loopback?: boolean;
}

export interface PtyCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  /** Names of variables of the launch that the program does not receive, because the route into the sandbox cannot carry them (`insideRoute`). */
  readonly dropped?: readonly string[];
}

export type IsolationErrorCode = 'unsupported' | 'invalid' | 'failed';

export class IsolationError extends Error {
  constructor(
    readonly code: IsolationErrorCode,
    message: string,
    /** Where a refused program was found: for the log of the run, never part of a reason that a reviewer reads. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'IsolationError';
  }
}
