import { databaseFile, migrate, type Database, type Migration } from '../store/Store';

export const AGENT_WRITABLE_MODULE = 'agent_writable';

const TABLE = 'agent_writable_directories';

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  path TEXT PRIMARY KEY CHECK (length(path) > 0),
  recorded_at TEXT NOT NULL
);`;

/** One row for each directory that an agent of the profile was able to write. The app adds rows and never deletes one. */
export const agentWritableMigrations: readonly Migration[] = [{ version: 1, sql: CREATE_TABLE }];

/** A word in single quotes for a POSIX shell: nothing inside is expanded, also `!` in an interactive zsh or bash. */
const shellWord = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

/** A text in single quotes for SQL. */
const sqlText = (text: string): string => `'${text.replace(/'/g, "''")}'`;

function tableExists(db: Database): boolean {
  try {
    return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(TABLE) !== undefined;
  } catch {
    return true;
  }
}

/**
 * The directories of `AgentWritableRegistry` in the profile database, so the set survives a closed session, a changed
 * option and a restart: what an agent planted in a directory stays there. The database lies in the data directory of
 * the profile. No sandboxed agent or check may write it; a check may not read it, and the srt provider denies a session
 * the read of the database files of every profile (`buildSrtSettings`). The constructor makes the table when it is
 * missing, also when the version table says that it exists; it never throws, and `load` and `record` throw what the
 * database says, which the registry reports and tries again later.
 */
export class AgentWritableStore {
  /** True when this start made the table: the database comes from a build without it, or its table was lost. */
  readonly created: boolean;

  constructor(private readonly db: Database) {
    const existed = tableExists(db);
    try {
      migrate(db, AGENT_WRITABLE_MODULE, agentWritableMigrations);
    } catch {
      // A version this build does not know, or a database that cannot be written: `load` and `record` report it.
    }
    let made = false;
    try {
      db.exec(CREATE_TABLE);
      made = !existed;
    } catch {
      // As above.
    }
    this.created = made;
  }

  load(): string[] {
    return (this.db.prepare(`SELECT path FROM ${TABLE} ORDER BY path`).all() as { path: string }[]).map((row) => row.path);
  }

  record(paths: readonly string[], at: Date = new Date()): void {
    const insert = this.db.prepare(`INSERT INTO ${TABLE} (path, recorded_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING`);
    for (const path of paths) insert.run(path, at.toISOString());
  }

  /** `sqlite3 '<database>' 'DELETE FROM agent_writable_directories WHERE path IN (...)'`, each part one shell word in single quotes, or undefined for a database in memory. */
  forgetCommand(paths: readonly string[]): string | undefined {
    const file = databaseFile(this.db);
    if (file === undefined) return undefined;
    return `sqlite3 ${shellWord(file)} ${shellWord(`DELETE FROM ${TABLE} WHERE path IN (${paths.map(sqlText).join(', ')})`)}`;
  }
}
