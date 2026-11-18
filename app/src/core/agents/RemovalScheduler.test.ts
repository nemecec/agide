import { describe, expect, it } from 'vitest';
import { RemovalScheduler, type SchedulerTimers } from './RemovalScheduler';
import type { AgentRecord, AgentRef } from './types';

/** A clock the test moves by hand; timers fire when it passes their time. */
class FakeClock implements SchedulerTimers {
  now = 0;
  private next = 1;
  private readonly pending = new Map<number, { at: number; work: () => void }>();
  setTimeout(work: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.now + ms, work });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }
  advance(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.pending]) {
      if (timer.at <= this.now) {
        this.pending.delete(id);
        timer.work();
      }
    }
  }
  get timers(): number {
    return this.pending.size;
  }
}

const ref = (agentKey: string): AgentRef => ({ sessionId: 's', agentKey });
const record = (agentKey: string, state: AgentRecord['state']): AgentRecord => ({
  ref: ref(agentKey),
  origin: 'session-started',
  state,
  openRequests: [],
  tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
  startedAt: 't',
  updatedAt: 't',
});

function setup(delays = { doneSeconds: 10, failedSeconds: 300 }) {
  const clock = new FakeClock();
  const hidden: string[] = [];
  const shown: string[] = [];
  let current = delays;
  const scheduler = new RemovalScheduler({
    timers: clock,
    delays: () => current,
    onHidden: (r) => hidden.push(r.agentKey),
    onShown: (r) => shown.push(r.agentKey),
  });
  return { clock, hidden, shown, scheduler, setDelays: (next: typeof delays) => (current = next) };
}

describe('RemovalScheduler', () => {
  it('hides a done node after the done delay and not before', () => {
    const { clock, hidden, scheduler } = setup();
    scheduler.observe(record('a', 'done'));
    clock.advance(9_999);
    expect(hidden, 'just before the delay').toEqual([]);
    clock.advance(1);
    expect(hidden, 'at the delay').toEqual(['a']);
    expect(scheduler.isHidden(ref('a')), 'marked hidden').toBe(true);
  });

  it('keeps a failed node much longer and hides it at once when dismissed', () => {
    const { clock, hidden, scheduler } = setup();
    scheduler.observe(record('f', 'failed'));
    clock.advance(60_000);
    expect(hidden, 'a failed node outlives the done delay').toEqual([]);
    scheduler.dismiss(ref('f'));
    expect(hidden, 'dismissed').toEqual(['f']);
    expect(clock.timers, 'its timer is gone').toBe(0);
  });

  it('never hides running or waiting nodes on a timer', () => {
    const { clock, hidden, scheduler } = setup();
    scheduler.observe(record('r', 'running'));
    scheduler.observe(record('w', 'waiting'));
    clock.advance(10_000_000);
    expect(hidden, 'nothing hidden').toEqual([]);
  });

  it('shows a hidden node again and cancels a pending timer when the agent starts again', () => {
    const { clock, hidden, shown, scheduler } = setup();
    scheduler.observe(record('a', 'done'));
    scheduler.observe(record('a', 'running'));
    clock.advance(20_000);
    expect(hidden, 'the cancelled timer did not fire').toEqual([]);
    scheduler.observe(record('b', 'done'));
    clock.advance(10_000);
    scheduler.observe(record('b', 'running'));
    expect(shown, 'a hidden node comes back').toEqual(['b']);
    expect(scheduler.isHidden(ref('b')), 'visible again').toBe(false);
  });

  it('holds a selected node and restarts its timer when released', () => {
    const { clock, hidden, scheduler } = setup();
    scheduler.observe(record('a', 'done'));
    scheduler.hold(ref('a'));
    clock.advance(60_000);
    expect(hidden, 'held').toEqual([]);
    scheduler.release(ref('a'));
    clock.advance(9_999);
    expect(hidden, 'timer restarted from the release').toEqual([]);
    clock.advance(1);
    expect(hidden, 'hidden after the full delay').toEqual(['a']);
  });

  it('starts no timer for a held node that changes again while it is held', () => {
    const { clock, hidden, scheduler } = setup();
    scheduler.observe(record('a', 'done'));
    scheduler.hold(ref('a'));
    scheduler.observe(record('a', 'done'));
    clock.advance(60_000);
    expect(hidden, 'a held node stays through a later change').toEqual([]);
  });

  it('applies a changed delay to new timers only, and a zero delay hides at once', () => {
    const { clock, hidden, scheduler, setDelays } = setup();
    scheduler.observe(record('a', 'done'));
    setDelays({ doneSeconds: 1, failedSeconds: 300 });
    clock.advance(1_000);
    expect(hidden, 'the running timer kept its delay').toEqual([]);
    scheduler.observe(record('b', 'done'));
    clock.advance(1_000);
    expect(hidden, 'the new timer uses one second').toEqual(['b']);
    setDelays({ doneSeconds: 0, failedSeconds: 300 });
    scheduler.observe(record('c', 'done'));
    expect(hidden.at(-1), 'zero hides immediately').toBe('c');
  });

  it('seeds loaded finished nodes as hidden without a timer', () => {
    const { clock, hidden, scheduler } = setup();
    scheduler.seedFinished(record('old', 'done'));
    expect(scheduler.isHidden(ref('old')), 'hidden').toBe(true);
    expect(clock.timers, 'no timer').toBe(0);
    expect(hidden, 'no callback for a seeded node').toEqual([]);
  });
});
