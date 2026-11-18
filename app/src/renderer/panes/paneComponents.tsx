import type { ComponentType } from 'react';
import type { FirstPartyPaneType } from '../../core/blocks/firstParty';
import { AgentHistoryPane } from './AgentHistoryPane';
import { InboxPane } from './InboxPane';
import { ObservationLogPane } from './ObservationLogPane';
import type { PaneProps } from './paneTypes';
import { PlaceholderPane } from './PlaceholderPane';
import { ProfileRail } from './ProfileRail';
import { SurfaceHostBlock } from './SurfaceHostBlock';
import { TranscriptViewerPane } from './TranscriptViewerPane';
import { TreeBlock } from './TreeBlock';
import { UsagePane } from './UsagePane';

/**
 * Renderer components of the first-party pane types. Every first-party pane type has its entry here; builders
 * edit only their own component files (0029 ownership).
 */
export const PANE_COMPONENTS: Partial<Record<FirstPartyPaneType, ComponentType<PaneProps>>> = {
  'agide/tree': TreeBlock,
  'agide/surface-host': SurfaceHostBlock,
  'agide/placeholder': ({ config }) => (
    <PlaceholderPane type={String(config['type'] ?? 'agide/placeholder')} reason={String(config['reason'] ?? 'unknown')} message={String(config['message'] ?? '')} />
  ),
  'agide/inbox': InboxPane as ComponentType<PaneProps>,
  'agide/profile-rail': ProfileRail,
  'agide/usage-ranking': UsagePane,
  'agide/agent-history': AgentHistoryPane,
  'agide/transcript-viewer': TranscriptViewerPane,
  'agide/observation-log': ObservationLogPane,
};
