import { describe, expect, it } from 'vitest';
import { SqliteAgentStore } from '../agents/SqliteAgentStore';
import { openStore } from '../store/Store';
import { SqliteUsageStore } from './SqliteUsageStore';

const store = (): SqliteUsageStore => {
  const db = openStore(':memory:');
  db.exec('CREATE TABLE tree_nodes (id TEXT PRIMARY KEY)');
  new SqliteAgentStore(db, () => ({ projectDir: '/work', folderId: 'f1' }));
  return new SqliteUsageStore(db);
};
const tokens = { input: 10, output: 5, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 7 };

describe('plan windows', () => {
  it('keeps one row per window and replaces it on the next save', () => {
    const usage = store();
    usage.save({ window: 'five_hour', usedPercentage: 10, resetsAt: '2026-11-21T10:00:00Z', observedAt: '2026-11-21T08:00:00Z', source: 'status-line' });
    usage.save({ window: 'seven_day', usedPercentage: 40, resetsAt: '2026-11-25T10:00:00Z', observedAt: '2026-11-21T08:00:00Z', source: 'rate-limit-event' });
    usage.save({ window: 'five_hour', usedPercentage: 55, resetsAt: '2026-11-21T10:00:00Z', observedAt: '2026-11-21T09:00:00Z', source: 'rate-limit-event' });
    const loaded = usage.loadPlan().sort((a, b) => a.window.localeCompare(b.window));
    expect(loaded.map((window) => [window.window, window.usedPercentage, window.source]), 'the second save of five_hour replaced the first').toEqual([
      ['five_hour', 55, 'rate-limit-event'],
      ['seven_day', 40, 'rate-limit-event'],
    ]);
  });

  it('loads nothing from an empty table', () => {
    expect(store().loadPlan(), 'no window saved').toEqual([]);
  });
});

describe('session totals', () => {
  it('stores the cost with its basis and whether it is final, and replaces it on the next save', () => {
    const usage = store();
    usage.saveTotals('s1', { tokens, costUsd: 0.5, basis: 'result', final: false }, '2026-11-21T08:00:00Z');
    expect(usage.loadTotals('s1'), 'first save').toEqual({ costUsd: 0.5, basis: 'result', final: false });
    usage.saveTotals('s1', { tokens, costUsd: 0.9, basis: 'price-table', final: true }, '2026-11-21T08:05:00Z');
    expect(usage.loadTotals('s1'), 'the second save replaced the first').toEqual({ costUsd: 0.9, basis: 'price-table', final: true });
  });

  it('leaves out the cost and the basis when the session has none', () => {
    const usage = store();
    usage.saveTotals('s1', { tokens, final: false }, '2026-11-21T08:00:00Z');
    expect(usage.loadTotals('s1'), 'tokens only').toEqual({ final: false });
  });

  it('answers undefined for a session never saved', () => {
    expect(store().loadTotals('missing'), 'unknown session').toBeUndefined();
  });
});
