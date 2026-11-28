import type { SessionId } from '../../session/types';
import type { DeliverySessions, Notice, NoticeDelivery } from './types';

/**
 * The planner of the table in 0043 section 4.4 over a `DeliverySessions` port: an idle PTY session gets the notice
 * line typed, an idle stream-json session gets it as a user message, a busy, waiting, starting or exited session
 * keeps it queued for `flush` or the next `UserPromptSubmit`. A failure of the port reports `failed`.
 */
export class InMemoryNoticeDelivery implements NoticeDelivery {
  private readonly queued = new Map<string, Notice>();

  constructor(private readonly sessions: DeliverySessions) {}

  enqueue(notice: Notice): void {
    this.queued.set(notice.recordId, notice);
    this.deliver(notice);
  }

  cancel(recordId: string): void {
    this.queued.delete(recordId);
  }

  takeContext(sessionId: SessionId): readonly { readonly recordId: string; readonly contextLine: string }[] {
    const taken = [...this.queued.values()].filter((notice) => notice.sessionId === sessionId);
    for (const notice of taken) {
      this.queued.delete(notice.recordId);
      notice.onDelivered('context');
    }
    return taken.map((notice) => ({ recordId: notice.recordId, contextLine: notice.contextLine }));
  }

  flush(sessionId: SessionId): void {
    for (const notice of [...this.queued.values()]) if (notice.sessionId === sessionId) this.deliver(notice);
  }

  private deliver(notice: Notice): void {
    const state = this.sessions.state(notice.sessionId);
    if (state?.status !== 'idle') return;
    this.queued.delete(notice.recordId);
    try {
      if (state.launchPath === 'pty') this.sessions.typeLine(notice.sessionId, notice.noticeLine);
      else this.sessions.writeUserMessage(notice.sessionId, notice.noticeLine);
    } catch {
      notice.onDelivered('failed');
      return;
    }
    notice.onDelivered(state.launchPath === 'pty' ? 'notice' : 'stdin');
  }
}
