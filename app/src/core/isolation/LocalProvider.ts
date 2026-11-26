import { accessSync, constants } from 'node:fs';
import { resolveClaudeBinary } from '../session/env';
import { HostEnvironment } from './HostEnvironment';
import { hostTools, type HostTools } from './hostTools';
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
}

/**
 * Runs `claude` on the host as the user, as milestone 1 does: the binary itself in the PTY, hooks through the
 * inbox directory, the app MCP server on 127.0.0.1. Adds the 0600 session files for config and tokens.
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
    try {
      if (this.claudeBinary.includes('/')) accessSync(this.claudeBinary, constants.X_OK);
      return Promise.resolve({ ok: true });
    } catch {
      return Promise.resolve({ ok: false, reason: `${this.claudeBinary} is not executable`, fix: 'Install Claude Code or set AGIDE_CLAUDE_BIN.' });
    }
  }

  prepare(spec: EnvironmentSpec): Promise<AgentEnvironment> {
    const id = ['local', spec.key.profileId, spec.key.sessionId].filter(Boolean).join(':');
    let environment = this.environments.get(id);
    if (environment) environment.spec = spec;
    else {
      environment = new LocalEnvironment(id, spec, this.claudeBinary, new SessionFiles(this.options.sessionFilesDir), () => this.options.hostTools ?? hostTools());
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
    private readonly tools: () => HostTools,
  ) {
    super(id, spec, files);
  }

  ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    return this.processCommand(launch);
  }

  async processCommand(launch: ProcessLaunch): Promise<PtyCommand> {
    if (this.spec.workspace.mode !== 'bind') throw new IsolationError('unsupported', 'the local provider runs in a host directory only');
    // A name or a relative path would resolve through the PATH of the profile in the workspace, which the agent writes.
    const file = this.tools().require(this.claudeBinary, [this.spec.workspace.hostPath, launch.cwd], 'the Claude CLI');
    return { file, args: [...launch.args], cwd: launch.cwd, env: launchEnv(this.spec.profile, this.paths.toEnv, launch.env) };
  }
}
