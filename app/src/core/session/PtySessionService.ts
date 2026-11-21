import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, join } from 'node:path';
import * as nodePty from 'node-pty';
import type { Unsubscribe } from '../events/EventBus';
import { LocalProvider } from '../isolation/LocalProvider';
import type { AgentEnvironment, IsolationProvider, McpEndpoint, NetworkPolicy, ProfileLaunchSpec } from '../isolation/types';
import { resolveClaudeBinary } from './env';
import { DEFAULT_PROFILE_ID, type ProfileId } from '../profile/types';

import { HookInbox } from './HookInbox';
import { buildLaunchArgs } from './launchArgs';
import { mergeContributions, type LaunchContributor } from './launchContributions';
import { OutputBuffer } from './OutputBuffer';
import { MemorySessionStore, type SessionStore } from './SessionStore';
import { statusAfterHook } from './status';
import type { StreamProcess, StreamSpawner } from './streamSpawner';
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
  /**
   * The provider a launch uses, read before every launch so a changed profile setting applies to the next start.
   * Defaults to `provider`.
   */
  readonly selectProvider?: (session: SessionInfo) => IsolationProvider;
  /** The network policy the provider enforces for a launch. Defaults to `unrestricted`. */
  readonly networkPolicy?: (session: SessionInfo) => NetworkPolicy;
  /**
   * Spawns sessions whose `launchPath` is `stream-json` (0038). The service prepares the environment, hooks,
   * `mcp.json`, contributions and base arguments as for a PTY launch and hands the spawn to it. Without it such
   * a launch fails with `launch_failed`.
   */
  readonly streamSpawner?: StreamSpawner;
  /** Modules that add settings, arguments, environment, MCP servers or session files to every launch (0029). */
  readonly contributors?: () => readonly LaunchContributor[];
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
  readonly output: OutputBuffer;
  cols: number;
  rows: number;
  process?: nodePty.IPty | undefined;
  /** The process of a stream-json session; `process` stays undefined for it. */
  stream?: StreamProcess | undefined;
  environment?: AgentEnvironment | undefined;
  inbox?: HookInbox | undefined;
  /** Resolves when the current process has ended. */
  ended?: Promise<void>;
  /**
   * Resolves when the current process leaves `starting`: on its first `SessionStart` or when it ends. Until then
   * the CLI may show the folder-trust dialog or not read its terminal yet, so typed prompts wait for it.
   */
  started: Promise<void>;
  markStarted?: (() => void) | undefined;
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
        output: new OutputBuffer(),
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        typing: Promise.resolve(),
        started: Promise.resolve(),
      });
    }
  }

  async create(input: SessionCreateInput): Promise<SessionInfo> {
    if (input.id !== undefined && this.entries.has(input.id)) throw new SessionError('launch_failed', `session id ${input.id} is in use`);
    const info: SessionInfo = {
      id: input.id ?? this.newId(),
      folderId: input.folderId,
      title: input.title ?? 'Claude session',
      cwd: input.cwd,
      launchPath: input.launchPath ?? 'pty',
      permissionMode: input.permissionMode ?? this.defaultPermissionMode,
      status: 'starting',
      createdAt: new Date().toISOString(),
    };
    const entry: Entry = {
      info,
      output: new OutputBuffer(),
      cols: input.cols ?? DEFAULT_COLS,
      rows: input.rows ?? DEFAULT_ROWS,
      pendingPrompt: input.prompt,
      typing: Promise.resolve(),
      started: Promise.resolve(),
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
      permissionMode: info.permissionMode,
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

  async stop(id: SessionId): Promise<void> {
    await this.shutdownEntry(this.require(id));
  }

  setPermissionMode(id: SessionId, permissionMode: PermissionMode): void {
    const entry = this.require(id);
    if (entry.info.permissionMode === permissionMode) return;
    this.setInfo(entry, (info) => ({ ...info, permissionMode }));
    this.store.save(this.persistedOf(entry));
  }

  /** Ends every process and keeps the sessions, so the next start lists them as exited. For app quit. */
  async shutdown(): Promise<void> {
    await Promise.all([...this.entries.values()].map((entry) => this.shutdownEntry(entry)));
    await Promise.all([...this.environments].map((environment) => environment.dispose()));
  }

  sendText(id: SessionId, text: string): void {
    const entry = this.requireRunning(id);
    if (entry.stream !== undefined) {
      entry.stream.sendText(text);
      return;
    }
    const proc = entry.process;
    const started = entry.started;
    entry.typing = entry.typing.then(async () => {
      await started;
      if (entry.process !== proc) return;
      proc?.write(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
      await sleep(this.submitDelayMs);
      if (entry.process === proc && entry.info.status !== 'exited') proc?.write('\r');
    });
  }

  write(id: SessionId, data: string): void {
    this.requirePty(id).process?.write(data);
  }

  resize(id: SessionId, cols: number, rows: number): void {
    const entry = this.requirePty(id);
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
      const provider = this.options.selectProvider?.(info) ?? this.provider;
      const check = await provider.check();
      if (!check.ok) throw new Error(check.fix === undefined ? check.reason : `${check.reason}. ${check.fix}`);
      const prepared = await provider.prepare({
        key: { profileId: this.profileId },
        profile: this.profileLaunch(),
        workspace: { mode: 'bind', hostPath: info.cwd },
        network: this.options.networkPolicy?.(info) ?? { mode: 'unrestricted' },
        appEndpoint: { port: this.options.appPort?.() ?? 0 },
      });
      environment = prepared;
      this.environments.add(prepared);
      const delivery = prepared.hookDelivery(info.id, { inboxHostDir: inboxDir, httpPath: `/hooks/${info.id}`, token: randomBytes(32).toString('hex') });
      if (delivery.kind !== 'inbox-dir') throw new Error(`hook delivery ${delivery.kind} is not supported by the session service`);
      const endpoint = prepared.mcpEndpoint(info.id);
      const config = (await this.options.mcpConfig?.(info, endpoint)) as { mcpServers?: Record<string, object> } | undefined;
      const contributions = [];
      for (const contributor of this.options.contributors?.() ?? []) {
        const contribution = await contributor.contribute({
          session: info,
          resume,
          permissionMode: info.permissionMode,
          provider: { id: provider.id, capabilities: provider.capabilities },
          hookDir: delivery.dir,
          toEnv: (hostPath) => prepared.paths.toEnv(hostPath),
          mcpUrl: endpoint.url,
          writeSessionFile: (name, content) => prepared.writeSessionFile(info.id, name, content),
        });
        contributions.push({ id: contributor.id, contribution });
      }
      const merged = mergeContributions(contributions);
      const fullConfig = config === undefined ? undefined : { ...config, mcpServers: { ...config.mcpServers, ...merged.mcpServers } };
      const mcpConfigPath = fullConfig === undefined ? undefined : await prepared.writeSessionFile(info.id, 'mcp.json', JSON.stringify(fullConfig));
      entry.mcpFileWritten = mcpConfigPath !== undefined;
      const args = buildLaunchArgs({
        sessionId: info.id,
        resume,
        permissionMode: info.permissionMode,
        inboxDir: delivery.dir,
        mcpConfigPath,
        denyPaths: this.options.denyPaths ?? [],
        settings: merged.settings,
        replacesBaseHooks: merged.replacesBaseHooks,
        extraArgs: [...merged.args, ...((await this.options.extraArgs?.(info)) ?? [])],
      });
      if (info.launchPath === 'stream-json') {
        await this.launchStream(entry, prepared, inboxDir, resume, args, merged.env);
        return;
      }
      const command = await prepared.ptyCommand({ sessionId: info.id, cwd: info.cwd, args, cols: entry.cols, rows: entry.rows, env: merged.env });
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
      entry.started = new Promise<void>((resolve) => (entry.markStarted = resolve));
      entry.inbox = inbox;
      entry.process = proc;
      entry.environment = environment;
      entry.ended = new Promise<void>((resolve) => {
        proc.onExit(({ exitCode, signal }) => {
          if (entry.process === proc) this.onExit(entry, exitCode, signalName(signal));
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

  private async launchStream(entry: Entry, environment: AgentEnvironment, inboxDir: string, resume: boolean, args: readonly string[], env: Readonly<Record<string, string>>): Promise<void> {
    if (this.options.streamSpawner === undefined) throw new Error('no stream-json runtime is configured');
    const inbox = new HookInbox(inboxDir, (record) => this.onHook(entry, record));
    let stream: StreamProcess;
    try {
      stream = await this.options.streamSpawner.spawn({ session: entry.info, resume, environment, args, env });
    } catch (error) {
      inbox.dispose();
      throw error;
    }
    environment.attach(entry.info.id, stream.pid);
    entry.started = new Promise<void>((resolve) => (entry.markStarted = resolve));
    entry.inbox = inbox;
    entry.stream = stream;
    entry.environment = environment;
    entry.ended = new Promise<void>((resolve) => {
      stream.onExit((exitCode, signal) => {
        if (entry.stream === stream) this.onExit(entry, exitCode ?? -1, signal);
        resolve();
      });
    });
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

  private onExit(entry: Entry, exitCode: number, signal: string | null): void {
    entry.inbox?.stop();
    entry.inbox = undefined;
    entry.process = undefined;
    entry.stream = undefined;
    void entry.environment?.releaseSession(entry.info.id).catch(() => undefined);
    const session = this.setInfo(entry, (info) => ({ ...info, status: 'exited', exitCode }));
    this.emit({ type: 'session.exited', session, exitCode, signal });
  }

  private async shutdownEntry(entry: Entry): Promise<void> {
    const { environment } = entry;
    if ((!entry.process && !entry.stream) || !environment) return;
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
    if (next.status !== 'starting') {
      entry.markStarted?.();
      entry.markStarted = undefined;
    }
    if (next.status !== previous.status) this.emit({ type: 'session.status_changed', session: next, previous: previous.status });
    return next;
  }

  private persistedOf(entry: Entry) {
    const { id, folderId, title, cwd, launchPath, permissionMode, createdAt } = entry.info;
    return { id, folderId, title, cwd, launchPath, permissionMode, createdAt };
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
    if (entry.info.status === 'exited' || (!entry.process && !entry.stream)) throw new SessionError('not_running', `session ${id} has exited`);
    return entry;
  }

  /** A running PTY session; a stream-json session has no terminal to write to or resize. */
  private requirePty(id: SessionId): Entry {
    const entry = this.requireRunning(id);
    if (!entry.process) throw new SessionError('not_running', `session ${id} has no terminal`);
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
