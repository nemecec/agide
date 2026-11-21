import type { InboxService, Resolution } from '../../inbox/index';
import { cleanLine } from '../../inbox/text';
import type { PermissionMode, SessionId } from '../../session/types';
import type { NodeId } from '../../tree/types';
import type { CanUseToolRequest } from '../runtime/types';
import { SWARM_APPROVAL_ORIGIN, type SwarmApprovalPayload, type SwarmId } from '../types';
import type { Timers } from './timers';

const MESSAGE_MAX = 140;

export interface OpenedApproval {
  readonly swarmId: SwarmId;
  readonly agent: string;
  readonly sessionId: SessionId;
  readonly folderId: NodeId;
  readonly linkNodeId?: NodeId | undefined;
  readonly requestId: string;
  readonly request: CanUseToolRequest;
  readonly mode: PermissionMode;
  readonly inspector?: SwarmApprovalPayload['inspector'];
}

const keyOf = (sessionId: SessionId, requestId: string): string => `${sessionId}:${requestId}`;
export const approvalDedupeKey = (sessionId: SessionId, requestId: string): string => `swarm:perm:${sessionId}:${requestId}`;

/** The first line of a tool input as a person reads it: the command, the file, or the input as JSON. */
function describeInput(input: Record<string, unknown>): string {
  const first = [input['command'], input['file_path'], input['path'], input['url']].find((value): value is string => typeof value === 'string');
  return cleanLine(first ?? JSON.stringify(input)).split('\n')[0] ?? '';
}

/**
 * Approval items for `can_use_tool` requests (0037 section 7.2): one inbox item per request with the raw request
 * in its payload, and a timer that denies the call when nobody answers. The manager answers the runtime; this
 * class owns the items and the timers.
 */
export class ApprovalItems {
  private readonly timers = new Map<string, unknown>();

  constructor(
    private readonly inbox: InboxService,
    private readonly clock: Timers,
    private readonly now: () => Date,
    private readonly timeoutMinutes: () => number,
    private readonly onTimeout: (sessionId: SessionId, requestId: string) => void,
  ) {}

  open(approval: OpenedApproval): void {
    const minutes = this.timeoutMinutes();
    const expiresAt = new Date(this.now().getTime() + minutes * 60_000).toISOString();
    const display = approval.request.display_name ?? approval.request.tool_name;
    const message = cleanLine(`${approval.agent} wants to run ${display}: ${describeInput(approval.request.input)}`);
    const payload: SwarmApprovalPayload = {
      swarmId: approval.swarmId,
      agent: approval.agent,
      requestId: approval.requestId,
      request: approval.request,
      permissionMode: approval.mode,
      expiresAt,
      ...(approval.inspector === undefined ? {} : { inspector: approval.inspector }),
    };
    this.safely(() =>
      this.inbox.post({
        folderId: approval.folderId,
        kind: 'approval',
        urgency: 'high',
        source: 'app',
        origin: SWARM_APPROVAL_ORIGIN,
        sessionId: approval.sessionId,
        ...(approval.linkNodeId === undefined ? {} : { linkNodeId: approval.linkNodeId }),
        message: message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX - 1)}…` : message,
        textAuthor: 'agent',
        payload,
        dedupeKey: approvalDedupeKey(approval.sessionId, approval.requestId),
      }),
    );
    const key = keyOf(approval.sessionId, approval.requestId);
    this.timers.set(
      key,
      this.clock.setTimeout(() => {
        this.timers.delete(key);
        this.onTimeout(approval.sessionId, approval.requestId);
      }, minutes * 60_000),
    );
  }

  /** Resolves the item and stops its timer. A request that has no open item is ignored. */
  close(sessionId: SessionId, requestId: string, resolution: Resolution): void {
    const key = keyOf(sessionId, requestId);
    const timer = this.timers.get(key);
    if (timer !== undefined) this.clock.clearTimeout(timer);
    this.timers.delete(key);
    this.safely(() => this.inbox.resolveByDedupeKey(approvalDedupeKey(sessionId, requestId), resolution));
  }

  /** An item that cannot be posted must not break the agent: the timer still denies the call. */
  private safely(work: () => unknown): void {
    try {
      work();
    } catch (error) {
      console.warn('swarm: inbox item failed', error);
    }
  }

  /** Open approval items that no process can answer any more, such as those left by a crash. */
  expireAll(): void {
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
    for (const item of this.inbox.list({ kinds: ['approval'], states: ['new', 'seen', 'snoozed'] })) {
      if (item.origin === SWARM_APPROVAL_ORIGIN) this.inbox.resolve(item.id, 'expired');
    }
  }
}
