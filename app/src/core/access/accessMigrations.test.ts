import { describe, expect, it } from 'vitest';
import { INBOX_MODULE, inboxMigrations } from '../inbox/inboxMigrations';
import { migrate, openStore, type Database } from '../store/index';
import { treeMigrations, TREE_MODULE } from '../tree/treeMigrations';
import { ACCESS_MODULE, accessMigrations } from './accessMigrations';

function fresh(): Database {
  const db = openStore(':memory:');
  migrate(db, TREE_MODULE, treeMigrations);
  migrate(db, INBOX_MODULE, inboxMigrations);
  migrate(db, ACCESS_MODULE, accessMigrations);
  db.prepare("INSERT INTO inbox_items (id, kind, source, origin, message, text_author, created_at, updated_at) VALUES ('r1', 'approval', 'app', 'access:request', 'asks', 'app', 't', 't')").run();
  return db;
}

const INSERT =
  "INSERT INTO access_requests (item_id, session_id, action, target_kind, target_id, target_node_id, input, offered, call_state, state, scope, reason, message, decided_at, created_at, expires_at) VALUES ('r1', 's', ?, 'note', 'n', 'node', '{}', '[\"once\"]', 'waiting', ?, ?, ?, ?, ?, 't', 't2')";

const refused = (db: Database, action: string, state: string, scope: string | null, reason: string | null, message: string | null, decidedAt: string | null): boolean => {
  try {
    db.prepare(INSERT).run(action, state, scope, reason, message, decidedAt);
    return false;
  } catch {
    return true;
  }
};

describe('access migration 1', () => {
  it('accepts a pending request and one allowed with a scope', () => {
    expect(refused(fresh(), 'note.read', 'pending', null, null, null, null), 'a pending request').toBe(false);
    expect(refused(fresh(), 'note.read', 'allowed', 'once', null, null, 't'), 'an allowed request with a scope').toBe(false);
    expect(refused(fresh(), 'mount.write', 'denied', null, 'conflict', 'file changed', 't'), 'a denial with a reason and a message').toBe(false);
  });

  it('refuses an allow without a scope, a scope without an allow, a deny reason or message on another state, and an unknown action', () => {
    expect(refused(fresh(), 'note.read', 'allowed', null, null, null, 't'), 'an allow without a scope').toBe(true);
    expect(refused(fresh(), 'note.read', 'denied', 'once', 'user', null, 't'), 'a scope on a denial').toBe(true);
    expect(refused(fresh(), 'note.read', 'allowed', 'once', 'user', null, 't'), 'a reason on an allowed request').toBe(true);
    expect(refused(fresh(), 'note.read', 'expired', null, null, 'late', 't'), 'a message on an expired request').toBe(true);
    expect(refused(fresh(), 'note.erase', 'pending', null, null, null, null), 'an unknown action').toBe(true);
  });

  it('keeps the decision time with the state and limits the message', () => {
    expect(refused(fresh(), 'note.read', 'pending', null, null, null, 't'), 'a pending request with a decision time').toBe(true);
    expect(refused(fresh(), 'note.read', 'denied', null, 'user', null, null), 'a decided request without a time').toBe(true);
    expect(refused(fresh(), 'note.read', 'denied', null, 'user', 'x'.repeat(501), 't'), 'a message above 500 characters').toBe(true);
  });

  it('removes a request with its item', () => {
    const db = fresh();
    db.prepare(INSERT).run('note.read', 'pending', null, null, null, null);
    db.prepare("DELETE FROM inbox_items WHERE id = 'r1'").run();
    expect(db.prepare('SELECT count(*) AS n FROM access_requests').get(), 'the request went with its item').toEqual({ n: 0 });
  });
});
