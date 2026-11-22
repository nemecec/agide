import { randomBytes } from 'node:crypto';
import type { Caller } from '../../commands/types';
import { anchorOf } from '../anchors';
import type { ReportOutcomeInput, ReportReviewInput, ReviewReport, ReviewRunRecord, StoredFinding } from '../schemas';
import { ReviewError, type ChangesetStore, type ReviewCaller, type ReviewSwarmFacts } from '../types';

/** The call that stores the findings that do not anchor; the two before it are sent back to the reviewer (0040 section 10.4). */
export const UNANCHORED_LIMIT = 3;

export interface ReportDeskDeps {
  readonly store: ChangesetStore;
  readonly facts: Pick<ReviewSwarmFacts, 'agentOf'>;
  /** Called once per stored report, after the report and the run row are written; the manager applies its effects. */
  readonly onStored?: (report: ReviewReport, run: ReviewRunRecord) => void;
  /** Called for a `report_outcome` of a swarm agent with a worktree; the manager keeps it as the claim of the next capture. */
  readonly recordOutcome?: (agent: { readonly swarmId: string; readonly agent: string }, input: ReportOutcomeInput) => void;
  readonly clock?: () => string;
}

/**
 * The two report tools (0040 sections 10.4, 11.1 and 11.2). `report_review` is valid only from the session of the
 * running review run of the changeset it names and only once; its findings are anchored to lines of the diff.
 * The desk reads and writes the run, report and changeset rows through the store and decides nothing about states.
 */
export class ReportDesk {
  private readonly clock: () => string;

  constructor(private readonly deps: ReportDeskDeps) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
  }

  reportReview(input: ReportReviewInput, caller: ReviewCaller): { readonly stored: true; readonly findings: number } {
    const { store } = this.deps;
    if (caller.kind === 'ui') throw new ReviewError('out_of_scope', 'report_review is for the reviewer of a running review');
    const run = store.runBySession(caller.sessionId);
    if (run === undefined || run.changesetId !== input.changesetId) throw new ReviewError('out_of_scope', 'this session does not review that changeset');
    if (store.reports(run.changesetId).some((report) => report.runId === run.id)) throw new ReviewError('refused', 'already reported');
    if (run.state !== 'running') throw new ReviewError('out_of_scope', 'the review run has ended');
    const files = store.files(run.changesetId);
    const hunks = store.hunks(run.changesetId);
    const anchored: StoredFinding[] = [];
    const unanchored: string[] = [];
    for (const finding of input.findings) {
      const anchor = anchorOf(files, hunks, finding);
      if (anchor === undefined) unanchored.push(`${finding.path}:${finding.line} (${finding.side})`);
      else anchored.push({ idx: anchored.length, ...anchor, side: finding.side, line: finding.line, severity: finding.severity, title: finding.title, body: finding.body });
    }
    if (unanchored.length > 0 && run.rejectedCalls + 1 < UNANCHORED_LIMIT) {
      store.putRun({ ...run, rejectedCalls: run.rejectedCalls + 1 });
      throw new ReviewError('invalid_input', `These findings do not point at a line of the diff: ${unanchored.join(', ')}. Correct them and call report_review again.`);
    }
    const report: ReviewReport = {
      id: `rep_${randomBytes(8).toString('hex')}`,
      runId: run.id,
      changesetId: run.changesetId,
      verdict: input.verdict,
      escalateTo: input.escalateTo ?? null,
      claimCheck: input.claimCheck,
      summary: input.summary,
      findings: anchored,
      droppedFindings: unanchored.length,
      receivedAt: this.clock(),
    };
    store.putReport(report);
    const ended = { ...run, state: 'reported' as const, endedAt: this.clock() };
    store.putRun(ended);
    this.deps.onStored?.(report, ended);
    return { stored: true, findings: anchored.length };
  }

  reportOutcome(input: ReportOutcomeInput, caller: ReviewCaller): { readonly recorded: true; readonly appliesTo: string } {
    if (caller.kind !== 'session') throw new ReviewError('out_of_scope', 'report_outcome is for swarm agents with a worktree');
    const agent = this.deps.facts.agentOf(caller.sessionId);
    if (agent === undefined || agent.workspace !== 'worktree') throw new ReviewError('out_of_scope', 'report_outcome is for swarm agents with a worktree');
    this.deps.recordOutcome?.({ swarmId: agent.swarmId, agent: agent.agent }, input);
    return { recorded: true, appliesTo: 'the next capture of your work' };
  }
}

/**
 * The command handlers of the two tools. The MCP caller is identified by the bearer token of its request, so
 * `sessionId` is the session's own; the desk decides from the run rows whether it is a reviewer. A reviewer's call
 * and a worker's call arrive as the same caller kind, and the tool set of the grant keeps the wrong one from listing the tool.
 */
export function reportHandlers(desk: ReportDesk): {
  readonly report_review: (input: ReportReviewInput, caller: Caller) => unknown;
  readonly report_outcome: (input: ReportOutcomeInput, caller: Caller) => unknown;
} {
  const asReviewCaller = (caller: Caller): ReviewCaller => (caller.kind === 'ui' ? { kind: 'ui' } : { kind: 'session', sessionId: caller.sessionId, folderId: caller.folderId });
  return {
    report_review: (input, caller) => desk.reportReview(input, asReviewCaller(caller)),
    report_outcome: (input, caller) => desk.reportOutcome(input, asReviewCaller(caller)),
  };
}
