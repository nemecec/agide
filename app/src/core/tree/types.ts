import type { Unsubscribe } from '../events/EventBus';

export type NodeId = string;

interface NodeBase {
  readonly id: NodeId;
  /** `null` places the node at the top level of the tree. */
  readonly parentId: NodeId | null;
  readonly title: string;
  /** 0-based position among the siblings. Services keep sibling orders dense: 0, 1, 2, ... */
  readonly order: number;
}

export interface FolderNode extends NodeBase {
  readonly kind: 'folder';
}

/** A leaf shows one surface instance. The surface type owns the state behind `surfaceId`. */
export interface LeafNode extends NodeBase {
  readonly kind: 'leaf';
  /** A registered surface type id, such as `claude-session` or `browser-tab`. */
  readonly surfaceType: string;
  readonly surfaceId: string;
}

export type TreeNode = FolderNode | LeafNode;

export interface CreateFolderInput {
  title: string;
  parentId?: NodeId | null;
  /** Position among the new siblings; appends when absent or past the end. */
  index?: number;
}

export interface CreateLeafInput {
  title: string;
  parentId: NodeId | null;
  surfaceType: string;
  surfaceId: string;
  index?: number;
}

export interface MoveInput {
  parentId: NodeId | null;
  /** Position among the siblings after the move; appends when absent or past the end. */
  index?: number;
}

export type TreeErrorCode = 'not_found' | 'cycle' | 'parent_not_folder' | 'invalid_title';

export class TreeError extends Error {
  constructor(
    readonly code: TreeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TreeError';
  }
}

/**
 * Tree events. Sibling order changes caused by an insert, move or removal do not emit separate events;
 * a consumer that shows order re-reads `children(parentId)` of the parents named in the event.
 */
export type TreeEvent =
  | { readonly type: 'tree.node_created'; readonly node: TreeNode }
  | { readonly type: 'tree.node_renamed'; readonly node: TreeNode; readonly previousTitle: string }
  | { readonly type: 'tree.node_moved'; readonly node: TreeNode; readonly fromParentId: NodeId | null }
  | {
      readonly type: 'tree.subtree_removed';
      readonly rootId: NodeId;
      readonly parentId: NodeId | null;
      /** Every removed node, the root included. Leaves among them tell surface owners to dispose. */
      readonly removed: readonly TreeNode[];
    };

/**
 * The task tree. Operations are synchronous: the SQLite driver is synchronous and the tree is small.
 * Every operation throws `TreeError` on invalid input and leaves the tree unchanged in that case.
 */
export interface TreeService {
  /** All nodes, parents before children, siblings in order. */
  list(): TreeNode[];
  get(id: NodeId): TreeNode | undefined;
  children(parentId: NodeId | null): TreeNode[];
  createFolder(input: CreateFolderInput): FolderNode;
  createLeaf(input: CreateLeafInput): LeafNode;
  /** Throws `cycle` when the target parent is the node itself or one of its descendants. */
  move(id: NodeId, to: MoveInput): TreeNode;
  rename(id: NodeId, title: string): TreeNode;
  /** Removes the node and all its descendants. */
  remove(id: NodeId): TreeNode[];
  /** True when `id` equals `ancestorId` or lies below it. Used to scope MCP callers to their folder. */
  isWithin(id: NodeId, ancestorId: NodeId): boolean;
  subscribe(listener: (event: TreeEvent) => void): Unsubscribe;
}
