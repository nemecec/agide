import type { SessionId } from '../session/types';
import type { NodeId } from '../tree/types';
import type { CatchUp, Schedule, Task, TaskState } from './types';

export type TaskErrorCode = 'not_found' | 'invalid' | 'not_built';

export class TaskError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskError';
  }
}

export interface NewTask {
  readonly folderId: NodeId | null;
  readonly title: string;
  readonly notes?: string;
  readonly owner?: { readonly kind: 'user' } | { readonly kind: 'agent'; readonly sessionId: SessionId };
  readonly linkNodeId?: NodeId;
  readonly externalUrl?: string;
  /** Instant. A task with a due time owns a one-off reminder. */
  readonly dueAt?: string;
}

export interface TaskPatch {
  readonly title?: string;
  readonly notes?: string | null;
  readonly state?: TaskState;
  /** `null` removes the due time and its reminder. */
  readonly dueAt?: string | null;
  readonly externalUrl?: string | null;
}

export interface NewReminder {
  readonly folderId: NodeId | null;
  readonly title: string;
  readonly details?: string;
  readonly linkNodeId?: NodeId;
  /** Local wall time in `tzid`, like `2026-11-17T09:00`. */
  readonly dtstart: string;
  readonly tzid?: string;
  readonly rrule?: string;
  readonly catchUp?: CatchUp;
}

/** What `reminder_update` changes (0043 section 4.5). `next_due_at` is computed again from the new values. */
export interface ReminderPatch {
  readonly title?: string;
  readonly details?: string | null;
  readonly dtstart?: string;
  readonly tzid?: string;
  readonly rrule?: string | null;
  readonly catchUp?: CatchUp;
}

/** The tasks of a folder changed: created, edited, moved or removed. The pane reads the list again. */
export type TaskListEvent = { readonly type: 'tasks.changed'; readonly folderId: NodeId | null };

/** Tasks, reminders and their schedules (0021 section 7). Throws `TaskError`. */
export interface TaskService {
  createTask(input: NewTask): Task;
  getTask(id: string): Task | undefined;
  listTasks(query?: { folderId?: NodeId | null; states?: readonly TaskState[] }): Task[];
  updateTask(id: string, patch: TaskPatch): Task;
  /** Removes the task; its due reminder goes with it (`ON DELETE CASCADE`). */
  deleteTask(id: string): void;
  /** Places the task before `beforeTaskId` (the end when absent), optionally in another folder. Positions are renumbered. */
  moveTask(id: string, to: { folderId?: NodeId | null; beforeTaskId?: string }): Task;
  createReminder(input: NewReminder): Schedule;
  getSchedule(id: string): Schedule | undefined;
  listSchedules(query?: { folderId?: NodeId | null }): Schedule[];
  updateReminder(id: string, patch: ReminderPatch): Schedule;
  setScheduleEnabled(id: string, enabled: boolean): Schedule;
  deleteSchedule(id: string): void;
}
