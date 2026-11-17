import type { InboxEvent, InboxItem } from './types';

export interface NotifierSink {
  notify(notification: { title: string; body: string }): void;
}

export interface InboxNotifierOptions {
  readonly sink: NotifierSink;
  readonly now: () => Date;
  /** Profile name and project name for the title. */
  readonly titleFor: (item: InboxItem) => string;
  /** Shows only the titles when false. */
  readonly showBody?: boolean;
  readonly throttleMs?: number;
}

const THROTTLE_MS = 60_000;

/**
 * Decides which items raise a macOS notification (0021 sections 8 and 10). Items from agents, the app and the
 * scheduler notify when created. Hook items notify only on request, after the prompt signal that shows the
 * user has not answered, except failures and alerts. Low urgency never notifies, and `status` items only at high.
 * One notification per session per throttle window.
 */
export class InboxNotifier {
  private readonly lastBySession = new Map<string, number>();

  constructor(private readonly options: InboxNotifierOptions) {}

  onEvent(event: InboxEvent): void {
    if (event.type !== 'inbox.item_changed') return;
    if (event.change !== 'created' && event.change !== 'coalesced') return;
    if (this.notifiesOnArrival(event.item)) this.notifyNow(event.item);
  }

  /** Notifies for an item that waited for a later signal. */
  notifyNow(item: InboxItem): void {
    if (item.urgency === 'low' || item.state !== 'new') return;
    if (item.kind === 'status' && item.urgency !== 'high' && item.origin !== 'hook:Stop') return;
    const key = item.sessionId ?? '';
    const now = this.options.now().getTime();
    const last = this.lastBySession.get(key);
    if (last !== undefined && now - last < (this.options.throttleMs ?? THROTTLE_MS)) return;
    this.lastBySession.set(key, now);
    this.options.sink.notify({ title: this.options.titleFor(item), body: this.options.showBody === false ? '' : item.message });
  }

  private notifiesOnArrival(item: InboxItem): boolean {
    if (item.source !== 'hook') return true;
    return item.kind === 'failure' || item.kind === 'alert';
  }
}
