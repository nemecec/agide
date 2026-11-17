import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import type { NodeId, TreeService } from '../tree/types';
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
  type NewItem,
  type Resolution,
  type Urgency,
} from './types';

const URGENCY_RANK: Record<Urgency, number> = { low: 0, normal: 1, high: 2 };
const isOpen = (item: InboxItem): boolean => item.state !== 'done';
const isUnread = (item: InboxItem): boolean => item.state === 'new' && item.urgency !== 'low';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface InMemoryInboxServiceOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
  readonly onListenerError?: (error: unknown) => void;
}

/** Reference implementation of `InboxService`. The SQLite store must pass the same contract. */
export class InMemoryInboxService implements InboxService {
  private readonly items = new Map<string, InboxItem>();
  private readonly listeners = new Set<(event: InboxEvent) => void>();
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly onListenerError: (error: unknown) => void;
  private lastUnread = 0;
  private readonly unsubscribeTree: Unsubscribe;

  constructor(
    private readonly tree: TreeService,
    options: InMemoryInboxServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
    this.onListenerError = options.onListenerError ?? ((error) => console.error(error));
    this.unsubscribeTree = tree.subscribe((event) => {
      if (event.type !== 'tree.subtree_removed') return;
      const removed = new Set(event.removed.map((node) => node.id));
      for (const item of [...this.items.values()]) {
        if (item.folderId !== null && removed.has(item.folderId)) this.store({ ...item, folderId: null, folderRemoved: true }, 'updated');
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
    const details = input.details === undefined ? undefined : cleanText(input.details);
    if (message.length === 0 || message.length > 140) throw new InboxError('invalid', 'message must hold 1 to 140 characters after cleaning');
    if (input.folderId !== null && this.tree.get(input.folderId) === undefined) throw new InboxError('invalid', `no folder ${input.folderId}`);
    const time = this.now().toISOString();
    const existing = input.dedupeKey === undefined ? undefined : this.openByKey(input.dedupeKey);
    if (existing) {
      const { snoozedUntil: _snoozed, details: _details, ...rest } = existing;
      const item: InboxItem = {
        ...rest,
        state: 'new',
        message,
        ...(details === undefined ? {} : { details }),
        ...(input.payload === undefined ? {} : { payload: input.payload }),
        urgency: input.urgency ?? existing.urgency,
        occurrences: existing.occurrences + 1,
        updatedAt: time,
      };
      this.store(item, 'coalesced');
      return { item, coalesced: true };
    }
    const item: InboxItem = {
      id: this.newId(),
      folderId: input.folderId,
      folderRemoved: false,
      kind: input.kind,
      state: 'new',
      urgency: input.urgency ?? 'normal',
      source: input.source,
      origin: input.origin,
      ...optional('sessionId', input.sessionId),
      ...optional('agentId', input.agentId),
      ...optional('linkNodeId', input.linkNodeId),
      ...optional('linkAnchor', input.linkAnchor),
      message,
      ...optional('details', details),
      textAuthor: input.textAuthor,
      ...optional('payload', input.payload),
      ...optional('dedupeKey', input.dedupeKey),
      occurrences: 1,
      createdAt: time,
      updatedAt: time,
    };
    this.store(item, 'created');
    return { item, coalesced: false };
  }

  get(id: string): InboxItem | undefined {
    return this.items.get(id);
  }

  list(query: ItemQuery = {}): InboxItem[] {
    const minRank = URGENCY_RANK[query.minUrgency ?? 'low'];
    const matches = [...this.items.values()].filter(
      (item) =>
        this.inFolder(item, query.folderId) &&
        (query.states === undefined || query.states.includes(item.state)) &&
        (query.kinds === undefined || query.kinds.includes(item.kind)) &&
        (query.sessionId === undefined || item.sessionId === query.sessionId) &&
        URGENCY_RANK[item.urgency] >= minRank,
    );
    matches.sort((a, b) => URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return query.limit === undefined ? matches : matches.slice(0, query.limit);
  }

  markSeen(id: string): InboxItem {
    const item = this.require(id, ['new', 'seen'], 'mark seen');
    if (item.state === 'seen') return item;
    return this.update(item, { state: 'seen', seenAt: this.now().toISOString() });
  }

  markUnread(id: string): InboxItem {
    const item = this.require(id, ['new', 'seen'], 'mark unread');
    if (item.state === 'new') return item;
    return this.update(item, { state: 'new' });
  }

  snooze(id: string, until: string): InboxItem {
    if (Number.isNaN(Date.parse(until))) throw new InboxError('invalid', `snooze time ${until} is not a date`);
    const item = this.require(id, ['new', 'seen', 'snoozed'], 'snooze');
    return this.update(item, { state: 'snoozed', snoozedUntil: new Date(until).toISOString() });
  }

  wakeDue(): InboxItem[] {
    const now = this.now().getTime();
    return [...this.items.values()]
      .filter((item) => item.state === 'snoozed' && Date.parse(item.snoozedUntil ?? '') <= now)
      .map((item) => {
        const { snoozedUntil: _until, ...rest } = item;
        return this.replace({ ...rest, state: 'new', updatedAt: this.now().toISOString() }, 'updated');
      });
  }

  resolve(id: string, resolution: Resolution): InboxItem {
    const item = this.require(id, ['new', 'seen', 'snoozed'], 'resolve');
    const { snoozedUntil: _until, ...rest } = item;
    const time = this.now().toISOString();
    return this.replace({ ...rest, state: 'done', doneAt: time, resolution, updatedAt: time }, 'resolved');
  }

  reopen(id: string): InboxItem {
    const item = this.require(id, ['done'], 'reopen');
    const { doneAt: _doneAt, resolution: _resolution, dedupeKey: _key, ...rest } = item;
    return this.replace({ ...rest, state: 'seen', updatedAt: this.now().toISOString() }, 'updated');
  }

  resolveByDedupeKey(dedupeKey: string, resolution: Resolution): InboxItem | undefined {
    const item = this.openByKey(dedupeKey);
    return item ? this.resolve(item.id, resolution) : undefined;
  }

  resolveSessionItems(sessionId: SessionId, kinds: readonly ItemKind[], resolution: Resolution, origins?: readonly string[]): InboxItem[] {
    return [...this.items.values()]
      .filter((item) => item.sessionId === sessionId && isOpen(item) && kinds.includes(item.kind) && (origins === undefined || origins.includes(item.origin)))
      .map((item) => this.resolve(item.id, resolution));
  }

  moveSessionItems(sessionId: SessionId, folderId: NodeId | null): InboxItem[] {
    return [...this.items.values()]
      .filter((item) => item.sessionId === sessionId && isOpen(item) && item.folderId !== folderId)
      .map((item) => this.replace({ ...item, folderId, folderRemoved: false, updatedAt: this.now().toISOString() }, 'updated'));
  }

  unreadCount(): number {
    return [...this.items.values()].filter(isUnread).length;
  }

  subscribe(listener: (event: InboxEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private inFolder(item: InboxItem, folderId: NodeId | null | undefined): boolean {
    if (folderId === undefined) return true;
    if (folderId === null) return item.folderId === null;
    return item.folderId !== null && this.tree.isWithin(item.folderId, folderId);
  }

  private openByKey(dedupeKey: string): InboxItem | undefined {
    return [...this.items.values()].find((item) => item.dedupeKey === dedupeKey && isOpen(item));
  }

  private require(id: string, from: readonly ItemState[], action: string): InboxItem {
    const item = this.items.get(id);
    if (!item) throw new InboxError('not_found', `no inbox item ${id}`);
    if (!from.includes(item.state)) throw new InboxError('invalid_transition', `cannot ${action} an item in state ${item.state}`);
    return item;
  }

  private update(item: InboxItem, change: Partial<Mutable<InboxItem>>): InboxItem {
    return this.replace({ ...item, ...change, updatedAt: this.now().toISOString() } as InboxItem, 'updated');
  }

  private replace(item: InboxItem, change: ItemChange): InboxItem {
    this.store(item, change);
    return item;
  }

  private store(item: InboxItem, change: ItemChange): void {
    this.items.set(item.id, item);
    this.emit({ type: 'inbox.item_changed', item, change });
    const unread = this.unreadCount();
    if (unread !== this.lastUnread) {
      this.lastUnread = unread;
      this.emit({ type: 'inbox.unread_changed', count: unread });
    }
  }

  private emit(event: InboxEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : ({ [key]: value } as { [P in K]: V });
}
