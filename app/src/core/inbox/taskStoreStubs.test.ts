import { describe, expect, it } from 'vitest';
import { openStore } from '../store/index';
import { SqliteTreeService } from '../tree/SqliteTreeService';
import { SqliteTaskStore } from './SqliteTaskStore';
import { TaskError } from './taskService';

describe('task store additions of milestone 6 before w-tasks-ui', () => {
  const store = (): SqliteTaskStore => {
    const db = openStore(':memory:');
    return new SqliteTaskStore(db, new SqliteTreeService(db));
  };
  const codeOf = (work: () => unknown): string | undefined => {
    try {
      work();
      return undefined;
    } catch (error) {
      return error instanceof TaskError ? error.code : `not a TaskError: ${String(error)}`;
    }
  };

  it('answers not_built to delete, move and reminder update, and changes nothing', () => {
    const tasks = store();
    const task = tasks.createTask({ folderId: null, title: 'Keep me' });
    expect(codeOf(() => tasks.deleteTask(task.id)), 'deleteTask').toBe('not_built');
    expect(codeOf(() => tasks.moveTask(task.id, {})), 'moveTask').toBe('not_built');
    expect(codeOf(() => tasks.updateReminder('r1', { title: 'x' })), 'updateReminder').toBe('not_built');
    expect(tasks.getTask(task.id)?.title, 'the task is still there').toBe('Keep me');
  });
});
