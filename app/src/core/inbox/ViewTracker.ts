import type { SessionId } from '../session/types';
import type { InboxService } from './types';

export const VIEW_DELAY_MS = 2000;
const VIEW_ORIGINS = ['hook:Stop', 'hook:Notification:idle_prompt', 'hook:Notification:elicitation_dialog'];

export interface Timers {
  setTimeout(work: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (work, ms) => {
    const handle = setTimeout(work, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/**
 * Which session the user looks at (its leaf is open in a focused window, or its peek is shown). A session counts
 * as viewed after it stayed in view for two seconds; then its hook-made status and input items resolve with
 * `viewed` and its other open items count as seen (0021 section 8).
 */
export class ViewTracker {
  private current: SessionId | undefined;
  private viewed: SessionId | undefined;
  private timer: unknown;

  constructor(
    private readonly inbox: InboxService,
    private readonly timers: Timers = realTimers,
    private readonly delayMs = VIEW_DELAY_MS,
  ) {}

  /** Reports the session in view, or `undefined` when none is. */
  set(sessionId: SessionId | undefined): void {
    if (sessionId === this.current) return;
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.current = sessionId;
    this.viewed = undefined;
    if (sessionId !== undefined) this.timer = this.timers.setTimeout(() => this.settle(sessionId), this.delayMs);
  }

  /** Whether the session has stayed in view long enough to count as viewed. */
  isInView(sessionId: SessionId): boolean {
    return this.viewed === sessionId;
  }

  /** Applies the viewing rule again, for items that arrived while the session was already in view. */
  refresh(): void {
    if (this.viewed !== undefined) this.apply(this.viewed);
  }

  dispose(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private settle(sessionId: SessionId): void {
    this.timer = undefined;
    this.viewed = sessionId;
    this.apply(sessionId);
  }

  private apply(sessionId: SessionId): void {
    this.inbox.resolveSessionItems(sessionId, ['status', 'input'], 'viewed', VIEW_ORIGINS);
    for (const item of this.inbox.list({ sessionId, states: ['new'] })) this.inbox.markSeen(item.id);
  }
}
