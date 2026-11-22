import { EventBus, type Unsubscribe } from '../../events/EventBus';
import type { SessionId } from '../../session/types';
import { DEFAULT_TIERS, type TierTable } from '../../swarm/tiers';
import type { AgentLaunchSpec, AgentRuntime, RuntimeEvent, TurnResult } from '../../swarm/runtime/types';
import type { RunFailure } from '../schemas';
import type { ReviewRunRequest, ReviewerEvent, ReviewerRuntime } from '../types';
import type { ReviewerCheckout, ReviewerCheckouts } from './checkout';
import { REPORT_REVIEW_TOOL, reviewerLaunchSpec } from './launch';
import { buildReviewPrompt, type PromptOptions } from './prompt';

export const REVIEWER_DENIED = 'Reviewers run read-only.';

export interface StreamReviewerRuntimeOptions {
  /** The swarm's runtime: `StreamAgentRuntime` in the app, the in-memory runtime in tests. */
  readonly runtime: AgentRuntime;
  readonly checkouts: ReviewerCheckouts;
  /** The tier table, read at each start so a changed profile setting applies to the next run. */
  readonly tiers?: TierTable | (() => TierTable);
  /**
   * Ends a run at once as `spawn` when the first `init` does not list the report tool, which is how the CLI shows
   * a failed app server (P41). Off for runtimes whose `init` does not list MCP tools.
   */
  readonly requireReportToolListed?: boolean;
  readonly prompt?: PromptOptions;
  /**
   * For an agent runtime that has no MCP server, such as the in-memory one: a `can_use_tool` request for the report
   * tool goes here, standing in for the MCP call the real reviewer makes, and is then allowed.
   */
  readonly onReportCall?: (sessionId: SessionId, input: Record<string, unknown>) => Promise<unknown>;
}

interface Run {
  readonly request: ReviewRunRequest;
  readonly spec: AgentLaunchSpec;
  readonly checkout: ReviewerCheckout;
  readonly promptVersion: string;
  lastResult?: TurnResult;
  failure?: RunFailure;
  denied: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Runs a reviewer on the swarm's `AgentRuntime` (0040 section 10): a read-only checkout of the checkpoint, the
 * prompt of `buildReviewPrompt`, the launch spec of `reviewerLaunchSpec`, one process per run that ends after its
 * first result, the timeout, and the report of the run's end. The report itself reaches the app through
 * `report_review`. Every `can_use_tool` request is denied: by the runtime for a spec with `autoDeny`, and here
 * for a runtime that still emits it.
 */
export class StreamReviewerRuntime implements ReviewerRuntime {
  private readonly runs = new Map<SessionId, Run>();
  private readonly sessionOf = new Map<string, SessionId>();
  /** Runs whose checkout is being prepared, with the failure of a cancel that arrived meanwhile. */
  private readonly preparing = new Map<string, { failure?: RunFailure }>();
  private readonly events = new EventBus<ReviewerEvent>();
  private readonly off: Unsubscribe;

  constructor(private readonly options: StreamReviewerRuntimeOptions) {
    this.off = options.runtime.subscribe((event) => this.onEvent(event));
  }

  async start(request: ReviewRunRequest): Promise<void> {
    const prompt = buildReviewPrompt(request, this.options.prompt);
    let checkout: ReviewerCheckout;
    const pending: { failure?: RunFailure } = {};
    this.preparing.set(request.runId, pending);
    try {
      checkout = await this.options.checkouts.prepare({ runId: request.runId, commonDir: request.commonDir, checkpointCommit: request.checkpointCommit, inputFiles: prompt.inputFiles });
    } catch (error) {
      this.preparing.delete(request.runId);
      console.warn(`review: reviewer checkout of run ${request.runId} failed`, error);
      this.emitEnded(request, { costUsd: 0, failure: pending.failure ?? 'spawn', denied: 0 });
      throw error;
    }
    this.preparing.delete(request.runId);
    if (pending.failure !== undefined) {
      await checkout.dispose().catch(() => undefined);
      this.emitEnded(request, { costUsd: 0, failure: pending.failure, denied: 0 });
      return;
    }
    const configured = this.options.tiers;
    const tiers = configured === undefined ? DEFAULT_TIERS : typeof configured === 'function' ? configured() : configured;
    const spec = reviewerLaunchSpec(request, { cwd: checkout.cwd, inputsDir: checkout.inputsDir, firstMessage: prompt.text, tiers });
    const run: Run = { request, spec, checkout, promptVersion: prompt.version, denied: 0 };
    this.runs.set(request.sessionId, run);
    this.sessionOf.set(request.runId, request.sessionId);
    run.timer = setTimeout(() => void this.cancel(request.runId, 'timeout'), request.timeoutMinutes * 60_000);
    try {
      await this.options.runtime.launch(spec);
    } catch (error) {
      console.warn(`review: reviewer run ${request.runId} did not launch`, error);
      clearTimeout(run.timer);
      this.forget(run);
      await checkout.dispose().catch(() => undefined);
      this.emitEnded(request, { costUsd: 0, failure: 'spawn', denied: 0 });
      throw error;
    }
  }

  async cancel(runId: string, why: RunFailure): Promise<void> {
    const preparing = this.preparing.get(runId);
    if (preparing !== undefined) {
      preparing.failure ??= why;
      return;
    }
    const sessionId = this.sessionOf.get(runId);
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
    for (const pending of this.preparing.values()) pending.failure ??= 'app-exit';
    const open = [...this.runs.values()];
    await Promise.all(open.map((run) => this.cancel(run.request.runId, 'app-exit')));
    // The read-only checkouts go with the app, whether or not the processes' exit events arrived.
    await Promise.all(open.map((run) => run.checkout.dispose().catch(() => undefined)));
  }

  private onEvent(event: RuntimeEvent): void {
    const run = this.runs.get(event.sessionId);
    if (run === undefined) return;
    const { runtime } = this.options;
    switch (event.type) {
      case 'started':
        this.events.emit({ type: 'started', runId: run.request.runId, sessionId: event.sessionId, pid: event.pid, model: run.spec.model, promptVersion: run.promptVersion });
        break;
      case 'init':
        if (this.options.requireReportToolListed === true && !event.tools.includes(REPORT_REVIEW_TOOL)) {
          console.warn(`review: reviewer run ${run.request.runId} has no ${REPORT_REVIEW_TOOL} in its tools: ${event.tools.join(', ')}`);
          void this.cancel(run.request.runId, 'spawn');
        }
        break;
      case 'permission_request':
        if (event.request.tool_name === REPORT_REVIEW_TOOL && this.options.onReportCall !== undefined) {
          void this.options.onReportCall(event.sessionId, event.request.input).finally(() => runtime.answer(event.sessionId, event.requestId, { behavior: 'allow', updatedInput: event.request.input }));
          break;
        }
        run.denied += 1;
        runtime.answer(event.sessionId, event.requestId, { behavior: 'deny', message: REVIEWER_DENIED });
        break;
      case 'result':
        run.lastResult = event.result;
        if (run.failure === undefined && event.result.isError) run.failure = event.result.terminalReason === 'budget_exhausted' ? 'budget' : 'error-result';
        void runtime.end(event.sessionId).catch(() => undefined);
        break;
      case 'exited':
        void this.finish(run);
        break;
      default:
        break;
    }
  }

  private async finish(run: Run): Promise<void> {
    clearTimeout(run.timer);
    this.forget(run);
    await run.checkout.dispose().catch(() => undefined);
    const denied = Math.max(run.denied, run.lastResult?.permissionDenials.length ?? 0);
    this.emitEnded(run.request, { costUsd: run.lastResult?.totalCostUsd ?? 0, ...(run.lastResult === undefined ? {} : { result: run.lastResult }), ...(run.failure === undefined ? {} : { failure: run.failure }), denied });
  }

  private forget(run: Run): void {
    this.runs.delete(run.request.sessionId);
    this.sessionOf.delete(run.request.runId);
  }

  private emitEnded(request: ReviewRunRequest, ended: { costUsd: number; result?: TurnResult; failure?: RunFailure; denied: number }): void {
    this.events.emit({
      type: 'ended',
      runId: request.runId,
      sessionId: request.sessionId,
      costUsd: ended.costUsd,
      ...(ended.result === undefined ? {} : { result: ended.result }),
      ...(ended.failure === undefined ? {} : { failure: ended.failure }),
      deniedRequests: ended.denied,
    });
  }
}
