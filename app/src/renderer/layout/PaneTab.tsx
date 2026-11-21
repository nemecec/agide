import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { SURFACE_CLAUDE_SESSION } from '../../core/surfaces/types';
import type { TreeNode } from '../../core/tree/types';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import { STATUS_ICONS, STATUS_TONES, type StatusKind } from '../ui/icons';
import { useSessionStatus } from '../panes/useSessionStatus';
import { sessionStatusKind } from '../panes/sessionStatus';
import { useTreeNodes } from '../panes/useTreeNodes';
import { resolveInputs, titleOf } from './hostModel';
import { useLayoutContext } from './LayoutContext';
import { tabIconFor, tabTitleFor } from './tabModel';

const SHOWN: readonly StatusKind[] = ['busy', 'waiting', 'failed'];

function TabBody({ title, type, node }: { readonly title: string; readonly type: string; readonly node: TreeNode | undefined }) {
  const sessionId = node?.kind === 'leaf' && node.surfaceType === SURFACE_CLAUDE_SESSION ? node.surfaceId : undefined;
  const status = useSessionStatus(sessionId);
  const kind = status === undefined ? undefined : sessionStatusKind(status);
  const words = tabTitleFor(title, type, node);
  return (
    <div className="pane-tab" title={words}>
      <Icon icon={tabIconFor(type, node)} size="sm" className="pane-tab-icon" />
      <span className="pane-tab-title">{words}</span>
      {kind !== undefined && SHOWN.includes(kind) ? <Chip iconOnly tone={STATUS_TONES[kind]} icon={STATUS_ICONS[kind].icon} spin={kind === 'busy'} label={STATUS_ICONS[kind].label} /> : null}
    </div>
  );
}

function SurfaceHostTab({ title, type, nodeId }: { readonly title: string; readonly type: string; readonly nodeId: string | undefined }) {
  const { nodes } = useTreeNodes();
  return <TabBody title={title} type={type} node={nodeId === undefined ? undefined : nodes.find((candidate) => candidate.id === nodeId)} />;
}

/** The tab of a dock panel: glyph, words, and a status chip while the shown session works, waits or failed. */
export function PaneTab({ api }: IDockviewPanelHeaderProps) {
  const { view, context } = useLayoutContext();
  const instance = view.layout.instances[api.id];
  const type = instance?.type ?? '';
  const title = instance ? titleOf(view.layout, api.id) : (api.title ?? '');
  if (type !== 'agide/surface-host') return <TabBody title={title} type={type} node={undefined} />;
  const bound = resolveInputs(instance?.bindings, context)['node'];
  return <SurfaceHostTab title={title} type={type} nodeId={typeof bound === 'string' ? bound : undefined} />;
}
