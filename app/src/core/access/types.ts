import type { Unsubscribe } from '../events/EventBus';
import type { Caller } from '../commands/types';
import type { SessionId } from '../session/types';
import type { NodeId } from '../tree/types';

/**
 * Access requests (0043 section 4.10): an agent's call that a policy the user may lift refuses becomes an approval
 * item with Allow once, for this session, always, or Deny. One broker serves notes and mounts (0044).
 */

export const ACCESS_ACTIONS = ['note.read', 'note.change', 'note.remove', 'mount.read', 'mount.write'] as const;
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type AccessScope = 'once' | 'session' | 'always';
export type AccessDecision = { readonly allow: AccessScope } | { readonly deny: true; readonly message?: string };
export type AccessDenyReason = 'user' | 'stale' | 'conflict' | 'scope' | 'failed';
export type AccessState = 'pending' | 'allowed' | 'denied' | 'expired' | 'withdrawn';
export type AccessCallState = 'waiting' | 'returned' | 'closed';
export type AccessDelivery = 'none' | 'in_call' | 'notice' | 'stdin' | 'context' | 'read' | 'failed';

export interface AccessTarget {
  readonly kind: 'note' | 'mount';
  /** The note id or the mount id. */
  readonly id: string;
  /** Its leaf: folder scope and the item's link. */
  readonly nodeId: NodeId;
}

/** One note of a removal: the title is data (an agent can set it), the other facts are the app's. */
export interface AccessDetailItem {
  readonly title: string;
  readonly bytes?: number;
  readonly createdBy?: 'user' | 'agent';
  readonly changedAt?: string;
}

/** What the card shows. Everything but the action comes from the agent, a note or a file: plain text only. */
export interface AccessDetail {
  readonly targetTitle: string;
  /** A mount path, relative to the root. */
  readonly path?: string;
  /** The notes of a removal. */
  readonly items?: readonly AccessDetailItem[];
  readonly diff?: { readonly before: string; readonly after: string; readonly revision?: number; readonly sha256?: string | null };
  /** For `note.remove`: a digest of the listed notes (ids, titles, revisions) that a decision must carry back. */
  readonly digest?: string;
}

/** The revision, the file hash or the digest of the removal list that the card's detail was shown against. */
export interface AccessExpected {
  readonly revision?: number;
  readonly sha256?: string | null;
  readonly digest?: string;
}

export interface AccessRequestRecord {
  /** The inbox item id. */
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly action: AccessAction;
  readonly target: AccessTarget;
  /** The tool input that raised the request; agent text. */
  readonly input: Readonly<Record<string, unknown>>;
  readonly offered: readonly AccessScope[];
  readonly state: AccessState;
  readonly scope?: AccessScope;
  readonly reason?: AccessDenyReason;
  /** The user's text with a deny, at most `ACCESS_MESSAGE_MAX_CHARS` characters. */
  readonly message?: string;
  /** The action ran after the allow. */
  readonly performed: boolean;
  readonly callState: AccessCallState;
  readonly delivery: AccessDelivery;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt?: string;
}

/** A refusal of `perform`: the request ends `denied` with this reason. */
export class AccessRefusal extends Error {
  constructor(
    readonly reason: Exclude<AccessDenyReason, 'user'>,
    message: string,
  ) {
    super(message);
    this.name = 'AccessRefusal';
  }
}

/** Registered once per action by the module that owns the target. */
export interface AccessActionHandler<R = unknown> {
  readonly action: AccessAction;
  /** The scopes the card offers for this target now. */
  offered(target: AccessTarget, sessionId: SessionId): readonly AccessScope[];
  /** The card's detail; computed at request time and again before an allow is applied. */
  detail(request: AccessRequestRecord): Promise<AccessDetail>;
  /**
   * Runs the action for the requesting session after an allow. Checks the folder scope and every refusal again and
   * throws `AccessRefusal` for `scope`, `stale` and `conflict`.
   */
  perform(request: AccessRequestRecord, expected: AccessExpected): Promise<R>;
  /** `always`: changes the target's own setting through the owner's UI command, as the user would. */
  applyAlways?(target: AccessTarget): void;
  /** A deny, an expiry or a withdrawal; for example rejects the pending proposals. */
  ended?(request: AccessRequestRecord): void;
}

export type AccessCheck = 'allow' | 'quiet_deny' | 'ask';

export interface AccessGrant {
  readonly sessionId: SessionId;
  readonly action: AccessAction;
  readonly target: AccessTarget;
  readonly effect: 'allow' | 'deny';
  readonly requestId: string;
  readonly createdAt: string;
}

/** What a tool returns when its call raised a request. When the action ran, the tool returns its own result. */
export type AccessCallResult =
  | { readonly access: 'pending'; readonly requestId: string; readonly note: string }
  | { readonly access: 'denied'; readonly requestId: string; readonly reason: AccessDenyReason; readonly message?: string };

export type AccessResultValue =
  | { readonly requestId: string; readonly state: 'pending' | 'expired' | 'withdrawn' }
  | { readonly requestId: string; readonly state: 'allowed'; readonly scope: AccessScope; readonly result?: unknown }
  | { readonly requestId: string; readonly state: 'denied'; readonly reason: AccessDenyReason; readonly message?: string };

export type AccessErrorCode = 'not_found' | 'invalid' | 'refused' | 'limit_reached' | 'invalid_state';

export class AccessError extends Error {
  constructor(
    readonly code: AccessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccessError';
  }
}

export interface AccessBroker {
  register(handler: AccessActionHandler): Unsubscribe;
  /** A session grant allows; a quiet deny refuses without an item; else the owner raises a request. */
  check(sessionId: SessionId, action: AccessAction, target: AccessTarget): AccessCheck;
  /** Raises or joins a request, posts the item, waits until a decision, `access.waitSeconds` or the call's signal. */
  request<R>(caller: Caller & { kind: 'mcp' }, action: AccessAction, target: AccessTarget, input: Record<string, unknown>, signal: AbortSignal): Promise<R | AccessCallResult>;
  /**
   * The user's decision (UI only). `expected` is what the card's diff was shown against; when the target moved on,
   * the decision throws `AccessError('refused')` and the request stays pending. A session scope for a session that
   * has no running process is refused.
   */
  decide(requestId: string, decision: AccessDecision, expected?: AccessExpected): Promise<AccessRequestRecord>;
  /** For the asking session only; waits up to `waitSeconds` for a decision. Runs an allowed read once, here. */
  result(caller: Caller & { kind: 'mcp' }, requestId: string, waitSeconds: number, signal: AbortSignal): Promise<AccessResultValue>;
  /** The card's detail, computed now by the owner of the action. */
  detail(requestId: string): Promise<AccessDetail>;
  grants(sessionId?: SessionId): readonly AccessGrant[];
  revoke(grant: { sessionId: SessionId; action: AccessAction; targetId: string }): void;
  /** The owner calls it when a target is removed: its pending requests end `withdrawn` and its grants go. */
  withdrawTarget(targetId: string): void;
  get(requestId: string): AccessRequestRecord | undefined;
  subscribe(listener: (record: AccessRequestRecord) => void): Unsubscribe;
  /** Called with the session id when its grants change. */
  subscribeGrants(listener: (sessionId: SessionId) => void): Unsubscribe;
}

export const ACCESS_OPEN_PER_SESSION = 5;
/** New requests per session in `ACCESS_WINDOW_MS`. */
export const ACCESS_REQUESTS_PER_WINDOW = 20;
export const ACCESS_WINDOW_MS = 10 * 60_000;
export const ACCESS_MESSAGE_MAX_CHARS = 500;
/** Origin of the inbox item of a request. */
export const ACCESS_ITEM_ORIGIN = 'access:request';

/** The app text of the item for each action. It holds no note title and no path: an agent can choose both. */
export const ACCESS_ITEM_TEXT: Readonly<Record<AccessAction, string>> = {
  'note.read': 'asks to read a note',
  'note.change': 'asks to change a note',
  'note.remove': 'asks to remove notes',
  'mount.read': 'asks to list and read files of a mount',
  'mount.write': 'asks to write a file in a mount',
};

/** Actions whose denial refuses later requests of the session for the same target without an item. */
export const QUIET_DENY_ACTIONS: readonly AccessAction[] = ['note.read', 'mount.read', 'note.remove'];

/** Actions whose pending request outlives the process of its session: the user may still take the change. */
export const OPEN_AFTER_SESSION_EXIT: readonly AccessAction[] = ['note.change', 'mount.write'];

/** Actions whose allowed action runs when the decision is made; a read waits for the agent's `access_request_result`. */
export const PERFORM_AT_DECISION: readonly AccessAction[] = ['note.change', 'note.remove', 'mount.write'];

export const ACCESS_QUIET_DENY_TEXT = 'The user denied this request for the rest of the session; ask in the conversation if you need it';
export const ACCESS_PENDING_NOTE = 'The user has not decided yet. You will be told; read the decision with access_request_result.';

/** The lines the app types or passes as context after a decision made once the call ended; they hold the request id only. */
export const accessNoticeLine = (requestId: string): string => `Access request ${requestId} was decided. Read it with access_request_result.`;
export const accessContextLine = (requestId: string): string => `Your access request ${requestId} was decided. Read the result with access_request_result.`;

export type AccessEvent =
  | { readonly type: 'access.request_changed'; readonly requestId: string; readonly state: AccessState; readonly callState: AccessCallState; readonly delivery: AccessDelivery }
  | { readonly type: 'access.grants_changed'; readonly sessionId: SessionId };
