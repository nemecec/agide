import type { NodeId } from '../tree/types';
import type { InboxItem } from './types';

/** An item with the names the list shows. */
export interface ItemRow extends InboxItem {
  readonly projectName?: string;
  readonly sessionName?: string;
}

/** The project and session layers of an item (0021 section 5). Summaries are plain text. */
export interface ItemContextInfo {
  readonly project?: { readonly id: NodeId; readonly name: string; readonly summary?: string; readonly summaryUpdatedAt?: string };
  readonly session?: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly summary?: string;
    readonly summaryGeneratedAt?: string;
    readonly summaryModel?: string;
  };
}
