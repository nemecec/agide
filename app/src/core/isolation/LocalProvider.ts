import { accessSync, constants } from 'node:fs';
import { resolveClaudeBinary } from '../session/env';
import type { AgentWritableRegistry } from './agentWritable';
import { HostEnvironment } from './HostEnvironment';
import { HOST_PROGRAMS, hostTools, INCOMPLETE_CAUSE, INCOMPLETE_FIX, RECORDED_CAUSE, type HostTools } from './hostTools';
import { launchEnv } from './launchEnv';
import { SessionFiles } from './SessionFiles';
import {
  IsolationError,
  type AgentEnvironment,
  type ClaudeLaunch,
  type EnvironmentSpec,
  type IsolationProvider,
  type ProviderCapabilities,
  type ProcessLaunch,
  type ProviderCheck,
  type PtyCommand,
} from './types';

export interface LocalProviderOptions {
  /** Host directory for 0600 session files, normally `<profile data>/sessions`. */
  readonly sessionFilesDir: string;
  /** Defaults to `resolveClaudeBinary(process.env)`. */
  readonly claudeBinary?: string;
  /** Finds the CLI when `claudeBinary` is a name or a relative path. Defaults to the shared instance of the app. */
  readonly hostTools?: HostTools;
  /** The directories the agents of the profile may write, which `hostTools` reads. Without it the provider records nothing. */
  readonly writable?: AgentWritableRegistry;
  /** The profile's Bash sandbox, read at each launch: while it is on, the launch is recorded in `writable`. */
  readonly bashSandbox?: () => boolean;
  /** Programs the profile configures for the host beyond the Claude CLI, such as the `srt` of its checks and the docker client. */
  readonly hostPrograms?: () => readonly string[];
}

/**
 * Runs `claude` on the host as the user, as milestone 1 does: the binary itself in the PTY, hooks through the
 * inbox directory, the app MCP server on 127.0.0.1. Adds the 0600 session files for config and tokens.
 *
 * While the profile's Bash sandbox is on, a check of the profile runs under srt (0040 section 6) and the Bash sandbox
 * and the permission mode keep the agent to its workspace, so every launch adds its workspace, working directory and
 * inbox to the registry of agent-writable directories, and a launch whose directories hold the only copy of a program
 * that the app starts on the host is refused (`HostTools.refuseHolding`). Without the Bash sandbox the agent runs
 * commands with the rights of the user and may write every directory the user can, so a record protects nothing and
 * none is made; no check of such a profile is confined either.
 */
export class LocalProvider implements IsolationProvider {
  readonly id = 'local';
  readonly capabilities: ProviderCapabilities = {
    filesystem: 'host-user',
    network: 'none',
    login: 'host-keychain',
    hookTransports: ['inbox-dir'],
    transcripts: 'host-files',
  };
  private readonly environments = new Map<string, LocalEnvironment>();
  private readonly claudeBinary: string;

  constructor(private readonly options: LocalProviderOptions) {
    this.claudeBinary = options.claudeBinary ?? resolveClaudeBinary(process.env);
    new SessionFiles(options.sessionFilesDir).removeAll();
  }

  check(): Promise<ProviderCheck> {
    const tools = this.options.hostTools ?? hostTools();
    const found = tools.find(this.claudeBinary) !== undefined;
    const hidden = found ? undefined : tools.shadowed(this.claudeBinary);
    if (hidden !== undefined) {
      const recorded = tools.recordedFor(hidden);
      return Promise.resolve({
        ok: false,
        reason: recorded === undefined ? 'The Claude CLI lies in a directory that an agent may write' : `The Claude CLI ${RECORDED_CAUSE}`,
        fix: recorded ?? 'Install Claude Code in a directory that no agent may write, or set AGIDE_CLAUDE_BIN.',
      });
    }
    if (!found && tools.incomplete()) return Promise.resolve({ ok: false, reason: `The Claude CLI was not found: ${INCOMPLETE_CAUSE}`, fix: INCOMPLETE_FIX });
    try {
      if (this.claudeBinary.includes('/')) accessSync(this.claudeBinary, constants.X_OK);
      return Promise.resolve({ ok: true });
    } catch {
      return Promise.resolve({ ok: false, reason: 'The Claude CLI is not executable at the configured path', fix: 'Install Claude Code or set AGIDE_CLAUDE_BIN.' });
    }
  }

  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment> {
    const id = ['local', spec.key.profileId, spec.key.sessionId].filter(Boolean).join(':');
    let environment = this.environments.get(id);
    if (environment) environment.spec = spec;
    else {
      environment = new LocalEnvironment(id, spec, this.claudeBinary, new SessionFiles(this.options.sessionFilesDir), this.options);
      this.environments.set(id, environment);
    }
    return Promise.resolve(environment);
  }
}

class LocalEnvironment extends HostEnvironment {
  readonly provider = 'local';

  constructor(
    id: string,
    spec: EnvironmentSpec,
    private readonly claudeBinary: string,
    files: SessionFiles,
    private readonly options: LocalProviderOptions,
  ) {
    super(id, spec, files);
  }

  ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    return this.processCommand(launch);
  }

  async processCommand(launch: ProcessLaunch): Promise<PtyCommand> {
    if (this.spec.workspace.mode !== 'bind') throw new IsolationError('unsupported', 'the local provider runs in a host directory only');
    const inbox = this.inboxes.get(launch.sessionId);
    const directories = [this.spec.workspace.hostPath, launch.cwd, ...(inbox === undefined ? [] : [inbox])];
    const tools = this.options.hostTools ?? hostTools();
    const writable = this.options.bashSandbox?.() === true ? this.options.writable : undefined;
    if (writable !== undefined) tools.refuseHolding(directories, [this.claudeBinary, ...HOST_PROGRAMS, ...(this.options.hostPrograms?.() ?? [])]);
    // A name or a relative path would resolve through the PATH of the profile in the workspace, which the agent writes.
    const file = tools.require(this.claudeBinary, directories, 'the Claude CLI');
    writable?.add(directories);
    return { file, args: [...launch.args], cwd: launch.cwd, env: launchEnv(this.spec.profile, this.paths.toEnv, launch.env) };
  }
}
