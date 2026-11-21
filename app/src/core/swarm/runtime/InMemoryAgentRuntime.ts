import type { Unsubscribe } from '../../events/EventBus';
import type { SessionId } from '../../session/types';
import { FAKE_COST_PER_MESSAGE_USD, parseFakeSteps, type FakeStep } from './fakeScript';
import { RuntimeError, type AgentLaunchSpec, type AgentRuntime, type PermissionAnswer, type RuntimeEvent, type TurnResult } from './types';

interface Waiter {
  readonly resolve: () => void;
}

interface Proc {
  readonly spec: AgentLaunchSpec;
  readonly pid: number;
  costUsd: number;
  busy: boolean;
  aborted: boolean;
  exhausted: boolean;
  endRequested: boolean;
  readonly queue: string[];
  readonly answers: Map<string, (answer: PermissionAnswer | undefined) => void>;
  readonly sleeps: Set<Waiter>;
  readonly turnEnded: Set<() => void>;
  readonly exited: Promise<void>;
  markExited: () => void;
  byApp: boolean;
}

const MODELS = ['default', 'fable', 'opus', 'sonnet', 'haiku'];

/**
 * An `AgentRuntime` without processes, for the manager's tests. User messages are read in the step language of
 * `fakeScript.ts`. Passes `describeAgentRuntimeContract`.
 */
export class InMemoryAgentRuntime implements AgentRuntime {
  private readonly procs = new Map<SessionId, Proc>();
  private readonly known = new Set<SessionId>();
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private nextPid = 1000;
  private nextId = 1;
  /** The specs of every launch and resume, in order, for assertions. */
  readonly launches: AgentLaunchSpec[] = [];
  /** The mode `system/init` reports for a launch; by default the requested one, as the CLI does (P30). */
  reportMode: (spec: AgentLaunchSpec) => string = (spec) => spec.permissionMode;

  async launch(spec: AgentLaunchSpec): Promise<void> {
    if (this.procs.has(spec.sessionId)) throw new RuntimeError('already_running', `session ${spec.sessionId} runs`);
    if (this.known.has(spec.sessionId)) throw new RuntimeError('spawn', `Session ID ${spec.sessionId} is already in use`);
    this.start(spec, false);
  }

  async resume(spec: AgentLaunchSpec): Promise<void> {
    if (this.procs.has(spec.sessionId)) throw new RuntimeError('already_running', `session ${spec.sessionId} runs`);
    if (!this.known.has(spec.sessionId)) throw new RuntimeError('not_found', `No conversation found with session ID: ${spec.sessionId}`);
    this.start(spec, true);
  }

  send(sessionId: SessionId, text: string, options: { readonly now?: boolean } = {}): void {
    const proc = this.live(sessionId);
    if (options.now === true && proc.busy) {
      proc.queue.unshift(text);
      this.abort(proc);
      return;
    }
    proc.queue.push(text);
    if (!proc.busy) void this.drain(proc);
  }

  answer(sessionId: SessionId, requestId: string, answer: PermissionAnswer): void {
    const proc = this.procs.get(sessionId);
    const resolve = proc?.answers.get(requestId);
    if (resolve === undefined || proc === undefined) return;
    proc.answers.delete(requestId);
    resolve(answer);
  }

  async interrupt(sessionId: SessionId): Promise<void> {
    const proc = this.live(sessionId);
    if (!proc.busy) return;
    const ended = new Promise<void>((resolve) => proc.turnEnded.add(resolve));
    this.abort(proc);
    await ended;
  }

  async end(sessionId: SessionId): Promise<void> {
    const proc = this.live(sessionId);
    proc.endRequested = true;
    proc.byApp = true;
    if (!proc.busy && proc.queue.length === 0) this.exit(proc, 0);
    await proc.exited;
  }

  async stop(sessionId: SessionId): Promise<void> {
    const proc = this.procs.get(sessionId);
    if (proc === undefined) return;
    proc.queue.length = 0;
    proc.endRequested = true;
    proc.byApp = true;
    if (proc.busy) await this.interrupt(sessionId);
    if (this.procs.get(sessionId) === proc) this.exit(proc, 0);
    await proc.exited;
  }

  async control(sessionId: SessionId, request: { readonly subtype: string }): Promise<Record<string, unknown>> {
    this.live(sessionId);
    if (request.subtype === 'initialize') return { models: MODELS.map((value) => ({ value })), commands: [] };
    return {};
  }

  isLive(sessionId: SessionId): boolean {
    return this.procs.has(sessionId);
  }

  isBusy(sessionId: SessionId): boolean {
    return this.procs.get(sessionId)?.busy ?? false;
  }

  subscribe(listener: (event: RuntimeEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.procs.keys()].map((id) => this.stop(id)));
  }

  private start(spec: AgentLaunchSpec, resumed: boolean): void {
    this.launches.push(spec);
    let markExited = (): void => undefined;
    const exited = new Promise<void>((resolve) => (markExited = resolve));
    const proc: Proc = {
      spec,
      pid: this.nextPid++,
      costUsd: 0,
      busy: false,
      aborted: false,
      exhausted: false,
      endRequested: false,
      queue: [spec.firstMessage],
      answers: new Map(),
      sleeps: new Set(),
      turnEnded: new Set(),
      exited,
      markExited,
      byApp: false,
    };
    this.known.add(spec.sessionId);
    this.procs.set(spec.sessionId, proc);
    this.emit({ type: 'started', sessionId: spec.sessionId, pid: proc.pid, resumed });
    void this.drain(proc);
  }

  private async drain(proc: Proc): Promise<void> {
    while (!proc.busy && this.procs.get(proc.spec.sessionId) === proc) {
      const text = proc.queue.shift();
      if (text === undefined) {
        if (proc.endRequested) this.exit(proc, 0);
        return;
      }
      proc.busy = true;
      proc.aborted = false;
      const outcome = await this.turn(proc, text);
      proc.busy = false;
      if (outcome === 'exited') return;
      for (const done of proc.turnEnded) done();
      proc.turnEnded.clear();
    }
  }

  private async turn(proc: Proc, text: string): Promise<'result' | 'exited'> {
    const sessionId = proc.spec.sessionId;
    const permissionMode = this.reportMode(proc.spec);
    this.emitRaw(sessionId, {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      model: proc.spec.model,
      permissionMode,
      apiKeySource: 'none',
      tools: ['Bash', 'Read', 'Write', 'Edit'],
    });
    this.emit({ type: 'init', sessionId, permissionMode, model: proc.spec.model, apiKeySource: 'none', tools: ['Bash', 'Read', 'Write', 'Edit'] });
    if (proc.exhausted) {
      this.result(proc, {
        subtype: 'error_max_budget_usd',
        isError: true,
        terminalReason: 'budget_exhausted',
        text: undefined,
        errors: [`Reached maximum budget ($${proc.spec.maxBudgetUsd})`],
        denials: [],
        turns: 1,
      });
      return 'result';
    }
    let resultText: string | undefined;
    let costSet: number | undefined;
    let turns = 0;
    let pendingTool = false;
    const denials: unknown[] = [];
    for (const step of parseFakeSteps(text) as FakeStep[]) {
      if (proc.aborted) break;
      switch (step.kind) {
        case 'text':
          turns += 1;
          resultText = step.text;
          this.assistant(proc, step.text, []);
          break;
        case 'tool': {
          turns += 1;
          this.assistant(proc, undefined, [step.name]);
          const requestId = `req-${this.nextId++}`;
          const answered = new Promise<PermissionAnswer | undefined>((resolve) => proc.answers.set(requestId, resolve));
          const request = {
            subtype: 'can_use_tool' as const,
            tool_name: step.name,
            display_name: step.name,
            input: step.input,
            permission_suggestions: [],
            tool_use_id: `toolu_${requestId}`,
          };
          this.emitRaw(sessionId, { type: 'control_request', request_id: requestId, request });
          this.emit({ type: 'permission_request', sessionId, requestId, request });
          pendingTool = true;
          const answer = await answered;
          pendingTool = answer === undefined;
          if (answer === undefined) {
            this.emitRaw(sessionId, { type: 'control_cancel_request', request_id: requestId });
            this.emit({ type: 'permission_cancelled', sessionId, requestId });
            break;
          }
          if (answer.behavior === 'deny') denials.push({ tool_name: step.name, tool_use_id: request.tool_use_id, tool_input: step.input });
          break;
        }
        case 'cost':
          costSet = step.usd;
          break;
        case 'sleep':
          await this.sleep(proc, step.ms);
          break;
        case 'fail':
          this.result(proc, {
            subtype: 'error_during_execution',
            isError: true,
            terminalReason: step.reason,
            text: undefined,
            errors: [`fake failure: ${step.reason}`],
            denials,
            turns,
            cost: costSet,
          });
          return 'result';
        case 'exit':
          this.exit(proc, step.code);
          return 'exited';
        case 'write':
          break;
      }
    }
    if (proc.aborted) {
      this.result(proc, {
        subtype: 'error_during_execution',
        isError: true,
        terminalReason: pendingTool ? 'aborted_tools' : 'aborted_streaming',
        text: undefined,
        errors: [],
        denials,
        turns,
        cost: costSet,
        interrupted: true,
      });
      return 'result';
    }
    if (costSet !== undefined) proc.costUsd = costSet;
    if (proc.costUsd >= proc.spec.maxBudgetUsd) {
      proc.exhausted = true;
      this.result(proc, {
        subtype: 'error_max_budget_usd',
        isError: true,
        terminalReason: 'budget_exhausted',
        text: undefined,
        errors: [`Reached maximum budget ($${proc.spec.maxBudgetUsd})`],
        denials,
        turns,
      });
      return 'result';
    }
    this.result(proc, { subtype: 'success', isError: false, terminalReason: 'completed', text: resultText, errors: [], denials, turns });
    return 'result';
  }

  private assistant(proc: Proc, text: string | undefined, toolNames: string[]): void {
    const sessionId = proc.spec.sessionId;
    const messageId = `msg_fake_${this.nextId++}`;
    const usage = { input: 10, output: 5, cacheWrite5m: 0, cacheWrite1h: 100, cacheRead: 200 };
    proc.costUsd += FAKE_COST_PER_MESSAGE_USD;
    this.emitRaw(sessionId, {
      type: 'assistant',
      message: {
        id: messageId,
        model: proc.spec.model,
        role: 'assistant',
        content: text === undefined ? toolNames.map((name) => ({ type: 'tool_use', name })) : [{ type: 'text', text }],
      },
    });
    this.emit({ type: 'assistant', sessionId, messageId, model: proc.spec.model, usage, text, toolNames });
  }

  private result(
    proc: Proc,
    r: {
      subtype: string;
      isError: boolean;
      terminalReason: string;
      text: string | undefined;
      errors: string[];
      denials: unknown[];
      turns: number;
      cost?: number | undefined;
      interrupted?: boolean;
    },
  ): void {
    if (r.cost !== undefined) proc.costUsd = r.cost;
    proc.busy = proc.queue.length > 0;
    const sessionId = proc.spec.sessionId;
    const result: TurnResult = {
      subtype: r.subtype,
      isError: r.isError,
      terminalReason: r.terminalReason,
      totalCostUsd: proc.costUsd,
      numTurns: r.turns,
      text: r.text,
      errors: r.errors,
      permissionDenials: r.denials,
      interrupted: r.interrupted ?? false,
    };
    this.emitRaw(sessionId, {
      type: 'result',
      subtype: r.subtype,
      is_error: r.isError,
      terminal_reason: r.terminalReason,
      total_cost_usd: proc.costUsd,
      num_turns: r.turns,
      result: r.text,
      errors: r.errors,
      permission_denials: r.denials,
    });
    this.emit({ type: 'result', sessionId, result });
  }

  private sleep(proc: Proc, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const waiter: Waiter = {
        resolve: () => {
          clearTimeout(timer);
          proc.sleeps.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(waiter.resolve, ms);
      proc.sleeps.add(waiter);
    });
  }

  private abort(proc: Proc): void {
    proc.aborted = true;
    for (const waiter of [...proc.sleeps]) waiter.resolve();
    for (const [requestId, resolve] of [...proc.answers]) {
      proc.answers.delete(requestId);
      resolve(undefined);
    }
  }

  private exit(proc: Proc, code: number): void {
    if (this.procs.get(proc.spec.sessionId) !== proc) return;
    this.procs.delete(proc.spec.sessionId);
    this.abort(proc);
    for (const done of proc.turnEnded) done();
    proc.turnEnded.clear();
    this.emit({ type: 'exited', sessionId: proc.spec.sessionId, code, signal: null, byApp: proc.byApp });
    proc.markExited();
  }

  private live(sessionId: SessionId): Proc {
    const proc = this.procs.get(sessionId);
    if (proc === undefined) throw new RuntimeError('not_running', `no live process for session ${sessionId}`);
    return proc;
  }

  private emitRaw(sessionId: SessionId, raw: Record<string, unknown>): void {
    this.emit({ type: 'message', sessionId, raw });
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
