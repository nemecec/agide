import type { Unsubscribe } from '../events/EventBus';
import { HOOK_EVENTS, type HookEventName } from '../session/hooks';
import type { SessionId } from '../session/types';

export { HOOK_EVENTS, type HookEventName } from '../session/hooks';

/**
 * The `http` hook transport and the approvals from the card (0043 sections 4.1 and 4.2). The hook entries of a
 * session post each event to the app's listener; the app answers or holds the request.
 */

/** Events that travel over `http`. `SessionStart` and `SessionEnd` stay command hooks that write into the hook directory (P45). */
export const HTTP_HOOK_EVENTS: readonly HookEventName[] = HOOK_EVENTS.filter((event) => event !== 'SessionStart' && event !== 'SessionEnd');

/** One authenticated hook request. `payload` is the CLI's JSON; it is agent-influenced data. */
export interface HookRequest {
  readonly sessionId: SessionId;
  readonly event: HookEventName;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly receivedAt: string;
  /** Aborted when the CLI closes the request before the app replied (an Esc on the dialog or the entry `timeout`, P45). */
  readonly signal: AbortSignal;
}

export type PermissionDecision = { readonly behavior: 'allow' } | { readonly behavior: 'deny'; readonly message?: string };

/** What the app answers. `{}` means no decision and no output. */
export type HookReply =
  | Record<string, never>
  | { readonly hookSpecificOutput: { readonly hookEventName: 'UserPromptSubmit'; readonly additionalContext: string } }
  | { readonly hookSpecificOutput: { readonly hookEventName: 'PermissionRequest'; readonly decision: PermissionDecision } };

/** Adds to the reply of its events; several contributors may answer `UserPromptSubmit`, their contexts are joined. */
export interface HookReplyContributor {
  readonly id: string;
  readonly events: readonly HookEventName[];
  reply(request: HookRequest): Promise<HookReply | undefined> | HookReply | undefined;
}

export interface HookGrant {
  /** `http://<host>:<port>/hooks/<sessionId>`, as the environment sees it. */
  readonly url: string;
  /** 32 random bytes, hex; only in the 0600 settings file. */
  readonly token: string;
}

export interface HookEndpoint {
  /** Issues or replaces the session's hook token. */
  grant(sessionId: SessionId, hostHeader?: string): HookGrant;
  revoke(sessionId: SessionId): void;
  /** Called for every accepted request, in arrival order per session, before any contributor replies. */
  subscribe(listener: (request: HookRequest) => void): Unsubscribe;
  addContributor(contributor: HookReplyContributor): Unsubscribe;
}

export const HOOK_PATH = /^\/hooks\/([^/?#]+)$/;
export const HOOK_BODY_MAX_BYTES = 1_000_000;
/** `UserPromptSubmit` waits this long for its contributors, then replies without the slow ones. */
export const USER_PROMPT_REPLY_WAIT_MS = 2000;

export type HookApprovalState = 'waiting' | 'answered' | 'closed' | 'expired';

export interface HookApproval {
  /** The approval item of the mapper (origin `hook:PermissionRequest`). */
  readonly itemId: string;
  readonly sessionId: SessionId;
  readonly toolName: string;
  /** `requestHash(tool, input)` of `itemText.ts`. */
  readonly requestHash: string;
  readonly state: HookApprovalState;
  readonly openedAt: string;
  readonly expiresAt: string;
}

export const HOOK_DENY_MESSAGE_MAX = 500;

/**
 * The inspector's record under `http` (0043 section 4.1). The command inspector writes no record file when the gate
 * file has no `inboxDir`, so the hook mapper gets the record from the app.
 */
export interface GateRecorder {
  /**
   * Runs `ToolCallInspector.inspect` over a `PreToolUse` payload with the session's `LaunchPolicy.gate` and returns the
   * payload with the decision added under `agide_gate`, the record that `runGate` builds. Undefined for a payload of
   * another event and for a session with no gate.
   */
  record(sessionId: SessionId, payload: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined;
}

export interface HookApprovalBroker extends HookReplyContributor {
  /** Answers a waiting approval. Refused when it is not `waiting`. */
  answer(itemId: string, decision: PermissionDecision): HookApproval;
  get(itemId: string): HookApproval | undefined;
  subscribe(listener: (approval: HookApproval) => void): Unsubscribe;
}

export type HooksEvent = { readonly type: 'hooks.approval_changed'; readonly itemId: string; readonly state: HookApprovalState };
