import { EventBus, type Unsubscribe } from '../../events/EventBus';
import type { SessionId } from '../../session/types';
import { DEFAULT_TIERS, type TierTable } from '../../swarm/tiers';
import type { AgentLaunchSpec, AgentRuntime, RuntimeEvent, TurnResult } from '../../swarm/runtime/types';
import type { RunFailure } from '../schemas';
import type { ReviewRunRequest, ReviewerEvent, ReviewerRuntime } from '../types';

/** The MCP tool name of `report_review` as the CLI names it. */
export const REPORT_REVIEW_TOOL = 'mcp__app__report_review';
export const REVIEWER_TOOLS = ['Read', 'Grep', 'Glob'] as const;
export const REVIEWER_DENIED = 'Reviewers run read-only.';

export interface InMemoryReviewerRuntimeOptions {
  readonly runtime: AgentRuntime;
  /** The first message of a run. In tests it is a step script of `runtime/fakeScript.ts`. */
  readonly script: (request: ReviewRunRequest) => string;
  /**
   * Called for a `/tool mcp__app__report_review <json>` step, standing in for the MCP call the real reviewer
   * makes: the review module routes it to `report_review` as the reviewer session.
   */
  readonly onReportCall?: (sessionId: SessionId, input: Record<string, unknown>) => Promise<unknown>;
  readonly tiers?: TierTable;
}

interface Run {
  readonly request: ReviewRunRequest;
  lastResult?: TurnResult;
  failure?: RunFailure;
  denied: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * A `ReviewerRuntime` over any `AgentRuntime` (the in-memory one in tests): one session per run with the reviewer
 * flags of 0040 section 10.1 in its launch spec, every other `can_use_tool` request denied at once, the process
 * ended after its first result, and the run's end reported with the cost and the result. w-reviewer's runner adds
 * the checkout, the settings file, the prompt and the grant on top of the same events.
 */
export class InMemoryReviewerRuntime implements ReviewerRuntime {
  private readonly runs = new Map<SessionId, Run>();
  private readonly bySession = new Map<string, SessionId>();
  private readonly events = new EventBus<ReviewerEvent>();
  private readonly off: Unsubscribe;
  /** Launch specs in order, for assertions. */
  readonly specs: AgentLaunchSpec[] = [];

  constructor(private readonly options: InMemoryReviewerRuntimeOptions) {
    this.off = options.runtime.subscribe((event) => this.onEvent(event));
  }

  async start(request: ReviewRunRequest): Promise<void> {
    const tier = (this.options.tiers ?? DEFAULT_TIERS)[request.tier];
    const spec: AgentLaunchSpec = {
      sessionId: request.sessionId,
      folderId: request.folderId ?? 'review',
      title: `Review of ${request.agent} (${request.changesetId})`,
      cwd: `/review/${request.changesetId}`,
      model: tier.model,
      effort: request.effort,
      permissionMode: 'default',
      maxBudgetUsd: request.reservationUsd,
      maxTurnsPerMessage: request.maxTurns,
      connectors: false,
      tools: [...REVIEWER_TOOLS],
      denyRules: ['Edit(**)', 'Write(**)', 'NotebookEdit(**)', 'WebFetch'],
      addDirs: [],
      firstMessage: this.options.script(request),
      allowedTools: [REPORT_REVIEW_TOOL],
      toolSet: 'reviewer',
      autoDeny: true,
    };
    this.specs.push(spec);
    const run: Run = { request, denied: 0 };
    this.runs.set(request.sessionId, run);
    this.bySession.set(request.runId, request.sessionId);
    run.timer = setTimeout(() => void this.cancel(request.runId, 'timeout'), request.timeoutMinutes * 60_000);
    try {
      await this.options.runtime.launch(spec);
    } catch (error) {
      clearTimeout(run.timer);
      this.runs.delete(request.sessionId);
      this.events.emit({ type: 'ended', runId: request.runId, sessionId: request.sessionId, costUsd: 0, failure: 'spawn', deniedRequests: 0 });
      throw error;
    }
  }

  async cancel(runId: string, why: RunFailure): Promise<void> {
    const sessionId = this.bySession.get(runId);
    const run = sessionId === undefined ? undefined : this.runs.get(sessionId);
    if (run === undefined || sessionId === undefined) return;
    run.failure ??= why;
    if (this.options.runtime.isLive(sessionId)) await this.options.runtime.stop(sessionId);
  }

  subscribe(listener: (event: ReviewerEvent) => void): Unsubscribe {
    return this.events.onAny(listener);
  }

  async dispose(): Promise<void> {
    this.off();
    await Promise.all([...this.runs.values()].map((run) => this.cancel(run.request.runId, 'app-exit')));
  }

  private onEvent(event: RuntimeEvent): void {
    const run = this.runs.get(event.sessionId);
    if (run === undefined) return;
    const { runtime } = this.options;
    switch (event.type) {
      case 'started':
        this.events.emit({ type: 'started', runId: run.request.runId, sessionId: event.sessionId, pid: event.pid, model: this.specs.find((spec) => spec.sessionId === event.sessionId)?.model ?? '' });
        break;
      case 'permission_request':
        if (event.request.tool_name === REPORT_REVIEW_TOOL && this.options.onReportCall !== undefined) {
          void this.options.onReportCall(event.sessionId, event.request.input).finally(() => runtime.answer(event.sessionId, event.requestId, { behavior: 'allow', updatedInput: event.request.input }));
        } else {
          run.denied += 1;
          runtime.answer(event.sessionId, event.requestId, { behavior: 'deny', message: REVIEWER_DENIED });
        }
        break;
      case 'result':
        run.lastResult = event.result;
        if (run.failure === undefined && event.result.isError) run.failure = event.result.terminalReason === 'budget_exhausted' ? 'budget' : 'error-result';
        void runtime.end(event.sessionId);
        break;
      case 'exited': {
        clearTimeout(run.timer);
        this.runs.delete(event.sessionId);
        this.bySession.delete(run.request.runId);
        this.events.emit({
          type: 'ended',
          runId: run.request.runId,
          sessionId: event.sessionId,
          costUsd: run.lastResult?.totalCostUsd ?? 0,
          ...(run.lastResult === undefined ? {} : { result: run.lastResult }),
          ...(run.failure === undefined ? {} : { failure: run.failure }),
          deniedRequests: run.denied,
        });
        break;
      }
      default:
        break;
    }
  }
}
