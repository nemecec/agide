import { describe, expect, it } from 'vitest';
import { openStore } from '../store/index';
import { describeObservationServiceContract } from './observationServiceContract';
import { SqliteObservationService, SqliteTabStore } from './SqliteBrowserStore';
import { TabCatalog } from './TabCatalog';

describeObservationServiceContract('SqliteObservationService', (now) => new SqliteObservationService(openStore(':memory:'), now));

const ui = { kind: 'ui' } as const;

describe('SqliteObservationService storage', () => {
  it('keeps the switch of a surface across a restart and drops it when the surface is forgotten', () => {
    const db = openStore(':memory:');
    const first = new SqliteObservationService(db);
    first.register('s1', 'github');
    first.setMode('s1', 'live', ui);
    const second = new SqliteObservationService(db);
    second.register('s1', 'github');
    expect(second.mode('s1'), 'switch after restart').toBe('live');
    second.forget('s1');
    second.register('s1', 'github');
    expect(second.mode('s1'), 'default again after forget').toBe('on-demand');
  });

  it('stores origin, outcome and size and no content columns', () => {
    const db = openStore(':memory:');
    new SqliteObservationService(db);
    const columns = (db.prepare("PRAGMA table_info('observation_log')").all() as { name: string }[]).map((column) => column.name);
    expect(columns, 'log columns').toEqual(['id', 'at', 'session_id', 'folder_id', 'node_id', 'kind', 'origin', 'bytes', 'outcome']);
  });
});

describe('tab catalog on SQLite', () => {
  it('restores tab states and never reuses a number after the tab is removed and the app restarts', () => {
    const db = openStore(':memory:');
    const catalog = new TabCatalog(new SqliteTabStore(db));
    const a = catalog.add({ leafId: 'l1', surfaceId: 's1', service: 'web', url: 'https://a.example/', title: 'A', observe: 'on-demand', createdBy: 'user' });
    const b = catalog.add({ leafId: 'l2', surfaceId: 's2', service: 'github', url: 'https://github.com/', title: 'B', observe: 'on-demand', createdBy: 'sess' });
    catalog.update('l1', { url: 'https://a.example/next', title: 'A2' });
    catalog.remove('l2');
    const restarted = new TabCatalog(new SqliteTabStore(db));
    expect(restarted.get('l1')?.state, 'state restored').toMatchObject({ url: 'https://a.example/next', title: 'A2', tabNumber: a.state.tabNumber });
    expect(restarted.get('l2'), 'removed tab stays removed').toBeUndefined();
    const c = restarted.add({ leafId: 'l3', surfaceId: 's3', service: 'web', url: 'about:blank', title: 'C', observe: 'on-demand', createdBy: 'user' });
    expect(c.state.tabNumber, 'a removed number is not reused').toBeGreaterThan(b.state.tabNumber);
    expect(restarted.byNumber(a.state.tabNumber)?.leafId, 'lookup by number').toBe('l1');
  });
});
