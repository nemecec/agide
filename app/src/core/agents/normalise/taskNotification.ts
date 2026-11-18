export interface TaskNotification {
  readonly taskId?: string;
  readonly toolUseId?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly subagentTokens?: number;
}

const element = (text: string, name: string): string | undefined => {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text);
  return match?.[1]?.trim() || undefined;
};

/**
 * Reads the `<task-notification>` prompt that returns a background subagent's result to the session (P13).
 * Returns undefined for any other prompt. Only the `completed` status is observed; others pass through as text.
 */
export function parseTaskNotification(prompt: string): TaskNotification | undefined {
  if (!prompt.trimStart().startsWith('<task-notification>')) return undefined;
  const tokens = Number(element(prompt, 'subagent_tokens'));
  const taskId = element(prompt, 'task-id');
  const toolUseId = element(prompt, 'tool-use-id');
  const status = element(prompt, 'status');
  const summary = element(prompt, 'summary');
  return {
    ...(taskId === undefined ? {} : { taskId }),
    ...(toolUseId === undefined ? {} : { toolUseId }),
    ...(status === undefined ? {} : { status }),
    ...(summary === undefined ? {} : { summary }),
    ...(Number.isFinite(tokens) ? { subagentTokens: tokens } : {}),
  };
}
