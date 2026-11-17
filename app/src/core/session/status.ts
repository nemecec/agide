import type { SessionStatus } from './types';

/**
 * The status after a hook event, or `undefined` when the event does not change it.
 * - `SessionStart` ends `starting` (it also fires on `/clear` and compaction, which change nothing).
 * - `PermissionRequest` opens a prompt; the next tool call or the end of the turn closes it. A denied prompt
 *   shows as `waiting` until then, because no hook reports the denial.
 */
export function statusAfterHook(current: SessionStatus, hookEvent: string): SessionStatus | undefined {
  if (current === 'exited') return undefined;
  switch (hookEvent) {
    case 'SessionStart':
      return current === 'starting' ? 'idle' : undefined;
    case 'UserPromptSubmit':
      return 'busy';
    case 'PermissionRequest':
      return 'waiting';
    case 'PreToolUse':
    case 'PostToolUse':
      return current === 'waiting' ? 'busy' : undefined;
    case 'Stop':
      return 'idle';
    default:
      return undefined;
  }
}
