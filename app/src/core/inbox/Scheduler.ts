import type { Database } from '../store/index';
import type { TreeService } from '../tree/types';
import { occurrences, parseRRule } from './rrule';
import { nextOccurrenceAfter, SqliteTaskStore } from './SqliteTaskStore';
import type { EventHold } from './SqliteInboxService';
import type { Timers } from './ViewTracker';
import { parseWall } from './zoned';
import type { InboxItem, InboxService, Schedule, ScheduleRunOutcome } from './types';

/** An occurrence this late or later is a missed one and follows the schedule's catch-up policy. */
export const CATCH_UP_AFTER_MS = 5 * 60_000;
const EACH_LIMIT = 10;
const MAX_TIMER_MS = 60_000;
const MAX_MISSED = 5000;

const earlier = (a: string | undefined, b: string | undefined): string | undefined => (a === undefined || (b !== undefined && b < a) ? b : a);

export interface SchedulerOptions {
  readonly db: Database;
  readonly store: SqliteTaskStore;
  /** When it can hold events, they are reported after the firing's transaction commits. */
  readonly inbox: InboxService & { holdEvents?(): EventHold; nextWake?(): string | undefined };
  readonly tree: TreeService;
  readonly now: () => Date;
  readonly timers: Timers;
  /** Called for items that woke from a snooze or fired, so the notifier can show them. */
  readonly onWake?: (items: InboxItem[]) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * The persisted scheduler of 0021 section 7. One timer to the earliest due time, never longer than 60 seconds, so
 * sleep and clock changes show. A firing is one transaction: the run row (its key makes a repeat a no-op after a
 * crash), the item, and the next due time. Snoozed items wake on the same tick and count towards the timer.
 */
export class Scheduler {
  private timer: unknown;
  private running = false;

  constructor(private readonly options: SchedulerOptions) {}

  /** Catches up on what was missed while the app was closed, then keeps time. */
  start(): void {
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) this.options.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Call on wake from sleep and when a schedule changed. */
  tick(): void {
    try {
      const woken = this.options.inbox.wakeDue();
      if (woken.length > 0) this.options.onWake?.(woken);
      this.fireDue();
    } catch (error) {
      this.options.onError?.(error);
    }
    this.arm();
  }

  private arm(): void {
    if (this.timer !== undefined) this.options.timers.clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.running) return;
    const earliest = earlier(this.options.store.earliestDue(), this.options.inbox.nextWake?.());
    const wait = earliest === undefined ? MAX_TIMER_MS : Math.min(MAX_TIMER_MS, Math.max(1000, Date.parse(earliest) - this.options.now().getTime()));
    this.timer = this.options.timers.setTimeout(() => this.tick(), wait);
  }

  private fireDue(): void {
    const nowMs = this.options.now().getTime();
    for (const schedule of this.options.store.dueSchedules(new Date(nowMs).toISOString())) {
      try {
        this.fire(schedule, nowMs);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
  }

  private fire(schedule: Schedule, nowMs: number): void {
    const due = this.missed(schedule, nowMs);
    if (due.length === 0) return;
    const late = nowMs - (due[0] ?? nowMs) >= CATCH_UP_AFTER_MS;
    const plan = this.plan(schedule, due, late);
    const next = nextOccurrenceAfter(schedule, nowMs);
    const { db } = this.options;
    const hold = this.options.inbox.holdEvents?.();
    db.exec('BEGIN');
    try {
      for (const { dueMs, outcome } of plan) this.record(schedule, dueMs, outcome, nowMs);
      db.prepare('UPDATE schedules SET next_due_at = ?, last_due_at = ?, updated_at = ? WHERE id = ?').run(
        next === undefined ? null : new Date(next).toISOString(),
        new Date(due[due.length - 1] ?? nowMs).toISOString(),
        new Date(nowMs).toISOString(),
        schedule.id,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      hold?.discard();
      throw error;
    }
    hold?.release();
  }

  /** Occurrences from `nextDueAt` up to now. */
  private missed(schedule: Schedule, nowMs: number): number[] {
    const from = Date.parse(schedule.nextDueAt ?? '');
    const rule = schedule.rrule === undefined ? undefined : parseRRule(schedule.rrule);
    const out: number[] = [];
    for (const instant of occurrences(parseWall(schedule.dtstart), schedule.tzid, rule, from)) {
      if (instant > nowMs || out.length >= MAX_MISSED) break;
      if (instant >= from) out.push(instant);
    }
    return out;
  }

  private plan(schedule: Schedule, due: number[], late: boolean): { dueMs: number; outcome: ScheduleRunOutcome }[] {
    if (!late) return due.map((dueMs) => ({ dueMs, outcome: 'fired' }));
    const policy = schedule.rrule === undefined && schedule.catchUp === 'none' ? 'latest' : schedule.catchUp;
    const keep = policy === 'latest' ? 1 : policy === 'each' ? EACH_LIMIT : 0;
    return due.map((dueMs, index) => ({
      dueMs,
      outcome: policy === 'none' ? 'skipped' : index >= due.length - keep ? 'caught_up' : 'folded',
    }));
  }

  private record(schedule: Schedule, dueMs: number, outcome: ScheduleRunOutcome, nowMs: number): void {
    const { db, inbox, tree } = this.options;
    const dueIso = new Date(dueMs).toISOString();
    const inserted = db
      .prepare('INSERT OR IGNORE INTO schedule_runs (schedule_id, due_at, fired_at, outcome) VALUES (?, ?, ?, ?)')
      .run(schedule.id, dueIso, new Date(nowMs).toISOString(), outcome);
    if (Number(inserted.changes) === 0 || (outcome !== 'fired' && outcome !== 'caught_up')) return;
    const taskNode = schedule.taskId === undefined ? undefined : (db.prepare('SELECT link_node_id AS n FROM tasks WHERE id = ?').get(schedule.taskId) as { n: string | null } | undefined)?.n;
    const linkNodeId = schedule.linkNodeId ?? taskNode ?? undefined;
    const folderId = schedule.folderId !== null && tree.get(schedule.folderId) ? schedule.folderId : null;
    const missedNote = outcome === 'caught_up' ? `Missed while Agide was closed, due ${dueIso}.` : undefined;
    const details = [missedNote, schedule.details].filter(Boolean).join('\n\n');
    const { item } = inbox.post({
      folderId,
      kind: 'reminder',
      source: 'scheduler',
      origin: schedule.taskId === undefined ? 'reminder' : 'schedule',
      message: schedule.title,
      ...(details ? { details } : {}),
      textAuthor: 'user',
      payload: { scheduleId: schedule.id, dueAt: dueIso, missed: outcome === 'caught_up', ...(schedule.taskId === undefined ? {} : { taskId: schedule.taskId }) },
      ...(linkNodeId !== undefined && tree.get(linkNodeId) ? { linkNodeId } : {}),
    });
    db.prepare('UPDATE schedule_runs SET item_id = ? WHERE schedule_id = ? AND due_at = ?').run(item.id, schedule.id, dueIso);
  }
}
