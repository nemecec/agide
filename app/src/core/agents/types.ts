import type { Unsubscribe } from '../events/EventBus';
import type { SessionId } from '../session/types';
import type { NodeId } from '../tree/types';

/**
 * Agent nodes and usage (R16, R24, design 0027). Adapters turn hook payloads, stream-json messages, the status
 * line snapshot and transcripts into `AgentFact` values; the store applies them in order.
 */

/**
 * `agentKey` is the CLI agent id, `wf:<workflow task id>` for a workflow group, `wf:<workflow task id>:<index>`
 * for a workflow agent, `session` for the row of an app-started session, or `main` for the session's own
 * conversation (facts on `main` mark the session, never an agent record).
 */
export interface AgentRef {
  readonly sessionId: SessionId;
  readonly agentKey: string;
}

export const MAIN_AGENT_KEY = 'main';
export const APP_STARTED_AGENT_KEY = 'session';

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
}

export type AgentOutcome = 'completed' | 'stopped' | 'failed' | 'denied' | 'lost';

/** Whether the CLI reported an outcome or the app worked it out (0027 section 2). */
export type OutcomeBasis = 'reported' | 'derived';

export type AgentFact =
  | {
      readonly kind: 'started';
      readonly ref: AgentRef;
      readonly at: string;
      readonly agentId?: string;
      readonly agentType?: string;
      readonly description?: string;
      readonly toolUseId?: string;
      readonly parentAgentId?: string;
      readonly backgrounded?: boolean;
      readonly queued?: boolean;
      readonly workflow?: { readonly taskId: string; readonly index: number; readonly label?: string; readonly phase?: string };
      readonly transcriptPath?: string;
    }
  | { readonly kind: 'linked'; readonly ref: AgentRef; readonly agentId?: string; readonly toolUseId?: string; readonly description?: string; readonly transcriptPath?: string }
  | { readonly kind: 'progress'; readonly ref: AgentRef; readonly at: string; readonly lastTool?: string; readonly text?: string }
  | { readonly kind: 'waiting'; readonly ref: AgentRef; readonly at: string; readonly requestKey: string; readonly toolName?: string; readonly attribution: 'exact' | 'session' }
  | { readonly kind: 'answered'; readonly ref: AgentRef; readonly at: string; readonly requestKey?: string }
  | {
      readonly kind: 'ended';
      readonly ref: AgentRef;
      readonly at: string;
      readonly outcome: AgentOutcome;
      readonly basis: OutcomeBasis;
      readonly summary?: string;
      readonly transcriptPath?: string;
      readonly totalTokens?: number;
    }
  | { readonly kind: 'usage'; readonly ref: AgentRef; readonly at: string; readonly messageId: string; readonly model?: string; readonly usage: TokenUsage }
  | { readonly kind: 'session-cost'; readonly sessionId: SessionId; readonly at: string; readonly costUsd: number; readonly basis: 'status-line' | 'result' | 'cost-state' }
  | {
      readonly kind: 'plan';
      readonly at: string;
      readonly window: 'five_hour' | 'seven_day';
      readonly usedPercentage: number;
      readonly resetsAt: string;
      readonly source: 'status-line' | 'rate-limit-event';
    };

/** `running` covers queued workflow agents (`queued` mark); `waiting` overrides `running` until answered. */
export type AgentState = 'running' | 'waiting' | 'failed' | 'done';

/** One agent row (the `agents` table of 0027 section 4, without the path columns the store keeps internally). */
export interface AgentRecord {
  readonly ref: AgentRef;
  readonly origin: 'session-started' | 'app-started';
  readonly state: AgentState;
  readonly agentId?: string;
  readonly agentType?: string;
  readonly description?: string;
  readonly parentAgentId?: string;
  readonly toolUseId?: string;
  readonly queued?: boolean;
  readonly workflow?: { readonly taskId: string; readonly index: number; readonly label?: string; readonly phase?: string };
  readonly lastTool?: string;
  readonly outcome?: AgentOutcome;
  readonly outcomeBasis?: OutcomeBasis;
  readonly summary?: string;
  readonly transcriptPath?: string;
  /** Open approval requests attributed to the agent. */
  readonly openRequests: readonly string[];
  readonly tokens: TokenUsage;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly updatedAt: string;
}

/**
 * Applies facts in order and keeps the open requests per session. `usage`, `session-cost` and `plan` facts
 * that do not name an agent record go to the `UsageAggregator`; the store ignores `session-cost` and `plan`.
 */
export interface AgentStore {
  apply(fact: AgentFact): void;
  get(ref: AgentRef): AgentRecord | undefined;
  /** Records by start time; filtered by session and state. */
  list(filter?: { readonly sessionId?: SessionId; readonly states?: readonly AgentState[] }): AgentRecord[];
  /** Sessions with an open request attributed to `main` (the session leaf's waiting marker). */
  waitingSessions(): SessionId[];
  /** Removes a record, for the removal timers and history pruning. */
  remove(ref: AgentRef): void;
  /** Called with the records that changed by one `apply` or `remove`. */
  subscribe(listener: (changed: readonly AgentRecord[]) => void): Unsubscribe;
}

/** A subject usage is counted for (0027 section 8). */
export type UsageSubject =
  | { readonly kind: 'session'; readonly sessionId: SessionId }
  | { readonly kind: 'agent'; readonly ref: AgentRef }
  | { readonly kind: 'folder'; readonly folderId: NodeId }
  | { readonly kind: 'profile' };

export interface UsageRate {
  readonly subject: UsageSubject;
  /** Estimated cost per minute over the window; undefined when the model has no price. */
  readonly costUsdPerMinute?: number;
  readonly weightedTokensPerMinute: number;
  /** Share of the profile's rate, 0 to 1. */
  readonly share: number;
  readonly windowMinutes: number;
}

export interface PlanWindow {
  readonly window: 'five_hour' | 'seven_day';
  readonly usedPercentage: number;
  readonly resetsAt: string;
  readonly observedAt: string;
  readonly source: 'status-line' | 'rate-limit-event';
  /** Minutes from now until 100 percent at the current slope, when the forecast has enough samples. */
  readonly runsOutInMinutes?: number;
}

/** Counts usage from facts and answers the ranking, the heat markers and the plan view (0027 sections 7 to 10). */
export interface UsageAggregator {
  apply(fact: AgentFact): void;
  /** Highest cost rate first, at most `limit` subjects, sessions and agents only. */
  ranking(limit: number): UsageRate[];
  rate(subject: UsageSubject): UsageRate | undefined;
  plan(): readonly PlanWindow[];
  /** Session totals: tokens so far and the latest cost with its basis. */
  sessionTotals(sessionId: SessionId): { readonly tokens: TokenUsage; readonly costUsd?: number; readonly basis?: string; readonly final: boolean } | undefined;
}

export type AgentsEvent =
  /** Coalesced, at most one event per 250 ms (0027 section 2). */
  | { readonly type: 'agents.changed'; readonly records: readonly AgentRecord[] }
  | { readonly type: 'usage.changed'; readonly plan: readonly PlanWindow[] };

/** What the agents module gives the other modules. */
export interface AgentsService {
  readonly store: AgentStore;
  readonly usage: UsageAggregator | undefined;
}
