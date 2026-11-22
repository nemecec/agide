import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureFixture, changesetRecord, policySnapshot, sha256Of } from '../fakes/fixtures';
import { changesetFileSchema, changesetSchema, hunkSchema, type DecisionRecord, type ReviewReport, type ReviewRunRecord } from '../schemas';
import type { ChangesetStore } from '../types';

export interface StoreHarness {
  readonly store: ChangesetStore;
  close(): Promise<void> | void;
}

const T = (minute: number): string => `2026-11-21T10:${String(minute).padStart(2, '0')}:00.000Z`;

/** Behaviour every `ChangesetStore` shows (0040 section 3.3, 0041). */
export function describeChangesetStoreContract(name: string, setup: () => Promise<StoreHarness>, options: { readonly pending?: string } = {}): void {
  const suite = options.pending === undefined ? describe : describe.skip;
  suite(`${name} (ChangesetStore contract)${options.pending === undefined ? '' : ` [pending ${options.pending}]`}`, () => {
    let h: StoreHarness;
    const policy = policySnapshot();
    beforeEach(async () => {
      h = await setup();
      h.store.putPolicy(policy);
    });
    afterEach(async () => {
      await h.close();
    });

    const insert = (seed: string, seq = 1, createdAt = T(0), agent = 'worker') => {
      const rows = changesetRecord(
        captureFixture({ seed, agent, policyHash: policy.hash, files: [{ path: 'src/a.ts', hunks: [' a\n-b\n+c', ' d\n+e'] }, { path: 'src/b.ts', hunks: ['+f'] }] }),
        seq,
        createdAt,
      );
      h.store.insert(rows.changeset, rows.files, rows.hunks);
      return rows.changeset;
    };
    const decision = (changesetId: string, patch: Partial<DecisionRecord>): DecisionRecord => ({
      id: `d_${Math.random().toString(16).slice(2)}`,
      changesetId,
      actor: 'app',
      actorSessionId: null,
      action: 'start_check',
      fromState: 'captured',
      toState: 'checking',
      fromRung: 'A',
      toRung: 'A',
      contentHash: sha256Of(changesetId),
      reason: null,
      createdAt: T(5),
      ...patch,
    });
    const run = (changesetId: string, attempt: 1 | 2, sessionId: string | null): ReviewRunRecord => ({
      id: `run_${changesetId}_${attempt}`,
      changesetId,
      attempt,
      sessionId,
      model: 'haiku',
      effort: 'high',
      promptVersion: 'review-1',
      state: 'running',
      failure: null,
      pid: null,
      reservedUsd: 0.5,
      reportedUsd: 0,
      rejectedCalls: 0,
      queuedAt: T(1),
      startedAt: T(2),
      endedAt: null,
    });

    it('stores a changeset with its files and hunks in order and returns valid records', () => {
      const changeset = insert('one');
      expect(changesetSchema.safeParse(h.store.get(changeset.id)).success, 'the stored changeset parses with the schema').toBe(true);
      const files = h.store.files(changeset.id);
      expect(files.map((file) => file.newPath), 'files in index order').toEqual(['src/a.ts', 'src/b.ts']);
      expect(files.every((file) => changesetFileSchema.safeParse(file).success), 'every file parses').toBe(true);
      const hunks = h.store.hunks(changeset.id);
      expect(hunks.map((hunk) => [hunk.fileIdx, hunk.idx]), 'hunks in file and hunk order').toEqual([[0, 0], [0, 1], [1, 0]]);
      expect(hunks.every((hunk) => hunkSchema.safeParse(hunk).success), 'every hunk parses').toBe(true);
      expect(h.store.hunks(changeset.id, 1).map((hunk) => hunk.body), 'the hunks of one file').toEqual(['+f']);
    });

    it('refuses a used id, a repeated sequence number of an agent and an unknown policy', () => {
      const changeset = insert('one');
      const again = changesetRecord(captureFixture({ seed: 'one', policyHash: policy.hash }), 2);
      expect(() => h.store.insert(again.changeset, again.files, again.hunks), 'a used id').toThrow();
      const sameSeq = changesetRecord(captureFixture({ seed: 'two', policyHash: policy.hash }), changeset.seq);
      expect(() => h.store.insert(sameSeq.changeset, sameSeq.files, sameSeq.hunks), 'the same (swarm, agent, seq)').toThrow();
      const noPolicy = changesetRecord(captureFixture({ seed: 'three', policyHash: sha256Of('missing') }), 3);
      expect(() => h.store.insert(noPolicy.changeset, noPolicy.files, noPolicy.hunks), 'an unknown policy').toThrow();
      expect(h.store.list().length, 'only the first insert is stored').toBe(1);
    });

    it('lists newest first with filters and finds the latest changeset of an agent by sequence', () => {
      insert('one', 1, T(1));
      const second = insert('two', 2, T(2));
      insert('other', 1, T(3), 'helper');
      expect(h.store.list().map((changeset) => changeset.agent), 'newest first').toEqual(['helper', 'worker', 'worker']);
      expect(h.store.list({ agent: 'worker', limit: 1 })[0]?.id, 'agent filter and limit').toBe(second.id);
      expect(h.store.list({ states: ['accepted'] }), 'state filter').toEqual([]);
      expect(h.store.latest('sw1', 'worker')?.id, 'the highest seq of the agent').toBe(second.id);
      expect(h.store.latest('sw1', 'nobody'), 'no changeset').toBeUndefined();
    });

    it('applies a decision only from the state and rung it names, and records it', () => {
      const changeset = insert('one');
      const moved = h.store.applyDecision(decision(changeset.id, {}), { state: 'checking', rung: 'A', floor: 'A' });
      expect(moved?.state, 'the update applied').toBe('checking');
      expect(moved?.updatedAt, 'updatedAt is the decision time').toBe(T(5));
      const stale = h.store.applyDecision(decision(changeset.id, {}), { state: 'checking', rung: 'A', floor: 'A' });
      expect(stale, 'a decision from a state the changeset left writes nothing').toBeUndefined();
      expect(h.store.decisions(changeset.id).map((row) => row.action), 'one decision row').toEqual(['start_check']);
      const raised = h.store.applyDecision(decision(changeset.id, { action: 'assess', fromState: 'checking', toState: 'assessed', toRung: 'C' }), { state: 'assessed', rung: 'C', floor: 'B' });
      expect([raised?.rung, raised?.floor], 'rung and floor written').toEqual(['C', 'B']);
      expect(
        () => h.store.applyDecision(decision(changeset.id, { action: 'demote', fromState: 'assessed', toState: 'assessed', fromRung: 'C', toRung: 'A' }), { state: 'assessed', rung: 'A', floor: 'B' }),
        'a rung below the floor is refused',
      ).toThrow();
      expect(h.store.get(changeset.id)?.rung, 'the refused update wrote nothing').toBe('C');
    });

    it('keeps the first row of a reason per id and subject and returns only the added rows', () => {
      const changeset = insert('one');
      const reason = { id: 'file.binary', subject: 'a.png', source: 'rule' as const, evidence: { size: 1 }, minRung: 'B' as const, hard: false };
      expect(h.store.addReasons(changeset.id, [reason], T(1)).length, 'the first add').toBe(1);
      const again = h.store.addReasons(changeset.id, [{ ...reason, minRung: 'C' }, { ...reason, subject: 'b.png' }], T(2));
      expect(again.map((row) => row.subject), 'only the new subject is added').toEqual(['b.png']);
      expect(h.store.reasons(changeset.id).find((row) => row.subject === 'a.png'), 'the first row stays').toMatchObject({ minRung: 'B', createdAt: T(1) });
    });

    it('stores checks per changeset and finds the shared base run by commit and policy', () => {
      const changeset = insert('one');
      const base = {
        id: 'chk_base',
        changesetId: null,
        target: 'base' as const,
        commitId: changeset.baseCommit,
        policyHash: policy.hash,
        command: ['pnpm', 'test'],
        outcome: 'failed' as const,
        notRunReason: null,
        exitCode: 1,
        signal: null,
        durationMs: 10,
        outputPath: null,
        outputTail: 'boom',
        truncated: false,
        startedAt: T(1),
        endedAt: T(2),
      };
      h.store.putCheck(base);
      h.store.putCheck({ ...base, id: 'chk_cp', changesetId: changeset.id, target: 'checkpoint', commitId: changeset.checkpointCommit });
      expect(h.store.checks(changeset.id).map((check) => check.id), 'the checkpoint run of the changeset').toEqual(['chk_cp']);
      expect(h.store.baseCheck(changeset.baseCommit, policy.hash)?.id, 'the base run').toBe('chk_base');
      expect(h.store.baseCheck(changeset.baseCommit, sha256Of('other')), 'another policy has no base run').toBeUndefined();
    });

    it('finds the latest base run of a pair, so a base that turned green is the one that is reused', () => {
      const changeset = insert('one');
      const red = { id: 'chk_red', changesetId: null, target: 'base' as const, commitId: changeset.baseCommit, policyHash: policy.hash, command: ['pnpm', 'test'], outcome: 'failed' as const, notRunReason: null, exitCode: 1, signal: null, durationMs: 10, outputPath: null, outputTail: 'boom', truncated: false, startedAt: T(1), endedAt: T(2) };
      h.store.putCheck(red);
      h.store.putCheck({ ...red, id: 'chk_green', outcome: 'passed', exitCode: 0, outputTail: '', startedAt: T(3), endedAt: T(4) });
      expect(h.store.baseCheck(changeset.baseCommit, policy.hash)?.id, 'the green run that followed the red one').toBe('chk_green');
      h.store.putCheck(red);
      expect(h.store.baseCheck(changeset.baseCommit, policy.hash)?.id, 'a run that is stored again keeps its place').toBe('chk_green');
    });

    it('keeps one run per attempt and session, and one report per run', () => {
      const changeset = insert('one');
      h.store.putRun(run(changeset.id, 1, 'rev-1'));
      expect(() => h.store.putRun({ ...run(changeset.id, 1, 'rev-x'), id: 'other' }), 'a second run of attempt 1').toThrow();
      expect(() => h.store.putRun({ ...run(changeset.id, 2, 'rev-1') }), 'a session in two runs').toThrow();
      h.store.putRun({ ...run(changeset.id, 1, 'rev-1'), state: 'reported' });
      expect(h.store.runBySession('rev-1')?.state, 'a run is updated in place by id').toBe('reported');
      expect(h.store.run(`run_${changeset.id}_1`)?.promptVersion, 'the prompt version is kept').toBe('review-1');
      const report: ReviewReport = {
        id: 'rep_1',
        runId: `run_${changeset.id}_1`,
        changesetId: changeset.id,
        verdict: 'accept',
        escalateTo: null,
        claimCheck: 'confirmed',
        summary: 'fine',
        findings: [],
        droppedFindings: 0,
        receivedAt: T(3),
      };
      h.store.putReport(report);
      expect(() => h.store.putReport({ ...report, id: 'rep_2' }), 'a second report of the run').toThrow();
      expect(h.store.reports(changeset.id).map((row) => row.id), 'one report').toEqual(['rep_1']);
    });

    it('marks only draft comments sent and deletes a comment', () => {
      const changeset = insert('one');
      const comment = { id: 'c1', changesetId: changeset.id, fileIdx: 0, side: 'new' as const, line: 1, hunkHash: sha256Of('h'), body: 'why?', state: 'draft' as const, sentIn: null, createdAt: T(1) };
      h.store.putComment(comment);
      h.store.putComment({ ...comment, id: 'c2', createdAt: T(2) });
      h.store.markSent(['c1'], 'd_send');
      expect(h.store.comments(changeset.id).map((row) => [row.id, row.state, row.sentIn]), 'c1 sent, c2 draft').toEqual([
        ['c1', 'sent', 'd_send'],
        ['c2', 'draft', null],
      ]);
      expect(h.store.deleteComment('c2'), 'delete answers true').toBe(true);
      expect(h.store.comment('c2'), 'the comment is gone').toBeUndefined();
    });

    it('replaces a seen mark of the same scope, level and hash and lists marks per scope', () => {
      const changeset = insert('one');
      const mark = { scope: 'sw1/worker', level: 'hunk' as const, subjectHash: sha256Of('h'), changesetId: changeset.id, how: 'dwell' as const, seenAt: T(1) };
      h.store.putSeen(mark);
      h.store.putSeen({ ...mark, how: 'marked', seenAt: T(2) });
      h.store.putSeen({ ...mark, scope: 'sw1/helper' });
      expect(h.store.seen('sw1/worker'), 'one mark, the latest').toEqual([{ ...mark, how: 'marked', seenAt: T(2) }]);
    });

    it('returns copies, so a caller cannot change stored rows', () => {
      const changeset = insert('one');
      const read = h.store.get(changeset.id) as { state: string };
      read.state = 'accepted';
      expect(h.store.get(changeset.id)?.state, 'the stored state is unchanged').toBe('captured');
      expect(h.store.policy(policy.hash)?.hash, 'the policy is stored').toBe(policy.hash);
    });
  });
}
