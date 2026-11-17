import type { Database } from '../store/index';
import { migrate } from '../store/index';
import type { LayoutDocument } from '../blocks/layout';

export type ChangeSource = 'ui' | 'mcp' | 'file' | 'undo' | 'preset';

export interface HistoryEntry {
  readonly layoutId: string;
  readonly revision: number;
  readonly document: LayoutDocument;
  readonly source: ChangeSource;
  readonly at: number;
}

/** Bounded record of the applied revisions of each layout. Undo reads an earlier revision from here. */
export interface LayoutHistory {
  record(entry: HistoryEntry): void;
  get(layoutId: string, revision: number): HistoryEntry | undefined;
  /** Newest first. */
  list(layoutId: string): Omit<HistoryEntry, 'document'>[];
}

export const HISTORY_LIMIT = 50;

export class InMemoryLayoutHistory implements LayoutHistory {
  private readonly entries = new Map<string, HistoryEntry[]>();

  record(entry: HistoryEntry): void {
    const list = (this.entries.get(entry.layoutId) ?? []).filter((e) => e.revision !== entry.revision);
    list.push({ ...entry, document: structuredClone(entry.document) });
    list.sort((a, b) => a.revision - b.revision);
    this.entries.set(entry.layoutId, list.slice(-HISTORY_LIMIT));
  }

  get(layoutId: string, revision: number): HistoryEntry | undefined {
    const found = this.entries.get(layoutId)?.find((e) => e.revision === revision);
    return found && { ...found, document: structuredClone(found.document) };
  }

  list(layoutId: string): Omit<HistoryEntry, 'document'>[] {
    return [...(this.entries.get(layoutId) ?? [])].reverse().map(({ document: _document, ...rest }) => rest);
  }
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `CREATE TABLE layout_history (
      layout_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      document TEXT NOT NULL,
      source TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (layout_id, revision)
    )`,
  },
];

export class SqliteLayoutHistory implements LayoutHistory {
  constructor(private readonly db: Database) {
    migrate(db, 'layout', MIGRATIONS);
  }

  record(entry: HistoryEntry): void {
    this.db
      .prepare('INSERT OR REPLACE INTO layout_history (layout_id, revision, document, source, at) VALUES (?, ?, ?, ?, ?)')
      .run(entry.layoutId, entry.revision, JSON.stringify(entry.document), entry.source, entry.at);
    this.db
      .prepare(
        'DELETE FROM layout_history WHERE layout_id = ? AND revision NOT IN (SELECT revision FROM layout_history WHERE layout_id = ? ORDER BY revision DESC LIMIT ?)',
      )
      .run(entry.layoutId, entry.layoutId, HISTORY_LIMIT);
  }

  get(layoutId: string, revision: number): HistoryEntry | undefined {
    const row = this.db.prepare('SELECT * FROM layout_history WHERE layout_id = ? AND revision = ?').get(layoutId, revision) as
      | { document: string; source: ChangeSource; at: number }
      | undefined;
    return row && { layoutId, revision, document: JSON.parse(row.document) as LayoutDocument, source: row.source, at: row.at };
  }

  list(layoutId: string): Omit<HistoryEntry, 'document'>[] {
    const rows = this.db.prepare('SELECT revision, source, at FROM layout_history WHERE layout_id = ? ORDER BY revision DESC').all(layoutId) as {
      revision: number;
      source: ChangeSource;
      at: number;
    }[];
    return rows.map((row) => ({ layoutId, ...row }));
  }
}
