import { describe, expect, it } from 'vitest';
import { buildStartInput, detectKind, type TaskForm } from './taskForm';

const form = (overrides: Partial<TaskForm> = {}): TaskForm => ({ source: '', instruction: '', repoPath: '', base: '', parentFolderId: '', mode: 'profile', ...overrides });

describe('new-task form', () => {
  it('names the kind of the source as the user types', () => {
    expect(detectKind(''), 'empty').toBeUndefined();
    expect(detectKind('fix the build'), 'prompt').toBe('prompt');
    expect(detectKind('https://github.com/acme/app/pull/4'), 'pull request').toBe('pull-request');
    expect(detectKind('ABC-12'), 'jira').toBe('jira');
  });

  it('leaves out empty fields and the profile mode', () => {
    expect(buildStartInput(form({ source: ' fix it ' })), 'prompt only').toEqual({ source: 'fix it' });
  });

  it('sends the instruction for pull request and Jira sources only, and no base for a pull request', () => {
    expect(buildStartInput(form({ source: 'acme/app#4', instruction: 'review', base: 'main', repoPath: '/r' })), 'pull request').toEqual({ source: 'acme/app#4', instruction: 'review', repoPath: '/r' });
    expect(buildStartInput(form({ source: 'ABC-1', instruction: 'plan', base: 'main', repoPath: '/r', mode: 'plan', parentFolderId: 'f' })), 'jira').toEqual({ source: 'ABC-1', instruction: 'plan', base: 'main', repoPath: '/r', permissionMode: 'plan', parentFolderId: 'f' });
    expect(buildStartInput(form({ source: 'do it', instruction: 'ignored' })), 'prompt drops the instruction').toEqual({ source: 'do it' });
  });
});
