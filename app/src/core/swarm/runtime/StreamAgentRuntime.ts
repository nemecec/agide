import { spawn, type ChildProcess } from 'node:child_process';
import type { Unsubscribe } from '../../events/EventBus';
import type { AgentEnvironment } from '../../isolation/types';
import type { LaunchContributor } from '../../session/launchContributions';
import type { StreamProcess, StreamSpawner, StreamSpawnRequest } from '../../session/streamSpawner';
import { SessionError, type SessionId, type SessionService } from '../../session/types';
import type { NdjsonItem } from './ndjson';
import { StreamChannel } from './StreamChannel';
import { logDropped, requireAbsoluteFile } from '../../isolation/hostTools';
import { normalizeMessage } from './normalize';
import { streamContribution } from './streamLaunch';
import { RuntimeError, type AgentLaunchSpec, type AgentRuntime, type PermissionAnswer, type RuntimeEvent } from './types';

export interface StreamAgentRuntimeOptions {
  readonly sessions: Pick<SessionService, 'create' | 'resume' | 'get' | 'close' | 'setPermissionMode'>;
  /** Wait for the response to a control request (0037 section 2.2). Default 20 s. */
  readonly controlTimeoutMs?: number;
  /** Longest wait for the first output line of a new process before `launch` returns anyway. Default 15 s. */
  readonly startTimeoutMs?: number;
  /** How long `stop` waits for the result of the interrupted turn. Default 2 s. */
  readonly stopInterruptWaitMs?: number;
  /** How long `stop` waits for the process to end after stdin closed, before SIGTERM. Default 5 s. */
  readonly stopGraceMs?: number;
  /** How long `stop` waits after SIGTERM, and again after SIGKILL. Default 2 s. */
  readonly killTimeoutMs?: number;
  /** Called before a launch or resume whose spec names a tool set, so the app MCP server lists that set for the session's grant. */
  readonly declareToolSet?: (sessionId: SessionId, toolSet: NonNullable<AgentLaunchSpec['toolSet']>) => void;
  /** Called for a stdout line that is not a JSON object or is over the size limit; the line is skipped. */
  readonly onUnreadable?: (sessionId: SessionId, item: Extract<NdjsonItem, { kind: 'invalid' | 'dropped' }>) => void;
}

interface Agent {
  readonly spec: AgentLaunchSpec;
  readonly resumed: boolean;
  readonly child: ChildProcess;
  readonly pid: number;
  readonly environment: AgentEnvironment;
  readonly channel: StreamChannel;
  /** Open `can_use_tool` requests by request id. */
  readonly open: Map<string, unknown>;
  /** Messages written after the running turn's result. */
  readonly queue: string[];
  readonly turnWaiters: Set<() => void>;
  readonly exitListeners: ((code: number | null, signal: string | null) => void)[];
  readonly exited: Promise<void>;
  markExited: () => void;
  /** Resolves with the first stdout line or the exit, whichever comes first. */
  readonly firstOutput: Promise<void>;
  markFirstOutput: () => void;
  stderrTail: string;
  started: boolean;
  /** `launch` or `resume` has returned; from then on the manager hears about the exit. */
  launchReturned: boolean;
  dead: boolean;
  exitInfo?: { readonly code: number | null; readonly signal: string | null };
  turnOpen: boolean;
  interruptSent: boolean;
  endRequested: boolean;
  byApp: boolean;
}

const STDERR_TAIL_CHARS = 2000;
const STDOUT_DRAIN_MS = 250;
/** The answer to every `can_use_tool` request of a session launched with `autoDeny`. */
export const AUTO_DENY_MESSAGE = 'Reviewers run read-only.';

/**
 * Runs swarm agents as `claude -p` stream-json processes (0037 section 2). The session service prepares each
 * launch (provider, hooks, MCP grant, settings); this class adds the stream-json arguments through its launch
 * contributor, spawns the host command the isolation provider returns, and turns the NDJSON stream into
 * `RuntimeEvent`s. It is the stream spawner of the session service and the `AgentRuntime` of the manager.
 */
export class StreamAgentRuntime implements AgentRuntime, StreamSpawner {
  private readonly specs = new Map<SessionId, AgentLaunchSpec>();
  private readonly agents = new Map<SessionId, Agent>();
  private readonly locks = new Set<SessionId>();
  private readonly closedItself = new Set<SessionId>();
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly timing: Required<Pick<StreamAgentRuntimeOptions, 'controlTimeoutMs' | 'startTimeoutMs' | 'stopInterruptWaitMs' | 'stopGraceMs' | 'killTimeoutMs'>>;

  constructor(private readonly options: StreamAgentRuntimeOptions) {
    this.timing = {
      controlTimeoutMs: options.controlTimeoutMs ?? 20_000,
      startTimeoutMs: options.startTimeoutMs ?? 15_000,
      stopInterruptWaitMs: options.stopInterruptWaitMs ?? 2_000,
      stopGraceMs: options.stopGraceMs ?? 5_000,
      killTimeoutMs: options.killTimeoutMs ?? 2_000,
    };
  }

  /** Registered on `LaunchContributors` by the swarm module: adds the stream-json arguments to the sessions of this runtime. */
  readonly contributor: LaunchContributor = {
    id: 'swarm',
    contribute: (context) => {
      const spec = this.specs.get(context.session.id);
      if (context.session.launchPath !== 'stream-json' || spec === undefined) return {};
      return streamContribution(spec, context.toEnv);
    },
  };

  async launch(spec: AgentLaunchSpec): Promise<void> {
    this.lock(spec.sessionId);
    try {
      this.specs.set(spec.sessionId, spec);
      this.declareToolSet(spec);
      try {
        await this.options.sessions.create({
          id: spec.sessionId,
          folderId: spec.folderId,
          cwd: spec.cwd,
          title: spec.title,
          permissionMode: spec.permissionMode,
          launchPath: 'stream-json',
        });
      } catch (error) {
        throw runtimeErrorOf(error);
      }
      await this.awaitFirstOutput(spec.sessionId, true);
    } finally {
      this.locks.delete(spec.sessionId);
    }
  }

  async resume(spec: AgentLaunchSpec): Promise<void> {
    this.lock(spec.sessionId);
    try {
      const info = this.options.sessions.get(spec.sessionId);
      if (info === undefined) throw new RuntimeError('not_found', `no session ${spec.sessionId}`);
      this.specs.set(spec.sessionId, spec);
      this.declareToolSet(spec);
      if (info.permissionMode !== spec.permissionMode) this.options.sessions.setPermissionMode(spec.sessionId, spec.permissionMode);
      try {
        await this.options.sessions.resume(spec.sessionId);
      } catch (error) {
        throw runtimeErrorOf(error);
      }
      await this.awaitFirstOutput(spec.sessionId, false);
    } finally {
      this.locks.delete(spec.sessionId);
    }
  }

  /** The stream spawner of the session service: starts the process and writes the agent's first message. */
  async spawn(request: StreamSpawnRequest): Promise<StreamProcess> {
    const sessionId = request.session.id;
    const spec = this.specs.get(sessionId);
    if (spec === undefined) throw new RuntimeError('spawn', `no launch spec for session ${sessionId}`);
    if (this.alive(sessionId) !== undefined) throw new RuntimeError('already_running', `session ${sessionId} runs`);
    const command = await request.environment.processCommand({ sessionId, cwd: request.session.cwd, args: request.args, env: request.env });
    logDropped(sessionId, command);
    requireAbsoluteFile(command);
    // Its own process group, so `stop` can end the agent's children with it.
    const child = spawn(command.file, [...command.args], { cwd: command.cwd, env: { ...command.env }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (error) => reject(new RuntimeError('spawn', `cannot start ${command.file}: ${error.message}`)));
    });
    child.on('error', () => undefined);
    const agent = this.register(spec, request, child);
    agent.turnOpen = true;
    agent.channel.writeUser(spec.firstMessage);
    return {
      pid: agent.pid,
      sendText: (text) => this.send(sessionId, text),
      onExit: (listener) => {
        if (agent.exitInfo === undefined) agent.exitListeners.push(listener);
        else queueMicrotask(() => listener(agent.exitInfo?.code ?? null, agent.exitInfo?.signal ?? null));
      },
    };
  }

  send(sessionId: SessionId, text: string, options: { readonly now?: boolean } = {}): void {
    const agent = this.require(sessionId);
    if (!agent.channel.writable) throw new RuntimeError('not_running', `session ${sessionId} takes no more input`);
    if (options.now === true && agent.turnOpen) {
      agent.queue.unshift(text);
      void this.interrupt(sessionId).catch(() => undefined);
      return;
    }
    agent.queue.push(text);
    this.pump(agent);
  }

  answer(sessionId: SessionId, requestId: string, answer: PermissionAnswer): void {
    const agent = this.alive(sessionId);
    if (agent === undefined || !agent.open.delete(requestId)) return;
    const response = answer.behavior === 'allow' ? { behavior: 'allow', updatedInput: answer.updatedInput } : { behavior: 'deny', message: answer.message };
    try {
      agent.channel.writePermissionAnswer(requestId, response);
    } catch {
      // the process ended; its exit supersedes the request
    }
  }

  async interrupt(sessionId: SessionId): Promise<void> {
    const agent = this.require(sessionId);
    if (!agent.turnOpen) return;
    let resolveTurn = (): void => undefined;
    const turnEnded = new Promise<void>((resolve) => {
      resolveTurn = resolve;
      agent.turnWaiters.add(resolve);
    });
    agent.interruptSent = true;
    await agent.channel.request({ subtype: 'interrupt' });
    if ((await within(turnEnded.then(() => true), this.timing.controlTimeoutMs)) !== true) {
      agent.turnWaiters.delete(resolveTurn);
      throw new RuntimeError('timeout', 'the turn did not end after the interrupt');
    }
  }

  async end(sessionId: SessionId): Promise<void> {
    const agent = this.require(sessionId);
    agent.endRequested = true;
    agent.byApp = true;
    if (!agent.turnOpen && agent.queue.length === 0) agent.channel.closeStdin();
    await agent.exited;
  }

  async stop(sessionId: SessionId): Promise<void> {
    const agent = this.alive(sessionId);
    if (agent === undefined) return;
    agent.byApp = true;
    agent.endRequested = true;
    agent.queue.length = 0;
    if (agent.turnOpen && agent.channel.writable)
      await within(
        this.interrupt(sessionId).catch(() => undefined),
        this.timing.stopInterruptWaitMs,
      );
    agent.channel.closeStdin();
    if (await this.exitedWithin(agent, this.timing.stopGraceMs)) return;
    await this.signal(agent, 'SIGTERM');
    if (await this.exitedWithin(agent, this.timing.killTimeoutMs)) return;
    await this.signal(agent, 'SIGKILL');
    await this.exitedWithin(agent, this.timing.killTimeoutMs);
  }

  async control(sessionId: SessionId, request: { readonly subtype: string; readonly [key: string]: unknown }): Promise<Record<string, unknown>> {
    return this.require(sessionId).channel.request(request);
  }

  closedByRuntime(sessionId: SessionId): boolean {
    return this.closedItself.has(sessionId);
  }

  isLive(sessionId: SessionId): boolean {
    return this.alive(sessionId) !== undefined;
  }

  isBusy(sessionId: SessionId): boolean {
    const agent = this.alive(sessionId);
    return agent !== undefined && (agent.turnOpen || agent.queue.length > 0);
  }

  subscribe(listener: (event: RuntimeEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.agents.keys()].map((id) => this.stop(id)));
  }

  private lock(sessionId: SessionId): void {
    if (this.locks.has(sessionId) || this.alive(sessionId) !== undefined) throw new RuntimeError('already_running', `session ${sessionId} runs`);
    this.locks.add(sessionId);
  }

  private alive(sessionId: SessionId): Agent | undefined {
    const agent = this.agents.get(sessionId);
    return agent === undefined || agent.dead ? undefined : agent;
  }

  private require(sessionId: SessionId): Agent {
    const agent = this.alive(sessionId);
    if (agent === undefined) throw new RuntimeError('not_running', `no live process for session ${sessionId}`);
    return agent;
  }

  private register(spec: AgentLaunchSpec, request: StreamSpawnRequest, child: ChildProcess): Agent {
    const sessionId = request.session.id;
    let markExited = (): void => undefined;
    let markFirstOutput = (): void => undefined;
    const stdoutEnded = new Promise<void>((resolve) => child.stdout?.once('close', resolve));
    const agent: Agent = {
      spec,
      resumed: request.resume,
      child,
      pid: child.pid ?? 0,
      environment: request.environment,
      channel: new StreamChannel(child.stdin!, {
        controlTimeoutMs: this.timing.controlTimeoutMs,
        onMessage: (message) => this.handle(agent, message),
        onUnreadable: (item) => this.options.onUnreadable?.(sessionId, item),
      }),
      open: new Map(),
      queue: [],
      turnWaiters: new Set(),
      exitListeners: [],
      exited: new Promise<void>((resolve) => (markExited = resolve)),
      markExited: () => markExited(),
      firstOutput: new Promise<void>((resolve) => (markFirstOutput = resolve)),
      markFirstOutput: () => markFirstOutput(),
      stderrTail: '',
      started: false,
      launchReturned: false,
      dead: false,
      turnOpen: false,
      interruptSent: false,
      endRequested: false,
      byApp: false,
    };
    this.agents.set(sessionId, agent);
    child.stdout?.on('data', (chunk: Buffer) => agent.channel.feed(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      agent.stderrTail = (agent.stderrTail + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS);
    });
    child.once('exit', (code, signal) => {
      void within(stdoutEnded, STDOUT_DRAIN_MS).then(() => {
        agent.channel.finish();
        child.stdout?.destroy();
        child.stderr?.destroy();
        this.finalize(agent, code, signal);
      });
    });
    return agent;
  }

  private handle(agent: Agent, raw: Record<string, unknown>): void {
    const sessionId = agent.spec.sessionId;
    if (!agent.started) {
      agent.started = true;
      this.emit({ type: 'started', sessionId, pid: agent.pid, resumed: agent.resumed });
      agent.markFirstOutput();
    }
    this.emit({ type: 'message', sessionId, raw });
    const request = raw['type'] === 'control_request' ? (raw['request'] as { subtype?: unknown } | undefined) : undefined;
    if (request !== undefined && request.subtype !== 'can_use_tool' && typeof raw['request_id'] === 'string') {
      try {
        agent.channel.writeControlError(raw['request_id'], `Unsupported control request subtype: ${String(request.subtype)}`);
      } catch {
        // the process ended
      }
    }
    for (const event of normalizeMessage(sessionId, raw)) {
      if (event.type === 'permission_request' && agent.spec.autoDeny === true) {
        this.autoDeny(agent, event.requestId);
        continue;
      }
      if (event.type === 'permission_request') agent.open.set(event.requestId, event.request);
      if (event.type === 'permission_cancelled' && !agent.open.delete(event.requestId)) continue;
      if (event.type === 'result') this.finishTurn(agent, event);
      else this.emit(event);
    }
  }

  private declareToolSet(spec: AgentLaunchSpec): void {
    if (spec.toolSet !== undefined) this.options.declareToolSet?.(spec.sessionId, spec.toolSet);
  }

  /** Denies a request at once, without an event: no inbox item and no waiting turn. The CLI lists the denial in its result. */
  private autoDeny(agent: Agent, requestId: string): void {
    try {
      agent.channel.writePermissionAnswer(requestId, { behavior: 'deny', message: AUTO_DENY_MESSAGE });
    } catch {
      // the process ended; its exit supersedes the request
    }
  }

  private finishTurn(agent: Agent, event: Extract<RuntimeEvent, { type: 'result' }>): void {
    const interrupted = agent.interruptSent && event.result.isError;
    agent.interruptSent = false;
    agent.turnOpen = false;
    agent.open.clear();
    this.pump(agent);
    if (!agent.turnOpen && agent.endRequested) agent.channel.closeStdin();
    this.emit({ ...event, result: { ...event.result, interrupted } });
    const waiters = [...agent.turnWaiters];
    agent.turnWaiters.clear();
    for (const done of waiters) done();
  }

  /** Writes the next queued message when no turn runs. */
  private pump(agent: Agent): void {
    if (agent.turnOpen) return;
    const next = agent.queue.shift();
    if (next === undefined) return;
    try {
      agent.channel.writeUser(next);
      agent.turnOpen = true;
    } catch {
      // the process ended; its exit is reported separately
    }
  }

  private finalize(agent: Agent, code: number | null, signal: string | null): void {
    agent.dead = true;
    agent.exitInfo = { code, signal };
    agent.turnOpen = false;
    agent.queue.length = 0;
    agent.channel.rejectAll(new RuntimeError('not_running', 'the process ended'));
    const reported = agent.started || agent.launchReturned;
    if (reported) this.agents.delete(agent.spec.sessionId);
    signalGroup(agent.pid, 'SIGKILL');
    for (const listener of agent.exitListeners) listener(code, signal);
    agent.markFirstOutput();
    if (reported) this.emit({ type: 'exited', sessionId: agent.spec.sessionId, code, signal, byApp: agent.byApp });
    for (const done of [...agent.turnWaiters]) done();
    agent.turnWaiters.clear();
    agent.markExited();
  }

  /** Waits for the first output of the process the session service just started, and turns an early exit into an error. */
  private async awaitFirstOutput(sessionId: SessionId, closeOnFailure: boolean): Promise<void> {
    const agent = this.agents.get(sessionId);
    if (agent === undefined) throw new RuntimeError('spawn', `no process started for session ${sessionId}`);
    await within(agent.firstOutput, this.timing.startTimeoutMs);
    if (!agent.dead || agent.started) {
      agent.launchReturned = true;
      return;
    }
    this.agents.delete(sessionId);
    if (closeOnFailure) {
      this.closedItself.add(sessionId);
      await this.options.sessions.close(sessionId).catch(() => undefined);
    }
    const stderr = agent.stderrTail.trim();
    const code = /No conversation found/.test(stderr) ? 'not_found' : 'spawn';
    throw new RuntimeError(code, `claude exited with code ${agent.exitInfo?.code ?? 'none'} before it wrote an event${stderr === '' ? '' : `: ${stderr}`}`);
  }

  private async exitedWithin(agent: Agent, ms: number): Promise<boolean> {
    return (
      (await within(
        agent.exited.then(() => true),
        ms,
      )) === true
    );
  }

  private async signal(agent: Agent, signal: 'SIGTERM' | 'SIGKILL'): Promise<void> {
    await agent.environment.terminate(agent.spec.sessionId, signal).catch(() => undefined);
    signalGroup(agent.pid, signal);
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('swarm runtime listener failed', error);
      }
    }
  }
}

/** Signals the process group the agent leads, which holds the processes its tools started. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  if (pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // no such group or no permission: nothing left to end
  }
}

/** The value of `promise`, or undefined after `ms`. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function runtimeErrorOf(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SessionError) {
    if (error.code === 'not_found') return new RuntimeError('not_found', message);
    if (error.code === 'already_running') return new RuntimeError('already_running', message);
  }
  return new RuntimeError('spawn', message);
}
