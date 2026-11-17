import type { NodeId, TreeService } from '../tree/types';
import { CommandError, type Caller } from './types';

/**
 * Throws when an MCP caller names a node outside its folder: `not_found` for an id that does not exist,
 * `out_of_scope` for a node elsewhere in the tree. A UI caller passes.
 * `nodeId` `null` (the top level) is outside every MCP scope.
 */
export function requireInScope(tree: TreeService, caller: Caller, nodeId: NodeId | null): void {
  if (caller.kind === 'ui') return;
  if (nodeId === null) {
    throw new CommandError('out_of_scope', 'the top level is outside your folder; use a folder from ui_list_tree as parentId');
  }
  if (!tree.get(nodeId)) throw new CommandError('not_found', `no node ${nodeId}; call ui_list_tree to see the nodes you can use`);
  if (!tree.isWithin(nodeId, caller.folderId)) {
    throw new CommandError('out_of_scope', `node ${nodeId} is not in your folder ${caller.folderId}; call ui_list_tree to see the nodes you can change`);
  }
}
