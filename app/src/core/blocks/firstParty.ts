import { BLOCK_API_VERSION, FIRST_PARTY_BLOCK_ID } from './manifest';

/** Pane type ids of the first-party block. Renderer components are keyed by these ids. */
export const PANE_TYPES = {
  tree: 'agide/tree',
  surfaceHost: 'agide/surface-host',
  placeholder: 'agide/placeholder',
  inbox: 'agide/inbox',
  profileRail: 'agide/profile-rail',
  usageRanking: 'agide/usage-ranking',
  agentHistory: 'agide/agent-history',
  transcriptViewer: 'agide/transcript-viewer',
  observationLog: 'agide/observation-log',
  swarm: 'agide/swarm',
  review: 'agide/review',
} as const;

export type FirstPartyPaneType = (typeof PANE_TYPES)[keyof typeof PANE_TYPES];

/** Version of the first-party block; layouts ask for `^1`. */
export const FIRST_PARTY_BLOCK_VERSION = '1.0.0';

/** The first-party block's manifest, checked by the same schema as third-party manifests. */
export const FIRST_PARTY_MANIFEST = {
  apiVersion: BLOCK_API_VERSION,
  id: FIRST_PARTY_BLOCK_ID,
  version: FIRST_PARTY_BLOCK_VERSION,
  title: 'Agide',
  engines: { agide: '*' },
  panes: [
    { type: PANE_TYPES.tree, title: 'Task tree', tier: 'builtin', configVersion: 1, size: { minWidth: 180, preferredWidth: 280 } },
    {
      type: PANE_TYPES.surfaceHost,
      title: 'Surface',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { emptyText: { type: 'string', maxLength: 200 } } },
      inputs: { node: { contextKey: 'node.current', required: false } },
    },
    { type: PANE_TYPES.placeholder, title: 'Missing block', tier: 'builtin', configVersion: 1 },
    {
      type: PANE_TYPES.inbox,
      title: 'Inbox',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { viewId: { type: 'string' }, folderId: { type: 'string' } } },
      size: { minWidth: 280, preferredWidth: 400 },
    },
    { type: PANE_TYPES.profileRail, title: 'Profiles', tier: 'builtin', configVersion: 1, size: { minWidth: 48, preferredWidth: 56 } },
    {
      type: PANE_TYPES.usageRanking,
      title: 'Usage',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { folderId: { type: 'string' } } },
      size: { minWidth: 240, preferredWidth: 320 },
    },
    {
      type: PANE_TYPES.agentHistory,
      title: 'Agent history',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { folderId: { type: 'string' } } },
      size: { minWidth: 280, preferredWidth: 400 },
    },
    {
      type: PANE_TYPES.transcriptViewer,
      title: 'Transcript',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { agentId: { type: 'string' } } },
      size: { minWidth: 320, preferredWidth: 560 },
    },
    {
      type: PANE_TYPES.observationLog,
      title: 'Observation log',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { folderId: { type: 'string' } } },
      size: { minWidth: 280, preferredWidth: 400 },
    },
    {
      type: PANE_TYPES.swarm,
      title: 'Swarm',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { swarmId: { type: 'string' } } },
      size: { minWidth: 360, preferredWidth: 560 },
    },
    {
      type: PANE_TYPES.review,
      title: 'Review',
      tier: 'builtin',
      configVersion: 1,
      configSchema: { type: 'object', properties: { swarmId: { type: 'string' }, changesetId: { type: 'string' } } },
      size: { minWidth: 400, preferredWidth: 720 },
    },
  ],
} as const;
