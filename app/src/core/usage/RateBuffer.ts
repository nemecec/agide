export const BUCKET_MS = 10_000;
const KEEP_MS = 30 * 60_000;

interface Bucket {
  cost: number;
  tokens: number;
  priced: boolean;
}

/**
 * Ring of 10-second buckets kept for 30 minutes (0027 section 8). Nothing is persisted. A bucket holds the
 * estimated cost and the weighted tokens that arrived in it.
 */
export class RateBuffer {
  private readonly buckets = new Map<number, Bucket>();
  private firstAt: number | undefined;
  private lastAt = 0;

  add(at: number, amount: { cost?: number; tokens: number }): void {
    const index = Math.floor(at / BUCKET_MS);
    const bucket = this.buckets.get(index) ?? { cost: 0, tokens: 0, priced: false };
    if (amount.cost !== undefined) {
      bucket.cost += amount.cost;
      bucket.priced = true;
    }
    bucket.tokens += amount.tokens;
    this.buckets.set(index, bucket);
    this.firstAt ??= at;
    this.lastAt = Math.max(this.lastAt, at);
    this.prune(at);
  }

  /** Cost and tokens per minute over the window ending at `now`, or over the time since the first sample when shorter. */
  rate(now: number, windowMinutes: number): { costPerMinute?: number; tokensPerMinute: number } {
    this.prune(now);
    const windowMs = windowMinutes * 60_000;
    const from = now - windowMs;
    let cost = 0;
    let tokens = 0;
    let priced = false;
    for (const [index, bucket] of this.buckets) {
      if (index * BUCKET_MS + BUCKET_MS <= from) continue;
      cost += bucket.cost;
      tokens += bucket.tokens;
      priced ||= bucket.priced;
    }
    const elapsed = Math.max(BUCKET_MS, Math.min(windowMs, now - (this.firstAt ?? now)));
    const minutes = elapsed / 60_000;
    return { ...(priced ? { costPerMinute: cost / minutes } : {}), tokensPerMinute: tokens / minutes };
  }

  get lastActivityAt(): number {
    return this.lastAt;
  }

  private prune(now: number): void {
    const oldest = Math.floor((now - KEEP_MS) / BUCKET_MS);
    for (const index of this.buckets.keys()) if (index < oldest) this.buckets.delete(index);
  }
}
