import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import type { NodeId } from '../tree/types';

/** Inbox items, tasks and reminders (0016, design 0021). Times are ISO 8601 UTC strings. */

export const ITEM_KINDS = ['status', 'input', 'approval', 'review', 'failure', 'reminder', 'alert'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_STATES = ['new', 'seen', 'snoozed', 'done'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const URGENCIES = ['low', 'normal', 'high'] as const;
export type Urgency = (typeof URGENCIES)[number];

/** The producer class; `origin` names the producer, such as `hook:Stop` or `mcp:inbox_post`. */
export type ItemSource = 'hook' | 'agent' | 'app' | 'scheduler';

export type Resolution = 'answered' | 'approved' | 'denied' | 'dismissed' | 'viewed' | 'superseded' | 'expired' | 'acted';

/** Who wrote `message` and `details`. `agent` text is untrusted and shown as plain text only. */
export type TextAuthor = 'agent' | 'app' | 'user';

export type LinkAnchor =
  | { readonly transcriptPath: string; readonly byteOffset: number }
  | { readonly changesetId: string; readonly file?: string; readonly hunk?: number }
  | { readonly url: string }
  | { readonly surfaceId: string };

export const MESSAGE_MAX = 140;
export const DETAILS_MAX = 8000;

export interface InboxItem {
  readonly id: string;
  /** `null` is the top level. */
  readonly folderId: NodeId | null;
  /** The item's folder was removed from the tree; the item moved to the top level. */
  readonly folderRemoved: boolean;
  readonly kind: ItemKind;
  readonly state: ItemState;
  readonly urgency: Urgency;
  readonly source: ItemSource;
  readonly origin: string;
  readonly sessionId?: SessionId;
  readonly agentId?: string;
  readonly linkNodeId?: NodeId;
  readonly linkAnchor?: LinkAnchor;
  /** One line, at most `MESSAGE_MAX` characters. */
  readonly message: string;
  /** At most `DETAILS_MAX` characters. */
  readonly details?: string;
  readonly textAuthor: TextAuthor;
  /** JSON per kind, such as the raw tool input of an approval. */
  readonly payload?: unknown;
  /** Repeats of an open item with the same key coalesce into it. */
  readonly dedupeKey?: string;
  readonly occurrences: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly seenAt?: string;
  readonly snoozedUntil?: string;
  readonly doneAt?: string;
  readonly resolution?: Resolution;
}

export interface NewItem {
  readonly folderId: NodeId | null;
  readonly kind: ItemKind;
  readonly urgency?: Urgency;
  readonly source: ItemSource;
  readonly origin: string;
  readonly sessionId?: SessionId;
  readonly agentId?: string;
  readonly linkNodeId?: NodeId;
  readonly linkAnchor?: LinkAnchor;
  readonly message: string;
  readonly details?: string;
  readonly textAuthor: TextAuthor;
  readonly payload?: unknown;
  readonly dedupeKey?: string;
}

export interface ItemQuery {
  /** The folder and its descendants. Absent: every item, including the top level. `null`: top-level items only. */
  readonly folderId?: NodeId | null;
  readonly states?: readonly ItemState[];
  readonly kinds?: readonly ItemKind[];
  readonly minUrgency?: Urgency;
  readonly sessionId?: SessionId;
  readonly limit?: number;
}

export type InboxErrorCode = 'not_found' | 'invalid' | 'invalid_transition';

export class InboxError extends Error {
  constructor(
    readonly code: InboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InboxError';
  }
}

export type ItemChange = 'created' | 'coalesced' | 'updated' | 'resolved';

export type InboxEvent =
  | { readonly type: 'inbox.item_changed'; readonly item: InboxItem; readonly change: ItemChange }
  /** Unread items: state `new`, urgency `normal` or `high`. Emitted when the count changes. */
  | { readonly type: 'inbox.unread_changed'; readonly count: number };

/**
 * The item store with its state machine (0021 sections 1, 2 and 8). Operations are synchronous, like the
 * tree. Every failing operation throws `InboxError` and changes nothing. Text is cleaned at this boundary:
 * control characters, ANSI escape sequences and bidirectional overrides are removed. When a folder is
 * removed from the tree, its items move to the top level with `folderRemoved` set.
 */
export interface InboxService {
  /** Creates an item, or coalesces into the open item with the same `dedupeKey` and returns it to `new`. */
  post(input: NewItem): { readonly item: InboxItem; readonly coalesced: boolean };
  get(id: string): InboxItem | undefined;
  /** Ordered by urgency (high first), then by `updatedAt` (newest first). */
  list(query?: ItemQuery): InboxItem[];
  /** `new` to `seen`; `seen` stays. */
  markSeen(id: string): InboxItem;
  /** `seen` to `new`; `new` stays. */
  markUnread(id: string): InboxItem;
  /** `new`, `seen` or `snoozed` to `snoozed` until the given time. */
  snooze(id: string, until: string): InboxItem;
  /** Returns snoozed items whose time has passed to `new`. */
  wakeDue(): InboxItem[];
  /** Any open state to `done` with the resolution. */
  resolve(id: string, resolution: Resolution): InboxItem;
  /** `done` to `seen`. Clears the item's dedupe key, which an open item may hold by now. */
  reopen(id: string): InboxItem;
  /** Resolves the open item with this key, if there is one. */
  resolveByDedupeKey(dedupeKey: string, resolution: Resolution): InboxItem | undefined;
  /** Resolves the session's open items of the given kinds, optionally only those from the given origins. */
  resolveSessionItems(sessionId: SessionId, kinds: readonly ItemKind[], resolution: Resolution, origins?: readonly string[]): InboxItem[];
  /** Moves the session's open items to another folder; done items keep theirs. Returns the moved items. */
  moveSessionItems(sessionId: SessionId, folderId: NodeId | null): InboxItem[];
  unreadCount(): number;
  subscribe(listener: (event: InboxEvent) => void): Unsubscribe;
}

export type TaskState = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface Task {
  readonly id: string;
  readonly folderId: NodeId | null;
  readonly linkNodeId?: NodeId;
  readonly title: string;
  readonly notes?: string;
  readonly state: TaskState;
  readonly owner: { readonly kind: 'user' } | { readonly kind: 'agent'; readonly sessionId: SessionId };
  readonly externalUrl?: string;
  readonly dueAt?: string;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export type CatchUp = 'latest' | 'each' | 'none';

/**
 * A reminder or scheduled agent run. `dtstart` is local wall time in `tzid`; `rrule` is the RFC 5545 subset
 * of 0021 section 7, absent for a one-off.
 */
export interface Schedule {
  readonly id: string;
  readonly kind: 'reminder' | 'agent_run';
  readonly folderId: NodeId | null;
  readonly linkNodeId?: NodeId;
  readonly taskId?: string;
  readonly title: string;
  readonly details?: string;
  readonly dtstart: string;
  readonly tzid: string;
  readonly rrule?: string;
  readonly catchUp: CatchUp;
  /** Agent runs only. */
  readonly prompt?: string;
  readonly approvedAt?: string;
  readonly enabled: boolean;
  readonly nextDueAt?: string;
  readonly lastDueAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ScheduleRunOutcome = 'fired' | 'caught_up' | 'folded' | 'skipped';
