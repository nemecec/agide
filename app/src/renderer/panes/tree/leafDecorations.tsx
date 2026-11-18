import { SURFACE_BROWSER_TAB, SURFACE_CLAUDE_SESSION } from '../../../core/surfaces/types';
import { BrowserTabDecorations } from './BrowserTabDecorations';
import { SessionDecorations } from './SessionDecorations';

/** Extra marks after a leaf's title, by surface type. Each component belongs to the builder of its surface. */
export function LeafDecorations({ surfaceType, surfaceId }: { readonly surfaceType: string; readonly surfaceId: string }) {
  if (surfaceType === SURFACE_CLAUDE_SESSION) return <SessionDecorations sessionId={surfaceId} />;
  if (surfaceType === SURFACE_BROWSER_TAB) return <BrowserTabDecorations surfaceId={surfaceId} />;
  return null;
}
