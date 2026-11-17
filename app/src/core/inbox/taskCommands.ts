import { z } from 'zod';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { requireInScope } from '../commands/scope';
import { CommandError, type Caller } from '../commands/types';
import type { NodeId, TreeService } from '../tree/types';
import { httpUrl } from './urlSchema';
import { TaskError, type TaskPatch, type TaskService } from './taskService';

export interface TaskCommandDeps {
  readonly tasks: TaskService;
  readonly tree: TreeService;
  readonly onScheduleChanged?: () => void;
}

/** Reminders an agent may keep in its folder at one time; more are refused. */
export const AGENT_SCHEDULE_LIMIT = 20;

const folderId = z.string().min(1).nullable().optional().describe('Folder id; an agent defaults to its own folder, the user to the top level');
const state = z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']);

function guarded<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof TaskError) throw new CommandError(error.code === 'not_found' ? 'not_found' : 'invalid_input', error.message);
    throw error;
  }
}

const folderFor = (caller: Caller, requested: NodeId | null | undefined): NodeId | null => (requested === undefined ? (caller.kind === 'mcp' ? caller.folderId : null) : requested);

/** `task_*` and `reminder_*` commands. Agents act inside their own folder. */
export function registerTaskCommands(registry: CommandRegistry, { tasks, tree, onScheduleChanged }: TaskCommandDeps): () => void {
  const scoped = (caller: Caller, id: NodeId | null): void => requireInScope(tree, caller, id);
  const taskInScope = (caller: Caller, id: string) => {
    const task = tasks.getTask(id);
    if (!task) throw new CommandError('not_found', `no task ${id}`);
    scoped(caller, task.folderId);
    return task;
  };
  const off = [
    registry.register({
      id: 'task_create',
      title: 'New task',
      description: 'Creates a task in a folder. A due time (an ISO instant) gives it a reminder that fires into the user\'s inbox. Returns the task.',
      input: z
        .object({
          title: z.string().min(1).max(200),
          notes: z.string().max(8000).optional(),
          folderId,
          linkNodeId: z.string().min(1).optional(),
          externalUrl: httpUrl.optional().describe('A ticket or pull request the task refers to'),
          dueAt: z.string().min(1).optional(),
        })
        .strict(),
      ui: false,
      mcp: true,
      run: (input, { caller }) => {
        const where = folderFor(caller, input.folderId);
        scoped(caller, where);
        if (input.linkNodeId !== undefined) scoped(caller, input.linkNodeId);
        const task = guarded(() =>
          tasks.createTask({
            folderId: where,
            title: input.title,
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.linkNodeId === undefined ? {} : { linkNodeId: input.linkNodeId }),
            ...(input.externalUrl === undefined ? {} : { externalUrl: input.externalUrl }),
            ...(input.dueAt === undefined ? {} : { dueAt: input.dueAt }),
            owner: caller.kind === 'mcp' ? { kind: 'agent', sessionId: caller.sessionId } : { kind: 'user' },
          }),
        );
        onScheduleChanged?.();
        return task;
      },
    }),
    registry.register({
      id: 'task_list',
      title: 'List tasks',
      description: 'Lists tasks in a folder and below, in order. Default: open, in progress and blocked.',
      input: z.object({ folderId, states: z.array(state).optional() }).strict(),
      ui: false,
      mcp: true,
      run: (input, { caller }) => {
        const where = input.folderId === undefined && caller.kind === 'ui' ? undefined : folderFor(caller, input.folderId);
        if (where !== undefined) scoped(caller, where);
        return { tasks: tasks.listTasks({ ...(where === undefined ? {} : { folderId: where }), states: input.states ?? ['open', 'in_progress', 'blocked'] }) };
      },
    }),
    registry.register({
      id: 'task_update',
      title: 'Update a task',
      description: 'Changes the title, notes, state, due time or link of a task. A null due time removes the reminder. Done and cancelled tasks lose their reminder.',
      input: z
        .object({
          taskId: z.string().min(1),
          title: z.string().min(1).max(200).optional(),
          notes: z.string().max(8000).nullable().optional(),
          state: state.optional(),
          dueAt: z.string().min(1).nullable().optional(),
          externalUrl: httpUrl.nullable().optional(),
        })
        .strict(),
      ui: false,
      mcp: true,
      run: ({ taskId, ...patch }, { caller }) => {
        taskInScope(caller, taskId);
        const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as TaskPatch;
        const task = guarded(() => tasks.updateTask(taskId, defined));
        onScheduleChanged?.();
        return task;
      },
    }),
    registry.register({
      id: 'reminder_create',
      title: 'New reminder',
      description:
        'Creates a reminder that fires into the user\'s inbox. dtstart is local wall time in tzid (an IANA zone, default the system zone), like 2026-11-17T09:00. rrule is optional: FREQ DAILY, WEEKLY, MONTHLY or YEARLY with INTERVAL, BYDAY, BYMONTHDAY, BYHOUR, BYMINUTE, COUNT or UNTIL (UTC). catchUp says what happens to occurrences missed while the app was closed.',
      input: z
        .object({
          title: z.string().min(1).max(140),
          details: z.string().max(8000).optional(),
          folderId,
          linkNodeId: z.string().min(1).optional(),
          dtstart: z.string().min(1),
          tzid: z.string().min(1).max(64).optional(),
          rrule: z.string().min(1).max(200).optional(),
          catchUp: z.enum(['latest', 'each', 'none']).optional(),
        })
        .strict(),
      ui: false,
      mcp: true,
      run: (input, { caller }) => {
        const where = folderFor(caller, input.folderId);
        scoped(caller, where);
        if (input.linkNodeId !== undefined) scoped(caller, input.linkNodeId);
        if (caller.kind === 'mcp' && tasks.listSchedules({ folderId: where }).length >= AGENT_SCHEDULE_LIMIT) {
          throw new CommandError('failed', `your folder already has ${AGENT_SCHEDULE_LIMIT} reminders; delete one with reminder_delete first`);
        }
        const schedule = guarded(() =>
          tasks.createReminder({
            folderId: where,
            title: input.title,
            dtstart: input.dtstart,
            ...(input.details === undefined ? {} : { details: input.details }),
            ...(input.linkNodeId === undefined ? {} : { linkNodeId: input.linkNodeId }),
            ...(input.tzid === undefined ? {} : { tzid: input.tzid }),
            ...(input.rrule === undefined ? {} : { rrule: input.rrule }),
            ...(input.catchUp === undefined ? {} : { catchUp: input.catchUp }),
          }),
        );
        onScheduleChanged?.();
        return schedule;
      },
    }),
    registry.register({
      id: 'reminder_list',
      title: 'List reminders',
      description: 'Lists reminders in a folder and below, with their next due time.',
      input: z.object({ folderId }).strict(),
      ui: false,
      mcp: true,
      run: (input, { caller }) => {
        const where = input.folderId === undefined && caller.kind === 'ui' ? undefined : folderFor(caller, input.folderId);
        if (where !== undefined) scoped(caller, where);
        return { reminders: tasks.listSchedules(where === undefined ? {} : { folderId: where }) };
      },
    }),
    registry.register({
      id: 'reminder_delete',
      title: 'Delete a reminder',
      description: 'Deletes a reminder and its schedule.',
      input: z.object({ reminderId: z.string().min(1) }).strict(),
      ui: false,
      mcp: true,
      run: ({ reminderId }, { caller }) => {
        const schedule = tasks.getSchedule(reminderId);
        if (!schedule) throw new CommandError('not_found', `no reminder ${reminderId}`);
        scoped(caller, schedule.folderId);
        guarded(() => tasks.deleteSchedule(reminderId));
        onScheduleChanged?.();
        return { deleted: true };
      },
    }),
  ];
  return () => off.forEach((unregister) => unregister());
}
