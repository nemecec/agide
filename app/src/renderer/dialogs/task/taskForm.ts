import { parseTaskSource } from '../../../core/tasks/parseSource';
import type { TaskSourceKind } from '../../../core/tasks/types';

export type ModeChoice = 'profile' | 'auto' | 'default' | 'acceptEdits' | 'plan';

export interface TaskForm {
  readonly source: string;
  readonly instruction: string;
  /** A path, or empty for none. */
  readonly repoPath: string;
  readonly base: string;
  readonly parentFolderId: string;
  readonly mode: ModeChoice;
}

export const KIND_LABEL: Record<TaskSourceKind, string> = { prompt: 'Prompt', 'pull-request': 'Pull request', jira: 'Jira issue' };

export function detectKind(source: string): TaskSourceKind | undefined {
  return source.trim() === '' ? undefined : parseTaskSource(source).kind;
}

/** The `task_start` input of a form: empty optional fields are left out and the instruction only goes with a PR or Jira source. */
export function buildStartInput(form: TaskForm): Record<string, unknown> {
  const kind = detectKind(form.source);
  const instruction = form.instruction.trim();
  const base = form.base.trim();
  const repoPath = form.repoPath.trim();
  return {
    source: form.source.trim(),
    ...(kind !== 'prompt' && instruction !== '' ? { instruction } : {}),
    ...(repoPath === '' ? {} : { repoPath }),
    ...(base === '' || kind === 'pull-request' ? {} : { base }),
    ...(form.parentFolderId === '' ? {} : { parentFolderId: form.parentFolderId }),
    ...(form.mode === 'profile' ? {} : { permissionMode: form.mode }),
  };
}
