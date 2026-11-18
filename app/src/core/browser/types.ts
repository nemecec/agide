import type { Caller } from '../commands/types';
import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import type { ObserveMode } from '../surfaces/types';
import type { NodeId } from '../tree/types';

/**
 * Browser surface and observation (R12 to R15, design 0026). Pure types: views, CDP and partitions live in
 * `main/browser`; the core holds what tests can check without Electron.
 */

/** Partition key per service (0026 section 2); the partition is `persist:<service>`. */
export type ServiceId = 'jira' | 'github' | 'notion' | 'slack' | 'discord' | 'web';

/** Integer tab id the hosted tools use, unique per profile and never reused (`tabNumber`). */
export type TabNumber = number;

/** State of a `browser-tab` leaf, stored with the leaf through `SurfaceHost.setState` (0026 section 1). */
export interface BrowserTabState {
  /** Last committed URL: http, https or `about:blank`. */
  readonly url: string;
  readonly title: string;
  /** Fixed at creation; a webContents cannot change its session. */
  readonly service: ServiceId;
  readonly observe: ObserveMode;
  readonly tabNumber: TabNumber;
  /** `user`, or the session id of the agent that created the tab. */
  readonly createdBy: 'user' | SessionId;
  readonly zoom: number;
  readonly history?: { readonly entries: readonly { readonly url: string; readonly title: string }[]; readonly index: number };
}

/** An object a URL names (0026 section 2 recognizer). */
export interface ServiceObject {
  readonly service: ServiceId;
  readonly kind: 'issue' | 'pull_request' | 'run' | 'commit' | 'repository' | 'channel' | 'thread' | 'message' | 'page';
  /** Such as `ABC-12`, `owner/repo#12`, `owner/repo@sha`, a Notion page id in dashed form. */
  readonly id: string;
  /** Jira site host, Slack team or workspace. */
  readonly site?: string;
}

/** What the access log records per call; never content, typed text or URLs with query or fragment (0026 section 6). */
export type ObservationKind = 'summary' | 'text' | 'tree' | 'screenshot' | 'console' | 'network' | 'act' | 'highlight' | 'open_in_chrome' | 'digest';

export type ObservationOutcome = 'ok' | 'refused_off' | 'refused_site' | 'denied_by_user' | 'error';

export interface ObservationLogEntry {
  readonly id: number;
  readonly at: string;
  readonly sessionId: SessionId;
  readonly folderId: NodeId;
  readonly nodeId: NodeId;
  /** A tool name such as `read_page`, or an observation kind. */
  readonly kind: ObservationKind | string;
  /** Scheme, host and port only. */
  readonly origin: string;
  readonly bytes: number;
  readonly outcome: ObservationOutcome;
}

export type NewObservationLogEntry = Omit<ObservationLogEntry, 'id' | 'at'>;

/**
 * Observation switches per surface and the access log. Only the user changes a switch (`ui_set_observation` is
 * not an MCP tool), so an agent cannot widen its own view.
 */
export interface ObservationService {
  /** Records a surface and the service whose default applies until the user changes the switch. */
  register(surfaceId: string, service: ServiceId): void;
  forget(surfaceId: string): void;
  /** The switch of a recorded surface. Throws for a surface the service did not record. */
  mode(surfaceId: string): ObserveMode;
  /** Throws `ObservationError` `not_user` for an MCP caller and `not_found` for an unrecorded surface. */
  setMode(surfaceId: string, mode: ObserveMode, caller: Caller): void;
  /** Appends an entry. Throws `invalid` for an origin with a path, query or fragment. */
  record(entry: NewObservationLogEntry): ObservationLogEntry;
  /** Newest first. */
  log(filter?: { readonly nodeId?: NodeId; readonly sessionId?: SessionId; readonly limit?: number }): ObservationLogEntry[];
  /** Removes entries older than `before`; returns how many. */
  prune(before: Date): number;
  subscribe(listener: (event: BrowserEvent) => void): Unsubscribe;
}

export type ObservationErrorCode = 'not_found' | 'not_user' | 'invalid';

export class ObservationError extends Error {
  constructor(
    readonly code: ObservationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ObservationError';
  }
}

export type BrowserEvent =
  | { readonly type: 'browser.observation_changed'; readonly surfaceId: string; readonly mode: ObserveMode }
  | { readonly type: 'browser.accessed'; readonly entry: ObservationLogEntry };

/** Opens a tab for another module, such as task start (0028 section 10). */
export interface BrowserTabOpener {
  /** Creates a `browser-tab` leaf in the folder after the address policy; returns the leaf id. */
  openTab(input: { readonly folderId: NodeId; readonly url: string; readonly createdBy: 'user' | SessionId }): Promise<{ readonly leafId: NodeId }>;
}

/** What the browser module gives the other modules. */
export interface BrowserService extends BrowserTabOpener {
  readonly observation: ObservationService;
}
