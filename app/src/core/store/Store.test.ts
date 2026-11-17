import { describe, expect, it } from 'vitest';
import { migrate, openStore } from './Store';

describe('store migrations', () => {
  it('applies pending migrations once and records the version per module', () => {
    const db = openStore(':memory:');
    const migrations = [
      { version: 1, sql: 'CREATE TABLE a (id TEXT PRIMARY KEY)' },
      { version: 2, sql: 'ALTER TABLE a ADD COLUMN title TEXT' },
    ];
    expect(migrate(db, 'tree', migrations), 'first run reaches the last version').toBe(2);
    expect(migrate(db, 'tree', migrations), 'second run applies nothing and keeps the version').toBe(2);
    expect(migrate(db, 'session', []), 'another module starts at version 0').toBe(0);
  });

  it('rolls back a failing migration and keeps the previous version', () => {
    const db = openStore(':memory:');
    migrate(db, 'tree', [{ version: 1, sql: 'CREATE TABLE a (id TEXT)' }]);
    const failing = [
      { version: 1, sql: 'CREATE TABLE a (id TEXT)' },
      { version: 2, sql: 'CREATE TABLE b (id TEXT); SELECT * FROM missing_table' },
    ];
    expect(() => migrate(db, 'tree', failing), 'broken SQL throws').toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'b'").all();
    expect(tables, 'table from the failed migration is rolled back').toEqual([]);
    expect(migrate(db, 'tree', [{ version: 1, sql: 'CREATE TABLE a (id TEXT)' }]), 'version stays at 1').toBe(1);
  });

  it('refuses a database that a newer build migrated further', () => {
    const db = openStore(':memory:');
    migrate(db, 'tree', [
      { version: 1, sql: 'CREATE TABLE a (id TEXT)' },
      { version: 2, sql: 'CREATE TABLE b (id TEXT)' },
    ]);
    expect(() => migrate(db, 'tree', [{ version: 1, sql: 'CREATE TABLE a (id TEXT)' }]), 'older build on a newer schema').toThrow(
      'tree schema is at version 2, this build knows up to 1',
    );
  });
});
