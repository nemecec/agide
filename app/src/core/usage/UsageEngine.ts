import type { AgentFact, AgentRef, PlanWindow, TokenUsage, UsageAggregator, UsageRate, UsageSubject } from '../agents/types';
import { forecast, FORECAST_SPAN_MS, type PlanSample } from './forecast';
import { costOf, weightedTokens } from './prices';
import { RateBuffer } from './RateBuffer';
import { subjectKey, type PlanWindowView, type RankedSubject, type SessionTotals } from './types';

const ZERO: TokenUsage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

interface SeenMessage {
  readonly usage: TokenUsage;
  readonly model: string | undefined;
}

interface SessionState {
  tokens: TokenUsage;
  costUsd: number | undefined;
  basis: string | undefined;
  final: boolean;
  /** Status-line cost counted in earlier segments: a cost that drops starts a new segment (0027 section 7). */
  segmentBase: number;
  lastStatusCost: number;
  /** The first status-line cost of a session is a baseline, not activity: a resumed session starts above zero. */
  statusSeen: boolean;
  /** Transcript estimate counted since the last status-line update, so that update adds only its excess. */
  estimatedSinceStatus: number;
}

export interface UsageEngineOptions {
  readonly now: () => number;
  readonly windowMinutes: () => number;
}

export interface PlanStorage {
  save(window: PlanWindow): void;
}

/**
 * Counts usage from facts and answers rates, the ranking, session totals and plan usage (0027 sections 7 to
 * 10). A fact that repeats a message id replaces the usage counted for it. Agent figures are a breakdown of
 * their session's figure: the session's buckets receive every request of the session, the agent's buckets only
 * its own.
 */
export class UsageEngine implements UsageAggregator {
  private readonly sessions = new Map<string, SessionState>();
  private readonly buffers = new Map<string, RateBuffer>();
  private readonly subjects = new Map<string, Extract<UsageSubject, { kind: 'session' | 'agent' }>>();
  private readonly agentTokens = new Map<string, TokenUsage>();
  private readonly sessionModels = new Map<string, string>();
  private readonly agentModels = new Map<string, string>();
  private readonly messages = new Map<string, Map<string, SeenMessage>>();
  private readonly planWindows = new Map<PlanWindow['window'], PlanWindow>();
  private readonly planSamples = new Map<PlanWindow['window'], PlanSample[]>();
  private readonly profile = new RateBuffer();

  constructor(
    private readonly options: UsageEngineOptions,
    private readonly planStorage?: PlanStorage,
  ) {}

  apply(fact: AgentFact): void {
    switch (fact.kind) {
      case 'usage':
        this.applyUsage(fact);
        return;
      case 'session-cost':
        this.applyCost(fact);
        return;
      case 'plan':
        this.applyPlan(fact);
        return;
      default:
    }
  }

  /** Puts a plan window back after a restart; no samples, so no forecast until new ones arrive. */
  restorePlan(window: PlanWindow): void {
    this.planWindows.set(window.window, window);
  }

  forgetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.buffers.delete(`session:${sessionId}`);
    this.subjects.delete(`session:${sessionId}`);
    for (const key of [...this.buffers.keys()]) if (key.startsWith(`agent:${sessionId}:`)) this.buffers.delete(key);
    for (const key of [...this.subjects.keys()]) if (key.startsWith(`agent:${sessionId}:`)) this.subjects.delete(key);
  }

  sessionTotals(sessionId: string): SessionTotals | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    return { tokens: state.tokens, ...(state.costUsd === undefined ? {} : { costUsd: state.costUsd }), ...(state.basis === undefined ? {} : { basis: state.basis }), final: state.final };
  }

  /**
   * The model a record last used. Only the session's own record falls back to the session model; a subagent whose
   * transcript has not named a model has none, so its cost is left out instead of priced with another model.
   */
  modelOf(ref: AgentRef): string | undefined {
    const own = this.agentModels.get(subjectKey({ kind: 'agent', ref }));
    if (own !== undefined || (ref.agentKey !== 'main' && ref.agentKey !== 'session')) return own;
    return this.sessionModels.get(ref.sessionId);
  }

  agentTokensOf(ref: AgentRef): TokenUsage | undefined {
    return this.agentTokens.get(subjectKey({ kind: 'agent', ref }));
  }

  rate(subject: UsageSubject): UsageRate | undefined {
    const now = this.options.now();
    const windowMinutes = this.options.windowMinutes();
    const key = subjectKey(subject);
    const buffer = subject.kind === 'profile' ? this.profile : this.buffers.get(key);
    if (!buffer) return undefined;
    const rate = buffer.rate(now, windowMinutes);
    const profile = this.profile.rate(now, windowMinutes);
    return { subject, ...(rate.costPerMinute === undefined ? {} : { costUsdPerMinute: rate.costPerMinute }), weightedTokensPerMinute: rate.tokensPerMinute, share: shareOf(rate, profile), windowMinutes };
  }

  ranking(limit: number): UsageRate[] {
    return this.rankedSubjects()
      .slice(0, limit)
      .map((entry) => ({ subject: entry.subject, ...(entry.costUsdPerMinute === undefined ? {} : { costUsdPerMinute: entry.costUsdPerMinute }), weightedTokensPerMinute: entry.weightedTokensPerMinute, share: entry.share, windowMinutes: this.options.windowMinutes() }));
  }

  /** Sessions and agents with a rate above zero, highest cost rate first; ties go to the most recent activity. */
  rankedSubjects(): RankedSubject[] {
    const now = this.options.now();
    const windowMinutes = this.options.windowMinutes();
    const profile = this.profile.rate(now, windowMinutes);
    const ranked: RankedSubject[] = [];
    for (const [key, subject] of this.subjects) {
      const buffer = this.buffers.get(key);
      if (!buffer) continue;
      const rate = buffer.rate(now, windowMinutes);
      if ((rate.costPerMinute ?? 0) <= 0 && rate.tokensPerMinute <= 0) continue;
      ranked.push({ subject, ...(rate.costPerMinute === undefined ? {} : { costUsdPerMinute: rate.costPerMinute }), weightedTokensPerMinute: rate.tokensPerMinute, share: shareOf(rate, profile), lastActivityAt: buffer.lastActivityAt });
    }
    return ranked.sort((a, b) => (b.costUsdPerMinute ?? 0) - (a.costUsdPerMinute ?? 0) || b.weightedTokensPerMinute - a.weightedTokensPerMinute || b.lastActivityAt - a.lastActivityAt);
  }

  profileRate(): { costUsdPerMinute?: number; weightedTokensPerMinute: number } {
    const rate = this.profile.rate(this.options.now(), this.options.windowMinutes());
    return { ...(rate.costPerMinute === undefined ? {} : { costUsdPerMinute: rate.costPerMinute }), weightedTokensPerMinute: rate.tokensPerMinute };
  }

  plan(): readonly PlanWindowView[] {
    const now = this.options.now();
    return [...this.planWindows.values()]
      .sort((a, b) => a.window.localeCompare(b.window))
      .map((window) => {
        const verdict = forecast(this.planSamples.get(window.window) ?? [], window.usedPercentage, now, Date.parse(window.resetsAt));
        return { ...window, ...(verdict === undefined ? {} : { runsOutInMinutes: verdict.minutesToFull, runsOutBeforeReset: verdict.beforeReset }) };
      });
  }

  private session(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = { tokens: ZERO, costUsd: undefined, basis: undefined, final: false, segmentBase: 0, lastStatusCost: 0, statusSeen: false, estimatedSinceStatus: 0 };
      this.sessions.set(sessionId, state);
      this.subjects.set(`session:${sessionId}`, { kind: 'session', sessionId });
    }
    return state;
  }

  private buffer(subject: Extract<UsageSubject, { kind: 'session' | 'agent' }>): RateBuffer {
    const key = subjectKey(subject);
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = new RateBuffer();
      this.buffers.set(key, buffer);
      this.subjects.set(key, subject);
    }
    return buffer;
  }

  private applyUsage(fact: Extract<AgentFact, { kind: 'usage' }>): void {
    const { sessionId, agentKey } = fact.ref;
    const seenKey = `${sessionId}:${agentKey}`;
    const seen = this.messages.get(seenKey) ?? new Map<string, SeenMessage>();
    this.messages.set(seenKey, seen);
    const previous = seen.get(fact.messageId);
    // A repeated line never lowers a class: the largest value seen for the message counts.
    const usage = previous === undefined ? fact.usage : maxOf(previous.usage, fact.usage);
    seen.set(fact.messageId, { usage, model: fact.model });
    if (fact.model !== undefined) {
      this.agentModels.set(subjectKey({ kind: 'agent', ref: fact.ref }), fact.model);
      if (!this.sessionModels.has(sessionId) || agentKey === 'main') this.sessionModels.set(sessionId, fact.model);
    }
    const delta = subtract(usage, previous?.usage ?? ZERO);
    if (isZero(delta)) return;
    const now = this.options.now();
    const state = this.session(sessionId);
    state.tokens = add(state.tokens, delta);
    const cost = costOf(fact.model, delta);
    const amount = { ...(cost === undefined ? {} : { cost }), tokens: weightedTokens(fact.model, delta) };
    this.buffer({ kind: 'session', sessionId }).add(now, amount);
    this.profile.add(now, amount);
    state.estimatedSinceStatus += cost ?? 0;
    if (agentKey !== 'main' && agentKey !== 'session') {
      const subject = { kind: 'agent', ref: fact.ref } as const;
      this.buffer(subject).add(now, amount);
      const key = subjectKey(subject);
      this.agentTokens.set(key, add(this.agentTokens.get(key) ?? ZERO, delta));
    }
  }

  private applyCost(fact: Extract<AgentFact, { kind: 'session-cost' }>): void {
    const state = this.session(fact.sessionId);
    const now = this.options.now();
    if (fact.basis === 'status-line') {
      const dropped = state.statusSeen && fact.costUsd < state.lastStatusCost;
      if (dropped) state.segmentBase += state.lastStatusCost;
      const delta = !state.statusSeen ? 0 : dropped ? fact.costUsd : fact.costUsd - state.lastStatusCost;
      state.statusSeen = true;
      state.lastStatusCost = fact.costUsd;
      state.costUsd = state.segmentBase + fact.costUsd;
      // The status line covers main and subagent requests; the transcript estimates already counted part of it.
      const excess = Math.max(0, delta - state.estimatedSinceStatus);
      state.estimatedSinceStatus = 0;
      if (excess > 0) {
        this.buffer({ kind: 'session', sessionId: fact.sessionId }).add(now, { cost: excess, tokens: 0 });
        this.profile.add(now, { cost: excess, tokens: 0 });
      }
    } else {
      state.costUsd = fact.costUsd;
      state.final = fact.basis === 'cost-state';
    }
    state.basis = fact.basis;
  }

  private applyPlan(fact: Extract<AgentFact, { kind: 'plan' }>): void {
    const observedAt = fact.at;
    const current = this.planWindows.get(fact.window);
    if (current && current.observedAt > observedAt) return;
    const window: PlanWindow = { window: fact.window, usedPercentage: fact.usedPercentage, resetsAt: fact.resetsAt, observedAt, source: fact.source };
    this.planWindows.set(fact.window, window);
    const now = this.options.now();
    // A new window (another reset time) starts a new series.
    const samples = (current && current.resetsAt === fact.resetsAt ? (this.planSamples.get(fact.window) ?? []) : []).filter((sample) => now - sample.at <= FORECAST_SPAN_MS);
    samples.push({ at: now, percent: fact.usedPercentage });
    this.planSamples.set(fact.window, samples);
    this.planStorage?.save(window);
  }
}

function shareOf(rate: { costPerMinute?: number; tokensPerMinute: number }, profile: { costPerMinute?: number; tokensPerMinute: number }): number {
  if (rate.costPerMinute !== undefined && (profile.costPerMinute ?? 0) > 0) return Math.min(1, rate.costPerMinute / (profile.costPerMinute as number));
  return profile.tokensPerMinute > 0 ? Math.min(1, rate.tokensPerMinute / profile.tokensPerMinute) : 0;
}

const subtract = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input: a.input - b.input, output: a.output - b.output, cacheWrite5m: a.cacheWrite5m - b.cacheWrite5m, cacheWrite1h: a.cacheWrite1h - b.cacheWrite1h, cacheRead: a.cacheRead - b.cacheRead });
const maxOf = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input: Math.max(a.input, b.input), output: Math.max(a.output, b.output), cacheWrite5m: Math.max(a.cacheWrite5m, b.cacheWrite5m), cacheWrite1h: Math.max(a.cacheWrite1h, b.cacheWrite1h), cacheRead: Math.max(a.cacheRead, b.cacheRead) });
const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input: a.input + b.input, output: a.output + b.output, cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m, cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h, cacheRead: a.cacheRead + b.cacheRead });
const isZero = (u: TokenUsage): boolean => u.input === 0 && u.output === 0 && u.cacheWrite5m === 0 && u.cacheWrite1h === 0 && u.cacheRead === 0;
