import { beforeEach, describe, expect, it } from 'vitest';
import { captureFixture, changesetRecord, policySnapshot } from '../fakes/fixtures';
import { InMemorySwarmFacts } from '../fakes/fakes';
import type { ReportReviewInput, ReviewReport, ReviewRunRecord } from '../schemas';
import { InMemoryChangesetStore } from '../store/InMemoryChangesetStore';
import { ReviewError, type ReviewCaller } from '../types';
import { ReportDesk, UNANCHORED_LIMIT } from './reportDesk';

const POLICY = policySnapshot();
const REVIEWER_SESSION = 'reviewer-session-1';
const OTHER_SESSION = 'reviewer-session-2';

let store: InMemoryChangesetStore;
let facts: InMemorySwarmFacts;
let stored: { report: ReviewReport; run: ReviewRunRecord }[];
let desk: ReportDesk;
let outcomes: unknown[];
let csId: string;
let otherCsId: string;

const runRecord = (id: string, changesetId: string, sessionId: string): ReviewRunRecord => ({
  id,
  changesetId,
  attempt: 1,
  sessionId,
  model: 'haiku',
  effort: 'low',
  promptVersion: 'v',
  state: 'running',
  failure: null,
  pid: 1,
  reservedUsd: 0.5,
  reportedUsd: 0,
  rejectedCalls: 0,
  queuedAt: '2026-11-21T10:00:00.000Z',
  startedAt: '2026-11-21T10:00:01.000Z',
  endedAt: null,
});

const reviewer = (sessionId = REVIEWER_SESSION): ReviewCaller => ({ kind: 'reviewer', sessionId });

const input = (patch: Partial<ReportReviewInput> = {}): ReportReviewInput => ({
  changesetId: csId,
  verdict: 'accept',
  claimCheck: 'confirmed',
  summary: 'looks right',
  findings: [],
  ...patch,
});

const onNew = (line: number, patch: Partial<ReportReviewInput['findings'][number]> = {}): ReportReviewInput['findings'][number] => ({ path: 'src/a.ts', line, side: 'new', severity: 'major', title: 'finding', body: '', ...patch });

beforeEach(() => {
  store = new InMemoryChangesetStore();
  facts = new InMemorySwarmFacts();
  stored = [];
  outcomes = [];
  store.putPolicy(POLICY);
  for (const [seed, run, session] of [
    ['one', 'run_1', REVIEWER_SESSION],
    ['two', 'run_2', OTHER_SESSION],
  ] as const) {
    const capture = captureFixture({ seed, agent: `agent-${seed}`, policyHash: POLICY.hash });
    const { changeset, files, hunks } = changesetRecord(capture);
    store.insert(changeset, files, hunks);
    store.putRun(runRecord(run, capture.id, session));
    if (seed === 'one') csId = capture.id;
    else otherCsId = capture.id;
  }
  facts.addSwarm('sw1', { folderId: 'folder-1' });
  facts.addAgent('sw1', { name: 'worker', sessionId: 'worker-session' });
  facts.addAgent('sw1', { name: 'scratcher', sessionId: 'scratch-session', workspace: 'scratch' });
  desk = new ReportDesk({ store, facts, onStored: (report, run) => stored.push({ report, run }), recordOutcome: (agent, value) => outcomes.push([agent, value]) });
});

describe('report_review scope', () => {
  it('stores a report from the session of the running run for its own changeset', () => {
    const result = desk.reportReview(input({ findings: [onNew(2)] }), reviewer());
    expect(result, 'one anchored finding stored').toEqual({ stored: true, findings: 1 });
    expect(store.reports(csId).map((report) => report.runId), 'the report belongs to the run').toEqual(['run_1']);
    expect(store.run('run_1')?.state, 'the run is marked reported').toBe('reported');
    expect(stored.length, 'the manager hook ran once').toBe(1);
  });

  it('refuses a session that is the reviewer of another changeset', () => {
    expect(() => desk.reportReview(input({ changesetId: otherCsId }), reviewer()), 'the call names the changeset of another run').toThrow(expect.objectContaining({ code: 'out_of_scope' }));
    expect(() => desk.reportReview(input(), reviewer(OTHER_SESSION)), 'the other reviewer names this changeset').toThrow(expect.objectContaining({ code: 'out_of_scope' }));
    expect(store.reports(csId), 'nothing was stored').toEqual([]);
  });

  it('refuses a session that is not a reviewer, such as the working agent', () => {
    expect(() => desk.reportReview(input(), { kind: 'session', sessionId: 'worker-session', folderId: 'folder-1' }), 'the working agent session').toThrow(expect.objectContaining({ code: 'out_of_scope' }));
    expect(() => desk.reportReview(input(), { kind: 'ui' }), 'the UI').toThrow(expect.objectContaining({ code: 'out_of_scope' }));
  });

  it('accepts one report per run', () => {
    desk.reportReview(input(), reviewer());
    expect(() => desk.reportReview(input(), reviewer()), 'the second call').toThrow(expect.objectContaining({ code: 'refused' }));
    expect(store.reports(csId).length, 'still one report').toBe(1);
  });

  it('refuses a report when the run has ended', () => {
    store.putRun({ ...store.run('run_1')!, state: 'failed', failure: 'timeout' });
    expect(() => desk.reportReview(input(), reviewer()), 'a failed run').toThrow(expect.objectContaining({ code: 'out_of_scope' }));
  });
});

describe('report_review anchoring', () => {
  it('sends unanchored findings back to the reviewer and counts the rejected call', () => {
    const call = () => desk.reportReview(input({ findings: [onNew(2), onNew(999), onNew(1, { path: 'src/elsewhere.ts' })] }), reviewer());
    expect(call, 'first call').toThrow(expect.objectContaining({ code: 'invalid_input', message: expect.stringContaining('src/a.ts:999') }));
    expect(store.run('run_1')?.rejectedCalls, 'one rejected call counted').toBe(1);
    expect(store.reports(csId), 'nothing stored yet').toEqual([]);
  });

  it('stores the anchored findings and counts the dropped ones on the last allowed call', () => {
    const bad = input({ findings: [onNew(2), onNew(999)] });
    for (let attempt = 1; attempt < UNANCHORED_LIMIT; attempt += 1) expect(() => desk.reportReview(bad, reviewer()), `call ${attempt} is sent back`).toThrow(ReviewError);
    const result = desk.reportReview(bad, reviewer());
    expect(result.findings, 'only the anchored finding is stored').toBe(1);
    expect(store.reports(csId)[0]?.droppedFindings, 'the unanchored finding is counted').toBe(1);
  });

  it('anchors added and context lines on the new side and removed lines on the old side', () => {
    // The fixture hunk is: ` keep` (line 1), `-old one` (old line 2), `+new one` (new line 2).
    desk.reportReview(input({ findings: [onNew(1), onNew(2), onNew(2, { side: 'old' })] }), reviewer());
    const findings = store.reports(csId)[0]!.findings;
    expect(findings.map((found) => [found.side, found.line, found.onChangedLine]), 'context, added and removed lines').toEqual([
      ['new', 1, false],
      ['new', 2, true],
      ['old', 2, true],
    ]);
  });

  it('refuses a finding on the old side at a line that was not removed', () => {
    expect(() => desk.reportReview(input({ findings: [onNew(5, { side: 'old' })] }), reviewer()), 'old line 5 is not in the hunk').toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('accepts a path that is the old or the new path of a renamed file', () => {
    const capture = captureFixture({ seed: 'rename', agent: 'agent-rename', policyHash: POLICY.hash, files: [{ path: 'src/new.ts', hunks: [' keep\n+added'] }] });
    const { changeset, files, hunks } = changesetRecord(capture);
    const renamed = files.map((file) => ({ ...file, status: 'R' as const, oldPath: 'src/old.ts' }));
    store.insert(changeset, renamed, hunks);
    store.putRun(runRecord('run_3', capture.id, 'reviewer-session-3'));
    const result = desk.reportReview(input({ changesetId: capture.id, findings: [onNew(2, { path: 'src/old.ts' })] }), reviewer('reviewer-session-3'));
    expect(result.findings, 'the old path anchors').toBe(1);
  });

  it('refuses any anchor in a file marked large', () => {
    const capture = captureFixture({ seed: 'large', agent: 'agent-large', policyHash: POLICY.hash });
    const { changeset, files, hunks } = changesetRecord(capture);
    store.insert(changeset, files.map((file) => ({ ...file, kind: 'large' as const })), hunks);
    store.putRun(runRecord('run_4', capture.id, 'reviewer-session-4'));
    expect(() => desk.reportReview(input({ changesetId: capture.id, findings: [onNew(2)] }), reviewer('reviewer-session-4')), 'a large file takes no anchors').toThrow(expect.objectContaining({ code: 'invalid_input' }));
  });
});

describe('report_outcome scope', () => {
  const outcome = { summary: 'done', confidence: 'high' as const, testsRun: [], unverified: [] };

  it('records the outcome of a swarm agent with a worktree', () => {
    expect(desk.reportOutcome(outcome, { kind: 'session', sessionId: 'worker-session', folderId: 'folder-1' }), 'recorded').toEqual({ recorded: true, appliesTo: 'the next capture of your work' });
    expect(outcomes, 'the manager hook got the agent and the input').toEqual([[{ swarmId: 'sw1', agent: 'worker' }, outcome]]);
  });

  it('refuses a reviewer session, a scratch agent, an unknown session and the UI', () => {
    for (const caller of [reviewer(), { kind: 'session', sessionId: 'scratch-session', folderId: 'folder-1' }, { kind: 'session', sessionId: 'nobody', folderId: 'folder-1' }, { kind: 'ui' }] as ReviewCaller[])
      expect(() => desk.reportOutcome(outcome, caller), `caller ${JSON.stringify(caller)}`).toThrow(expect.objectContaining({ code: 'out_of_scope' }));
    expect(outcomes, 'nothing recorded').toEqual([]);
  });
});
