import { z } from 'zod';
import { shellQuote } from '../session/hooks';
import type { AgentFact } from '../agents/types';

export const STATUS_SNAPSHOT_FILE = 'status.snapshot';

/**
 * The status line command of the launch settings (0027 section 6). It copies the JSON on stdin into the
 * session's events directory as `status.snapshot` through a temporary name and a rename, and prints nothing, so
 * the TUI status area stays empty. The file name has no `.json` suffix, so the hook inbox never takes it.
 */
export function statusLineCommand(dir: string): string {
  const script = `f=$(mktemp "$1/tmp-XXXXXX") && cat > "$f" && mv "$f" "$1/${STATUS_SNAPSHOT_FILE}"`;
  return `/bin/sh -c ${shellQuote(script)} sh ${shellQuote(dir)}`;
}

const windowSchema = z.object({ used_percentage: z.number().min(0), resets_at: z.number() });

/** Only the fields the collector keeps: the payload also holds absolute paths of the user's directories. */
const snapshotSchema = z.object({
  session_id: z.string().optional(),
  model: z.object({ id: z.string().optional() }).optional(),
  cost: z.object({ total_cost_usd: z.number().min(0).optional(), total_duration_ms: z.number().optional() }).optional(),
  context_window: z.object({ used_percentage: z.number().nullable().optional(), context_window_size: z.number().nullable().optional() }).optional(),
  rate_limits: z.object({ five_hour: windowSchema.optional(), seven_day: windowSchema.optional() }).optional(),
});

export interface StatusSnapshot {
  readonly model?: string;
  readonly costUsd?: number;
  readonly contextUsedPercentage?: number;
  readonly plan: readonly { readonly window: 'five_hour' | 'seven_day'; readonly usedPercentage: number; readonly resetsAt: string }[];
}

export function parseStatusSnapshot(text: string): StatusSnapshot | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = snapshotSchema.safeParse(json);
  if (!parsed.success) return undefined;
  const data = parsed.data;
  const plan = (['five_hour', 'seven_day'] as const).flatMap((window) => {
    const entry = data.rate_limits?.[window];
    return entry ? [{ window, usedPercentage: entry.used_percentage, resetsAt: new Date(entry.resets_at * 1000).toISOString() }] : [];
  });
  const used = data.context_window?.used_percentage;
  return {
    ...(data.model?.id === undefined ? {} : { model: data.model.id }),
    ...(data.cost?.total_cost_usd === undefined ? {} : { costUsd: data.cost.total_cost_usd }),
    ...(used === null || used === undefined ? {} : { contextUsedPercentage: used }),
    plan,
  };
}

export function snapshotFacts(sessionId: string, snapshot: StatusSnapshot, at: string): AgentFact[] {
  const facts: AgentFact[] = [];
  if (snapshot.costUsd !== undefined) facts.push({ kind: 'session-cost', sessionId, at, costUsd: snapshot.costUsd, basis: 'status-line' });
  for (const entry of snapshot.plan) facts.push({ kind: 'plan', at, window: entry.window, usedPercentage: entry.usedPercentage, resetsAt: entry.resetsAt, source: 'status-line' });
  return facts;
}
