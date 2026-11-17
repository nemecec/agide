import type { NodeId, TreeNode } from '../../core/tree/types';

/** Id of the invisible root item that holds the top-level nodes. */
export const ROOT_ID = '__root__';

export interface TreeIndex {
  readonly byId: ReadonlyMap<NodeId, TreeNode>;
  readonly childIds: ReadonlyMap<NodeId, readonly NodeId[]>;
}

/** Indexes the flat node list from `ui_list_tree`. Top-level nodes are the children of `ROOT_ID`. */
export function indexTree(nodes: readonly TreeNode[]): TreeIndex {
  const byId = new Map<NodeId, TreeNode>();
  const childIds = new Map<NodeId, NodeId[]>();
  for (const node of [...nodes].sort((a, b) => a.order - b.order)) {
    byId.set(node.id, node);
    const parent = node.parentId ?? ROOT_ID;
    const siblings = childIds.get(parent) ?? [];
    siblings.push(node.id);
    childIds.set(parent, siblings);
  }
  return { byId, childIds };
}

/** True when `id` is `ancestorId` or lies below it. */
export function isWithin(index: TreeIndex, id: NodeId, ancestorId: NodeId): boolean {
  for (let current = index.byId.get(id); current; current = current.parentId === null ? undefined : index.byId.get(current.parentId)) {
    if (current.id === ancestorId) return true;
  }
  return false;
}
