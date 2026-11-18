import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import { APP_STARTED_AGENT_KEY, MAIN_AGENT_KEY, type AgentFact, type AgentRecord, type AgentRef, type AgentState, type AgentStore, type TokenUsage } from './types';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const ZERO: TokenUsage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
/** Facts for a record that has not started yet wait this long (hook files and transcript reads can reorder). */
export const PENDING_FACT_MS = 5000;

const keyOf = (ref: AgentRef) => `${ref.sessionId}:${ref.agentKey}`;
const ENDED: readonly AgentState[] = ['failed', 'done'];

/**
 * Agent records in memory (0027 section 2). The SQLite store of w-agents passes the same contract. `now`
 * drives the pending list only; record times come from the facts.
 */
export class InMemoryAgentStore implements AgentStore {
  private readonly records = new Map<string, Mutable<AgentRecord>>();
  private readonly pending: { fact: AgentFact & { ref: AgentRef }; until: number }[] = [];
  private readonly sessionRequests = new Map<SessionId, Set<string>>();
  /** Message ids counted per record, with the usage last counted for each. */
  private readonly messages = new Map<string, Map<string, TokenUsage>>();
  private readonly listeners = new Set<(changed: readonly AgentRecord[]) => void>();

  constructor(private readonly now: () => number = Date.now) {}

  apply(fact: AgentFact): void {
    if (fact.kind === 'session-cost' || fact.kind === 'plan') return;
    this.dropExpired();
    if (fact.ref.agentKey === MAIN_AGENT_KEY) return this.applyMain(fact);
    const key = keyOf(fact.ref);
    const record = this.records.get(key);
    if (fact.kind === 'started') {
      this.start(key, fact, record);
      for (const waiting of this.pending.filter((entry) => keyOf(entry.fact.ref) === key)) {
        this.pending.splice(this.pending.indexOf(waiting), 1);
        this.apply(waiting.fact);
      }
      return;
    }
    if (!record) {
      this.pending.push({ fact, until: this.now() + PENDING_FACT_MS });
      return;
    }
    this.update(record, fact);
    this.changed([record]);
  }

  get(ref: AgentRef): AgentRecord | undefined {
    return this.records.get(keyOf(ref));
  }

  list(filter: { readonly sessionId?: SessionId; readonly states?: readonly AgentState[] } = {}): AgentRecord[] {
    return [...this.records.values()]
      .filter((record) => (filter.sessionId === undefined || record.ref.sessionId === filter.sessionId) && (filter.states === undefined || filter.states.includes(record.state)))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  waitingSessions(): SessionId[] {
    return [...this.sessionRequests.entries()].filter(([, requests]) => requests.size > 0).map(([sessionId]) => sessionId).sort();
  }

  remove(ref: AgentRef): void {
    const record = this.records.get(keyOf(ref));
    if (!record) return;
    this.records.delete(keyOf(ref));
    this.messages.delete(keyOf(ref));
    this.changed([record]);
  }

  subscribe(listener: (changed: readonly AgentRecord[]) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private start(key: string, fact: Extract<AgentFact, { kind: 'started' }>, existing: Mutable<AgentRecord> | undefined): void {
    const { kind: _kind, at, ref, backgrounded: _backgrounded, ...details } = fact;
    if (existing) {
      // A resumed agent returns to running and loses its end (0027 section 2).
      Object.assign(existing, details, { state: 'running', updatedAt: at });
      delete existing.endedAt;
      delete existing.outcome;
      delete existing.outcomeBasis;
      this.changed([existing]);
      return;
    }
    const record: Mutable<AgentRecord> = {
      ...details,
      ref,
      origin: ref.agentKey === APP_STARTED_AGENT_KEY ? 'app-started' : 'session-started',
      state: 'running',
      openRequests: [],
      tokens: ZERO,
      startedAt: at,
      updatedAt: at,
    };
    this.records.set(key, record);
    this.changed([record]);
  }

  private update(record: Mutable<AgentRecord>, fact: Exclude<AgentFact, { kind: 'started' | 'session-cost' | 'plan' }>): void {
    switch (fact.kind) {
      case 'linked': {
        const { kind: _kind, ref: _ref, ...details } = fact;
        Object.assign(record, details);
        return;
      }
      case 'progress':
        if (fact.lastTool !== undefined) record.lastTool = fact.lastTool;
        record.updatedAt = fact.at;
        return;
      case 'waiting':
        if (!record.openRequests.includes(fact.requestKey)) record.openRequests = [...record.openRequests, fact.requestKey];
        if (!ENDED.includes(record.state)) record.state = 'waiting';
        record.updatedAt = fact.at;
        return;
      case 'answered':
        record.openRequests = fact.requestKey === undefined ? [] : record.openRequests.filter((key) => key !== fact.requestKey);
        if (record.state === 'waiting' && record.openRequests.length === 0) record.state = 'running';
        record.updatedAt = fact.at;
        return;
      case 'ended':
        record.state = fact.outcome === 'completed' || fact.outcome === 'stopped' ? 'done' : 'failed';
        record.outcome = fact.outcome;
        record.outcomeBasis = fact.basis;
        record.openRequests = [];
        record.endedAt = fact.at;
        record.updatedAt = fact.at;
        if (fact.summary !== undefined) record.summary = fact.summary;
        if (fact.transcriptPath !== undefined) record.transcriptPath = fact.transcriptPath;
        return;
      case 'usage': {
        const seen = this.messages.get(keyOf(record.ref)) ?? new Map<string, TokenUsage>();
        this.messages.set(keyOf(record.ref), seen);
        const previous = seen.get(fact.messageId) ?? ZERO;
        seen.set(fact.messageId, fact.usage);
        // Each message id counts once: a repeated line replaces the usage counted before (P13).
        record.tokens = add(record.tokens, fact.usage, previous);
        record.updatedAt = fact.at;
        return;
      }
    }
  }

  private applyMain(fact: Exclude<AgentFact, { kind: 'session-cost' | 'plan' }>): void {
    const requests = this.sessionRequests.get(fact.ref.sessionId) ?? new Set<string>();
    if (fact.kind === 'waiting') requests.add(fact.requestKey);
    else if (fact.kind === 'answered') {
      if (fact.requestKey === undefined) requests.clear();
      else requests.delete(fact.requestKey);
    } else return;
    this.sessionRequests.set(fact.ref.sessionId, requests);
    this.changed([]);
  }

  private dropExpired(): void {
    const now = this.now();
    for (let index = this.pending.length - 1; index >= 0; index -= 1) if ((this.pending[index]?.until ?? 0) < now) this.pending.splice(index, 1);
  }

  private changed(records: readonly AgentRecord[]): void {
    const copies = records.map((record) => ({ ...record }));
    for (const listener of this.listeners) listener(copies);
  }
}

function add(total: TokenUsage, next: TokenUsage, previous: TokenUsage): TokenUsage {
  return {
    input: total.input + next.input - previous.input,
    output: total.output + next.output - previous.output,
    cacheWrite5m: total.cacheWrite5m + next.cacheWrite5m - previous.cacheWrite5m,
    cacheWrite1h: total.cacheWrite1h + next.cacheWrite1h - previous.cacheWrite1h,
    cacheRead: total.cacheRead + next.cacheRead - previous.cacheRead,
  };
}
