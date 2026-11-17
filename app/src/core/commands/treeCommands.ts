import { z } from 'zod';
import type { AppEventBus } from '../events/index';
import { TreeError, type NodeId, type TreeNode, type TreeService } from '../tree/types';
import type { CommandRegistry } from './CommandRegistry';
import { AGENT_CREATABLE_SURFACE_TYPES } from '../tree/surfaceCatalog';
import { requireInScope } from './scope';
import { CommandError, type Caller } from './types';

export interface TreeCommandDeps {
  readonly tree: TreeService;
  readonly events: AppEventBus;
}

const nodeId = z.string().min(1).describe('Id of a tree node, as returned by ui_list_tree');
const title = z.string().min(1).describe('Display name');
const index = z.number().int().min(0).optional().describe('Position among the siblings; appends when absent');

/** Runs a tree operation and reports a `TreeError` as the matching command error. */
function guarded<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (!(error instanceof TreeError)) throw error;
    throw new CommandError(error.code === 'not_found' ? 'not_found' : 'invalid_input', error.message);
  }
}

/** The parent a new node goes under: the given one, else the caller's folder (MCP) or the top level (UI). */
function parentFor(caller: Caller, parentId: NodeId | undefined): NodeId | null {
  return parentId ?? (caller.kind === 'mcp' ? caller.folderId : null);
}

const withIndex = (index: number | undefined): { index?: number } => (index === undefined ? {} : { index });

/** `ui_*` commands over the task tree. MCP callers act inside their own folder only. */
export function registerTreeCommands(registry: CommandRegistry, { tree, events }: TreeCommandDeps): void {
  registry.register({
    id: 'ui_create_folder',
    title: 'New folder',
    description:
      'Create a folder in the task tree. Without parentId the folder goes inside your own folder. Returns the new node, including its id.',
    input: z.strictObject({
      title,
      parentId: z.string().min(1).optional().describe('Id of the parent folder'),
      index,
    }),
    ui: { menu: 'tree-background' },
    mcp: true,
    run: (input, { caller }) => {
      const parentId = parentFor(caller, input.parentId);
      if (caller.kind === 'mcp') requireInScope(tree, caller, parentId);
      return guarded(() => tree.createFolder({ title: input.title, parentId, ...withIndex(input.index) }));
    },
  });

  registry.register({
    id: 'ui_create_leaf',
    title: 'New leaf',
    description:
      'Create a leaf that points at a surface instance (surfaceType and surfaceId). This adds a tree entry only; it does not start the surface. Claude sessions are created by the app, so agents cannot create claude-session leaves. Returns the new node.',
    input: z.strictObject({
      title,
      surfaceType: z.string().min(1).describe('Surface type id, such as claude-session or browser-tab'),
      surfaceId: z.string().min(1).describe('Id of the surface instance'),
      parentId: z.string().min(1).optional().describe('Id of the parent folder; defaults to your own folder'),
      index,
    }),
    ui: false,
    mcp: true,
    run: (input, { caller }) => {
      const parentId = parentFor(caller, input.parentId);
      if (caller.kind === 'mcp') {
        requireInScope(tree, caller, parentId);
        if (!AGENT_CREATABLE_SURFACE_TYPES.includes(input.surfaceType)) {
          throw new CommandError(
            'invalid_input',
            `agents cannot create leaves of type ${input.surfaceType}; allowed: ${AGENT_CREATABLE_SURFACE_TYPES.join(', ')}`,
          );
        }
      }
      return guarded(() =>
        tree.createLeaf({
          title: input.title,
          parentId,
          surfaceType: input.surfaceType,
          surfaceId: input.surfaceId,
          ...withIndex(input.index),
        }),
      );
    },
  });

  registry.register({
    id: 'ui_move_node',
    title: 'Move',
    description:
      'Move a node, with everything below it, into another folder. parentId null means the top level, which only the user can use. Returns the moved node.',
    input: z.strictObject({
      nodeId,
      parentId: z.string().min(1).nullable().describe('Id of the destination folder, or null for the top level'),
      index,
    }),
    ui: { menu: 'tree-node' },
    mcp: true,
    run: (input, { caller }) => {
      requireInScope(tree, caller, input.nodeId);
      requireInScope(tree, caller, input.parentId);
      return guarded(() => tree.move(input.nodeId, { parentId: input.parentId, ...withIndex(input.index) }));
    },
  });

  registry.register({
    id: 'ui_rename_node',
    title: 'Rename',
    description: 'Rename a node. Returns the renamed node.',
    input: z.strictObject({ nodeId, title }),
    ui: { menu: 'tree-node', accelerator: 'F2' },
    mcp: true,
    run: (input, { caller }) => {
      requireInScope(tree, caller, input.nodeId);
      return guarded(() => tree.rename(input.nodeId, input.title));
    },
  });

  registry.register({
    id: 'ui_remove_node',
    title: 'Remove',
    description:
      'Remove a node and everything below it. Surfaces in removed leaves are closed. You cannot remove your own folder. Returns the ids of the removed nodes.',
    input: z.strictObject({ nodeId }),
    ui: { menu: 'tree-node', accelerator: 'CmdOrCtrl+Backspace' },
    mcp: true,
    run: (input, { caller }) => {
      requireInScope(tree, caller, input.nodeId);
      if (caller.kind === 'mcp' && input.nodeId === caller.folderId) {
        throw new CommandError('out_of_scope', 'the folder of your own session cannot be removed by the session');
      }
      const removed = guarded(() => tree.remove(input.nodeId));
      return { removedIds: removed.map((node) => node.id) };
    },
  });

  registry.register({
    id: 'ui_list_tree',
    title: 'List tree',
    description:
      'List the nodes of the task tree, parents before children. You see your own folder and everything below it. Each node has id, parentId, kind (folder or leaf), title and order; leaves add surfaceType and surfaceId.',
    input: z.strictObject({}),
    ui: false,
    mcp: true,
    run: (_input, { caller }) => ({ nodes: nodesVisibleTo(tree, caller) }),
  });

  registry.register({
    id: 'ui_focus_node',
    title: 'Focus',
    description: 'Select a node in the tree and bring its surface to the front of the window.',
    input: z.strictObject({ nodeId }),
    ui: { menu: 'tree-node' },
    mcp: true,
    run: (input, { caller }) => {
      requireInScope(tree, caller, input.nodeId);
      if (!tree.get(input.nodeId)) throw new CommandError('not_found', `no node ${input.nodeId}`);
      events.emit({ type: 'ui.focus_node', nodeId: input.nodeId });
      return { focused: input.nodeId };
    },
  });
}

export function nodesVisibleTo(tree: TreeService, caller: Caller): TreeNode[] {
  const all = tree.list();
  return caller.kind === 'ui' ? all : all.filter((node) => tree.isWithin(node.id, caller.folderId));
}
