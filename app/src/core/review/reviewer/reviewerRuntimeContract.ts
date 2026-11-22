import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InMemoryAgentRuntime } from '../../swarm/runtime/InMemoryAgentRuntime';
import { changesetIdOf, sha1Of } from '../fakes/fixtures';
import type { ReviewRunRequest, ReviewerEvent, ReviewerRuntime } from '../types';
import { REPORT_REVIEW_TOOL } from './InMemoryReviewerRuntime';

/**
 * What the suite gets per test: the reviewer runtime over the in-memory agent runtime, the step script each run
 * gets as its first message, and the report calls that reached the app.
 */
export interface ReviewerHarness {
  readonly reviewer: ReviewerRuntime;
  readonly agents: InMemoryAgentRuntime;
  setScript(script: (request: ReviewRunRequest) => string): void;
  readonly reportCalls: { sessionId: string; input: Record<string, unknown> }[];
  close(): Promise<void>;
}

let counter = 0;
export function runRequest(patch: Partial<ReviewRunRequest> = {}): ReviewRunRequest {
  counter += 1;
  return {
    runId: `run_${counter}`,
    changesetId: changesetIdOf(`reviewer-${counter}`),
    swarmId: 'sw1',
    agent: 'worker',
    attempt: 1,
    sessionId: `reviewer-session-${counter}`,
    folderId: 'folder-1',
    tier: 'strong',
    effort: 'high',
    rung: 'B',
    reservationUsd: 0.5,
    maxTurns: 30,
    timeoutMinutes: 15,
    commonDir: '/repo/.git',
    baseCommit: sha1Of('base'),
    checkpointCommit: sha1Of('checkpoint'),
    task: 'Add a feature.',
    files: [],
    hunks: [],
    reasons: [],
    claim: { source: 'result', text: 'Added the feature.' },
    ...patch,
  };
}

/** Behaviour every `ReviewerRuntime` shows (0040 section 10). */
export function describeReviewerRuntimeContract(name: string, setup: () => Promise<ReviewerHarness>, options: { readonly pending?: string } = {}): void {
  const suite = options.pending === undefined ? describe : describe.skip;
  suite(`${name} (ReviewerRuntime contract)${options.pending === undefined ? '' : ` [pending ${options.pending}]`}`, () => {
    let h: ReviewerHarness;
    let events: ReviewerEvent[];
    beforeEach(async () => {
      h = await setup();
      events = [];
      h.reviewer.subscribe((event) => events.push(event));
    });
    afterEach(async () => {
      await h.close();
    });

    const ended = async (runId: string): Promise<Extract<ReviewerEvent, { type: 'ended' }>> => {
      const deadline = Date.now() + 3_000;
      for (;;) {
        const found = events.find((event): event is Extract<ReviewerEvent, { type: 'ended' }> => event.type === 'ended' && event.runId === runId);
        if (found !== undefined) return found;
        if (Date.now() > deadline) throw new Error(`run ${runId} did not end; events ${JSON.stringify(events)}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    it('launches one read-only session per run with the report tool allowed and no connectors', async () => {
      h.setScript(() => '/text looked');
      const request = runRequest();
      await h.reviewer.start(request);
      await ended(request.runId);
      const spec = h.agents.launches.find((launch) => launch.sessionId === request.sessionId);
      expect(spec, 'a launch for the run session').toBeDefined();
      expect(spec?.tools, 'built-in tools').toEqual(['Read', 'Grep', 'Glob']);
      expect(spec?.allowedTools, 'allowed tools').toEqual([REPORT_REVIEW_TOOL]);
      expect([spec?.toolSet, spec?.autoDeny, spec?.connectors], 'tool set, automatic denial and no connectors').toEqual(['reviewer', true, false]);
      expect(spec?.maxBudgetUsd, 'the reservation is the process budget').toBe(request.reservationUsd);
    });

    it('passes the report call to the app and reports the end with the cost', async () => {
      h.setScript((request) => `/tool ${REPORT_REVIEW_TOOL} {"changesetId":"${request.changesetId}","verdict":"accept"}\n/cost 0.12\n/text done`);
      const request = runRequest();
      await h.reviewer.start(request);
      const end = await ended(request.runId);
      expect(h.reportCalls.map((call) => [call.sessionId, call.input['verdict']]), 'one report call from the run session').toEqual([[request.sessionId, 'accept']]);
      expect([end.costUsd, end.failure, end.deniedRequests], 'cost, no failure, no denials').toEqual([0.12, undefined, 0]);
      expect(events.filter((event) => event.runId === request.runId).map((event) => event.type), 'started then ended').toEqual(['started', 'ended']);
    });

    it('denies every other tool request at once and counts it', async () => {
      h.setScript(() => '/tool Bash {"command":"rm -rf /"}\n/tool Write {"file_path":"x"}\n/text tried');
      const request = runRequest();
      await h.reviewer.start(request);
      const end = await ended(request.runId);
      expect(end.deniedRequests, 'both requests denied').toBe(2);
      expect(end.result?.permissionDenials.length, 'the CLI saw the denials').toBe(2);
    });

    it('ends a cancelled run with the given failure and a failed turn with error-result', async () => {
      h.setScript(() => '/sleep 10000');
      const slow = runRequest();
      await h.reviewer.start(slow);
      await h.reviewer.cancel(slow.runId, 'superseded');
      expect((await ended(slow.runId)).failure, 'cancelled').toBe('superseded');
      h.setScript(() => '/fail api_error');
      const failing = runRequest();
      await h.reviewer.start(failing);
      expect((await ended(failing.runId)).failure, 'error result').toBe('error-result');
    });
  });
}
