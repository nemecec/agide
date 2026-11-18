import type { SessionId } from '../session/types';
import type { PlanWindow, TokenUsage, UsageSubject } from '../agents/types';

/** A plan window with the forecast verdict the rail shows (0027 section 10). */
export interface PlanWindowView extends PlanWindow {
  /** True when the time to 100 percent falls before `resetsAt`. Absent without a forecast. */
  readonly runsOutBeforeReset?: boolean;
}

export interface SessionTotals {
  readonly tokens: TokenUsage;
  readonly costUsd?: number;
  readonly basis?: string;
  readonly final: boolean;
}

/** What the ranking pane and the heat markers read: one subject's rate with its labels. */
export interface RankedSubject {
  readonly subject: Extract<UsageSubject, { kind: 'session' | 'agent' }>;
  readonly costUsdPerMinute?: number;
  readonly weightedTokensPerMinute: number;
  readonly share: number;
  readonly lastActivityAt: number;
}

/** Everything the renderer needs in one answer (`usage_state`). */
export interface UsageState {
  readonly windowMinutes: number;
  readonly profileCostUsdPerMinute?: number;
  readonly profileWeightedTokensPerMinute: number;
  readonly ranking: readonly (RankedSubject & { readonly label?: string; readonly folderId?: string; readonly elapsedSeconds: number })[];
  /** Heat input per session and agent, keyed `session:<id>` or `agent:<session>:<key>`. */
  readonly heat: Readonly<Record<string, { readonly share: number; readonly costUsdPerMinute?: number; readonly level: 0 | 1 | 2 | 3 }>>;
  /** Folder id to its summed rate and the number of sessions active in the window. */
  readonly folders: Readonly<Record<string, { readonly costUsdPerMinute?: number; readonly weightedTokensPerMinute: number; readonly sessions: number; readonly level: 0 | 1 | 2 | 3 }>>;
  readonly plan: readonly PlanWindowView[];
  readonly appStarted: { readonly running: number; readonly cap: number };
  readonly now: string;
}

export const subjectKey = (subject: UsageSubject): string => {
  switch (subject.kind) {
    case 'session':
      return `session:${subject.sessionId}`;
    case 'agent':
      return `agent:${subject.ref.sessionId}:${subject.ref.agentKey}`;
    case 'folder':
      return `folder:${subject.folderId}`;
    case 'profile':
      return 'profile';
  }
};

export type { SessionId };
