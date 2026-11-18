import type { PlanWindowView, RankedSubject } from './types';
import { subjectKey } from './types';

export type AlertAction = 'open' | 'pause' | 'stop' | 'open-ranking' | 'pause-top' | 'pause-all-app-started';

export interface AlertSpec {
  readonly dedupeKey: string;
  readonly urgency: 'normal' | 'high';
  readonly message: string;
  readonly details: string;
  readonly actions: readonly AlertAction[];
  /** The session or agent the alert is about, when it names one. */
  readonly subject?: RankedSubject['subject'];
}

export interface AlertThresholds {
  readonly alertUsdPerMinute: number;
  readonly planThresholds: readonly number[];
  readonly windowMinutes: number;
}

export interface AlertInput {
  readonly now: number;
  readonly ranked: readonly RankedSubject[];
  readonly plan: readonly PlanWindowView[];
}

export interface AlertResult {
  readonly raise: readonly AlertSpec[];
  /** Dedupe keys whose condition has been false for a whole window. */
  readonly clear: readonly string[];
}

const FORECAST_ALERT_MINUTES = 30;

const windowLabel = (window: string): string => (window === 'five_hour' ? 'five-hour' : 'seven-day');

/**
 * Decides which usage alerts to raise (0027 section 11). It keeps when each rate condition started, so a
 * subject has to stay above the threshold for a whole window before it raises, and has to stay below for a whole
 * window before its alert clears. Plan and forecast alerts depend on the current values and the dedupe keys
 * stop repeats.
 */
export class AlertEvaluator {
  private readonly aboveSince = new Map<string, number>();
  private readonly belowSince = new Map<string, number>();
  private readonly raised = new Map<string, string>();

  constructor(private readonly thresholds: () => AlertThresholds) {}

  evaluate(input: AlertInput): AlertResult {
    const raise: AlertSpec[] = [];
    const clear: string[] = [];
    this.rateAlerts(input, raise, clear);
    this.planAlerts(input, raise);
    return { raise, clear };
  }

  private rateAlerts(input: AlertInput, raise: AlertSpec[], clear: string[]): void {
    const { alertUsdPerMinute, windowMinutes } = this.thresholds();
    const windowMs = windowMinutes * 60_000;
    const over = new Set<string>();
    for (const entry of input.ranked) {
      const key = subjectKey(entry.subject);
      if ((entry.costUsdPerMinute ?? 0) <= alertUsdPerMinute) continue;
      over.add(key);
      this.belowSince.delete(key);
      const since = this.aboveSince.get(key) ?? input.now;
      this.aboveSince.set(key, since);
      const dedupeKey = `usage:rate:${key}:${new Date(since).toISOString()}`;
      if (input.now - since < windowMs || this.raised.has(key)) continue;
      this.raised.set(key, dedupeKey);
      raise.push({
        dedupeKey,
        urgency: 'normal',
        message: `${entry.subject.kind === 'session' ? 'A session' : 'An agent'} uses about ${(entry.costUsdPerMinute ?? 0).toFixed(2)} USD per minute`,
        details: `Estimated at list price over the last ${windowMinutes} minutes; above the alert threshold of ${alertUsdPerMinute.toFixed(2)} USD per minute for a whole window.`,
        actions: ['open', 'pause', 'stop'],
        subject: entry.subject,
      });
    }
    for (const key of [...this.aboveSince.keys()]) {
      if (over.has(key)) continue;
      this.aboveSince.delete(key);
      if (!this.raised.has(key)) continue;
      const since = this.belowSince.get(key) ?? input.now;
      this.belowSince.set(key, since);
    }
    for (const [key, since] of this.belowSince) {
      if (input.now - since < windowMs) continue;
      const dedupeKey = this.raised.get(key);
      this.belowSince.delete(key);
      this.raised.delete(key);
      if (dedupeKey !== undefined) clear.push(dedupeKey);
    }
  }

  private planAlerts(input: AlertInput, raise: AlertSpec[]): void {
    const { planThresholds } = this.thresholds();
    const sorted = [...planThresholds].sort((a, b) => a - b);
    for (const window of input.plan) {
      sorted.forEach((threshold, index) => {
        if (window.usedPercentage < threshold) return;
        const dedupeKey = `usage:plan:${window.window}:${threshold}:${window.resetsAt}`;
        if (this.raised.has(dedupeKey)) return;
        this.raised.set(dedupeKey, dedupeKey);
        raise.push({
          dedupeKey,
          urgency: index === 0 ? 'normal' : 'high',
          message: `The ${windowLabel(window.window)} plan window is at ${Math.round(window.usedPercentage)} percent`,
          details: `Reported by Claude Code as of ${window.observedAt}. The window resets at ${window.resetsAt}.`,
          actions: ['open-ranking', 'pause-top', 'pause-all-app-started'],
        });
      });
      if (window.runsOutBeforeReset === true && window.runsOutInMinutes !== undefined && window.runsOutInMinutes <= FORECAST_ALERT_MINUTES) {
        const dedupeKey = `usage:forecast:${window.window}:${window.resetsAt}`;
        if (this.raised.has(dedupeKey)) continue;
        this.raised.set(dedupeKey, dedupeKey);
        raise.push({
          dedupeKey,
          urgency: 'normal',
          message: `The ${windowLabel(window.window)} plan window may run out in about ${Math.round(window.runsOutInMinutes)} minutes`,
          details: 'Estimate at the current rate; it moves in steps because the plan percentage is reported in whole numbers.',
          actions: ['open-ranking', 'pause-top'],
        });
      }
    }
  }
}
