import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import { migrate, type Database } from '../store/index';
import type { NodeId, TreeService } from '../tree/types';
import { INBOX_MODULE, inboxMigrations } from './inboxMigrations';
import { newItemSchema } from './schemas';
import { cleanLine, cleanText } from './text';
import {
  InboxError,
  type InboxEvent,
  type InboxItem,
  type InboxService,
  type ItemChange,
  type ItemKind,
  type ItemQuery,
  type ItemState,
  type LinkAnchor,
  type NewItem,
  type Resolution,
} from './types';

interface Row {
  id: string;
  folder_id: string | null;
  folder_removed: number;
  kind: ItemKind;
  state: ItemState;
  urgency: InboxItem['urgency'];
  source: InboxItem['source'];
  origin: string;
  session_id: string | null;
  agent_id: string | null;
  link_node_id: string | null;
  link_anchor: string | null;
  message: string;
  details: string | null;
  text_author: InboxItem['textAuthor'];
  payload: string | null;
  dedupe_key: string | null;
  occurrences: number;
  created_at: string;
  updated_at: string;
  seen_at: string | null;
  snoozed_until: string | null;
  done_at: string | null;
  resolution: Resolution | null;
}

const URGENCY_SQL = "CASE urgency WHEN 'high' THEN 2 WHEN 'normal' THEN 1 ELSE 0 END";
const OPEN = "state <> 'done'";

function toItem(row: Row): InboxItem {
  return {
    id: row.id,
    folderId: row.folder_id,
    folderRemoved: row.folder_removed === 1,
    kind: row.kind,
    state: row.state,
    urgency: row.urgency,
    source: row.source,
    origin: row.origin,
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
    ...(row.link_node_id === null ? {} : { linkNodeId: row.link_node_id }),
    ...(row.link_anchor === null ? {} : { linkAnchor: JSON.parse(row.link_anchor) as LinkAnchor }),
    message: row.message,
    ...(row.details === null ? {} : { details: row.details }),
    textAuthor: row.text_author,
    ...(row.payload === null ? {} : { payload: JSON.parse(row.payload) as unknown }),
    ...(row.dedupe_key === null ? {} : { dedupeKey: row.dedupe_key }),
    occurrences: row.occurrences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.seen_at === null ? {} : { seenAt: row.seen_at }),
    ...(row.snoozed_until === null ? {} : { snoozedUntil: row.snoozed_until }),
    ...(row.done_at === null ? {} : { doneAt: row.done_at }),
    ...(row.resolution === null ? {} : { resolution: row.resolution }),
  };
}

export interface SqliteInboxServiceOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly onListenerError?: (error: unknown) => void;
}

/** `InboxService` over the app database. Passes the same contract suite as the in-memory service. */
/** Returned by `SqliteInboxService.holdEvents`. */
export interface EventHold {
  release(): void;
  discard(): void;
}

export class SqliteInboxService implements InboxService {
  private readonly listeners = new Set<(event: InboxEvent) => void>();
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly onListenerError: (error: unknown) => void;
  private readonly announcedRemoved = new Set<string>();
  private lastUnread: number;
  private held: InboxEvent[] | undefined;
  private readonly unsubscribeTree: Unsubscribe;

  constructor(
    private readonly db: Database,
    private readonly tree: TreeService,
    options: SqliteInboxServiceOptions = {},
  ) {
    migrate(db, INBOX_MODULE, inboxMigrations);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
    this.onListenerError = options.onListenerError ?? ((error) => console.error(error));
    this.lastUnread = this.unreadCount();
    for (const row of this.db.prepare('SELECT id FROM inbox_items WHERE folder_removed = 1').all() as { id: string }[]) {
      this.announcedRemoved.add(row.id);
    }
    // The trigger marks the items; this reports them once the tree change is committed.
    this.unsubscribeTree = tree.subscribe((event) => {
      if (event.type !== 'tree.subtree_removed') return;
      for (const row of this.db.prepare('SELECT * FROM inbox_items WHERE folder_removed = 1').all() as unknown as Row[]) {
        if (this.announcedRemoved.has(row.id)) continue;
        this.announcedRemoved.add(row.id);
        this.changed(toItem(row), 'updated');
      }
    });
  }

  dispose(): void {
    this.unsubscribeTree();
  }

  post(input: NewItem): { item: InboxItem; coalesced: boolean } {
    const parsed = newItemSchema.safeParse(input);
    if (!parsed.success) throw new InboxError('invalid', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const message = cleanLine(input.message);
    const details = input.details === undefined ? null : cleanText(input.details);
    if (message.length === 0 || message.length > 140) throw new InboxError('invalid', 'message must hold 1 to 140 characters after cleaning');
    if (input.folderId !== null && this.tree.get(input.folderId) === undefined) throw new InboxError('invalid', `no folder ${input.folderId}`);
    if (input.linkNodeId !== undefined && this.tree.get(input.linkNodeId) === undefined) throw new InboxError('invalid', `no node ${input.linkNodeId}`);
    const time = this.now().toISOString();
    const existing = input.dedupeKey === undefined ? undefined : this.openByKey(input.dedupeKey);
    if (existing) {
      this.db
        .prepare(
          `UPDATE inbox_items SET state = 'new', snoozed_until = NULL, message = ?, details = ?, payload = COALESCE(?, payload),
             urgency = ?, occurrences = occurrences + 1, updated_at = ? WHERE id = ?`,
        )
        .run(message, details, input.payload === undefined ? null : JSON.stringify(input.payload), input.urgency ?? existing.urgency, time, existing.id);
      const item = this.require(existing.id);
      this.changed(item, 'coalesced');
      return { item, coalesced: true };
    }
    const id = this.newId();
    this.db
      .prepare(
        `INSERT INTO inbox_items (id, folder_id, kind, urgency, source, origin, session_id, agent_id, link_node_id, link_anchor,
           message, details, text_author, payload, dedupe_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.folderId,
        input.kind,
        input.urgency ?? 'normal',
        input.source,
        input.origin,
        input.sessionId ?? null,
        input.agentId ?? null,
        input.linkNodeId ?? null,
        input.linkAnchor === undefined ? null : JSON.stringify(input.linkAnchor),
        message,
        details,
        input.textAuthor,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.dedupeKey ?? null,
        time,
        time,
      );
    const item = this.require(id);
    this.changed(item, 'created');
    return { item, coalesced: false };
  }

  get(id: string): InboxItem | undefined {
    const row = this.db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id) as Row | undefined;
    return row && toItem(row);
  }

  list(query: ItemQuery = {}): InboxItem[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (query.folderId === null) where.push('folder_id IS NULL');
    else if (query.folderId !== undefined) {
      where.push(`folder_id IN (WITH RECURSIVE d(id) AS (SELECT ? UNION SELECT n.id FROM tree_nodes n JOIN d ON n.parent_id = d.id) SELECT id FROM d)`);
      args.push(query.folderId);
    }
    const inList = (column: string, values: readonly string[] | undefined): void => {
      if (values === undefined) return;
      where.push(`${column} IN (${values.map(() => '?').join(', ') || 'NULL'})`);
      args.push(...values);
    };
    inList('state', query.states);
    inList('kind', query.kinds);
    if (query.sessionId !== undefined) {
      where.push('session_id = ?');
      args.push(query.sessionId);
    }
    if (query.minUrgency !== undefined) {
      where.push(`${URGENCY_SQL} >= ${{ low: 0, normal: 1, high: 2 }[query.minUrgency]}`);
    }
    const sql = `SELECT * FROM inbox_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${URGENCY_SQL} DESC, updated_at DESC, id ASC ${query.limit === undefined ? '' : 'LIMIT ?'}`;
    if (query.limit !== undefined) args.push(query.limit);
    return (this.db.prepare(sql).all(...args) as unknown as Row[]).map(toItem);
  }

  markSeen(id: string): InboxItem {
    const item = this.requireIn(id, ['new', 'seen'], 'mark seen');
    if (item.state === 'seen') return item;
    const time = this.stamp();
    return this.apply("UPDATE inbox_items SET state = 'seen', seen_at = ?, updated_at = ? WHERE id = ?", [time, time], id, 'updated');
  }

  markUnread(id: string): InboxItem {
    const item = this.requireIn(id, ['new', 'seen'], 'mark unread');
    if (item.state === 'new') return item;
    return this.apply("UPDATE inbox_items SET state = 'new', updated_at = ? WHERE id = ?", [this.stamp()], id, 'updated');
  }

  snooze(id: string, until: string): InboxItem {
    if (Number.isNaN(Date.parse(until))) throw new InboxError('invalid', `snooze time ${until} is not a date`);
    this.requireIn(id, ['new', 'seen', 'snoozed'], 'snooze');
    return this.apply(
      "UPDATE inbox_items SET state = 'snoozed', snoozed_until = ?, updated_at = ? WHERE id = ?",
      [new Date(until).toISOString(), this.stamp()],
      id,
      'updated',
    );
  }

  /** The earliest `snoozedUntil` of a snoozed item. */
  nextWake(): string | undefined {
    const row = this.db.prepare("SELECT MIN(snoozed_until) AS t FROM inbox_items WHERE state = 'snoozed'").get() as { t: string | null };
    return row.t ?? undefined;
  }

  wakeDue(): InboxItem[] {
    const rows = this.db.prepare("SELECT id FROM inbox_items WHERE state = 'snoozed' AND snoozed_until <= ?").all(this.stamp()) as { id: string }[];
    return rows.map(({ id }) =>
      this.apply("UPDATE inbox_items SET state = 'new', snoozed_until = NULL, updated_at = ? WHERE id = ?", [this.stamp()], id, 'updated'),
    );
  }

  resolve(id: string, resolution: Resolution): InboxItem {
    this.requireIn(id, ['new', 'seen', 'snoozed'], 'resolve');
    const time = this.stamp();
    return this.apply(
      "UPDATE inbox_items SET state = 'done', snoozed_until = NULL, done_at = ?, resolution = ?, updated_at = ? WHERE id = ?",
      [time, resolution, time],
      id,
      'resolved',
    );
  }

  reopen(id: string): InboxItem {
    this.requireIn(id, ['done'], 'reopen');
    return this.apply(
      "UPDATE inbox_items SET state = 'seen', done_at = NULL, resolution = NULL, dedupe_key = NULL, updated_at = ? WHERE id = ?",
      [this.stamp()],
      id,
      'updated',
    );
  }

  resolveByDedupeKey(dedupeKey: string, resolution: Resolution): InboxItem | undefined {
    const item = this.openByKey(dedupeKey);
    return item ? this.resolve(item.id, resolution) : undefined;
  }

  resolveSessionItems(sessionId: SessionId, kinds: readonly ItemKind[], resolution: Resolution, origins?: readonly string[]): InboxItem[] {
    return this.list({ sessionId, states: ['new', 'seen', 'snoozed'], kinds })
      .filter((item) => origins === undefined || origins.includes(item.origin))
      .map((item) => this.resolve(item.id, resolution));
  }

  moveSessionItems(sessionId: SessionId, folderId: NodeId | null): InboxItem[] {
    const rows = this.db
      .prepare(`SELECT id FROM inbox_items WHERE session_id = ? AND ${OPEN} AND folder_id IS NOT ?`)
      .all(sessionId, folderId) as { id: string }[];
    return rows.map(({ id }) =>
      this.apply('UPDATE inbox_items SET folder_id = ?, folder_removed = 0, updated_at = ? WHERE id = ?', [folderId, this.stamp()], id, 'updated'),
    );
  }

  unreadCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE state = 'new' AND urgency <> 'low'").get() as { n: number };
    return row.n;
  }

  subscribe(listener: (event: InboxEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  /** Runs an UPDATE with the bound values, then reads the item back and reports the change. */
  private apply(sql: string, values: (string | null)[], id: string, change: ItemChange): InboxItem {
    this.db.prepare(sql).run(...values, id);
    const item = this.require(id);
    this.changed(item, change);
    return item;
  }

  private openByKey(dedupeKey: string): InboxItem | undefined {
    const row = this.db.prepare(`SELECT * FROM inbox_items WHERE dedupe_key = ? AND ${OPEN}`).get(dedupeKey) as Row | undefined;
    return row && toItem(row);
  }

  private require(id: string): InboxItem {
    const item = this.get(id);
    if (!item) throw new InboxError('not_found', `no inbox item ${id}`);
    return item;
  }

  private requireIn(id: string, from: readonly ItemState[], action: string): InboxItem {
    const item = this.require(id);
    if (!from.includes(item.state)) throw new InboxError('invalid_transition', `cannot ${action} an item in state ${item.state}`);
    return item;
  }

  /**
   * Keeps events back while the caller's database transaction runs. `release` reports them after the commit and
   * `discard` drops them after a rollback, so listeners never see an item that does not exist.
   */
  holdEvents(): EventHold {
    const events: InboxEvent[] = [];
    this.held = events;
    return {
      release: () => {
        this.held = undefined;
        for (const event of events) this.emit(event);
        this.reportUnread();
      },
      discard: () => {
        this.held = undefined;
      },
    };
  }

  private changed(item: InboxItem, change: ItemChange): void {
    this.emit({ type: 'inbox.item_changed', item, change });
    if (this.held === undefined) this.reportUnread();
  }

  private reportUnread(): void {
    const unread = this.unreadCount();
    if (unread !== this.lastUnread) {
      this.lastUnread = unread;
      this.emit({ type: 'inbox.unread_changed', count: unread });
    }
  }

  private emit(event: InboxEvent): void {
    if (this.held !== undefined) {
      this.held.push(event);
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}
