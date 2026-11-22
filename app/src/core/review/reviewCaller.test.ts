import { describe, expect, it } from 'vitest';
import type { Caller } from '../commands/index';
import { reviewCallerOf } from './reviewCaller';

const mcp: Caller = { kind: 'mcp', sessionId: 's1', folderId: 'f1' };

describe('reviewCallerOf', () => {
  it('reads the user as the user whatever the sessions run', () => {
    expect(reviewCallerOf({ kind: 'ui' }, () => true), 'the UI').toEqual({ kind: 'ui' });
  });

  it('reads a session with a running review run as a reviewer without a folder', () => {
    const asked: string[] = [];
    const caller = reviewCallerOf(mcp, (sessionId) => (asked.push(sessionId), true));
    expect(caller, 'a reviewer').toEqual({ kind: 'reviewer', sessionId: 's1' });
    expect(asked, 'the run is looked up by the session of the token').toEqual(['s1']);
  });

  it('reads every other session as a session with its folder', () => {
    expect(reviewCallerOf(mcp, () => false), 'a session without a running review run').toEqual({ kind: 'session', sessionId: 's1', folderId: 'f1' });
  });
});
