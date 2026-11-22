import { afterEach, describe, expect, it } from 'vitest';
import { captureFixture, changesetRecord, policySnapshot } from '../fakes/fixtures';
import { sqliteHarness } from '../store/sqliteHarness';
import { SqliteReviewBudget } from './SqliteReviewBudget';

const policy = policySnapshot();
let close: (() => void) | undefined;
afterEach(() => close?.());

function setup(options: { pot?: number; daily?: number } = {}) {
  const { store, db, close: closeDb } = sqliteHarness();
  close = closeDb;
  store.putPolicy(policy);
  let now = new Date('2026-11-21T10:00:00');
  const budget = new SqliteReviewBudget({ db, potUsd: () => options.pot ?? 2, dailyUsd: () => options.daily ?? 5, dayOf: (at) => at.toLocaleDateString('sv'), now: () => now });
  const run = (changesetSeed: string, runId: string, state: 'running' | 'failed' | 'reported', usd: { reserved: number; reported: number }, failure: 'app-exit' | null = null) => {
    const rows = changesetRecord(captureFixture({ seed: changesetSeed, policyHash: policy.hash }), 1);
    if (store.get(rows.changeset.id) === undefined) store.insert(rows.changeset, rows.files, rows.hunks);
    store.putRun({ id: runId, changesetId: rows.changeset.id, attempt: 1, sessionId: runId, model: 'haiku', effort: 'high', promptVersion: null, state, failure, pid: null, reservedUsd: usd.reserved, reportedUsd: usd.reported, rejectedCalls: 0, queuedAt: now.toISOString(), startedAt: null, endedAt: null });
  };
  return { budget, store, run, setNow: (next: string) => (now = new Date(next)) };
}

describe('review budget', () => {
  it('reserves the smaller of the run amount and what the pot has left', () => {
    const { budget } = setup({ pot: 1.2 });
    expect(budget.reserve('sw1', 'r1', 0.5), 'the pot pays the whole run').toEqual({ ok: true, usd: 0.5 });
  });

  it('counts the runs of the swarm against the pot: a running run its reservation, an ended one its cost', () => {
    const { budget, run } = setup({ pot: 1 });
    run('a', 'run-a', 'running', { reserved: 0.5, reported: 0 });
    expect(budget.potSpent('sw1'), 'a running run holds its reservation').toBeCloseTo(0.5);
    run('a', 'run-a', 'reported', { reserved: 0.5, reported: 0.1 });
    expect(budget.potSpent('sw1'), 'a reported run holds its cost').toBeCloseTo(0.1);
    expect(budget.reserve('sw1', 'r2', 2), 'the rest of the pot').toEqual({ ok: true, usd: 0.9 });
  });

  it('refuses when the pot cannot pay the minimum reservation, also when the swarm has no pot', () => {
    const { budget } = setup({ pot: 0.04 });
    expect(budget.reserve('sw1', 'r1', 1), 'a pot below the minimum').toEqual({ ok: false, why: 'pot' });
    expect(setup({ pot: 0 }).budget.reserve('sw1', 'r1', 1), 'no pot').toEqual({ ok: false, why: 'pot' });
  });

  it('keeps a reservation made before an app exit charged to the pot', () => {
    const { budget, run } = setup({ pot: 1 });
    run('b', 'run-b', 'failed', { reserved: 0.8, reported: 0 }, 'app-exit');
    expect(budget.potSpent('sw1'), 'the reservation of a run that ended with the app stays').toBeCloseTo(0.8);
  });

  it('holds the day to its allowance and starts a new day empty', () => {
    const { budget, setNow } = setup({ pot: 100, daily: 1 });
    expect(budget.reserve('sw1', 'r1', 0.6), 'first run').toMatchObject({ ok: true });
    expect(budget.reserve('sw1', 'r2', 0.6), 'second run does not fit the day').toEqual({ ok: false, why: 'daily' });
    budget.settle('r1', 0.2);
    expect(budget.spentOn('2026-11-21'), 'the reservation is replaced by the cost').toEqual({ reservedUsd: 0, reportedUsd: 0.2 });
    expect(budget.reserve('sw1', 'r3', 0.6), 'room after the settle').toMatchObject({ ok: true });
    setNow('2026-11-22T00:05:00');
    expect(budget.reserve('sw1', 'r4', 0.9), 'the next day starts empty').toMatchObject({ ok: true });
  });

  it('settles a reservation that was made before a restart from the run row and the day it was queued', () => {
    const first = setup({ pot: 100, daily: 1 });
    first.budget.reserve('sw1', 'run-c', 0.7);
    first.run('c', 'run-c', 'running', { reserved: 0.7, reported: 0 });
    const restarted = new SqliteReviewBudget({ db: (first.budget as unknown as { options: { db: never } }).options.db, potUsd: () => 100, dailyUsd: () => 1, dayOf: (at) => at.toLocaleDateString('sv'), now: () => new Date('2026-11-21T11:00:00') });
    restarted.settle('run-c', 0.1);
    expect(restarted.spentOn('2026-11-21'), 'the day of the run was charged the cost only').toEqual({ reservedUsd: 0, reportedUsd: 0.1 });
  });
});
