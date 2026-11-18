import type { Caller } from '../commands/types';
import type { Unsubscribe } from '../events/EventBus';
import type { ObserveMode } from '../surfaces/types';
import { migrate, type Database, type Migration } from '../store/index';
import { isBareOrigin } from './origin';
import { OBSERVATION_DEFAULT } from './services';
import type { TabStore } from './TabCatalog';
import {
  ObservationError,
  type BrowserEvent,
  type BrowserTabState,
  type NewObservationLogEntry,
  type ObservationLogEntry,
  type ObservationService,
  type ServiceId,
} from './types';

export const BROWSER_MODULE = 'browser';

export const browserMigrations: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE observation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  session_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX observation_log_node ON observation_log (node_id, id DESC);
CREATE INDEX observation_log_at ON observation_log (at);
CREATE TABLE observation_modes (surface_id TEXT PRIMARY KEY, mode TEXT NOT NULL);
CREATE TABLE browser_tabs (leaf_id TEXT PRIMARY KEY, surface_id TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE browser_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
];

interface LogRow {
  id: number;
  at: string;
  session_id: string;
  folder_id: string;
  node_id: string;
  kind: string;
  origin: string;
  bytes: number;
  outcome: ObservationLogEntry['outcome'];
}

const toEntry = (row: LogRow): ObservationLogEntry => ({
  id: row.id,
  at: row.at,
  sessionId: row.session_id,
  folderId: row.folder_id,
  nodeId: row.node_id,
  kind: row.kind,
  origin: row.origin,
  bytes: row.bytes,
  outcome: row.outcome,
});

/** Observation switches and the access log in the profile database; passes the shared contract suite. */
export class SqliteObservationService implements ObservationService {
  private readonly services = new Map<string, ServiceId>();
  private readonly listeners = new Set<(event: BrowserEvent) => void>();

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    migrate(db, BROWSER_MODULE, browserMigrations);
  }

  register(surfaceId: string, service: ServiceId): void {
    if (!this.services.has(surfaceId)) this.services.set(surfaceId, service);
  }

  forget(surfaceId: string): void {
    this.services.delete(surfaceId);
    this.db.prepare('DELETE FROM observation_modes WHERE surface_id = ?').run(surfaceId);
  }

  mode(surfaceId: string): ObserveMode {
    const service = this.services.get(surfaceId);
    if (service === undefined) throw new ObservationError('not_found', `surface ${surfaceId} is not a recorded browser surface`);
    const row = this.db.prepare('SELECT mode FROM observation_modes WHERE surface_id = ?').get(surfaceId) as { mode: ObserveMode } | undefined;
    return row?.mode ?? OBSERVATION_DEFAULT[service];
  }

  setMode(surfaceId: string, mode: ObserveMode, caller: Caller): void {
    if (caller.kind !== 'ui') throw new ObservationError('not_user', 'only the user changes what an agent may observe');
    const current = this.mode(surfaceId);
    if (current === mode) return;
    this.db.prepare('INSERT INTO observation_modes (surface_id, mode) VALUES (?, ?) ON CONFLICT(surface_id) DO UPDATE SET mode = excluded.mode').run(surfaceId, mode);
    for (const listener of this.listeners) listener({ type: 'browser.observation_changed', surfaceId, mode });
  }

  record(entry: NewObservationLogEntry): ObservationLogEntry {
    if (!isBareOrigin(entry.origin)) throw new ObservationError('invalid', 'the access log keeps the origin only, without path, query or fragment');
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) throw new ObservationError('invalid', 'bytes must be a whole number');
    const at = this.now().toISOString();
    const result = this.db
      .prepare('INSERT INTO observation_log (at, session_id, folder_id, node_id, kind, origin, bytes, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(at, entry.sessionId, entry.folderId, entry.nodeId, entry.kind, entry.origin, entry.bytes, entry.outcome);
    const stored: ObservationLogEntry = { ...entry, id: Number(result.lastInsertRowid), at };
    for (const listener of this.listeners) listener({ type: 'browser.accessed', entry: stored });
    return stored;
  }

  log(filter: { readonly nodeId?: string; readonly sessionId?: string; readonly limit?: number } = {}): ObservationLogEntry[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.nodeId !== undefined) {
      where.push('node_id = ?');
      args.push(filter.nodeId);
    }
    if (filter.sessionId !== undefined) {
      where.push('session_id = ?');
      args.push(filter.sessionId);
    }
    const sql = `SELECT * FROM observation_log ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, filter.limit ?? 100) as unknown as LogRow[]).map(toEntry);
  }

  prune(before: Date): number {
    return Number(this.db.prepare('DELETE FROM observation_log WHERE at < ?').run(before.toISOString()).changes);
  }

  subscribe(listener: (event: BrowserEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Tab states and the number counter in the profile database. */
export class SqliteTabStore implements TabStore {
  constructor(private readonly db: Database) {
    migrate(db, BROWSER_MODULE, browserMigrations);
  }

  load() {
    const rows = this.db.prepare('SELECT leaf_id, surface_id, state FROM browser_tabs').all() as unknown as { leaf_id: string; surface_id: string; state: string }[];
    return rows.map((row) => ({ leafId: row.leaf_id, surfaceId: row.surface_id, state: JSON.parse(row.state) as BrowserTabState }));
  }

  save(leafId: string, surfaceId: string, state: BrowserTabState): void {
    this.db
      .prepare('INSERT INTO browser_tabs (leaf_id, surface_id, state) VALUES (?, ?, ?) ON CONFLICT(leaf_id) DO UPDATE SET state = excluded.state')
      .run(leafId, surfaceId, JSON.stringify(state));
  }

  remove(leafId: string): void {
    this.db.prepare('DELETE FROM browser_tabs WHERE leaf_id = ?').run(leafId);
  }

  counter(): number {
    const row = this.db.prepare("SELECT value FROM browser_meta WHERE key = 'next_tab'").get() as { value: string } | undefined;
    return row === undefined ? 1 : Number(row.value);
  }

  setCounter(next: number): void {
    this.db.prepare("INSERT INTO browser_meta (key, value) VALUES ('next_tab', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(next));
  }
}
