import type { TreeNode } from '../../core/tree/types';
import { PANE_ICONS, SURFACE_ICONS, type IconComponent } from '../ui/icons';
import { surfaceKindOf } from '../panes/tree/treeIcon';

const PANE_TYPE_ICONS: Readonly<Record<string, IconComponent>> = {
  'agide/tree': SURFACE_ICONS.folder.icon,
  'agide/inbox': PANE_ICONS.inbox.icon,
  'agide/usage-ranking': PANE_ICONS.usage.icon,
  'agide/agent-history': PANE_ICONS['agent-history'].icon,
};

/** The tab title of a surface host with no node bound. */
export const EMPTY_SURFACE_TITLE = 'No surface';

/** The glyph of a dock tab: the surface of the bound node for a surface host, else the glyph of the pane type. */
export function tabIconFor(type: string, node: TreeNode | undefined): IconComponent {
  if (type === 'agide/surface-host') return SURFACE_ICONS[node === undefined ? 'session' : surfaceKindOf(node, false)].icon;
  return PANE_TYPE_ICONS[type] ?? SURFACE_ICONS.note.icon;
}

/** The words of a dock tab: the title of the node a surface host shows, else the pane title of the layout. */
export function tabTitleFor(paneTitle: string, type: string, node: TreeNode | undefined): string {
  if (type !== 'agide/surface-host') return paneTitle;
  return node === undefined ? EMPTY_SURFACE_TITLE : node.title;
}
