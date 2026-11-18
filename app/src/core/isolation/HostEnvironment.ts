import { readFile } from 'node:fs/promises';
import type { SessionId } from '../session/types';
import { SessionFiles } from './SessionFiles';
import type {
  AgentEnvironment,
  ClaudeLaunch,
  EnvironmentSpec,
  HookDelivery,
  HookTarget,
  McpEndpoint,
  ProviderId,
  PtyCommand,
  SessionFileName,
} from './types';

/** Sends `signal` to a process, ignoring one that is already gone. */
export function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

/**
 * Base of the environments whose session files, hook inbox and transcripts are plain host paths: the local
 * provider, srt and the container provider (which mounts the same paths into the container). Subclasses build
 * the command and may end more than the attached client process.
 */
export abstract class HostEnvironment implements AgentEnvironment {
  abstract readonly provider: ProviderId;
  readonly paths = { toEnv: (hostPath: string) => hostPath, toHost: (envPath: string): string | undefined => envPath };
  protected readonly pids = new Map<SessionId, number>();
  protected readonly sessions = new Set<SessionId>();
  protected readonly inboxes = new Map<SessionId, string>();

  constructor(
    readonly id: string,
    /** The latest spec of the key: a repeated `prepare` replaces it, so a changed profile applies to the next launch. */
    public spec: EnvironmentSpec,
    protected readonly files: SessionFiles,
  ) {}

  abstract ptyCommand(launch: ClaudeLaunch): Promise<PtyCommand>;

  /** Host name the CLI in the environment dials for the app endpoint. */
  protected appHost(): string {
    return '127.0.0.1';
  }

  async writeSessionFile(sessionId: SessionId, name: SessionFileName, content: string): Promise<string> {
    const path = this.files.write(sessionId, name, content);
    this.sessions.add(sessionId);
    return path;
  }

  removeSessionFile(sessionId: SessionId, name: SessionFileName): Promise<void> {
    this.files.removeFile(sessionId, name);
    return Promise.resolve();
  }

  hookDelivery(sessionId: SessionId, target: HookTarget): HookDelivery {
    this.inboxes.set(sessionId, target.inboxHostDir);
    return { kind: 'inbox-dir', dir: target.inboxHostDir };
  }

  mcpEndpoint(sessionId: SessionId): McpEndpoint {
    const host = `${this.appHost()}:${this.spec.appEndpoint.port}`;
    return { url: `http://${host}/mcp/${encodeURIComponent(sessionId)}`, hostHeader: host };
  }

  attach(sessionId: SessionId, pid: number): void {
    this.sessions.add(sessionId);
    this.pids.set(sessionId, pid);
  }

  terminate(sessionId: SessionId, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    const pid = this.pids.get(sessionId);
    if (pid !== undefined) signalProcess(pid, signal);
    return Promise.resolve();
  }

  async readFile(envPath: string): Promise<Uint8Array> {
    return readFile(envPath);
  }

  async releaseSession(sessionId: SessionId): Promise<void> {
    this.files.remove(sessionId);
    this.pids.delete(sessionId);
    this.inboxes.delete(sessionId);
    this.sessions.delete(sessionId);
  }

  async dispose(): Promise<void> {
    for (const sessionId of [...this.sessions]) await this.releaseSession(sessionId);
  }
}
