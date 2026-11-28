import { databaseFile, migrate, type Database, type Migration } from '../store/Store';

export const AGENT_WRITABLE_MODULE = 'agent_writable';

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS agent_writable_directories (
  path TEXT PRIMARY KEY CHECK (length(path) > 0),
  recorded_at TEXT NOT NULL
);`;

/** One row for each directory that an agent of the profile was able to write. The app adds rows and never deletes one. */
export const agentWritableMigrations: readonly Migration[] = [{ version: 1, sql: CREATE_TABLE }];

/** A text in single quotes for SQL, inside double quotes for a POSIX shell. */
const sqlText = (text: string): string => `'${text.replace(/'/g, "''").replace(/(["\\$`])/g, '\\$1')}'`;

/**
 * The directories of `AgentWritableRegistry` in the profile database, so the set survives a closed session, a changed
 * option and a restart: what an agent planted in a directory stays there. The database lies in the data directory of
 * the profile. No sandboxed agent or check may write it; a check may not read it, and the srt provider denies a session
 * the read of the database files (`buildSrtSettings`). The constructor makes the table when it is missing, also when
 * the version table says that it exists; it never throws, and `load` and `record` throw what the database says, which
 * the registry reports and tries again later.
 */
export class AgentWritableStore {
  constructor(private readonly db: Database) {
    try {
      migrate(db, AGENT_WRITABLE_MODULE, agentWritableMigrations);
    } catch {
      // A version this build does not know, or a database that cannot be written: `load` and `record` report it.
    }
    try {
      db.exec(CREATE_TABLE);
    } catch {
      // As above.
    }
  }

  load(): string[] {
    return (this.db.prepare('SELECT path FROM agent_writable_directories ORDER BY path').all() as { path: string }[]).map((row) => row.path);
  }

  record(paths: readonly string[], at: Date = new Date()): void {
    const insert = this.db.prepare('INSERT INTO agent_writable_directories (path, recorded_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING');
    for (const path of paths) insert.run(path, at.toISOString());
  }

  /** `sqlite3 '<database>' "DELETE FROM agent_writable_directories WHERE path IN (...)"`, or undefined for a database in memory. */
  forgetCommand(paths: readonly string[]): string | undefined {
    const file = databaseFile(this.db);
    if (file === undefined) return undefined;
    return `sqlite3 '${file.replace(/'/g, "'\\''")}' "DELETE FROM agent_writable_directories WHERE path IN (${paths.map(sqlText).join(', ')})"`;
  }
}
