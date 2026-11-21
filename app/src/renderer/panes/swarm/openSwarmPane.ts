import type { ArrangementNode } from '../../../core/blocks/layout';
import { api } from '../../api';
import type { LayoutViewState } from '../../layout/useLayoutState';

const SWARM_PANE = 'agide/swarm';

interface TabsGroup {
  readonly path: string;
  readonly panes: readonly string[];
}

function tabGroups(node: ArrangementNode, path: string): TabsGroup[] {
  if ('split' in node) return node.children.flatMap((child, index) => tabGroups(child, `${path}/children/${index}`));
  return [{ path, panes: node.tabs.panes }];
}

type Operation = { readonly op: 'add' | 'replace'; readonly path: string; readonly value: unknown };

/**
 * The layout patch that shows the swarm's pane: an existing pane for the swarm is brought to the front of its
 * tab group; otherwise a pane is added to the group that holds the main surface, or to the last group.
 */
export function planOpenSwarmPane(view: Pick<LayoutViewState, 'layout'>, swarmId: string): Operation[] | undefined {
  const { instances, arrangement } = view.layout;
  const groups = tabGroups(arrangement, '/arrangement');
  const existing = Object.entries(instances).find(([, instance]) => instance.type === SWARM_PANE && instance.config?.['swarmId'] === swarmId);
  if (existing !== undefined) {
    const group = groups.find((candidate) => candidate.panes.includes(existing[0]));
    return group === undefined ? undefined : [{ op: 'replace', path: `${group.path}/tabs/active`, value: existing[0] }];
  }
  const target = groups.find((group) => group.panes.some((id) => instances[id]?.type === 'agide/surface-host')) ?? groups[groups.length - 1];
  if (target === undefined) return undefined;
  let id = `swarm-${swarmId.replaceAll(/[^a-zA-Z0-9_-]/g, '').slice(0, 8)}`;
  while (id in instances) id = `${id}-x`;
  return [
    { op: 'add', path: `/instances/${id}`, value: { type: SWARM_PANE, version: '^1', configVersion: 1, config: { swarmId } } },
    { op: 'replace', path: `${target.path}/tabs`, value: { panes: [...target.panes, id], active: id } },
  ];
}

/** Shows the swarm pane in the window's layout; resolves with a failure message, or undefined. */
export async function openSwarmPane(swarmId: string): Promise<string | undefined> {
  const view = await api().invoke<LayoutViewState>('layout_get');
  if (!view.ok) return view.error.message;
  const patch = planOpenSwarmPane(view.value, swarmId);
  if (patch === undefined) return 'The layout has no place for the swarm pane.';
  const applied = await api().invoke('layout_apply', { layoutId: view.value.layoutId, expectedRevision: view.value.revision, patch });
  return applied.ok ? undefined : applied.error.message;
}
