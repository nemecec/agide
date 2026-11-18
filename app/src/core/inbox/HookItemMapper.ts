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

/** What the inspector said about a call that asks. */
interface GateInfo {
  readonly classId: string;
  readonly mode?: string;
  readonly audience?: string;
}
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined);

/**
 * Turns the hook payloads of a session into inbox items (0021 section 3). Agent-written text is cleaned at the
 * store; the mapper only shortens it. Hooks of sessions the app does not know still make items at the top level.
 */
export class HookItemMapper {
  private readonly turnStart = new Map<SessionId, number>();
  private readonly lastMessage = new Map<SessionId, string>();
  /** What the permission inspector decided for calls that ask, by request key, until the dialog shows up. */
  private readonly gateAsks = new Map<string, GateInfo>();

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
      case 'PreToolUse':
        return this.gateDecided(sessionId, payload);
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
    for (const key of [...this.gateAsks.keys()]) if (key.startsWith(`${sessionId}:`)) this.gateAsks.delete(key);
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

  /** The inspector's record of a `PreToolUse` call (0028 section 4). */
  private gateDecided(sessionId: SessionId, payload: Payload): void {
    const gate = payload['agide_gate'];
    if (gate === null || typeof gate !== 'object') return;
    const record = gate as Payload;
    const classId = text(record['classId']);
    const tool = text(payload['tool_name']) ?? 'a tool';
    const input = payload['tool_input'];
    const decision = text(record['decision']);
    const audience = text(record['audience']);
    if (decision === 'ask' && classId !== undefined) {
      this.gateAsks.set(`${sessionId}:${requestHash(tool, input)}`, { classId, ...(text(record['mode']) === undefined ? {} : { mode: text(record['mode'])! }), ...(audience === undefined ? {} : { audience }) });
    } else if (decision === 'deny' && classId !== undefined) {
      const headline = inputHeadline(input);
      this.post(sessionId, {
        kind: 'status',
        origin: 'gate:deny',
        message: messageFrom(headline ? `Blocked ${classId}: ${headline}` : `Blocked ${classId}`),
        ...(text(record['reason']) === undefined ? {} : { details: detailsFrom(text(record['reason'])!) }),
        textAuthor: 'agent',
        payload: { classId, toolName: tool, ...(audience === undefined ? {} : { audience }) },
        dedupeKey: `gate:${sessionId}:${classId}`,
      });
    } else if (decision === 'none' && text(record['mode']) === 'notify' && classId !== undefined) {
      this.post(sessionId, {
        kind: 'status',
        urgency: 'low',
        origin: 'gate:notify',
        message: messageFrom(audience === undefined ? `Ran ${classId}` : `Ran ${classId} for ${audience}`),
        textAuthor: 'agent',
        payload: { classId, toolName: tool },
        dedupeKey: `gate:notify:${sessionId}:${classId}`,
      });
    }
  }

  private permissionRequested(sessionId: SessionId, payload: Payload): void {
    const tool = text(payload['tool_name']) ?? 'a tool';
    const input = payload['tool_input'];
    const headline = inputHeadline(input);
    const key = `${sessionId}:${requestHash(tool, input)}`;
    const gate = this.gateAsks.get(key);
    this.gateAsks.delete(key);
    const gateTitle = gate === undefined ? undefined : `Approve: ${gate.classId}${gate.audience === undefined ? '' : ` to ${gate.audience}`}`;
    this.post(sessionId, {
      kind: 'approval',
      origin: 'hook:PermissionRequest',
      message: messageFrom(gateTitle ?? (headline ? `Wants to run ${tool}: ${headline}` : `Wants to run ${tool}`)),
      ...(input === undefined ? {} : { details: detailsFrom(JSON.stringify(input, null, 2)) }),
      textAuthor: 'agent',
      payload: { toolName: tool, ...(input === undefined ? {} : { toolInput: input }), ...(gate === undefined ? {} : { gate }) },
      dedupeKey: `perm:${sessionId}:${requestHash(tool, input)}`,
    });
  }

  private toolRan(sessionId: SessionId, payload: Payload): void {
    const tool = text(payload['tool_name']);
    if (tool === undefined) return;
    this.gateAsks.delete(`${sessionId}:${requestHash(tool, payload['tool_input'])}`);
    this.sandboxBlocked(sessionId, payload);
    this.deps.inbox.resolveByDedupeKey(`perm:${sessionId}:${requestHash(tool, payload['tool_input'])}`, 'superseded');
  }

  /** A sandboxed command that reached a host off the allowlist leaves `<sandbox_violations>` in its result. */
  private sandboxBlocked(sessionId: SessionId, payload: Payload): void {
    const response = payload['tool_response'];
    const body = typeof response === 'string' ? response : response === undefined ? '' : JSON.stringify(response);
    const match = /deny network-outbound ([^\s:"\\]+)/.exec(body);
    if (!body.includes('<sandbox_violations>') || match === null) return;
    this.post(sessionId, {
      kind: 'status',
      origin: 'gate:sandbox',
      message: messageFrom(`Sandbox blocked ${match[1]}`),
      textAuthor: 'agent',
      payload: { host: match[1] },
      dedupeKey: `gate:sandbox:${sessionId}:${match[1]}`,
    });
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
