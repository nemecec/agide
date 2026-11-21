import type { NodeId, TreeService } from '../../tree/types';
import type { SwarmFolders } from './InMemorySwarmManager';

/** Swarm folders in the task tree: the swarm's agents are session leaves inside the folder. */
export class TreeFolders implements SwarmFolders {
  constructor(private readonly tree: TreeService) {}

  create(title: string, parentId: NodeId | null): NodeId {
    return this.tree.createFolder({ title, parentId }).id;
  }

  isWithin(nodeId: NodeId, ancestorId: NodeId): boolean {
    return this.tree.isWithin(nodeId, ancestorId);
  }
}
