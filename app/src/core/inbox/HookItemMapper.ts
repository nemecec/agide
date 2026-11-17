import type { SessionId, SessionInfo } from '../session/types';
import type { TreeService } from '../tree/types';
import { detailsFrom, firstSentence, inputHeadline, messageFrom, requestHash } from './itemText';
import type { InboxItem, InboxService, NewItem } from './types';

const SURFACE_TYPE = 'claude-session';
const PERMISSION_ORIGINS = ['hook:PermissionRequest', 'hook:Notification:permission_prompt'];
/** Items the user's return to the session resolves: hook-made status and input items. */
const VIEW_ORIGINS = ['hook:Stop', 'hook:Notification:idle_prompt', 'hook:Notification:elicitation_dialog'];
const OPEN = ['new', 'seen', 'snoozed'] as const;
export const DEFAULT_STOP_MIN_TURN_MS = 20_000;

export interface HookItemMapperDeps {
  readonly inbox: InboxService;
  readonly tree: TreeService;
  readonly sessions: { get(id: SessionId): SessionInfo | undefined };
  readonly now: () => Date;
  /** The session is open in a focused window or its peek is shown. */
  readonly isInView: (sessionId: SessionId) => boolean;
  /** Asks for a notification of an item that waited for a later signal (the permission or idle prompt). */
  readonly notifyNow: (item: InboxItem) => void;
  /** Size of the transcript file in bytes, for the item's anchor. */
  readonly transcriptSize?: (path: string) => number | undefined;
  readonly stopMinTurnMs?: number;
}

type Payload = Record<string, unknown>;
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

/**
 * Turns the hook payloads of a session into inbox items (0021 section 3). Agent-written text is cleaned at the
 * store; the mapper only shortens it. Hooks of sessions the app does not know still make items at the top level.
 */
export class HookItemMapper {
  private readonly turnStart = new Map<SessionId, number>();
  private readonly lastMessage = new Map<SessionId, string>();

  constructor(private readonly deps: HookItemMapperDeps) {}

  handle(sessionId: SessionId, hookEvent: string, rawPayload: unknown): void {
    const payload: Payload = rawPayload !== null && typeof rawPayload === 'object' ? (rawPayload as Payload) : {};
    switch (hookEvent) {
      case 'UserPromptSubmit':
        return this.promptSubmitted(sessionId, payload);
      case 'Stop':
        return this.stopped(sessionId, payload);
      case 'StopFailure':
        return this.stopFailed(sessionId, payload);
      case 'PermissionRequest':
        return this.permissionRequested(sessionId, payload);
      case 'PostToolUse':
        return this.toolRan(sessionId, payload);
      case 'Notification':
        return this.notified(sessionId, payload);
      default:
    }
  }

  /** Forgets the per-session memory of a session that was closed. */
  forget(sessionId: SessionId): void {
    this.turnStart.delete(sessionId);
    this.lastMessage.delete(sessionId);
  }

  private promptSubmitted(sessionId: SessionId, payload: Payload): void {
    if (text(payload['prompt'])?.startsWith('<task-notification>')) return;
    this.turnStart.set(sessionId, this.deps.now().getTime());
    this.deps.inbox.resolveSessionItems(sessionId, ['status', 'input'], 'viewed', VIEW_ORIGINS);
  }

  private stopped(sessionId: SessionId, payload: Payload): void {
    this.resolvePermissions(sessionId);
    const last = text(payload['last_assistant_message']);
    if (last !== undefined) this.lastMessage.set(sessionId, last);
    const started = this.turnStart.get(sessionId);
    const lasted = started === undefined ? 0 : this.deps.now().getTime() - started;
    const asksQuestion = last !== undefined && /\?\s*$/.test(last.trim());
    if (this.deps.isInView(sessionId)) return;
    if (lasted < (this.deps.stopMinTurnMs ?? DEFAULT_STOP_MIN_TURN_MS) && !asksQuestion) return;
    const background = Array.isArray(payload['background_tasks']) ? payload['background_tasks'].length : 0;
    this.post(sessionId, {
      kind: 'status',
      origin: 'hook:Stop',
      message: last === undefined ? 'Turn finished' : messageFrom(firstSentence(last)) || 'Turn finished',
      ...(last === undefined ? {} : { details: detailsFrom(last) }),
      textAuthor: 'agent',
      dedupeKey: `stop:${sessionId}`,
      ...this.anchor(payload),
      ...(background > 0 ? { payload: { backgroundTasks: background } } : {}),
    });
  }

  private stopFailed(sessionId: SessionId, payload: Payload): void {
    this.resolvePermissions(sessionId);
    const error = text(payload['error']) ?? 'unknown';
    const details = [text(payload['error_details']), text(payload['last_assistant_message'])].filter(Boolean).join('\n\n');
    this.post(sessionId, {
      kind: error === 'rate_limit' ? 'alert' : 'failure',
      origin: 'hook:StopFailure',
      message: messageFrom(`Turn failed: ${error}`),
      ...(details ? { details: detailsFrom(details) } : {}),
      textAuthor: 'app',
      dedupeKey: `stopfail:${sessionId}`,
    });
  }

  private permissionRequested(sessionId: SessionId, payload: Payload): void {
    const tool = text(payload['tool_name']) ?? 'a tool';
    const input = payload['tool_input'];
    const headline = inputHeadline(input);
    this.post(sessionId, {
      kind: 'approval',
      origin: 'hook:PermissionRequest',
      message: messageFrom(headline ? `Wants to run ${tool}: ${headline}` : `Wants to run ${tool}`),
      ...(input === undefined ? {} : { details: detailsFrom(JSON.stringify(input, null, 2)) }),
      textAuthor: 'agent',
      payload: { toolName: tool, ...(input === undefined ? {} : { toolInput: input }) },
      dedupeKey: `perm:${sessionId}:${requestHash(tool, input)}`,
    });
  }

  private toolRan(sessionId: SessionId, payload: Payload): void {
    const tool = text(payload['tool_name']);
    if (tool === undefined) return;
    this.deps.inbox.resolveByDedupeKey(`perm:${sessionId}:${requestHash(tool, payload['tool_input'])}`, 'superseded');
  }

  private notified(sessionId: SessionId, payload: Payload): void {
    const { inbox } = this.deps;
    const type = text(payload['notification_type']);
    const message = text(payload['message']);
    const inView = this.deps.isInView(sessionId);
    const open = (kind: InboxItem['kind'], origin?: string): InboxItem | undefined =>
      inbox.list({ sessionId, states: OPEN, kinds: [kind] }).find((item) => origin === undefined || item.origin === origin);

    switch (type) {
      case 'permission_prompt': {
        if (inView) return;
        const approval = open('approval');
        if (approval) return this.deps.notifyNow(approval);
        const item = this.post(sessionId, {
          kind: 'approval',
          origin: 'hook:Notification:permission_prompt',
          message: 'Waiting for permission',
          textAuthor: 'app',
          dedupeKey: `permprompt:${sessionId}`,
        });
        if (item) this.deps.notifyNow(item);
        return;
      }
      case 'idle_prompt': {
        if (inView) return;
        const stop = open('status', 'hook:Stop');
        if (stop) return this.deps.notifyNow(stop);
        if (open('input')) return;
        const last = this.lastMessage.get(sessionId);
        this.post(sessionId, {
          kind: 'input',
          urgency: 'low',
          origin: 'hook:Notification:idle_prompt',
          message: 'Waiting for you',
          ...(last === undefined ? {} : { details: detailsFrom(last) }),
          textAuthor: 'app',
          dedupeKey: `idle:${sessionId}`,
        });
        return;
      }
      case 'elicitation_dialog':
      case 'elicitation_url_dialog': {
        if (open('input', 'hook:Notification:elicitation_dialog')) return;
        const item = this.post(sessionId, {
          kind: 'input',
          origin: 'hook:Notification:elicitation_dialog',
          message: message === undefined ? 'Waiting for form input' : messageFrom(firstSentence(message)),
          ...(message === undefined ? {} : { details: detailsFrom(message) }),
          textAuthor: 'agent',
          dedupeKey: `elicit:${sessionId}`,
        });
        if (item && !inView) this.deps.notifyNow(item);
        return;
      }
      case 'elicitation_complete':
      case 'elicitation_response':
        inbox.resolveSessionItems(sessionId, ['input'], 'superseded', ['hook:Notification:elicitation_dialog']);
        return;
      case 'auth_storage_failure':
        this.post(sessionId, {
          kind: 'failure',
          origin: 'hook:Notification:auth_storage_failure',
          message: messageFrom(message ?? 'Credential storage failed'),
          textAuthor: 'app',
          dedupeKey: `authfail:${sessionId}`,
        });
        return;
      default:
    }
  }

  private resolvePermissions(sessionId: SessionId): void {
    this.deps.inbox.resolveSessionItems(sessionId, ['approval'], 'superseded', PERMISSION_ORIGINS);
  }

  private anchor(payload: Payload): Pick<NewItem, 'linkAnchor'> | Record<string, never> {
    const path = text(payload['transcript_path']);
    const size = path === undefined ? undefined : this.deps.transcriptSize?.(path);
    return path === undefined || size === undefined ? {} : { linkAnchor: { transcriptPath: path, byteOffset: size } };
  }

  private post(sessionId: SessionId, item: Pick<NewItem, 'kind' | 'origin' | 'message' | 'textAuthor'> & Partial<NewItem>): InboxItem | undefined {
    const info = this.deps.sessions.get(sessionId);
    const leaf = info && this.deps.tree.list().find((node) => node.kind === 'leaf' && node.surfaceType === SURFACE_TYPE && node.surfaceId === sessionId);
    return this.deps.inbox.post({
      folderId: info?.folderId ?? null,
      source: 'hook',
      sessionId,
      ...(leaf ? { linkNodeId: leaf.id } : {}),
      ...item,
    }).item;
  }
}
