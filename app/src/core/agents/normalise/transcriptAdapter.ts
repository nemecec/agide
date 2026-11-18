import type { SessionId } from '../../session/types';
import type { AgentFact, TokenUsage } from '../types';
import { asRecord, num, str, type Json } from './payload';

/** An assistant line's usage with its message id; one API message can span several lines (P13). */
export interface TranscriptUsage {
  readonly messageId: string;
  readonly model?: string;
  readonly usage: TokenUsage;
  readonly at?: string;
}

export function tokenUsageFrom(raw: unknown): TokenUsage | undefined {
  const usage = asRecord(raw);
  if (!usage) return undefined;
  const creation = asRecord(usage['cache_creation']);
  const write5m = num(creation?.['ephemeral_5m_input_tokens']);
  const write1h = num(creation?.['ephemeral_1h_input_tokens']);
  const writeTotal = num(usage['cache_creation_input_tokens']) ?? 0;
  const split = write5m !== undefined || write1h !== undefined;
  return {
    input: num(usage['input_tokens']) ?? 0,
    output: num(usage['output_tokens']) ?? 0,
    // Without the split, the whole cache write counts as the cheaper 5-minute class.
    cacheWrite5m: split ? (write5m ?? 0) : writeTotal,
    cacheWrite1h: split ? (write1h ?? 0) : 0,
    cacheRead: num(usage['cache_read_input_tokens']) ?? 0,
  };
}

/** The usage of one transcript line, or undefined for lines without a message id and usage. */
export function parseUsageLine(line: string): TranscriptUsage | undefined {
  const entry = parseJson(line);
  if (!entry || entry['type'] !== 'assistant') return undefined;
  const message = asRecord(entry['message']);
  const messageId = str(message?.['id']);
  const usage = tokenUsageFrom(message?.['usage']);
  if (messageId === undefined || usage === undefined) return undefined;
  const model = str(message?.['model']);
  const at = str(entry['timestamp']);
  return { messageId, usage, ...(model === undefined ? {} : { model }), ...(at === undefined ? {} : { at }) };
}

/** Facts for the transcript lines of one agent (or `main`), each message id once with its last usage. */
export function usageFact(sessionId: SessionId, agentKey: string, usage: TranscriptUsage, fallbackAt: string): AgentFact {
  return { kind: 'usage', ref: { sessionId, agentKey }, at: usage.at ?? fallbackAt, messageId: usage.messageId, usage: usage.usage, ...(usage.model === undefined ? {} : { model: usage.model }) };
}

/** The cost recorded at process exit: a `cost-state` line with `totalCostUSD`, searched a few levels deep. */
export function parseCostState(line: string): number | undefined {
  if (!line.includes('totalCostUSD')) return undefined;
  const entry = parseJson(line);
  return entry ? findNumber(entry, 'totalCostUSD', 3) : undefined;
}

/** A user line the CLI writes after an interrupt (P10, P1). */
export function isInterruptLine(line: string): boolean {
  if (!line.includes('Request interrupted by user')) return false;
  const entry = parseJson(line);
  return entry !== undefined && entry['type'] === 'user';
}

/** The last assistant line is an API error marker (not probed beyond the `isApiErrorMessage` field name; U2). */
export function isApiErrorLine(line: string): boolean {
  const entry = parseJson(line);
  return entry !== undefined && entry['type'] === 'assistant' && entry['isApiErrorMessage'] === true;
}

export interface AgentMeta {
  readonly agentType?: string;
  readonly description?: string;
  readonly toolUseId?: string;
  readonly finished?: boolean;
}

export function parseMeta(text: string): AgentMeta | undefined {
  const meta = parseJson(text);
  if (!meta) return undefined;
  const agentType = str(meta['agentType']);
  const description = str(meta['description']);
  const toolUseId = str(meta['toolUseId']);
  return { ...(agentType === undefined ? {} : { agentType }), ...(description === undefined ? {} : { description }), ...(toolUseId === undefined ? {} : { toolUseId }), ...(typeof meta['finished'] === 'boolean' ? { finished: meta['finished'] } : {}) };
}

function parseJson(text: string): Json | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function findNumber(value: Json, key: string, depth: number): number | undefined {
  const direct = num(value[key]);
  if (direct !== undefined || depth === 0) return direct;
  for (const child of Object.values(value)) {
    const record = asRecord(child);
    const found = record ? findNumber(record, key, depth - 1) : undefined;
    if (found !== undefined) return found;
  }
  return undefined;
}
