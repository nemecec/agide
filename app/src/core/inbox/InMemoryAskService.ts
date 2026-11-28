import type { Caller } from '../commands/types';
import type { SessionId } from '../session/types';
import {
  ASK_ITEM_ORIGIN,
  ASK_OPEN_PER_SESSION,
  ASK_RETURN_MARGIN_MS,
  askContextLine,
  askNoticeLine,
  AskError,
  type AskCallState,
  type AskDelivery,
  type AskEvent,
  type AskRecord,
  type AskService,
  type InboxAskInput,
  type InboxAskResult,
  type InboxAskResultValue,
} from './askTypes';
import type { NoticeDelivery, NoticeDeliveryKind } from './delivery/types';
import type { InboxService } from './types';

export interface InMemoryAskServiceOptions {
  readonly inbox: InboxService;
  readonly delivery: NoticeDelivery;
  readonly now?: () => Date;
}

interface Waiter {
  settle(result: InboxAskResult): void;
}

interface Row {
  askId: string;
  sessionId: SessionId;
  options: readonly { id: string; label: string }[];
  allowFreeText: boolean;
  wait: boolean;
  timeoutAt: string;
  callState: AskCallState;
  answer?: { choice?: string; text?: string; answeredAt: string };
  delivery: AskDelivery;
  toolUseId: string | undefined;
  dismissed: boolean;
  waiter: Waiter | undefined;
}

/** The service of 0043 section 4.4 in memory; `SqliteAskService` of w-ask keeps the same contract. */
export class InMemoryAskService implements AskService {
  private readonly rows = new Map<string, Row>();
  private readonly listeners = new Set<(event: AskEvent) => void>();
  private readonly now: () => Date;
  private readonly off: () => void;

  constructor(private readonly options: InMemoryAskServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.off = options.inbox.subscribe((event) => {
      if (event.type !== 'inbox.item_changed' || event.change !== 'resolved' || event.item.origin !== ASK_ITEM_ORIGIN) return;
      const row = this.rows.get(event.item.id);
      if (row && row.answer === undefined && event.item.resolution === 'dismissed') this.dismiss(row);
    });
  }

  dispose(): void {
    this.off();
  }

  ask(caller: Caller & { kind: 'mcp' }, input: InboxAskInput, signal: AbortSignal): Promise<InboxAskResult> {
    if (this.openCount(caller.sessionId) >= ASK_OPEN_PER_SESSION) {
      return Promise.reject(new AskError('limit_reached', `at most ${ASK_OPEN_PER_SESSION} questions of a session stay open`));
    }
    const timeoutMs = input.timeoutSeconds * 1000;
    const { item } = this.options.inbox.post({
      folderId: caller.folderId,
      kind: 'input',
      urgency: 'high',
      source: 'agent',
      origin: ASK_ITEM_ORIGIN,
      sessionId: caller.sessionId,
      message: input.question,
      ...(input.details === undefined ? {} : { details: input.details }),
      ...(input.link?.nodeId === undefined ? {} : { linkNodeId: input.link.nodeId }),
      ...(input.link?.url === undefined ? {} : { linkAnchor: { url: input.link.url } }),
      textAuthor: 'agent',
      payload: { options: input.options, allowFreeText: input.allowFreeText ?? input.options.length === 0 },
    });
    const row: Row = {
      askId: item.id,
      sessionId: caller.sessionId,
      options: input.options,
      allowFreeText: input.allowFreeText ?? input.options.length === 0,
      wait: input.wait,
      timeoutAt: new Date(this.now().getTime() + timeoutMs).toISOString(),
      callState: input.wait ? 'waiting' : 'returned',
      delivery: 'none',
      toolUseId: input.toolUseId,
      dismissed: false,
      waiter: undefined,
    };
    this.rows.set(row.askId, row);
    this.emit(row);
    if (!input.wait) return Promise.resolve({ status: 'queued', askId: row.askId, note: 'The question is in the inbox. Read the answer with inbox_ask_result.' });
    return new Promise((resolve) => {
      const finish = (result: InboxAskResult, state: AskCallState): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        row.waiter = undefined;
        if (row.callState === 'waiting') row.callState = state;
        this.emit(row);
        resolve(result);
      };
      const later = (): InboxAskResult => ({ status: 'timeout', askId: row.askId, note: 'The user has not answered yet. You will be told when they do; read the answer with inbox_ask_result.' });
      const onAbort = (): void => finish(later(), 'closed');
      const timer = setTimeout(() => finish(later(), 'timed_out'), Math.max(0, timeoutMs - ASK_RETURN_MARGIN_MS));
      row.waiter = {
        settle: (result) => finish(result, result.status === 'dismissed' ? 'returned' : result.status === 'answered' ? 'returned' : 'closed'),
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  answer(askId: string, answer: { choice?: string; text?: string }): AskRecord {
    const row = this.require(askId);
    if (row.answer !== undefined || row.dismissed) throw new AskError('invalid_state', 'the question is already answered or withdrawn');
    if (answer.choice === undefined && answer.text === undefined) throw new AskError('invalid', 'an answer needs a choice or text');
    if (answer.choice !== undefined && !row.options.some((option) => option.id === answer.choice)) throw new AskError('invalid', `${answer.choice} is not an option of this question`);
    if (answer.text !== undefined && !row.allowFreeText) throw new AskError('invalid', 'this question takes no free text');
    row.answer = { ...(answer.choice === undefined ? {} : { choice: answer.choice }), ...(answer.text === undefined ? {} : { text: answer.text }), answeredAt: this.now().toISOString() };
    this.options.inbox.resolve(askId, 'answered');
    if (row.waiter) {
      row.delivery = 'in_call';
      row.waiter.settle({ status: 'answered', askId, ...answerFields(row.answer) });
    } else {
      this.announce(row);
    }
    return this.record(row);
  }

  withdraw(askId: string): AskRecord {
    const row = this.require(askId);
    if (row.answer !== undefined || row.dismissed) throw new AskError('invalid_state', 'the question is already answered or withdrawn');
    this.options.inbox.resolve(askId, 'dismissed');
    return this.record(row);
  }

  result(caller: Caller & { kind: 'mcp' }, askId: string): InboxAskResultValue {
    const row = this.rows.get(askId);
    if (!row || row.sessionId !== caller.sessionId) throw new AskError('not_found', `no question ${askId}`);
    if (row.answer !== undefined) {
      this.options.delivery.cancel(askId);
      row.delivery = 'read';
      this.emit(row);
      return { status: 'answered', askId, ...answerFields(row.answer) };
    }
    return row.dismissed ? { status: 'cancelled', askId } : { status: 'pending', askId };
  }

  takeForContext(sessionId: SessionId): AskRecord[] {
    const taken = this.options.delivery.takeContext(sessionId);
    return taken.flatMap(({ recordId }) => {
      const row = this.rows.get(recordId);
      return row ? [this.record(row)] : [];
    });
  }

  deliverPending(sessionId: SessionId): void {
    for (const row of this.rows.values()) {
      if (row.sessionId === sessionId && row.answer !== undefined && row.callState !== 'waiting' && (row.delivery === 'none' || row.delivery === 'queued')) this.announce(row);
    }
    this.options.delivery.flush(sessionId);
  }

  sessionEnded(sessionId: SessionId): void {
    for (const row of this.rows.values()) {
      if (row.sessionId === sessionId && row.waiter) {
        row.waiter.settle({ status: 'timeout', askId: row.askId, note: 'The session ended.' });
      }
    }
  }

  get(askId: string): AskRecord | undefined {
    const row = this.rows.get(askId);
    return row ? this.record(row) : undefined;
  }

  subscribe(listener: (event: AskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private announce(row: Row): void {
    row.delivery = 'queued';
    this.emit(row);
    this.options.delivery.enqueue({
      recordId: row.askId,
      sessionId: row.sessionId,
      noticeLine: askNoticeLine(row.askId),
      contextLine: askContextLine({ askId: row.askId, ...(row.answer === undefined ? {} : { answer: row.answer }) }),
      onDelivered: (delivery: NoticeDeliveryKind) => {
        row.delivery = delivery;
        this.emit(row);
      },
    });
  }

  private dismiss(row: Row): void {
    row.dismissed = true;
    this.options.delivery.cancel(row.askId);
    if (row.waiter) row.waiter.settle({ status: 'dismissed', askId: row.askId });
    else this.emit(row);
  }

  private openCount(sessionId: SessionId): number {
    return [...this.rows.values()].filter((row) => row.sessionId === sessionId && row.answer === undefined && !row.dismissed).length;
  }

  private require(askId: string): Row {
    const row = this.rows.get(askId);
    if (!row) throw new AskError('not_found', `no question ${askId}`);
    return row;
  }

  private emit(row: Row): void {
    const event: AskEvent = { type: 'inbox.ask_changed', askId: row.askId, callState: row.callState, delivery: row.delivery };
    for (const listener of [...this.listeners]) listener(event);
  }

  private record(row: Row): AskRecord {
    return {
      askId: row.askId,
      sessionId: row.sessionId,
      options: row.options,
      allowFreeText: row.allowFreeText,
      wait: row.wait,
      timeoutAt: row.timeoutAt,
      callState: row.callState,
      ...(row.answer === undefined ? {} : { answer: row.answer }),
      delivery: row.delivery,
      ...(row.toolUseId === undefined ? {} : { toolUseId: row.toolUseId }),
    };
  }
}

function answerFields(answer: { choice?: string; text?: string; answeredAt: string }): { choice?: string; text?: string; answeredAt: string } {
  return { ...(answer.choice === undefined ? {} : { choice: answer.choice }), ...(answer.text === undefined ? {} : { text: answer.text }), answeredAt: answer.answeredAt };
}
