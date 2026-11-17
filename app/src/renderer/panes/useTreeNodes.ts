import { useCallback, useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../../core/tree/types';
import { api } from '../api';

/** The task tree from `ui_list_tree`, refreshed on every `tree.*` event. */
export function useTreeNodes(): { nodes: TreeNode[]; loaded: boolean } {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    const result = await api().invoke<{ nodes: TreeNode[] }>('ui_list_tree');
    if (ticket !== latest.current || !result.ok) return;
    // An unchanged tree keeps its array, so the tree widget is not rebuilt while the user renames an item.
    setNodes((current) => (JSON.stringify(current) === JSON.stringify(result.value.nodes) ? current : result.value.nodes));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    return api().subscribe((event) => {
      if (event.type.startsWith('tree.')) void refresh();
    });
  }, [refresh]);

  return { nodes, loaded };
}
