import { z } from 'zod';
import type { TreeService } from '../tree/types';
import type { CommandRegistry } from './CommandRegistry';
import { nodesVisibleTo } from './treeCommands';

/** Type-independent surface commands. `surfaces_list` shows an MCP caller the leaves of its own folder. */
export function registerSurfaceCommands(registry: CommandRegistry, tree: TreeService): void {
  registry.register({
    id: 'surfaces_list',
    title: 'List surfaces',
    description:
      'List the surfaces (leaves) in your folder and below: nodeId, title, surfaceType, surfaceId and parentId of each.',
    input: z.strictObject({}),
    ui: false,
    mcp: true,
    run: (_input, { caller }) => ({
      surfaces: nodesVisibleTo(tree, caller).flatMap((node) =>
        node.kind === 'leaf'
          ? [{ nodeId: node.id, title: node.title, surfaceType: node.surfaceType, surfaceId: node.surfaceId, parentId: node.parentId }]
          : [],
      ),
    }),
  });
}
