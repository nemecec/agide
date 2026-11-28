import type { Caller } from '../commands/types';
import type { Unsubscribe } from '../events/EventBus';
import { cleanLine } from '../inbox/text';
import type { NoticeDelivery, NoticeDeliveryKind } from '../inbox/delivery/types';
import { InboxError, MESSAGE_MAX, type InboxService } from '../inbox/types';
import type { SessionId } from '../session/types';
import type { AccessSettings } from './settings';
import {
  ACCESS_ITEM_ORIGIN,
  ACCESS_ITEM_TEXT,
  ACCESS_MESSAGE_MAX_CHARS,
  ACCESS_OPEN_PER_SESSION,
  ACCESS_PENDING_NOTE,
  ACCESS_REQUESTS_PER_WINDOW,
  ACCESS_WINDOW_MS,
  AccessError,
  AccessRefusal,
  accessContextLine,
  accessNoticeLine,
  OPEN_AFTER_SESSION_EXIT,
  PERFORM_AT_DECISION,
  QUIET_DENY_ACTIONS,
  type AccessAction,
  type AccessActionHandler,
  type AccessBroker,
  type AccessCallResult,
  type AccessCallState,
  type AccessCheck,
  type AccessDecision,
  type AccessDelivery,
  type AccessDenyReason,
  type AccessDetail,
  type AccessExpected,
  type AccessGrant,
  type AccessRequestRecord,
  type AccessResultValue,
  type AccessScope,
  type AccessState,
  type AccessTarget,
} from './types';

export interface InMemoryAccessBrokerOptions {
  readonly inbox: InboxService;
  readonly delivery: NoticeDelivery;
  readonly settings: () => AccessSettings;
  /** The title of the session's leaf, for the item's message. */
  readonly sessionTitle: (sessionId: SessionId) => string | undefined;
  /** Whether the session's process runs. A session without one takes no session grant and no quiet deny. */
  readonly isLive: (sessionId: SessionId) => boolean;
  readonly now?: () => Date;
}

type CallSettle = (value: unknown, state?: AccessCallState) => void;

interface Row {
  readonly requestId: string;
  readonly sessionId: SessionId;
  readonly action: AccessAction;
  readonly target: AccessTarget;
  readonly input: Readonly<Record<string, unknown>>;
  readonly offered: readonly AccessScope[];
  readonly createdAt: string;
  readonly expiresAt: string;
  state: AccessState;
  scope: AccessScope | undefined;
  reason: AccessDenyReason | undefined;
  message: string | undefined;
  performed: boolean;
  deciding: boolean;
  /** The run of an allowed read after the call ended; concurrent results wait for it. */
  performing: Promise<void> | undefined;
  callState: AccessCallState;
  delivery: AccessDelivery;
  decidedAt: string | undefined;
  result: unknown;
  /** Calls of the agent that wait for the decision. */
  readonly calls: Set<CallSettle>;
  /** Waits of `result` for the decision. */
  readonly watchers: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const unref = (timer: ReturnType<typeof setTimeout>): void => {
  (timer as { unref?: () => void }).unref?.();
};

/**
 * The broker of 0043 section 4.10 in memory. It keeps the join, limit, grant, wait, delivery and expiry rules that
 * `SqliteAccessBroker` of w-access keeps over the table of `accessMigrations`; `accessBrokerContract` holds both to them.
 */
export class InMemoryAccessBroker implements AccessBroker {
  private readonly handlers = new Map<AccessAction, AccessActionHandler>();
  private readonly rows = new Map<string, Row>();
  private readonly grantList: AccessGrant[] = [];
  private readonly recent = new Map<SessionId, number[]>();
  private readonly listeners = new Set<(record: AccessRequestRecord) => void>();
  private readonly grantListeners = new Set<(sessionId: SessionId) => void>();
  private readonly now: () => Date;
  private readonly off: () => void;

  constructor(private readonly options: InMemoryAccessBrokerOptions) {
    this.now = options.now ?? (() => new Date());
    this.off = options.inbox.subscribe((event) => {
      if (event.type !== 'inbox.item_changed' || event.change !== 'resolved' || event.item.origin !== ACCESS_ITEM_ORIGIN) return;
      const row = this.rows.get(event.item.id);
      if (row?.state === 'pending' && !row.deciding && event.item.resolution === 'dismissed') this.deny(row, 'user', undefined);
    });
  }

  dispose(): void {
    this.off();
    for (const row of this.rows.values()) if (row.timer) clearTimeout(row.timer);
  }

  register(handler: AccessActionHandler): Unsubscribe {
    if (this.handlers.has(handler.action)) throw new Error(`access action ${handler.action} has a handler already`);
    this.handlers.set(handler.action, handler);
    return () => this.handlers.delete(handler.action);
  }

  check(sessionId: SessionId, action: AccessAction, target: AccessTarget): AccessCheck {
    const grant = this.grantList.find((entry) => entry.sessionId === sessionId && entry.action === action && entry.target.id === target.id);
    if (grant === undefined) return 'ask';
    return grant.effect === 'allow' ? 'allow' : 'quiet_deny';
  }

  async request<R>(caller: Caller & { kind: 'mcp' }, action: AccessAction, target: AccessTarget, input: Record<string, unknown>, signal: AbortSignal): Promise<R | AccessCallResult> {
    const handler = this.handlers.get(action);
    if (!handler) throw new AccessError('invalid', `no owner handles ${action}`);
    const row = this.findOpen(caller.sessionId, action, target.id) ?? this.open(caller, handler, target, input);
    return this.wait<R>(row, signal);
  }

  async decide(requestId: string, decision: AccessDecision, expected?: AccessExpected): Promise<AccessRequestRecord> {
    const row = this.require(requestId);
    if (row.state !== 'pending' || row.deciding) throw new AccessError('invalid_state', 'the request is decided already');
    if ('deny' in decision) {
      if (decision.message !== undefined && decision.message.length > ACCESS_MESSAGE_MAX_CHARS) throw new AccessError('invalid', `a message has at most ${ACCESS_MESSAGE_MAX_CHARS} characters`);
      this.deny(row, 'user', decision.message);
      return this.record(row);
    }
    const scope = decision.allow;
    if (!row.offered.includes(scope)) throw new AccessError('invalid', `${scope} is not offered for ${row.action}`);
    if (scope === 'session' && !this.options.isLive(row.sessionId)) throw new AccessError('refused', 'a session without a running process takes no session grant');
    const handler = this.handlerOf(row);
    row.deciding = true;
    try {
      if (expected !== undefined) await this.checkExpected(row, handler, expected);
      const performNow = row.calls.size > 0 || PERFORM_AT_DECISION.includes(row.action);
      if (performNow && !(await this.perform(row, handler, expected ?? {}))) return this.record(row);
      if (scope === 'always') handler.applyAlways?.(row.target);
      if (scope === 'session') this.addGrant(row, 'allow');
      this.finish(row, 'allowed', { scope });
      this.resolveItem(row, 'approved');
      this.announce(row, () => row.result);
      return this.record(row);
    } finally {
      row.deciding = false;
    }
  }

  async result(caller: Caller & { kind: 'mcp' }, requestId: string, waitSeconds: number, signal: AbortSignal): Promise<AccessResultValue> {
    const row = this.rows.get(requestId);
    if (!row || row.sessionId !== caller.sessionId) throw new AccessError('not_found', `no access request ${requestId}`);
    if (row.state === 'pending' && waitSeconds > 0) await this.untilDecided(row, waitSeconds * 1000, signal);
    if (row.state === 'allowed' && !row.performed) await this.performOnce(row);
    return this.valueOf(row);
  }

  detail(requestId: string): Promise<AccessDetail> {
    const row = this.require(requestId);
    return this.handlerOf(row).detail(this.record(row));
  }

  grants(sessionId?: SessionId): readonly AccessGrant[] {
    return this.grantList.filter((grant) => sessionId === undefined || grant.sessionId === sessionId);
  }

  revoke(grant: { sessionId: SessionId; action: AccessAction; targetId: string }): void {
    const index = this.grantList.findIndex((entry) => entry.sessionId === grant.sessionId && entry.action === grant.action && entry.target.id === grant.targetId);
    if (index < 0) return;
    this.grantList.splice(index, 1);
    this.notifyGrants(grant.sessionId);
  }

  withdrawTarget(targetId: string): void {
    for (const row of this.rows.values()) {
      if (row.target.id === targetId && row.state === 'pending') this.end(row, 'withdrawn', 'superseded', { access: 'denied', requestId: row.requestId, reason: 'stale', message: 'The target was removed.' });
    }
    for (const grant of this.grantList.filter((entry) => entry.target.id === targetId)) this.revoke({ sessionId: grant.sessionId, action: grant.action, targetId });
  }

  /** The session's process ended: its grants and quiet denies go, its pending reads and removals expire, its calls close. */
  sessionEnded(sessionId: SessionId): void {
    const had = this.grantList.some((grant) => grant.sessionId === sessionId);
    for (let index = this.grantList.length - 1; index >= 0; index -= 1) if (this.grantList[index]?.sessionId === sessionId) this.grantList.splice(index, 1);
    if (had) this.notifyGrants(sessionId);
    for (const row of this.rows.values()) {
      if (row.sessionId !== sessionId || row.state !== 'pending') continue;
      if (OPEN_AFTER_SESSION_EXIT.includes(row.action)) this.closeCalls(row);
      else this.end(row, 'expired', 'superseded', this.pending(row));
    }
  }

  get(requestId: string): AccessRequestRecord | undefined {
    const row = this.rows.get(requestId);
    return row ? this.record(row) : undefined;
  }

  subscribe(listener: (record: AccessRequestRecord) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeGrants(listener: (sessionId: SessionId) => void): Unsubscribe {
    this.grantListeners.add(listener);
    return () => this.grantListeners.delete(listener);
  }

  private findOpen(sessionId: SessionId, action: AccessAction, targetId: string): Row | undefined {
    return [...this.rows.values()].find((row) => row.state === 'pending' && row.sessionId === sessionId && row.action === action && row.target.id === targetId);
  }

  private open(caller: Caller & { kind: 'mcp' }, handler: AccessActionHandler, target: AccessTarget, input: Record<string, unknown>): Row {
    const { sessionId } = caller;
    const openCount = [...this.rows.values()].filter((row) => row.sessionId === sessionId && row.state === 'pending').length;
    if (openCount >= ACCESS_OPEN_PER_SESSION) throw new AccessError('limit_reached', `at most ${ACCESS_OPEN_PER_SESSION} access requests of a session stay open`);
    const cutoff = this.now().getTime() - ACCESS_WINDOW_MS;
    const recent = (this.recent.get(sessionId) ?? []).filter((time) => time > cutoff);
    if (recent.length >= ACCESS_REQUESTS_PER_WINDOW) throw new AccessError('limit_reached', 'too many access requests in a short time');
    recent.push(this.now().getTime());
    this.recent.set(sessionId, recent);

    const text = ACCESS_ITEM_TEXT[handler.action];
    const title = cleanLine(this.options.sessionTitle(sessionId) ?? 'A session');
    const { item } = this.options.inbox.post({
      folderId: caller.folderId,
      kind: 'approval',
      urgency: 'high',
      source: 'app',
      origin: ACCESS_ITEM_ORIGIN,
      sessionId,
      linkNodeId: target.nodeId,
      message: `${title.slice(0, Math.max(1, MESSAGE_MAX - text.length - 1))} ${text}`,
      textAuthor: 'app',
      payload: { action: handler.action, targetKind: target.kind, targetId: target.id },
      dedupeKey: `access:${sessionId}:${handler.action}:${target.id}`,
    });
    const created = this.now();
    const hours = this.options.settings().requestHours;
    const row: Row = {
      requestId: item.id,
      sessionId,
      action: handler.action,
      target,
      input,
      offered: handler.offered(target, sessionId),
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + hours * 3_600_000).toISOString(),
      state: 'pending',
      scope: undefined,
      reason: undefined,
      message: undefined,
      performed: false,
      deciding: false,
      performing: undefined,
      callState: 'waiting',
      delivery: 'none',
      decidedAt: undefined,
      result: undefined,
      calls: new Set(),
      watchers: new Set(),
      timer: undefined,
    };
    row.timer = setTimeout(() => this.end(row, 'expired', 'expired', this.pending(row)), hours * 3_600_000);
    unref(row.timer);
    this.rows.set(row.requestId, row);
    this.emit(row);
    return row;
  }

  private wait<R>(row: Row, signal: AbortSignal): Promise<R | AccessCallResult> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const leave = (value: unknown, state: AccessCallState): void => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        row.calls.delete(settle);
        if (row.calls.size === 0 && row.callState === 'waiting') row.callState = state;
        this.emit(row);
        resolve(value as R | AccessCallResult);
      };
      const settle: CallSettle = (value, state = 'returned') => leave(value, state);
      const onAbort = (): void => leave(this.pending(row), 'closed');
      row.calls.add(settle);
      row.callState = 'waiting';
      const waitMs = this.options.settings().waitSeconds * 1000;
      if (signal.aborted) onAbort();
      else if (waitMs <= 0) leave(this.pending(row), 'returned');
      else {
        timer = setTimeout(() => leave(this.pending(row), 'returned'), waitMs);
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private untilDecided(row: Row, ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        row.watchers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      row.watchers.add(done);
      if (signal.aborted) done();
      else signal.addEventListener('abort', done, { once: true });
    });
  }

  private async checkExpected(row: Row, handler: AccessActionHandler, expected: AccessExpected): Promise<void> {
    const detail = await handler.detail(this.record(row));
    const moved =
      (expected.revision !== undefined && detail.diff?.revision !== expected.revision) ||
      (expected.sha256 !== undefined && detail.diff?.sha256 !== expected.sha256) ||
      (expected.digest !== undefined && detail.digest !== expected.digest);
    if (moved) throw new AccessError('refused', 'the target changed after the card showed it; decide on the new card');
  }

  /** Runs an allowed read once; a second `result` while it runs waits for the same run. */
  private performOnce(row: Row): Promise<void> {
    row.performing ??= this.perform(row, this.handlerOf(row), {})
      .then(() => undefined)
      .finally(() => {
        row.performing = undefined;
      });
    return row.performing;
  }

  /** Runs the action. Returns false when it refused: the request then ended `denied`. */
  private async perform(row: Row, handler: AccessActionHandler, expected: AccessExpected): Promise<boolean> {
    try {
      row.result = await handler.perform(this.record(row), expected);
    } catch (error) {
      const reason = error instanceof AccessRefusal ? error.reason : 'failed';
      const message = error instanceof AccessRefusal ? error.message : undefined;
      this.deny(row, reason, message);
      return false;
    }
    row.performed = true;
    return true;
  }

  private deny(row: Row, reason: AccessDenyReason, message: string | undefined): void {
    this.finishDenied(row, reason, message);
    if (reason === 'user' && QUIET_DENY_ACTIONS.includes(row.action) && this.options.isLive(row.sessionId)) this.addGrant(row, 'deny');
  }

  private finishDenied(row: Row, reason: AccessDenyReason, message: string | undefined): void {
    this.finish(row, 'denied', { reason, ...(message === undefined ? {} : { message }) });
    this.resolveItem(row, 'denied');
    this.handlerOf(row).ended?.(this.record(row));
    this.announce(row, () => this.deniedCall(row));
  }

  /** The row leaves `pending` without a decision of the user: expiry, a removed target. */
  private end(row: Row, state: 'expired' | 'withdrawn', resolution: 'expired' | 'superseded', answer: unknown): void {
    if (row.state !== 'pending') return;
    this.finish(row, state, {});
    this.resolveItem(row, resolution);
    this.handlerOf(row).ended?.(this.record(row));
    this.closeCalls(row, answer);
  }

  private finish(row: Row, state: AccessState, fields: { scope?: AccessScope; reason?: AccessDenyReason; message?: string }): void {
    if (row.timer) clearTimeout(row.timer);
    row.timer = undefined;
    row.state = state;
    row.scope = fields.scope;
    row.reason = fields.reason;
    row.message = fields.message;
    row.decidedAt = this.now().toISOString();
    for (const watcher of [...row.watchers]) watcher();
  }

  /** Tells the waiting calls, or announces the decision to the session when no call waits. */
  private announce(row: Row, answer: () => unknown): void {
    if (row.calls.size > 0) {
      row.delivery = 'in_call';
      const value = answer();
      for (const settle of [...row.calls]) settle(value);
      return;
    }
    this.emit(row);
    this.options.delivery.enqueue({
      recordId: row.requestId,
      sessionId: row.sessionId,
      noticeLine: accessNoticeLine(row.requestId),
      contextLine: accessContextLine(row.requestId),
      onDelivered: (delivery: NoticeDeliveryKind) => {
        row.delivery = delivery;
        this.emit(row);
      },
    });
  }

  private closeCalls(row: Row, answer: unknown = this.pending(row)): void {
    for (const settle of [...row.calls]) settle(answer, 'closed');
    this.emit(row);
  }

  /** An item the user dismissed or another path resolved is done already; the request does not fail on that. */
  private resolveItem(row: Row, resolution: 'approved' | 'denied' | 'expired' | 'superseded'): void {
    try {
      this.options.inbox.resolve(row.requestId, resolution);
    } catch (error) {
      if (!(error instanceof InboxError)) throw error;
    }
  }

  private deniedCall(row: Row): AccessCallResult {
    return { access: 'denied', requestId: row.requestId, reason: row.reason ?? 'user', ...(row.message === undefined ? {} : { message: row.message }) };
  }

  private pending(row: Row): AccessCallResult {
    return { access: 'pending', requestId: row.requestId, note: ACCESS_PENDING_NOTE };
  }

  private valueOf(row: Row): AccessResultValue {
    if (row.state === 'allowed' || row.state === 'denied') {
      this.options.delivery.cancel(row.requestId);
      row.delivery = 'read';
      this.emit(row);
    }
    if (row.state === 'allowed') return { requestId: row.requestId, state: 'allowed', scope: row.scope ?? 'once', ...(row.result === undefined ? {} : { result: row.result }) };
    if (row.state === 'denied') return { requestId: row.requestId, state: 'denied', reason: row.reason ?? 'user', ...(row.message === undefined ? {} : { message: row.message }) };
    return { requestId: row.requestId, state: row.state };
  }

  private addGrant(row: Row, effect: 'allow' | 'deny'): void {
    this.grantList.push({ sessionId: row.sessionId, action: row.action, target: row.target, effect, requestId: row.requestId, createdAt: this.now().toISOString() });
    this.notifyGrants(row.sessionId);
  }

  private notifyGrants(sessionId: SessionId): void {
    for (const listener of [...this.grantListeners]) listener(sessionId);
  }

  private handlerOf(row: Row): AccessActionHandler {
    const handler = this.handlers.get(row.action);
    if (!handler) throw new AccessError('invalid', `no owner handles ${row.action}`);
    return handler;
  }

  private require(requestId: string): Row {
    const row = this.rows.get(requestId);
    if (!row) throw new AccessError('not_found', `no access request ${requestId}`);
    return row;
  }

  private emit(row: Row): void {
    const record = this.record(row);
    for (const listener of [...this.listeners]) listener(record);
  }

  private record(row: Row): AccessRequestRecord {
    return {
      requestId: row.requestId,
      sessionId: row.sessionId,
      action: row.action,
      target: row.target,
      input: row.input,
      offered: row.offered,
      state: row.state,
      ...(row.scope === undefined ? {} : { scope: row.scope }),
      ...(row.reason === undefined ? {} : { reason: row.reason }),
      ...(row.message === undefined ? {} : { message: row.message }),
      performed: row.performed,
      callState: row.callState,
      delivery: row.delivery,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      ...(row.decidedAt === undefined ? {} : { decidedAt: row.decidedAt }),
    };
  }
}
