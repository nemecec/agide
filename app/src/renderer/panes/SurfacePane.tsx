import { SURFACE_BROWSER_TAB, SURFACE_CLAUDE_SESSION } from '../../core/surfaces/types';
import type { TreeNode } from '../../core/tree/types';
import { BrowserPane } from './BrowserPane';
import { TerminalPane } from './TerminalPane';

/** The surface of the open tree node: a terminal for a Claude session, the browser view for a tab, a placeholder otherwise. */
export function SurfacePane({ node }: { node: TreeNode | undefined }) {
  if (node?.kind !== 'leaf') return <div className="placeholder">Select a surface in the tree</div>;
  if (node.surfaceType === SURFACE_CLAUDE_SESSION) return <TerminalPane sessionId={node.surfaceId} />;
  if (node.surfaceType === SURFACE_BROWSER_TAB) return <BrowserPane node={node} />;
  return (
    <div className="placeholder" data-testid="surface-unsupported">
      {node.title}: this surface type has no view yet
    </div>
  );
}
