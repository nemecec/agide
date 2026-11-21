import { SURFACE_BROWSER_TAB, SURFACE_CLAUDE_SESSION } from '../../../core/surfaces/types';
import type { TreeNode } from '../../../core/tree/types';
import type { SurfaceKind } from '../../ui/icons';

/** The surface meaning of a tree node, which `ui/icons.ts` maps to a glyph. */
export function surfaceKindOf(node: TreeNode, expanded: boolean): SurfaceKind {
  if (node.kind === 'folder') return expanded ? 'folder-open' : 'folder';
  if (node.surfaceType === SURFACE_CLAUDE_SESSION) return 'session';
  if (node.surfaceType === SURFACE_BROWSER_TAB) return 'browser-tab';
  return 'note';
}

/** The tooltip of a row: the full title, then the type of a leaf. */
export function rowTooltip(title: string, typeLabel: string | undefined): string {
  return typeLabel === undefined ? title : `${title} (${typeLabel})`;
}
