import { beforeEach, describe, expect, it } from 'vitest';
import { openStore, type Database } from '../store/index';
import { SqliteTreeService } from '../tree/SqliteTreeService';
import { CATCH_UP_AFTER_MS, Scheduler } from './Scheduler';
import { SqliteInboxService } from './SqliteInboxService';
import { SqliteTaskStore } from './SqliteTaskStore';
import { TaskError } from './taskService';
import type { InboxItem } from './types';
import type { Timers } from './ViewTracker';

const TZ = 'Europe/Tallinn';
let time: number;
let db: Database;
let tree: SqliteTreeService;
let inbox: SqliteInboxService;
let store: SqliteTaskStore;
let scheduler: Scheduler;
let timers: { handle: number; ms: number; work: () => void }[];
let woken: InboxItem[];
let errors: unknown[];

const at = (iso: string): number => Date.parse(iso);
const now = (): Date => new Date(time);
const fakeTimers: Timers = {
  setTimeout: (work, ms) => {
    const handle = timers.length + 1;
    timers.push({ handle, ms, work });
    return handle;
  },
  clearTimeout: (handle) => {
    timers = timers.filter((timer) => timer.handle !== handle);
  },
};
const runs = () => db.prepare('SELECT due_at, outcome, item_id FROM schedule_runs ORDER BY due_at').all() as { due_at: string; outcome: string; item_id: string | null }[];
const items = () => inbox.list({ kinds: ['reminder'] });

function build(start: string): void {
  time = at(start);
  timers = [];
  woken = [];
  errors = [];
  db = openStore(':memory:');
  tree = new SqliteTreeService(db);
  inbox = new SqliteInboxService(db, tree, { now });
  store = new SqliteTaskStore(db, tree, { now, defaultZone: TZ });
  scheduler = new Scheduler({ db, store, inbox, tree, now, timers: fakeTimers, onWake: (i) => woken.push(...i), onError: (e) => errors.push(e) });
}

beforeEach(() => build('2026-11-17T06:00:00Z'));

describe('reminders', () => {
  it('fires a one-off reminder as an inbox item when its time comes and records the run', () => {
    const folder = tree.createFolder({ title: 'P' });
    store.createReminder({ folderId: folder.id, title: 'Call the vendor', details: 'ask about the invoice', dtstart: '2026-11-17T09:00', tzid: TZ });
    scheduler.start();
    expect(items(), 'nothing before the time').toEqual([]);
    time = at('2026-11-17T07:00:30Z');
    scheduler.tick();
    const [item] = items();
    expect([item?.message, item?.source, item?.folderId, item?.textAuthor], 'item fields').toEqual(['Call the vendor', 'scheduler', folder.id, 'user']);
    expect(item?.details, 'on-time reminder has no missed note').toBe('ask about the invoice');
    expect(runs().map((r) => r.outcome), 'run recorded').toEqual(['fired']);
    expect(store.listSchedules()[0]?.nextDueAt, 'one-off has no next time').toBeUndefined();
    time += 3_600_000;
    scheduler.tick();
    expect(items(), 'does not fire twice').toHaveLength(1);
  });

  it('fires a daily reminder at 09:00 local on both sides of the autumn change', () => {
    build('2026-10-24T05:00:00Z');
    store.createReminder({ folderId: null, title: 'Daily', dtstart: '2026-10-24T09:00', tzid: TZ, rrule: 'FREQ=DAILY' });
    scheduler.start();
    for (const iso of ['2026-10-24T06:00:00Z', '2026-10-25T07:00:00Z', '2026-10-26T07:00:00Z']) {
      time = at(iso);
      scheduler.tick();
    }
    expect(runs().map((r) => r.due_at), 'the offset changes on 25 October').toEqual(['2026-10-24T06:00:00.000Z', '2026-10-25T07:00:00.000Z', '2026-10-26T07:00:00.000Z']);
    expect(items(), 'one item per day').toHaveLength(3);
  });

  it('fires a 03:30 daily reminder at 04:00 on the spring change day', () => {
    build('2026-03-28T00:00:00Z');
    store.createReminder({ folderId: null, title: 'Night', dtstart: '2026-03-28T03:30', tzid: TZ, rrule: 'FREQ=DAILY' });
    scheduler.start();
    for (const iso of ['2026-03-28T01:30:00Z', '2026-03-29T01:00:00Z', '2026-03-30T00:30:00Z']) {
      time = at(iso);
      scheduler.tick();
    }
    expect(runs().map((r) => r.due_at), 'second run at the first minute after the gap').toEqual(['2026-03-28T01:30:00.000Z', '2026-03-29T01:00:00.000Z', '2026-03-30T00:30:00.000Z']);
  });

  it('refuses a one-off in the past, an unknown zone and an unsupported rule', () => {
    const code = (work: () => unknown) => {
      try {
        work();
      } catch (error) {
        return error instanceof TaskError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => store.createReminder({ folderId: null, title: 't', dtstart: '2026-11-17T05:00', tzid: TZ })), 'past one-off').toBe('invalid');
    expect(code(() => store.createReminder({ folderId: null, title: 't', dtstart: '2026-11-18T05:00', tzid: 'Mars/Base' })), 'zone').toBe('invalid');
    expect(code(() => store.createReminder({ folderId: null, title: 't', dtstart: '2026-11-18T05:00', tzid: TZ, rrule: 'FREQ=HOURLY' })), 'rule').toBe('invalid');
    expect(store.listSchedules(), 'nothing stored').toEqual([]);
  });
});

describe('catch-up after the app was closed', () => {
  const daily = (catchUp: 'latest' | 'each' | 'none', count?: number) =>
    store.createReminder({ folderId: null, title: 'Daily', dtstart: '2026-11-18T09:00', tzid: TZ, rrule: count ? `FREQ=DAILY;COUNT=${count}` : 'FREQ=DAILY', catchUp });
  const afterOutage = () => {
    time = at('2026-11-23T10:00:00Z');
    scheduler.start();
  };

  it('latest: one item for the most recent missed occurrence, marked as missed, the rest folded', () => {
    daily('latest');
    afterOutage();
    expect(runs().map((r) => r.outcome), 'one caught up, others folded').toEqual(['folded', 'folded', 'folded', 'folded', 'folded', 'caught_up']);
    const [item] = items();
    expect(item?.details, 'missed note').toContain('Missed while Agide was closed');
    expect(item?.details, 'names the occurrence').toContain('2026-11-23T07:00:00.000Z');
    expect(store.listSchedules()[0]?.nextDueAt, 'next occurrence after now').toBe('2026-11-24T07:00:00.000Z');
  });

  it('each: an item per missed occurrence up to the limit, earlier ones folded', () => {
    build('2026-11-01T06:00:00Z');
    store.createReminder({ folderId: null, title: 'Daily', dtstart: '2026-11-02T09:00', tzid: TZ, rrule: 'FREQ=DAILY', catchUp: 'each' });
    time = at('2026-11-20T10:00:00Z');
    scheduler.start();
    const outcomes = runs().map((r) => r.outcome);
    expect(outcomes.filter((o) => o === 'caught_up'), 'ten items').toHaveLength(10);
    expect(outcomes.filter((o) => o === 'folded'), 'nine earlier folded').toHaveLength(9);
    expect(items(), 'items match caught up runs').toHaveLength(10);
  });

  it('none: records skipped runs and makes no item', () => {
    daily('none');
    afterOutage();
    expect(items(), 'no item').toEqual([]);
    expect(new Set(runs().map((r) => r.outcome)), 'all skipped').toEqual(new Set(['skipped']));
  });

  it('a one-off always catches up once, even with policy none', () => {
    store.createReminder({ folderId: null, title: 'Once', dtstart: '2026-11-18T09:00', tzid: TZ, catchUp: 'none' });
    afterOutage();
    expect(items().map((i) => i.message), 'one caught-up item').toEqual(['Once']);
  });

  it('treats a small delay as on time, not as missed', () => {
    store.createReminder({ folderId: null, title: 'Soon', dtstart: '2026-11-17T09:00', tzid: TZ });
    time = at('2026-11-17T07:00:00Z') + CATCH_UP_AFTER_MS - 1000;
    scheduler.start();
    expect(runs()[0]?.outcome, 'fired').toBe('fired');
    expect(items()[0]?.details, 'no missed note').toBeUndefined();
  });

  it('catches up again on wake from sleep', () => {
    store.createReminder({ folderId: null, title: 'Daily', dtstart: '2026-11-17T09:00', tzid: TZ, rrule: 'FREQ=DAILY', catchUp: 'latest' });
    scheduler.start();
    time = at('2026-11-19T12:00:00Z');
    scheduler.tick();
    expect(runs().map((r) => r.outcome), 'two missed, one item').toEqual(['folded', 'folded', 'caught_up']);
  });
});

describe('persistence and crashes', () => {
  it('keeps the next due time across a restart of the scheduler', () => {
    store.createReminder({ folderId: null, title: 'Daily', dtstart: '2026-11-17T09:00', tzid: TZ, rrule: 'FREQ=DAILY' });
    scheduler.start();
    scheduler.stop();
    const again = new SqliteTaskStore(db, tree, { now, defaultZone: TZ });
    expect(again.listSchedules()[0]?.nextDueAt, 'stored').toBe('2026-11-17T07:00:00.000Z');
  });

  it('leaves no run and no item when the firing fails midway, and fires once after recovery', () => {
    store.createReminder({ folderId: null, title: 'Once', dtstart: '2026-11-17T09:00', tzid: TZ });
    scheduler.start();
    time = at('2026-11-17T07:00:10Z');
    const real = inbox.post.bind(inbox);
    inbox.post = () => {
      throw new Error('disk full');
    };
    scheduler.tick();
    expect(runs(), 'run rolled back with the failed item').toEqual([]);
    expect(errors, 'error reported').toHaveLength(1);
    inbox.post = real;
    scheduler.tick();
    expect(runs().map((r) => r.outcome), 'fired after recovery').toEqual(['fired']);
    expect(items(), 'one item').toHaveLength(1);
  });

  it('ignores an occurrence whose run already exists, as after a crash between insert and commit', () => {
    const schedule = store.createReminder({ folderId: null, title: 'Once', dtstart: '2026-11-17T09:00', tzid: TZ });
    db.prepare("INSERT INTO schedule_runs (schedule_id, due_at, fired_at, outcome) VALUES (?, '2026-11-17T07:00:00.000Z', 't', 'fired')").run(schedule.id);
    time = at('2026-11-17T07:00:10Z');
    scheduler.start();
    expect(items(), 'no second item').toEqual([]);
    expect(store.getSchedule(schedule.id)?.nextDueAt, 'schedule advanced').toBeUndefined();
  });

  it('does not fire a disabled schedule and fires again when it is enabled with a later occurrence', () => {
    const schedule = store.createReminder({ folderId: null, title: 'Daily', dtstart: '2026-11-17T09:00', tzid: TZ, rrule: 'FREQ=DAILY' });
    store.setScheduleEnabled(schedule.id, false);
    time = at('2026-11-17T08:00:00Z');
    scheduler.start();
    expect(items(), 'disabled does not fire').toEqual([]);
    time = at('2026-11-20T08:00:00Z');
    store.setScheduleEnabled(schedule.id, true);
    expect(store.getSchedule(schedule.id)?.nextDueAt, 'resumes at the next occurrence, not the paused one').toBe('2026-11-21T07:00:00.000Z');
    scheduler.tick();
    time = at('2026-11-21T07:00:30Z');
    scheduler.tick();
    expect(runs().map((r) => r.outcome), 'no catch-up for the pause').toEqual(['fired']);
    expect(items().map((i) => i.details), 'no missed note').toEqual([undefined]);
  });
});

describe('cost of a tick', () => {
  it('refuses a rule that fires more often than the daily limit', () => {
    const create = () =>
      store.createReminder({ folderId: null, title: 'Dense', dtstart: '2026-10-17T00:00', tzid: TZ, rrule: 'FREQ=DAILY;BYHOUR=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23;BYMINUTE=0,10,20,30,40,50' });
    expect(create, 'denser than the limit').toThrow(TaskError);
  });

  it('ticks an old dense rule within a small time budget', () => {
    build('2026-11-17T06:00:00Z');
    const hours = Array.from({ length: 24 }, (_, i) => i).join(',');
    db.prepare("INSERT INTO schedules (id, kind, title, dtstart, tzid, rrule, catch_up, next_due_at, created_at, updated_at) VALUES ('old', 'reminder', 'Old', '2016-01-01T00:00', ?, ?, 'latest', ?, ?, ?)").run(
      TZ,
      `FREQ=DAILY;BYHOUR=${hours};BYMINUTE=0,30`,
      '2026-11-17T05:30:00.000Z',
      '2016-01-01T00:00:00.000Z',
      '2016-01-01T00:00:00.000Z',
    );
    const started = performance.now();
    scheduler.start();
    scheduler.tick();
    expect(performance.now() - started, 'start plus tick take less than 300 ms').toBeLessThan(300);
    expect(runs().length, 'the due occurrences fired').toBeGreaterThan(0);
  });
});

describe('timer and snooze', () => {
  it('arms one timer to the next due time, at most 60 seconds ahead, and replaces it on each tick', () => {
    store.createReminder({ folderId: null, title: 'Soon', dtstart: '2026-11-17T08:00', tzid: TZ });
    scheduler.start();
    expect(timers.map((t) => t.ms), 'capped at 60 s').toEqual([60_000]);
    scheduler.tick();
    expect(timers, 'old timer cleared').toHaveLength(1);
    time = at('2026-11-17T05:59:55Z');
    scheduler.tick();
    expect(timers, 'still one timer').toHaveLength(1);
  });

  it('caps the timer at 60 seconds when the next reminder is far ahead', () => {
    store.createReminder({ folderId: null, title: 'Later', dtstart: '2026-11-17T09:00', tzid: TZ });
    scheduler.start();
    expect(timers.map((t) => t.ms), 'one hour ahead still waits 60 s').toEqual([60_000]);
  });

  it('wakes at a snooze that ends before the 60 second cap', () => {
    const { item } = inbox.post({ folderId: null, kind: 'status', source: 'agent', origin: 'o', message: 'm', textAuthor: 'agent' });
    inbox.snooze(item.id, new Date(time + 20_000).toISOString());
    scheduler.start();
    expect(timers.map((t) => t.ms), 'timer set to the snooze end').toEqual([20_000]);
  });

  it('stops arming after stop', () => {
    scheduler.start();
    scheduler.stop();
    expect(timers, 'timer cleared').toEqual([]);
  });

  it('wakes a snoozed item on the tick and reports it', () => {
    const { item } = inbox.post({ folderId: null, kind: 'status', source: 'agent', origin: 'o', message: 'm', textAuthor: 'agent' });
    inbox.snooze(item.id, new Date(time + 600_000).toISOString());
    scheduler.start();
    expect(inbox.get(item.id)?.state, 'still snoozed').toBe('snoozed');
    time += 601_000;
    scheduler.tick();
    expect(inbox.get(item.id)?.state, 'back to new').toBe('new');
    expect(woken.map((i) => i.id), 'reported for notification').toEqual([item.id]);
  });
});

describe('tasks', () => {
  it('gives a task with a due time a reminder, moves it with the due time and drops it when the task is done', () => {
    const task = store.createTask({ folderId: null, title: 'Write report', dueAt: '2026-11-17T09:00:00Z' });
    expect(store.listSchedules().map((s) => [s.taskId, s.nextDueAt]), 'reminder for the due time').toEqual([[task.id, '2026-11-17T09:00:00.000Z']]);
    store.updateTask(task.id, { dueAt: '2026-11-17T10:00:00Z' });
    expect(store.listSchedules().map((s) => s.nextDueAt), 'one reminder, moved').toEqual(['2026-11-17T10:00:00.000Z']);
    const done = store.updateTask(task.id, { state: 'done' });
    expect(done.completedAt, 'completion time set').toBeDefined();
    expect(store.listSchedules(), 'reminder removed').toEqual([]);
  });

  it('fires the task reminder as an item linked to the task node', () => {
    const folder = tree.createFolder({ title: 'P' });
    const leaf = tree.createLeaf({ title: 'Doc', parentId: folder.id, surfaceType: 'browser-tab', surfaceId: 'b1' });
    store.createTask({ folderId: folder.id, title: 'Review doc', linkNodeId: leaf.id, dueAt: '2026-11-17T06:30:00Z' });
    scheduler.start();
    time = at('2026-11-17T06:30:30Z');
    scheduler.tick();
    expect(items().map((i) => [i.message, i.linkNodeId, i.origin]), 'reminder item').toEqual([['Review doc', leaf.id, 'schedule']]);
  });

  it('keeps the reminder when a task is edited after its due time and before the tick', () => {
    const task = store.createTask({ folderId: null, title: 'Write report', dueAt: '2026-11-17T07:00:00Z' });
    scheduler.start();
    time = at('2026-11-17T07:00:20Z');
    store.updateTask(task.id, { notes: 'more', title: 'Write the report' });
    expect(store.listSchedules().map((s) => s.title), 'reminder kept with the new title').toEqual(['Write the report']);
    scheduler.tick();
    expect(items().map((i) => i.message), 'fired').toEqual(['Write the report']);
  });

  it('fires a task due in the repeated autumn hour at the task instant', () => {
    build('2026-10-25T00:00:00Z');
    store.createTask({ folderId: null, title: 'Second 03:30', dueAt: '2026-10-25T01:30:00Z' });
    expect(store.listSchedules().map((s) => s.nextDueAt), 'the instant of the task').toEqual(['2026-10-25T01:30:00.000Z']);
  });

  it('keeps events back until the firing commits and drops them when it rolls back', () => {
    store.createReminder({ folderId: null, title: 'R', dtstart: '2026-11-17T09:00', tzid: TZ });
    const events: string[] = [];
    inbox.subscribe((e) => events.push(e.type));
    const hold = inbox.holdEvents();
    inbox.post({ folderId: null, kind: 'status', source: 'agent', origin: 'o', message: 'm', textAuthor: 'agent' });
    expect(events, 'nothing reported while held').toEqual([]);
    hold.discard();
    expect(events, 'discard reports nothing').toEqual([]);
    const second = inbox.holdEvents();
    inbox.post({ folderId: null, kind: 'status', source: 'agent', origin: 'o', message: 'n', textAuthor: 'agent' });
    second.release();
    expect(events, 'release reports the item and the unread count').toEqual(['inbox.item_changed', 'inbox.unread_changed']);
  });

  it('lists tasks by folder subtree and state in position order, and refuses an unknown task', () => {
    const project = tree.createFolder({ title: 'P' });
    const sub = tree.createFolder({ title: 'S', parentId: project.id });
    const other = tree.createFolder({ title: 'O' });
    const a = store.createTask({ folderId: project.id, title: 'a' });
    const b = store.createTask({ folderId: sub.id, title: 'b' });
    store.createTask({ folderId: other.id, title: 'c' });
    store.updateTask(b.id, { state: 'blocked' });
    expect(store.listTasks({ folderId: project.id }).map((t) => t.title), 'subtree').toEqual(['a', 'b']);
    expect(store.listTasks({ folderId: project.id, states: ['open'] }).map((t) => t.id), 'state filter').toEqual([a.id]);
    expect(() => store.updateTask('missing', {}), 'unknown task').toThrow(TaskError);
  });
});
