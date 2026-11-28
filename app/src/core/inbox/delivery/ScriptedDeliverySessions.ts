import type { LaunchPath, SessionId, SessionStatus } from '../../session/types';
import type { DeliverySessions } from './types';

/** A `DeliverySessions` that tests drive: set a session's status, read what was typed or written. */
export class ScriptedDeliverySessions implements DeliverySessions {
  readonly typed: { sessionId: SessionId; line: string }[] = [];
  readonly written: { sessionId: SessionId; line: string }[] = [];
  /** A thrown error stands for a terminal that no longer takes input. */
  failWith: Error | undefined;
  private readonly known = new Map<SessionId, { status: SessionStatus; launchPath: LaunchPath }>();

  set(sessionId: SessionId, status: SessionStatus, launchPath: LaunchPath = 'pty'): void {
    this.known.set(sessionId, { status, launchPath });
  }

  state(sessionId: SessionId): { readonly status: SessionStatus; readonly launchPath: LaunchPath } | undefined {
    return this.known.get(sessionId);
  }

  typeLine(sessionId: SessionId, line: string): void {
    if (this.failWith) throw this.failWith;
    this.typed.push({ sessionId, line });
  }

  writeUserMessage(sessionId: SessionId, line: string): void {
    if (this.failWith) throw this.failWith;
    this.written.push({ sessionId, line });
  }
}
