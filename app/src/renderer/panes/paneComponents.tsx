import type { ComponentType } from 'react';
import type { FirstPartyPaneType } from '../../core/blocks/firstParty';
import { InboxPane } from './InboxPane';
import type { PaneProps } from './paneTypes';
import { PlaceholderPane } from './PlaceholderPane';
import { ProfileRail } from './ProfileRail';
import { SurfaceHostBlock } from './SurfaceHostBlock';
import { TreeBlock } from './TreeBlock';

/**
 * Renderer components of the first-party pane types. Owner: w-layout. The inbox and profile builders edit
 * only their own components; the layout builder adds the tree, surface-host and placeholder entries.
 */
export const PANE_COMPONENTS: Partial<Record<FirstPartyPaneType, ComponentType<PaneProps>>> = {
  'agide/tree': TreeBlock,
  'agide/surface-host': SurfaceHostBlock,
  'agide/placeholder': ({ config }) => (
    <PlaceholderPane type={String(config['type'] ?? 'agide/placeholder')} reason={String(config['reason'] ?? 'unknown')} message={String(config['message'] ?? '')} />
  ),
  'agide/inbox': InboxPane as ComponentType<PaneProps>,
  'agide/profile-rail': ProfileRail,
};
