import { SURFACE_BROWSER_TAB, SURFACE_CLAUDE_SESSION } from '../../core/surfaces/types';
import type { TreeNode } from '../../core/tree/types';
import { EmptyState } from '../ui/EmptyState';
import { SURFACE_ICONS } from '../ui/icons';
import { BrowserPane } from './BrowserPane';
import { TerminalPane } from './TerminalPane';

/** The surface of the open tree node: a terminal for a Claude session, the browser view for a tab, a placeholder otherwise. */
export function SurfacePane({ node }: { node: TreeNode | undefined }) {
  if (node?.kind !== 'leaf') return <EmptyState icon={SURFACE_ICONS.session.icon} title="Select a surface in the tree" />;
  if (node.surfaceType === SURFACE_CLAUDE_SESSION) return <TerminalPane sessionId={node.surfaceId} />;
  if (node.surfaceType === SURFACE_BROWSER_TAB) return <BrowserPane node={node} />;
  return <EmptyState data-testid="surface-unsupported" icon={SURFACE_ICONS.note.icon} title={node.title} help="This surface type has no view yet." />;
}
