import type { NodeId } from '../tree/types';
import type { InboxItem, ItemKind, ItemSource, ItemState, Urgency } from './types';

/** An item with the names the list shows. */
export interface ItemRow extends InboxItem {
  readonly projectName?: string;
  readonly sessionName?: string;
}

/**
 * The project and session layers of an item (0021 section 5, amended by 0043 section 3). A session summary is not
 * part of an item's context: it shows on the session's row in the tree.
 */
export interface ItemContextInfo {
  readonly project?: { readonly id: NodeId; readonly name: string; readonly summary?: string; readonly summaryUpdatedAt?: string };
  readonly session?: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
  };
}

/** Saved views and the built-in ones (0043 section 4.6). */
export interface ViewFilter {
  readonly kinds?: readonly ItemKind[];
  readonly states?: readonly ItemState[];
  readonly minUrgency?: Urgency;
  readonly sources?: readonly ItemSource[];
  /** Case-insensitive substring of message and details. */
  readonly text?: string;
}

export type ViewSort = 'urgency_then_time' | 'time' | 'project';

export interface InboxView {
  readonly id: string;
  readonly name: string;
  readonly folderId: NodeId | null;
  readonly filter: ViewFilter;
  readonly sort: ViewSort;
  readonly position: number;
  readonly builtin: boolean;
}

/** What `inbox_view_save` takes: a stored view without the flag that only the built-in ones carry. */
export type InboxViewInput = Omit<InboxView, 'builtin'>;

/** The built-in views are constants, not rows: they cannot be deleted or drift (0043 section 3). */
export const BUILTIN_VIEWS: readonly InboxView[] = [
  { id: 'all', name: 'All', folderId: null, filter: { states: ['new', 'seen', 'snoozed'] }, sort: 'urgency_then_time', position: 0, builtin: true },
  { id: 'needs-me', name: 'Needs me', folderId: null, filter: { kinds: ['input', 'approval', 'review'], states: ['new', 'seen'] }, sort: 'urgency_then_time', position: 1, builtin: true },
  { id: 'done', name: 'Done', folderId: null, filter: { states: ['done'] }, sort: 'time', position: 2, builtin: true },
];

export type InboxViewsEvent = { readonly type: 'inbox.views_changed' };
/** Asks the layout to open the inbox on an item (0043 section 4.6). */
export type InboxOpenItemEvent = { readonly type: 'ui.inbox_open_item'; readonly itemId: string };

export type InboxViewEvent = InboxViewsEvent | InboxOpenItemEvent;
