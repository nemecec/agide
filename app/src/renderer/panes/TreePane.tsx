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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { SURFACE_BROWSER_TAB, SURFACE_CLAUDE_SESSION } from '../../core/surfaces/types';
import type { NodeId, TreeNode } from '../../core/tree/types';
import { api } from '../api';
import { openDialog } from '../dialogs/dialogStore';
import { startNewSession } from '../dialogs/newSession';
import { ContextMenu, type MenuEntry, type MenuState } from './ContextMenu';
import { setAgentsView, useAgentsView } from './agents/agentsStore';
import './agents/agents.css';
import { AgentRows } from './tree/AgentRows';
import { FolderDecorations } from './tree/FolderDecorations';
import { createSurfaceLeaf } from './tree/createLeaf';
import { LeafDecorations } from './tree/leafDecorations';
import { indexTree, isWithin, ROOT_ID, type TreeIndex } from './treeModel';
import { rowTooltip, surfaceKindOf } from './tree/treeIcon';
import { EmptyState } from '../ui/EmptyState';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { ACTION_ICONS, CONTROL_ICONS, SURFACE_ICONS } from '../ui/icons';
import './TreePane.css';

interface SurfaceTypeInfo {
  readonly id: string;
  readonly label: string;
}

const ROOT_ENTRY: TreeNode = { kind: 'folder', id: ROOT_ID, parentId: null, title: '', order: 0 };
const INDENT = 14;
const ROW_INSET = 4;
/** Disclosure slot, icon slot and the two gaps between them and the title. */
const TITLE_OFFSET = 16 + 6 + 16 + 6;

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
  const { showFinished } = useAgentsView();

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
        const session = await startNewSession(parentId, kind.label);
        if ('leafId' in session) {
          setError(null);
          onOpen(session.leafId);
        } else setError(session.error);
        return;
      }
      if (kind === 'folder') {
        const created = await run<TreeNode>('ui_create_folder', { title, ...where });
        if (created) pendingRename.current = created.id;
        return;
      }
      const leaf = await createSurfaceLeaf({ surfaceType: kind.surfaceType, title, parentId });
      if ('error' in leaf) setError(leaf.error);
      else {
        setError(null);
        pendingRename.current = leaf.id;
      }
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
      { label: 'New folder', icon: ACTION_ICONS['new-folder'].icon, run: () => void create(parentId, 'folder') },
      { label: 'New task…', icon: ACTION_ICONS['new-task'].icon, run: () => openDialog({ kind: 'new-task', parentFolderId: parentId }) },
      // A Claude session belongs to a folder: its MCP access is scoped to that folder.
      ...surfaceTypes
        .filter((type) => type.id !== SURFACE_CLAUDE_SESSION || parentId !== null)
        .map((type) => ({
          label: type.id === SURFACE_CLAUDE_SESSION ? `New ${type.label}…` : `New ${type.label}`,
          icon: SURFACE_ICONS[type.id === SURFACE_CLAUDE_SESSION ? 'session' : type.id === SURFACE_BROWSER_TAB ? 'browser-tab' : 'note'].icon,
          run: () => void create(parentId, { surfaceType: type.id, label: type.label }),
        })),
    ];
    if (target) {
      entries.push(
        { label: 'Open to the side', icon: ACTION_ICONS['open-to-side'].icon, run: () => void run('ui_open_to_side', { nodeId: target.getId() }) },
        { label: 'Rename', icon: ACTION_ICONS.rename.icon, run: () => target.startRenaming() },
        { label: 'Delete', icon: ACTION_ICONS.remove.icon, separated: true, danger: true, run: () => void remove(target) },
      );
    } else {
      entries.push({ label: 'Profile settings…', icon: ACTION_ICONS.settings.icon, run: () => openDialog({ kind: 'settings' }) });
      entries.push({ label: showFinished ? 'Hide finished agents' : 'Show finished agents', run: () => setAgentsView({ showFinished: !showFinished }) });
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
          const level = item.getItemMeta().level;
          const type = node.kind === 'leaf' ? typeLabel(surfaceTypes, node.surfaceType) : undefined;
          return (
            <Fragment key={item.getId()}>
              <div
                {...item.getProps()}
                className="tree-item"
                title={rowTooltip(node.title, type)}
                data-selected={item.isSelected()}
                data-focused={item.isFocused()}
                data-drop-target={item.isDragTarget()}
                data-kind={node.kind}
                data-expanded={folder ? item.isExpanded() : undefined}
                style={{ paddingLeft: ROW_INSET + level * INDENT }}
                onContextMenu={(event) => {
                  item.setFocused();
                  openMenu(event, item);
                }}
                onDoubleClick={() => (folder ? toggle(item) : undefined)}
              >
                <span className="tree-twisty" aria-hidden="true">
                  {folder ? <Icon icon={CONTROL_ICONS.disclosure} size="xs" className="tree-chevron" /> : null}
                </span>
                <Icon icon={SURFACE_ICONS[surfaceKindOf(node, item.isExpanded())].icon} size="md" className="tree-icon" />
                {item.isRenaming() ? (
                  <input {...item.getRenameInputProps()} className="tree-rename" aria-label="Rename" />
                ) : (
                  <span className="tree-title">{node.title}</span>
                )}
                {node.kind === 'folder' && <FolderDecorations folderId={node.id} />}
                {node.kind === 'leaf' && <LeafDecorations surfaceType={node.surfaceType} surfaceId={node.surfaceId} />}
              </div>
              {folder && item.isExpanded() && (indexRef.current.childIds.get(node.id)?.length ?? 0) === 0 && (
                <div className="tree-item tree-empty-folder" style={{ paddingLeft: ROW_INSET + (level + 1) * INDENT + TITLE_OFFSET }}>
                  (empty)
                </div>
              )}
              {node.kind === 'leaf' && node.surfaceType === SURFACE_CLAUDE_SESSION && <AgentRows sessionId={node.surfaceId} level={level} />}
            </Fragment>
          );
        })}
        <div style={tree.getDragLineStyle()} className="tree-dragline" />
      </div>
      {loaded && nodes.length === 0 && <EmptyState className="tree-empty" icon={SURFACE_ICONS.folder.icon} title="Nothing here yet" help="Right-click to add a folder or a surface." />}
      {error && (
        <Notice className="tree-error" tone="danger">
          {error}
        </Notice>
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
