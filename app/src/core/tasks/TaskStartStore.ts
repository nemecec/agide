import { migrate, type Database, type Migration } from '../store/index';
import type { PermissionMode } from '../session/types';
import type { TaskSourceKind, TaskStartRecord } from './types';

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `CREATE TABLE task_starts (
      folder_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      repo_path TEXT,
      worktree_path TEXT,
      branch TEXT,
      base TEXT,
      session_id TEXT NOT NULL,
      permission_mode TEXT NOT NULL,
      started_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX task_starts_session ON task_starts (session_id);`,
  },
];

interface Row {
  folder_id: string;
  source_kind: string;
  source_ref: string;
  repo_path: string | null;
  worktree_path: string | null;
  branch: string | null;
  base: string | null;
  session_id: string;
  permission_mode: string;
  started_by: string;
  created_at: string;
}

export type StartedBy = 'user' | 'agent';

/** The `task_starts` table (0028 section 10). The folder title, this row and `task-source.md` hold the source text. */
export class TaskStartStore {
  constructor(private readonly db: Database) {
    migrate(db, 'taskstart', MIGRATIONS);
  }

  insert(record: TaskStartRecord, startedBy: StartedBy): void {
    this.db
      .prepare(
        `INSERT INTO task_starts (folder_id, source_kind, source_ref, repo_path, worktree_path, branch, base, session_id, permission_mode, started_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.folderId,
        record.sourceKind,
        record.sourceRef,
        record.repoPath ?? null,
        record.worktreePath ?? null,
        record.branch ?? null,
        record.base ?? null,
        record.sessionId,
        record.permissionMode,
        startedBy,
        record.createdAt,
      );
  }

  get(folderId: string): TaskStartRecord | undefined {
    const row = this.db.prepare('SELECT * FROM task_starts WHERE folder_id = ?').get(folderId) as Row | undefined;
    return row && toRecord(row);
  }

  /** Repositories used by earlier starts, newest first. */
  repositories(): string[] {
    const rows = this.db
      .prepare('SELECT repo_path FROM task_starts WHERE repo_path IS NOT NULL GROUP BY repo_path ORDER BY MAX(created_at) DESC, repo_path')
      .all() as { repo_path: string }[];
    return rows.map((row) => row.repo_path);
  }

  /** Sessions that agents started, for the concurrent-agent cap. */
  agentSessionIds(): string[] {
    return (this.db.prepare("SELECT session_id FROM task_starts WHERE started_by = 'agent'").all() as { session_id: string }[]).map((row) => row.session_id);
  }
}

function toRecord(row: Row): TaskStartRecord {
  return {
    folderId: row.folder_id,
    sourceKind: row.source_kind as TaskSourceKind,
    sourceRef: row.source_ref,
    ...(row.repo_path === null ? {} : { repoPath: row.repo_path }),
    ...(row.worktree_path === null ? {} : { worktreePath: row.worktree_path }),
    ...(row.branch === null ? {} : { branch: row.branch }),
    ...(row.base === null ? {} : { base: row.base }),
    sessionId: row.session_id,
    permissionMode: row.permission_mode as PermissionMode,
    createdAt: row.created_at,
  };
}
