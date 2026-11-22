import { afterEach, describe, expect, it } from 'vitest';
import { catalogueReason, FakeReviewBudget } from '../fakes/fakes';
import { captureFixture, changesetRecord, policySnapshot } from '../fakes/fixtures';
import { reviewPolicySchema } from '../policy/schema';
import type { ChangesetRecord, ChangesetState, CheckRecord, DecisionRecord } from '../schemas';
import { openStore, type Database } from '../../store/Store';
import type { ReviewCaller, ReviewRunRequest } from '../types';
import { reportStep } from './reviewManagerContract';
import { persistentRig, type PersistentRig } from './persistentRig';

const UI: ReviewCaller = { kind: 'ui' };
const WORKER: ReviewCaller = { kind: 'session', sessionId: 'session-worker', folderId: 'folder-user' };
const NO_CHECK = policySnapshot(reviewPolicySchema.parse({ version: 1 }), 'persistent-none');
const WITH_CHECK = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } }), 'persistent-check');
const T = '2026-11-21T09:00:00.000Z';

let rigs: PersistentRig[] = [];
let dbs: Database[] = [];
afterEach(async () => {
  for (const rig of rigs) await rig.stop();
  for (const db of dbs) db.close();
  rigs = [];
  dbs = [];
});

/** Ends a rig the way a quit or a crash would and forgets it, so the next `open` on the database is the restart. */
async function end(rig: PersistentRig, how: 'quit' | 'crash'): Promise<void> {
  if (how === 'quit') await rig.stop();
  else await rig.crash();
  rigs = rigs.filter((candidate) => candidate !== rig);
}

const database = (): Database => {
  const db = openStore(':memory:');
  dbs.push(db);
  return db;
};
/** Times that only increase, shared by the managers of one test so a restart never looks earlier than what it follows. */
const counterClock = (): (() => string) => {
  let at = Date.parse('2026-11-21T10:00:00.000Z');
  return () => new Date((at += 1_000)).toISOString();
};

const rigWithRepo = (repo: NonNullable<Parameters<typeof persistentRig>[1]>['repo']): PersistentRig => {
  const rig = persistentRig(database(), { repo });
  rig.store.putPolicy(NO_CHECK);
  rig.store.putPolicy(WITH_CHECK);
  rigs.push(rig);
  return rig;
};

const open = (db: Database, budget?: FakeReviewBudget, clock?: () => string): PersistentRig => {
  const rig = persistentRig(db, { ...(budget === undefined ? {} : { budget }), ...(clock === undefined ? {} : { clock }) });
  rig.store.putPolicy(NO_CHECK);
  rig.store.putPolicy(WITH_CHECK);
  rigs.push(rig);
  return rig;
};

async function until(rig: PersistentRig, id: string, check: (changeset: ChangesetRecord) => boolean, what: string): Promise<ChangesetRecord> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const found = rig.store.get(id)!;
    if (check(found)) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}; ${found.state} at ${found.rung}; decisions ${rig.store.decisions(id).map((decision) => decision.action).join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const reach = (rig: PersistentRig, id: string, state: ChangesetState) => until(rig, id, (changeset) => changeset.state === state, state);

/** A stored changeset in the state a crash would have left it in. */
function leave(rig: PersistentRig, seed: string, state: ChangesetState, policyHash = NO_CHECK.hash, agent = 'worker'): ChangesetRecord {
  const rows = changesetRecord(captureFixture({ seed, agent, policyHash }), 1, T);
  rig.store.insert({ ...rows.changeset, state, rung: state === 'in_review' ? 'B' : 'A' }, rows.files, rows.hunks);
  if (state === 'in_review') rig.store.addReasons(rows.changeset.id, [catalogueReason('check.none', { minRung: 'B' })], T);
  return rig.store.get(rows.changeset.id)!;
}
const runRow = (changesetId: string, attempt: 1 | 2, state: 'running' | 'failed', failure: 'no-report' | null = null) => ({
  id: `run_${changesetId}_${attempt}`,
  changesetId,
  attempt,
  sessionId: `review-${changesetId}-${attempt}`,
  model: 'haiku',
  effort: 'high',
  promptVersion: null,
  state,
  failure,
  pid: null,
  reservedUsd: 0.5,
  reportedUsd: 0,
  rejectedCalls: 0,
  queuedAt: T,
  startedAt: T,
  endedAt: state === 'running' ? null : T,
});

describe('persistent review manager across a restart', () => {
  it('keeps a demotion: after the restart only reasons created later count above the demoted rung', async () => {
    const db = database();
    const clock = counterClock();
    const first = open(db, undefined, clock);
    first.facts.setState('sw1', 'worker', 'done');
    first.rules.set('worker', [catalogueReason('config.git', { subject: '.gitattributes' })]);
    const unit = captureFixture({ seed: 'floor', policyHash: NO_CHECK.hash });
    await first.manager.submit(unit);
    await reach(first, unit.id, 'awaiting_human');
    const ask = await first.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the attributes file is ours' }, UI);
    if (ask.committed) throw new Error('expected a token');
    await first.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the attributes file is ours', confirmToken: ask.confirmToken }, UI);
    await end(first, 'quit');

    const second = open(db, undefined, clock);
    const raised = await second.manager.requestEscalation({ changesetId: unit.id, toRung: 'D', reason: 'touches auth' }, { ...WORKER, sessionId: 'session-worker' });
    expect([raised.rung, raised.floor], 'the hard reason before the demotion no longer lifts the rung to E').toEqual(['D', 'C']);
  });

  it('forgets a confirmation token with the process, so a demotion below the floor asks again', async () => {
    const db = database();
    const first = open(db);
    first.rules.set('worker', [catalogueReason('config.git', { subject: '.gitattributes' })]);
    const unit = captureFixture({ seed: 'token', policyHash: NO_CHECK.hash });
    await first.manager.submit(unit);
    await reach(first, unit.id, 'awaiting_human');
    const ask = await first.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the attributes file is ours' }, UI);
    if (ask.committed) throw new Error('expected a token');
    await end(first, 'quit');
    const second = open(db);
    await expect(second.manager.demote({ changesetId: unit.id, toRung: 'C', reason: 'the attributes file is ours', confirmToken: ask.confirmToken }, UI), 'a token from before the restart').rejects.toMatchObject({ code: 'refused' });
    expect(second.store.get(unit.id)?.rung, 'nothing changed').toBe('E');
  });

  it('ends a reviewer run a crash cut short as app-exit and starts the second run, which can accept', async () => {
    const db = database();
    const crashed = open(db);
    const unit = leave(crashed, 'crash-review', 'in_review');
    crashed.store.putRun(runRow(unit.id, 1, 'running'));
    await end(crashed, 'crash');

    const restarted = open(db);
    restarted.setReviewer((request: ReviewRunRequest) => reportStep(request.changesetId));
    await restarted.manager.recover();
    await reach(restarted, unit.id, 'accepted');
    expect(restarted.store.runs(unit.id).map((run) => [run.attempt, run.state, run.failure]), 'the first run failed with the app, the second reported').toEqual([
      [1, 'failed', 'app-exit'],
      [2, 'reported', null],
    ]);
  });

  it('applies a report the crash stored before the changeset moved', async () => {
    const db = database();
    const crashed = open(db);
    const unit = leave(crashed, 'crash-reported', 'in_review');
    crashed.store.putRun({ ...runRow(unit.id, 1, 'running'), state: 'reported', endedAt: T });
    crashed.store.putReport({ id: 'rep_crash', runId: `run_${unit.id}_1`, changesetId: unit.id, verdict: 'accept', escalateTo: null, claimCheck: 'confirmed', summary: 'fine', findings: [], droppedFindings: 0, receivedAt: T });
    await end(crashed, 'crash');
    const restarted = open(db);
    await restarted.manager.recover();
    const after = await reach(restarted, unit.id, 'accepted');
    expect(restarted.store.decisions(after.id).at(-1)?.action, 'the stored report decided, no second run').toBe('report');
    expect(restarted.store.runs(unit.id).length, 'no new run').toBe(1);
  });

  it('retries a review a clean quit cancelled, since the run ended with the app', async () => {
    const db = database();
    const quitting = open(db);
    const unit = leave(quitting, 'quit-review', 'in_review');
    quitting.store.putRun(runRow(unit.id, 1, 'running'));
    await end(quitting, 'quit');
    expect(db.prepare('SELECT state, failure FROM review_runs').get(), 'the quit recorded the run as cancelled with the app').toMatchObject({ state: 'cancelled', failure: 'app-exit' });

    const restarted = open(db);
    restarted.setReviewer((request) => reportStep(request.changesetId));
    await restarted.manager.recover();
    await reach(restarted, unit.id, 'accepted');
    expect(restarted.store.runs(unit.id).length, 'the interrupted run counted as an attempt and a second ran').toBe(2);
  });

  it('waits for the user with reviewer.no_report when the second run was the one cut short', async () => {
    const db = database();
    const crashed = open(db);
    const unit = leave(crashed, 'crash-second', 'in_review');
    crashed.store.putRun(runRow(unit.id, 1, 'failed', 'no-report'));
    crashed.store.putRun(runRow(unit.id, 2, 'running'));
    await end(crashed, 'crash');

    const restarted = open(db);
    await restarted.manager.recover();
    const waiting = await reach(restarted, unit.id, 'awaiting_human');
    expect(restarted.store.reasons(waiting.id).map((reason) => reason.id), 'the reason names the failed runs').toContain('reviewer.no_report');
    expect(restarted.agents.launches.length, 'no third run').toBe(0);
  });

  it('turns a running check into not_run and runs the check again', async () => {
    const db = database();
    const crashed = open(db);
    const unit = leave(crashed, 'crash-check', 'checking', WITH_CHECK.hash);
    const running: CheckRecord = {
      id: 'chk_old',
      changesetId: unit.id,
      target: 'checkpoint',
      commitId: unit.checkpointCommit,
      policyHash: WITH_CHECK.hash,
      command: ['pnpm', 'test'],
      outcome: 'running',
      notRunReason: null,
      exitCode: null,
      signal: null,
      durationMs: null,
      outputPath: null,
      outputTail: null,
      truncated: false,
      startedAt: T,
      endedAt: null,
    };
    crashed.store.putCheck(running);
    await end(crashed, 'crash');

    const restarted = open(db);
    await restarted.manager.recover();
    await reach(restarted, unit.id, 'accepted');
    expect(restarted.store.checks(unit.id).find((check) => check.id === 'chk_old'), 'the interrupted check is recorded as not run').toMatchObject({ outcome: 'not_run', notRunReason: 'Agide was closed' });
    expect(restarted.checks.requests.length, 'the check ran again').toBe(1);
  });

  it('repeats the capture and assessment steps that had not finished', async () => {
    const db = database();
    const crashed = open(db);
    const captured = leave(crashed, 'crash-captured', 'captured', NO_CHECK.hash, 'worker');
    const assessed = leave(crashed, 'crash-assessed', 'assessed', WITH_CHECK.hash, 'helper');
    crashed.store.putCheck({
      id: 'chk_done',
      changesetId: assessed.id,
      target: 'checkpoint',
      commitId: assessed.checkpointCommit,
      policyHash: WITH_CHECK.hash,
      command: ['pnpm', 'test'],
      outcome: 'passed',
      notRunReason: null,
      exitCode: 0,
      signal: null,
      durationMs: 1,
      outputPath: null,
      outputTail: '',
      truncated: false,
      startedAt: T,
      endedAt: T,
    });
    await end(crashed, 'crash');

    const restarted = open(db);
    restarted.setReviewer((request) => reportStep(request.changesetId));
    await restarted.manager.recover();
    expect((await until(restarted, assessed.id, (changeset) => changeset.state === 'accepted', 'accept of the assessed changeset')).rung, 'a passed check at rung A accepts without a reviewer').toBe('A');
    const capturedNow = await until(restarted, captured.id, (changeset) => changeset.state === 'accepted' || changeset.state === 'awaiting_human', 'the captured changeset to move on');
    expect(restarted.store.decisions(capturedNow.id).map((decision: DecisionRecord) => decision.action), 'the pipeline ran from the captured state').toContain('assess');
  });
});

describe('review budget queue', () => {
  it('starts the queued reviews, oldest first, when the budget can pay and never before', async () => {
    const budget = new FakeReviewBudget(0);
    const rig = open(database(), budget);
    rig.setReviewer((request) => reportStep(request.changesetId));
    const first = captureFixture({ seed: 'q1', policyHash: NO_CHECK.hash, agent: 'worker' });
    const second = captureFixture({ seed: 'q2', policyHash: NO_CHECK.hash, agent: 'helper', sessionId: 'session-helper' });
    await rig.manager.submit(first);
    await reach(rig, first.id, 'queued_for_budget');
    await rig.manager.submit(second);
    await reach(rig, second.id, 'queued_for_budget');
    expect(await rig.manager.releaseQueued(), 'no budget, no review').toBe(0);
    expect(rig.store.list({ states: ['queued_for_budget'] }).length, 'both stay queued').toBe(2);

    budget.setPot(0.6);
    expect(await rig.manager.releaseQueued(), 'the pot pays one run of 0.5 and not the second').toBe(1);
    await reach(rig, first.id, 'awaiting_human');
    expect(rig.store.reports(first.id).length, 'the reviewer reported on the released changeset').toBe(1);
    expect(rig.store.get(first.id)?.rung, 'reviewer.skipped_budget stays among the reasons, so the reviewer does not accept it and the user decides at C').toBe('C');
    expect(rig.store.get(second.id)?.state, 'the newer one still waits').toBe('queued_for_budget');
    expect(rig.store.decisions(first.id).map((decision) => decision.action), 'the queue exit is a start_review decision of the app').toEqual(expect.arrayContaining(['queue_budget', 'start_review', 'report']));
  });

  it('keeps the user able to decide a queued changeset while the budget waits', async () => {
    const rig = open(database(), new FakeReviewBudget(0));
    const unit = captureFixture({ seed: 'user-q', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    const waiting = await reach(rig, unit.id, 'queued_for_budget');
    const rejected = await rig.manager.reject({ changesetId: unit.id, expectedHash: waiting.contentHash, reason: 'not wanted' }, UI);
    expect(rejected.state, 'the user rejected it').toBe('rejected');
    expect(await rig.manager.releaseQueued(), 'a rejected changeset is not started').toBe(0);
  });
});

describe('what no agent can do', () => {
  it('never accepts, rejects, demotes, marks seen or comments for an agent, whatever the state', async () => {
    const rig = open(database());
    const unit = captureFixture({ seed: 'agent-never', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    const waiting = await reach(rig, unit.id, 'awaiting_human');
    const base = { changesetId: unit.id };
    await expect(rig.manager.accept({ ...base, expectedHash: waiting.contentHash, expectedRung: waiting.rung, withoutReviewer: true }, WORKER), 'accept').rejects.toMatchObject({ code: 'out_of_scope' });
    await expect(rig.manager.reject({ ...base, expectedHash: waiting.contentHash, reason: 'x' }, WORKER), 'reject').rejects.toMatchObject({ code: 'out_of_scope' });
    await expect(rig.manager.sendBack({ ...base, expectedHash: waiting.contentHash }, WORKER), 'send back').rejects.toMatchObject({ code: 'out_of_scope' });
    await expect(rig.manager.demote({ ...base, toRung: 'B', reason: 'lower this one please' }, WORKER), 'demote').rejects.toMatchObject({ code: 'out_of_scope' });
    await expect(rig.manager.escalate({ ...base, toRung: 'E' }, WORKER), 'user escalation').rejects.toMatchObject({ code: 'out_of_scope' });
    expect(() => rig.manager.seen({ ...base, level: 'summary', how: 'marked' }, WORKER), 'seen').toThrow();
    expect(() => rig.manager.comment({ ...base, file: 0, side: 'new', line: 1, body: 'hi' }, WORKER), 'comment').toThrow();
    const reviewer: ReviewCaller = { kind: 'reviewer', sessionId: 'review-x' };
    await expect(rig.manager.accept({ ...base, expectedHash: waiting.contentHash, expectedRung: waiting.rung, withoutReviewer: true }, reviewer), 'a reviewer session accepting').rejects.toMatchObject({ code: 'out_of_scope' });
    expect(rig.store.get(unit.id)?.state, 'nothing moved').toBe('awaiting_human');
    expect(rig.store.decisions(unit.id).every((decision) => decision.actor !== 'user'), 'no decision of the user was written').toBe(true);
  });

  it('lets a request below or at the current rung change nothing', async () => {
    const rig = open(database());
    rig.rules.set('worker', [catalogueReason('config.git', { subject: '.gitattributes' })]);
    const unit = captureFixture({ seed: 'agent-lower', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    const waiting = await reach(rig, unit.id, 'awaiting_human');
    for (const toRung of ['B', 'C', 'D', 'E'] as const) {
      await expect(rig.manager.requestEscalation({ changesetId: unit.id, toRung, reason: 'lower' }, WORKER), `request for ${toRung} at rung ${waiting.rung}`).rejects.toMatchObject({ code: 'refused' });
    }
    expect(rig.store.get(unit.id)?.rung, 'the rung is unchanged').toBe('E');
  });
});

describe('supersession', () => {
  it('lets a new capture supersede an accepted changeset and drops its accept', async () => {
    const rig = open(database());
    rig.facts.setState('sw1', 'worker', 'done');
    const first = captureFixture({ seed: 'sup-1', policyHash: WITH_CHECK.hash });
    await rig.manager.submit(first);
    await reach(rig, first.id, 'accepted');
    const second = captureFixture({ seed: 'sup-2', policyHash: WITH_CHECK.hash });
    await rig.manager.submit(second);
    expect(rig.store.get(first.id)?.state, 'the accepted changeset is superseded').toBe('superseded');
    await reach(rig, second.id, 'accepted');
    expect(rig.manager.mergeGate('sw1').agents.find((entry) => entry.agent === 'worker'), 'the gate follows the newest changeset').toMatchObject({ changesetId: second.id, ok: true });
  });

  it('keeps the seen marks of unchanged hunks and lets the marks of a changed hunk lapse', async () => {
    const rig = open(database());
    const files = [{ path: 'src/a.ts', hunks: [' a\n-b\n+c', ' d\n+e'] }];
    const first = captureFixture({ seed: 'seen-1', policyHash: NO_CHECK.hash, files });
    await rig.manager.submit(first);
    await reach(rig, first.id, 'awaiting_human');
    rig.manager.seen({ changesetId: first.id, level: 'hunk', file: 0, hunk: 0, how: 'marked' }, UI);
    rig.manager.seen({ changesetId: first.id, level: 'hunk', file: 0, hunk: 1, how: 'marked' }, UI);
    const second = captureFixture({ seed: 'seen-2', policyHash: NO_CHECK.hash, files: [{ path: 'src/a.ts', hunks: [' a\n-b\n+c', ' d\n+changed'] }] });
    await rig.manager.submit(second);
    await reach(rig, second.id, 'awaiting_human');
    const seen = rig.manager.get({ changesetId: second.id, hunks: true }, UI).seen;
    expect(seen.files[0]?.unseenHunks, 'one hunk changed and is unseen').toBe(1);
    expect(seen.summary, 'the summary mark is bound to the content and lapses').toBe(false);
  });
});

describe('merging', () => {
  it('runs one merge of a swarm at a time and lets the next one start after it ended', async () => {
    const rig = open(database());
    const unit = captureFixture({ seed: 'merge-once', policyHash: WITH_CHECK.hash });
    await rig.manager.submit(unit);
    await reach(rig, unit.id, 'accepted');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const merge = rig.merger.merge.bind(rig.merger);
    rig.merger.merge = async (input) => {
      await held;
      return merge(input);
    };
    const first = rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI);
    await expect(rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI), 'a second merge while the first runs').rejects.toMatchObject({ code: 'refused' });
    release();
    expect((await first).merged.length, 'the first merge finished').toBe(1);
    await expect(rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI), 'nothing accepted is left to merge').rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('nothing accepted') });
  });

  it('holds the decisions of the swarm while its merge runs, so the merged content is the accepted one', async () => {
    const rig = open(database());
    const unit = captureFixture({ seed: 'merge-hold', policyHash: WITH_CHECK.hash });
    await rig.manager.submit(unit);
    const accepted = await reach(rig, unit.id, 'accepted');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const merge = rig.merger.merge.bind(rig.merger);
    rig.merger.merge = async (input) => {
      await held;
      return merge(input);
    };
    const running = rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI);
    await expect(rig.manager.escalate({ changesetId: unit.id, toRung: 'E' }, UI), 'an escalation while the merge runs').rejects.toMatchObject({ code: 'refused', message: expect.stringContaining('merge of this swarm is running') });
    await expect(rig.manager.sendBack({ changesetId: unit.id, expectedHash: accepted.contentHash }, UI), 'a send-back while the merge runs').rejects.toMatchObject({ code: 'refused' });
    release();
    expect((await running).merged.map((entry) => entry.changesetId), 'the merge recorded the accepted changeset').toEqual([unit.id]);
    expect(rig.store.get(unit.id)?.mergedCommit, 'the store says merged').not.toBeNull();
    expect((await rig.manager.escalate({ changesetId: unit.id, toRung: 'E' }, UI)).rung, 'decisions work again after the merge').toBe('E');
  });

  it('refuses the merge while the repository is armed or a ref moved, and moves only the merged target in the snapshot', async () => {
    let fresh: ReturnType<typeof catalogueReason>[] = [catalogueReason('repo.armed', { evidence: { changed: ['config'] } })];
    const refreshed: string[] = [];
    const rig = rigWithRepo({ compareRepo: async () => fresh, refreshRef: async (_swarm, ref, from, to) => (refreshed.push(`${ref} ${from}..${to}`), true) });
    const unit = captureFixture({ seed: 'merge-armed', policyHash: WITH_CHECK.hash });
    await rig.manager.submit(unit);
    await reach(rig, unit.id, 'accepted');
    expect(rig.manager.mergeGate('sw1').open, 'every changeset is accepted').toBe(true);
    await expect(rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: true }, UI), 'the armed repository closes the merge').rejects.toMatchObject({ code: 'refused', details: { refused: [expect.objectContaining({ why: expect.stringContaining('repo.armed') })] } });
    fresh = [];
    const result = await rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI);
    expect(refreshed, 'the app moved main and told the snapshot').toEqual([`refs/heads/main ${result.from}..${result.to}`]);
  });

  it('starts no reviewer when the repository is armed or a user-level Claude file changed, and asks a person', async () => {
    const rig = rigWithRepo({ compareRepo: async () => [catalogueReason('reviewer.user_config_changed')], refreshRef: async () => true });
    const unit = captureFixture({ seed: 'no-reviewer', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    const waiting = await reach(rig, unit.id, 'awaiting_human');
    expect(rig.store.runs(unit.id), 'no reviewer run').toEqual([]);
    expect(rig.store.reasons(unit.id).map((reason) => reason.id), 'the reason is on the changeset').toContain('reviewer.user_config_changed');
    expect([waiting.rung, waiting.floor], 'the hard reason sets the rung and the floor').toEqual(['C', 'C']);
  });

  it('hands the rules the paths the latest changesets of the other agents changed', async () => {
    const rig = open(database());
    const helper = captureFixture({ seed: 'paths-helper', policyHash: NO_CHECK.hash, agent: 'helper', sessionId: 'session-helper' });
    await rig.manager.submit(helper);
    await until(rig, helper.id, (found) => found.state !== 'captured' && found.state !== 'checking', 'the helper assessed');
    const worker = captureFixture({ seed: 'paths-worker', policyHash: NO_CHECK.hash });
    await rig.manager.submit(worker);
    await until(rig, worker.id, (found) => found.state !== 'captured' && found.state !== 'checking', 'the worker assessed');
    const input = rig.rules.inputs.find((candidate) => candidate.changeset.id === worker.id)!;
    const helperPaths = [...new Set(helper.files.flatMap((file) => [file.oldPath, file.newPath]).filter((path) => path !== null))];
    expect(input.otherAgentsPaths, 'the helper and its paths').toEqual({ helper: helperPaths });
  });

  it('closes the gate again when an accepted changeset is sent back by the user', async () => {
    const rig = open(database());
    const unit = captureFixture({ seed: 'gate-back', policyHash: WITH_CHECK.hash });
    await rig.manager.submit(unit);
    const accepted = await reach(rig, unit.id, 'accepted');
    expect(rig.manager.mergeGate('sw1').open, 'open while accepted').toBe(true);
    await rig.manager.sendBack({ changesetId: unit.id, expectedHash: accepted.contentHash }, UI);
    expect(rig.manager.mergeGate('sw1').agents.find((entry) => entry.agent === 'worker'), 'a changeset sent back is not mergeable on its old accept').toMatchObject({ ok: false, why: 'the latest changeset is sent_back' });
    await expect(rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI), 'the merge is refused').rejects.toMatchObject({ code: 'refused' });
  });

  it('closes the gate when the user raises the rung of a merged changeset above the rung it was accepted at', async () => {
    const rig = open(database());
    const unit = captureFixture({ seed: 'gate-merged', policyHash: WITH_CHECK.hash });
    await rig.manager.submit(unit);
    await reach(rig, unit.id, 'accepted');
    await rig.manager.merge({ swarmId: 'sw1', exclude: [], dryRun: false }, UI);
    expect(rig.manager.mergeGate('sw1').open, 'open after the merge').toBe(true);
    const raised = await rig.manager.escalate({ changesetId: unit.id, toRung: 'E' }, UI);
    expect([raised.state, raised.rung, raised.mergedCommit !== null], 'a merged changeset keeps its state and takes the new rung').toEqual(['accepted', 'E', true]);
    expect(rig.manager.mergeGate('sw1').agents.find((entry) => entry.agent === 'worker'), 'its accept was at a lower rung').toMatchObject({ ok: false, why: 'it was accepted at a lower rung or on other content' });
  });
});
