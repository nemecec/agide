import { randomUUID } from 'node:crypto';
import { migrate, type Database } from '../store/index';
import type { NodeId, TreeService } from '../tree/types';
import { TASKS_MODULE, taskMigrations } from './inboxMigrations';
import { occurrences, parseRRule, type RuleSpec } from './rrule';
import { TaskError, type NewReminder, type NewTask, type ReminderPatch, type TaskPatch, type TaskService } from './taskService';
import { cleanLine, cleanText } from './text';
import type { Schedule, Task, TaskState } from './types';
import { formatWall, isValidZone, parseWall, utcToWall } from './zoned';

interface TaskRow {
  id: string;
  folder_id: string | null;
  link_node_id: string | null;
  title: string;
  notes: string | null;
  state: TaskState;
  owner: 'user' | 'agent';
  owner_session_id: string | null;
  external_url: string | null;
  due_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ScheduleRow {
  id: string;
  kind: Schedule['kind'];
  folder_id: string | null;
  link_node_id: string | null;
  task_id: string | null;
  title: string;
  details: string | null;
  dtstart: string;
  tzid: string;
  rrule: string | null;
  catch_up: Schedule['catchUp'];
  prompt: string | null;
  approved_at: string | null;
  enabled: number;
  next_due_at: string | null;
  last_due_at: string | null;
  created_at: string;
  updated_at: string;
}

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  folderId: row.folder_id,
  ...(row.link_node_id === null ? {} : { linkNodeId: row.link_node_id }),
  title: row.title,
  ...(row.notes === null ? {} : { notes: row.notes }),
  state: row.state,
  owner: row.owner === 'agent' && row.owner_session_id !== null ? { kind: 'agent', sessionId: row.owner_session_id } : { kind: 'user' },
  ...(row.external_url === null ? {} : { externalUrl: row.external_url }),
  ...(row.due_at === null ? {} : { dueAt: row.due_at }),
  position: row.position,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
});

export const toSchedule = (row: ScheduleRow): Schedule => ({
  id: row.id,
  kind: row.kind,
  folderId: row.folder_id,
  ...(row.link_node_id === null ? {} : { linkNodeId: row.link_node_id }),
  ...(row.task_id === null ? {} : { taskId: row.task_id }),
  title: row.title,
  ...(row.details === null ? {} : { details: row.details }),
  dtstart: row.dtstart,
  tzid: row.tzid,
  ...(row.rrule === null ? {} : { rrule: row.rrule }),
  catchUp: row.catch_up,
  ...(row.prompt === null ? {} : { prompt: row.prompt }),
  ...(row.approved_at === null ? {} : { approvedAt: row.approved_at }),
  enabled: row.enabled === 1,
  ...(row.next_due_at === null ? {} : { nextDueAt: row.next_due_at }),
  ...(row.last_due_at === null ? {} : { lastDueAt: row.last_due_at }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface SqliteTaskStoreOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Zone for reminders created from a task's due time and for reminders without one. */
  readonly defaultZone?: string;
}

/** The first occurrence strictly after the instant, or `undefined` when the schedule has none left. */
export function nextOccurrenceAfter(schedule: Pick<Schedule, 'dtstart' | 'tzid' | 'rrule'>, afterMs: number): number | undefined {
  for (const instant of occurrences(parseWall(schedule.dtstart), schedule.tzid, schedule.rrule === undefined ? undefined : parseRRule(schedule.rrule), afterMs)) {
    if (instant > afterMs) return instant;
  }
  return undefined;
}

/** Tasks and schedules in the app database. Reminders created here fire through the `Scheduler`. */
export class SqliteTaskStore implements TaskService {
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly defaultZone: string;

  constructor(
    private readonly db: Database,
    private readonly tree: TreeService,
    options: SqliteTaskStoreOptions = {},
  ) {
    migrate(db, TASKS_MODULE, taskMigrations);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
    this.defaultZone = options.defaultZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  createTask(input: NewTask): Task {
    const title = this.title(input.title, 200);
    this.requireNodes(input.folderId, input.linkNodeId);
    const owner = input.owner ?? { kind: 'user' as const };
    const time = this.now().toISOString();
    const position = (this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE folder_id IS ?').get(input.folderId) as { p: number }).p;
    const id = this.newId();
    this.db
      .prepare(
        `INSERT INTO tasks (id, folder_id, link_node_id, title, notes, owner, owner_session_id, external_url, due_at, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.folderId,
        input.linkNodeId ?? null,
        title,
        input.notes === undefined ? null : cleanText(input.notes),
        owner.kind,
        owner.kind === 'agent' ? owner.sessionId : null,
        input.externalUrl ?? null,
        this.instant(input.dueAt),
        position,
        time,
        time,
      );
    if (input.dueAt !== undefined) this.attachReminder(this.requireTask(id));
    return this.requireTask(id);
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row && toTask(row);
  }

  listTasks(query: { folderId?: NodeId | null; states?: readonly TaskState[] } = {}): Task[] {
    const where: string[] = [];
    const args: string[] = [];
    if (query.folderId === null) where.push('folder_id IS NULL');
    else if (query.folderId !== undefined) {
      where.push('folder_id IN (WITH RECURSIVE d(id) AS (SELECT ? UNION SELECT n.id FROM tree_nodes n JOIN d ON n.parent_id = d.id) SELECT id FROM d)');
      args.push(query.folderId);
    }
    if (query.states) {
      where.push(`state IN (${query.states.map(() => '?').join(', ') || 'NULL'})`);
      args.push(...query.states);
    }
    const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY position, created_at, rowid`;
    return (this.db.prepare(sql).all(...args) as unknown as TaskRow[]).map(toTask);
  }

  updateTask(id: string, patch: TaskPatch): Task {
    const task = this.requireTask(id);
    const time = this.now().toISOString();
    const state = patch.state ?? task.state;
    const finished = state === 'done' || state === 'cancelled';
    const dueAt = patch.dueAt === undefined ? (task.dueAt ?? null) : this.instant(patch.dueAt ?? undefined);
    this.db.exec('BEGIN');
    try {
      this.writeTask(task, patch, state, finished, dueAt, time);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.requireTask(id);
  }

  private writeTask(task: Task, patch: TaskPatch, state: TaskState, finished: boolean, dueAt: string | null, time: string): void {
    const id = task.id;
    this.db
      .prepare('UPDATE tasks SET title = ?, notes = ?, state = ?, external_url = ?, due_at = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.title === undefined ? task.title : this.title(patch.title, 200),
        patch.notes === undefined ? (task.notes ?? null) : patch.notes === null ? null : cleanText(patch.notes),
        state,
        patch.externalUrl === undefined ? (task.externalUrl ?? null) : patch.externalUrl,
        dueAt,
        finished ? (task.completedAt ?? time) : null,
        time,
        id,
      );
    const updated = this.requireTask(id);
    const hasReminder = this.db.prepare('SELECT 1 AS x FROM schedules WHERE task_id = ?').get(id) !== undefined;
    if (finished || updated.dueAt === undefined) {
      this.db.prepare('DELETE FROM schedules WHERE task_id = ?').run(id);
    } else if (hasReminder && updated.dueAt === task.dueAt) {
      this.db.prepare('UPDATE schedules SET title = ?, updated_at = ? WHERE task_id = ?').run(updated.title.slice(0, 140), time, id);
    } else {
      this.db.prepare('DELETE FROM schedules WHERE task_id = ?').run(id);
      this.attachReminder(updated);
    }
  }

  createReminder(input: NewReminder): Schedule {
    const title = this.title(input.title, 140);
    this.requireNodes(input.folderId, input.linkNodeId);
    const tzid = input.tzid ?? this.defaultZone;
    if (!isValidZone(tzid)) throw new TaskError('invalid', `${tzid} is not a time zone`);
    let rule: RuleSpec | undefined;
    try {
      parseWall(input.dtstart);
      rule = input.rrule === undefined ? undefined : parseRRule(input.rrule);
    } catch (error) {
      throw new TaskError('invalid', error instanceof Error ? error.message : String(error));
    }
    const nowMs = this.now().getTime();
    const draft = { dtstart: input.dtstart, tzid, ...(input.rrule === undefined ? {} : { rrule: input.rrule }) };
    const next = nextOccurrenceAfter(draft, nowMs - 1);
    if (next === undefined) throw new TaskError('invalid', rule ? 'the rule has no occurrence from now on' : 'the reminder time is in the past');
    return this.insertSchedule({ ...input, title, tzid, nextDueAt: new Date(next).toISOString(), taskId: undefined });
  }

  getSchedule(id: string): Schedule | undefined {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | undefined;
    return row && toSchedule(row);
  }

  listSchedules(query: { folderId?: NodeId | null } = {}): Schedule[] {
    const rows =
      query.folderId === undefined
        ? this.db.prepare('SELECT * FROM schedules ORDER BY next_due_at IS NULL, next_due_at, created_at').all()
        : this.db
            .prepare(
              `SELECT * FROM schedules WHERE folder_id ${query.folderId === null ? 'IS NULL' : `IN (WITH RECURSIVE d(id) AS (SELECT ? UNION SELECT n.id FROM tree_nodes n JOIN d ON n.parent_id = d.id) SELECT id FROM d)`}
               ORDER BY next_due_at IS NULL, next_due_at, created_at`,
            )
            .all(...(query.folderId === null ? [] : [query.folderId]));
    return (rows as unknown as ScheduleRow[]).map(toSchedule);
  }

  deleteTask(_id: string): void {
    throw new TaskError('not_built', 'deleteTask is not built yet');
  }

  moveTask(_id: string, _to: { folderId?: NodeId | null; beforeTaskId?: string }): Task {
    throw new TaskError('not_built', 'moveTask is not built yet');
  }

  updateReminder(_id: string, _patch: ReminderPatch): Schedule {
    throw new TaskError('not_built', 'updateReminder is not built yet');
  }

  setScheduleEnabled(id: string, enabled: boolean): Schedule {
    const schedule = this.requireSchedule(id);
    let next = schedule.nextDueAt ?? null;
    if (enabled && !schedule.enabled) {
      const found = nextOccurrenceAfter(schedule, this.now().getTime());
      next = found === undefined ? null : new Date(found).toISOString();
    }
    this.db.prepare('UPDATE schedules SET enabled = ?, next_due_at = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, next, this.now().toISOString(), id);
    return this.requireSchedule(id);
  }

  deleteSchedule(id: string): void {
    this.requireSchedule(id);
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }

  /** Enabled schedules whose next occurrence is at or before the instant. */
  dueSchedules(untilIso: string): Schedule[] {
    return (this.db.prepare('SELECT * FROM schedules WHERE enabled = 1 AND next_due_at <= ? ORDER BY next_due_at').all(untilIso) as unknown as ScheduleRow[]).map(toSchedule);
  }

  /** The earliest `next_due_at` of an enabled schedule. */
  earliestDue(): string | undefined {
    const row = this.db.prepare('SELECT MIN(next_due_at) AS t FROM schedules WHERE enabled = 1 AND next_due_at IS NOT NULL').get() as { t: string | null };
    return row.t ?? undefined;
  }

  private attachReminder(task: Task): void {
    if (task.dueAt === undefined) return;
    if (Date.parse(task.dueAt) < this.now().getTime()) return;
    const due = Math.floor(Date.parse(task.dueAt) / 60_000) * 60_000;
    this.insertSchedule({
      folderId: task.folderId,
      title: task.title.slice(0, 140),
      tzid: 'UTC',
      dtstart: formatWall(utcToWall(due, 'UTC')),
      nextDueAt: new Date(due).toISOString(),
      taskId: task.id,
      ...(task.linkNodeId === undefined ? {} : { linkNodeId: task.linkNodeId }),
    });
  }

  private insertSchedule(input: NewReminder & { title: string; tzid: string; nextDueAt: string; taskId: string | undefined }): Schedule {
    const id = this.newId();
    const time = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO schedules (id, kind, folder_id, link_node_id, task_id, title, details, dtstart, tzid, rrule, catch_up, next_due_at, created_at, updated_at)
         VALUES (?, 'reminder', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.folderId,
        input.linkNodeId ?? null,
        input.taskId ?? null,
        input.title,
        input.details === undefined ? null : cleanText(input.details),
        input.dtstart,
        input.tzid,
        input.rrule ?? null,
        input.catchUp ?? 'latest',
        input.nextDueAt,
        time,
        time,
      );
    return this.requireSchedule(id);
  }

  private title(text: string, limit: number): string {
    const title = cleanLine(text);
    if (title.length === 0 || title.length > limit) throw new TaskError('invalid', `title must hold 1 to ${limit} characters`);
    return title;
  }

  private instant(value: string | undefined): string | null {
    if (value === undefined) return null;
    if (Number.isNaN(Date.parse(value))) throw new TaskError('invalid', `${value} is not a date`);
    return new Date(value).toISOString();
  }

  private requireNodes(...ids: (NodeId | null | undefined)[]): void {
    for (const id of ids) if (id !== null && id !== undefined && this.tree.get(id) === undefined) throw new TaskError('invalid', `no node ${id}`);
  }

  private requireTask(id: string): Task {
    const task = this.getTask(id);
    if (!task) throw new TaskError('not_found', `no task ${id}`);
    return task;
  }

  private requireSchedule(id: string): Schedule {
    const schedule = this.getSchedule(id);
    if (!schedule) throw new TaskError('not_found', `no reminder ${id}`);
    return schedule;
  }
}
