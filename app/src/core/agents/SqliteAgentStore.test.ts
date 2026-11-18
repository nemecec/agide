import { describe, expect, it } from 'vitest';
import { migrate, openStore } from '../store/Store';
import { describeAgentStoreContract } from './agentStoreContract';
import { SqliteAgentStore } from './SqliteAgentStore';
import { repairAfterRestart } from './restore';
import type { AgentRef } from './types';

const treeTables = (db: ReturnType<typeof openStore>): void => {
  db.exec('CREATE TABLE tree_nodes (id TEXT PRIMARY KEY)');
  db.exec("INSERT INTO tree_nodes (id) VALUES ('f1')");
};

const memoryStore = (now: () => number) => {
  const db = openStore(':memory:');
  treeTables(db);
  return new SqliteAgentStore(db, () => ({ projectDir: '/work', folderId: 'f1' }), now);
};

describeAgentStoreContract('SqliteAgentStore', memoryStore);

const ref = (agentKey: string): AgentRef => ({ sessionId: 's1', agentKey });

describe('SqliteAgentStore persistence', () => {
  const T = '2026-11-17T10:00:00.000Z';

  function twoRuns() {
    const db = openStore(':memory:');
    treeTables(db);
    const context = () => ({ projectDir: '/work', folderId: 'f1' });
    return { db, open: () => new SqliteAgentStore(db, context) };
  }

  it('writes rows and loads them, with state, outcome, tokens and folder, in a later run', () => {
    const { db, open } = twoRuns();
    const first = open();
    first.apply({ kind: 'started', ref: ref('a1'), at: T, agentId: 'a1', agentType: 'general-purpose', description: 'Read files' });
    first.apply({ kind: 'usage', ref: ref('a1'), at: T, messageId: 'm1', usage: { input: 5, output: 7, cacheWrite5m: 3, cacheWrite1h: 2, cacheRead: 11 } });
    first.apply({ kind: 'ended', ref: ref('a1'), at: '2026-11-17T10:01:00.000Z', outcome: 'failed', basis: 'derived', summary: 'broke' });
    first.dispose();

    const row = db.prepare('SELECT state, outcome, outcome_basis, folder_id, project_dir, cache_write_tokens FROM agents').get() as Record<string, unknown>;
    expect(row, 'saved row').toEqual({ state: 'failed', outcome: 'failed', outcome_basis: 'derived', folder_id: 'f1', project_dir: '/work', cache_write_tokens: 5 });

    const second = open();
    expect(second.get(ref('a1')), 'restored record').toMatchObject({ state: 'failed', outcome: 'failed', outcomeBasis: 'derived', summary: 'broke', description: 'Read files', tokens: { input: 5, output: 7, cacheRead: 11 } });
    expect(second.sessionContext('s1'), 'folder kept for history').toEqual({ projectDir: '/work', folderId: 'f1' });
    second.dispose();
  });

  it('ends rows left running by the earlier run as lost, or completed when the agent finished', () => {
    const { open } = twoRuns();
    const first = open();
    first.apply({ kind: 'started', ref: ref('a1'), at: T });
    first.apply({ kind: 'started', ref: ref('a2'), at: T });
    first.dispose();

    const second = open();
    expect(second.get(ref('a1'))?.state, 'still running after load').toBe('running');
    repairAfterRestart(second, T, (record) => record.ref.agentKey === 'a2');
    expect(second.get(ref('a1')), 'lost').toMatchObject({ state: 'failed', outcome: 'lost', outcomeBasis: 'derived' });
    expect(second.get(ref('a2')), 'finished').toMatchObject({ state: 'done', outcome: 'completed' });
    second.dispose();
  });

  it('keeps a revived agent running in the saved row and removes a deleted row', () => {
    const { db, open } = twoRuns();
    const store = open();
    store.apply({ kind: 'started', ref: ref('a1'), at: T });
    store.apply({ kind: 'ended', ref: ref('a1'), at: T, outcome: 'completed', basis: 'derived' });
    store.apply({ kind: 'started', ref: ref('a1'), at: T });
    store.flush();
    expect(db.prepare('SELECT state, ended_at FROM agents').get(), 'revived row').toEqual({ state: 'running', ended_at: null });
    store.remove(ref('a1'));
    expect(db.prepare('SELECT count(*) AS n FROM agents').get(), 'row deleted').toEqual({ n: 0 });
    store.dispose();
  });

  it('saves an unknown folder as no folder, and the schema refuses an app-started row with an agent key', () => {
    const db = openStore(':memory:');
    treeTables(db);
    const store = new SqliteAgentStore(db, () => ({ projectDir: '/w', folderId: 'gone' }));
    store.apply({ kind: 'started', ref: ref('a1'), at: T });
    store.flush();
    expect(db.prepare('SELECT folder_id FROM agents').get(), 'folder cleared').toEqual({ folder_id: null });
    expect(() => db.prepare("UPDATE agents SET origin = 'app-started'").run(), 'origin and key must agree').toThrow();
    store.dispose();
  });

  it('migrates twice without error', () => {
    const db = openStore(':memory:');
    treeTables(db);
    new SqliteAgentStore(db, () => undefined).dispose();
    expect(() => migrate(db, 'agents', [{ version: 1, sql: 'SELECT 1' }]), 'second run is a no-op').not.toThrow();
  });
});
