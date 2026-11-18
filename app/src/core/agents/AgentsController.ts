import type { SessionEvent, SessionId } from '../session/types';
import type { UsageEngine } from '../usage/UsageEngine';
import { SessionWatcher, outcomeOfAgentTranscript } from '../usage/SessionWatcher';
import { HookNormaliser } from './normalise/hookAdapter';
import { asRecord, str } from './normalise/payload';
import { StreamNormaliser } from './normalise/streamAdapter';
import type { AgentFact, AgentOutcome, AgentRecord, AgentStore } from './types';

export interface AgentsControllerDeps {
  readonly store: AgentStore;
  readonly usage: UsageEngine;
  readonly now: () => number;
  /** The session's hook inbox directory on the host. */
  readonly eventsDirOf: (sessionId: SessionId) => string;
  readonly maxAppStarted: () => number;
  /** The end of an agent transcript says whether it was interrupted or failed; injected for tests. */
  readonly outcomeOf?: (path: string) => AgentOutcome;
  /** Called after an agent record ended, to copy its transcript. */
  readonly onAgentEnded?: (record: AgentRecord) => void;
  /** Called when a session's process exited and its last transcript read is done. */
  readonly onSessionExited?: (sessionId: SessionId, transcriptPath: string | undefined) => void;
  readonly debug?: (message: string) => void;
}

export type AppStartedResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'cap'; readonly running: number; readonly cap: number };

/**
 * Feeds the agent store and the usage engine from the session's events (0027). PTY sessions come through the
 * hook adapter and a watcher over the status snapshot and transcripts; app-started agents come through the
 * stream-json adapter. Every fact is applied to both consumers in order.
 */
export class AgentsController {
  readonly hooks = new HookNormaliser();
  private readonly watchers = new Map<SessionId, SessionWatcher>();
  private readonly streams = new Map<SessionId, StreamNormaliser>();
  private readonly transcripts = new Map<SessionId, string>();

  constructor(private readonly deps: AgentsControllerDeps) {}

  private iso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  apply(facts: readonly AgentFact[]): void {
    for (const fact of facts) {
      this.deps.store.apply(fact);
      this.deps.usage.apply(fact);
    }
  }

  /** Session events of the PTY path: launches, hooks and exits. */
  handleSession(event: SessionEvent): void {
    switch (event.type) {
      case 'session.created':
        this.watcher(event.session.id);
        return;
      case 'session.status_changed':
        // A resumed session starts a new process; its hook directory is new.
        if (event.previous === 'exited') this.restartWatcher(event.session.id);
        return;
      case 'session.hook':
        this.onHook(event.sessionId, event.hookEvent, event.payload);
        return;
      case 'session.exited':
        this.onExit(event.session.id);
        return;
      case 'session.closed':
        this.watchers.delete(event.sessionId);
        this.hooks.forget(event.sessionId);
        this.transcripts.delete(event.sessionId);
        return;
      default:
    }
  }

  /** Polls the watchers of running sessions (status snapshot and appended transcript lines). */
  tick(): void {
    for (const watcher of this.watchers.values()) watcher.poll();
  }

  transcriptOf(sessionId: SessionId): string | undefined {
    return this.transcripts.get(sessionId);
  }

  appStartedRunning(): number {
    return this.deps.store.list({ states: ['running', 'waiting'] }).filter((record) => record.origin === 'app-started').length;
  }

  /** An app-started agent is about to start; refused at the cap (0012). */
  beginAppStarted(sessionId: SessionId, details: { description?: string } = {}): AppStartedResult {
    const running = this.appStartedRunning();
    const cap = this.deps.maxAppStarted();
    if (running >= cap) return { ok: false, reason: 'cap', running, cap };
    const stream = new StreamNormaliser(sessionId);
    this.streams.set(sessionId, stream);
    this.apply(stream.processStarted(this.iso(), details));
    return { ok: true };
  }

  streamMessage(sessionId: SessionId, message: unknown): void {
    const stream = this.streams.get(sessionId);
    if (stream) this.apply(stream.message(message, this.iso()));
  }

  streamResponse(sessionId: SessionId, requestId: string, decision: 'allow' | 'deny'): void {
    const stream = this.streams.get(sessionId);
    if (stream) this.apply(stream.controlResponse(requestId, decision, this.iso()));
  }

  streamExited(sessionId: SessionId, options: { stopped?: boolean } = {}): void {
    const stream = this.streams.get(sessionId);
    if (!stream) return;
    this.apply(stream.exited(this.iso(), options));
    this.streams.delete(sessionId);
  }

  private watcher(sessionId: SessionId): SessionWatcher {
    let watcher = this.watchers.get(sessionId);
    if (!watcher) {
      watcher = new SessionWatcher({ sessionId, eventsDir: this.deps.eventsDirOf(sessionId), now: this.deps.now, onFacts: (facts) => this.apply(facts) });
      const transcript = this.transcripts.get(sessionId);
      if (transcript !== undefined) watcher.setTranscript(transcript);
      this.watchers.set(sessionId, watcher);
    }
    return watcher;
  }

  private restartWatcher(sessionId: SessionId): void {
    this.watchers.delete(sessionId);
    this.watcher(sessionId);
  }

  private onHook(sessionId: SessionId, hookEvent: string, payload: unknown): void {
    const transcript = str(asRecord(payload)?.['transcript_path']);
    const watcher = this.watcher(sessionId);
    if (transcript !== undefined) {
      this.transcripts.set(sessionId, transcript);
      watcher.setTranscript(transcript);
    }
    const facts = this.hooks.handle(sessionId, hookEvent, payload, this.iso()).map((fact) => this.checkOutcome(fact));
    this.apply(facts);
    if (hookEvent === 'SubagentStop') {
      // The agent's last transcript lines carry usage the periodic read has not seen yet.
      watcher.poll();
      for (const fact of facts) if (fact.kind === 'ended') this.endedRecord(fact.ref);
    }
  }

  private checkOutcome(fact: AgentFact): AgentFact {
    if (fact.kind !== 'ended' || fact.basis !== 'derived' || fact.outcome !== 'completed' || fact.transcriptPath === undefined) return fact;
    const outcome = (this.deps.outcomeOf ?? outcomeOfAgentTranscript)(fact.transcriptPath);
    return outcome === 'completed' ? fact : { ...fact, outcome };
  }

  private endedRecord(ref: { sessionId: SessionId; agentKey: string }): void {
    const record = this.deps.store.get(ref);
    if (record) this.deps.onAgentEnded?.(record);
  }

  private onExit(sessionId: SessionId): void {
    const watcher = this.watcher(sessionId);
    watcher.finish();
    const facts = this.hooks.exited(sessionId, this.iso(), (agentId) => watcher.agentFinished(agentId));
    this.apply(facts);
    for (const fact of facts) if (fact.kind === 'ended') this.endedRecord(fact.ref);
    this.watchers.delete(sessionId);
    this.deps.onSessionExited?.(sessionId, this.transcripts.get(sessionId));
  }
}
