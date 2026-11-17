import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '../events/EventBus';
import { migrate, type Database } from '../store/index';
import { TREE_MODULE, treeMigrations } from './treeMigrations';
import {
  TreeError,
  type CreateFolderInput,
  type CreateLeafInput,
  type FolderNode,
  type LeafNode,
  type MoveInput,
  type NodeId,
  type TreeEvent,
  type TreeNode,
  type TreeService,
} from './types';

interface NodeRow {
  id: string;
  parent_id: string | null;
  kind: 'folder' | 'leaf';
  title: string;
  position: number;
  surface_type: string | null;
  surface_id: string | null;
}

const COLUMNS = 'id, parent_id, kind, title, position, surface_type, surface_id';

/** `TreeService` over the app database. Every operation runs in one transaction and emits its event after the commit. A listener that throws does not undo the change or stop later listeners; the error goes to `onListenerError`. */
export class SqliteTreeService implements TreeService {
  private readonly listeners = new Set<(event: TreeEvent) => void>();

  constructor(
    private readonly db: Database,
    private readonly newId: () => NodeId = randomUUID,
    private readonly onListenerError: (error: unknown) => void = (error) => console.error(error),
  ) {
    migrate(db, TREE_MODULE, treeMigrations);
  }

  list(): TreeNode[] {
    const rows = this.db.prepare(`SELECT ${COLUMNS} FROM tree_nodes ORDER BY position`).all() as unknown as NodeRow[];
    const byParent = new Map<NodeId | null, TreeNode[]>();
    for (const row of rows) {
      const siblings = byParent.get(row.parent_id) ?? [];
      siblings.push(toNode(row));
      byParent.set(row.parent_id, siblings);
    }
    const out: TreeNode[] = [];
    const walk = (parentId: NodeId | null): void => {
      for (const node of byParent.get(parentId) ?? []) {
        out.push(node);
        walk(node.id);
      }
    };
    walk(null);
    return out;
  }

  get(id: NodeId): TreeNode | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM tree_nodes WHERE id = ?`).get(id) as NodeRow | undefined;
    return row && toNode(row);
  }

  children(parentId: NodeId | null): TreeNode[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM tree_nodes WHERE parent_id IS ? ORDER BY position`)
      .all(parentId) as unknown as NodeRow[];
    return rows.map(toNode);
  }

  createFolder(input: CreateFolderInput): FolderNode {
    const title = validTitle(input.title);
    const parentId = input.parentId ?? null;
    return this.mutate(() => {
      this.requireFolderParent(parentId);
      const id = this.newId();
      this.db
        .prepare('INSERT INTO tree_nodes (id, parent_id, kind, title, position) VALUES (?, ?, ?, ?, 0)')
        .run(id, parentId, 'folder', title);
      this.place(id, parentId, input.index);
      const node = this.require(id) as FolderNode;
      return { result: node, events: [{ type: 'tree.node_created', node }] };
    });
  }

  createLeaf(input: CreateLeafInput): LeafNode {
    const title = validTitle(input.title);
    return this.mutate(() => {
      this.requireFolderParent(input.parentId);
      const id = this.newId();
      this.db
        .prepare(
          'INSERT INTO tree_nodes (id, parent_id, kind, title, position, surface_type, surface_id) VALUES (?, ?, ?, ?, 0, ?, ?)',
        )
        .run(id, input.parentId, 'leaf', title, input.surfaceType, input.surfaceId);
      this.place(id, input.parentId, input.index);
      const node = this.require(id) as LeafNode;
      return { result: node, events: [{ type: 'tree.node_created', node }] };
    });
  }

  move(id: NodeId, to: MoveInput): TreeNode {
    return this.mutate(() => {
      const node = this.require(id);
      this.requireFolderParent(to.parentId);
      if (to.parentId !== null && this.isWithin(to.parentId, id)) {
        throw new TreeError('cycle', `cannot move ${id} into itself or its descendant ${to.parentId}`);
      }
      const fromParentId = node.parentId;
      this.db.prepare('UPDATE tree_nodes SET parent_id = ? WHERE id = ?').run(to.parentId, id);
      if (fromParentId !== to.parentId) this.renumber(fromParentId);
      this.place(id, to.parentId, to.index);
      const moved = this.require(id);
      return { result: moved, events: [{ type: 'tree.node_moved', node: moved, fromParentId }] };
    });
  }

  rename(id: NodeId, title: string): TreeNode {
    const next = validTitle(title);
    return this.mutate(() => {
      const previous = this.require(id);
      this.db.prepare('UPDATE tree_nodes SET title = ? WHERE id = ?').run(next, id);
      const node = this.require(id);
      return { result: node, events: [{ type: 'tree.node_renamed', node, previousTitle: previous.title }] };
    });
  }

  remove(id: NodeId): TreeNode[] {
    return this.mutate(() => {
      const root = this.require(id);
      const removed = [root, ...this.descendants(id)];
      this.db.prepare('DELETE FROM tree_nodes WHERE id = ?').run(id);
      this.renumber(root.parentId);
      return {
        result: removed,
        events: [{ type: 'tree.subtree_removed', rootId: id, parentId: root.parentId, removed }],
      };
    });
  }

  isWithin(id: NodeId, ancestorId: NodeId): boolean {
    const row = this.db
      .prepare(
        `WITH RECURSIVE chain(id, parent_id) AS (
           SELECT id, parent_id FROM tree_nodes WHERE id = ?
           UNION
           SELECT n.id, n.parent_id FROM tree_nodes n JOIN chain c ON n.id = c.parent_id
         )
         SELECT 1 AS found FROM chain WHERE id = ?`,
      )
      .get(id, ancestorId);
    return row !== undefined;
  }

  subscribe(listener: (event: TreeEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Runs `work` in a transaction. A throw rolls everything back and emits nothing. */
  private mutate<R>(work: () => { result: R; events: TreeEvent[] }): R {
    this.db.exec('BEGIN IMMEDIATE');
    let outcome: { result: R; events: TreeEvent[] };
    try {
      outcome = work();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const event of outcome.events) {
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          this.onListenerError(error);
        }
      }
    }
    return outcome.result;
  }

  /** Puts the node at `index` among the children of `parentId` and rewrites their positions densely. */
  private place(id: NodeId, parentId: NodeId | null, index: number | undefined): void {
    const siblingIds = this.children(parentId)
      .map((n) => n.id)
      .filter((siblingId) => siblingId !== id);
    const at = Math.max(0, Math.min(index ?? siblingIds.length, siblingIds.length));
    siblingIds.splice(at, 0, id);
    this.writePositions(siblingIds);
  }

  private renumber(parentId: NodeId | null): void {
    this.writePositions(this.children(parentId).map((n) => n.id));
  }

  private writePositions(orderedIds: readonly NodeId[]): void {
    const update = this.db.prepare('UPDATE tree_nodes SET position = ? WHERE id = ?');
    orderedIds.forEach((nodeId, position) => update.run(position, nodeId));
  }

  private descendants(id: NodeId): TreeNode[] {
    return this.children(id).flatMap((child) => [child, ...this.descendants(child.id)]);
  }

  private require(id: NodeId): TreeNode {
    const node = this.get(id);
    if (!node) throw new TreeError('not_found', `no node ${id}`);
    return node;
  }

  private requireFolderParent(parentId: NodeId | null): void {
    if (parentId === null) return;
    if (this.require(parentId).kind !== 'folder') {
      throw new TreeError('parent_not_folder', `node ${parentId} is not a folder`);
    }
  }
}

function toNode(row: NodeRow): TreeNode {
  const base = { id: row.id, parentId: row.parent_id, title: row.title, order: row.position };
  if (row.kind === 'folder') return { kind: 'folder', ...base };
  return { kind: 'leaf', ...base, surfaceType: row.surface_type ?? '', surfaceId: row.surface_id ?? '' };
}

function validTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new TreeError('invalid_title', 'title must not be empty');
  return trimmed;
}
