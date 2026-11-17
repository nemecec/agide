import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '../events/EventBus';
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

/** Reference implementation of `TreeService`. The SQLite implementation must pass the same tests. */
export class InMemoryTreeService implements TreeService {
  private readonly nodes = new Map<NodeId, TreeNode>();
  private readonly listeners = new Set<(event: TreeEvent) => void>();

  constructor(
    private readonly newId: () => NodeId = randomUUID,
    private readonly onListenerError: (error: unknown) => void = (error) => console.error(error),
  ) {}

  list(): TreeNode[] {
    const out: TreeNode[] = [];
    const walk = (parentId: NodeId | null): void => {
      for (const node of this.children(parentId)) {
        out.push(node);
        walk(node.id);
      }
    };
    walk(null);
    return out;
  }

  get(id: NodeId): TreeNode | undefined {
    return this.nodes.get(id);
  }

  children(parentId: NodeId | null): TreeNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order);
  }

  createFolder(input: CreateFolderInput): FolderNode {
    const parentId = input.parentId ?? null;
    this.requireFolderParent(parentId);
    const node: FolderNode = { kind: 'folder', id: this.newId(), parentId, title: validTitle(input.title), order: 0 };
    return this.insert(node, input.index);
  }

  createLeaf(input: CreateLeafInput): LeafNode {
    this.requireFolderParent(input.parentId);
    const node: LeafNode = {
      kind: 'leaf',
      id: this.newId(),
      parentId: input.parentId,
      title: validTitle(input.title),
      order: 0,
      surfaceType: input.surfaceType,
      surfaceId: input.surfaceId,
    };
    return this.insert(node, input.index);
  }

  move(id: NodeId, to: MoveInput): TreeNode {
    const node = this.require(id);
    this.requireFolderParent(to.parentId);
    if (to.parentId !== null && this.isWithin(to.parentId, id)) {
      throw new TreeError('cycle', `cannot move ${id} into itself or its descendant ${to.parentId}`);
    }
    const fromParentId = node.parentId;
    this.nodes.delete(id);
    this.renumber(fromParentId);
    const moved = this.insert({ ...node, parentId: to.parentId }, to.index, false);
    this.emit({ type: 'tree.node_moved', node: moved, fromParentId });
    return moved;
  }

  rename(id: NodeId, title: string): TreeNode {
    const node = this.require(id);
    const renamed: TreeNode = { ...node, title: validTitle(title) };
    this.nodes.set(id, renamed);
    this.emit({ type: 'tree.node_renamed', node: renamed, previousTitle: node.title });
    return renamed;
  }

  remove(id: NodeId): TreeNode[] {
    const root = this.require(id);
    const removed = [root, ...this.descendants(id)];
    for (const node of removed) this.nodes.delete(node.id);
    this.renumber(root.parentId);
    this.emit({ type: 'tree.subtree_removed', rootId: id, parentId: root.parentId, removed });
    return removed;
  }

  isWithin(id: NodeId, ancestorId: NodeId): boolean {
    let current = this.nodes.get(id);
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parentId === null ? undefined : this.nodes.get(current.parentId);
    }
    return false;
  }

  subscribe(listener: (event: TreeEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private insert<N extends TreeNode>(node: N, index: number | undefined, announce = true): N {
    const siblings = this.children(node.parentId);
    const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
    siblings.splice(at, 0, node);
    siblings.forEach((sibling, order) => this.nodes.set(sibling.id, { ...sibling, order }));
    const stored = this.nodes.get(node.id) as N;
    if (announce) this.emit({ type: 'tree.node_created', node: stored });
    return stored;
  }

  private renumber(parentId: NodeId | null): void {
    this.children(parentId).forEach((sibling, order) => this.nodes.set(sibling.id, { ...sibling, order }));
  }

  private descendants(id: NodeId): TreeNode[] {
    return this.children(id).flatMap((child) => [child, ...this.descendants(child.id)]);
  }

  private require(id: NodeId): TreeNode {
    const node = this.nodes.get(id);
    if (!node) throw new TreeError('not_found', `no node ${id}`);
    return node;
  }

  private requireFolderParent(parentId: NodeId | null): void {
    if (parentId === null) return;
    if (this.require(parentId).kind !== 'folder') {
      throw new TreeError('parent_not_folder', `node ${parentId} is not a folder`);
    }
  }

  private emit(event: TreeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }
}

function validTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new TreeError('invalid_title', 'title must not be empty');
  return trimmed;
}
