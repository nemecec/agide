import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryInboxService } from '../../inbox/InMemoryInboxService';
import { openStore, type Database } from '../../store/Store';
import { InMemoryTreeService } from '../../tree/InMemoryTreeService';
import { catalogueReason, FakeReviewBudget } from '../fakes/fakes';
import { captureFixture, policySnapshot } from '../fakes/fixtures';
import { reviewPolicySchema } from '../policy/schema';
import { BASE_ALERT_ORIGIN, REVIEW_ITEM_ORIGIN, type ReviewCaller } from '../types';
import { persistentRig, type PersistentRig } from './persistentRig';
import { reportStep } from './reviewManagerContract';
import { describeRepoChange, ReviewInbox } from './ReviewInbox';

const UI: ReviewCaller = { kind: 'ui' };
const NO_CHECK = policySnapshot(reviewPolicySchema.parse({ version: 1 }), 'inbox');
const PASSING = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'test'] } }), 'inbox-check');

let rig: PersistentRig | undefined;
let db: Database | undefined;
afterEach(async () => {
  await rig?.stop();
  db?.close();
  rig = undefined;
  db = undefined;
});

function setup(budget?: FakeReviewBudget) {
  db = openStore(':memory:');
  const tree = new InMemoryTreeService();
  const folder = tree.createFolder({ title: 'swarm' });
  const inbox = new InMemoryInboxService(tree);
  rig = persistentRig(db, { folderId: folder.id, ...(budget === undefined ? {} : { budget }) });
  rig.store.putPolicy(NO_CHECK);
  rig.store.putPolicy(PASSING);
  const reviewInbox = new ReviewInbox(inbox, rig.store, rig.facts);
  rig.manager.subscribe(reviewInbox.onEvent);
  const until = async (check: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 3_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  return { inbox, reviewInbox, tree, folder, until, rig };
}
const open = (inbox: InMemoryInboxService) => inbox.list({ kinds: ['review'], states: ['new', 'seen', 'snoozed'] });

describe('review items in the inbox', () => {
  it('posts one item when a changeset waits for a person, with the payload the card reads', async () => {
    const { inbox, folder, until, rig } = setup(new FakeReviewBudget(0));
    rig.rules.set('worker', [catalogueReason('config.git', { subject: '.gitattributes' })]);
    const unit = captureFixture({ seed: 'one', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    await until(() => open(inbox).length === 1, 'the item');
    const item = open(inbox)[0]!;
    expect(item, 'kind, origin, folder, text author and urgency of a floor').toMatchObject({ kind: 'review', origin: REVIEW_ITEM_ORIGIN, folderId: folder.id, textAuthor: 'app', urgency: 'high', source: 'app', dedupeKey: 'review:sw1:worker' });
    expect(item.message, 'a changeset that waits for budget says so').toBe('worker: waiting for review budget; rung E');
    expect(item.payload, 'the payload of the card').toEqual({ swarmId: 'sw1', agent: 'worker', changesetId: unit.id, rung: 'E', contentHash: rig.store.get(unit.id)!.contentHash, state: 'queued_for_budget', cardAccept: false, hasReport: false });
    expect(item.linkAnchor, 'the item opens the changeset').toEqual({ changesetId: unit.id });
  });

  it('names the agent, the goal and the three highest reasons when the reviewer is done', async () => {
    const { inbox, until, rig } = setup();
    rig.rules.set('worker', [catalogueReason('config.git', { subject: '.gitattributes' }), catalogueReason('size.large'), catalogueReason('file.binary', { subject: 'a.png' }), catalogueReason('diffusion.dirs')]);
    const unit = captureFixture({ seed: 'awaiting', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    await until(() => rig.store.get(unit.id)?.state === 'awaiting_human', 'the reviewer to fail twice');
    await until(() => open(inbox).length === 1, 'the item');
    expect(open(inbox)[0]!.message, 'agent in goal: rung, three ids from the highest rung down').toBe('worker in contract goal: rung E, config.git, size.large, reviewer.no_report');
    expect(open(inbox)[0]!.payload, 'the card does not accept at rung E, and no report came').toMatchObject({ state: 'awaiting_human', cardAccept: false, hasReport: false });
  });

  it('offers the card Accept at rung C after the reviewer failed twice, marked as without a report', async () => {
    const { inbox, until, rig } = setup();
    rig.rules.set('worker', [catalogueReason('size.large')]);
    const unit = captureFixture({ seed: 'at-c', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    await until(() => rig.store.get(unit.id)?.state === 'awaiting_human', 'the reviewer to fail twice');
    await until(() => open(inbox).length === 1, 'the item');
    expect(open(inbox)[0]!.payload, 'rung C, no finding, no report').toMatchObject({ rung: 'C', cardAccept: true, hasReport: false });
  });

  it.each(['major', 'blocker'] as const)('withholds the card Accept when the reviewer report holds a %s finding', async (severity) => {
    const { inbox, until, rig } = setup();
    rig.rules.set('worker', [catalogueReason('size.large')]);
    rig.setReviewer((request) => reportStep(request.changesetId, { verdict: 'accept', findings: [{ path: 'src/a.ts', line: 2, side: 'new', severity, title: 'wrong', body: 'this breaks' }] }));
    const unit = captureFixture({ seed: `finding-${severity}`, policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    await until(() => rig.store.get(unit.id)?.state === 'awaiting_human', 'the report');
    await until(() => open(inbox).length === 1, 'the item');
    expect(open(inbox)[0]!.payload, `a ${severity} finding at rung C`).toMatchObject({ rung: 'C', cardAccept: false, hasReport: true });
  });

  it('coalesces the item of a superseding changeset into the open one and returns it to new', async () => {
    const { inbox, until, rig } = setup(new FakeReviewBudget(0));
    const first = captureFixture({ seed: 'a', policyHash: NO_CHECK.hash });
    await rig.manager.submit(first);
    await until(() => open(inbox).length === 1, 'the first item');
    const id = open(inbox)[0]!.id;
    inbox.markSeen(id);
    const second = captureFixture({ seed: 'b', policyHash: NO_CHECK.hash });
    await rig.manager.submit(second);
    await until(() => rig.store.get(second.id)?.state === 'queued_for_budget', 'the second changeset');
    await until(() => (open(inbox)[0]?.payload as { changesetId: string } | undefined)?.changesetId === second.id, 'the item to follow');
    expect([open(inbox).length, open(inbox)[0]!.id, open(inbox)[0]!.state], 'one item, the same one, unread again').toEqual([1, id, 'new']);
  });

  it('resolves the item by the decision: approved by the user accept, denied, acted on a send-back', async () => {
    const { inbox, until, rig } = setup(new FakeReviewBudget(0));
    const decide = async (seed: string, agent: string, act: (id: string, hash: string) => Promise<unknown>) => {
      const unit = captureFixture({ seed, agent, sessionId: `session-${agent}`, policyHash: NO_CHECK.hash });
      await rig.manager.submit(unit);
      await until(() => rig.store.get(unit.id)?.state === 'queued_for_budget', seed);
      await until(() => inbox.list({ kinds: ['review'] }).some((item) => (item.payload as { changesetId: string }).changesetId === unit.id), `item of ${seed}`);
      await act(unit.id, rig.store.get(unit.id)!.contentHash);
      return inbox.list({ kinds: ['review'] }).find((item) => (item.payload as { changesetId: string }).changesetId === unit.id)!;
    };
    expect((await decide('acc', 'worker', (id, hash) => rig.manager.accept({ changesetId: id, expectedHash: hash, expectedRung: 'C', withoutReviewer: true }, UI))).resolution, 'accept').toBe('approved');
    expect((await decide('rej', 'helper', (id, hash) => rig.manager.reject({ changesetId: id, expectedHash: hash, reason: 'no' }, UI))).resolution, 'reject').toBe('denied');
    rig.facts.addAgent('sw1', { name: 'third', sessionId: 'session-third' });
    expect((await decide('back', 'third', (id, hash) => rig.manager.sendBack({ changesetId: id, expectedHash: hash }, UI))).resolution, 'send back').toBe('acted');
  });

  it('resolves the item as superseded when the next changeset needs no person', async () => {
    const { inbox, until, rig } = setup(new FakeReviewBudget(0));
    const first = captureFixture({ seed: 'p1', policyHash: NO_CHECK.hash });
    await rig.manager.submit(first);
    await until(() => open(inbox).length === 1, 'the item');
    const second = captureFixture({ seed: 'p2', policyHash: PASSING.hash });
    await rig.manager.submit(second);
    await until(() => rig.store.get(second.id)?.state === 'accepted', 'the auto accept');
    expect(inbox.list({ kinds: ['review'] })[0], 'the open item ends as superseded').toMatchObject({ state: 'done', resolution: 'superseded' });
  });

  it('says why a send-back could not reach the agent', async () => {
    const { inbox, until, rig } = setup(new FakeReviewBudget(0));
    rig.sendBack.unreachable.set('worker', 'the agent budget is spent');
    const unit = captureFixture({ seed: 'undeliverable', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    await until(() => rig.store.get(unit.id)?.state === 'queued_for_budget', 'queue');
    await rig.manager.sendBack({ changesetId: unit.id, expectedHash: rig.store.get(unit.id)!.contentHash }, UI);
    await until(() => rig.store.get(unit.id)?.state === 'awaiting_human', 'the undeliverable decision');
    await until(() => open(inbox)[0]?.message === 'worker: the send-back could not reach the agent (the agent budget is spent)', 'the message');
  });

  it('says that the agent ended without new work after a send-back and why', async () => {
    const { inbox, until, rig } = setup(new FakeReviewBudget(0));
    const unit = captureFixture({ seed: 'no-new-work', policyHash: NO_CHECK.hash });
    await rig.manager.submit(unit);
    await until(() => rig.store.get(unit.id)?.state === 'queued_for_budget', 'queue');
    await rig.manager.sendBack({ changesetId: unit.id, expectedHash: rig.store.get(unit.id)!.contentHash }, UI);
    await until(() => rig.store.get(unit.id)?.state === 'sent_back', 'the send-back');
    await rig.manager.noNewCapture('sw1', 'worker', 'the agent ended without changing its work tree');
    await until(() => rig.store.get(unit.id)?.state === 'awaiting_human', 'the move to the person');
    await until(() => (open(inbox)[0]?.message ?? '').startsWith('worker ended without new work after the send-back (the agent ended without changing its work tree)'), 'the message');
  });

  it('posts the capture failure, the repository alert and the policy alert under their keys', async () => {
    const { inbox, reviewInbox } = setup();
    reviewInbox.captureFailed('sw1', 'worker', 'git said\nno');
    reviewInbox.repositoryChanged('sw1', 'its configuration', 'hash-of-the-change');
    reviewInbox.policyInvalid('/repo', 'abc');
    const items = inbox.list({});
    expect(items.map((item) => [item.kind, item.urgency, item.dedupeKey]).sort(), 'one item per condition').toEqual(
      [
        ['failure', 'normal', 'review:capture:sw1:worker'],
        ['alert', 'high', 'review:repo:sw1'],
        ['alert', 'normal', 'review:policy:/repo:abc'],
      ].sort(),
    );
    expect(inbox.list({ kinds: ['alert'] }).find((item) => item.dedupeKey === 'review:repo:sw1')?.payload, 'the alert carries the swarm and the hash of the change').toEqual({ swarmId: 'sw1', repoDifferenceHash: 'hash-of-the-change' });
    reviewInbox.captureFailed('sw1', 'worker', 'again');
    expect(inbox.list({ kinds: ['failure'] }).length, 'a repeat coalesces').toBe(1);
  });

  it('resolves the open item of a key and ignores a key that has none', () => {
    const { inbox, reviewInbox } = setup();
    reviewInbox.repositoryChanged('sw1', 'a branch');
    reviewInbox.resolve('review:repo:none', 'approved');
    expect(inbox.list({ kinds: ['alert'] })[0]?.state, 'an unknown key leaves the alert open').not.toBe('done');
    reviewInbox.resolve('review:repo:sw1', 'approved');
    expect(inbox.list({ kinds: ['alert'] })[0], 'the alert ends with the resolution').toMatchObject({ state: 'done', resolution: 'approved' });
  });

  it('does not let a failing inbox stop the review', () => {
    const { inbox, reviewInbox } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(inbox, 'post').mockImplementation(() => {
      throw new Error('inbox is down');
    });
    vi.spyOn(inbox, 'resolveByDedupeKey').mockImplementation(() => {
      throw new Error('inbox is down');
    });
    expect(() => {
      reviewInbox.captureFailed('sw1', 'worker', 'git said no');
      reviewInbox.repositoryChanged('sw1', 'a branch');
      reviewInbox.policyInvalid('/repo', 'abc');
      reviewInbox.resolve('review:repo:sw1', 'approved');
    }, 'every call swallows the failure').not.toThrow();
    expect(warn, 'each failure is logged').toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});

describe('the alert for a check that fails on the base commit', () => {
  const alerts = (inbox: InMemoryInboxService, states: ('new' | 'seen' | 'snoozed' | 'done')[] = ['new', 'seen', 'snoozed']) => inbox.list({ kinds: ['alert'], states }).filter((item) => item.origin === BASE_ALERT_ORIGIN);

  it('posts one alert for the base, with the command of the policy, and none for a second or third changeset on it', async () => {
    const { inbox, until, rig } = setup();
    const first = captureFixture({ seed: 'red-1', policyHash: PASSING.hash });
    rig.checks.set(first.id, 'failed', 'failed');
    await rig.manager.submit(first);
    await until(() => alerts(inbox).length === 1, 'the alert');
    const second = captureFixture({ seed: 'red-2', agent: 'helper', sessionId: 'session-helper', policyHash: PASSING.hash });
    rig.checks.set(second.id, 'passed', 'failed');
    await rig.manager.submit(second);
    await until(() => rig.store.get(second.id)?.state === 'in_review' || rig.store.get(second.id)?.state === 'awaiting_human' || rig.store.get(second.id)?.state === 'accepted', 'the second changeset');
    const [alert] = alerts(inbox);
    expect(alert, 'an alert of the app in the folder of the swarm').toMatchObject({ kind: 'alert', origin: BASE_ALERT_ORIGIN, urgency: 'high', textAuthor: 'app', source: 'app', occurrences: 1 });
    expect(alerts(inbox).length, 'one alert for the base, not one per changeset').toBe(1);
    expect(alert!.message, 'the headline names the command').toBe('The check fails on the base commit: pnpm test');
    expect(alert!.details, 'the text of the decision').toBe('The check fails on the base commit: pnpm test. Reviews stay at rung C until the base is green: fix the base, or change check.command in the policy.');
    expect(alert!.payload, 'the payload names the swarm, the base commit and the policy').toEqual({ swarmId: 'sw1', baseCommit: rig.store.get(first.id)!.baseCommit, policyHash: PASSING.hash });
    expect(`${alert!.message} ${alert!.details}`, 'nothing of the output of the check is in the alert').not.toContain('FAIL one test');
  });

  it('does not post again for a base that stays red after the user dismissed the alert', async () => {
    const { inbox, until, rig } = setup();
    const first = captureFixture({ seed: 'dismissed-1', policyHash: PASSING.hash });
    rig.checks.set(first.id, 'failed', 'failed');
    await rig.manager.submit(first);
    await until(() => alerts(inbox).length === 1, 'the alert');
    inbox.resolve(alerts(inbox)[0]!.id, 'dismissed');
    const again = captureFixture({ seed: 'dismissed-2', policyHash: PASSING.hash });
    rig.checks.set(again.id, 'failed', 'failed');
    await rig.manager.submit(again);
    await until(() => rig.store.get(again.id)?.state === 'awaiting_human', 'the second changeset');
    expect([alerts(inbox).length, alerts(inbox, ['done']).length], 'no open alert and one dismissed one').toEqual([0, 1]);
  });

  it('posts again for another base commit or policy that is red', async () => {
    const { inbox, until, rig } = setup();
    const first = captureFixture({ seed: 'pair-1', policyHash: PASSING.hash });
    rig.checks.set(first.id, 'failed', 'failed');
    await rig.manager.submit(first);
    await until(() => alerts(inbox).length === 1, 'the first alert');
    const other = policySnapshot(reviewPolicySchema.parse({ version: 1, check: { command: ['pnpm', 'lint'] } }), 'inbox-other');
    rig.store.putPolicy(other);
    const second = captureFixture({ seed: 'pair-2', agent: 'helper', sessionId: 'session-helper', policyHash: other.hash });
    rig.checks.set(second.id, 'failed', 'failed');
    await rig.manager.submit(second);
    await until(() => alerts(inbox).length === 2, 'the second alert');
    expect(alerts(inbox).map((item) => item.message).sort(), 'one alert per policy, each with its command').toEqual(['The check fails on the base commit: pnpm lint', 'The check fails on the base commit: pnpm test']);
  });

  it('resolves the alert when a later base run is green', async () => {
    const { inbox, until, rig } = setup();
    const red = captureFixture({ seed: 'turn-1', policyHash: PASSING.hash });
    rig.checks.set(red.id, 'failed', 'failed');
    await rig.manager.submit(red);
    await until(() => alerts(inbox).length === 1, 'the alert');
    const green = captureFixture({ seed: 'turn-2', agent: 'helper', sessionId: 'session-helper', policyHash: PASSING.hash });
    rig.checks.set(green.id, 'passed', 'passed');
    await rig.manager.submit(green);
    await until(() => alerts(inbox).length === 0, 'the alert to end');
    expect(alerts(inbox, ['done'])[0], 'the alert is resolved, not deleted').toMatchObject({ state: 'done', resolution: 'superseded' });
  });

  it('posts no alert when the base run did not run or timed out, or the check passes on a green base', async () => {
    const { inbox, rig } = setup();
    const unsure = captureFixture({ seed: 'none-1', policyHash: PASSING.hash });
    rig.checks.set(unsure.id, 'failed', 'not_run');
    await rig.manager.submit(unsure);
    const slow = captureFixture({ seed: 'none-3', policyHash: PASSING.hash });
    rig.checks.set(slow.id, 'passed', 'timed_out');
    await rig.manager.submit(slow);
    const fine = captureFixture({ seed: 'none-2', agent: 'helper', sessionId: 'session-helper', policyHash: PASSING.hash });
    rig.checks.set(fine.id, 'passed', 'passed');
    await rig.manager.submit(fine);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alerts(inbox, ['new', 'seen', 'snoozed', 'done']).length, 'a base that did not run or timed out is not red').toBe(0);
  });
});

describe('describeRepoChange', () => {
  const reason = (id: string, evidence: Record<string, unknown>) => ({ id, evidence }) as never;

  it('names the armed categories and the first moved refs, and cleans names from the repository', () => {
    const text = describeRepoChange([
      reason('repo.armed', { changed: ['config', 'hooks'] }),
      reason('repo.ref_moved', { changes: [{ ref: 'refs/heads/main', change: 'moved' }, { ref: 'refs/heads/we\nird', change: 'created' }, { ref: 'refs/tags/a', change: 'deleted' }, { ref: 'refs/heads/more', change: 'moved' }] }),
    ]);
    expect(text, 'categories, three refs and the rest counted as more, on one line').toBe('configuration changed (config, hooks); refs/heads/main moved, refs/heads/we ird created, refs/tags/a deleted and more');
  });

  it('says that a user-level Claude file changed and that reviewers stay stopped until the accept', () => {
    const text = describeRepoChange([reason('reviewer.user_config_changed', { changed: 'a user-level Claude file', content: 'abc' })]);
    expect(text, 'the card names the cause of the stopped reviewers').toBe('a user-level Claude file changed, so reviewers stay stopped until you accept');
  });

  it('says that the change could not be read when no reason names one', () => {
    expect(describeRepoChange([]), 'nothing to name').toBe('what changed could not be read');
  });
});
