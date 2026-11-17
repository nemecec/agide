import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, join } from 'node:path';
import * as nodePty from 'node-pty';
import type { Unsubscribe } from '../events/EventBus';
import { LocalProvider } from '../isolation/LocalProvider';
import type { AgentEnvironment, IsolationProvider, McpEndpoint, ProfileLaunchSpec } from '../isolation/types';
import { resolveClaudeBinary } from './env';
import { DEFAULT_PROFILE_ID, type ProfileId } from '../profile/types';

import { HookInbox } from './HookInbox';
import { buildLaunchArgs } from './launchArgs';
import { OutputBuffer } from './OutputBuffer';
import { MemorySessionStore, type SessionStore } from './SessionStore';
import { statusAfterHook } from './status';
import {
  SessionError,
  type PermissionMode,
  type SessionCreateInput,
  type SessionEvent,
  type SessionId,
  type SessionInfo,
  type SessionService,
  type SessionStatus,
} from './types';

export interface PtySessionServiceOptions {
  /** Directory that holds one hook inbox directory per session. */
  readonly eventsDir: string;
  /** Where the sessions run (0018). Defaults to a `LocalProvider`, which runs `claude` on the host. */
  readonly provider?: IsolationProvider;
  /** The profile the sessions belong to (0017). Defaults to `default`. */
  readonly profileId?: ProfileId;
  /**
   * The profile's launch inputs, read before every launch so a changed profile applies to the next start:
   * `CLAUDE_CONFIG_DIR`, `GH_CONFIG_DIR`, extra environment and tool files. Defaults to `baseEnv` plus `env` with
   * no Claude directory, which is milestone 1 behaviour.
   */
  readonly profileLaunch?: () => ProfileLaunchSpec;
  /** Port of the app HTTP listener, read before every launch. */
  readonly appPort?: () => number;
  /**
   * The app MCP server config for a session, or undefined for a session without it. The service writes it to a
   * 0600 file in the session's directory and passes the file path, so the bearer token is not in the process
   * arguments. `endpoint` is the address of the app server as the CLI inside the environment must use it.
   */
  readonly mcpConfig?: (session: SessionInfo, endpoint: McpEndpoint) => object | undefined | Promise<object | undefined>;
  /** Directory of the session files of the default provider. Defaults to `sessions` next to `eventsDir`. */
  readonly sessionFilesDir?: string;
  /** Permission mode of a session that names none. Defaults to `default`, the CLI's prompting mode. */
  readonly defaultPermissionMode?: PermissionMode;
  /** Path of the `claude` executable of the default provider. Defaults to `resolveClaudeBinary()`. */
  readonly claudeBinary?: string;
  /** Defaults to a store in memory. */
  readonly store?: SessionStore;
  /** Environment the launched process inherits when `profileLaunch` is absent. Defaults to `process.env`. */
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** Variables added after the scrub when `profileLaunch` is absent. */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Arguments appended to every launch, such as `--model`. Runs before each spawn, for `create` and for
   * `resume`. Secrets do not belong here: process arguments are readable by every process of the user.
   */
  readonly extraArgs?: (session: SessionInfo) => readonly string[] | Promise<readonly string[]>;
  /** Called with the session when a launch fails, for `create` and for `resume`, so a grant issued for it can be revoked. */
  readonly onLaunchFailed?: (session: SessionInfo) => void;
  /** Absolute paths the CLI may not read or edit, passed as permission rules in `--settings`. */
  readonly denyPaths?: readonly string[];
  /** Pause between typed text and the Enter key in `sendText`. */
  readonly submitDelayMs?: number;
  /** Pause between the first `SessionStart` and the typing of the create prompt. */
  readonly firstPromptDelayMs?: number;
  /** Time between SIGTERM and SIGKILL when a process does not end. */
  readonly killTimeoutMs?: number;
  readonly newId?: () => SessionId;
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;

interface Entry {
  info: SessionInfo;
  readonly permissionMode: PermissionMode;
  readonly output: OutputBuffer;
  cols: number;
  rows: number;
  process?: nodePty.IPty | undefined;
  environment?: AgentEnvironment | undefined;
  inbox?: HookInbox | undefined;
  /** Resolves when the current process has ended. */
  ended?: Promise<void>;
  /** First prompt, typed once after the first `SessionStart`. */
  pendingPrompt?: string | undefined;
  /** True while `mcp.json` exists; the first `SessionStart` removes it, since the CLI has read it by then. */
  mcpFileWritten?: boolean;
  typing: Promise<void>;
  closing?: Promise<void>;
}

/** Runs the interactive `claude` CLI in a PTY per session (0004). */
export class PtySessionService implements SessionService {
  private readonly entries = new Map<SessionId, Entry>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private readonly store: SessionStore;
  private readonly provider: IsolationProvider;
  private readonly environments = new Set<AgentEnvironment>();
  private readonly profileId: ProfileId;
  private readonly defaultPermissionMode: PermissionMode;
  private readonly submitDelayMs: number;
  private readonly firstPromptDelayMs: number;
  private readonly killTimeoutMs: number;
  private readonly newId: () => SessionId;

  constructor(private readonly options: PtySessionServiceOptions) {
    this.store = options.store ?? new MemorySessionStore();
    this.profileId = options.profileId ?? DEFAULT_PROFILE_ID;
    this.defaultPermissionMode = options.defaultPermissionMode ?? 'default';
    this.provider =
      options.provider ??
      new LocalProvider({
        sessionFilesDir: options.sessionFilesDir ?? join(dirname(options.eventsDir), 'sessions'),
        claudeBinary: options.claudeBinary ?? resolveClaudeBinary(options.baseEnv ?? process.env),
      });
    this.submitDelayMs = options.submitDelayMs ?? 300;
    this.firstPromptDelayMs = options.firstPromptDelayMs ?? 1500;
    this.killTimeoutMs = options.killTimeoutMs ?? 2000;
    this.newId = options.newId ?? randomUUID;
    for (const row of this.store.load()) {
      this.entries.set(row.id, {
        info: { ...row, status: 'exited' },
        permissionMode: row.permissionMode,
        output: new OutputBuffer(),
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        typing: Promise.resolve(),
      });
    }
  }

  async create(input: SessionCreateInput): Promise<SessionInfo> {
    const info: SessionInfo = {
      id: this.newId(),
      folderId: input.folderId,
      title: input.title ?? 'Claude session',
      cwd: input.cwd,
      launchPath: input.launchPath ?? 'pty',
      status: 'starting',
      createdAt: new Date().toISOString(),
    };
    const entry: Entry = {
      info,
      permissionMode: input.permissionMode ?? this.defaultPermissionMode,
      output: new OutputBuffer(),
      cols: input.cols ?? DEFAULT_COLS,
      rows: input.rows ?? DEFAULT_ROWS,
      pendingPrompt: input.prompt,
      typing: Promise.resolve(),
    };
    this.entries.set(info.id, entry);
    try {
      await this.launch(entry, false);
    } catch (error) {
      this.entries.delete(info.id);
      rmSync(this.inboxDir(info.id), { recursive: true, force: true });
      throw error;
    }
    this.store.save({
      id: info.id,
      folderId: info.folderId,
      title: info.title,
      cwd: info.cwd,
      launchPath: info.launchPath,
      permissionMode: entry.permissionMode,
      createdAt: info.createdAt,
    });
    this.emit({ type: 'session.created', session: entry.info });
    return entry.info;
  }

  async resume(id: SessionId): Promise<SessionInfo> {
    const entry = this.require(id);
    if (entry.info.status !== 'exited') throw new SessionError('already_running', `session ${id} runs`);
    this.setInfo(entry, ({ exitCode: _previousExit, ...info }) => ({ ...info, status: 'starting' }));
    try {
      await this.launch(entry, true);
    } catch (error) {
      this.setInfo(entry, (info) => ({ ...info, status: 'exited' }));
      throw error;
    }
    return entry.info;
  }

  async close(id: SessionId): Promise<void> {
    const entry = this.require(id);
    entry.closing ??= this.shutdownEntry(entry).then(() => {
      this.store.remove(id);
      rmSync(this.inboxDir(id), { recursive: true, force: true });
      this.entries.delete(id);
      this.emit({ type: 'session.closed', sessionId: id });
    });
    await entry.closing;
  }

  /** Ends every process and keeps the sessions, so the next start lists them as exited. For app quit. */
  async shutdown(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.shutdownEntry(entry)));
    await Promise.all([...this.environments].map((environment) => environment.dispose()));
  }

  sendText(id: SessionId, text: string): void {
    const entry = this.requireRunning(id);
    const proc = entry.process;
    entry.typing = entry.typing.then(async () => {
      if (entry.process !== proc) return;
      proc?.write(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
      await sleep(this.submitDelayMs);
      if (entry.process === proc && entry.info.status !== 'exited') proc?.write('\r');
    });
  }

  write(id: SessionId, data: string): void {
    this.requireRunning(id).process?.write(data);
  }

  resize(id: SessionId, cols: number, rows: number): void {
    const entry = this.requireRunning(id);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
      throw new RangeError(`invalid terminal size ${cols}x${rows}`);
    }
    entry.cols = cols;
    entry.rows = rows;
    entry.process?.resize(cols, rows);
  }

  /** Moves the session to another folder, for example after its leaf moved. */
  setFolder(id: SessionId, folderId: string): void {
    const entry = this.require(id);
    this.setInfo(entry, (info) => ({ ...info, folderId }));
    this.store.save({ ...this.persistedOf(entry), folderId });
  }

  /** The recent terminal output, for a renderer that reloaded. */
  readOutput(id: SessionId): string {
    return this.require(id).output.read();
  }

  get(id: SessionId): SessionInfo | undefined {
    return this.entries.get(id)?.info;
  }

  list(): SessionInfo[] {
    return [...this.entries.values()].map((entry) => entry.info);
  }

  subscribe(listener: (event: SessionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async launch(entry: Entry, resume: boolean): Promise<void> {
    const { info } = entry;
    mkdirSync(this.options.eventsDir, { recursive: true, mode: 0o700 });
    const inboxDir = this.inboxDir(info.id);
    let environment: AgentEnvironment | undefined;
    try {
      if (!statSync(info.cwd).isDirectory()) throw new Error(`${info.cwd} is not a directory`);
      const check = await this.provider.check();
      if (!check.ok) throw new Error(check.fix === undefined ? check.reason : `${check.reason}. ${check.fix}`);
      environment = await this.provider.prepare({
        key: { profileId: this.profileId },
        profile: this.profileLaunch(),
        workspace: { mode: 'bind', hostPath: info.cwd },
        network: { mode: 'unrestricted' },
        appEndpoint: { port: this.options.appPort?.() ?? 0 },
      });
      this.environments.add(environment);
      const delivery = environment.hookDelivery(info.id, { inboxHostDir: inboxDir, httpPath: `/hooks/${info.id}`, token: randomBytes(32).toString('hex') });
      if (delivery.kind !== 'inbox-dir') throw new Error(`hook delivery ${delivery.kind} is not supported by the session service`);
      const config = await this.options.mcpConfig?.(info, environment.mcpEndpoint(info.id));
      const mcpConfigPath = config === undefined ? undefined : await environment.writeSessionFile(info.id, 'mcp.json', JSON.stringify(config));
      entry.mcpFileWritten = mcpConfigPath !== undefined;
      const args = buildLaunchArgs({
        sessionId: info.id,
        resume,
        permissionMode: entry.permissionMode,
        inboxDir: delivery.dir,
        mcpConfigPath,
        denyPaths: this.options.denyPaths ?? [],
        extraArgs: (await this.options.extraArgs?.(info)) ?? [],
      });
      const command = await environment.ptyCommand({ sessionId: info.id, cwd: info.cwd, args, cols: entry.cols, rows: entry.rows });
      const inbox = new HookInbox(inboxDir, (record) => this.onHook(entry, record));
      let proc: nodePty.IPty;
      try {
        proc = nodePty.spawn(command.file, [...command.args], {
          name: 'xterm-256color',
          cols: entry.cols,
          rows: entry.rows,
          cwd: command.cwd,
          env: { ...command.env },
        });
      } catch (error) {
        inbox.dispose();
        throw error;
      }
      environment.attach(info.id, proc.pid);
      entry.inbox = inbox;
      entry.process = proc;
      entry.environment = environment;
      entry.ended = new Promise<void>((resolve) => {
        proc.onExit(({ exitCode, signal }) => {
          if (entry.process === proc) this.onExit(entry, exitCode, signal);
          resolve();
        });
      });
      proc.onData((data) => {
        if (entry.process !== proc) return;
        entry.output.append(data);
        this.emit({ type: 'session.output', sessionId: info.id, data });
      });
    } catch (error) {
      await environment?.releaseSession(info.id).catch(() => undefined);
      try {
        this.options.onLaunchFailed?.(info);
      } catch (callbackError) {
        console.error(callbackError);
      }
      throw error instanceof SessionError
        ? error
        : new SessionError('launch_failed', `cannot start claude: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private profileLaunch(): ProfileLaunchSpec {
    if (this.options.profileLaunch) return this.options.profileLaunch();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.options.baseEnv ?? process.env)) if (value !== undefined) env[key] = value;
    const extraEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.options.env ?? {})) if (value !== undefined) extraEnv[key] = value;
    return { claudeConfigDir: undefined, env, extraEnv, toolFiles: [] };
  }

  private onHook(entry: Entry, record: unknown): void {
    if (typeof record !== 'object' || record === null) return;
    const hookEvent = (record as { hook_event_name?: unknown }).hook_event_name;
    if (typeof hookEvent !== 'string') return;
    this.emit({ type: 'session.hook', sessionId: entry.info.id, hookEvent, payload: record });
    if (hookEvent === 'SessionStart' && entry.mcpFileWritten) {
      entry.mcpFileWritten = false;
      void entry.environment?.removeSessionFile(entry.info.id, 'mcp.json').catch(() => undefined);
    }
    const next = statusAfterHook(entry.info.status, hookEvent);
    if (next === undefined) return;
    const wasStarting = entry.info.status === 'starting';
    this.setInfo(entry, (info) => ({ ...info, status: next }));
    if (wasStarting && next === 'idle' && entry.pendingPrompt !== undefined) {
      const prompt = entry.pendingPrompt;
      entry.pendingPrompt = undefined;
      const timer = setTimeout(() => {
        if (entry.info.status !== 'exited') this.sendText(entry.info.id, prompt);
      }, this.firstPromptDelayMs);
      timer.unref();
    }
  }

  private onExit(entry: Entry, exitCode: number, signal: number | undefined): void {
    entry.inbox?.stop();
    entry.inbox = undefined;
    entry.process = undefined;
    void entry.environment?.releaseSession(entry.info.id).catch(() => undefined);
    const session = this.setInfo(entry, (info) => ({ ...info, status: 'exited', exitCode }));
    this.emit({ type: 'session.exited', session, exitCode, signal: signalName(signal) });
  }

  private async shutdownEntry(entry: Entry): Promise<void> {
    const { process: proc, environment } = entry;
    if (!proc || !environment) return;
    const sessionId = entry.info.id;
    await environment.terminate(sessionId, 'SIGTERM');
    const killer = setTimeout(() => void environment.terminate(sessionId, 'SIGKILL').catch(() => undefined), this.killTimeoutMs);
    try {
      await entry.ended;
    } finally {
      clearTimeout(killer);
    }
  }

  /** Replaces the info and emits a status change when the status differs. */
  private setInfo(entry: Entry, change: (info: SessionInfo) => SessionInfo): SessionInfo {
    const previous = entry.info;
    const next = change(previous);
    entry.info = next;
    if (next.status !== previous.status) this.emit({ type: 'session.status_changed', session: next, previous: previous.status });
    return next;
  }

  private persistedOf(entry: Entry) {
    const { id, folderId, title, cwd, launchPath, createdAt } = entry.info;
    return { id, folderId, title, cwd, launchPath, permissionMode: entry.permissionMode, createdAt };
  }

  private inboxDir(id: SessionId): string {
    return join(this.options.eventsDir, id);
  }

  private require(id: SessionId): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new SessionError('not_found', `no session ${id}`);
    return entry;
  }

  private requireRunning(id: SessionId): Entry {
    const entry = this.require(id);
    if (entry.info.status === 'exited' || !entry.process) throw new SessionError('not_running', `session ${id} has exited`);
    return entry;
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function signalName(signal: number | undefined): string | null {
  if (!signal) return null;
  return Object.entries(osConstants.signals).find(([, value]) => value === signal)?.[0] ?? String(signal);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
