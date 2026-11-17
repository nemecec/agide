import { randomUUID } from 'node:crypto';
import type { Unsubscribe } from '../events/EventBus';
import {
  SessionError,
  type SessionCreateInput,
  type SessionEvent,
  type SessionId,
  type SessionInfo,
  type SessionService,
  type SessionStatus,
} from './types';

/**
 * A `SessionService` without processes, for unit tests and UI work. A created session is `idle` at once.
 * `sendText` echoes the text as output and passes through `busy` back to `idle`.
 */
export class FakeSessionService implements SessionService {
  private readonly sessions = new Map<SessionId, SessionInfo>();
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  readonly written: { id: SessionId; data: string }[] = [];

  constructor(private readonly newId: () => SessionId = randomUUID) {}

  async create(input: SessionCreateInput): Promise<SessionInfo> {
    const session: SessionInfo = {
      id: this.newId(),
      folderId: input.folderId,
      title: input.title ?? 'Claude session',
      cwd: input.cwd,
      launchPath: input.launchPath ?? 'pty',
      status: 'idle',
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    this.emit({ type: 'session.created', session });
    if (input.prompt) this.sendText(session.id, input.prompt);
    return session;
  }

  async resume(id: SessionId): Promise<SessionInfo> {
    const session = this.require(id);
    if (session.status !== 'exited') throw new SessionError('already_running', `session ${id} runs`);
    return this.setStatus(id, 'idle');
  }

  async close(id: SessionId): Promise<void> {
    this.require(id);
    this.sessions.delete(id);
    this.emit({ type: 'session.closed', sessionId: id });
  }

  sendText(id: SessionId, text: string): void {
    this.requireRunning(id);
    this.setStatus(id, 'busy');
    this.emit({ type: 'session.output', sessionId: id, data: `${text}\r\n` });
    this.setStatus(id, 'idle');
  }

  write(id: SessionId, data: string): void {
    this.requireRunning(id);
    this.written.push({ id, data });
    this.emit({ type: 'session.output', sessionId: id, data });
  }

  resize(id: SessionId): void {
    this.requireRunning(id);
  }

  /** Test helper: ends the fake process. */
  exit(id: SessionId, exitCode = 0): void {
    const session = this.setStatus(id, 'exited', exitCode);
    this.emit({ type: 'session.exited', session, exitCode, signal: null });
  }

  get(id: SessionId): SessionInfo | undefined {
    return this.sessions.get(id);
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()];
  }

  subscribe(listener: (event: SessionEvent) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(id: SessionId, status: SessionStatus, exitCode?: number): SessionInfo {
    const previous = this.require(id);
    const session: SessionInfo = { ...previous, status, ...(exitCode === undefined ? {} : { exitCode }) };
    this.sessions.set(id, session);
    if (status !== previous.status) this.emit({ type: 'session.status_changed', session, previous: previous.status });
    return session;
  }

  private require(id: SessionId): SessionInfo {
    const session = this.sessions.get(id);
    if (!session) throw new SessionError('not_found', `no session ${id}`);
    return session;
  }

  private requireRunning(id: SessionId): void {
    if (this.require(id).status === 'exited') throw new SessionError('not_running', `session ${id} has exited`);
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
