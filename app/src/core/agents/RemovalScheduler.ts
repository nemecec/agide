import type { AgentRecord, AgentRef } from './types';

export interface SchedulerTimers {
  setTimeout(work: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RemovalDelays {
  readonly doneSeconds: number;
  readonly failedSeconds: number;
}

export interface RemovalSchedulerOptions {
  readonly timers: SchedulerTimers;
  /** Read when a timer starts, so a changed setting applies to new timers at once (0027 section 3). */
  readonly delays: () => RemovalDelays;
  /** A node left the tree (expired, dismissed or seeded as finished). */
  readonly onHidden: (ref: AgentRef) => void;
  /** A hidden node came back because its agent started again. */
  readonly onShown: (ref: AgentRef) => void;
}

const keyOf = (ref: AgentRef): string => `${ref.sessionId}:${ref.agentKey}`;

/**
 * Decides when finished agents leave the tree (0027 section 3). Running and waiting agents never leave on a
 * timer; a done agent leaves after the done delay, a failed one after the failed delay or when dismissed. A
 * node that is selected or has its transcript open is held: its timer restarts when it is released. A revived
 * agent comes back and loses its timer. The records stay in the store; the history view still lists them.
 */
export class RemovalScheduler {
  private readonly timers = new Map<string, unknown>();
  private readonly hidden = new Set<string>();
  private readonly held = new Set<string>();
  private readonly expiredWhileHeld = new Set<string>();
  private readonly records = new Map<string, AgentRecord>();

  constructor(private readonly options: RemovalSchedulerOptions) {}

  isHidden(ref: AgentRef): boolean {
    return this.hidden.has(keyOf(ref));
  }

  /** Call for every changed record. */
  observe(record: AgentRecord): void {
    const key = keyOf(record.ref);
    this.records.set(key, record);
    if (record.state === 'running' || record.state === 'waiting') {
      this.cancel(key);
      this.expiredWhileHeld.delete(key);
      if (this.hidden.delete(key)) this.options.onShown(record.ref);
      return;
    }
    if (this.hidden.has(key) || this.timers.has(key) || this.held.has(key)) return;
    this.start(record);
  }

  /** A finished record that was loaded at start never shows in the tree. */
  seedFinished(record: AgentRecord): void {
    this.records.set(keyOf(record.ref), record);
    this.hidden.add(keyOf(record.ref));
  }

  hold(ref: AgentRef): void {
    const key = keyOf(ref);
    this.held.add(key);
    this.cancel(key);
  }

  release(ref: AgentRef): void {
    const key = keyOf(ref);
    if (!this.held.delete(key)) return;
    const record = this.records.get(key);
    if (record && (record.state === 'done' || record.state === 'failed') && !this.hidden.has(key)) this.start(record);
  }

  dismiss(ref: AgentRef): void {
    const key = keyOf(ref);
    this.cancel(key);
    this.held.delete(key);
    this.hide(key, ref);
  }

  forget(ref: AgentRef): void {
    const key = keyOf(ref);
    this.cancel(key);
    this.hidden.delete(key);
    this.held.delete(key);
    this.records.delete(key);
  }

  dispose(): void {
    for (const handle of this.timers.values()) this.options.timers.clearTimeout(handle);
    this.timers.clear();
  }

  private start(record: AgentRecord): void {
    const key = keyOf(record.ref);
    const delays = this.options.delays();
    const seconds = record.state === 'failed' ? delays.failedSeconds : delays.doneSeconds;
    if (seconds <= 0) {
      this.hide(key, record.ref);
      return;
    }
    this.timers.set(
      key,
      this.options.timers.setTimeout(() => {
        this.timers.delete(key);
        this.hide(key, record.ref);
      }, seconds * 1000),
    );
  }

  private hide(key: string, ref: AgentRef): void {
    if (this.hidden.has(key)) return;
    this.hidden.add(key);
    this.options.onHidden(ref);
  }

  private cancel(key: string): void {
    const handle = this.timers.get(key);
    if (handle === undefined) return;
    this.options.timers.clearTimeout(handle);
    this.timers.delete(key);
  }
}
