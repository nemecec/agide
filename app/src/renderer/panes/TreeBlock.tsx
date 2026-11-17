import { useCallback, useRef } from 'react';
import { api } from '../api';
import type { PaneProps } from './paneTypes';
import { TreePane } from './TreePane';
import { useTreeNodes } from './useTreeNodes';

/**
 * `agide/tree`: the task tree. Opening a node goes through `ui_focus_node`, which sets `node.current` in the
 * shared context. The tree also calls `onOpen` when it sees the resulting `ui.focus_node` event, so a node
 * is requested once and the echo is dropped.
 */
export function TreeBlock(_props: PaneProps) {
  const { nodes, loaded } = useTreeNodes();
  const requested = useRef<string | undefined>(undefined);
  const open = useCallback((nodeId: string) => {
    if (requested.current === nodeId) return;
    requested.current = nodeId;
    void api().invoke('ui_focus_node', { nodeId });
  }, []);
  return (
    <aside className="tree-pane" data-testid="tree-pane" aria-label="Task tree">
      <TreePane nodes={nodes} loaded={loaded} onOpen={open} />
    </aside>
  );
}
