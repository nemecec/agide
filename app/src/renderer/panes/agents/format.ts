import type { AgentNodeView } from '../../../core/agents/view';
import type { TokenUsage } from '../../../core/agents/types';
import type { PlanWindowView } from '../../../core/usage/types';

export const totalTokens = (tokens: TokenUsage): number => tokens.input + tokens.output + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead;

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${Math.round(seconds % 60)}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const elapsedSeconds = (view: Pick<AgentNodeView, 'startedAt' | 'endedAt'>, now: number): number =>
  Math.max(0, ((view.endedAt === undefined ? now : Date.parse(view.endedAt)) - Date.parse(view.startedAt)) / 1000);

/** Dollar figures are always estimates at list price (0027 section 12). */
export const formatCost = (usd: number | undefined): string => {
  if (usd === undefined) return 'no price';
  if (usd > 0 && usd < 0.0001) return '<$0.0001';
  return `~$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
};

/** A count with thousands separators, for token rates. */
export const formatCount = (value: number): string => Math.round(value).toLocaleString('en-US');

export function outcomeText(view: Pick<AgentNodeView, 'state' | 'outcome' | 'outcomeBasis'>): string {
  if (view.outcome === undefined) return view.state;
  return `${view.outcome}${view.outcomeBasis === 'derived' ? ' (outcome derived by Agide)' : ' (reported)'}`;
}

const STATE_OUTCOME: Partial<Record<AgentNodeView['state'], AgentNodeView['outcome']>> = { done: 'completed', failed: 'failed' };

/** The secondary text of a tree row: the queue or tool while the agent works, and an outcome only when the status chip does not already say it. */
export function rowDetail(view: Pick<AgentNodeView, 'state' | 'queued' | 'lastTool' | 'outcome'>): string {
  if (view.state === 'done' || view.state === 'failed') return view.outcome === undefined || view.outcome === STATE_OUTCOME[view.state] ? '' : view.outcome;
  return view.queued === true ? 'queued' : (view.lastTool ?? '');
}

export function windowName(window: PlanWindowView['window']): string {
  return window === 'five_hour' ? '5 h' : '7 d';
}

export function planLine(window: PlanWindowView, now: number): string {
  if (Date.parse(window.resetsAt) <= now) return `${windowName(window.window)}: reset, no data since`;
  const base = `${windowName(window.window)}: ${Math.round(window.usedPercentage)}%`;
  if (window.runsOutInMinutes === undefined) return base;
  if (window.runsOutBeforeReset === true) {
    const at = new Date(now + window.runsOutInMinutes * 60_000);
    return `${base}, may run out around ${at.toTimeString().slice(0, 5)}`;
  }
  return `${base}, resets before it runs out at this rate`;
}
