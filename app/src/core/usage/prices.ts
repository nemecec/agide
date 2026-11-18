import type { TokenUsage } from '../agents/types';
import table from './prices.json';

export interface ModelPrice {
  readonly family: string;
  readonly input: number;
  readonly output: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly cacheRead: number;
}

export const PRICE_TABLE_DATE: string = table.date;

/** The price entry whose pattern the model id contains; undefined for an unknown model. */
export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (model === undefined) return undefined;
  const lower = model.toLowerCase();
  return table.models.find((entry) => lower.includes(entry.pattern));
}

/** Estimated cost at list price; undefined when the model has no price. */
export function costOf(model: string | undefined, usage: TokenUsage): number | undefined {
  const price = priceFor(model);
  if (!price) return undefined;
  return (
    (usage.input * price.input + usage.output * price.output + usage.cacheWrite5m * price.cacheWrite5m + usage.cacheWrite1h * price.cacheWrite1h + usage.cacheRead * price.cacheRead) /
    1_000_000
  );
}

/** Weights per token class: the model's list prices relative to its input price, or fixed ratios without a price. */
export function weightedTokens(model: string | undefined, usage: TokenUsage): number {
  const price = priceFor(model);
  const base = price?.input ?? 1;
  const ratio = (value: number | undefined, fallback: number): number => (price ? (value ?? fallback) / base : fallback);
  return (
    usage.input * ratio(price?.input, 1) +
    usage.output * ratio(price?.output, 5) +
    usage.cacheWrite5m * ratio(price?.cacheWrite5m, 1.25) +
    usage.cacheWrite1h * ratio(price?.cacheWrite1h, 2) +
    usage.cacheRead * ratio(price?.cacheRead, 0.1)
  );
}
