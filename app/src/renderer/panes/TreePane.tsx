import {
  dragAndDropFeature,
  hotkeysCoreFeature,
  keyboardDragAndDropFeature,
  renamingFeature,
  selectionFeature,
  syncDataLoaderFeature,
  type ItemInstance,
} from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { SURFACE_CLAUDE_SESSION } from '../../core/surfaces/types';
import type { NodeId, TreeNode } from '../../core/tree/types';
import { api } from '../api';
import { ContextMenu, type MenuEntry, type MenuState } from './ContextMenu';
import { indexTree, isWithin, ROOT_ID, type TreeIndex } from './treeModel';
import './TreePane.css';

interface SurfaceTypeInfo {
  readonly id: string;
  readonly label: string;
}

const ROOT_ENTRY: TreeNode = { kind: 'folder', id: ROOT_ID, parentId: null, title: '', order: 0 };
const INDENT = 16;

interface TreePaneProps {
  /** The nodes from `useTreeNodes`. */
  readonly nodes: readonly TreeNode[];
  readonly loaded: boolean;
  /** Called with the node whose surface the window should show: on click, on `ui.focus_node` and for a new session. */
  readonly onOpen: (nodeId: NodeId) => void;
}

/** Task tree. Every change goes through the command registry; the tree on screen follows `tree.*` events. */
export function TreePane({ nodes, loaded, onOpen }: TreePaneProps) {
  const index = useMemo(() => indexTree(nodes), [nodes]);
  const indexRef = useRef<TreeIndex>(index);
  indexRef.current = index;

  const [surfaceTypes, setSurfaceTypes] = useState<SurfaceTypeInfo[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRename = useRef<NodeId | null>(null);

  useEffect(() => {
    void api()
      .invoke<{ surfaceTypes: SurfaceTypeInfo[] }>('ui_list_surface_types')
      .then((result) => result.ok && setSurfaceTypes(result.value.surfaceTypes));
  }, []);

  const run = useCallback(async <T,>(command: string, input: unknown): Promise<T | undefined> => {
    const result = await api().invoke<T>(command, input);
    if (result.ok) {
      setError(null);
      return result.value;
    }
    setError(result.error.message);
    return undefined;
  }, []);

  const tree = useTree<TreeNode>({
    rootItemId: ROOT_ID,
    getItemName: (item) => item.getItemData().title,
    isItemFolder: (item) => item.getItemData().kind === 'folder',
    indent: INDENT,
    canReorder: true,
    onPrimaryAction: (item) => onOpen(item.getId()),
    dataLoader: {
      getItem: (id) => (id === ROOT_ID ? ROOT_ENTRY : (indexRef.current.byId.get(id) ?? ROOT_ENTRY)),
      getChildren: (id) => [...(indexRef.current.childIds.get(id) ?? [])],
    },
    canDrop: (items, target) =>
      items.every((item) => !isWithin(indexRef.current, target.item.getId(), item.getId())),
    onDrop: async (items, target) => {
      const parentId = target.item.getId() === ROOT_ID ? null : target.item.getId();
      const start = 'insertionIndex' in target ? target.insertionIndex : undefined;
      let offset = 0;
      for (const item of items) {
        await run('ui_move_node', {
          nodeId: item.getId(),
          parentId,
          ...(start === undefined ? {} : { index: start + offset }),
        });
        offset += 1;
      }
      if (parentId !== null) target.item.expand();
    },
    canRename: () => true,
    onRename: (item, value) => {
      if (value.trim() && value.trim() !== item.getItemData().title) {
        void run('ui_rename_node', { nodeId: item.getId(), title: value });
      }
    },
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
      keyboardDragAndDropFeature,
      renamingFeature,
    ],
  });

  useEffect(() => {
    tree.rebuildTree();
    const id = pendingRename.current;
    if (id && index.byId.has(id)) {
      pendingRename.current = null;
      const item = tree.getItemInstance(id);
      item.setFocused();
      item.startRenaming();
    }
  }, [tree, index]);

  useEffect(
    () =>
      api().subscribe((event) => {
        if (event.type !== 'ui.focus_node') return;
        const item = tree.getItemInstance(event.nodeId);
        item.setFocused();
        tree.setSelectedItems([event.nodeId]);
        onOpen(event.nodeId);
      }),
    [tree, onOpen],
  );

  const parentFor = (target: ItemInstance<TreeNode> | null): NodeId | null => {
    if (!target) return null;
    const node = target.getItemData();
    return node.kind === 'folder' ? node.id : node.parentId;
  };

  const create = useCallback(
    async (parentId: NodeId | null, kind: 'folder' | { surfaceType: string; label: string }) => {
      if (parentId) tree.getItemInstance(parentId).expand();
      const where = parentId === null ? {} : { parentId };
      const title = kind === 'folder' ? 'New folder' : `New ${kind.label.toLowerCase()}`;
      if (kind !== 'folder' && kind.surfaceType === SURFACE_CLAUDE_SESSION && parentId !== null) {
        // The new session opens with its terminal focused, so its leaf does not start in rename mode.
        const session = await run<{ leafId: NodeId }>('session_create', { folderId: parentId, title: kind.label });
        if (session) onOpen(session.leafId);
        return;
      }
      const created =
        kind === 'folder'
          ? await run<TreeNode>('ui_create_folder', { title, ...where })
          : await run<TreeNode>('ui_create_leaf', { title, surfaceType: kind.surfaceType, surfaceId: crypto.randomUUID(), ...where });
      if (created) pendingRename.current = created.id;
    },
    [run, tree, onOpen],
  );

  const remove = useCallback(
    async (item: ItemInstance<TreeNode>) => {
      const hasChildren = (indexRef.current.childIds.get(item.getId())?.length ?? 0) > 0;
      if (hasChildren && !window.confirm(`Delete "${item.getItemData().title}" and everything inside it?`)) return;
      await run('ui_remove_node', { nodeId: item.getId() });
    },
    [run],
  );

  const openMenu = (event: MouseEvent, target: ItemInstance<TreeNode> | null) => {
    event.preventDefault();
    event.stopPropagation();
    const parentId = parentFor(target);
    const entries: MenuEntry[] = [
      { label: 'New folder', run: () => void create(parentId, 'folder') },
      // A Claude session belongs to a folder: its MCP access is scoped to that folder.
      ...surfaceTypes
        .filter((type) => type.id !== SURFACE_CLAUDE_SESSION || parentId !== null)
        .map((type) => ({
          label: `New ${type.label}`,
          run: () => void create(parentId, { surfaceType: type.id, label: type.label }),
        })),
    ];
    if (target) {
      entries.push(
        { label: 'Open to the side', run: () => void run('ui_open_to_side', { nodeId: target.getId() }) },
        { label: 'Rename', run: () => target.startRenaming() },
        { label: 'Delete', run: () => void remove(target) },
      );
    }
    setMenu({ x: event.clientX, y: event.clientY, entries });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (event.target instanceof HTMLInputElement) return;
    const focused = tree.getItems().find((item) => item.isFocused());
    if (focused) {
      event.preventDefault();
      void remove(focused);
    }
  };

  return (
    <div className="tree-root" onContextMenu={(event) => openMenu(event, null)} onKeyDown={onKeyDown}>
      <div {...tree.getContainerProps('Task tree')} className="tree-items">
        {tree.getItems().map((item) => {
          const node = item.getItemData();
          const folder = node.kind === 'folder';
          return (
            <div
              {...item.getProps()}
              key={item.getId()}
              className="tree-item"
              data-selected={item.isSelected()}
              data-focused={item.isFocused()}
              data-drop-target={item.isDragTarget()}
              data-kind={node.kind}
              style={{ paddingLeft: 8 + item.getItemMeta().level * INDENT }}
              onContextMenu={(event) => {
                item.setFocused();
                openMenu(event, item);
              }}
              onDoubleClick={() => (folder ? toggle(item) : undefined)}
            >
              <span className="tree-twisty" aria-hidden="true">
                {folder ? (item.isExpanded() ? '▾' : '▸') : ''}
              </span>
              {item.isRenaming() ? (
                <input {...item.getRenameInputProps()} className="tree-rename" aria-label="Rename" />
              ) : (
                <span className="tree-title">{node.title}</span>
              )}
              {node.kind === 'leaf' && <span className="tree-type">{typeLabel(surfaceTypes, node.surfaceType)}</span>}
            </div>
          );
        })}
        <div style={tree.getDragLineStyle()} className="tree-dragline" />
      </div>
      {loaded && nodes.length === 0 && <p className="tree-empty">Right-click to add a folder or a surface.</p>}
      {error && (
        <p className="tree-error" role="alert">
          {error}
        </p>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function toggle(item: ItemInstance<TreeNode>): void {
  if (item.isExpanded()) item.collapse();
  else item.expand();
}

function typeLabel(types: readonly SurfaceTypeInfo[], id: string): string {
  return types.find((type) => type.id === id)?.label ?? id;
}
