import { migrate, type Database } from '../store/Store';
import type { LaunchPath, PermissionMode, SessionId } from './types';
import type { NodeId } from '../tree/types';

/** What survives an app restart: enough to list the session and resume it. */
export interface PersistedSession {
  readonly id: SessionId;
  readonly folderId: NodeId;
  readonly title: string;
  readonly cwd: string;
  readonly launchPath: LaunchPath;
  readonly permissionMode: PermissionMode;
  readonly createdAt: string;
}

export interface SessionStore {
  load(): PersistedSession[];
  save(session: PersistedSession): void;
  remove(id: SessionId): void;
}

export class MemorySessionStore implements SessionStore {
  private readonly rows = new Map<SessionId, PersistedSession>();

  load(): PersistedSession[] {
    return [...this.rows.values()];
  }

  save(session: PersistedSession): void {
    this.rows.set(session.id, session);
  }

  remove(id: SessionId): void {
    this.rows.delete(id);
  }
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      launch_path TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  },
];

interface Row {
  id: string;
  folder_id: string;
  title: string;
  cwd: string;
  launch_path: string;
  permission_mode: string;
  created_at: string;
}

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: Database) {
    migrate(db, 'session', MIGRATIONS);
  }

  load(): PersistedSession[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY created_at, id').all() as unknown as Row[];
    return rows.map((row) => ({
      id: row.id,
      folderId: row.folder_id,
      title: row.title,
      cwd: row.cwd,
      launchPath: row.launch_path as LaunchPath,
      permissionMode: row.permission_mode as PermissionMode,
      createdAt: row.created_at,
    }));
  }

  save(session: PersistedSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, folder_id, title, cwd, launch_path, permission_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET folder_id = excluded.folder_id, title = excluded.title`,
      )
      .run(session.id, session.folderId, session.title, session.cwd, session.launchPath, session.permissionMode, session.createdAt);
  }

  remove(id: SessionId): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
}
