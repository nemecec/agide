import { SURFACE_BROWSER_TAB, SURFACE_CLAUDE_SESSION, SURFACE_SLACK_THREAD } from '../surfaces/types';

/** A surface type as the tree UI offers it in the "add" menu. */
export interface SurfaceTypeInfo {
  readonly id: string;
  readonly label: string;
}

/** Surface types a leaf can show. The surface registry replaces this list when it exists. */
export const DEFAULT_SURFACE_TYPES: readonly SurfaceTypeInfo[] = [
  { id: SURFACE_CLAUDE_SESSION, label: 'Claude session' },
  { id: SURFACE_BROWSER_TAB, label: 'Browser tab' },
  { id: SURFACE_SLACK_THREAD, label: 'Slack thread' },
];

/**
 * Surface types whose leaves an agent may create over MCP. A type missing here has an owner that creates its
 * leaves together with the surface (the session module for `claude-session`); a forged leaf would let an
 * agent act on a surface in another folder.
 */
export const AGENT_CREATABLE_SURFACE_TYPES: readonly string[] = [SURFACE_BROWSER_TAB, SURFACE_SLACK_THREAD];
