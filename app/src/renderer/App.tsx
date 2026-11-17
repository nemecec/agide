import { useState } from 'react';
import type { NodeId } from '../core/tree/types';
import { SurfacePane } from './panes/SurfacePane';
import { TreePane } from './panes/TreePane';
import { useTreeNodes } from './panes/useTreeNodes';

/** Layout: the task tree on the left, the surface of the open leaf on the right. */
export function App() {
  const { nodes, loaded } = useTreeNodes();
  const [openId, setOpenId] = useState<NodeId | undefined>(undefined);
  const open = openId === undefined ? undefined : nodes.find((node) => node.id === openId);

  return (
    <div className="layout">
      <aside className="tree-pane" data-testid="tree-pane" aria-label="Task tree">
        <TreePane nodes={nodes} loaded={loaded} onOpen={setOpenId} />
      </aside>
      <main className="surface-pane" data-testid="surface-pane" aria-label="Surface">
        <SurfacePane node={open} />
      </main>
    </div>
  );
}
