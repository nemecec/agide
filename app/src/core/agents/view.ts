import type { AgentOutcome, AgentRecord, OutcomeBasis, TokenUsage } from './types';
import type { AgentState } from './types';

/** One agent as the renderer sees it: the record, whether the tree has removed its node, and its estimated cost. */
export interface AgentNodeView {
  readonly sessionId: string;
  readonly agentKey: string;
  readonly origin: 'session-started' | 'app-started';
  readonly state: AgentState;
  readonly label: string;
  readonly agentType?: string;
  readonly description?: string;
  readonly lastTool?: string;
  readonly queued?: boolean;
  readonly outcome?: AgentOutcome;
  readonly outcomeBasis?: OutcomeBasis;
  readonly summary?: string;
  readonly hasTranscript: boolean;
  readonly tokens: TokenUsage;
  readonly startedAt: string;
  readonly endedAt?: string;
  /** The tree removed the node; "Show finished agents" and the history view still list it. */
  readonly hidden: boolean;
  readonly folderId?: string;
  /** Estimated from tokens at list price; absent when the model has no price. */
  readonly costUsd?: number;
}

/** The label of a node: its description, else its type, else the agent key. */
export function labelOf(record: Pick<AgentRecord, 'description' | 'agentType' | 'workflow' | 'ref'>): string {
  return record.description || record.workflow?.label || record.agentType || record.ref.agentKey;
}

export function toView(record: AgentRecord, extra: { hidden: boolean; folderId?: string | undefined; costUsd?: number | undefined }): AgentNodeView {
  return {
    sessionId: record.ref.sessionId,
    agentKey: record.ref.agentKey,
    origin: record.origin,
    state: record.state,
    label: labelOf(record),
    ...(record.agentType === undefined ? {} : { agentType: record.agentType }),
    ...(record.description === undefined ? {} : { description: record.description }),
    ...(record.lastTool === undefined ? {} : { lastTool: record.lastTool }),
    ...(record.queued === undefined ? {} : { queued: record.queued }),
    ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
    ...(record.outcomeBasis === undefined ? {} : { outcomeBasis: record.outcomeBasis }),
    ...(record.summary === undefined ? {} : { summary: record.summary }),
    hasTranscript: record.transcriptPath !== undefined,
    tokens: record.tokens,
    startedAt: record.startedAt,
    ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
    hidden: extra.hidden,
    ...(extra.folderId === undefined ? {} : { folderId: extra.folderId }),
    ...(extra.costUsd === undefined ? {} : { costUsd: extra.costUsd }),
  };
}

export interface SessionAgentSummary {
  /** Agents in `running` or `waiting`. */
  readonly running: number;
  readonly waiting: number;
  /** Agents that ended in the last minute, so agents that start and end inside the removal delay leave a trace. */
  readonly finishedRecently: number;
}

export const FINISHED_TALLY_MS = 60_000;

/** The running count, waiting marker and finished tally a session leaf shows (0027 section 3). */
export function summarise(views: readonly Pick<AgentNodeView, 'state' | 'endedAt'>[], now: number): SessionAgentSummary {
  let running = 0;
  let waiting = 0;
  let finishedRecently = 0;
  for (const view of views) {
    if (view.state === 'running' || view.state === 'waiting') {
      running += 1;
      if (view.state === 'waiting') waiting += 1;
    } else if (view.endedAt !== undefined && now - Date.parse(view.endedAt) <= FINISHED_TALLY_MS) finishedRecently += 1;
  }
  return { running, waiting, finishedRecently };
}

export interface HistoryFilter {
  readonly states?: readonly AgentState[];
  readonly origin?: 'session-started' | 'app-started';
  readonly folderIds?: readonly string[];
  /** Only agents that ended at or after this time. */
  readonly endedSince?: string;
  readonly text?: string;
}

/** Finished agents (done or failed) that match the filter, newest end first. */
export function historyOf(views: readonly AgentNodeView[], filter: HistoryFilter = {}): AgentNodeView[] {
  const text = filter.text?.trim().toLowerCase();
  return views
    .filter((view) => view.state === 'done' || view.state === 'failed')
    .filter((view) => filter.states === undefined || filter.states.includes(view.state))
    .filter((view) => filter.origin === undefined || view.origin === filter.origin)
    .filter((view) => filter.folderIds === undefined || (view.folderId !== undefined && filter.folderIds.includes(view.folderId)))
    .filter((view) => filter.endedSince === undefined || (view.endedAt !== undefined && view.endedAt >= filter.endedSince))
    .filter((view) => !text || `${view.label} ${view.agentType ?? ''} ${view.summary ?? ''}`.toLowerCase().includes(text))
    .sort((a, b) => (b.endedAt ?? '').localeCompare(a.endedAt ?? ''));
}

export type TranscriptRole = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'raw';

export interface TranscriptEntry {
  readonly role: TranscriptRole;
  /** Plain text. Never HTML: agent text is untrusted (0021 section 9). */
  readonly text: string;
}

/** A record as it leaves the main process: without the transcript path, which names the user's directories. */
export function withoutPaths<T extends { readonly transcriptPath?: string | undefined }>(record: T): Omit<T, 'transcriptPath'> {
  const { transcriptPath: _path, ...rest } = record;
  return rest;
}
