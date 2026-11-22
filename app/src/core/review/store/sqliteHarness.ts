import { migrate, openStore, type Database } from '../../store/Store';
import { SWARM_MODULE, swarmMigrations } from '../../swarm/manager/swarmMigrations';
import { SqliteChangesetStore } from './SqliteChangesetStore';

/** A SQLite store over an in-memory database with the tables the review tables refer to, for tests. */
export function sqliteHarness(db: Database = openStore(':memory:')): { readonly store: SqliteChangesetStore; readonly db: Database; close(): void } {
  db.exec('CREATE TABLE IF NOT EXISTS tree_nodes (id TEXT PRIMARY KEY)');
  migrate(db, SWARM_MODULE, swarmMigrations);
  return { store: new SqliteChangesetStore(db), db, close: () => db.close() };
}
