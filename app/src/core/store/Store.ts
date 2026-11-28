import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

/** One schema step of a module. Versions of a module start at 1 and increase by 1. */
export interface Migration {
  readonly version: number;
  readonly sql: string;
}

/**
 * Opens the app database. Uses the built-in `node:sqlite` driver, which works in Node 22 and in the
 * Electron 45 main process without a native rebuild. Pass `:memory:` in tests.
 */
export function openStore(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_versions (module TEXT PRIMARY KEY, version INTEGER NOT NULL)');
  return db;
}

/** The file of the main database of `db`, or undefined for a database in memory. */
export function databaseFile(db: Database): string | undefined {
  const main = (db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]).find((row) => row.name === 'main');
  return main === undefined || main.file === '' ? undefined : main.file;
}

/**
 * Applies the module's migrations above its recorded version, each in its own transaction.
 * Each module owns its tables and its migration list, so modules migrate independently.
 * Returns the module's version after the run.
 */
export function migrate(db: Database, module: string, migrations: readonly Migration[]): number {
  const row = db.prepare('SELECT version FROM schema_versions WHERE module = ?').get(module) as
    | { version: number }
    | undefined;
  let current = row?.version ?? 0;
  const known = Math.max(0, ...migrations.map((m) => m.version));
  if (current > known) {
    throw new Error(`${module} schema is at version ${current}, this build knows up to ${known}`);
  }
  const pending = [...migrations].sort((a, b) => a.version - b.version).filter((m) => m.version > current);
  for (const migration of pending) {
    if (migration.version !== current + 1) {
      throw new Error(`${module}: migration ${migration.version} follows ${current}; versions must be consecutive`);
    }
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_versions (module, version) VALUES (?, ?) ON CONFLICT(module) DO UPDATE SET version = excluded.version',
      ).run(module, migration.version);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    current = migration.version;
  }
  return current;
}
