import { describe, expect, it } from 'vitest';
import { openStore } from '../store/Store';
import { SqliteSessionStore, type PersistedSession } from './SessionStore';

const row: PersistedSession = {
  id: 's1',
  folderId: 'f1',
  title: 'Work',
  cwd: '/tmp',
  launchPath: 'pty',
  permissionMode: 'acceptEdits',
  createdAt: '2026-11-17T10:00:00.000Z',
};

describe('SqliteSessionStore', () => {
  it('returns saved sessions, and a reopened database sees them', () => {
    const db = openStore(':memory:');
    const store = new SqliteSessionStore(db);
    store.save(row);
    expect(new SqliteSessionStore(db).load(), 'sessions after reopening').toEqual([row]);
  });

  it('updates folder and title on a second save and deletes on remove', () => {
    const store = new SqliteSessionStore(openStore(':memory:'));
    store.save(row);
    store.save({ ...row, folderId: 'f2', title: 'Moved' });
    expect(store.load()[0], 'saved again').toMatchObject({ folderId: 'f2', title: 'Moved', cwd: '/tmp' });
    store.remove('s1');
    expect(store.load(), 'sessions after remove').toEqual([]);
  });
});
