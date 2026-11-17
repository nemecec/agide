import { describe, expect, it } from 'vitest';
import { migrate, openStore } from '../store/index';
import { SqliteTreeService } from '../tree/SqliteTreeService';
import { treeMigrations } from '../tree/treeMigrations';
import { describeInboxServiceContract } from './inboxServiceContract';
import { inboxMigrations } from './inboxMigrations';
import { SqliteInboxService } from './SqliteInboxService';

describeInboxServiceContract('SqliteInboxService', (now) => {
  const db = openStore(':memory:');
  const tree = new SqliteTreeService(db);
  return { inbox: new SqliteInboxService(db, tree, { now }), tree };
});

describe('SqliteInboxService storage', () => {
  it('keeps items and folder-removed marks across a reopen of the database', () => {
    const db = openStore(':memory:');
    const tree = new SqliteTreeService(db);
    const inbox = new SqliteInboxService(db, tree);
    const folder = tree.createFolder({ title: 'P' });
    const { item } = inbox.post({ folderId: folder.id, kind: 'approval', source: 'hook', origin: 'hook:PermissionRequest', message: 'm', textAuthor: 'agent', payload: { a: [1] }, linkAnchor: { url: 'https://example.org/x' } });
    tree.remove(folder.id);
    const again = new SqliteInboxService(db, tree);
    expect(again.get(item.id)?.folderRemoved, 'mark survives').toBe(true);
    expect(again.get(item.id)?.payload, 'payload round trip').toEqual({ a: [1] });
    expect(again.get(item.id)?.linkAnchor, 'anchor round trip').toEqual({ url: 'https://example.org/x' });
  });

  it('opens a database at tree version 1 and migrates it without losing nodes', () => {
    const db = openStore(':memory:');
    migrate(db, 'tree', treeMigrations.slice(0, 1));
    db.exec("INSERT INTO tree_nodes (id, parent_id, kind, title, position) VALUES ('a', NULL, 'folder', 'Old', 0)");
    const tree = new SqliteTreeService(db);
    new SqliteInboxService(db, tree);
    expect(tree.get('a')?.title, 'node kept').toBe('Old');
    expect(db.prepare("SELECT is_project FROM tree_nodes WHERE id = 'a'").get(), 'new column default').toEqual({ is_project: 0 });
  });

  it('refuses a database that a newer build migrated further', () => {
    const db = openStore(':memory:');
    new SqliteTreeService(db);
    db.prepare("INSERT INTO schema_versions (module, version) VALUES ('inbox', ?)").run(inboxMigrations.length + 1);
    expect(() => new SqliteInboxService(db, new SqliteTreeService(db)), 'newer schema').toThrow(/inbox schema is at version/);
  });

  it('rejects an open duplicate dedupe key at the database level', () => {
    const db = openStore(':memory:');
    new SqliteInboxService(db, new SqliteTreeService(db));
    const insert = () =>
      db.exec(`INSERT INTO inbox_items (id, kind, source, origin, message, text_author, dedupe_key, created_at, updated_at)
               VALUES ('${Math.random()}', 'status', 'app', 'o', 'm', 'app', 'k', 't', 't')`);
    insert();
    expect(insert, 'unique index on open keys').toThrow();
  });
});
