import { EmptyState } from '../ui/EmptyState';
import { SURFACE_ICONS } from '../ui/icons';
import type { PaneProps } from './paneTypes';
import { SurfacePane } from './SurfacePane';
import { useTreeNodes } from './useTreeNodes';

/** `agide/surface-host`: shows the surface of the node bound to its `node` input. */
export function SurfaceHostBlock({ config, inputs }: PaneProps) {
  const { nodes } = useTreeNodes();
  const nodeId = typeof inputs['node'] === 'string' ? inputs['node'] : undefined;
  const node = nodeId === undefined ? undefined : nodes.find((candidate) => candidate.id === nodeId);
  const emptyText = typeof config['emptyText'] === 'string' ? config['emptyText'] : undefined;
  return (
    <main className="surface-pane" data-testid="surface-pane" aria-label="Surface">
      {node === undefined && emptyText !== undefined ? <EmptyState icon={SURFACE_ICONS.session.icon} title={emptyText} /> : <SurfacePane node={node} />}
    </main>
  );
}
