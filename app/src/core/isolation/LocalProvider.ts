import { accessSync, constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { sessionUrl } from '../mcp/mcpConfig';
import { resolveClaudeBinary } from '../session/env';
import type { SessionId } from '../session/types';
import { launchEnv } from './launchEnv';
import { SessionFiles } from './SessionFiles';
import {
  IsolationError,
  type AgentEnvironment,
  type ClaudeLaunch,
  type EnvironmentSpec,
  type HookDelivery,
  type HookTarget,
  type IsolationProvider,
  type McpEndpoint,
  type ProviderCapabilities,
  type ProviderCheck,
  type PtyCommand,
  type SessionFileName,
} from './types';

export interface LocalProviderOptions {
  /** Host directory for 0600 session files, normally `<profile data>/sessions`. */
  readonly sessionFilesDir: string;
  /** Defaults to `resolveClaudeBinary(process.env)`. */
  readonly claudeBinary?: string;
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
      environment = new LocalEnvironment(id, spec, this.claudeBinary, new SessionFiles(this.options.sessionFilesDir));
      this.environments.set(id, environment);
    }
    return Promise.resolve(environment);
  }
}

class LocalEnvironment implements AgentEnvironment {
  readonly provider = 'local';
  readonly paths = { toEnv: (hostPath: string) => hostPath, toHost: (envPath: string) => envPath };
  private readonly pids = new Map<SessionId, number>();
  private readonly sessions = new Set<SessionId>();

  constructor(
    readonly id: string,
    /** The latest spec of the key: a repeated `prepare` replaces it, so a changed profile applies to the next launch. */
    public spec: EnvironmentSpec,
    private readonly claudeBinary: string,
    private readonly files: SessionFiles,
  ) {}

  async writeSessionFile(sessionId: SessionId, name: SessionFileName, content: string): Promise<string> {
    const path = this.files.write(sessionId, name, content);
    this.sessions.add(sessionId);
    return path;
  }

  removeSessionFile(sessionId: SessionId, name: SessionFileName): Promise<void> {
    this.files.removeFile(sessionId, name);
    return Promise.resolve();
  }

  hookDelivery(_sessionId: SessionId, target: HookTarget): HookDelivery {
    return { kind: 'inbox-dir', dir: target.inboxHostDir };
  }

  mcpEndpoint(sessionId: SessionId): McpEndpoint {
    const { port } = this.spec.appEndpoint;
    return { url: sessionUrl(port, sessionId), hostHeader: `127.0.0.1:${port}` };
  }

  async ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    if (this.spec.workspace.mode !== 'bind') throw new IsolationError('unsupported', 'the local provider runs in a host directory only');
    return { file: this.claudeBinary, args: [...launch.args], cwd: launch.cwd, env: launchEnv(this.spec.profile, this.paths.toEnv) };
  }

  attach(sessionId: SessionId, pid: number): void {
    this.sessions.add(sessionId);
    this.pids.set(sessionId, pid);
  }

  terminate(sessionId: SessionId, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    const pid = this.pids.get(sessionId);
    if (pid !== undefined) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    return Promise.resolve();
  }

  async readFile(envPath: string): Promise<Uint8Array> {
    return readFile(envPath);
  }

  releaseSession(sessionId: SessionId): Promise<void> {
    this.files.remove(sessionId);
    this.pids.delete(sessionId);
    this.sessions.delete(sessionId);
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    for (const sessionId of [...this.sessions]) await this.releaseSession(sessionId);
  }
}
