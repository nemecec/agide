/** Narrowing helpers for hook payloads and stream-json messages, which the CLI does not type for us. */

export type Json = Record<string, unknown>;

export const asRecord = (value: unknown): Json | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;

export const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

export const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Keeps only the keys whose value is defined, so optional fact fields stay absent instead of `undefined`. */
export function defined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
