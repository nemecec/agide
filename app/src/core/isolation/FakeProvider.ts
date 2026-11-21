import { readFile } from 'node:fs/promises';
import { sessionUrl } from '../mcp/mcpConfig';
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
  type ProcessLaunch,
  type PtyCommand,
  type SessionFileName,
} from './types';

export type FakeStep = 'check' | 'prepare' | 'writeSessionFile' | 'ptyCommand' | 'processCommand' | 'terminate';

export interface FakeCall {
  readonly step: FakeStep | 'attach' | 'releaseSession' | 'removeSessionFile' | 'dispose';
  readonly environmentId?: string;
  readonly sessionId?: SessionId;
  readonly detail?: unknown;
}

export interface FakeProviderOptions {
  readonly sessionFilesDir: string;
  /** What `ptyCommand` returns: a fixed command, or one built from the launch. Defaults to the launch with `file` `claude` and the profile launch environment. */
  readonly command?: PtyCommand | ((launch: ClaudeLaunch, spec: EnvironmentSpec) => PtyCommand);
  readonly capabilities?: Partial<ProviderCapabilities>;
}

/**
 * Test provider. Records every call, writes real session files so file modes can be checked, signals attached
 * pids on `terminate`, and fails at any step named in `failAt`.
 */
export class FakeProvider implements IsolationProvider {
  readonly id = 'fake';
  readonly capabilities: ProviderCapabilities;
  readonly calls: FakeCall[] = [];
  readonly failAt = new Set<FakeStep>();
  private readonly environments = new Map<string, FakeEnvironment>();

  constructor(readonly options: FakeProviderOptions) {
    this.capabilities = {
      filesystem: 'host-user',
      network: 'none',
      login: 'host-keychain',
      hookTransports: ['inbox-dir', 'http'],
      transcripts: 'host-files',
      ...options.capabilities,
    };
  }

  /** Throws when `step` is set to fail. */
  step(step: FakeStep): void {
    if (this.failAt.has(step)) throw new IsolationError('failed', `fake provider fails at ${step}`);
  }

  check(): Promise<ProviderCheck> {
    this.calls.push({ step: 'check' });
    return Promise.resolve(this.failAt.has('check') ? { ok: false, reason: 'fake provider set to fail' } : { ok: true });
  }

  async prepare(spec: EnvironmentSpec): Promise<AgentEnvironment> {
    const id = ['fake', spec.key.profileId, spec.key.sessionId].filter(Boolean).join(':');
    this.calls.push({ step: 'prepare', environmentId: id, detail: spec.key });
    this.step('prepare');
    let environment = this.environments.get(id);
    if (environment) environment.spec = spec;
    else {
      environment = new FakeEnvironment(id, spec, this);
      this.environments.set(id, environment);
    }
    return environment;
  }
}

class FakeEnvironment implements AgentEnvironment {
  readonly provider = 'fake';
  readonly paths = { toEnv: (hostPath: string) => hostPath, toHost: (envPath: string) => envPath };
  private readonly files: SessionFiles;
  private readonly pids = new Map<SessionId, number>();
  private readonly sessions = new Set<SessionId>();

  constructor(
    readonly id: string,
    public spec: EnvironmentSpec,
    private readonly fake: FakeProvider,
  ) {
    this.files = new SessionFiles(fake.options.sessionFilesDir);
  }

  private record(call: Omit<FakeCall, 'environmentId'>): void {
    this.fake.calls.push({ ...call, environmentId: this.id });
  }

  async writeSessionFile(sessionId: SessionId, name: SessionFileName, content: string): Promise<string> {
    this.record({ step: 'writeSessionFile', sessionId, detail: name });
    this.fake.step('writeSessionFile');
    this.sessions.add(sessionId);
    return this.files.write(sessionId, name, content);
  }

  removeSessionFile(sessionId: SessionId, name: SessionFileName): Promise<void> {
    this.record({ step: 'removeSessionFile', sessionId, detail: name });
    this.files.removeFile(sessionId, name);
    return Promise.resolve();
  }

  hookDelivery(sessionId: SessionId, target: HookTarget): HookDelivery {
    return this.fake.capabilities.hookTransports.includes('inbox-dir')
      ? { kind: 'inbox-dir', dir: target.inboxHostDir }
      : { kind: 'http', url: `http://127.0.0.1:${this.spec.appEndpoint.port}${target.httpPath}`, token: target.token };
  }

  mcpEndpoint(sessionId: SessionId): McpEndpoint {
    const { port } = this.spec.appEndpoint;
    return { url: sessionUrl(port, sessionId), hostHeader: `127.0.0.1:${port}` };
  }

  async ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand> {
    this.record({ step: 'ptyCommand', sessionId: launch.sessionId, detail: launch });
    this.fake.step('ptyCommand');
    const configured = this.fake.options.command;
    if (typeof configured === 'function') return configured(launch, this.spec);
    return configured ?? { file: 'claude', args: [...launch.args], cwd: launch.cwd, env: launchEnv(this.spec.profile, this.paths.toEnv, launch.env) };
  }

  async processCommand(launch: ProcessLaunch): Promise<PtyCommand> {
    this.record({ step: 'processCommand', sessionId: launch.sessionId, detail: launch });
    this.fake.step('processCommand');
    const configured = this.fake.options.command;
    if (typeof configured === 'function') return configured({ ...launch, cols: 0, rows: 0 }, this.spec);
    return configured ?? { file: 'claude', args: [...launch.args], cwd: launch.cwd, env: launchEnv(this.spec.profile, this.paths.toEnv, launch.env) };
  }

  attach(sessionId: SessionId, pid: number): void {
    this.record({ step: 'attach', sessionId, detail: pid });
    this.sessions.add(sessionId);
    this.pids.set(sessionId, pid);
  }

  async terminate(sessionId: SessionId, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    this.record({ step: 'terminate', sessionId, detail: signal });
    this.fake.step('terminate');
    const pid = this.pids.get(sessionId);
    if (pid === undefined) return;
    try {
      process.kill(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }

  async readFile(envPath: string): Promise<Uint8Array> {
    return readFile(envPath);
  }

  async releaseSession(sessionId: SessionId): Promise<void> {
    this.record({ step: 'releaseSession', sessionId });
    this.files.remove(sessionId);
    this.pids.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  async dispose(): Promise<void> {
    this.record({ step: 'dispose' });
    for (const sessionId of [...this.sessions]) await this.releaseSession(sessionId);
  }
}
