import { describe, expect, it } from 'vitest';
import { statusAfterHook } from './status';

describe('status from hook events', () => {
  it.each([
    ['starting', 'SessionStart', 'idle'],
    ['idle', 'SessionStart', undefined],
    ['busy', 'SessionStart', undefined],
    ['idle', 'UserPromptSubmit', 'busy'],
    ['busy', 'PermissionRequest', 'waiting'],
    ['waiting', 'PostToolUse', 'busy'],
    ['busy', 'PostToolUse', undefined],
    ['busy', 'Stop', 'idle'],
    ['waiting', 'Stop', 'idle'],
    ['busy', 'SubagentStop', undefined],
    ['exited', 'Stop', undefined],
  ] as const)('%s after %s is %s', (current, hook, expected) => {
    expect(statusAfterHook(current, hook), `status after ${hook} in ${current}`).toBe(expected);
  });
});
