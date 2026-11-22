import { EventBus, type Unsubscribe } from '../../events/EventBus';
import { REASON_CATALOGUE } from '../reasonCatalogue';
import type { ChangesetId, Reason, RunFailure } from '../schemas';
import { type AssessInput, type CheckExecutor, type CheckOutcomeSet, type CheckRequest, type ReviewerEvent, type ReviewerRuntime, type ReviewRunRequest, type RiskRules } from '../types';

/**
 * The services the manager needs from the capture and the reviewer builders. The module hands the manager these
 * slots, so the services can be connected after the module graph exists. Until then each slot fails closed: a
 * changeset has `check.not_run` and goes to a person, and a reviewer run ends at once with `spawn`.
 */
export interface ReviewPipeline {
  readonly rules: RiskRules;
  readonly checks: CheckExecutor;
  readonly reviewer: ReviewerRuntime;
}

const NOT_CONNECTED = 'the review pipeline is not connected';

export class SwitchableRules implements RiskRules {
  private target: RiskRules | undefined;

  get connected(): boolean {
    return this.target !== undefined;
  }

  connect(rules: RiskRules): void {
    this.target = rules;
  }

  assess(input: AssessInput): Reason[] {
    if (this.target !== undefined) return this.target.assess(input);
    const definition = REASON_CATALOGUE['check.not_run'];
    return [{ id: 'check.not_run', subject: '', source: definition.source, evidence: { why: NOT_CONNECTED }, minRung: definition.rung, hard: definition.hard }];
  }
}

export class SwitchableChecks implements CheckExecutor {
  private target: CheckExecutor | undefined;

  get connected(): boolean {
    return this.target !== undefined;
  }

  connect(checks: CheckExecutor): void {
    this.target = checks;
  }

  async run(request: CheckRequest): Promise<CheckOutcomeSet> {
    if (this.target !== undefined) return this.target.run(request);
    const at = new Date().toISOString();
    return {
      checkpoint: {
        id: `chk_${request.changesetId}`,
        changesetId: request.changesetId,
        target: 'checkpoint',
        commitId: request.checkpointCommit,
        policyHash: request.policyHash,
        command: request.policy.check?.command ?? [],
        outcome: 'not_run',
        notRunReason: NOT_CONNECTED,
        exitCode: null,
        signal: null,
        durationMs: null,
        outputPath: null,
        outputTail: null,
        truncated: false,
        startedAt: at,
        endedAt: at,
      },
    };
  }

  async cancel(changesetId: ChangesetId): Promise<void> {
    await this.target?.cancel(changesetId);
  }
}

/** Forwards to the connected runner and passes its events on to the manager's listener, whichever runner sent them. */
export class SwitchableReviewer implements ReviewerRuntime {
  private target: ReviewerRuntime | undefined;
  private off: Unsubscribe | undefined;
  private readonly events = new EventBus<ReviewerEvent>();

  get connected(): boolean {
    return this.target !== undefined;
  }

  connect(reviewer: ReviewerRuntime): void {
    this.off?.();
    this.target = reviewer;
    this.off = reviewer.subscribe((event) => this.events.emit(event));
  }

  async start(request: ReviewRunRequest): Promise<void> {
    if (this.target !== undefined) return this.target.start(request);
    queueMicrotask(() => this.events.emit({ type: 'ended', runId: request.runId, sessionId: request.sessionId, costUsd: 0, failure: 'spawn', deniedRequests: 0 }));
  }

  async cancel(runId: string, why: RunFailure): Promise<void> {
    await this.target?.cancel(runId, why);
  }

  subscribe(listener: (event: ReviewerEvent) => void): Unsubscribe {
    return this.events.onAny(listener);
  }

  async dispose(): Promise<void> {
    this.off?.();
    await this.target?.dispose();
  }
}

