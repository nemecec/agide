import { createHash } from 'node:crypto';
import { cleanLine, cleanText } from './text';
import { DETAILS_MAX, MESSAGE_MAX } from './types';

/** Cuts a cleaned single line to the message limit, with an ellipsis when it was longer. */
export function messageFrom(text: string, limit = MESSAGE_MAX): string {
  const line = cleanLine(text);
  return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`;
}

/** Cleaned long text cut to the details limit. */
export function detailsFrom(text: string): string {
  const clean = cleanText(text).trim();
  return clean.length <= DETAILS_MAX ? clean : `${clean.slice(0, DETAILS_MAX - 1)}…`;
}

/** The first sentence of a text, or its first line when it has no sentence end. */
export function firstSentence(text: string): string {
  const line = cleanText(text).trim().split('\n')[0] ?? '';
  const end = /[.!?](\s|$)/.exec(line);
  return end ? line.slice(0, end.index + 1) : line;
}

/** JSON with sorted keys, so equal values give equal text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${stableJson(inner)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function requestHash(toolName: string, toolInput: unknown): string {
  return createHash('sha256').update(`${toolName}\n${stableJson(toolInput ?? null)}`).digest('hex').slice(0, 16);
}

/** The first line of a tool input that a person recognizes: the command, the file path, or the JSON. */
export function inputHeadline(toolInput: unknown): string {
  if (toolInput !== null && typeof toolInput === 'object') {
    const record = toolInput as Record<string, unknown>;
    for (const key of ['command', 'file_path', 'path', 'url', 'pattern']) {
      if (typeof record[key] === 'string') return (record[key] as string).split('\n')[0] ?? '';
    }
  }
  return typeof toolInput === 'string' ? (toolInput.split('\n')[0] ?? '') : stableJson(toolInput ?? '');
}
