/** Timers behind an interface, so the manager's clock rules run under a fake clock in tests. */
export interface Timers {
  setTimeout(work: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(work: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const unref = <T>(handle: T): T => {
  (handle as { unref?: () => void }).unref?.();
  return handle;
};

export const systemTimers: Timers = {
  setTimeout: (work, ms) => unref(setTimeout(work, ms)),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (work, ms) => unref(setInterval(work, ms)),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** A clock and timers that move only when a test says so. */
export class ManualClock implements Timers {
  private current: number;
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; work: () => void; every?: number }>();

  constructor(start = Date.parse('2026-01-01T00:00:00.000Z')) {
    this.current = start;
  }

  now = (): Date => new Date(this.current);

  setTimeout(work: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.current + ms, work });
    return id;
  }

  setInterval(work: () => void, ms: number): number {
    const id = this.nextId++;
    this.pending.set(id, { at: this.current + ms, work, every: ms });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  clearInterval(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Moves time forward and runs the timers that fall due, in order. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      const [id, timer] = due;
      this.current = timer.at;
      if (timer.every === undefined) this.pending.delete(id);
      else timer.at += timer.every;
      timer.work();
    }
    this.current = target;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
