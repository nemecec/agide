import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore, type Database } from '../store/index';
import { SqliteTreeService } from './SqliteTreeService';
import { describeTreeServiceContract } from './treeServiceContract';

describeTreeServiceContract('SqliteTreeService', () => new SqliteTreeService(openStore(':memory:')));

describe('SqliteTreeService on a stored cycle', () => {
  it('answers isWithin without looping when the stored parents form a cycle', () => {
    const db = openStore(':memory:');
    const tree = new SqliteTreeService(db);
    const a = tree.createFolder({ title: 'a' });
    const b = tree.createFolder({ title: 'b', parentId: a.id });
    db.prepare('UPDATE tree_nodes SET parent_id = ? WHERE id = ?').run(b.id, a.id);
    expect(tree.isWithin(a.id, 'unrelated'), 'a node in a cycle is not within a stranger').toBe(false);
    expect(tree.isWithin(a.id, b.id), 'a node in a cycle is within its stored parent').toBe(true);
  });
});

describe('SqliteTreeService persistence', () => {
  const dirs: string[] = [];
  const open: Database[] = [];
  const database = (dir: string): Database => {
    const db = openStore(join(dir, 'app.db'));
    open.push(db);
    return db;
  };
  afterEach(() => {
    for (const db of open.splice(0)) db.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('shows the same tree after the database file is reopened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tree-db-'));
    dirs.push(dir);
    const first = database(dir);
    const tree = new SqliteTreeService(first);
    const outer = tree.createFolder({ title: 'outer' });
    const inner = tree.createFolder({ title: 'inner', parentId: outer.id });
    tree.createLeaf({ title: 'S', parentId: inner.id, surfaceType: 'claude-session', surfaceId: 's1' });
    tree.createFolder({ title: 'sibling', index: 0 });
    const before = tree.list();
    first.close();
    open.splice(open.indexOf(first), 1);

    const reopened = new SqliteTreeService(database(dir));
    expect(reopened.list(), 'nodes, parents and orders survive a restart').toEqual(before);
  });

  it('applies the schema once and records the tree version', () => {
    const db = openStore(':memory:');
    new SqliteTreeService(db);
    new SqliteTreeService(db);
    const row = db.prepare("SELECT version FROM schema_versions WHERE module = 'tree'").get();
    expect(row, 'tree module has a recorded schema version').toMatchObject({ version: 1 });
  });

  it('removes the descendants rows from the database, not only from the listing', () => {
    const db = openStore(':memory:');
    const tree = new SqliteTreeService(db);
    const outer = tree.createFolder({ title: 'outer' });
    tree.createFolder({ title: 'inner', parentId: outer.id });
    tree.remove(outer.id);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM tree_nodes').get();
    expect(rows, 'table is empty after the subtree removal').toMatchObject({ n: 0 });
  });

  it('leaves the database unchanged when an operation fails midway', () => {
    const db = openStore(':memory:');
    const tree = new SqliteTreeService(db, () => 'same-id');
    tree.createFolder({ title: 'A' });
    expect(() => tree.createFolder({ title: 'B' }), 'duplicate id violates the primary key').toThrow();
    expect(tree.list().map((n) => n.title), 'the failed insert left no row and no open transaction').toEqual(['A']);
    expect(() => db.exec('BEGIN; COMMIT;'), 'no transaction is left open').not.toThrow();
  });
});
