import type { SessionService } from '../session/types';
import type { Database } from '../store/index';
import type { NodeId, TreeService } from '../tree/types';
import type { InboxItem } from './types';
import type { ItemContextInfo } from './viewTypes';

interface DescriptionRow {
  description: string | null;
  description_updated_at: string | null;
  is_project: number;
}

/**
 * Reads the layers of 0021 section 5 for an item: the project (the nearest ancestor folder marked as a
 * project, else its top-level folder) with its summary, and the session with its name and status. A session
 * summary belongs to the session's row in the tree (0043 section 4.7) and is not part of an item's context.
 */
export class ItemContext {
  constructor(
    private readonly db: Database,
    private readonly tree: TreeService,
    private readonly sessions: Pick<SessionService, 'get'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  forItem(item: InboxItem): ItemContextInfo {
    const project = this.projectOf(item.folderId ?? item.linkNodeId ?? null);
    const info = item.sessionId === undefined ? undefined : this.sessions.get(item.sessionId);
    return {
      ...(project ? { project } : {}),
      ...(info ? { session: { id: info.id, name: info.title, status: info.status } } : {}),
    };
  }

  projectName(item: InboxItem): string | undefined {
    return this.projectOf(item.folderId ?? item.linkNodeId ?? null)?.name;
  }

  /** Sets or clears the description of a folder, and marks it as a project when the text is set. */
  setProjectSummary(folderId: NodeId, summary: string | null): void {
    const node = this.tree.get(folderId);
    if (node?.kind !== 'folder') throw new Error(`${folderId} is not a folder`);
    this.db
      .prepare('UPDATE tree_nodes SET description = ?, description_updated_at = ?, is_project = ? WHERE id = ?')
      .run(summary, summary === null ? null : this.now().toISOString(), summary === null ? 0 : 1, folderId);
  }

  setSessionSummary(sessionId: string, summary: string, model?: string): void {
    this.db
      .prepare(
        `INSERT INTO session_summaries (session_id, summary, generated_at, model) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET summary = excluded.summary, generated_at = excluded.generated_at, model = excluded.model`,
      )
      .run(sessionId, summary, this.now().toISOString(), model ?? null);
  }

  private projectOf(nodeId: NodeId | null): ItemContextInfo['project'] {
    let top: NodeId | undefined;
    for (let id = nodeId; id !== null; ) {
      const node = this.tree.get(id);
      if (!node) break;
      if (node.kind === 'folder') {
        top = node.id;
        if (this.describe(node.id).is_project === 1) return this.projectInfo(node.id);
      }
      id = node.parentId;
    }
    return top === undefined ? undefined : this.projectInfo(top);
  }

  private describe(id: NodeId): DescriptionRow {
    return this.db.prepare('SELECT description, description_updated_at, is_project FROM tree_nodes WHERE id = ?').get(id) as unknown as DescriptionRow;
  }

  private projectInfo(id: NodeId): ItemContextInfo['project'] {
    const row = this.describe(id);
    return {
      id,
      name: this.tree.get(id)?.title ?? id,
      ...(row.description === null ? {} : { summary: row.description }),
      ...(row.description_updated_at === null ? {} : { summaryUpdatedAt: row.description_updated_at }),
    };
  }
}
